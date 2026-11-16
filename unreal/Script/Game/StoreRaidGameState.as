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

		// The hall's four walls and its roof, which the grid doesn't have (PLAYGROUND in shared/level.ts).
		const float X = Playground::HALL_X;
		const float Z = Playground::HALL_Z;
		const float W = Playground::WALL;
		const float Top = Playground::HALL_HEIGHT;
		const float Bottom = -Tiles::STOREY;
		Geometry.AddBlock(-X - W, -X, Bottom, Top, -Z, Z);
		Geometry.AddBlock(X, X + W, Bottom, Top, -Z, Z);
		Geometry.AddBlock(-X - W, X + W, Bottom, Top, -Z - W, -Z);
		Geometry.AddBlock(-X - W, X + W, Bottom, Top, Z, Z + W);
		Geometry.AddBlock(-X - W, X + W, Top, Top + W, -Z - W, Z + W);

		Log(f"StoreRaid: playground built: {Composed.Floors.Num()} floors, {Composed.Boxes.Num()} boxes, {Composed.Ladders.Num()} ladders");

		if (!System::IsDedicatedServer())
			AddHallLights();

		// Where players come in, as spawnPoint() in shared/level.ts: facing north.
		if (HasAuthority())
		{
			for (int Index = 0; Index < 8; Index++)
			{
				const FVector2D Spawn = Playground::SpawnPoint(Index);
				SpawnActor(APlayerStart, World::ToWorld(Spawn.X, 1.0, Spawn.Y), FRotator::ZeroRotator);
			}
		}
	}

	/**
	 * Lamps under the roof in rows 8 m apart, and two in the basement: movable lights, as everything
	 * is built at runtime and Lumen lights it, with nothing baked.
	 */
	void AddHallLights()
	{
		for (float X = -12; X <= 12; X += 8)
		{
			for (float Z = -8; Z <= 8; Z += 8)
				AddLamp(X, Playground::HALL_HEIGHT - 0.6, Z, 12000, 2400);
		}
		AddLamp(-6, -0.6, -4, 4000, 1200);
		AddLamp(1, -0.6, -6, 4000, 1200);
	}

	void AddLamp(float X, float Y, float Z, float Lumens, float Radius)
	{
		APointLight Lamp = Cast<APointLight>(SpawnActor(APointLight, World::ToWorld(X, Y, Z)));
		UPointLightComponent Light = Lamp.PointLightComponent;
		Light.SetMobility(EComponentMobility::Movable);
		Light.SetIntensityUnits(ELightUnits::Lumens);
		Light.SetIntensity(Lumens);
		Light.SetAttenuationRadius(Radius);
		Light.SetLightColor(FLinearColor(1.0, 0.9, 0.75));
		Light.SetCastShadows(true);
	}
}
