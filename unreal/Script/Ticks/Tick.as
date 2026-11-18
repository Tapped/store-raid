// One tick: moved by ATickNest on the server, which keeps what it knows of the tick here too (its
// mind, not replicated), and drawn on every client where the server says: client/src/ticks.ts.
// Walking, waiting on a perch, in the air, on its back when pulled off, and clinging to a player's
// face: one on the player whose eyes we look through fills the view, belly to the camera.

class ATick : AActor
{
	default bReplicates = true;
	default bAlwaysRelevant = true;
	default NetUpdateFrequency = 30;

	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;

	/** The model, turned and placed by Show() on clients. */
	UPROPERTY(DefaultComponent, Attach = Root)
	USkeletalMeshComponent Model;
	default Model.CollisionEnabled = ECollisionEnabled::NoCollision;
	default Model.bReceivesDecals = false;

	/** Where its feet are, in game meters, and the way it faces (radians from north, east positive). */
	UPROPERTY(Replicated)
	FVector Position;
	UPROPERTY(Replicated)
	float Yaw = 0;
	UPROPERTY(Replicated)
	ETickState State = ETickState::Perched;
	/** Whom it's on, while latched. */
	UPROPERTY(Replicated)
	APlayerState Victim;

	// What the server knows of it besides what it replicates (server/src/ticks.ts's Mind).
	/** Where it started, to go back to if it falls out of the level. */
	FPerch Home;
	FVector Velocity;
	/** The racking it dropped off, which it falls past; everything else stops it in the air. */
	int Off = -1;
	/** What it does when it lands: hunt, or lie stunned. */
	bool bLandStunned = false;
	/** Seconds it stays afraid of the light, where that light was, and whether there was one. */
	float Afraid = 0;
	FVector From;
	bool bHasFrom = false;
	/** Seconds until it can leap again. */
	float Rest = 0;
	/** Counts down: lying stunned, or standing before it wanders on. */
	float Timer = 0;
	/** The way to its prey, whether it has one, and seconds until it looks for a new one. */
	TArray<FVector> Path;
	bool bHasPath = false;
	float Repath = 0;
	/** Where it's wandering to, if anywhere. */
	FVector Goal;
	bool bHasGoal = false;
	/** Which way round something it goes when a light is behind it and a wall ahead. */
	float Side = 1;
	/** Seconds someone else's beam has been on it while it's latched. */
	float Shone = 0;

	/** Where it's drawn on this client, easing after the replicated position. */
	FVector Shown;
	bool bShownYet = false;
	float Clock = 0;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		USkeletalMesh Mesh = Models::Skinned("characters/tick");
		if (Mesh != nullptr)
			Model.SetSkeletalMeshAsset(Mesh);
		Clock = Math::RandRange(0.0, 10.0);
		if (HasAuthority() && System::IsDedicatedServer())
			Model.SetVisibility(false);
	}

	/** Where the server puts it: in game meters, facing yaw. */
	void Place(FVector At, float NewYaw)
	{
		Position = At;
		Yaw = NewYaw;
	}

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		if (System::IsDedicatedServer())
			return;
		Clock += DeltaSeconds;
		Show(DeltaSeconds);
	}

	/**
	 * On clients: where it is and how it holds itself. On the face of whoever we look through it's in
	 * front of the camera, belly towards us, jerking about; on someone else's, standing on end in
	 * front of theirs; pulled off, on its back.
	 */
	void Show(float DeltaSeconds)
	{
		// Eased after the server's position, by about a tenth of a second; a jump of meters snaps.
		if (!bShownYet || Shown.Distance(Position) > 2)
			Shown = Position;
		else
			Shown = Math::VInterpTo(Shown, Position, DeltaSeconds, 15);
		bShownYet = true;

		FVector At = World::ToWorld(Shown.X, Shown.Y, Shown.Z);
		// The model's head is along its -y, so a yaw a quarter turn round sends it head first.
		FRotator Facing(0, Math::RadiansToDegrees(Yaw) + 90, 0);
		AStoreRaidCharacter On = State == ETickState::Latched ? CharacterOf(Victim) : nullptr;
		APlayerController Local = Gameplay::GetPlayerController(0);
		if (On != nullptr && Local != nullptr && Local.GetViewTarget() == On)
		{
			// On our face: in front of the camera wherever it looks, upright, its belly towards us.
			const FVector Eye = Local.PlayerCameraManager.GetCameraLocation();
			const FRotator Look = Local.PlayerCameraManager.GetCameraRotation();
			const float Jerk = FACE_SHAKE * Math::Sin(Clock * 23);
			const float Sway = FACE_SHAKE * Math::Sin(Clock * 17);
			At = Eye + Look.ForwardVector * FACE_AHEAD * 100 + Look.UpVector * (-FACE_DOWN + Jerk) * 100 + Look.RightVector * Sway * 100;
			// Its belly towards us and its head up the view, its feet that far in front of the eyes.
			Facing = FRotator::MakeFromYZ(-Look.UpVector, Look.ForwardVector);
		}
		else if (On != nullptr)
		{
			// On someone else's: where the server keeps it, standing on end, its belly to their face.
			const FRotator Theirs(0, On.ActorRotation.Yaw, 0);
			const FVector Feet = On.ActorLocation - FVector(0, 0, On.CapsuleComponent.ScaledCapsuleHalfHeight);
			At = Feet + Theirs.ForwardVector * TickRules::LATCH_AHEAD * 100 + FVector(0, 0, TickRules::LATCH_HEIGHT * 100);
			Facing = FRotator::MakeFromYZ(-FVector::UpVector, Theirs.ForwardVector);
		}
		else if (State == ETickState::Stunned)
		{
			// On its back, lying on its shield.
			Facing.Roll = 180;
			At += FVector(0, 0, ON_BACK * 100);
		}
		FHitResult Hit;
		SetActorLocationAndRotation(At, Facing, false, Hit, true);
	}

	/** The character of a player, if they have one. */
	AStoreRaidCharacter CharacterOf(APlayerState Player)
	{
		if (Player == nullptr)
			return nullptr;
		return Cast<AStoreRaidCharacter>(Player.GetPawn());
	}
}

/** A tick on our face: meters in front of the eyes and below them, and how far it jerks about. */
const float FACE_AHEAD = 0.42;
const float FACE_DOWN = 0.1;
const float FACE_SHAKE = 0.012;
/** A tick on its back is raised by its own height to lie on its shield (scripts/models/tick.py). */
const float ON_BACK = 0.58;

// sr.ticks: logs the ticks this machine knows of, their state, where (game meters) and whom they're
// on, and everyone's health.
const FConsoleCommand TicksCommand("sr.ticks", n"OnTicksCommand");
void OnTicksCommand(TArray<FString> Arguments)
{
	TArray<ATick> All;
	GetAllActorsOfClass(All);
	Log(f"StoreRaid ticks: {All.Num()}");
	for (ATick Tick : All)
	{
		const FString On = Tick.Victim != nullptr ? Tick.Victim.PlayerName : "";
		Log(f"StoreRaid tick: {Tick.Name} {Tick.State} {Tick.Position.X :.2} {Tick.Position.Y :.2} {Tick.Position.Z :.2} {On}");
	}
	AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	for (AStoreRaidPlayerState Player : Room.Players())
		Log(f"StoreRaid health: {Player.PlayerName} {Player.Health :.1} {Player.Role}");
}
