// What every machine knows about the room: its mechanics, owned by the server and synced, which
// every character's movement is given, so the server and each client's prediction agree. It also
// builds the level on every machine from the same data, as shared/ did: for now the playground.
class AStoreRaidGameState : AGameStateBase
{
	UPROPERTY(ReplicatedUsing = OnRep_Mechanics)
	FStoreRaidMechanics Mechanics;

	/** The level as built on this machine. */
	ALevelGeometry Geometry;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		BuildPlayground();
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

	void BuildPlayground()
	{
		FComposedTiles Composed = Tiles::ComposeTiles(Playground::Grid());
		if (!Composed.Problem.IsEmpty())
		{
			Log(f"StoreRaid: the playground's tiles don't fit: {Composed.Problem}");
			return;
		}
		Geometry = Cast<ALevelGeometry>(SpawnActor(ALevelGeometry));
		Geometry.Build(Composed);

		// The hall's four walls, which the grid doesn't have yet (Playground.as).
		const float X = Playground::HALL_X;
		const float Z = Playground::HALL_Z;
		const float Top = Playground::HALL_HEIGHT;
		const float Bottom = -Tiles::STOREY;
		Geometry.AddBlock(-X - 0.5, -X, Bottom, Top, -Z, Z);
		Geometry.AddBlock(X, X + 0.5, Bottom, Top, -Z, Z);
		Geometry.AddBlock(-X, X, Bottom, Top, -Z - 0.5, -Z);
		Geometry.AddBlock(-X, X, Bottom, Top, Z, Z + 0.5);

		Log(f"StoreRaid: playground built: {Composed.Floors.Num()} floors, {Composed.Boxes.Num()} boxes, {Composed.Ladders.Num()} ladders");

		if (!System::IsDedicatedServer())
		{
			SpawnActor(ADirectionalLight, FVector(0, 0, 2000), FRotator(-50, 30, 0));
			SpawnActor(ASkyLight, FVector(0, 0, 1500));
		}
		// Where players come in: on the ground in the south-west, facing north.
		if (HasAuthority())
			SpawnActor(APlayerStart, World::ToWorld(-12, 1.0, -8), FRotator::ZeroRotator);
	}
}
