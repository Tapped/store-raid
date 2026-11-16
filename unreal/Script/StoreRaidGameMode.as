// The game mode every level starts with: who plays as what, where they come in, and putting back
// whoever falls out of the level. Rounds, modes and the rest come here as they're ported from
// server/src/rooms/GameRoom.ts.
class AStoreRaidGameMode : AGameModeBase
{
	default DefaultPawnClass = AStoreRaidCharacter;
	default PlayerControllerClass = AStoreRaidPlayerController;
	default GameStateClass = AStoreRaidGameState;

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
	void Tick(float DeltaSeconds)
	{
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
