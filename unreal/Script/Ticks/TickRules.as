// Large ticks, the first building's enemy, in numbers, and the questions about a level that moving
// them asks: shared/ticks.ts. They wait on top of racking in the dark, drop onto whoever walks
// under, hunt across the floor and leap, latch on and drain health until pulled off, and back away
// from a flashlight's beam. What the level answers is UStoreRaidTerrain's (C++), given the level
// here; the ticks are moved by ATickNest on the server and drawn by ATick.

/**
 * What a tick is doing, replicated as ATick.State:
 *
 * - Perched: waiting on top of racking; Wary when a beam has found it there, and it won't drop.
 * - Airborne: dropping, leaping, or thrown off someone.
 * - Wandering: on the floor with nobody to hunt, or with the lights up.
 * - Hunting: after a player; Fleeing: backing away from a light.
 * - Latched: on a player (ATick.Victim), draining their health.
 * - Stunned: on its back for a moment, after being pulled off.
 */
enum ETickState
{
	Perched,
	Wary,
	Airborne,
	Wandering,
	Hunting,
	Fleeing,
	Latched,
	Stunned,
};

/** A place on top of racking for a tick to wait, and the box it's on (an index into the level's boxes), or -1 on the floor. */
struct FPerch
{
	FVector At;
	int Box = -1;
};

namespace TickRules
{
	/** A tick's collision radius and height, in meters. */
	const float RADIUS = 0.3;
	const float HEIGHT = 0.45;

	/** Health a latched tick takes a second: about a quarter of a minute from full to dead. */
	const float BITE = 7;
	/** Meters a second: wandering, hunting and fleeing. Players walk at 5 and run at 7.5. */
	const float WANDER = 0.5;
	const float HUNT = 3.4;
	const float FLEE = 4.2;
	/** How much faster they are at dawn than when the raid starts. */
	const float DAWN = 1.4;
	/** Radians a second they turn at. */
	const float TURN = 7;
	/** How far they sense a player, and how far above or below them that player may be. */
	const float SENSE = 11;
	const float SENSE_HEIGHT = 2.5;
	/** A perched tick drops on a player who comes this near, on the ground, to the foot of its perch. */
	const float DROP_RANGE = 2.2;
	/** On the floor, it leaps at a player this near, and is in the air this long. */
	const float LEAP_RANGE = 2.6;
	const float LEAP_TIME = 0.45;
	/** Seconds before it leaps again. */
	const float LEAP_REST = 2.5;
	/** How near a player's middle it must pass in the air to latch on. */
	const float LATCH = 0.6;
	/** How fast they fall, in meters per second per second: slower than players, to be seen coming. */
	const float GRAVITY = 14;
	/** Seconds on its back after being pulled off. */
	const float STUN = 2.5;
	/** Half the angle of the part of a flashlight's beam that they mind, in radians, and how far. */
	const float BEAM = 0.3;
	const float BEAM_RANGE = 14;
	/** Seconds it stays afraid after the light leaves it. */
	const float AFRAID = 2.5;
	/** Seconds of someone else's beam on a latched tick before it lets go. */
	const float LET_GO = 0.5;
	/** How bright a playground's lights must be (the dimmer) for them not to hunt. */
	const float BRIGHT = 0.5;
	/** How far a player can reach to pull a tick off someone else. */
	const float REACH = 1.5;

	/** How high above a player's feet, and how far in front of them, a latched tick's middle is. */
	const float LATCH_HEIGHT = 1.4;
	const float LATCH_AHEAD = 0.32;

	/** Racking this tall or taller is worth dropping from; perches along a long run are this far apart. */
	const float PERCH_HEIGHT = 1.6;
	const float PERCH_SPACING = 2.6;
	/** How high above its feet a tick's middle is: where light has to reach. */
	const float MIDDLE = 0.2;

	/** Ticks with no racking to wait on start on the ground, this far from the truck and each other. */
	const float GROUND_CLEAR = 20;
	const float GROUND_SPACING = 15;

	/** The level as the C++ terrain takes it: its floors, boxes, and its working fittings' pools of light. */
	void Give(UStoreRaidTerrain Terrain, FLevel Level)
	{
		TArray<FStoreRaidFloor> Floors;
		for (const FFloor& Floor : Level.Floors)
		{
			FStoreRaidFloor Made;
			Made.MinX = Floor.MinX;
			Made.MaxX = Floor.MaxX;
			Made.MinZ = Floor.MinZ;
			Made.MaxZ = Floor.MaxZ;
			Made.Y = Floor.Y;
			Made.Thickness = Floor.Thickness;
			if (Floor.bHasRise)
			{
				Made.RiseHeight = Floor.RiseHeight;
				Made.RiseX = Floor.RiseToward == ESide::E ? 1 : (Floor.RiseToward == ESide::W ? -1 : 0);
				Made.RiseZ = Floor.RiseToward == ESide::N ? 1 : (Floor.RiseToward == ESide::S ? -1 : 0);
			}
			Floors.Add(Made);
		}
		TArray<FStoreRaidBox> Boxes;
		for (const FLevelBox& Box : Level.Boxes)
		{
			FStoreRaidBox Made;
			Made.MinX = Box.MinX;
			Made.MaxX = Box.MaxX;
			Made.MinZ = Box.MinZ;
			Made.MaxZ = Box.MaxZ;
			Made.Y = Box.Y;
			Made.Height = Box.Height;
			// Railings, chain-link and the edge of a pit stop a tick but not a look or a beam.
			Made.bSeeThrough = Box.Kind == ELevelBoxKind::Mesh || Box.Kind == ELevelBoxKind::Rail || Box.Kind == ELevelBoxKind::Pit;
			Boxes.Add(Made);
		}
		TArray<FStoreRaidPool> Pools;
		for (const FLightSpawn& Light : Level.Lights)
		{
			if (Light.State != ELightState::On || Light.Kind == ELightKind::Exit)
				continue;
			FStoreRaidPool Pool;
			Pool.At = FVector(Light.X, Light.Y, Light.Z);
			Pool.Reach = 2.5 + 2 * Math::Min(2.0, Light.Power);
			Pools.Add(Pool);
		}
		Terrain.Build(Floors, Boxes, Pools);
	}

	/**
	 * Everywhere in a level a tick could wait: along the tops of its racking, away from its light
	 * fittings and its truck. The playground has spots on the floor instead.
	 */
	TArray<FPerch> Perches(FLevel Level, UStoreRaidTerrain Terrain, FBoxXZ Dock)
	{
		TArray<FPerch> Found;
		if (Level.Name == "playground")
		{
			// By the concepts, on the floor.
			FPerch A;
			A.At = FVector(11.5, 0, -8);
			Found.Add(A);
			FPerch B;
			B.At = FVector(9.5, 0, -6);
			Found.Add(B);
			return Found;
		}
		for (int Index = 0; Index < Level.Boxes.Num(); Index++)
		{
			const FLevelBox& Box = Level.Boxes[Index];
			if (Box.Kind != ELevelBoxKind::Shelf || Box.Height < PERCH_HEIGHT)
				continue;
			const float Width = Box.MaxX - Box.MinX;
			const float Depth = Box.MaxZ - Box.MinZ;
			const int Count = Math::Max(1, Math::RoundToInt(Math::Max(Width, Depth) / PERCH_SPACING));
			for (int Step = 0; Step < Count; Step++)
			{
				const float T = (Step + 0.5) / Count;
				const float X = Width >= Depth ? Box.MinX + Width * T : (Box.MinX + Box.MaxX) / 2;
				const float Z = Width >= Depth ? (Box.MinZ + Box.MaxZ) / 2 : Box.MinZ + Depth * T;
				const float Y = Box.Y + Box.Height;
				if (Terrain.PoolOver(X, Box.Y, Z) >= 0)
					continue;
				// Room under the floor above, so a tick crouched there stays inside the slab at worst.
				if (Terrain.Headroom(X, Y, Z) < HEIGHT)
					continue;
				if (DistanceToBox(Dock, X, Z) < 6)
					continue;
				FPerch Perch;
				Perch.At = FVector(X, Y, Z);
				Perch.Box = Index;
				Found.Add(Perch);
			}
		}
		return Found.Num() > 0 ? Found : GroundSpots(Level, Terrain, Dock);
	}

	/**
	 * Places on the ground for ticks to start, wandering, in a level without racking to wait on:
	 * spread over its floors, clear of the truck, of fittings' light and of what stands on them.
	 */
	TArray<FPerch> GroundSpots(FLevel Level, UStoreRaidTerrain Terrain, FBoxXZ Dock)
	{
		TArray<FPerch> Found;
		FPerch Furthest;
		float FurthestAway = -1;
		for (const FFloor& Floor : Level.Floors)
		{
			const int Columns = Math::Max(1, Math::RoundToInt((Floor.MaxX - Floor.MinX) / GROUND_SPACING));
			const int Rows = Math::Max(1, Math::RoundToInt((Floor.MaxZ - Floor.MinZ) / GROUND_SPACING));
			for (int Column = 0; Column < Columns; Column++)
			{
				for (int Row = 0; Row < Rows; Row++)
				{
					const float X = Floor.MinX + ((Column + 0.5) / Columns) * (Floor.MaxX - Floor.MinX);
					const float Z = Floor.MinZ + ((Row + 0.5) / Rows) * (Floor.MaxZ - Floor.MinZ);
					const float Y = Terrain.Standing(X, Level::FloorHeight(Floor, X, Z), Z, false);
					if (!Stands(Y))
						continue;
					const float Away = DistanceToBox(Dock, X, Z);
					if (Away > FurthestAway)
					{
						FurthestAway = Away;
						Furthest.At = FVector(X, Y, Z);
					}
					if (Away < GROUND_CLEAR || Terrain.PoolOver(X, Y, Z) >= 0)
						continue;
					bool bCrowded = false;
					for (const FPerch& Spot : Found)
						bCrowded = bCrowded || Math::Sqrt(Math::Square(Spot.At.X - X) + Math::Square(Spot.At.Z - Z)) < GROUND_SPACING;
					if (bCrowded)
						continue;
					FPerch Spot;
					Spot.At = FVector(X, Y, Z);
					Found.Add(Spot);
				}
			}
		}
		if (Found.Num() == 0 && FurthestAway >= 0)
			Found.Add(Furthest);
		return Found;
	}

	/** Whether a height from the terrain's Standing() or GroundUnder() is somewhere to stand. */
	bool Stands(float Y)
	{
		return Y > -1.0e8;
	}

	/** How many ticks a level starts a raid with, of the perches it has. */
	int Count(FLevel Level, int Available)
	{
		if (Level.Name == "playground")
			return Available;
		return Math::Min(Available, Math::Max(4, Math::Min(12, Math::RoundToInt(Available * 0.2))));
	}

	float DistanceToBox(FBoxXZ Box, float X, float Z)
	{
		return Math::Sqrt(Math::Square(Math::Max(Math::Max(Box.MinX - X, 0.0), X - Box.MaxX)) + Math::Square(Math::Max(Math::Max(Box.MinZ - Z, 0.0), Z - Box.MaxZ)));
	}

	/** Whether a point is in the part of a beam (from, unit direction) that ticks mind, walls aside. */
	bool InBeam(FVector From, FVector Direction, FVector Point)
	{
		const FVector Off = Point - From;
		const float Distance = Off.Size();
		if (Distance > BEAM_RANGE)
			return false;
		if (Distance < 0.5)
			return true;
		return Off.DotProduct(Direction) / Distance > Math::Cos(BEAM);
	}
}
