// The shapes a level is made of, as plain data: mirrors the types `LevelBox`, `Floor`, `Ladder`,
// `ItemSpawn` and the function `floorHeight` in shared/level.ts. Game coordinates: meters, x east,
// y up, z north; converted to Unreal's centimeters and Z-up when a level is spawned.
//
// Still to come from shared/level.ts: the `Level` type itself and its levels (the store, generated
// warehouses, the harbour, the village), rooms, props, light fittings and environments. The
// playground's grid is in Playground.as.
//
// The TS types are a Box with more fields (`Box & {...}`, `interface Floor extends Box`); here each
// struct carries the box's four fields itself, so code reads `Floor.MinX` as in TS, and Footprint()
// gives the FBoxXZ.

/**
 * What a level box is. A partition is a wall between rooms, inside a building. Scenery is something
 * a model draws, like the harbour's houses and clutter: the box only stops players. A mesh is
 * see-through, like chain-link: it stops players and things, not light or sound, and nothing draws
 * it as a box.
 */
enum ELevelBoxKind
{
	Wall,
	Partition,
	Shelf,
	Rail,
	Pit,
	Stairs,
	Furniture,
	Scenery,
	Mesh,
};

/**
 * Static level geometry, for collision and for drawing. Boxes are axis-aligned and block from `Y` up
 * to `Y + Height`. Stairs boxes are drawn as part of the stairs' floor, not on their own.
 */
struct FLevelBox
{
	float MinX = 0.0;
	float MaxX = 0.0;
	float MinZ = 0.0;
	float MaxZ = 0.0;
	float Y = 0.0;
	float Height = 0.0;
	ELevelBoxKind Kind = ELevelBoxKind::Wall;

	FBoxXZ Footprint() const
	{
		return Level::MakeBoxXZ(MinX, MaxX, MinZ, MaxZ);
	}
};

namespace Level
{
	FLevelBox MakeLevelBox(FBoxXZ Box, float Y, float Height, ELevelBoxKind Kind)
	{
		FLevelBox Result;
		Result.MinX = Box.MinX;
		Result.MaxX = Box.MaxX;
		Result.MinZ = Box.MinZ;
		Result.MaxZ = Box.MaxZ;
		Result.Y = Y;
		Result.Height = Height;
		Result.Kind = Kind;
		return Result;
	}
}

/**
 * What a floor is. Ground is drawn by a model, like the harbour's paving, so the floor only holds
 * players up.
 */
enum EFloorKind
{
	Floor,
	Plank,
	Stairs,
	Ground,
};

/**
 * Something to walk on: its top is at `Y`, or for stairs a ramp rising `RiseHeight` from `Y` at one
 * side to the other, `RiseToward`. Players stand where their centre is over one, so they fall off
 * the edge of a plank. `Thickness` is how far down it's solid.
 *
 * TS has an optional `rise?: { toward, height }`; here `bHasRise` says whether there is one.
 */
struct FFloor
{
	float MinX = 0.0;
	float MaxX = 0.0;
	float MinZ = 0.0;
	float MaxZ = 0.0;
	float Y = 0.0;
	float Thickness = 0.0;
	EFloorKind Kind = EFloorKind::Floor;
	bool bHasRise = false;
	ESide RiseToward = ESide::N;
	float RiseHeight = 0.0;

	FBoxXZ Footprint() const
	{
		return Level::MakeBoxXZ(MinX, MaxX, MinZ, MaxZ);
	}
};

namespace Level
{
	/** A flat floor over a box. */
	FFloor MakeFloor(FBoxXZ Box, float Y, float Thickness, EFloorKind Kind)
	{
		FFloor Result;
		Result.MinX = Box.MinX;
		Result.MaxX = Box.MaxX;
		Result.MinZ = Box.MinZ;
		Result.MaxZ = Box.MaxZ;
		Result.Y = Y;
		Result.Thickness = Thickness;
		Result.Kind = Kind;
		return Result;
	}
}

/**
 * Where a ladder can be climbed: the strip in front of it, from its foot at `Y` up to the floor it
 * leads to at `Top`. Players climb it by walking `Toward` the wall it's on and go down by backing
 * away.
 */
struct FLadder
{
	float MinX = 0.0;
	float MaxX = 0.0;
	float MinZ = 0.0;
	float MaxZ = 0.0;
	float Y = 0.0;
	float Top = 0.0;
	ESide Toward = ESide::N;

	FBoxXZ Footprint() const
	{
		return Level::MakeBoxXZ(MinX, MaxX, MinZ, MaxZ);
	}
};

namespace Level
{
	/** How high a floor's top is at a point over it. */
	float FloorHeight(FFloor Floor, float X, float Z)
	{
		if (!Floor.bHasRise)
			return Floor.Y;
		float T = 0.0;
		switch (Floor.RiseToward)
		{
			case ESide::N:
				T = Level::FloorAlong(Z, Floor.MinZ, Floor.MaxZ);
				break;
			case ESide::S:
				T = 1.0 - Level::FloorAlong(Z, Floor.MinZ, Floor.MaxZ);
				break;
			case ESide::E:
				T = Level::FloorAlong(X, Floor.MinX, Floor.MaxX);
				break;
			case ESide::W:
				T = 1.0 - Level::FloorAlong(X, Floor.MinX, Floor.MaxX);
				break;
		}
		return Floor.Y + T * Floor.RiseHeight;
	}

	/** How far a value is from min to max, held to 0..1: `along` inside floorHeight in TS. */
	float FloorAlong(float Value, float Min, float Max)
	{
		return Math::Min(1.0, Math::Max(0.0, (Value - Min) / (Max - Min)));
	}
}

/** Where an item starts, just off the ground, so it settles when a room opens. */
struct FItemSpawn
{
	EItemKind Kind = EItemKind::Phone;
	float X = 0.0;
	float Y = 0.0;
	float Z = 0.0;
};

namespace Level
{
	FItemSpawn MakeItemSpawn(EItemKind Kind, float X, float Y, float Z)
	{
		FItemSpawn Spawn;
		Spawn.Kind = Kind;
		Spawn.X = X;
		Spawn.Y = Y;
		Spawn.Z = Z;
		return Spawn;
	}
}
