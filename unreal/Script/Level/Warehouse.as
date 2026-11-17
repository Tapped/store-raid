// A level generated from a seed, put together: mirrors `generatedLevel()` in shared/level.ts. The
// layout and tiles (Generate.as), then what stands in its rooms, the lights and the loot
// (Furnish.as), under a roof. Players come in on the south side, in the loading bay, where the dock
// and the dimmer are.
//
// It stands round the origin unless `bSite` says where its south-west corner is. With `bGate`, the
// loading door in the outer wall is open, for a building with somewhere outside to come in from:
// the same building otherwise.
//
// Still to come from the TS: the `Level` type all levels share, which this will be one of.

/** A generated building: what the server simulates and the client draws for it. */
struct FWarehouse
{
	FString Name;
	/** Why there's none (no level from the seed), or empty. */
	FString Problem;
	/** Width and length of its floor, centred on the origin. */
	float Size = 0.0;
	FTileGrid Grid;
	/** The tiles' floors, boxes, ladders and TVs; `Boxes` below has the tiles' boxes and then the props'. */
	FComposedTiles Tiles;
	TArray<FLevelBox> Boxes;
	/** Players who fall below this die, and things that fall below it go back where they started. */
	float KillY = 0.0;
	/** The dimmer on the wall by the entrance: where, and which way it faces. */
	FVector Dimmer;
	float DimmerTurn = 0.0;
	/** Where finished items go: an item whose centre is in here counts as delivered. */
	FBoxXZ Dock;
	/** The way in and out, in the outer wall. */
	FVector Entrance;
	/** How high its roof is. */
	float Roof = 0.0;
	TArray<FRoom> Rooms;
	TArray<FPropSpawn> Props;
	TArray<FLightSpawn> Lights;
	TArray<FItemSpawn> Items;
	/** How many props were taken away again because they were in the way. */
	int Dropped = 0;
	/** The middle of the entrance's cell, where the spawn points are. */
	float EntranceX = 0.0;
	float EntranceZ = 0.0;

	/** Where the index-th player to join starts: `spawnPoint(index)`. */
	FVector SpawnPoint(int Index) const
	{
		return FVector(EntranceX - 1 + (Index % 3), 0, EntranceZ + 0.5);
	}
};

namespace Warehouse
{
	/** How big generated levels are: a warehouse 56 m by 48 m, on a basement, the ground and two storeys above. */
	FGenerateOptions Size(int Seed)
	{
		FGenerateOptions Options;
		Options.Seed = Seed;
		Options.Cols = 14;
		Options.Rows = 12;
		Options.Storeys = 4;
		Options.Basements = 1;
		return Options;
	}

	FWarehouse Build(int Seed, bool bSite = false, float SiteX = 0.0, float SiteZ = 0.0, bool bGate = false)
	{
		FWarehouse Level;
		FGenerateOptions Options = Size(Seed);
		FGenerated Generated = Generate::Generate(Options);
		Level.Name = f"generated-{Seed}";
		if (!Generated.Problem.IsEmpty())
		{
			Level.Problem = Generated.Problem;
			return Level;
		}
		int Cols = Options.Cols;
		int Rows = Options.Rows;
		float X = bSite ? SiteX : (-Cols * Tiles::CELL) / 2;
		float Z = bSite ? SiteZ : (-Rows * Tiles::CELL) / 2;
		FTileGrid Grid = Generated.Grid;
		Grid.X = X;
		Grid.Z = Z;
		if (bGate)
		{
			// The edge south of the entrance's cell: the last line of the ground storey, as drawn.
			FTileStorey Ground = Grid.Storeys[Options.Basements];
			FString Line = Ground.Lines.Last();
			int At = 2 * Generated.Entrance.Col + 1;
			Ground.Lines[Ground.Lines.Num() - 1] = Line.Left(At) + "g" + Line.RightChop(At + 1);
			Grid.Storeys[Options.Basements] = Ground;
		}
		Level.Grid = Grid;
		Level.Tiles = Tiles::ComposeTiles(Grid);
		if (!Level.Tiles.Problem.IsEmpty())
		{
			Level.Problem = Level.Tiles.Problem;
			return Level;
		}
		float EntranceX = X + (Generated.Entrance.Col + 0.5) * Tiles::CELL;
		float EntranceZ = Z + (Generated.Entrance.Row + 0.5) * Tiles::CELL;
		Level.EntranceX = EntranceX;
		Level.EntranceZ = EntranceZ;
		Level.Dock = Level::MakeBoxXZ(EntranceX - 1.5, EntranceX + 1.5, Z + 0.2, Z + 1.6);
		// Where players start and the dock, and the space round them, are kept clear.
		TArray<FBoxXZ> KeepClear;
		KeepClear.Add(Level::MakeBoxXZ(EntranceX - 2, EntranceX + 2, Z, EntranceZ + 2));
		KeepClear.Add(Level.Dock);
		FFurnished Furnished = Furnish::Furnish(Seed, Generated, Grid, Level.Tiles.Boxes, Reach::MakePoint(0, EntranceX, EntranceZ), KeepClear);
		Level.Size = Math::Max(Cols, Rows) * Tiles::CELL + 2;
		Level.Boxes = Level.Tiles.Boxes;
		Level.Boxes.Append(Furnished.Boxes);
		Level.KillY = -Options.Basements * Tiles::STOREY - 4;
		Level.Dimmer = FVector(EntranceX - 1.2, 1.3, Z + 0.1);
		Level.Entrance = FVector(EntranceX, 2.6, Z);
		Level.Roof = (Options.Storeys - Options.Basements) * Tiles::STOREY;
		Level.Rooms = Furnished.Rooms;
		Level.Props = Furnished.Props;
		Level.Lights = Furnished.Lights;
		Level.Items = Furnished.Items;
		Level.Dropped = Furnished.Dropped;
		return Level;
	}
}
