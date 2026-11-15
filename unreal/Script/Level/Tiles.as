// Levels built from tiles: mirrors shared/tiles.ts, all of it. Game coordinates: meters, x east,
// y up, z north; converted to Unreal's centimeters and Z-up when a level is spawned.
//
// A grid of square cells on storeys stacked one above the other. Each tile is one cell on one
// storey, and the edges between cells can have walls, with or without a doorway, which is how rooms
// are made. `Tiles::ComposeTiles` turns a grid into the floors, boxes, ladders and TVs of a level.
// It's meant to be generated (shared/generate.ts, still to come): each side of a tile has a socket,
// `Tiles::Fits` says which sockets can meet, and `Tiles::FitsAbove` which tiles can stand on which.
//
// How it differs from the TS, where Angelscript makes it:
// - Types are global (FTile, ESide, ...); constants and functions are in the namespace `Tiles`, so
//   names like WALL don't clash with other files (script files all see each other's globals).
// - `Tile` is a tagged union in TS; FTile is its kind plus the fields only some kinds use (Along,
//   Up, From). A tile that isn't there (TS `undefined`, outside the grid) is ETileKind::None.
// - Containers can't nest in script, so a grid's storeys are FTileStorey structs holding lines, and
//   parsed tiles are one flat array (FParsedGrid::Index).
// - Nothing throws: ParseTiles and ComposeTiles put what's wrong in `Problem`, empty when all is well.
//   The messages are word for word those the TS throws.

/** One of a cell's sides, also the way towards it: x is east, z is north. In the TS's order, n e s w. */
enum ESide
{
	N,
	E,
	S,
	W,
};

/** Which way a bridge's plank runs. */
enum ETileAxis
{
	X,
	Z,
};

enum ETileKind
{
	/** No tile: outside the grid, or below its bottom. `undefined` in the TS. */
	None,
	/** Walkable all over. */
	Floor,
	/** A floor with a TV on a cabinet against a wall, showing static and droning. */
	Tv,
	/** Rock, or masonry: filled from its floor to the next. Basements are dug out of it. */
	Solid,
	/** A hole down to PIT_DEPTH, with shafts under it: falling in kills. */
	Pit,
	/** A pit with a plank across it, from one side to the other along `Along`. */
	Bridge,
	/** Stairs up one storey, rising towards `Up`, into a well above. Stairs going down are stairs on the storey below. */
	Stairs,
	/** A floor with a ladder up a wall on side `Up`, into a well above. */
	Ladder,
	/** Nothing: air above a lower storey. */
	Open,
	/** The air above stairs or a ladder, opening onto the floor they arrive on, towards `From`. */
	Well,
	/** The air under a pit, walled in by it, down to the pit's bottom. */
	Shaft,
};

/** One tile: its kind, and the field that kind uses, if any. */
struct FTile
{
	ETileKind Kind = ETileKind::None;
	/** Bridge: which way the plank runs. */
	ETileAxis Along = ETileAxis::X;
	/** Stairs and ladders: the side they go up towards. */
	ESide Up = ESide::N;
	/** Wells: the side they open onto. */
	ESide From = ESide::N;
};

/** What a tile's side offers its neighbour on the same storey. */
enum ESocket
{
	Floor,
	Solid,
	Pit,
	Plank,
	StairsFoot,
	StairsTop,
	StairsSide,
	LadderWall,
	Arrival,
	Open,
};

/**
 * What's on the edge between two cells on a storey: nothing, a wall, a wall with a doorway, a wall
 * with an arch, a wider and higher opening, or a loading door in an outer wall.
 */
enum EEdge
{
	None,
	Wall,
	Door,
	Arch,
	Gate,
};

/** How wide and high the opening in an edge is. */
struct FOpening
{
	float Width = 0.0;
	float Height = 0.0;
};

/** One storey of a grid, as written: a list of rows, the northern row first, as on a map. */
struct FTileStorey
{
	TArray<FString> Lines;
};

/**
 * A grid of tiles: the cell in the south-west corner starts at (X, Z), and each storey is a list of
 * rows, the northern row first, as on a map. The first storey is the deepest: `Basements` storeys
 * lie below the ground, which is storey 0. Storeys above the last given are open air.
 *
 * A storey is written one character per cell, or with its walls drawn in between, every cell
 * surrounded by `+` corners and edges that are `-` or `|` for a wall, `d` for a doorway, `a` for an
 * arch, `g` for a loading door, or a space for nothing. Walls round the outside of such a storey
 * enclose it.
 */
struct FTileGrid
{
	float X = 0.0;
	float Z = 0.0;
	int Basements = 0;
	TArray<FTileStorey> Storeys;
};

/** A grid read into tiles and edges, with wells and shafts worked out. */
struct FParsedGrid
{
	int Cols = 0;
	int Rows = 0;
	int Basements = 0;
	/** How many storeys were given: `tiles.length` in the TS. */
	int Levels = 0;
	/**
	 * Every tile, at Index(storey, col, row); row 0 the southernmost: `tiles` in the TS, renamed so
	 * it doesn't hide the namespace Tiles inside these methods.
	 */
	TArray<FTile> AllTiles;
	/** Each edge that has something on it once, by the cell to its south or west: see EdgeKey. */
	TMap<FString, EEdge> Edges;
	/** Why the grid couldn't be read, or empty. */
	FString Problem;

	/** Where a tile is in AllTiles: `tiles[storey + basements][row][col]` in the TS. */
	int Index(int Storey, int Col, int Row) const
	{
		return ((Storey + Basements) * Rows + Row) * Cols + Col;
	}

	/**
	 * The tile in a cell: None outside the grid's columns and rows or below its bottom, and open air
	 * on storeys above the last given.
	 */
	FTile Tile(int Storey, int Col, int Row) const
	{
		FTile Result;
		if (Col < 0 || Col >= Cols || Row < 0 || Row >= Rows)
			return Result;
		if (Storey < -Basements)
			return Result;
		if (Storey + Basements >= Levels)
			return Tiles::MakeTile(ETileKind::Open);
		return AllTiles[Index(Storey, Col, Row)];
	}

	/** The edge on a side of a cell, which may be on the outside of the grid. */
	EEdge Edge(int Storey, int Col, int Row, ESide Side) const
	{
		EEdge Result = EEdge::None;
		if (Edges.Find(Tiles::EdgeKey(Storey, Col, Row, Side), Result))
			return Result;
		return EEdge::None;
	}
};

/** A TV a tile stands somewhere: the middle of the floor under it, and the side its screen faces. */
struct FScreen
{
	float X = 0.0;
	float Y = 0.0;
	float Z = 0.0;
	ESide Faces = ESide::S;
};

/** What ComposeTiles makes of a grid: `{ floors, boxes, ladders, screens }` in the TS. */
struct FComposedTiles
{
	TArray<FFloor> Floors;
	TArray<FLevelBox> Boxes;
	TArray<FLadder> Ladders;
	TArray<FScreen> Screens;
	/** Why the tiles don't fit together (the TS throws it), or empty. */
	FString Problem;
};

namespace Tiles
{
	/** Cells are this many meters square, and storeys this far apart. */
	const float CELL = 4.0;
	const float STOREY = 3.0;
	/** How far down a pit goes, below its storey. */
	const float PIT_DEPTH = 10.0;
	const float PIT_WALL = 0.5;
	/** Thickness of the ground, of any other floor, and of a plank. */
	const float GROUND = 0.3;
	const float SLAB = 0.25;
	const float PLANK = 0.08;
	const float PLANK_WIDTH = 0.6;
	const float RAIL_HEIGHT = 1.0;
	const float RAIL = 0.06;
	/**
	 * Walls between cells: how thick, and how wide and high a doorway in one is, and an arch: the
	 * wide opening between two big rooms the public walks between.
	 */
	const float WALL = 0.2;
	const float DOOR_WIDTH = 1.4;
	const float DOOR_HEIGHT = 2.2;
	const float ARCH_WIDTH = 3.0;
	const float ARCH_HEIGHT = 2.4;
	/** A loading door in an outer wall, its shutter rolled up: the way in from outside. */
	const float GATE_WIDTH = 3.4;
	const float GATE_HEIGHT = 2.4;
	/** Stairs block in this many slices, each as high as the ramp at its lower end. */
	const int STAIR_SLICES = 8;
	/** A ladder's width, the wall behind it, and how far out from that wall it can be climbed. */
	const float LADDER_WIDTH = 0.7;
	const float LADDER_WALL = 0.1;
	const float LADDER_REACH = 0.7;

	/** The cabinet a TV stands on, and the TV on it: wide, deep and high, in all (SCREEN_CABINET). */
	const float SCREEN_CABINET_WIDTH = 1.4;
	const float SCREEN_CABINET_DEPTH = 0.45;
	const float SCREEN_CABINET_HEIGHT = 0.5;
	const float SCREEN_HEIGHT = 1.3;

	// Sides -----------------------------------------------------------------------------------

	/** The four sides in order, n e s w: `SIDES[Index]`. */
	ESide SideAt(int Index)
	{
		return ESide(Index);
	}

	ESide Opposite(ESide Side)
	{
		switch (Side)
		{
			case ESide::N:
				return ESide::S;
			case ESide::E:
				return ESide::W;
			case ESide::S:
				return ESide::N;
			case ESide::W:
				return ESide::E;
		}
		return ESide::S;
	}

	/** One cell over towards a side, in x: `OFFSET[side][0]`. */
	int OffsetX(ESide Side)
	{
		if (Side == ESide::E)
			return 1;
		if (Side == ESide::W)
			return -1;
		return 0;
	}

	/** One cell over towards a side, in z: `OFFSET[side][1]`. */
	int OffsetZ(ESide Side)
	{
		if (Side == ESide::N)
			return 1;
		if (Side == ESide::S)
			return -1;
		return 0;
	}

	/** The side as the TS writes it, "n", "e", "s" or "w", for messages and keys. */
	FString SideName(ESide Side)
	{
		switch (Side)
		{
			case ESide::N:
				return "n";
			case ESide::E:
				return "e";
			case ESide::S:
				return "s";
			case ESide::W:
				return "w";
		}
		return "";
	}

	// Tiles -----------------------------------------------------------------------------------

	FTile MakeTile(ETileKind Kind)
	{
		FTile Tile;
		Tile.Kind = Kind;
		return Tile;
	}

	FTile MakeBridge(ETileAxis Along)
	{
		FTile Tile;
		Tile.Kind = ETileKind::Bridge;
		Tile.Along = Along;
		return Tile;
	}

	FTile MakeStairs(ESide Up)
	{
		FTile Tile;
		Tile.Kind = ETileKind::Stairs;
		Tile.Up = Up;
		return Tile;
	}

	FTile MakeLadder(ESide Up)
	{
		FTile Tile;
		Tile.Kind = ETileKind::Ladder;
		Tile.Up = Up;
		return Tile;
	}

	FTile MakeWell(ESide From)
	{
		FTile Tile;
		Tile.Kind = ETileKind::Well;
		Tile.From = From;
		return Tile;
	}

	/** The kind as the TS writes it, for messages: "floor", "stairs", "nothing" for None. */
	FString KindName(ETileKind Kind)
	{
		switch (Kind)
		{
			case ETileKind::None:
				return "nothing";
			case ETileKind::Floor:
				return "floor";
			case ETileKind::Tv:
				return "tv";
			case ETileKind::Solid:
				return "solid";
			case ETileKind::Pit:
				return "pit";
			case ETileKind::Bridge:
				return "bridge";
			case ETileKind::Stairs:
				return "stairs";
			case ETileKind::Ladder:
				return "ladder";
			case ETileKind::Open:
				return "open";
			case ETileKind::Well:
				return "well";
			case ETileKind::Shaft:
				return "shaft";
		}
		return "";
	}

	/**
	 * How each tile is written in a grid: TILE_CHARS. Wells and shafts are written as open air, ".";
	 * which they are follows from what's above and below. False for a character that's no tile.
	 */
	bool TileFromChar(FString Char, FTile&out Tile)
	{
		if (Char == "F")
			Tile = MakeTile(ETileKind::Floor);
		else if (Char == "T")
			Tile = MakeTile(ETileKind::Tv);
		else if (Char == "#")
			Tile = MakeTile(ETileKind::Solid);
		else if (Char == "P")
			Tile = MakeTile(ETileKind::Pit);
		else if (Char == "|")
			Tile = MakeBridge(ETileAxis::Z);
		else if (Char == "=")
			Tile = MakeBridge(ETileAxis::X);
		else if (Char == "^")
			Tile = MakeStairs(ESide::N);
		else if (Char == ">")
			Tile = MakeStairs(ESide::E);
		else if (Char == "v")
			Tile = MakeStairs(ESide::S);
		else if (Char == "<")
			Tile = MakeStairs(ESide::W);
		else if (Char == "n")
			Tile = MakeLadder(ESide::N);
		else if (Char == "e")
			Tile = MakeLadder(ESide::E);
		else if (Char == "s")
			Tile = MakeLadder(ESide::S);
		else if (Char == "w")
			Tile = MakeLadder(ESide::W);
		else if (Char == ".")
			Tile = MakeTile(ETileKind::Open);
		else
		{
			Tile = MakeTile(ETileKind::None);
			return false;
		}
		return true;
	}

	/** The character a tile is written as; empty for None, which the TS would throw on. */
	FString TileChar(FTile Tile)
	{
		switch (Tile.Kind)
		{
			case ETileKind::Floor:
				return "F";
			case ETileKind::Tv:
				return "T";
			case ETileKind::Solid:
				return "#";
			case ETileKind::Pit:
				return "P";
			case ETileKind::Bridge:
				if (Tile.Along == ETileAxis::Z)
					return "|";
				return "=";
			case ETileKind::Stairs:
				switch (Tile.Up)
				{
					case ESide::N:
						return "^";
					case ESide::E:
						return ">";
					case ESide::S:
						return "v";
					case ESide::W:
						return "<";
				}
				return "";
			case ETileKind::Ladder:
				return SideName(Tile.Up);
			case ETileKind::Open:
			case ETileKind::Well:
			case ETileKind::Shaft:
				return ".";
			case ETileKind::None:
				return "";
		}
		return "";
	}

	// Sockets ---------------------------------------------------------------------------------

	/** What a tile's side offers its neighbour on the same storey. */
	ESocket Socket(FTile Tile, ESide Side)
	{
		switch (Tile.Kind)
		{
			case ETileKind::Floor:
			case ETileKind::Tv:
				return ESocket::Floor;
			case ETileKind::Solid:
			case ETileKind::Shaft:
				return ESocket::Solid;
			case ETileKind::Pit:
				return ESocket::Pit;
			case ETileKind::Open:
				return ESocket::Open;
			case ETileKind::Bridge:
			{
				bool bAlongZ = Tile.Along == ETileAxis::Z;
				bool bNorthSouth = Side == ESide::N || Side == ESide::S;
				return bAlongZ == bNorthSouth ? ESocket::Plank : ESocket::Pit;
			}
			case ETileKind::Stairs:
				if (Side == Tile.Up)
					return ESocket::StairsTop;
				return Side == Opposite(Tile.Up) ? ESocket::StairsFoot : ESocket::StairsSide;
			case ETileKind::Ladder:
				return Side == Tile.Up ? ESocket::LadderWall : ESocket::Floor;
			case ETileKind::Well:
				return Side == Tile.From ? ESocket::Arrival : ESocket::Open;
			case ETileKind::None:
				break;
		}
		// The TS never asks for a missing tile's socket; open air is the harmless answer.
		return ESocket::Open;
	}

	/** A socket as one bit, to keep sets of them in an int. */
	int Bit(ESocket Socket)
	{
		return 1 << int(Socket);
	}

	/**
	 * Which sockets can meet a socket, either way round: FITS. Floors get a railing where they meet
	 * open air, and anything can back onto solid rock but what must lead on: a plank, the foot of
	 * the stairs, and where stairs or a ladder arrive.
	 */
	int FitsWith(ESocket Socket)
	{
		switch (Socket)
		{
			case ESocket::Floor:
				return Bit(ESocket::Floor) | Bit(ESocket::Solid) | Bit(ESocket::Pit) | Bit(ESocket::Plank)
					| Bit(ESocket::StairsFoot) | Bit(ESocket::StairsTop) | Bit(ESocket::StairsSide)
					| Bit(ESocket::LadderWall) | Bit(ESocket::Arrival) | Bit(ESocket::Open);
			case ESocket::Solid:
				return Bit(ESocket::Floor) | Bit(ESocket::Solid) | Bit(ESocket::Pit) | Bit(ESocket::StairsTop)
					| Bit(ESocket::StairsSide) | Bit(ESocket::LadderWall) | Bit(ESocket::Open);
			case ESocket::Pit:
				return Bit(ESocket::Floor) | Bit(ESocket::Solid) | Bit(ESocket::Pit) | Bit(ESocket::StairsSide)
					| Bit(ESocket::StairsTop) | Bit(ESocket::LadderWall);
			case ESocket::Plank:
				return Bit(ESocket::Floor) | Bit(ESocket::Plank);
			case ESocket::StairsFoot:
				return Bit(ESocket::Floor);
			case ESocket::StairsTop:
				return Bit(ESocket::Floor) | Bit(ESocket::Solid) | Bit(ESocket::Pit) | Bit(ESocket::StairsSide)
					| Bit(ESocket::LadderWall) | Bit(ESocket::Open);
			case ESocket::StairsSide:
				return Bit(ESocket::Floor) | Bit(ESocket::Solid) | Bit(ESocket::Pit) | Bit(ESocket::StairsSide)
					| Bit(ESocket::StairsTop) | Bit(ESocket::LadderWall) | Bit(ESocket::Open);
			case ESocket::LadderWall:
				return Bit(ESocket::Floor) | Bit(ESocket::Solid) | Bit(ESocket::Pit) | Bit(ESocket::StairsSide)
					| Bit(ESocket::StairsTop) | Bit(ESocket::LadderWall) | Bit(ESocket::Open);
			case ESocket::Arrival:
				return Bit(ESocket::Floor);
			case ESocket::Open:
				return Bit(ESocket::Floor) | Bit(ESocket::Solid) | Bit(ESocket::StairsSide) | Bit(ESocket::StairsTop)
					| Bit(ESocket::LadderWall) | Bit(ESocket::Open);
		}
		return 0;
	}

	bool Fits(ESocket A, ESocket B)
	{
		return (FitsWith(A) & Bit(B)) != 0;
	}

	/** Sockets that can be walked through, so a doorway can open onto them: PASSABLE. */
	bool IsPassable(ESocket Socket)
	{
		return Socket == ESocket::Floor || Socket == ESocket::Plank || Socket == ESocket::StairsFoot
			|| Socket == ESocket::Arrival;
	}

	/** Sockets a wall can't close off: MUST_LEAD_ON. */
	bool MustLeadOn(ESocket Socket)
	{
		return Socket == ESocket::Plank || Socket == ESocket::StairsFoot || Socket == ESocket::Arrival;
	}

	/** Whether a tile has a hole down through it: a pit, a bridge's pit, or a shaft. */
	bool IsHoled(FTile Tile)
	{
		return Tile.Kind == ETileKind::Pit || Tile.Kind == ETileKind::Bridge || Tile.Kind == ETileKind::Shaft;
	}

	/**
	 * Whether `Upper` can stand right on top of `Lower`: stairs and ladders lead into a well, and pits
	 * go down through shafts. Outside the grid (None), above is open air and below is nothing.
	 */
	bool FitsAbove(FTile Lower, FTile Upper)
	{
		bool bClimbs = Lower.Kind == ETileKind::Stairs || Lower.Kind == ETileKind::Ladder;
		if (bClimbs)
			return Upper.Kind == ETileKind::Well && Upper.From == Lower.Up;
		if (Upper.Kind == ETileKind::Well)
			return false;
		bool bHoled = IsHoled(Upper);
		if (Lower.Kind == ETileKind::Shaft)
			return bHoled;
		// A hole only goes down through shafts, to the bottom of the grid.
		if (bHoled)
			return Lower.Kind == ETileKind::None;
		// Nothing below: only what holds itself up, or the bottom of a pit.
		if (Lower.Kind == ETileKind::None)
			return Upper.Kind != ETileKind::Open;
		return true;
	}

	// Edges -----------------------------------------------------------------------------------

	/** Whether an edge can be walked through: a doorway, an arch or a loading door. */
	bool IsOpening(EEdge Edge)
	{
		return Edge == EEdge::Door || Edge == EEdge::Arch || Edge == EEdge::Gate;
	}

	/** How wide and high the opening in an edge is; false for a plain wall or none. */
	bool OpeningOf(EEdge Edge, FOpening&out Opening)
	{
		if (Edge == EEdge::Door)
		{
			Opening.Width = DOOR_WIDTH;
			Opening.Height = DOOR_HEIGHT;
			return true;
		}
		if (Edge == EEdge::Arch)
		{
			Opening.Width = ARCH_WIDTH;
			Opening.Height = ARCH_HEIGHT;
			return true;
		}
		if (Edge == EEdge::Gate)
		{
			Opening.Width = GATE_WIDTH;
			Opening.Height = GATE_HEIGHT;
			return true;
		}
		Opening.Width = 0.0;
		Opening.Height = 0.0;
		return false;
	}

	/** Each edge once, by the cell to its south or west. */
	FString EdgeKey(int Storey, int Col, int Row, ESide Side)
	{
		if (Side == ESide::S)
			return f"{Storey},{Col},{Row - 1},n";
		if (Side == ESide::W)
			return f"{Storey},{Col - 1},{Row},e";
		return f"{Storey},{Col},{Row},{SideName(Side)}";
	}

	/** The edge a drawn character stands for: `-` or `|` a wall, `d` a door, `a` an arch, `g` a gate. */
	EEdge EdgeFromChar(FString Char)
	{
		if (Char == "d")
			return EEdge::Door;
		if (Char == "a")
			return EEdge::Arch;
		if (Char == "g")
			return EEdge::Gate;
		if (Char == "-" || Char == "|")
			return EEdge::Wall;
		return EEdge::None;
	}

	// Parsing ---------------------------------------------------------------------------------

	/** Whether a storey is drawn with its walls: its first line starts with a corner. */
	bool IsDrawn(FTileStorey Storey)
	{
		return Storey.Lines.Num() > 0 && Storey.Lines[0].StartsWith("+");
	}

	/** One character of a line, or empty past its end (`line[index]` undefined in the TS). */
	FString CharAt(FString Line, int Index)
	{
		if (Index < 0 || Index >= Line.Len())
			return "";
		return Line.Mid(Index, 1);
	}

	/** Marks an edge read from a drawn storey, if it has anything on it. */
	void MarkEdge(FParsedGrid& Grid, int Storey, int Col, int Row, ESide Side, FString Char)
	{
		EEdge Edge = EdgeFromChar(Char);
		if (Edge != EEdge::None)
			Grid.Edges.Add(EdgeKey(Storey, Col, Row, Side), Edge);
	}

	/** Reads a grid into tiles and edges, and works out wells and shafts. */
	FParsedGrid ParseTiles(FTileGrid Grid)
	{
		FParsedGrid Parsed;
		int Basements = Grid.Basements;
		Parsed.Basements = Basements;
		Parsed.Levels = Grid.Storeys.Num();
		if (Basements < 0 || Basements >= Grid.Storeys.Num() || Grid.Storeys[Basements].Lines.Num() == 0)
		{
			Parsed.Problem = "The grid has no ground storey";
			return Parsed;
		}
		FTileStorey Ground = Grid.Storeys[Basements];
		bool bGroundDrawn = IsDrawn(Ground);
		int Rows = bGroundDrawn ? Math::IntegerDivisionTrunc(Ground.Lines.Num() - 1, 2) : Ground.Lines.Num();
		int Cols = bGroundDrawn ? Math::IntegerDivisionTrunc(Ground.Lines[0].Len() - 1, 2) : Ground.Lines[0].Len();
		Parsed.Rows = Rows;
		Parsed.Cols = Cols;
		Parsed.AllTiles.SetNum(Parsed.Levels * Rows * Cols);

		for (int Level = 0; Level < Parsed.Levels; Level++)
		{
			int Storey = Level - Basements;
			FTileStorey Written = Grid.Storeys[Level];
			bool bDrawn = IsDrawn(Written);
			for (int Row = 0; Row < Rows; Row++)
			{
				for (int Col = 0; Col < Cols; Col++)
				{
					int Index = Parsed.Index(Storey, Col, Row);
					int LineIndex = bDrawn ? 2 * (Rows - 1 - Row) + 1 : Rows - 1 - Row;
					if (LineIndex >= Written.Lines.Num())
					{
						Parsed.AllTiles[Index] = MakeTile(ETileKind::Open);
						continue;
					}
					FString Line = Written.Lines[LineIndex];
					FString Char = CharAt(Line, bDrawn ? 2 * Col + 1 : Col);
					if (bDrawn)
					{
						int AboveIndex = 2 * (Rows - 1 - Row);
						int BelowIndex = 2 * (Rows - 1 - Row) + 2;
						FString Above;
						if (AboveIndex < Written.Lines.Num())
							Above = CharAt(Written.Lines[AboveIndex], 2 * Col + 1);
						FString Below;
						if (BelowIndex < Written.Lines.Num())
							Below = CharAt(Written.Lines[BelowIndex], 2 * Col + 1);
						MarkEdge(Parsed, Storey, Col, Row, ESide::N, Above);
						MarkEdge(Parsed, Storey, Col, Row, ESide::S, Below);
						MarkEdge(Parsed, Storey, Col, Row, ESide::W, CharAt(Line, 2 * Col));
						MarkEdge(Parsed, Storey, Col, Row, ESide::E, CharAt(Line, 2 * Col + 2));
					}
					if (Char.IsEmpty())
						Char = ".";
					FTile Tile;
					if (!TileFromChar(Char, Tile))
					{
						Parsed.Problem = "Unknown tile \"" + Char + "\" on storey " + Storey;
						return Parsed;
					}
					Parsed.AllTiles[Index] = Tile;
				}
			}
		}

		// Open air above stairs or a ladder is its well; under a pit, a shaft.
		for (int Storey = Parsed.Levels - 1 - Basements; Storey >= -Basements; Storey--)
		{
			for (int Row = 0; Row < Rows; Row++)
			{
				for (int Col = 0; Col < Cols; Col++)
				{
					int Index = Parsed.Index(Storey, Col, Row);
					if (Parsed.AllTiles[Index].Kind != ETileKind::Open)
						continue;
					// `at()` in the TS: undefined outside the storeys given, unlike Tile().
					FTile Below;
					if (Storey - 1 >= -Basements)
						Below = Parsed.AllTiles[Parsed.Index(Storey - 1, Col, Row)];
					FTile Above;
					if (Storey + 1 + Basements < Parsed.Levels)
						Above = Parsed.AllTiles[Parsed.Index(Storey + 1, Col, Row)];
					if (Below.Kind == ETileKind::Stairs || Below.Kind == ETileKind::Ladder)
						Parsed.AllTiles[Index] = MakeWell(Below.Up);
					else if (IsHoled(Above))
						Parsed.AllTiles[Index] = MakeTile(ETileKind::Shaft);
				}
			}
		}
		return Parsed;
	}

	/** Why a grid's tiles don't fit together, or empty if they do. */
	FString CheckTiles(FParsedGrid Grid)
	{
		for (int Storey = -Grid.Basements; Storey < Grid.Levels - Grid.Basements; Storey++)
		{
			for (int Row = 0; Row < Grid.Rows; Row++)
			{
				for (int Col = 0; Col < Grid.Cols; Col++)
				{
					FTile Tile = Grid.Tile(Storey, Col, Row);
					FString Where = f"{KindName(Tile.Kind)} at storey {Storey}, column {Col}, row {Row}";
					FTile Under = Grid.Tile(Storey - 1, Col, Row);
					if (!FitsAbove(Under, Tile))
						return f"{Where} can't stand on {KindName(Under.Kind)}";
					FTile Above = Grid.Tile(Storey + 1, Col, Row);
					if (Above.Kind == ETileKind::None)
						Above = MakeTile(ETileKind::Open);
					if (!FitsAbove(Tile, Above))
						return f"{Where} can't have {KindName(Above.Kind)} above it";
					for (int SideIndex = 0; SideIndex < 4; SideIndex++)
					{
						ESide Side = SideAt(SideIndex);
						ESocket Mine = Socket(Tile, Side);
						EEdge Edge = Grid.Edge(Storey, Col, Row, Side);
						FTile Next = Grid.Tile(Storey, Col + OffsetX(Side), Row + OffsetZ(Side));
						if (Edge == EEdge::Wall && MustLeadOn(Mine))
							return f"{Where}: a wall closes off its {SideName(Side)} side";
						if (IsOpening(Edge) && !IsPassable(Mine))
							return f"{Where}: a doorway on its {SideName(Side)} side leads nowhere";
						// Across a wall, anything goes but what must lead on.
						if (Next.Kind == ETileKind::None || Edge == EEdge::Wall)
							continue;
						ESocket Theirs = Socket(Next, Opposite(Side));
						if (!Fits(Mine, Theirs))
							return f"{Where}: its {SideName(Side)} side can't meet {KindName(Next.Kind)}";
					}
				}
			}
		}
		return "";
	}

	// Composing -------------------------------------------------------------------------------

	/**
	 * The floors, boxes, ladders and TVs of a grid of tiles. If the tiles don't fit together, the
	 * result is empty but for `Problem`, which says why (the TS throws).
	 */
	FComposedTiles ComposeTiles(FTileGrid Source)
	{
		FComposedTiles Result;
		FParsedGrid Grid = ParseTiles(Source);
		if (!Grid.Problem.IsEmpty())
		{
			Result.Problem = Grid.Problem;
			return Result;
		}
		FString Problem = CheckTiles(Grid);
		if (!Problem.IsEmpty())
		{
			Result.Problem = Problem;
			return Result;
		}

		for (int Storey = -Grid.Basements; Storey < Grid.Levels - Grid.Basements; Storey++)
		{
			for (int Row = 0; Row < Grid.Rows; Row++)
			{
				for (int Col = 0; Col < Grid.Cols; Col++)
				{
					FTile Tile = Grid.Tile(Storey, Col, Row);
					FBoxXZ Cell = Level::MakeBoxXZ(
						Source.X + Col * CELL,
						Source.X + (Col + 1) * CELL,
						Source.Z + Row * CELL,
						Source.Z + (Row + 1) * CELL);
					float Base = Storey * STOREY;
					float Thickness = Storey == 0 ? GROUND : SLAB;
					// Up to the underside of whatever floor is above, or on the top storey right up to
					// the roof, which a hall puts there, with no floor above to fill the gap.
					bool bTop = Storey == Grid.Levels - Grid.Basements - 1;
					float Ceiling = bTop ? STOREY : STOREY - SLAB;

					// Walls on the north and east edges, and the south and west ones on the grid's
					// edge, so each edge is built once.
					for (int SideIndex = 0; SideIndex < 4; SideIndex++)
					{
						ESide Side = SideAt(SideIndex);
						FTile Next = Grid.Tile(Storey, Col + OffsetX(Side), Row + OffsetZ(Side));
						bool bOuter = Next.Kind == ETileKind::None;
						if (!bOuter && (Side == ESide::S || Side == ESide::W))
							continue;
						EEdge Edge = Grid.Edge(Storey, Col, Row, Side);
						// Brick round the outside, plaster between rooms.
						ELevelBoxKind Kind = bOuter ? ELevelBoxKind::Wall : ELevelBoxKind::Partition;
						if (Edge != EEdge::None)
						{
							FOpening Opening;
							bool bOpening = OpeningOf(Edge, Opening);
							WallBoxes(Result.Boxes, Cell, Side, Base, Ceiling, bOpening, Opening, Kind);
						}
					}

					switch (Tile.Kind)
					{
						case ETileKind::Floor:
						case ETileKind::Tv:
						case ETileKind::Ladder:
						{
							Result.Floors.Add(Level::MakeFloor(Cell, Base, Thickness, EFloorKind::Floor));
							// A railing where it meets open air, unless a wall is there already.
							for (int SideIndex = 0; SideIndex < 4; SideIndex++)
							{
								ESide Side = SideAt(SideIndex);
								FTile Next = Grid.Tile(Storey, Col + OffsetX(Side), Row + OffsetZ(Side));
								if (Next.Kind == ETileKind::None || Socket(Next, Opposite(Side)) != ESocket::Open)
									continue;
								if (Grid.Edge(Storey, Col, Row, Side) != EEdge::None)
									continue;
								Result.Boxes.Add(Level::MakeLevelBox(EdgeStrip(Cell, Side, RAIL), Base, RAIL_HEIGHT, ELevelBoxKind::Rail));
							}
							if (Tile.Kind == ETileKind::Floor)
								break;
							if (Tile.Kind == ETileKind::Tv)
							{
								// Its back to the first side with a wall, or rock, behind it.
								bool bWalled = false;
								ESide Back = ESide::N;
								for (int SideIndex = 0; SideIndex < 4; SideIndex++)
								{
									ESide Side = SideAt(SideIndex);
									FTile Next = Grid.Tile(Storey, Col + OffsetX(Side), Row + OffsetZ(Side));
									if (Next.Kind == ETileKind::None || Next.Kind == ETileKind::Solid
										|| Grid.Edge(Storey, Col, Row, Side) == EEdge::Wall)
									{
										bWalled = true;
										Back = Side;
										break;
									}
								}
								FScreen Screen = PlaceScreen(Cell, Base, bWalled, Back);
								Result.Screens.Add(Screen);
								Result.Boxes.Add(Level::MakeLevelBox(ScreenFootprint(Screen), Base, SCREEN_HEIGHT, ELevelBoxKind::Furniture));
								break;
							}
							// The wall it stands against, up to the floor it leads to: climbers press
							// against it.
							FBoxXZ Wall = EdgeStrip(Cell, Tile.Up, LADDER_WALL);
							Result.Boxes.Add(Level::MakeLevelBox(Wall, Base, STOREY, ELevelBoxKind::Wall));
							// Where it can be climbed: in front of it, as wide as it is and a little more.
							float Across = LADDER_WIDTH / 2.0 + 0.1;
							FBoxXZ Reach = EdgeStrip(Cell, Tile.Up, LADDER_WALL + LADDER_REACH);
							if (OffsetX(Tile.Up) != 0)
							{
								Reach.MinZ = Cell.CentreZ() - Across;
								Reach.MaxZ = Cell.CentreZ() + Across;
							}
							else
							{
								Reach.MinX = Cell.CentreX() - Across;
								Reach.MaxX = Cell.CentreX() + Across;
							}
							FLadder Ladder;
							Ladder.MinX = Reach.MinX;
							Ladder.MaxX = Reach.MaxX;
							Ladder.MinZ = Reach.MinZ;
							Ladder.MaxZ = Reach.MaxZ;
							Ladder.Y = Base;
							Ladder.Top = Base + STOREY;
							Ladder.Toward = Tile.Up;
							Result.Ladders.Add(Ladder);
							break;
						}
						case ETileKind::Solid:
							Result.Boxes.Add(Level::MakeLevelBox(Cell, Base, Ceiling, ELevelBoxKind::Wall));
							break;
						case ETileKind::Pit:
						case ETileKind::Bridge:
						{
							// Walls round the hole, under the floors next to it, so nobody walks under them.
							for (int SideIndex = 0; SideIndex < 4; SideIndex++)
							{
								ESide Side = SideAt(SideIndex);
								FTile Next = Grid.Tile(Storey, Col + OffsetX(Side), Row + OffsetZ(Side));
								if (Next.Kind == ETileKind::Pit || Next.Kind == ETileKind::Bridge)
									continue;
								FBoxXZ PitWall = Outside(Cell, Side, PIT_WALL);
								Result.Boxes.Add(Level::MakeLevelBox(PitWall, Base - PIT_DEPTH, PIT_DEPTH, ELevelBoxKind::Pit));
							}
							if (Tile.Kind == ETileKind::Bridge)
							{
								bool bAlongZ = Tile.Along == ETileAxis::Z;
								float Middle = bAlongZ ? Cell.CentreX() : Cell.CentreZ();
								FBoxXZ Plank = Cell;
								if (bAlongZ)
								{
									Plank.MinX = Middle - PLANK_WIDTH / 2.0;
									Plank.MaxX = Middle + PLANK_WIDTH / 2.0;
								}
								else
								{
									Plank.MinZ = Middle - PLANK_WIDTH / 2.0;
									Plank.MaxZ = Middle + PLANK_WIDTH / 2.0;
								}
								Result.Floors.Add(Level::MakeFloor(Plank, Base, PLANK, EFloorKind::Plank));
							}
							break;
						}
						case ETileKind::Stairs:
						{
							FFloor Stairs = Level::MakeFloor(Cell, Base, SLAB, EFloorKind::Stairs);
							Stairs.bHasRise = true;
							Stairs.RiseToward = Tile.Up;
							Stairs.RiseHeight = STOREY;
							Result.Floors.Add(Stairs);
							// Solid underneath, in slices that each reach the ramp's lower end, so
							// nobody walks into it from below but they can walk up it.
							for (int I = 0; I < STAIR_SLICES; I++)
							{
								FBoxXZ Slice = SliceOf(Cell, Tile.Up, float(I) / STAIR_SLICES, float(I + 1) / STAIR_SLICES);
								if (I > 0)
								{
									float SliceHeight = (STOREY * I) / STAIR_SLICES;
									Result.Boxes.Add(Level::MakeLevelBox(Slice, Base, SliceHeight, ELevelBoxKind::Stairs));
								}
								// Railings up both sides, reaching above the ramp at the slice's upper end.
								float Height = (STOREY * (I + 1)) / STAIR_SLICES + RAIL_HEIGHT;
								for (int SideIndex = 0; SideIndex < 4; SideIndex++)
								{
									ESide Side = SideAt(SideIndex);
									if (Side == Tile.Up || Side == Opposite(Tile.Up))
										continue;
									Result.Boxes.Add(Level::MakeLevelBox(EdgeStrip(Slice, Side, RAIL), Base, Height, ELevelBoxKind::Stairs));
								}
							}
							break;
						}
						case ETileKind::Open:
						case ETileKind::Well:
						case ETileKind::Shaft:
						case ETileKind::None:
							break;
					}
				}
			}
		}
		return Result;
	}

	/**
	 * Where a TV stands in its cell: its back to the side found walled (a wall, or rock, behind it),
	 * facing away; with none, in the middle, facing south. Never against a doorway. The TS takes a
	 * `walled(side)` callback and finds the first walled side itself; ComposeTiles does that here.
	 */
	FScreen PlaceScreen(FBoxXZ Cell, float Y, bool bWalled, ESide Back)
	{
		FScreen Screen;
		Screen.X = Cell.CentreX();
		Screen.Y = Y;
		Screen.Z = Cell.CentreZ();
		if (!bWalled)
		{
			Screen.Faces = ESide::S;
			return Screen;
		}
		float Away = CELL / 2.0 - WALL / 2.0 - SCREEN_CABINET_DEPTH / 2.0 - 0.05;
		Screen.X = Cell.CentreX() + OffsetX(Back) * Away;
		Screen.Z = Cell.CentreZ() + OffsetZ(Back) * Away;
		Screen.Faces = Opposite(Back);
		return Screen;
	}

	/** The ground a TV's cabinet stands on. */
	FBoxXZ ScreenFootprint(FScreen Screen)
	{
		bool bAlongX = Screen.Faces == ESide::N || Screen.Faces == ESide::S;
		float HalfX = bAlongX ? SCREEN_CABINET_WIDTH / 2.0 : SCREEN_CABINET_DEPTH / 2.0;
		float HalfZ = bAlongX ? SCREEN_CABINET_DEPTH / 2.0 : SCREEN_CABINET_WIDTH / 2.0;
		return Level::MakeBoxXZ(Screen.X - HalfX, Screen.X + HalfX, Screen.Z - HalfZ, Screen.Z + HalfZ);
	}

	/**
	 * A wall along one side of a cell, astride the edge, with an opening in the middle if asked:
	 * adds its boxes to `Boxes` (the TS returns them).
	 */
	void WallBoxes(TArray<FLevelBox>& Boxes, FBoxXZ Cell, ESide Side, float Y, float Height,
		bool bOpening, FOpening Opening, ELevelBoxKind Kind)
	{
		bool bAlongX = Side == ESide::N || Side == ESide::S;
		float Line = 0.0;
		switch (Side)
		{
			case ESide::N:
				Line = Cell.MaxZ;
				break;
			case ESide::S:
				Line = Cell.MinZ;
				break;
			case ESide::E:
				Line = Cell.MaxX;
				break;
			case ESide::W:
				Line = Cell.MinX;
				break;
		}
		float Start = bAlongX ? Cell.MinX : Cell.MinZ;
		float End = bAlongX ? Cell.MaxX : Cell.MaxZ;
		if (!bOpening)
		{
			Boxes.Add(WallSpan(bAlongX, Line, Start, End, Y, Y + Height, Kind));
			return;
		}
		float Middle = (Start + End) / 2.0;
		float Half = Opening.Width / 2.0;
		Boxes.Add(WallSpan(bAlongX, Line, Start, Middle - Half, Y, Y + Height, Kind));
		Boxes.Add(WallSpan(bAlongX, Line, Middle + Half, End, Y, Y + Height, Kind));
		// Over the opening, out of everyone's way.
		Boxes.Add(WallSpan(bAlongX, Line, Middle - Half, Middle + Half, Y + Opening.Height, Y + Height, Kind));
	}

	/** A stretch of wall on a line, from one point along it to another: `span` in wallBoxes. */
	FLevelBox WallSpan(bool bAlongX, float Line, float From, float To, float Bottom, float Top, ELevelBoxKind Kind)
	{
		FBoxXZ Box = bAlongX
			? Level::MakeBoxXZ(From, To, Line - WALL / 2.0, Line + WALL / 2.0)
			: Level::MakeBoxXZ(Line - WALL / 2.0, Line + WALL / 2.0, From, To);
		return Level::MakeLevelBox(Box, Bottom, Top - Bottom, Kind);
	}

	/** The strip of a box this thick along one of its sides, inside it: `edge()` in the TS. */
	FBoxXZ EdgeStrip(FBoxXZ Box, ESide Side, float Thickness)
	{
		FBoxXZ Result = Box;
		switch (Side)
		{
			case ESide::N:
				Result.MinZ = Box.MaxZ - Thickness;
				break;
			case ESide::S:
				Result.MaxZ = Box.MinZ + Thickness;
				break;
			case ESide::E:
				Result.MinX = Box.MaxX - Thickness;
				break;
			case ESide::W:
				Result.MaxX = Box.MinX + Thickness;
				break;
		}
		return Result;
	}

	/** A box this deep just outside one side of another. */
	FBoxXZ Outside(FBoxXZ Box, ESide Side, float Depth)
	{
		int DX = OffsetX(Side);
		int DZ = OffsetZ(Side);
		float Width = Box.MaxX - Box.MinX;
		float Length = Box.MaxZ - Box.MinZ;
		FBoxXZ Moved = Level::MakeBoxXZ(
			Box.MinX + DX * Width,
			Box.MaxX + DX * Width,
			Box.MinZ + DZ * Length,
			Box.MaxZ + DZ * Length);
		return EdgeStrip(Moved, Opposite(Side), Depth);
	}

	/** `a + (b - a) * t`, as the TS's lerp in sliceOf writes it. */
	float LerpTo(float A, float B, float T)
	{
		return A + (B - A) * T;
	}

	/** The part of a box between two fractions of the way towards a side. */
	FBoxXZ SliceOf(FBoxXZ Box, ESide Toward, float From, float To)
	{
		FBoxXZ Result = Box;
		switch (Toward)
		{
			case ESide::N:
				Result.MinZ = LerpTo(Box.MinZ, Box.MaxZ, From);
				Result.MaxZ = LerpTo(Box.MinZ, Box.MaxZ, To);
				break;
			case ESide::S:
				Result.MinZ = LerpTo(Box.MaxZ, Box.MinZ, To);
				Result.MaxZ = LerpTo(Box.MaxZ, Box.MinZ, From);
				break;
			case ESide::E:
				Result.MinX = LerpTo(Box.MinX, Box.MaxX, From);
				Result.MaxX = LerpTo(Box.MinX, Box.MaxX, To);
				break;
			case ESide::W:
				Result.MinX = LerpTo(Box.MaxX, Box.MinX, To);
				Result.MaxX = LerpTo(Box.MaxX, Box.MinX, From);
				break;
		}
		return Result;
	}
}
