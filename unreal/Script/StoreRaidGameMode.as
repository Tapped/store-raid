// The game mode every level starts with: who plays as what, where they come in, and putting back
// whoever falls out of the level. Rounds, modes and the rest come here as they're ported from
// server/src/rooms/GameRoom.ts.
class AStoreRaidGameMode : AGameModeBase
{
	default DefaultPawnClass = AStoreRaidCharacter;
	default PlayerControllerClass = AStoreRaidPlayerController;
	default GameStateClass = AStoreRaidGameState;

	/** Those holding the dimmer, and the way it fades: each push fades the other way from the last. */
	TArray<AStoreRaidCharacter> Dimming;
	float DimDirection = 1;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		Log("StoreRaid: game mode up");
	}

	UFUNCTION(BlueprintOverride)
	void OnPostLogin(APlayerController NewPlayer)
	{
		Log(f"StoreRaid: {NewPlayer.PlayerState.PlayerName} joined");
	}

	/** Each player at the first free spawn point, in spawnPoint()'s order. */
	UFUNCTION(BlueprintOverride)
	AActor ChoosePlayerStart(AController Player)
	{
		TArray<APlayerStart> Starts;
		GetAllActorsOfClass(Starts);
		const FVector2D Spawn = FreeSpawnPoint();
		APlayerStart Nearest;
		float NearestDistance = 0;
		for (APlayerStart Start : Starts)
		{
			const float Distance = World::GameXZ(Start.ActorLocation).Distance(Spawn);
			if (Nearest == nullptr || Distance < NearestDistance)
			{
				Nearest = Start;
				NearestDistance = Distance;
			}
		}
		return Nearest;
	}

	UFUNCTION(BlueprintOverride)
	void OnLogout(AController ExitingController)
	{
		AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(ExitingController.ControlledPawn);
		if (Character != nullptr)
		{
			Hands::DropAll(Character);
			Dimming.Remove(Character);
		}
	}

	/** The grab button: the dimmer if they're at it, else the nearest item in front of them. */
	void Grab(AStoreRaidCharacter Character)
	{
		if (AtDimmer(Character))
		{
			DimDirection = -DimDirection;
			Dimming.AddUnique(Character);
			return;
		}
		Hands::Grab(Character);
	}

	/** The grab button is up again: stop turning the dimmer. */
	void Release(AStoreRaidCharacter Character)
	{
		Dimming.Remove(Character);
	}

	/** Whether the player is close to the dimmer, at the height of their hand, and looking at it. */
	bool AtDimmer(AStoreRaidCharacter Character)
	{
		const FVector Feet = Hands::FeetOf(Character);
		const FVector Target = World::ToWorld(Playground::DIMMER.X, Playground::DIMMER.Y, Playground::DIMMER.Z);
		const FVector Toward = Target - Feet;
		const float Distance = Toward.Size2D() / 100.0;
		if (Distance > Items::DIMMER_REACH || Math::Abs(Toward.Z / 100.0 - Items::DIMMER_HAND) > 1)
			return false;
		const FVector Facing = FRotator(0, Character.ActorRotation.Yaw, 0).ForwardVector;
		const float Ahead = (Toward.X * Facing.X + Toward.Y * Facing.Y) / 100.0;
		return Ahead >= Distance * Math::Cos(Math::DegreesToRadians(Items::GRAB_CONE));
	}

	/** Fades the lamps while someone holds the dimmer, turning round at fully on and off. */
	void Dim(float DeltaSeconds)
	{
		for (int Index = Dimming.Num() - 1; Index >= 0; Index--)
		{
			if (!IsValid(Dimming[Index]) || !AtDimmer(Dimming[Index]))
				Dimming.RemoveAt(Index);
		}
		if (Dimming.Num() == 0)
			return;
		AStoreRaidGameState State = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
		const float Light = State.Light + DimDirection * DeltaSeconds / Items::DIM_TIME;
		if (Light >= 1 || Light <= 0)
			DimDirection = -DimDirection;
		State.Light = Math::Clamp(Light, 0.0, 1.0);
		State.OnRep_Light();
	}

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		Dim(DeltaSeconds);
		Hands::CarryAll(DeltaSeconds, Playground::KILL_Y);

		// Falling below the level respawns a player where they came in.
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		for (AStoreRaidCharacter Character : Characters)
		{
			const float FeetY = (Character.ActorLocation.Z - Character.CapsuleComponent.ScaledCapsuleHalfHeight) / 100.0;
			if (FeetY < Playground::KILL_Y)
				Respawn(Character);
		}
	}

	void Respawn(AStoreRaidCharacter Character)
	{
		const FVector2D Spawn = FreeSpawnPoint(Character);
		Hands::DropAll(Character);
		Character.Movement.StopMovementImmediately();
		FHitResult Hit;
		Character.SetActorLocation(World::ToWorld(Spawn.X, 0, Spawn.Y) + FVector(0, 0, Character.CapsuleComponent.ScaledCapsuleHalfHeight + 2), false, Hit, true);
		Log(f"StoreRaid: {Character.PlayerState.PlayerName} fell and respawned");
	}

	/** The first spawn point with nobody on it but Ignoring: a player stands a meter from the next. */
	FVector2D FreeSpawnPoint(AStoreRaidCharacter Ignoring = nullptr)
	{
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		for (int Index = 0; Index < 8; Index++)
		{
			const FVector2D Spawn = Playground::SpawnPoint(Index);
			bool bTaken = false;
			for (AStoreRaidCharacter Character : Characters)
			{
				if (Character != Ignoring && World::GameXZ(Character.ActorLocation).Distance(Spawn) < 0.7)
					bTaken = true;
			}
			if (!bTaken)
				return Spawn;
		}
		return Playground::SpawnPoint(0);
	}
}
