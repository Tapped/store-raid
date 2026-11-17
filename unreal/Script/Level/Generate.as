// Levels generated from a seed: mirrors shared/generate.ts, all of it, number for number, so the
// same seed gives the same building as in the web game (Generate_Test.as checks it against
// unreal/Tools/fixtures/generated.txt, written from the TS).
//
// In two layers. First the layout: each storey of the building is split into rooms that each have a
// kind (a loading bay at the entrance, big storage halls behind it with bonded cages in their
// corners, storerooms and workshops at the back, offices and staff rooms upstairs, plant rooms in the
// basement, corridors, and atriums open to the storey below), walled off from each other, with
// doorways and arches joining them all up and stairs or ladders between the storeys. Then the tiles,
// by wave function collapse: every cell gets the tile that fits its neighbours, the walls and
// doorways between them, what's above and below it, and what its room is for. Anything that can't be
// reached from the entrance is filled in or taken away, and the result is a grid like a hand-written
// one, with the rooms and how far each cell is from the entrance. What stands in the rooms is the
// next layer's (shared/furnish.ts).
//
// Pure: the same options give the same level on the server and every client.
//
// How it differs from the TS, where Angelscript makes it:
// - The random numbers are an FRandom passed by reference, not a closure; `Next()` is `next()`.
// - Rock, a layout kind in the TS (`LayoutKind`), is ERoomKind::Rock: no room ever has it.
// - Edges are a flat array, two a cell (its north and east edges), not a map of string keys.
// - Nothing throws: Generate puts why it failed in `Problem`, word for word the TS's error.

/** What a room is for, which decides its surfaces, what stands in it and how it's lit: `RoomKind`. */
enum ERoomKind
{
	/** Where players come in, the loading bay: the best lit room there is. */
	Entrance,
	/** A storage hall: rows of pallet racking, shipping containers, crates. */
	Hall,
	/** A bonded store behind chain-link, where the valuable cargo is locked away. */
	Cage,
	/** Workbenches, tools, a machine in pieces. */
	Workshop,
	/** A smaller storeroom: shelving, crates, drums. */
	Stock,
	/** Desks, filing cabinets: the shipping office. */
	Office,
	/** Lockers, a table, a vending machine. */
	Staff,
	/** Boilers, ducts, switchgear: dark, loud, often in the basement. */
	Plant,
	/** A passage between rooms. */
	Corridor,
	/** Open air above the storey below, with railings round it. */
	Atrium,
	/** Only in the layout: left solid, the parts of a basement nobody dug out. */
	Rock,
};

/**
 * Same seed, same numbers, on every machine: mulberry32, as `random(seed)` in the TS. Kept in int64
 * between 0 and 2^32, masked by hand: script's `>>>` on a uint of 2^31 or more doesn't fill with
 * zeros as JS's does.
 */
struct FRandom
{
	int64 State = 1;

	float Next()
	{
		State = (State + 0x6d2b79f5) & 0xFFFFFFFF;
		int64 T = State;
		T = Generate::Imul(T ^ (T >> 15), T | 1);
		T = T ^ ((T + Generate::Imul(T ^ (T >> 7), T | 61)) & 0xFFFFFFFF);
		return float(T ^ (T >> 14)) / 4294967296.0;
	}

	/** `Math.floor(next() * count)`. */
	int Below(int Count)
	{
		return Math::FloorToInt(Next() * Count);
	}
};

struct FGenerateOptions
{
	int Seed = 0;
	int Cols = 0;
	int Rows = 0;
	/** Storeys in all, of which the first `Basements` are below the ground. */
	int Storeys = 0;
	int Basements = 0;
};

/** A cell of a generated grid. */
struct FCell
{
	int Storey = 0;
	int Col = 0;
	int Row = 0;
};

/** A cell on a storey that's known. */
struct FColRow
{
	int Col = 0;
	int Row = 0;
};

/** A room as the layout made it: its kind, its storey, and the cells it still has that aren't rock. */
struct FGeneratedRoom
{
	ERoomKind Kind = ERoomKind::Hall;
	int Storey = 0;
	TArray<FColRow> Cells;
};

struct FGenerated
{
	FGenerateOptions Options;
	/** The grid, at (0, 0): where it stands is the level's to say. */
	FTileGrid Grid;
	/** Where players come in: a floor on the ground storey, on the southern edge. */
	FCell Entrance;
	/** Every floor that can be walked to from the entrance, for putting things on. */
	TArray<FCell> Floors;
	TArray<FGeneratedRoom> Rooms;
	/** Each cell's room, by Index(), or -1. */
	TArray<int> RoomIds;
	/** Each cell's distance from the entrance, by Index(), or -1 where it can't be walked to. */
	TArray<int> Distances;
	/** How many tries it took: a try fails when the tiles can't be made to fit. */
	int Attempts = 0;
	/** Why no level came of the seed (the TS throws it), or empty. */
	FString Problem;

	int Index(FCell Cell) const
	{
		return ((Cell.Storey + Options.Basements) * Options.Rows + Cell.Row) * Options.Cols + Cell.Col;
	}

	bool Inside(FCell Cell) const
	{
		return Cell.Storey >= -Options.Basements && Cell.Storey < Options.Storeys - Options.Basements
			&& Cell.Col >= 0 && Cell.Col < Options.Cols && Cell.Row >= 0 && Cell.Row < Options.Rows;
	}

	/** The room a cell is in, an index into `Rooms`, or -1 for rock and anything outside them. */
	int RoomAt(FCell Cell) const
	{
		if (!Inside(Cell))
			return -1;
		return RoomIds[Index(Cell)];
	}

	/**
	 * How far a cell is from the entrance, walking, in cells (climbing a storey counts as two), or -1
	 * if it can't be walked to (undefined in the TS).
	 */
	int Distance(FCell Cell) const
	{
		if (!Inside(Cell))
			return -1;
		return Distances[Index(Cell)];
	}
};

/** One storey's layout: the room each cell is in, by `Row * Cols + Col`, and each room's kind. */
struct FStoreyPlan
{
	TArray<int> Room;
	TArray<ERoomKind> Kinds;
};

/** A rectangle of cells. */
struct FRect
{
	int Col = 0;
	int Row = 0;
	int Width = 0;
	int Depth = 0;
};

/** A storey's layout as it's drawn up: rooms painted over each other, the last on top. */
struct FPainter
{
	int Cols = 0;
	int Rows = 0;
	TArray<int> Room;
	TArray<ERoomKind> Kinds;

	void Start(int InCols, int InRows)
	{
		Cols = InCols;
		Rows = InRows;
		Room.SetNum(Cols * Rows);
		for (int I = 0; I < Room.Num(); I++)
			Room[I] = -1;
	}

	/** A new room of a kind over a rectangle of cells; returns its id. */
	int Paint(ERoomKind Kind, int Col, int Row, int Width, int Depth)
	{
		int Id = Kinds.Num();
		Kinds.Add(Kind);
		for (int R = Math::Max(0, Row); R < Math::Min(Rows, Row + Depth); R++)
		{
			for (int C = Math::Max(0, Col); C < Math::Min(Cols, Col + Width); C++)
				Room[R * Cols + C] = Id;
		}
		return Id;
	}

	/** The plan, with rooms that lost all their cells left out and anything unpainted rock. */
	FStoreyPlan Plan() const
	{
		FStoreyPlan Result;
		// What each painted id became; the last entry is for -1, unpainted.
		TArray<int> Used;
		Used.SetNum(Kinds.Num() + 1);
		for (int I = 0; I < Used.Num(); I++)
			Used[I] = -1;
		Result.Room.SetNum(Room.Num());
		for (int I = 0; I < Room.Num(); I++)
		{
			int Was = Room[I];
			int Slot = Was < 0 ? Kinds.Num() : Was;
			if (Used[Slot] < 0)
			{
				Used[Slot] = Result.Kinds.Num();
				Result.Kinds.Add(Was < 0 ? ERoomKind::Rock : Kinds[Was]);
			}
			Result.Room[I] = Used[Slot];
		}
		return Result;
	}
};

/** An edge between two rooms that are walled off from each other, as `between` gathers them. */
struct FWallBetween
{
	int A = 0;
	int B = 0;
	int Col = 0;
	int Row = 0;
	ESide Side = ESide::N;
};

/** A pair of rooms with a wall between them, and the random number that orders it. */
struct FRoomPair
{
	FString Key;
	int A = 0;
	int B = 0;
	float Order = 0.0;
};

/** A reason a try failed, and how many tries it failed. */
struct FFailure
{
	FString Reason;
	int Count = 0;
};

/** Everything a single try works on: `tryGenerate`'s locals in the TS. */
struct FGenerateTry
{
	FGenerateOptions Options;
	TArray<FStoreyPlan> Plans;
	/** Each cell's north edge at Index * 2 and east edge at Index * 2 + 1; None where nothing's on it. */
	TArray<EEdge> Edges;
	/** Which tiles are still possible in each cell, at Index * COUNT + variant. */
	TArray<bool> Possible;
	TArray<float> Weights;
	TArray<FCell> Cells;
	/** Each cell's tile once collapsed. */
	TArray<FTile> Settled;
	FCell Entrance;

	int Index(int Storey, int Col, int Row) const
	{
		return ((Storey + Options.Basements) * Options.Rows + Row) * Options.Cols + Col;
	}

	bool Inside(int Storey, int Col, int Row) const
	{
		return Storey >= -Options.Basements && Storey < Options.Storeys - Options.Basements && Col >= 0
			&& Col < Options.Cols && Row >= 0 && Row < Options.Rows;
	}

	/** Where an edge is kept: each edge once, by the cell to its south or west, as `edgeKey`. */
	int EdgeSlot(int Storey, int Col, int Row, ESide Side) const
	{
		if (Side == ESide::S)
			return Index(Storey, Col, Row - 1) * 2;
		if (Side == ESide::W)
			return Index(Storey, Col - 1, Row) * 2 + 1;
		if (Side == ESide::N)
			return Index(Storey, Col, Row) * 2;
		return Index(Storey, Col, Row) * 2 + 1;
	}

	EEdge EdgeAt(int Storey, int Col, int Row, ESide Side) const
	{
		if (!Inside(Storey, Col + Tiles::OffsetX(Side), Row + Tiles::OffsetZ(Side)))
			return EEdge::Wall;
		return Edges[EdgeSlot(Storey, Col, Row, Side)];
	}

	void SetEdge(int Storey, int Col, int Row, ESide Side, EEdge Edge)
	{
		Edges[EdgeSlot(Storey, Col, Row, Side)] = Edge;
	}

	/** The layout's kind of a cell; None-like Rock and false outside the grid. */
	bool KindAt(int Storey, int Col, int Row, ERoomKind&out Kind) const
	{
		Kind = ERoomKind::Rock;
		if (!Inside(Storey, Col, Row))
			return false;
		FStoreyPlan Plan = Plans[Storey + Options.Basements];
		Kind = Plan.Kinds[Plan.Room[Row * Options.Cols + Col]];
		return true;
	}

	/** The tile in a cell once collapsed, None outside the grid. */
	FTile TileAt(int Storey, int Col, int Row) const
	{
		if (!Inside(Storey, Col, Row))
			return FTile();
		return Settled[Index(Storey, Col, Row)];
	}

	bool IsEntrance(int Storey, int Col, int Row) const
	{
		return Storey == Entrance.Storey && Col == Entrance.Col && Row == Entrance.Row;
	}

	/** An opening in a wall on an edge, if there is one. */
	void OpenUp(int Storey, int Col, int Row, ESide Side)
	{
		if (EdgeAt(Storey, Col, Row, Side) == EEdge::Wall)
			SetEdge(Storey, Col, Row, Side, EEdge::Door);
	}

	bool AnyPossible(int Cell) const
	{
		for (int V = 0; V < Generate::COUNT; V++)
		{
			if (Possible[Cell * Generate::COUNT + V])
				return true;
		}
		return false;
	}

	/** Settle a cell on one tile before the collapse starts. */
	bool Place(FCell Cell, FTile Tile)
	{
		int Base = Index(Cell.Storey, Cell.Col, Cell.Row) * Generate::COUNT;
		int V = Generate::VariantOf(Tile);
		bool bOk = Possible[Base + V];
		for (int I = 0; I < Generate::COUNT; I++)
			Possible[Base + I] = false;
		Possible[Base + V] = bOk;
		return bOk;
	}

	/** Whether a doorway is on any side of a cell that isn't allowed one: `doorways` in placeWayUp. */
	bool Doorways(int At, int Col, int Row, ESide Allowed, bool bOnlyAllowed)
	{
		for (int S = 0; S < 4; S++)
		{
			ESide Side = Tiles::SideAt(S);
			bool bAllowed = bOnlyAllowed ? Side == Allowed : Side != Allowed;
			if (!bAllowed && Tiles::IsOpening(EdgeAt(At, Col, Row, Side)))
				return true;
		}
		return false;
	}

	/**
	 * A way up from a storey, part of the layout, so no storey is cut off: stairs, or now and then a
	 * ladder, from a cell in one of the kinds of room given. It leads from inside the grid to inside
	 * it, with doorways only at its foot and where it arrives, and walls there get doorways.
	 */
	bool PlaceWayUp(int Storey, TArray<ERoomKind> From, bool bLadders, FRandom& Random)
	{
		TArray<FCell> Candidates;
		for (FCell Cell : Cells)
		{
			ERoomKind Kind;
			if (Cell.Storey != Storey || !KindAt(Storey, Cell.Col, Cell.Row, Kind))
				continue;
			if (From.Contains(Kind) && !IsEntrance(Cell.Storey, Cell.Col, Cell.Row))
				Candidates.Add(Cell);
		}
		for (int Tries = 0; Tries < 60 && Candidates.Num() > 0; Tries++)
		{
			FCell Cell = Candidates[Random.Below(Candidates.Num())];
			ESide Up = Tiles::SideAt(Random.Below(4));
			bool bLadder = bLadders && Random.Next() < 0.3;
			int Dx = Tiles::OffsetX(Up);
			int Dz = Tiles::OffsetZ(Up);
			ESide Foot = Tiles::Opposite(Up);
			ERoomKind Arrives;
			if (!KindAt(Storey + 1, Cell.Col + Dx, Cell.Row + Dz, Arrives))
				continue;
			if (Arrives == ERoomKind::Rock || Arrives == ERoomKind::Atrium || Arrives == ERoomKind::Cage)
				continue;
			ERoomKind Above;
			KindAt(Storey + 1, Cell.Col, Cell.Row, Above);
			// Outside the grid `above` is undefined in the TS, which passes; Rock here would not.
			if (Inside(Storey + 1, Cell.Col, Cell.Row) && (Above == ERoomKind::Rock || Above == ERoomKind::Cage))
				continue;
			if (!bLadder)
			{
				ERoomKind Before;
				if (!KindAt(Storey, Cell.Col - Dx, Cell.Row - Dz, Before))
					continue;
				if (Before == ERoomKind::Rock || Before == ERoomKind::Atrium)
					continue;
				if (IsEntrance(Storey, Cell.Col - Dx, Cell.Row - Dz))
					continue;
			}
			// Stairs may have a doorway only at their foot; a ladder anywhere but behind it.
			if (bLadder ? Doorways(Storey, Cell.Col, Cell.Row, Up, false) : Doorways(Storey, Cell.Col, Cell.Row, Foot, true))
				continue;
			if (Doorways(Storey + 1, Cell.Col, Cell.Row, Up, true))
				continue;
			if (!Place(Cell, bLadder ? Tiles::MakeLadder(Up) : Tiles::MakeStairs(Up)))
				continue;
			if (!bLadder)
				OpenUp(Storey, Cell.Col, Cell.Row, Foot);
			OpenUp(Storey + 1, Cell.Col, Cell.Row, Up);
			return true;
		}
		return false;
	}

	/** Drop what no longer fits next to what's left; false if a cell runs out of tiles. */
	bool Propagate(TArray<FCell> Start, TArray<int> Allows)
	{
		TArray<FCell> Queue = Start;
		while (Queue.Num() > 0)
		{
			FCell Cell = Queue.Last();
			Queue.RemoveAt(Queue.Num() - 1);
			int Mine = Index(Cell.Storey, Cell.Col, Cell.Row) * Generate::COUNT;
			// The cells next to it, and which of the ALLOWS rows says what fits there.
			for (int N = 0; N < 6; N++)
			{
				FCell Other = Cell;
				int Row = 0;
				if (N < 4)
				{
					ESide Side = Tiles::SideAt(N);
					Other.Col += Tiles::OffsetX(Side);
					Other.Row += Tiles::OffsetZ(Side);
					if (!Inside(Other.Storey, Other.Col, Other.Row))
						continue;
					EEdge Edge = EdgeAt(Cell.Storey, Cell.Col, Cell.Row, Side);
					Row = N * 3 + (Edge == EEdge::None ? 0 : Edge == EEdge::Wall ? 1 : 2);
				}
				else
				{
					Other.Storey += N == 4 ? 1 : -1;
					if (!Inside(Other.Storey, Other.Col, Other.Row))
						continue;
					Row = N == 4 ? 12 : 13;
				}
				int Theirs = Index(Other.Storey, Other.Col, Other.Row) * Generate::COUNT;
				// What any tile still possible here allows there.
				int Allowed = 0;
				for (int M = 0; M < Generate::COUNT; M++)
				{
					if (Possible[Mine + M])
						Allowed |= Allows[Row * Generate::COUNT + M];
				}
				bool bChanged = false;
				for (int T = 0; T < Generate::COUNT; T++)
				{
					if (Possible[Theirs + T] && (Allowed & (1 << T)) == 0)
					{
						Possible[Theirs + T] = false;
						bChanged = true;
					}
				}
				if (bChanged)
				{
					if (!AnyPossible(Index(Other.Storey, Other.Col, Other.Row)))
						return false;
					Queue.Add(Other);
				}
			}
		}
		return true;
	}

	/** Lays out, collapses and checks one try; empty if it worked, else why not. */
	FString Run(FRandom& Random, FGenerated& Out)
	{
		int Cols = Options.Cols;
		int Rows = Options.Rows;
		int Storeys = Options.Storeys;
		int Basements = Options.Basements;
		int Total = Storeys * Rows * Cols;
		Entrance.Storey = 0;
		Entrance.Col = Math::IntegerDivisionTrunc(Cols, 2);
		Entrance.Row = 0;

		// 1. The layout: rooms on every storey, and the edges between cells.
		Edges.SetNum(Total * 2);
		for (int I = 0; I < Edges.Num(); I++)
			Edges[I] = EEdge::None;
		Plans = Generate::LayOut(Options, Entrance.Col, Random);
		for (int Storey = -Basements; Storey < Storeys - Basements; Storey++)
			JoinRooms(Storey, Random);

		// 2. The tiles, by wave function collapse.
		int Count = Generate::COUNT;
		Possible.SetNum(Total * Count);
		Weights.SetNum(Total * Count);
		Cells.Reset();
		for (int Storey = -Basements; Storey < Storeys - Basements; Storey++)
		{
			for (int Row = 0; Row < Rows; Row++)
			{
				for (int Col = 0; Col < Cols; Col++)
				{
					FCell Cell;
					Cell.Storey = Storey;
					Cell.Col = Col;
					Cell.Row = Row;
					Cells.Add(Cell);
				}
			}
		}

		// What each cell can be on its own: by its room, at the top, at the bottom, against the outer walls.
		FTile Air = Tiles::MakeTile(ETileKind::Open);
		for (FCell Cell : Cells)
		{
			int Base = Index(Cell.Storey, Cell.Col, Cell.Row) * Count;
			ERoomKind Kind;
			KindAt(Cell.Storey, Cell.Col, Cell.Row, Kind);
			for (int V = 0; V < Count; V++)
			{
				FTile Tile = Generate::Variant(V);
				float Weight = Generate::Weight(Kind, Tile.Kind);
				Weights[Base + V] = Weight;
				// Wells and shafts follow from what's below or above, in any room but rock or a cage.
				bool bFollows = Tile.Kind == ETileKind::Well || Tile.Kind == ETileKind::Shaft;
				bool bOk = Weight > 0 || (Kind != ERoomKind::Rock && Kind != ERoomKind::Cage && bFollows);
				// Pits only on the ground, over a basement: anywhere else they'd hang over a room.
				if ((Tile.Kind == ETileKind::Pit || Tile.Kind == ETileKind::Bridge) && Cell.Storey != 0)
					bOk = false;
				if (Cell.Storey == -Basements && !Tiles::FitsAbove(FTile(), Tile))
					bOk = false;
				if (Cell.Storey == Storeys - Basements - 1 && !Tiles::FitsAbove(Tile, Air))
					bOk = false;
				for (int S = 0; S < 4; S++)
				{
					ESide Side = Tiles::SideAt(S);
					if (Inside(Cell.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side)))
						continue;
					if (Tiles::MustLeadOn(Tiles::Socket(Tile, Side)))
						bOk = false;
				}
				Possible[Base + V] = bOk;
			}
		}
		Place(Entrance, Tiles::MakeTile(ETileKind::Floor));

		// Ways up from every storey, part of the layout, so no storey is cut off: stairs at the back,
		// or now and then a ladder, and from the ground up broad stairs in the halls too.
		TArray<ERoomKind> BackRooms;
		BackRooms.Add(ERoomKind::Stock);
		BackRooms.Add(ERoomKind::Corridor);
		BackRooms.Add(ERoomKind::Plant);
		BackRooms.Add(ERoomKind::Staff);
		BackRooms.Add(ERoomKind::Office);
		BackRooms.Add(ERoomKind::Workshop);
		TArray<ERoomKind> Halls;
		Halls.Add(ERoomKind::Hall);
		for (int Storey = -Basements; Storey < Storeys - Basements - 1; Storey++)
		{
			bool bBack = PlaceWayUp(Storey, BackRooms, true, Random);
			// The main way up, from one hall to the next.
			bool bFront = Storey >= 0 && PlaceWayUp(Storey, Halls, false, Random);
			if (!bBack && !bFront)
				return f"no room for a way up from storey {Storey}";
		}

		TArray<int> Allows = Generate::Allows();
		if (!Propagate(Cells, Allows))
			return "the tiles contradict each other from the start";
		// Ties between cells with as few tiles left are broken at random, the same way all through.
		TArray<float> TieBreak;
		for (int I = 0; I < Cells.Num(); I++)
			TieBreak.Add(Random.Next() * 0.5);
		TArray<int> Undecided;
		for (int I = 0; I < Cells.Num(); I++)
			Undecided.Add(I);
		while (true)
		{
			// The undecided cell with the fewest tiles left.
			int Best = -1;
			float BestScore = 1.0e30;
			TArray<int> Still;
			for (int I : Undecided)
			{
				FCell Cell = Cells[I];
				int Base = Index(Cell.Storey, Cell.Col, Cell.Row) * Count;
				int Left = 0;
				for (int V = 0; V < Count; V++)
				{
					if (Possible[Base + V])
						Left++;
				}
				if (Left <= 1)
					continue;
				Still.Add(I);
				float Score = Left + TieBreak[I];
				if (Score < BestScore)
				{
					Best = I;
					BestScore = Score;
				}
			}
			Undecided = Still;
			if (Best < 0)
				break;
			FCell Chosen = Cells[Best];
			int Base = Index(Chosen.Storey, Chosen.Col, Chosen.Row) * Count;
			TArray<float> Chances;
			float Sum = 0.0;
			for (int V = 0; V < Count; V++)
			{
				float Weight = Weights[Base + V];
				Chances.Add(Possible[Base + V] ? (Weight != 0 ? Weight : 0.01) : 0.0);
				Sum += Chances[V];
			}
			float Pick = Random.Next() * Sum;
			int Picked = 0;
			while ((Pick >= Chances[Picked] || Chances[Picked] == 0) && Picked < Count - 1)
			{
				Pick -= Chances[Picked];
				Picked++;
			}
			for (int V = 0; V < Count; V++)
				Possible[Base + V] = false;
			Possible[Base + Picked] = true;
			TArray<FCell> Changed;
			Changed.Add(Chosen);
			if (Generate::OnlyOne(Picked))
			{
				for (int I = 0; I < Cells.Num(); I++)
				{
					FCell Cell = Cells[I];
					int There = Index(Cell.Storey, Cell.Col, Cell.Row) * Count;
					if (I == Best || !Possible[There + Picked])
						continue;
					Possible[There + Picked] = false;
					if (!AnyPossible(Index(Cell.Storey, Cell.Col, Cell.Row)))
						return "a cell ran out of tiles";
					Changed.Add(Cell);
				}
			}
			if (!Propagate(Changed, Allows))
				return "a cell ran out of tiles";
		}

		Settled.SetNum(Total);
		for (FCell Cell : Cells)
		{
			int Base = Index(Cell.Storey, Cell.Col, Cell.Row) * Count;
			int V = 0;
			while (V < Count && !Possible[Base + V])
				V++;
			Settled[Index(Cell.Storey, Cell.Col, Cell.Row)] = Generate::Variant(V);
		}

		// 3. Everything that can't be walked to from the entrance is filled in, or taken away. How
		// far each cell is, on the way, by the cheapest path: a step to the next cell is one, a
		// storey two.
		TArray<int> Distances;
		Distances.SetNum(Total);
		for (int I = 0; I < Total; I++)
			Distances[I] = -1;
		Distances[Index(Entrance.Storey, Entrance.Col, Entrance.Row)] = 0;
		// Buckets of cells by distance, kept flat: each entry is a cell index and its distance.
		TArray<int> BucketCells;
		TArray<int> BucketAt;
		BucketCells.Add(Index(Entrance.Storey, Entrance.Col, Entrance.Row));
		BucketAt.Add(0);
		int Farthest = 0;
		for (int At = 0; At <= Farthest; At++)
		{
			// The bucket for this distance grows while it's walked, as in the TS.
			for (int Entry = 0; Entry < BucketCells.Num(); Entry++)
			{
				if (BucketAt[Entry] != At)
					continue;
				FCell Cell = Cells[BucketCells[Entry]];
				if (Distances[BucketCells[Entry]] != At)
					continue;
				FTile Tile = TileAt(Cell.Storey, Cell.Col, Cell.Row);
				TArray<FCell> Steps;
				TArray<int> Costs;
				for (int S = 0; S < 4; S++)
				{
					ESide Side = Tiles::SideAt(S);
					FCell Other = Cell;
					Other.Col += Tiles::OffsetX(Side);
					Other.Row += Tiles::OffsetZ(Side);
					FTile Theirs = TileAt(Other.Storey, Other.Col, Other.Row);
					if (Theirs.Kind == ETileKind::None || EdgeAt(Cell.Storey, Cell.Col, Cell.Row, Side) == EEdge::Wall)
						continue;
					if (Generate::Walks(Tiles::Socket(Tile, Side)) && Generate::Walks(Tiles::Socket(Theirs, Tiles::Opposite(Side))))
					{
						Steps.Add(Other);
						Costs.Add(1);
					}
				}
				// Up stairs or a ladder, and down them from where they arrive.
				if (Tile.Kind == ETileKind::Stairs || Tile.Kind == ETileKind::Ladder)
				{
					FCell Up = Cell;
					Up.Storey += 1;
					Up.Col += Tiles::OffsetX(Tile.Up);
					Up.Row += Tiles::OffsetZ(Tile.Up);
					Steps.Add(Up);
					Costs.Add(2);
				}
				for (int S = 0; S < 4; S++)
				{
					ESide Side = Tiles::SideAt(S);
					FCell Below = Cell;
					Below.Storey -= 1;
					Below.Col -= Tiles::OffsetX(Side);
					Below.Row -= Tiles::OffsetZ(Side);
					FTile Climb = TileAt(Below.Storey, Below.Col, Below.Row);
					if ((Climb.Kind == ETileKind::Stairs || Climb.Kind == ETileKind::Ladder) && Climb.Up == Side)
					{
						Steps.Add(Below);
						Costs.Add(2);
					}
				}
				for (int I = 0; I < Steps.Num(); I++)
				{
					FCell Step = Steps[I];
					if (!Inside(Step.Storey, Step.Col, Step.Row))
						continue;
					int StepIndex = Index(Step.Storey, Step.Col, Step.Row);
					int Known = Distances[StepIndex];
					if (Known >= 0 && Known <= At + Costs[I])
						continue;
					Distances[StepIndex] = At + Costs[I];
					BucketCells.Add(StepIndex);
					BucketAt.Add(At + Costs[I]);
					Farthest = Math::Max(Farthest, At + Costs[I]);
				}
			}
		}
		for (FCell Cell : Cells)
		{
			FTile Tile = TileAt(Cell.Storey, Cell.Col, Cell.Row);
			bool bWalkable = Tile.Kind == ETileKind::Floor || Tile.Kind == ETileKind::Tv || Tile.Kind == ETileKind::Ladder
				|| Tile.Kind == ETileKind::Stairs || Tile.Kind == ETileKind::Bridge;
			if (!bWalkable || Distances[Index(Cell.Storey, Cell.Col, Cell.Row)] >= 0)
				continue;
			if (Tile.Kind == ETileKind::Bridge)
				Settled[Index(Cell.Storey, Cell.Col, Cell.Row)] = Tiles::MakeTile(ETileKind::Pit);
			// In the ground, rock; above it, air.
			else
				Settled[Index(Cell.Storey, Cell.Col, Cell.Row)] = Tiles::MakeTile(Cell.Storey <= 0 ? ETileKind::Solid : ETileKind::Open);
			if ((Tile.Kind == ETileKind::Stairs || Tile.Kind == ETileKind::Ladder) && Inside(Cell.Storey + 1, Cell.Col, Cell.Row))
				Settled[Index(Cell.Storey + 1, Cell.Col, Cell.Row)] = Tiles::MakeTile(ETileKind::Open);
		}
		// Openings onto what's gone become walls.
		for (FCell Cell : Cells)
		{
			for (int S = 0; S < 2; S++)
			{
				ESide Side = Tiles::SideAt(S);
				if (!Inside(Cell.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side)))
					continue;
				int Slot = EdgeSlot(Cell.Storey, Cell.Col, Cell.Row, Side);
				if (!Tiles::IsOpening(Edges[Slot]))
					continue;
				FTile Other = TileAt(Cell.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side));
				ESocket Mine = Tiles::Socket(TileAt(Cell.Storey, Cell.Col, Cell.Row), Side);
				ESocket Theirs = Tiles::Socket(Other, Tiles::Opposite(Side));
				if (!Tiles::IsPassable(Mine) || !Tiles::IsPassable(Theirs))
					Edges[Slot] = EEdge::Wall;
			}
		}
		// And walls left with air on both sides, standing on nothing, go.
		for (FCell Cell : Cells)
		{
			for (int S = 0; S < 2; S++)
			{
				ESide Side = Tiles::SideAt(S);
				if (!Inside(Cell.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side)))
					continue;
				FTile Other = TileAt(Cell.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side));
				if (Generate::Airy(TileAt(Cell.Storey, Cell.Col, Cell.Row)) && Generate::Airy(Other))
					Edges[EdgeSlot(Cell.Storey, Cell.Col, Cell.Row, Side)] = EEdge::None;
			}
		}

		// Every storey needs a fair bit to stand on, or it isn't worth having.
		for (int Storey = -Basements; Storey < Storeys - Basements; Storey++)
		{
			int Reached = 0;
			for (FCell Cell : Cells)
			{
				if (Cell.Storey == Storey && Distances[Index(Cell.Storey, Cell.Col, Cell.Row)] >= 0)
					Reached++;
			}
			if (Reached < 6)
				return f"storey {Storey} can hardly be reached";
		}

		FTileGrid Grid;
		Grid.Basements = Basements;
		Grid.Storeys = DrawStoreys();
		FString Problem = Tiles::CheckTiles(Tiles::ParseTiles(Grid));
		if (!Problem.IsEmpty())
			return Problem;

		Out.Options = Options;
		Out.Grid = Grid;
		Out.Entrance = Entrance;
		Out.Distances = Distances;
		Out.Floors.Reset();
		for (FCell Cell : Cells)
		{
			if (Distances[Index(Cell.Storey, Cell.Col, Cell.Row)] >= 0 && TileAt(Cell.Storey, Cell.Col, Cell.Row).Kind == ETileKind::Floor)
				Out.Floors.Add(Cell);
		}

		// The rooms that are left: atriums, and whatever can be walked into, in order of storey.
		// Their cells are those that aren't rock.
		Out.Rooms.Reset();
		Out.RoomIds.SetNum(Total);
		for (int I = 0; I < Total; I++)
			Out.RoomIds[I] = -1;
		for (int Storey = -Basements; Storey < Storeys - Basements; Storey++)
		{
			FStoreyPlan Plan = Plans[Storey + Basements];
			TArray<int> Found;
			TArray<bool> Entered;
			Found.SetNum(Plan.Kinds.Num());
			Entered.SetNum(Plan.Kinds.Num());
			for (int Id = 0; Id < Plan.Kinds.Num(); Id++)
			{
				Found[Id] = -1;
				Entered[Id] = false;
			}
			for (int I = 0; I < Plan.Room.Num(); I++)
			{
				int Col = I % Cols;
				int Row = Math::IntegerDivisionTrunc(I, Cols);
				if (Distances[Index(Storey, Col, Row)] >= 0)
					Entered[Plan.Room[I]] = true;
			}
			for (int I = 0; I < Plan.Room.Num(); I++)
			{
				ERoomKind Kind = Plan.Kinds[Plan.Room[I]];
				int Col = I % Cols;
				int Row = Math::IntegerDivisionTrunc(I, Cols);
				if (Kind == ERoomKind::Rock || TileAt(Storey, Col, Row).Kind == ETileKind::Solid)
					continue;
				if (Kind != ERoomKind::Atrium && !Entered[Plan.Room[I]])
					continue;
				int Id = Found[Plan.Room[I]];
				if (Id < 0)
				{
					Id = Out.Rooms.Num();
					Found[Plan.Room[I]] = Id;
					FGeneratedRoom Room;
					Room.Kind = Kind;
					Room.Storey = Storey;
					Out.Rooms.Add(Room);
				}
				FColRow Where;
				Where.Col = Col;
				Where.Row = Row;
				Out.Rooms[Id].Cells.Add(Where);
				Out.RoomIds[Index(Storey, Col, Row)] = Id;
			}
		}
		return "";
	}

	/**
	 * Walls go between the rooms of a storey that aren't open air or rock, and doorways join them all
	 * up, along a spanning tree, with a few more for loops. Halls and the loading bay are joined by
	 * arches, every other cell of the wall between them. A cage has no wall on its hall's side, and is
	 * walled off from anything else with no way through. Open-air rooms have no walls round them: the
	 * floors beside them get railings instead.
	 */
	void JoinRooms(int Storey, FRandom& Random)
	{
		FStoreyPlan Plan = Plans[Storey + Options.Basements];
		int Cols = Options.Cols;
		int Rows = Options.Rows;
		// The edges between each pair of walled rooms that touch, in the order they're found.
		TArray<FWallBetween> Between;
		TArray<FRoomPair> Pairs;
		for (int Row = 0; Row < Rows; Row++)
		{
			for (int Col = 0; Col < Cols; Col++)
			{
				for (int S = 0; S < 2; S++)
				{
					ESide Side = Tiles::SideAt(S);
					int Dx = Tiles::OffsetX(Side);
					int Dz = Tiles::OffsetZ(Side);
					if (Col + Dx >= Cols || Row + Dz >= Rows)
						continue;
					int A = Plan.Room[Row * Cols + Col];
					int B = Plan.Room[(Row + Dz) * Cols + Col + Dx];
					if (A == B || !Generate::Walled(Plan.Kinds[A]) || !Generate::Walled(Plan.Kinds[B]))
						continue;
					// Chain-link, not a wall, between a cage and its hall.
					int Other = Plan.Kinds[A] == ERoomKind::Cage ? B : Plan.Kinds[B] == ERoomKind::Cage ? A : -1;
					if (Other >= 0 && Plan.Kinds[Other] == ERoomKind::Hall)
						continue;
					SetEdge(Storey, Col, Row, Side, EEdge::Wall);
					if (Other >= 0)
						continue;
					FWallBetween Wall;
					Wall.A = Math::Min(A, B);
					Wall.B = Math::Max(A, B);
					Wall.Col = Col;
					Wall.Row = Row;
					Wall.Side = Side;
					Between.Add(Wall);
					FRoomPair Pair;
					Pair.Key = f"{Wall.A},{Wall.B}";
					Pair.A = Wall.A;
					Pair.B = Wall.B;
					bool bKnown = false;
					for (FRoomPair Known : Pairs)
					{
						if (Known.Key == Pair.Key)
							bKnown = true;
					}
					if (!bKnown)
						Pairs.Add(Pair);
				}
			}
		}
		// A spanning tree of doorways, in random order, so every room is joined; then a few loops.
		TArray<int> Parent;
		for (int I = 0; I < Plan.Kinds.Num(); I++)
			Parent.Add(I);
		// The pairs in the order of their keys as strings, as JS sorts them; then by a random order.
		Generate::SortByKey(Pairs);
		for (int I = 0; I < Pairs.Num(); I++)
			Pairs[I].Order = Random.Next();
		Generate::SortPairs(Pairs);
		for (FRoomPair Pair : Pairs)
		{
			int A = Pair.A;
			int B = Pair.B;
			TArray<FWallBetween> Options;
			for (FWallBetween Wall : Between)
			{
				if (Wall.A == A && Wall.B == B)
					Options.Add(Wall);
			}
			if (Generate::IsPublic(Plan.Kinds[A]) && Generate::IsPublic(Plan.Kinds[B]))
			{
				// A colonnade of arches: the loading bay opens right up, halls every other cell.
				bool bLobby = Plan.Kinds[A] == ERoomKind::Entrance || Plan.Kinds[B] == ERoomKind::Entrance;
				int Offset = Random.Below(2);
				for (int I = 0; I < Options.Num(); I++)
				{
					if (bLobby || I % 2 == Offset || Options.Num() == 1)
						SetEdge(Storey, Options[I].Col, Options[I].Row, Options[I].Side, EEdge::Arch);
				}
				Parent[Generate::Find(Parent, A)] = Generate::Find(Parent, B);
				continue;
			}
			bool bJoins = Generate::Find(Parent, A) != Generate::Find(Parent, B);
			if (!bJoins && Random.Next() > 0.3)
				continue;
			Parent[Generate::Find(Parent, A)] = Generate::Find(Parent, B);
			int First = Random.Below(Options.Num());
			SetEdge(Storey, Options[First].Col, Options[First].Row, Options[First].Side, EEdge::Door);
			// A long wall now and then gets a second doorway, well away from the first.
			if (Options.Num() >= 5 && Random.Next() < 0.4)
			{
				int Second = (First + Math::IntegerDivisionTrunc(Options.Num(), 2)) % Options.Num();
				SetEdge(Storey, Options[Second].Col, Options[Second].Row, Options[Second].Side, EEdge::Door);
			}
		}
	}

	/** The storeys, drawn with their walls as ParseTiles reads them. */
	TArray<FTileStorey> DrawStoreys() const
	{
		TArray<FTileStorey> Result;
		for (int Storey = -Options.Basements; Storey < Options.Storeys - Options.Basements; Storey++)
		{
			FTileStorey Drawn;
			for (int Row = Options.Rows - 1; Row >= 0; Row--)
			{
				FString Top = "+";
				FString Middle = "";
				for (int Col = 0; Col < Options.Cols; Col++)
				{
					Top += Generate::Mark(EdgeAt(Storey, Col, Row, ESide::N), "-") + "+";
					Middle += Generate::Mark(EdgeAt(Storey, Col, Row, ESide::W), "|");
					Middle += Tiles::TileChar(TileAt(Storey, Col, Row));
				}
				Middle += Generate::Mark(EdgeAt(Storey, Options.Cols - 1, Row, ESide::E), "|");
				Drawn.Lines.Add(Top);
				Drawn.Lines.Add(Middle);
			}
			FString Bottom = "+";
			for (int Col = 0; Col < Options.Cols; Col++)
				Bottom += "-+";
			Drawn.Lines.Add(Bottom);
			Result.Add(Drawn);
		}
		return Result;
	}
};

namespace Generate
{
	const int MAX_ATTEMPTS = 50;

	/**
	 * `Math.imul` on two numbers from 0 to 2^32, as one from 0 to 2^32: the low 32 bits of the
	 * product, taken in halves so nothing overflows.
	 */
	int64 Imul(int64 A, int64 B)
	{
		int64 Low = A * (B & 0xFFFF);
		int64 High = ((A * (B >> 16)) & 0xFFFF) << 16;
		return (Low + High) & 0xFFFFFFFF;
	}
	/** Every tile there is: VARIANTS.length. */
	const int COUNT = 20;

	/**
	 * Every tile there is, in the TS's order: floor, tv, solid, pit, the bridges along x and z,
	 * stairs and then ladders up each side, open air, wells from each side, and a shaft.
	 */
	FTile Variant(int V)
	{
		if (V == 0)
			return Tiles::MakeTile(ETileKind::Floor);
		if (V == 1)
			return Tiles::MakeTile(ETileKind::Tv);
		if (V == 2)
			return Tiles::MakeTile(ETileKind::Solid);
		if (V == 3)
			return Tiles::MakeTile(ETileKind::Pit);
		if (V == 4)
			return Tiles::MakeBridge(ETileAxis::X);
		if (V == 5)
			return Tiles::MakeBridge(ETileAxis::Z);
		if (V < 10)
			return Tiles::MakeStairs(Tiles::SideAt(V - 6));
		if (V < 14)
			return Tiles::MakeLadder(Tiles::SideAt(V - 10));
		if (V == 14)
			return Tiles::MakeTile(ETileKind::Open);
		if (V < 19)
			return Tiles::MakeWell(Tiles::SideAt(V - 15));
		return Tiles::MakeTile(ETileKind::Shaft);
	}

	/** Which variant a tile is: `VARIANTS.findIndex` by value. */
	int VariantOf(FTile Tile)
	{
		switch (Tile.Kind)
		{
			case ETileKind::Floor:
				return 0;
			case ETileKind::Tv:
				return 1;
			case ETileKind::Solid:
				return 2;
			case ETileKind::Pit:
				return 3;
			case ETileKind::Bridge:
				return Tile.Along == ETileAxis::X ? 4 : 5;
			case ETileKind::Stairs:
				return 6 + int(Tile.Up);
			case ETileKind::Ladder:
				return 10 + int(Tile.Up);
			case ETileKind::Open:
				return 14;
			case ETileKind::Well:
				return 15 + int(Tile.From);
			case ETileKind::Shaft:
				return 19;
			case ETileKind::None:
				break;
		}
		return -1;
	}

	/** Tiles there's only one of in a level: once a cell has one, no other cell can. */
	bool OnlyOne(int V)
	{
		return Variant(V).Kind == ETileKind::Tv;
	}

	/**
	 * How likely each tile is in a room of each kind, wherever it fits: WEIGHTS. Stairs, ladders and
	 * bridges are per way they face. Wells and shafts go wherever stairs, ladders or pits need them,
	 * and open air only in atriums. Pits can only be dug where there's a basement under them.
	 */
	float Weight(ERoomKind Room, ETileKind Tile)
	{
		switch (Room)
		{
			case ERoomKind::Entrance:
			case ERoomKind::Cage:
				return Tile == ETileKind::Floor ? 1.0 : 0.0;
			case ERoomKind::Hall:
				switch (Tile)
				{
					case ETileKind::Floor: return 16;
					case ETileKind::Tv: return 0.3;
					case ETileKind::Solid: return 0.1;
					case ETileKind::Pit: return 0.08;
					case ETileKind::Bridge: return 0.03;
					case ETileKind::Stairs: return 0.03;
					case ETileKind::Ladder: return 0.01;
					default: return 0;
				}
			case ERoomKind::Workshop:
				switch (Tile)
				{
					case ETileKind::Floor: return 10;
					case ETileKind::Tv: return 0.3;
					case ETileKind::Solid: return 0.1;
					case ETileKind::Ladder: return 0.03;
					default: return 0;
				}
			case ERoomKind::Stock:
				switch (Tile)
				{
					case ETileKind::Floor: return 10;
					case ETileKind::Solid: return 0.6;
					case ETileKind::Pit: return 0.5;
					case ETileKind::Bridge: return 0.25;
					case ETileKind::Stairs: return 0.06;
					case ETileKind::Ladder: return 0.06;
					default: return 0;
				}
			case ERoomKind::Office:
				switch (Tile)
				{
					case ETileKind::Floor: return 10;
					case ETileKind::Tv: return 0.4;
					case ETileKind::Solid: return 0.1;
					case ETileKind::Stairs: return 0.01;
					case ETileKind::Ladder: return 0.03;
					default: return 0;
				}
			case ERoomKind::Staff:
				switch (Tile)
				{
					case ETileKind::Floor: return 10;
					case ETileKind::Tv: return 0.7;
					case ETileKind::Solid: return 0.1;
					case ETileKind::Ladder: return 0.03;
					default: return 0;
				}
			case ERoomKind::Plant:
				switch (Tile)
				{
					case ETileKind::Floor: return 8;
					case ETileKind::Solid: return 0.9;
					case ETileKind::Pit: return 0.6;
					case ETileKind::Bridge: return 0.3;
					case ETileKind::Stairs: return 0.04;
					case ETileKind::Ladder: return 0.08;
					default: return 0;
				}
			case ERoomKind::Corridor:
				switch (Tile)
				{
					case ETileKind::Floor: return 12;
					case ETileKind::Stairs: return 0.02;
					case ETileKind::Ladder: return 0.04;
					default: return 0;
				}
			case ERoomKind::Atrium:
				return Tile == ETileKind::Open ? 1.0 : 0.0;
			case ERoomKind::Rock:
				return Tile == ETileKind::Solid ? 1.0 : 0.0;
		}
		return 0;
	}

	/** Sockets that can be walked across into the next cell on the same storey: WALKS. */
	bool Walks(ESocket Socket)
	{
		return Socket == ESocket::Floor || Socket == ESocket::Plank || Socket == ESocket::StairsFoot;
	}

	bool Airy(FTile Tile)
	{
		return Tile.Kind == ETileKind::Open || Tile.Kind == ETileKind::Well || Tile.Kind == ETileKind::Shaft;
	}

	/** Whether tile `A` can have tile `B` next to it, towards `Side`, across an edge. */
	bool Besides(FTile A, FTile B, ESide Side, EEdge Edge)
	{
		ESocket Mine = Tiles::Socket(A, Side);
		ESocket Theirs = Tiles::Socket(B, Tiles::Opposite(Side));
		if (Edge == EEdge::Wall)
		{
			// A wall closes off what's on either side, but has to stand on something.
			return !Tiles::MustLeadOn(Mine) && !Tiles::MustLeadOn(Theirs) && !(Airy(A) && Airy(B));
		}
		if (Tiles::IsOpening(Edge) && !(Tiles::IsPassable(Mine) && Tiles::IsPassable(Theirs)))
			return false;
		return Tiles::Fits(Mine, Theirs);
	}

	/**
	 * Which tiles each tile allows next to it, as bits, at row * COUNT + tile: towards each side
	 * across no wall, a wall or an opening (row side × 3 + edge), then above it (12) and below it (13).
	 */
	TArray<int> Allows()
	{
		TArray<int> Result;
		Result.SetNum(14 * COUNT);
		for (int S = 0; S < 4; S++)
		{
			for (int E = 0; E < 3; E++)
			{
				EEdge Edge = E == 0 ? EEdge::None : E == 1 ? EEdge::Wall : EEdge::Door;
				for (int M = 0; M < COUNT; M++)
				{
					int Bits = 0;
					for (int T = 0; T < COUNT; T++)
					{
						if (Besides(Variant(M), Variant(T), Tiles::SideAt(S), Edge))
							Bits |= 1 << T;
					}
					Result[(S * 3 + E) * COUNT + M] = Bits;
				}
			}
		}
		for (int M = 0; M < COUNT; M++)
		{
			int Above = 0;
			int Below = 0;
			for (int T = 0; T < COUNT; T++)
			{
				if (Tiles::FitsAbove(Variant(M), Variant(T)))
					Above |= 1 << T;
				if (Tiles::FitsAbove(Variant(T), Variant(M)))
					Below |= 1 << T;
			}
			Result[12 * COUNT + M] = Above;
			Result[13 * COUNT + M] = Below;
		}
		return Result;
	}

	/** Rooms that get walls round them: all but atriums and rock. */
	bool Walled(ERoomKind Kind)
	{
		return Kind != ERoomKind::Atrium && Kind != ERoomKind::Rock;
	}

	/** People and forklifts move between these, through arches rather than doorways: PUBLIC. */
	bool IsPublic(ERoomKind Kind)
	{
		return Kind == ERoomKind::Entrance || Kind == ERoomKind::Hall;
	}

	/** The root of a room in the spanning tree, shortening the way there as it goes. */
	int Find(TArray<int>& Parent, int I)
	{
		if (Parent[I] != I)
			Parent[I] = Find(Parent, Parent[I]);
		return Parent[I];
	}

	/** Sorts pairs by their keys' characters' codes, as JS's default sort does strings (FString's < ignores case). */
	void SortByKey(TArray<FRoomPair>& Pairs)
	{
		for (int I = 1; I < Pairs.Num(); I++)
		{
			FRoomPair Value = Pairs[I];
			int J = I - 1;
			while (J >= 0 && Pairs[J].Key.Compare(Value.Key, ESearchCase::CaseSensitive) > 0)
			{
				Pairs[J + 1] = Pairs[J];
				J--;
			}
			Pairs[J + 1] = Value;
		}
	}

	/** Sorts pairs by their order, keeping ties as they were, as JS's sort does. */
	void SortPairs(TArray<FRoomPair>& Pairs)
	{
		for (int I = 1; I < Pairs.Num(); I++)
		{
			FRoomPair Value = Pairs[I];
			int J = I - 1;
			while (J >= 0 && Pairs[J].Order > Value.Order)
			{
				Pairs[J + 1] = Pairs[J];
				J--;
			}
			Pairs[J + 1] = Value;
		}
	}

	/** An edge as drawn: `d` a doorway, `a` an arch, the wall's own character, or a space. */
	FString Mark(EEdge Edge, FString Wall)
	{
		if (Edge == EEdge::Door)
			return "d";
		if (Edge == EEdge::Arch)
			return "a";
		if (Edge == EEdge::Wall)
			return Wall;
		return " ";
	}

	/** The kind as the TS writes it: "hall", "rock". */
	FString RoomKindName(ERoomKind Kind)
	{
		switch (Kind)
		{
			case ERoomKind::Entrance: return "entrance";
			case ERoomKind::Hall: return "hall";
			case ERoomKind::Cage: return "cage";
			case ERoomKind::Workshop: return "workshop";
			case ERoomKind::Stock: return "stock";
			case ERoomKind::Office: return "office";
			case ERoomKind::Staff: return "staff";
			case ERoomKind::Plant: return "plant";
			case ERoomKind::Corridor: return "corridor";
			case ERoomKind::Atrium: return "atrium";
			case ERoomKind::Rock: return "rock";
		}
		return "";
	}

	/** A level from a seed, or one with `Problem` saying why there's none. */
	FGenerated Generate(FGenerateOptions Options)
	{
		FRandom Random;
		// `seed >>> 0 || 1`.
		Random.State = int64(Options.Seed) & 0xFFFFFFFF;
		if (Random.State == 0)
			Random.State = 1;
		TArray<FFailure> Failures;
		for (int Attempt = 1; Attempt <= MAX_ATTEMPTS; Attempt++)
		{
			FGenerateTry Try;
			Try.Options = Options;
			FGenerated Result;
			FString Reason = Try.Run(Random, Result);
			if (Reason.IsEmpty())
			{
				Result.Attempts = Attempt;
				return Result;
			}
			bool bKnown = false;
			for (int I = 0; I < Failures.Num(); I++)
			{
				if (Failures[I].Reason == Reason)
				{
					Failures[I].Count++;
					bKnown = true;
				}
			}
			if (!bKnown)
			{
				FFailure Failure;
				Failure.Reason = Reason;
				Failure.Count = 1;
				Failures.Add(Failure);
			}
		}
		FGenerated Failed;
		Failed.Options = Options;
		FString Why;
		for (int I = 0; I < Failures.Num(); I++)
			Why += (I > 0 ? "; " : "") + f"{Failures[I].Count} × {Failures[I].Reason}";
		Failed.Problem = f"No level from seed {Options.Seed} in {MAX_ATTEMPTS} tries: " + Why;
		return Failed;
	}

	// The layout -------------------------------------------------------------------------------

	/**
	 * Split a length into pieces between `Min` and `Max` long, at random, as evenly as it comes. A
	 * length shorter than `Min` is one piece.
	 */
	TArray<int> Pieces(int Length, int Min, int Max, FRandom& Random)
	{
		TArray<int> Result;
		int Left = Length;
		while (Left > 0)
		{
			if (Left <= Max)
			{
				Result.Add(Left);
				break;
			}
			// Keep enough over for at least one more piece.
			int Most = Math::Min(Max, Left - Min);
			int Piece = Most <= Min ? Min : Min + Random.Below(Most - Min + 1);
			Result.Add(Piece);
			Left -= Piece;
		}
		return Result;
	}

	/** Split a length into `Count` pieces, each at least `Min` long, at random; fewer if it's too short. */
	TArray<int> Divide(int Length, int Count, int Min, FRandom& Random)
	{
		int N = Math::Max(1, Math::Min(Count, Math::IntegerDivisionTrunc(Length, Min)));
		TArray<int> Result;
		for (int I = 0; I < N; I++)
			Result.Add(Min);
		for (int Left = Length - N * Min; Left > 0; Left--)
			Result[Random.Below(N)]++;
		return Result;
	}

	FRect MakeRect(int Col, int Row, int Width, int Depth)
	{
		FRect Rect;
		Rect.Col = Col;
		Rect.Row = Row;
		Rect.Width = Width;
		Rect.Depth = Depth;
		return Rect;
	}

	/**
	 * The building's layout, storey by storey from the deepest, as a harbour warehouse is laid out.
	 * On the ground: the loading bay at the entrance, in the middle of the south side; big storage
	 * halls behind and around it, some with a bonded cage in a back corner; maybe a shipping office or
	 * storeroom in a front corner; and a strip of storerooms along the back, often with a corridor in
	 * front of them. Above: more halls at the front round an atrium open to the hall below, and
	 * offices, staff rooms, workshops and storerooms along a corridor at the back; the top storey is
	 * more often all back of house. In the basement: plant and stock rooms off a corridor, under the
	 * back of the building, and rock elsewhere.
	 */
	TArray<FStoreyPlan> LayOut(FGenerateOptions Options, int EntranceCol, FRandom& Random)
	{
		int Cols = Options.Cols;
		int Rows = Options.Rows;
		int Basements = Options.Basements;
		TArray<FStoreyPlan> Plans;
		Plans.SetNum(Options.Storeys);
		int Top = Options.Storeys - Basements - 1;

		// The ground.
		FPainter Ground;
		Ground.Start(Cols, Rows);
		int Back = 3 + (Random.Next() < 0.4 ? 1 : 0);
		int Front = Rows - Back;
		int HallCount = Random.Next() < 0.3 ? 1 : Random.Next() < 0.7 ? 2 : 3;
		TArray<FRect> Halls;
		int Col = 0;
		for (int Width : Divide(Cols, HallCount, 4, Random))
		{
			Ground.Paint(ERoomKind::Hall, Col, 0, Width, Front);
			Halls.Add(MakeRect(Col, 0, Width, Front));
			Col += Width;
		}
		if (Random.Next() < 0.5)
		{
			int Width = 2 + Random.Below(2);
			int Depth = 2 + Random.Below(2);
			bool bWest = Random.Next() < 0.5;
			ERoomKind Kind = Random.Next() < 0.5 ? ERoomKind::Office : ERoomKind::Stock;
			Ground.Paint(Kind, bWest ? 0 : Cols - Width, 0, Width, Depth);
		}
		int LobbyWidth = 3 + (Random.Next() < 0.4 ? 1 : 0);
		FRect Lobby = MakeRect(EntranceCol - Math::IntegerDivisionTrunc(LobbyWidth, 2), 0, LobbyWidth, 2);
		Ground.Paint(ERoomKind::Entrance, Lobby.Col, Lobby.Row, Lobby.Width, Lobby.Depth);
		TArray<FRect> AvoidLobby;
		AvoidLobby.Add(Lobby);
		for (FRect Hall : Halls)
		{
			if (Random.Next() < 0.45)
				PaintCage(Ground, Hall, AvoidLobby, Random);
		}
		LayOutBack(Ground, Front, Back, Random.Next() < 0.55, ELayoutStrip::Ground, Random);
		Plans[Basements] = Ground.Plan();

		// Above the ground: the atrium over the biggest hall, which may go up more than one storey.
		FRect Biggest = Halls[0];
		for (FRect Hall : Halls)
		{
			if (Hall.Width * Hall.Depth > Biggest.Width * Biggest.Depth)
				Biggest = Hall;
		}
		TArray<FRect> Atria;
		if (Biggest.Width >= 4 && Biggest.Depth >= 4)
		{
			int Width = Math::Min(Biggest.Width - 2, 2 + Random.Below(3));
			int Depth = Math::Min(Biggest.Depth - 2, 2 + Random.Below(3));
			int AtCol = Biggest.Col + 1 + Random.Below(Biggest.Width - 1 - Width);
			int AtRow = Biggest.Row + 1 + Random.Below(Biggest.Depth - 1 - Depth);
			Atria.Add(MakeRect(AtCol, AtRow, Width, Depth));
		}
		for (int Storey = 1; Storey <= Top; Storey++)
		{
			FPainter Upper;
			Upper.Start(Cols, Rows);
			int UpperBack = 3 + (Random.Next() < 0.5 ? 1 : 0);
			int UpperFront = Rows - UpperBack;
			if (Storey == 1 || Random.Next() < 0.45)
			{
				// Storage, in one hall or two, with a cage more often than on the ground.
				TArray<int> Split;
				if (Random.Next() < 0.5)
					Split = Pieces(Cols, 5, Cols - 5, Random);
				else
					Split.Add(Cols);
				int At = 0;
				for (int Width : Split)
				{
					FRect Hall = MakeRect(At, 0, Width, UpperFront);
					Upper.Paint(ERoomKind::Hall, Hall.Col, Hall.Row, Hall.Width, Hall.Depth);
					if (Random.Next() < 0.6)
						PaintCage(Upper, Hall, Atria, Random);
					At += Width;
				}
			}
			else
			{
				LayOutBack(Upper, 0, UpperFront, true, ELayoutStrip::Front, Random);
			}
			LayOutBack(Upper, UpperFront, UpperBack, Random.Next() < 0.75, ELayoutStrip::Upstairs, Random);
			for (FRect Atrium : Atria)
				Upper.Paint(ERoomKind::Atrium, Atrium.Col, Atrium.Row, Atrium.Width, Atrium.Depth);
			Plans[Basements + Storey] = Upper.Plan();
			// An atrium only goes on up now and then.
			TArray<FRect> Going;
			for (FRect Atrium : Atria)
			{
				if (Random.Next() < 0.45)
					Going.Add(Atrium);
			}
			Atria = Going;
		}

		// The basements: under the back of the building, dug out of rock.
		for (int Storey = -1; Storey >= -Basements; Storey--)
		{
			FPainter Basement;
			Basement.Start(Cols, Rows);
			int Depth = Math::Min(Rows, 5 + Random.Below(3));
			int From = Random.Below(3);
			int To = Cols - Random.Below(3);
			int Corridor = Rows - Depth + 1 + Random.Below(Depth - 2);
			Basement.Paint(ERoomKind::Corridor, From, Corridor, To - From, 1);
			for (int Side = 0; Side < 2; Side++)
			{
				int Row = Side == 0 ? Rows - Depth : Corridor + 1;
				int RowDepth = Side == 0 ? Corridor - (Rows - Depth) : Rows - Corridor - 1;
				if (RowDepth <= 0)
					continue;
				int At = From;
				for (int Width : Pieces(To - From, 2, 5, Random))
				{
					bool bSmall = Width * RowDepth <= 6;
					ERoomKind Kind = bSmall || Random.Next() < 0.5 ? ERoomKind::Plant : ERoomKind::Stock;
					Basement.Paint(Kind, At, Row, Width, RowDepth);
					At += Width;
				}
			}
			Plans[Basements + Storey] = Basement.Plan();
		}
		return Plans;
	}

	/**
	 * Back of house in a strip of rows: maybe a corridor along its southern side, then rooms side by
	 * side behind it. On the ground they're mostly stock rooms, with a staff room or office at one end
	 * now and then; upstairs, offices and staff rooms with the odd stock room. At the front of a
	 * storey that isn't storage, a mix, either side of a corridor down the middle.
	 */
	void LayOutBack(FPainter& Painter, int Row, int Depth, bool bCorridor, ELayoutStrip Where, FRandom& Random)
	{
		int Cols = Painter.Cols;
		if (!bCorridor || Depth < 3)
		{
			LayOutRooms(Painter, Row, Depth, Where, Random);
		}
		else if (Where == ELayoutStrip::Front)
		{
			int Middle = Row + 2 + Random.Below(Math::Max(1, Depth - 4));
			Painter.Paint(ERoomKind::Corridor, 0, Middle, Cols, 1);
			LayOutRooms(Painter, Row, Middle - Row, Where, Random);
			LayOutRooms(Painter, Middle + 1, Row + Depth - Middle - 1, Where, Random);
		}
		else
		{
			Painter.Paint(ERoomKind::Corridor, 0, Row, Cols, 1);
			LayOutRooms(Painter, Row + 1, Depth - 1, Where, Random);
		}
	}

	/** Rooms side by side in a strip of rows, and one behind the other where it's deep. */
	void LayOutRooms(FPainter& Painter, int From, int Depth, ELayoutStrip Where, FRandom& Random)
	{
		if (Depth <= 0)
			return;
		int Cols = Painter.Cols;
		TArray<int> Widths = Where == ELayoutStrip::Ground
			? Pieces(Cols, 3, 6, Random)
			: Pieces(Cols, 2, Where == ELayoutStrip::Front ? 5 : 4, Random);
		int At = 0;
		for (int I = 0; I < Widths.Num(); I++)
		{
			int Width = Widths[I];
			int Row = From;
			TArray<int> Depths = Pieces(Depth, 2, Where == ELayoutStrip::Ground ? 4 : 3, Random);
			for (int J = 0; J < Depths.Num(); J++)
			{
				int RoomDepth = Depths[J];
				int Area = Width * RoomDepth;
				ERoomKind Kind;
				if (Where == ELayoutStrip::Ground)
				{
					bool bEnd = I == 0 || I == Widths.Num() - 1;
					bool bSmall = bEnd && Width <= 4 && Random.Next() < 0.35;
					float Pick = Random.Next();
					if (bSmall || J > 0)
						Kind = Pick < 0.35 ? ERoomKind::Staff : Pick < 0.7 ? ERoomKind::Office : ERoomKind::Workshop;
					else
						Kind = ERoomKind::Stock;
				}
				else if (Area >= 8 && Random.Next() < (Where == ELayoutStrip::Front ? 0.5 : 0.3))
				{
					Kind = Random.Next() < 0.5 ? ERoomKind::Stock : Random.Next() < 0.5 ? ERoomKind::Workshop : ERoomKind::Office;
				}
				else
				{
					float Pick = Random.Next();
					Kind = Pick < 0.5 ? ERoomKind::Office : Pick < 0.8 ? ERoomKind::Staff : ERoomKind::Workshop;
				}
				Painter.Paint(Kind, At, Row, Width, RoomDepth);
				Row += RoomDepth;
			}
			At += Width;
		}
	}

	/**
	 * A bonded cage in a back corner of a hall, two or three cells each way, clear of the rectangles
	 * given (the loading bay, atriums). It has no walls on the hall's side: the furnishing layer
	 * fences it in with chain-link (shared/furnish.ts).
	 */
	void PaintCage(FPainter& Painter, FRect Hall, TArray<FRect> Avoid, FRandom& Random)
	{
		int Width = Math::Min(Hall.Width - 2, 2 + Random.Below(2));
		int Depth = Math::Min(Hall.Depth - 2, 2 + Random.Below(2));
		if (Width < 2 || Depth < 2)
			return;
		int Col = Random.Next() < 0.5 ? Hall.Col : Hall.Col + Hall.Width - Width;
		int Row = Hall.Row + Hall.Depth - Depth;
		for (FRect R : Avoid)
		{
			if (Col < R.Col + R.Width && R.Col < Col + Width && Row < R.Row + R.Depth && R.Row < Row + Depth)
				return;
		}
		Painter.Paint(ERoomKind::Cage, Col, Row, Width, Depth);
	}
}

/** Which strip of a storey back of house is laid out in: `where` in layOutBack. */
enum ELayoutStrip
{
	Ground,
	Upstairs,
	Front,
}
