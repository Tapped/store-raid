// What a room is for, and a game's round: mirrors shared/modes.ts.

/**
 * What a room is for. In the playground, features are tried out: no rounds, nobody dies, the lights
 * on the dimmer. A game is the real thing: rounds of a raid on the building, in phases.
 */
enum EMode
{
	Playground,
	Game,
};

/**
 * A game's round, in order: the crew gathers in the truck and readies up, raids the building until
 * everyone alive is back in the truck and wants to leave, or until dawn, and sees how it went. Then it
 * starts over.
 */
enum EPhase
{
	Lobby,
	Raid,
	Results,
};

/**
 * Who a player is this round. Only those playing are in the building; everyone else watches through
 * the eyes of those who are: the dead, those lost outside the truck at dawn, and those waiting because
 * they joined after the raid began.
 */
enum ERole
{
	Playing,
	Dead,
	Lost,
	Waiting,
};

namespace Modes
{
	/** Seconds from the start of a raid to dawn. */
	const float RAID_TIME = 600.0;
	/** Seconds between everyone being ready and the raid starting. */
	const float START_TIME = 3.0;
	/** Seconds the results show before the next round's lobby. */
	const float RESULTS_TIME = 10.0;
	/** How bright the lights are in a game: dimmed, so the flashlight matters. */
	const float GAME_LIGHT = 0.35;
	/** The share of a building's loot the truck must hold to clear it. */
	const float QUOTA_SHARE = 0.5;

	/** The loot the truck must hold to clear a level: a share of all there is, in tens. */
	int QuotaFor(TArray<FItemSpawn> Spawns)
	{
		int Total = 0;
		for (const FItemSpawn& Spawn : Spawns)
			Total += Items::Kind(Spawn.Kind).Value;
		return Math::Max(10, Math::RoundToInt(Total * QUOTA_SHARE / 10.0) * 10);
	}

	/** Whether a point is inside a box, on the ground. */
	bool Inside(FBoxXZ Box, float X, float Z)
	{
		return X > Box.MinX && X < Box.MaxX && Z > Box.MinZ && Z < Box.MaxZ;
	}

	FString ModeName(EMode Mode)
	{
		return Mode == EMode::Game ? "game" : "playground";
	}

	FString PhaseName(EPhase Phase)
	{
		switch (Phase)
		{
			case EPhase::Lobby:
				return "lobby";
			case EPhase::Raid:
				return "raid";
			case EPhase::Results:
				return "results";
		}
		return "?";
	}

	FString RoleName(ERole Role)
	{
		switch (Role)
		{
			case ERole::Playing:
				return "playing";
			case ERole::Dead:
				return "dead";
			case ERole::Lost:
				return "lost";
			case ERole::Waiting:
				return "waiting";
		}
		return "?";
	}

	/** Seconds as m:ss. */
	FString Clock(float Seconds)
	{
		const int Whole = Math::CeilToInt(Seconds);
		const int Minutes = Math::IntegerDivisionTrunc(Whole, 60);
		const int Rest = Whole % 60;
		const FString Pad = Rest < 10 ? "0" : "";
		return f"{Minutes}:{Pad}{Rest}";
	}

	FString Money(int Value)
	{
		return f"${Value}";
	}
}
