// The player's character: a first-person camera at eye height for its owner, and a stand-in body
// for everyone else, until the character model is imported. It moves by UStoreRaidMovement (C++),
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

	/** What others see of this player for now: a cylinder as tall and wide as they are. */
	UPROPERTY(DefaultComponent, Attach = CollisionCylinder)
	UStaticMeshComponent Body;
	default Body.bOwnerNoSee = true;
	default Body.RelativeScale3D = FVector(0.6, 0.6, 1.8);

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

		// The engine's cylinder is 1 m tall about its middle, like the capsule.
		Body.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cylinder.Cylinder")));
		Body.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		AStoreRaidGameState State = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
		if (State != nullptr)
			State.Prepare(this);
	}

	/**
	 * Seated or standing, on every machine, from the replicated seat. The stand-in body sits back on
	 * the bench behind the feet, as the seated clips sit, and shorter; or stands over them. The
	 * capsule narrows to SEATED_RADIUS: seats are 0.56 m apart, closer than two players, and one
	 * getting up mustn't start inside the one beside them, or neither moves (the web game let those
	 * seated overlap and pushed walkers out of them).
	 */
	void ShowSeated(bool bSeated)
	{
		Body.SetRelativeLocation(bSeated ? FVector(-45, 0, -25) : FVector::ZeroVector);
		Body.SetRelativeScale3D(FVector(0.6, 0.6, bSeated ? 1.3 : 1.8));
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
