// What every machine knows about the room: its mechanics, owned by the server and synced, which
// every character's movement is given, so the server and each client's prediction agree. It also
// builds the level on every machine from the same data, as shared/ did: for now the playground.
class AStoreRaidGameState : AGameStateBase
{
	UPROPERTY(ReplicatedUsing = OnRep_Mechanics)
	FStoreRaidMechanics Mechanics;

	/** The level as built on this machine. */
	ALevelGeometry Geometry;

	/** How bright the playground's lamps are, 0 to 1: on the dimmer. */
	UPROPERTY(ReplicatedUsing = OnRep_Light)
	float Light = 1.0;

	/** The lamps and how bright each is at full, to dim them by Light. */
	TArray<UPointLightComponent> Lamps;
	TArray<float> LampLumens;

	UFUNCTION()
	void OnRep_Light()
	{
		for (int Index = 0; Index < Lamps.Num(); Index++)
			Lamps[Index].SetIntensity(LampLumens[Index] * Light);
	}

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

		// The dimmer: a plate on the wall with a knob, for everyone to see.
		Geometry.AddBlock(Playground::DIMMER.X - 0.12, Playground::DIMMER.X + 0.12, Playground::DIMMER.Y - 0.15, Playground::DIMMER.Y + 0.15, Playground::DIMMER.Z, Playground::DIMMER.Z + 0.04);

		// Where players come in, as spawnPoint() in shared/level.ts: facing north; and the items.
		if (HasAuthority())
		{
			for (const FItemSpawn& Spawn : Playground::Items())
			{
				AStoreRaidItem Item = Cast<AStoreRaidItem>(SpawnActor(AStoreRaidItem, World::ToWorld(Spawn.X, Spawn.Y, Spawn.Z)));
				Item.Kind = Spawn.Kind;
				Item.Spawn = FVector(Spawn.X, Spawn.Y, Spawn.Z);
				Item.OnRep_Kind();
			}
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
		UPointLightComponent Bulb = Lamp.PointLightComponent;
		Bulb.SetMobility(EComponentMobility::Movable);
		Bulb.SetIntensityUnits(ELightUnits::Lumens);
		Bulb.SetIntensity(Lumens);
		Bulb.SetAttenuationRadius(Radius);
		Bulb.SetLightColor(FLinearColor(1.0, 0.9, 0.75));
		Bulb.SetCastShadows(true);
		Lamps.Add(Bulb);
		LampLumens.Add(Lumens);
	}
}
