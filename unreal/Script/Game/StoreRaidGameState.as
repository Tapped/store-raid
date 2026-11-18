// What every machine knows about the room: its mechanics, owned by the server and synced, which
// every character's movement is given, so the server and each client's prediction agree; what the
// room is for and where a game's round is (GameState in server/src/rooms/schema.ts). It also builds
// the level on every machine from the same data, as shared/ did: the one the server names
// (`-level=generated-7` on its command line, else the playground), with the crew's truck.
class AStoreRaidGameState : AGameStateBase
{
	/** The level's name, as Levels::Named takes it: the server's, which every machine builds. */
	UPROPERTY(Replicated)
	FString LevelName = "playground";

	/** The level, as built on this machine. Not `Level`, which would hide the namespace Level. */
	FLevel Layout;

	/** What the room is for: the playground has no rounds. */
	UPROPERTY(Replicated)
	EMode Mode = EMode::Playground;

	/** Where a game's round is. */
	UPROPERTY(Replicated)
	EPhase Phase = EPhase::Lobby;

	/** Seconds left: to the raid starting, to dawn, or to the next round. 0 while waiting in the lobby. */
	UPROPERTY(Replicated)
	float TimeLeft = 0;

	/** What the loot in the truck sells for, and what it must reach to clear the level. */
	UPROPERTY(Replicated)
	int Loot = 0;
	UPROPERTY(Replicated)
	int Quota = 0;

	/** After a raid: whether the truck held the quota. */
	UPROPERTY(Replicated)
	bool bCleared = false;

	/** The truck's hatch, from 0 (up, shut) to 1 (down, the ramp): only at 1 can it be walked on. */
	UPROPERTY(ReplicatedUsing = OnRep_Hatch)
	float Hatch = 1.0;

	/** The truck, as the level has it, and drawn on this machine. */
	FParkedTruck Parked;
	ATruck TruckActor;

	UFUNCTION()
	void OnRep_Hatch()
	{
		if (TruckActor != nullptr)
			TruckActor.Show(Hatch);
	}

	/** Whether a point (game meters) is in the truck's cargo space. */
	bool InTruck(FVector GamePoint) const
	{
		return Modes::Inside(Parked.Dock, GamePoint.X, GamePoint.Z);
	}

	/** The players in the room, as their player states. */
	TArray<AStoreRaidPlayerState> Players() const
	{
		TArray<AStoreRaidPlayerState> Result;
		// PlayerArray holds pointers script can't take, so through the gameplay statics, which read it.
		for (int Index = 0; Index < Gameplay::GetNumPlayerStates(); Index++)
		{
			AStoreRaidPlayerState State = Cast<AStoreRaidPlayerState>(Gameplay::GetPlayerState(Index));
			if (State != nullptr)
				Result.Add(State);
		}
		return Result;
	}
	UPROPERTY(ReplicatedUsing = OnRep_Mechanics)
	FStoreRaidMechanics Mechanics;

	/** The level as built on this machine. */
	ALevelGeometry Geometry;

	/** How bright the playground's lamps are, 0 to 1: on the dimmer. */
	UPROPERTY(ReplicatedUsing = OnRep_Light)
	float Light = 1.0;

	/** The level's lamps on this machine; none on the dedicated server. */
	ALevelFittings Fittings;

	UFUNCTION()
	void OnRep_Light()
	{
		if (Fittings != nullptr)
			Fittings.SetDimmer(Light);
	}

	/** Lights the lamps again (sr.lamps). */
	void Relight()
	{
		if (Fittings != nullptr)
			Fittings.DestroyActor();
		Fittings = Cast<ALevelFittings>(SpawnActor(ALevelFittings));
		Fittings.Build(Layout.Lamps, Layout.Props);
		Fittings.SetDimmer(Light);
	}

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		if (HasAuthority())
		{
			TArray<FString> Tokens;
			TArray<FString> Switches;
			FCommandLine::Parse(FCommandLine::Get(), Tokens, Switches);
			for (const FString& Switch : Switches)
			{
				if (Switch.StartsWith("level="))
					LevelName = Switch.RightChop(6);
			}
		}
		BuildLevel();
	}

	UFUNCTION()
	void OnRep_Mechanics()
	{
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		for (AStoreRaidCharacter Character : Characters)
			Character.Movement.SetMechanics(Mechanics);
	}

	/** Sets a character up to move in this room: its mechanics and the level's ladders. */
	void Prepare(AStoreRaidCharacter Character)
	{
		Character.Movement.SetMechanics(Mechanics);
		if (Geometry != nullptr)
			Character.Movement.SetLadders(Geometry.Ladders);
	}

	void BuildLevel()
	{
		Layout = Levels::Named(LevelName);
		if (!Layout.Problem.IsEmpty())
		{
			Log(f"StoreRaid: no level {LevelName}: {Layout.Problem}");
			return;
		}
		Geometry = Cast<ALevelGeometry>(SpawnActor(ALevelGeometry));
		Geometry.Build(Layout);
		Log(f"StoreRaid: {Layout.Name} built: {Layout.Floors.Num()} floors, {Layout.Boxes.Num()} boxes, {Layout.Ladders.Num()} ladders, {Layout.Props.Num()} props, {Layout.Lamps.Num()} lamps");
		if (!System::IsDedicatedServer())
		{
			SpawnActor(ALook);
			Fittings = Cast<ALevelFittings>(SpawnActor(ALevelFittings));
			const TArray<int> Own = Fittings.Build(Layout.Lamps, Layout.Props);
			Fittings.SetDimmer(Light);
			if (Layout.Grid.Storeys.Num() > 0)
			{
				ALevelBuilding Drawn = Cast<ALevelBuilding>(SpawnActor(ALevelBuilding));
				Drawn.Build(Layout);
			}
			if (Layout.Props.Num() > 0)
			{
				ALevelProps Props = Cast<ALevelProps>(SpawnActor(ALevelProps));
				Props.Build(Layout.Props, Own);
			}
		}
		// The dimmer: a plate on the wall with a knob, for everyone to see.
		Geometry.AddFixture(Layout.Dimmer.X - 0.12, Layout.Dimmer.X + 0.12, Layout.Dimmer.Y - 0.15, Layout.Dimmer.Y + 0.15, Layout.Dimmer.Z, Layout.Dimmer.Z + 0.04);
		// The crew's truck, with its hatch where the room has it.
		Parked = Truck::Park(Layout.Truck);
		TruckActor = Cast<ATruck>(SpawnActor(ATruck));
		TruckActor.Build(Parked);
		TruckActor.Show(Hatch);
		Quota = Modes::QuotaFor(Layout.Items);
		// Where players come in, as spawnPoint() in shared/level.ts: facing north; and the items.
		if (HasAuthority())
		{
			for (const FItemSpawn& Spawn : Layout.Items)
			{
				AStoreRaidItem Item = Cast<AStoreRaidItem>(SpawnActor(AStoreRaidItem, World::ToWorld(Spawn.X, Spawn.Y, Spawn.Z)));
				Item.Kind = Spawn.Kind;
				Item.Spawn = FVector(Spawn.X, Spawn.Y, Spawn.Z);
				Item.OnRep_Kind();
			}
			for (const FVector2D& Spawn : Layout.Spawns)
				SpawnActor(APlayerStart, World::ToWorld(Spawn.X, 1.0, Spawn.Y), FRotator::ZeroRotator);
		}
		Log(f"StoreRaid: {Layout.Name} ready");
	}
}
