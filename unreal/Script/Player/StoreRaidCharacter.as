// The player's character: a first-person camera at eye height for its owner, and the character
// model for everyone else (Body.as), or a stand-in cylinder if it isn't imported. It moves by UStoreRaidMovement (C++),
// which predicts walking, running and stamina, jumping, stairs and ladders, and the server corrects.
class AStoreRaidCharacter : AStoreRaidCharacterBase
{
	/** EYE_HEIGHT 1.65 m over the feet, which are 0.9 m under the capsule's middle. */
	UPROPERTY(DefaultComponent, Attach = CollisionCylinder)
	UCameraComponent Camera;
	default Camera.RelativeLocation = FVector(0, 0, 75);
	default Camera.bUsePawnControlRotation = true;
	// The web game's view: 1.1 rad (63°) from top to bottom, whatever the window's shape, as Babylon
	// keeps the vertical angle. FieldOfView is the angle across at the camera's AspectRatio (16:9), and
	// the engine's players hold the vertical angle that gives (MaintainYFOV in BaseEngine.ini).
	default Camera.FieldOfView = 94.93;

	/** What others see of this player: the character, its feet at the capsule's foot, posed by Pose. */
	UPROPERTY(DefaultComponent, Attach = CollisionCylinder)
	USkeletalMeshComponent Body;
	default Body.bOwnerNoSee = true;
	default Body.RelativeLocation = FVector(0, 0, -90);
	default Body.SetCollisionEnabled(ECollisionEnabled::NoCollision);

	/** Shown instead if the character isn't imported: a cylinder as tall and wide as they are. */
	UPROPERTY(DefaultComponent, Attach = CollisionCylinder)
	UStaticMeshComponent StandIn;
	default StandIn.bOwnerNoSee = true;
	default StandIn.RelativeScale3D = FVector(0.6, 0.6, 1.8);
	default StandIn.SetCollisionEnabled(ECollisionEnabled::NoCollision);

	/** How the body is posed and turned, on machines that draw it. */
	FBody Pose;
	bool bSeatedShown = false;
	/** Whether the seat has been said yet: until then the body waits, so one already seated starts seated. */
	bool bSeatKnown = false;
	bool bBodyHidden = false;
	/** Their feet, heard on every machine but the server: ours straight, theirs from where they are. */
	FGait Gait;
	FOneShots Steps;

	/**
	 * What shoves loose items: a capsule like the player's own, which blocks only physics bodies. The
	 * player's own capsule passes through items, so they never stop a player; this one pushes
	 * two-handed ones aside as it moves with them, as players were kinematic bodies in physics.ts.
	 */
	UPROPERTY(DefaultComponent, Attach = CollisionCylinder)
	UCapsuleComponent Shover;
	default Shover.CapsuleRadius = 30;
	default Shover.CapsuleHalfHeight = 90;

	/** What's in each hand: the same item in both for a two-handed one. Set by Hands.as on the server. */
	UPROPERTY(ReplicatedUsing = OnHandsChanged)
	AStoreRaidItem Left;
	UPROPERTY(ReplicatedUsing = OnHandsChanged)
	AStoreRaidItem Right;

	/** Climbing a ladder takes a free hand: a phone in the other is fine, a TV or two phones aren't. */
	UFUNCTION()
	void OnHandsChanged()
	{
		Movement.bCanClimb = Left == nullptr || Right == nullptr;
	}

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		CapsuleComponent.SetCollisionResponseToChannel(ECollisionChannel::PhysicsBody, ECollisionResponse::ECR_Ignore);
		Shover.SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Shover.SetCollisionObjectType(ECollisionChannel::Pawn);
		Shover.SetCollisionResponseToAllChannels(ECollisionResponse::ECR_Ignore);
		Shover.SetCollisionResponseToChannel(ECollisionChannel::PhysicsBody, ECollisionResponse::ECR_Block);

		USkeletalMesh Character = System::IsDedicatedServer() ? nullptr : Models::Skinned("characters/ch35");
		if (Character != nullptr)
		{
			Body.SetSkeletalMeshAsset(Character);
			Pose.Load(Body, "characters/ch35");
			StandIn.SetVisibility(false);
		}
		else
		{
			// The engine's cylinder is 1 m tall about its middle, like the capsule.
			StandIn.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cylinder.Cylinder")));
			Body.SetVisibility(false);
		}
		AStoreRaidGameState State = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
		if (State != nullptr)
			State.Prepare(this);
	}

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		if (System::IsDedicatedServer())
			return;
		Footstep(DeltaSeconds);
		if (Body.SkeletalMeshAsset == nullptr || !bSeatKnown || PlayerState == nullptr)
			return;
		float SeatYaw = 0;
		const AStoreRaidPlayerState Player = Cast<AStoreRaidPlayerState>(PlayerState);
		AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
		if (Player != nullptr)
			Pose.ChooseIdle(Player.PlayerName);
		if (bSeatedShown && Player != nullptr && Room != nullptr && Player.Seat >= 0 && Player.Seat < Room.Parked.Seats.Num())
			SeatYaw = Room.Parked.Seats[Player.Seat].Yaw;
		const bool bCarrying = Left != nullptr && Left == Right;
		Pose.Update(Body, GetVelocity(), GetBaseAimRotation().Yaw, bSeatedShown, SeatYaw, bCarrying, DeltaSeconds);
	}

	/**
	 * A footstep when a foot lands, walking or running on the ground (not on a ladder, in the air or
	 * seated): ours heard straight, someone else's from their feet. Someone else's character here has
	 * no movement mode (it's MOVE_None on every machine but its own and the server), so whether
	 * they're on the ground is a short look down from their feet.
	 */
	void Footstep(float DeltaSeconds)
	{
		const AStoreRaidPlayerState Player = Cast<AStoreRaidPlayerState>(PlayerState);
		const bool bSeated = bSeatedShown || (Player != nullptr && Player.Seat >= 0);
		const float Speed = GetVelocity().Size2D() / 100.0;
		if (!Gait.Update(DeltaSeconds, Speed, !bSeated))
			return;
		const FVector Feet = ActorLocation - FVector(0, 0, CapsuleComponent.ScaledCapsuleHalfHeight);
		if (IsLocallyControlled() ? !Movement.IsMovingOnGround() : !OnGround(Feet))
			return;
		if (!Steps.bLoaded)
			Steps.Load(Footsteps::Takes());
		if (IsLocallyControlled())
			Steps.PlayStraight(Gait.Volume() * Footsteps::OWN);
		else
			// A little above the floor, so the floor itself doesn't muffle them.
			Steps.PlayAt(Feet + FVector(0, 0, 10), Gait.Volume() * Footsteps::THEIRS);
	}

	/** Whether there's floor under these feet: within 30 cm below them (STEP_DOWN and then some). */
	bool OnGround(FVector Feet) const
	{
		TArray<AActor> Ignored;
		FHitResult Hit;
		return System::LineTraceSingle(Feet + FVector(0, 0, 10), Feet - FVector(0, 0, 30), ETraceTypeQuery::Visibility, false, Ignored, EDrawDebugTrace::None, Hit, true);
	}

	/** Hidden while we look through this player's eyes, so the camera isn't inside their head. */
	void HideBody(bool bHidden)
	{
		if (bHidden == bBodyHidden)
			return;
		bBodyHidden = bHidden;
		Body.SetHiddenInGame(bHidden);
		StandIn.SetHiddenInGame(bHidden);
	}

	/**
	 * Seated or standing, on every machine, from the replicated seat. The character sits back on the
	 * bench behind the feet, as the seated clips do; the stand-in sits there too, shorter. The
	 * capsule narrows to SEATED_RADIUS: seats are 0.56 m apart, closer than two players, and one
	 * getting up mustn't start inside the one beside them, or neither moves (the web game let those
	 * seated overlap and pushed walkers out of them).
	 */
	void ShowSeated(bool bSeated)
	{
		bSeatedShown = bSeated;
		bSeatKnown = PlayerState != nullptr;
		StandIn.SetRelativeLocation(bSeated ? FVector(-45, 0, -25) : FVector::ZeroVector);
		StandIn.SetRelativeScale3D(FVector(0.6, 0.6, bSeated ? 1.3 : 1.8));
		const float Radius = bSeated ? SEATED_RADIUS : 30;
		if (CapsuleComponent.CapsuleRadius != Radius)
			CapsuleComponent.SetCapsuleRadius(Radius, true);
	}

	/** Called by the local controller every frame with what the player asks for and where they look. */
	void Drive(FControls Controls, float Yaw)
	{
		const FRotator Facing(0, Yaw, 0);
		const FVector Direction = Facing.ForwardVector * Controls.Move.Y + Facing.RightVector * Controls.Move.X;
		AddMovementInput(Direction, 1.0);
		Movement.bWantsToRun = Controls.bRun;
		if (Controls.bJump)
			Jump();
		else
			StopJumping();
	}
}

/** A seated player's capsule, in cm: with the 0.3 m of one standing, short of the 0.56 m between seats. */
const float SEATED_RADIUS = 25.0;
