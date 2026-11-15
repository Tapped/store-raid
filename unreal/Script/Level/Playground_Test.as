// Unit tests for the level data port (Tiles.as, Level.as, Playground.as): the playground composed
// here must match what the web game's composeTiles(PLAYGROUND_GRID) makes. The expected numbers
// come from unreal/Tools/fixtures/playground.json, written by
// `pnpm exec tsx unreal/Tools/dumpPlayground.ts`; run that again and update them here if
// shared/tiles.ts or the grid changes. The small grids' numbers and messages come from running the
// same grids through shared/tiles.ts.

void ExpectLevelBox(FUnitTest& T, FLevelBox Box, float MinX, float MaxX, float MinZ, float MaxZ,
	float Y, float Height, ELevelBoxKind Kind, FString What)
{
	T.AssertAlmostEquals(MinX, Box.MinX, 0.000001, What + " minX");
	T.AssertAlmostEquals(MaxX, Box.MaxX, 0.000001, What + " maxX");
	T.AssertAlmostEquals(MinZ, Box.MinZ, 0.000001, What + " minZ");
	T.AssertAlmostEquals(MaxZ, Box.MaxZ, 0.000001, What + " maxZ");
	T.AssertAlmostEquals(Y, Box.Y, 0.000001, What + " y");
	T.AssertAlmostEquals(Height, Box.Height, 0.000001, What + " height");
	T.AssertTrue(Box.Kind == Kind, What + " kind");
}

void ExpectFloor(FUnitTest& T, FFloor Floor, float MinX, float MaxX, float MinZ, float MaxZ,
	float Y, float Thickness, EFloorKind Kind, FString What)
{
	T.AssertAlmostEquals(MinX, Floor.MinX, 0.000001, What + " minX");
	T.AssertAlmostEquals(MaxX, Floor.MaxX, 0.000001, What + " maxX");
	T.AssertAlmostEquals(MinZ, Floor.MinZ, 0.000001, What + " minZ");
	T.AssertAlmostEquals(MaxZ, Floor.MaxZ, 0.000001, What + " maxZ");
	T.AssertAlmostEquals(Y, Floor.Y, 0.000001, What + " y");
	T.AssertAlmostEquals(Thickness, Floor.Thickness, 0.000001, What + " thickness");
	T.AssertTrue(Floor.Kind == Kind, What + " kind");
}

void Test_PlaygroundComposes(FUnitTest& T)
{
	FComposedTiles Composed = Tiles::ComposeTiles(Playground::Grid());
	T.AssertTrue(Composed.Problem.IsEmpty(), "the playground's tiles fit together: " + Composed.Problem);

	// summary in playground.json
	T.AssertEquals(57, Composed.Floors.Num(), "floors");
	T.AssertEquals(130, Composed.Boxes.Num(), "boxes");
	T.AssertEquals(2, Composed.Ladders.Num(), "ladders");
	T.AssertEquals(1, Composed.Screens.Num(), "screens");

	int FlatFloors = 0;
	int Stairs = 0;
	int Planks = 0;
	for (FFloor Floor : Composed.Floors)
	{
		if (Floor.Kind == EFloorKind::Floor)
			FlatFloors++;
		else if (Floor.Kind == EFloorKind::Stairs)
			Stairs++;
		else if (Floor.Kind == EFloorKind::Plank)
			Planks++;
	}
	T.AssertEquals(51, FlatFloors, "floors of kind floor");
	T.AssertEquals(3, Stairs, "floors of kind stairs");
	T.AssertEquals(3, Planks, "floors of kind plank");

	int Walls = 0;
	int Furniture = 0;
	int StairBoxes = 0;
	int Rails = 0;
	int Pits = 0;
	int Partitions = 0;
	for (FLevelBox Box : Composed.Boxes)
	{
		if (Box.Kind == ELevelBoxKind::Wall)
			Walls++;
		else if (Box.Kind == ELevelBoxKind::Furniture)
			Furniture++;
		else if (Box.Kind == ELevelBoxKind::Stairs)
			StairBoxes++;
		else if (Box.Kind == ELevelBoxKind::Rail)
			Rails++;
		else if (Box.Kind == ELevelBoxKind::Pit)
			Pits++;
		else if (Box.Kind == ELevelBoxKind::Partition)
			Partitions++;
	}
	T.AssertEquals(34, Walls, "boxes of kind wall");
	T.AssertEquals(1, Furniture, "boxes of kind furniture");
	T.AssertEquals(69, StairBoxes, "boxes of kind stairs");
	T.AssertEquals(14, Rails, "boxes of kind rail");
	T.AssertEquals(12, Pits, "boxes of kind pit");
	T.AssertEquals(0, Partitions, "boxes of kind partition");

	if (Composed.Floors.Num() != 57 || Composed.Boxes.Num() != 130 || Composed.Ladders.Num() != 2 || Composed.Screens.Num() != 1)
		return;

	// Floors, in order.
	ExpectFloor(T, Composed.Floors[0], -12, -8, -8, -4, -3, 0.25, EFloorKind::Floor, "floors[0]");
	ExpectFloor(T, Composed.Floors[5], -8, -4, -4, 0, -3, 0.25, EFloorKind::Stairs, "floors[5]");
	T.AssertTrue(Composed.Floors[5].bHasRise && Composed.Floors[5].RiseToward == ESide::N, "floors[5] rises north");
	T.AssertAlmostEquals(3.0, Composed.Floors[5].RiseHeight, 0.000001, "floors[5] rise height");
	ExpectFloor(T, Composed.Floors[26], 9.7, 10.3, -4, 0, 0, 0.08, EFloorKind::Plank, "floors[26]");
	ExpectFloor(T, Composed.Floors[30], -4, 0, 0, 4, 0, 0.25, EFloorKind::Stairs, "floors[30]");
	ExpectFloor(T, Composed.Floors[52], -8, -4, 8, 12, 3, 0.25, EFloorKind::Stairs, "floors[52]");
	T.AssertTrue(Composed.Floors[52].bHasRise && Composed.Floors[52].RiseToward == ESide::W, "floors[52] rises west");
	ExpectFloor(T, Composed.Floors[56], -12, -8, 8, 12, 6, 0.25, EFloorKind::Floor, "floors[56]");
	T.AssertFalse(Composed.Floors[0].bHasRise, "floors[0] is flat");

	// Boxes, in order.
	ExpectLevelBox(T, Composed.Boxes[0], -16, -12, -12, -8, -3, 2.75, ELevelBoxKind::Wall, "boxes[0]");
	ExpectLevelBox(T, Composed.Boxes[9], -10.7, -9.3, -7.85, -7.4, -3, 1.3, ELevelBoxKind::Furniture, "boxes[9]");
	ExpectLevelBox(T, Composed.Boxes[15], -4.06, -4, -4, -3.5, -3, 1.375, ELevelBoxKind::Stairs, "boxes[15]");
	ExpectLevelBox(T, Composed.Boxes[57], 0, 4, -8.06, -8, 0, 1, ELevelBoxKind::Rail, "boxes[57]");
	ExpectLevelBox(T, Composed.Boxes[63], 4, 8, -4.5, -4, -10, 10, ELevelBoxKind::Pit, "boxes[63]");
	ExpectLevelBox(T, Composed.Boxes[129], -12, -8, 8, 8.06, 6, 1, ELevelBoxKind::Rail, "boxes[129]");

	// Ladders: down to the basement, facing east, and up to the mezzanine, facing north.
	FLadder Down = Composed.Ladders[0];
	T.AssertAlmostEquals(3.2, Down.MinX, 0.000001, "ladders[0] minX");
	T.AssertAlmostEquals(4.0, Down.MaxX, 0.000001, "ladders[0] maxX");
	T.AssertAlmostEquals(-6.45, Down.MinZ, 0.000001, "ladders[0] minZ");
	T.AssertAlmostEquals(-5.55, Down.MaxZ, 0.000001, "ladders[0] maxZ");
	T.AssertAlmostEquals(-3.0, Down.Y, 0.000001, "ladders[0] y");
	T.AssertAlmostEquals(0.0, Down.Top, 0.000001, "ladders[0] top");
	T.AssertTrue(Down.Toward == ESide::E, "ladders[0] toward east");
	FLadder Up = Composed.Ladders[1];
	T.AssertAlmostEquals(1.55, Up.MinX, 0.000001, "ladders[1] minX");
	T.AssertAlmostEquals(2.45, Up.MaxX, 0.000001, "ladders[1] maxX");
	T.AssertAlmostEquals(3.2, Up.MinZ, 0.000001, "ladders[1] minZ");
	T.AssertAlmostEquals(4.0, Up.MaxZ, 0.000001, "ladders[1] maxZ");
	T.AssertAlmostEquals(0.0, Up.Y, 0.000001, "ladders[1] y");
	T.AssertAlmostEquals(3.0, Up.Top, 0.000001, "ladders[1] top");
	T.AssertTrue(Up.Toward == ESide::N, "ladders[1] toward north");

	// The TV in the basement, its back to the rock to the south.
	FScreen Screen = Composed.Screens[0];
	T.AssertAlmostEquals(-10.0, Screen.X, 0.000001, "screen x");
	T.AssertAlmostEquals(-3.0, Screen.Y, 0.000001, "screen y");
	T.AssertAlmostEquals(-7.625, Screen.Z, 0.000001, "screen z");
	T.AssertTrue(Screen.Faces == ESide::N, "screen faces north");

	// Up the stairs: halfway along the basement's stairs north, and the top of the mezzanine's west.
	T.AssertAlmostEquals(-1.5, Level::FloorHeight(Composed.Floors[5], -6.0, -2.0), 0.000001, "halfway up floors[5]");
	T.AssertAlmostEquals(6.0, Level::FloorHeight(Composed.Floors[52], -8.0, 10.0), 0.000001, "top of floors[52]");
	T.AssertAlmostEquals(-3.0, Level::FloorHeight(Composed.Floors[0], -10.0, -6.0), 0.000001, "flat floors[0]");
}

/** A storey of one line, for the small grids below. */
FTileGrid OneStoreyGrid(TArray<FString> Lines)
{
	FTileStorey Storey;
	Storey.Lines = Lines;
	FTileGrid Grid;
	Grid.Storeys.Add(Storey);
	return Grid;
}

void Test_TilesThatDontFit(FUnitTest& T)
{
	// Stairs need a well above them, and there's no storey above.
	TArray<FString> Stairs;
	Stairs.Add("F^");
	FString StairsProblem = Tiles::ComposeTiles(OneStoreyGrid(Stairs)).Problem;
	T.AssertTrue(StairsProblem == "stairs at storey 0, column 1, row 0 can't have open above it", StairsProblem);

	TArray<FString> Unknown;
	Unknown.Add("FX");
	FString UnknownProblem = Tiles::ComposeTiles(OneStoreyGrid(Unknown)).Problem;
	T.AssertTrue(UnknownProblem == "Unknown tile \"X\" on storey 0", UnknownProblem);
}

void Test_TilesDrawnWithWalls(FUnitTest& T)
{
	// Two cells in a row, walled round, with a doorway between them.
	TArray<FString> Lines;
	Lines.Add("+-+-+");
	Lines.Add("|FdF|");
	Lines.Add("+-+-+");
	FComposedTiles Composed = Tiles::ComposeTiles(OneStoreyGrid(Lines));
	T.AssertTrue(Composed.Problem.IsEmpty(), "the tiles fit together: " + Composed.Problem);
	T.AssertEquals(2, Composed.Floors.Num(), "floors");
	T.AssertEquals(9, Composed.Boxes.Num(), "boxes");
	if (Composed.Boxes.Num() != 9)
		return;
	ExpectLevelBox(T, Composed.Boxes[0], 0, 4, 3.9, 4.1, 0, 3, ELevelBoxKind::Wall, "boxes[0]");
	ExpectLevelBox(T, Composed.Boxes[1], 3.9, 4.1, 0, 1.3, 0, 3, ELevelBoxKind::Partition, "boxes[1]");
	ExpectLevelBox(T, Composed.Boxes[2], 3.9, 4.1, 2.7, 4, 0, 3, ELevelBoxKind::Partition, "boxes[2]");
	ExpectLevelBox(T, Composed.Boxes[3], 3.9, 4.1, 1.3, 2.7, 2.2, 0.8, ELevelBoxKind::Partition, "boxes[3]");
	ExpectLevelBox(T, Composed.Boxes[4], 0, 4, -0.1, 0.1, 0, 3, ELevelBoxKind::Wall, "boxes[4]");
	ExpectLevelBox(T, Composed.Boxes[5], -0.1, 0.1, 0, 4, 0, 3, ELevelBoxKind::Wall, "boxes[5]");
	ExpectLevelBox(T, Composed.Boxes[8], 4, 8, -0.1, 0.1, 0, 3, ELevelBoxKind::Wall, "boxes[8]");
}
