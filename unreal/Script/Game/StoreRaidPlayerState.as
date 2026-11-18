// What every machine knows of a player beyond their character: who they are this round, whether
// they're ready, and the truck's seat they sit on. On the player state, not the character, because
// only those playing have a character: the dead, lost and waiting watch through someone else's eyes.
// Set by the game mode on the server; it forces an update on every change, as the engine sends player
// states only now and then.
namespace Health
{
	/** A player's health when they come into the building. */
	const float MAX = 100;
}

class AStoreRaidPlayerState : APlayerState
{
	/** Who they are this round: only those playing are in the building. */
	UPROPERTY(Replicated)
	ERole Role = ERole::Playing;

	/** In the lobby, ready to start; in the raid, in the truck and wanting to leave. */
	UPROPERTY(Replicated)
	bool bReady = false;

	/** The truck's seat they sit on, an index into FParkedTruck.Seats, or -1 standing. */
	UPROPERTY(Replicated)
	int Seat = -1;

	/** Out of Health::MAX: only a tick on them takes it. */
	UPROPERTY(Replicated)
	float Health = Health::MAX;

	void SetRole(ERole NewRole)
	{
		Role = NewRole;
		ForceNetUpdate();
	}

	void SetReady(bool bNewReady)
	{
		bReady = bNewReady;
		ForceNetUpdate();
	}

	void SetSeat(int NewSeat)
	{
		Seat = NewSeat;
		ForceNetUpdate();
	}

	void SetHealth(float NewHealth)
	{
		Health = NewHealth;
		ForceNetUpdate();
	}

	bool IsPlaying() const
	{
		return Role == ERole::Playing;
	}
}
