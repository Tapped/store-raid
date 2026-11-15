// The game mode every level starts with: who plays as what. Rounds, modes and the rest come here
// as they're ported from server/src/rooms/GameRoom.ts.
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
}
