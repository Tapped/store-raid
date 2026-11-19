// The third layer of a generated level, after the layout and the tiles (Generate.as): what stands in
// each room, how it's lit, and where the loot is. Mirrors `furnish()` in shared/furnish.ts, number
// for number (Furnish_Test.as checks it against unreal/Tools/fixtures/furnished.txt, from the TS).
//
// Halls get rows of pallet racking and shipping containers with bay signs and high-bay lamps over
// the aisles; cages are fenced in with chain-link; storerooms, workshops, offices, staff and plant
// rooms get what they're for along their walls and in their middles; every room gets its fittings:
// door frames, extinguishers, exit signs on the way out, ducts and pipes under the ceiling, cameras.
// Lights are fewer, flickering and dead the further in a room is, and some deep rooms are dark. Loot
// is worth more the further in, the higher up and the darker it is.
//
// Some rules hold whatever the seed, and are checked here, not hoped for:
//
// - Every way through keeps a clear width of 1.4 m, so two people carrying a sofa get through: a
//   flood fill over a fine grid with a disc that wide finds every doorway, stairs and aisle it found
//   before anything was placed, and props that get in its way are taken away again.
// - Doorways, the feet and tops of stairs, ladders, plank ends, the dock and where players start are
//   kept clear.
// - Wall props hang on a wall that's there, and ceiling props under a ceiling that's there.
// - Every item can be reached from the entrance, the two-handed ones without a ladder, and the sofas
//   by that 1.4 m disc.
//
// Pure: the same level from the same seed, on the server and every client.
//
// How it differs from the TS, where Angelscript makes it:
// - The functions `alongWall` and `rows` take what to place as a closure in the TS; here as an
//   FChooser or an EBay, which say the same.
// - `pick` of a list with `undefined` in it is PickOrNone, with how many undefineds there are.

/** One room of a building: cells on one storey with walls or railings round them. `Room` in shared/level.ts. */
struct FRoom
{
	/** Its index in the level's rooms. */
	int Id = 0;
	ERoomKind Kind = ERoomKind::Hall;
	int Storey = 0;
	/** The height of its floor. */
	float Y = 0.0;
	/** Everything it covers, wall to wall; `Cells` says which cells of that. */
	FBoxXZ Bounds;
	TArray<FColRow> Cells;
	/** How far in it is from the entrance, by the way players walk: 0 at the entrance, 1 the farthest room. */
	float Depth = 0.0;
};

/**
 * Something standing in a level that never moves, drawn from a model: `models/props/<name>.glb`. It's
 * only drawn: whatever it blocks is a box of kind Furniture, Shelf or Mesh in the level's boxes. Its
 * front faces `Turn` radians round y from north (+z), clockwise seen from above. `PropSpawn`.
 */
struct FPropSpawn
{
	EProp Model = EProp::CeilingTube;
	float X = 0.0;
	float Y = 0.0;
	float Z = 0.0;
	float Turn = 0.0;
	/** The room it stands in, an index into the level's rooms, or -1. */
	int Room = -1;
};

enum ELightKind
{
	Tube,
	Bulb,
	Emergency,
	Exit,
};

enum ELightState
{
	On,
	Flicker,
	Dead,
};

/**
 * A light fitting. `Power` is how bright it is next to an ordinary ceiling tube, which is 1. A
 * flickering one stutters; a dead one is a fitting that gives no light. `LightSpawn`.
 */
struct FLightSpawn
{
	ELightKind Kind = ELightKind::Tube;
	float X = 0.0;
	float Y = 0.0;
	float Z = 0.0;
	/** Radians round y, for fittings that have a length. */
	float Turn = 0.0;
	/** Linear RGB, 0 to 1. */
	float R = 1.0;
	float G = 1.0;
	float B = 1.0;
	float Power = 1.0;
	ELightState State = ELightState::On;
	/** The room it lights, an index into the level's rooms, or -1. */
	int Room = -1;
};

/** What Furnish makes of a generated level. */
struct FFurnished
{
	TArray<FRoom> Rooms;
	TArray<FPropSpawn> Props;
	/** The props' collision boxes, of kind Furniture, Shelf or Mesh, to add to the level's. */
	TArray<FLevelBox> Boxes;
	TArray<FLightSpawn> Lights;
	TArray<FItemSpawn> Items;
	/** How many props were taken away again because they were in the way. */
	int Dropped = 0;
};

/** A wall face along part of one side of a room's cells, to stand things against or hang them on. */
struct FWallRun
{
	int Storey = 0;
	/** The side of the room the wall is on: what stands against it faces the other way. */
	ESide Side = ESide::N;
	/** Where its face is, across: z for a wall on the north or south, x for east or west. */
	float Face = 0.0;
	/** Where it starts and ends, along. */
	float From = 0.0;
	float To = 0.0;
	/** How high it goes above the floor. */
	float Height = 0.0;
};

/** Parts of a room this furnishing gives a look of its own. */
struct FStyle
{
	/** How full it is, about 0.4 to 1.2. */
	float Density = 1.0;
	/** Turned over: things missing, things dropped, crates knocked askew. */
	bool bRansacked = false;
};

struct FPlacedProp
{
	FPropSpawn Spawn;
	int Storey = 0;
	/** What it covers on the ground, and from how high to how high. */
	FBoxXZ Box;
	float Bottom = 0.0;
	float Top = 0.0;
	EPropMount Mount = EPropMount::Floor;
	bool bSolid = false;
	bool bRemoved = false;
};

/** A list of level boxes, so lists of them can be kept in an array. */
struct FLevelBoxList
{
	TArray<FLevelBox> Boxes;
};

/** A set of grid points, so sets of them can be kept in an array. */
struct FPointSet
{
	TSet<int> Points;
};

/**
 * What `alongWall` stands next, as the closures the TS gives it: a pick from `List` with `Nones`
 * undefineds after it, or with `bChance`, the first of the list if `chance(P)`, else nothing.
 */
struct FChooser
{
	TArray<EProp> List;
	int Nones = 0;
	bool bChance = false;
	float P = 0.0;
};

/** Where `alongWall` may stand things, and how: its options in the TS. */
struct FAlongWall
{
	float Gap = 0.0;
	bool bFrom = false;
	float From = 0.0;
	bool bTo = false;
	float To = 0.0;
	float Skip = 0.0;
};

/** What a bay of `rows` is: the `bay` closures in furnishHall. */
enum EBay
{
	Racking,
	Containers,
	Bulk,
};

/** A part of a bay: a prop, how far it's off the row's middle, and the way it faces. */
struct FBayPart
{
	EProp Model = EProp::PalletRackA;
	float Offset = 0.0;
	ESide Faces = ESide::N;
};

/** Where a hall's aisles are, for the lamps and bay signs over them. */
struct FHallAisles
{
	bool bAlongZ = false;
	TArray<float> Aisles;
	FBoxXZ Area;
};

/** A spot loot could go, and how far in, high up and dark it is. */
struct FSpot
{
	FPoint Point;
	int Room = 0;
	float Score = 0.0;
};

/** A piece of loot to place, between which of the spots ordered by score, and in which kinds of room. */
struct FLoot
{
	EItemKind Kind = EItemKind::Phone;
	float Low = 0.0;
	float High = 1.0;
	TArray<ERoomKind> Rooms;
};

/** A line a set distance across a box, running along an axis. */
struct FGridLine
{
	bool bAlongZ = false;
	float Across = 0.0;
};

/** A cage's edge onto its hall. */
struct FCageEdge
{
	int Col = 0;
	int Row = 0;
	ESide Side = ESide::N;
};

/** The way out of a room, and the wall over it to hang an exit sign on. */
struct FExit
{
	FWallRun Run;
	float Along = 0.0;
	float Height = 0.0;
};

namespace Furnish
{
	/**
	 * Furnish a generated level: its rooms, their props and lights, and its items. `TileBoxes` are the
	 * tiles' boxes, `Start` where players come in, and `KeepClear` what's kept clear round them.
	 */
	FFurnished Furnish(int Seed, FGenerated Generated, FTileGrid Grid, TArray<FLevelBox> TileBoxes, FPoint Start, TArray<FBoxXZ> KeepClear)
	{
		FFurnisher Furnisher;
		Furnisher.Start(Seed, Generated, Grid, TileBoxes, Start, KeepClear);
		return Furnisher.Run();
	}

	/** The kind of box a solid prop is: shelving, chain-link, or furniture. */
	ELevelBoxKind BoxKind(EProp Model)
	{
		if (Model == EProp::CagePanel)
			return ELevelBoxKind::Mesh;
		FString Name = Props::Name(Model);
		if (Name.Contains("rack") || Name.Contains("shelf"))
			return ELevelBoxKind::Shelf;
		return ELevelBoxKind::Furniture;
	}

	/** The way along a run that props stand against it face: the other way from its wall. */
	bool AlongX(ESide Side)
	{
		return Side == ESide::N || Side == ESide::S;
	}

	/** Sides in the order JS's localeCompare puts their letters: e, n, s, w. */
	int SideOrder(ESide Side)
	{
		switch (Side)
		{
			case ESide::E:
				return 0;
			case ESide::N:
				return 1;
			case ESide::S:
				return 2;
			case ESide::W:
				return 3;
		}
		return 0;
	}

	/** Whether wall piece A goes after B: by side, then face, then where it starts. */
	bool PieceAfter(FWallRun A, FWallRun B)
	{
		if (A.Side != B.Side)
			return SideOrder(A.Side) > SideOrder(B.Side);
		if (A.Face != B.Face)
			return A.Face > B.Face;
		return A.From > B.From;
	}

	/** Spots ordered by score, keeping ties as they were, as JS's sort does: a merge sort. */
	void SortSpots(TArray<FSpot>& Spots)
	{
		int N = Spots.Num();
		TArray<FSpot> Buffer;
		Buffer.SetNum(N);
		for (int Width = 1; Width < N; Width *= 2)
		{
			for (int Left = 0; Left < N; Left += 2 * Width)
			{
				int Middle = Math::Min(Left + Width, N);
				int Right = Math::Min(Left + 2 * Width, N);
				int I = Left;
				int J = Middle;
				int K = Left;
				while (I < Middle && J < Right)
				{
					if (Spots[J].Score < Spots[I].Score)
						Buffer[K++] = Spots[J++];
					else
						Buffer[K++] = Spots[I++];
				}
				while (I < Middle)
					Buffer[K++] = Spots[I++];
				while (J < Right)
					Buffer[K++] = Spots[J++];
			}
			for (int K = 0; K < N; K++)
				Spots[K] = Buffer[K];
		}
	}

	FChooser Pick(TArray<EProp> List, int Nones = 0)
	{
		FChooser Chooser;
		Chooser.List = List;
		Chooser.Nones = Nones;
		return Chooser;
	}

	TArray<EProp> List(EProp A)
	{
		TArray<EProp> Result;
		Result.Add(A);
		return Result;
	}

	TArray<EProp> List(EProp A, EProp B)
	{
		TArray<EProp> Result;
		Result.Add(A);
		Result.Add(B);
		return Result;
	}

	TArray<EProp> List(EProp A, EProp B, EProp C)
	{
		TArray<EProp> Result = List(A, B);
		Result.Add(C);
		return Result;
	}

	TArray<EProp> List(EProp A, EProp B, EProp C, EProp D)
	{
		TArray<EProp> Result = List(A, B, C);
		Result.Add(D);
		return Result;
	}

	TArray<EProp> List(EProp A, EProp B, EProp C, EProp D, EProp E)
	{
		TArray<EProp> Result = List(A, B, C, D);
		Result.Add(E);
		return Result;
	}

	TArray<EProp> List(EProp A, EProp B, EProp C, EProp D, EProp E, EProp F)
	{
		TArray<EProp> Result = List(A, B, C, D, E);
		Result.Add(F);
		return Result;
	}

	/** Light colours, linear RGB, before each room's own tint: COLOURS. */
	FVector Cold() { return FVector(0.82, 0.92, 1); }
	FVector ColdGreen() { return FVector(0.8, 1, 0.85); }
	FVector Warm() { return FVector(1, 0.85, 0.62); }
	FVector BulbColour() { return FVector(1, 0.72, 0.42); }
	FVector HighBay() { return FVector(0.95, 0.9, 0.8); }
	FVector Red() { return FVector(1, 0.08, 0.04); }
	FVector Amber() { return FVector(1, 0.42, 0.05); }
	FVector ExitColour() { return FVector(0.1, 1, 0.3); }
}

/** Furnishes one level: `Furnisher` in the TS. */
struct FFurnisher
{
	FRandom Random;
	FGenerated Generated;
	FBuilding Building;
	TArray<FLink> Links;
	FReach Reachable;
	TArray<FPlacedProp> Placed;
	TArray<FLightSpawn> Lights;
	/** Per storey (by Building.Slot), what props mustn't stand on, and what the building blocks. */
	TArray<FBoxList> Reserved;
	TArray<FLevelBoxList> Blockers;
	TArray<FTarget> Targets;
	TArray<FRoom> Rooms;
	FPoint StartPoint;
	int Dropped = 0;
	float FarthestCache = 0.0;
	/** Per storey, the grid points on the ways kept through rooms, which loose props keep off. */
	TArray<FPointSet> Routes;
	TSet<int> Routed;
	TMap<int, FHallAisles> HallAisles;

	void Start(int Seed, FGenerated InGenerated, FTileGrid Grid, TArray<FLevelBox> TileBoxes, FPoint InStart, TArray<FBoxXZ> KeepClear)
	{
		// `random(seed * 7919 + 17)`, `>>> 0 || 1` and all.
		Random.State = (int64(Seed) * 7919 + 17) & 0xFFFFFFFF;
		if (Random.State == 0)
			Random.State = 1;
		Generated = InGenerated;
		StartPoint = InStart;
		Building.Read(Grid);
		Links = Reach::LinksOf(Building);
		Reachable.Build(Building, TileBoxes, Links, InStart);
		Targets = Reach::TargetsOf(Building, Links, InStart);
		int Storeys = Building.StoreyCount();
		Reserved.SetNum(Storeys);
		Blockers.SetNum(Storeys);
		Routes.SetNum(Storeys);
		for (int Storey = -Building.Basements; Storey <= Building.Top; Storey++)
		{
			float Base = Storey * Tiles::STOREY;
			for (FLevelBox Box : TileBoxes)
			{
				if (Box.Y < Base + Tiles::STOREY - 0.01 && Box.Y + Box.Height > Base + 0.01)
					Blockers[Building.Slot(Storey)].Boxes.Add(Box);
			}
			if (Storey == InStart.Storey)
				Reserved[Building.Slot(Storey)].Boxes = KeepClear;
		}
		ReserveWaysThrough();
	}

	float Rng(float Min, float Max)
	{
		return Min + Random.Next() * (Max - Min);
	}

	bool Chance(float P)
	{
		return Random.Next() < P;
	}

	int PickIndex(int Count)
	{
		return Random.Below(Count);
	}

	EProp PickProp(TArray<EProp> List)
	{
		return List[Random.Below(List.Num())];
	}

	/** A pick from a list followed by `Nones` undefineds: false for one of those. */
	bool PickOrNone(TArray<EProp> List, int Nones, EProp&out Model)
	{
		int I = Random.Below(List.Num() + Nones);
		Model = List[0];
		if (I >= List.Num())
			return false;
		Model = List[I];
		return true;
	}

	/** What a chooser gives next; false for nothing. */
	bool Choose(FChooser Chooser, EProp&out Model)
	{
		Model = Chooser.List[0];
		if (Chooser.bChance)
			return Chance(Chooser.P);
		return PickOrNone(Chooser.List, Chooser.Nones, Model);
	}

	int RoomAt(int Storey, int Col, int Row) const
	{
		FCell Cell;
		Cell.Storey = Storey;
		Cell.Col = Col;
		Cell.Row = Row;
		return Generated.RoomAt(Cell);
	}

	int DistanceAt(int Storey, int Col, int Row) const
	{
		FCell Cell;
		Cell.Storey = Storey;
		Cell.Col = Col;
		Cell.Row = Row;
		return Generated.Distance(Cell);
	}

	/** The room a point is in, or -1. */
	int RoomOf(FPoint Point) const
	{
		return RoomAt(Point.Storey, Math::FloorToInt((Point.X - Building.X0) / Tiles::CELL), Math::FloorToInt((Point.Z - Building.Z0) / Tiles::CELL));
	}

	bool IsKind(int Room, ERoomKind Kind) const
	{
		return Room >= 0 && Room < Rooms.Num() && Generate::DressedAs(Rooms[Room].Kind) == Kind;
	}

	FFurnished Run()
	{
		MakeRooms();
		FitDoorways();
		// Cages first, so their fences go up before the halls round them fill.
		for (int I = 0; I < Rooms.Num(); I++)
		{
			if (Generate::DressedAs(Rooms[I].Kind) == ERoomKind::Cage)
				FenceCage(Rooms[I]);
		}
		for (int I = 0; I < Rooms.Num(); I++)
			FurnishRoom(Rooms[I]);
		// What each mode reaches in the bare building: only what was reached then is held to.
		Reachable.UpdateBare();
		for (int I = 0; I < Targets.Num(); I++)
		{
			int Modes = 0;
			for (int M = 0; M < 3; M++)
			{
				if (Targets[I].Has(EMover(M)) && Reachable.Reaches(EMover(M), Targets[I].Point))
					Modes |= 1 << M;
			}
			Targets[I].Modes = Modes;
		}
		ClearTheWay();
		LightRooms();
		HangThings();
		FFurnished Result;
		Result.Items = PlaceLoot();
		for (FPlacedProp Prop : Placed)
		{
			if (Prop.bRemoved)
				continue;
			Result.Props.Add(Prop.Spawn);
			if (Prop.bSolid && Prop.Mount == EPropMount::Floor)
				Result.Boxes.Add(Level::MakeLevelBox(Prop.Box, Prop.Bottom, Prop.Top - Prop.Bottom, Furnish::BoxKind(Prop.Spawn.Model)));
		}
		Result.Rooms = Rooms;
		Result.Lights = Lights;
		Result.Dropped = Dropped;
		return Result;
	}

	// ---- Rooms ----

	/** The level's rooms, with how far in each is, 0 at the entrance to 1 at the farthest. */
	void MakeRooms()
	{
		TArray<float> Averages;
		for (FGeneratedRoom Room : Generated.Rooms)
		{
			float Sum = 0.0;
			int Count = 0;
			for (FColRow Cell : Room.Cells)
			{
				int Here = DistanceAt(Room.Storey, Cell.Col, Cell.Row);
				if (Here >= 0)
				{
					Sum += Here;
					Count++;
				}
				else
				{
					// Open air: how far the floors round it are.
					for (int S = 0; S < 4; S++)
					{
						ESide Side = Tiles::SideAt(S);
						int There = DistanceAt(Room.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side));
						if (There >= 0)
						{
							Sum += There;
							Count++;
						}
					}
				}
			}
			Averages.Add(Count > 0 ? Sum / Count : 0.0);
		}
		float Farthest = 1.0;
		for (float Average : Averages)
			Farthest = Math::Max(Farthest, Average);
		Rooms.Reset();
		for (int Id = 0; Id < Generated.Rooms.Num(); Id++)
		{
			FGeneratedRoom Made = Generated.Rooms[Id];
			FRoom Room;
			Room.Id = Id;
			Room.Kind = Made.Kind;
			Room.Storey = Made.Storey;
			Room.Y = Made.Storey * Tiles::STOREY;
			Room.Cells = Made.Cells;
			for (int I = 0; I < Made.Cells.Num(); I++)
			{
				FBoxXZ Box = Building.CellBox(Made.Cells[I].Col, Made.Cells[I].Row);
				if (I == 0)
				{
					Room.Bounds = Box;
					continue;
				}
				Room.Bounds.MinX = Math::Min(Room.Bounds.MinX, Box.MinX);
				Room.Bounds.MaxX = Math::Max(Room.Bounds.MaxX, Box.MaxX);
				Room.Bounds.MinZ = Math::Min(Room.Bounds.MinZ, Box.MinZ);
				Room.Bounds.MaxZ = Math::Max(Room.Bounds.MaxZ, Box.MaxZ);
			}
			Room.Depth = Made.Kind == ERoomKind::Entrance ? 0.0 : Averages[Id] / Farthest;
			Rooms.Add(Room);
		}
	}

	/** How far in a point is, 0 at the entrance to 1 at the farthest cell. */
	float DepthAt(int Storey, float X, float Z)
	{
		int Here = DistanceAt(Storey, Math::FloorToInt((X - Building.X0) / Tiles::CELL), Math::FloorToInt((Z - Building.Z0) / Tiles::CELL));
		return Here < 0 ? 1.0 : Math::Min(1.0, Here / Farthest());
	}

	float Farthest()
	{
		if (FarthestCache > 0)
			return FarthestCache;
		float Most = 1.0;
		for (FGeneratedRoom Room : Generated.Rooms)
		{
			for (FColRow Cell : Room.Cells)
				Most = Math::Max(Most, float(Math::Max(0, DistanceAt(Room.Storey, Cell.Col, Cell.Row))));
		}
		FarthestCache = Most;
		return Most;
	}

	/** How dark a room is meant to be, 0 to 1: deeper, higher up and below ground are darker. */
	float Darkness(FRoom Room) const
	{
		if (Generate::DressedAs(Room.Kind) == ERoomKind::Entrance)
			return 0.0;
		float Height = Room.Storey < 0 ? 0.2 : Room.Storey * 0.08;
		return Math::Min(1.0, Room.Depth * 0.85 + Height);
	}

	// ---- Keeping the way clear ----

	void Keep(int Storey, FBoxXZ Box)
	{
		if (Building.HasStorey(Storey))
			Reserved[Building.Slot(Storey)].Boxes.Add(Box);
	}

	/** Keep doorways, both ends of stairs and ladders, and plank ends clear of props. */
	void ReserveWaysThrough()
	{
		for (int Storey = -Building.Basements; Storey <= Building.Top; Storey++)
		{
			for (int Row = 0; Row < Building.Rows; Row++)
			{
				for (int Col = 0; Col < Building.Cols; Col++)
				{
					FTile Tile = Building.Tile(Storey, Col, Row);
					for (int S = 0; S < 4; S++)
					{
						ESide Side = Tiles::SideAt(S);
						FOpening Opening;
						if (Tiles::OpeningOf(Building.Parsed.Edge(Storey, Col, Row, Side), Opening))
							Keep(Storey, Building.Strip(Col, Row, Side, Reach::KEEP_CLEAR, Opening.Width + 1));
					}
					if (Tile.Kind == ETileKind::Stairs || Tile.Kind == ETileKind::Ladder)
					{
						int Dx = Tiles::OffsetX(Tile.Up);
						int Dz = Tiles::OffsetZ(Tile.Up);
						Keep(Storey + 1, Building.Strip(Col + Dx, Row + Dz, Tiles::Opposite(Tile.Up), Reach::KEEP_CLEAR));
						if (Tile.Kind == ETileKind::Stairs)
							Keep(Storey, Building.Strip(Col - Dx, Row - Dz, Tile.Up, Reach::KEEP_CLEAR));
						else
							Keep(Storey, Building.CellBox(Col, Row));
					}
					if (Tile.Kind == ETileKind::Bridge)
					{
						for (int E = 0; E < 2; E++)
						{
							ESide Side = Tile.Along == ETileAxis::Z ? (E == 0 ? ESide::N : ESide::S) : (E == 0 ? ESide::E : ESide::W);
							int Dx = Tiles::OffsetX(Side);
							int Dz = Tiles::OffsetZ(Side);
							if (Building.Tile(Storey, Col + Dx, Row + Dz).Kind == ETileKind::Bridge)
								continue;
							Keep(Storey, Building.Strip(Col + Dx, Row + Dz, Tiles::Opposite(Side), Reach::KEEP_CLEAR, 2.4));
						}
					}
				}
			}
		}
	}

	/** The solid floor props on a storey, as boxes. */
	TArray<FBoxXZ> SolidsOn(int Storey) const
	{
		TArray<FBoxXZ> Boxes;
		for (FPlacedProp Prop : Placed)
		{
			if (!Prop.bRemoved && Prop.bSolid && Prop.Mount == EPropMount::Floor && Prop.Storey == Storey)
				Boxes.Add(Prop.Box);
		}
		return Boxes;
	}

	/** Every storey's solid floor props. */
	TArray<FBoxList> AllSolids() const
	{
		TArray<FBoxList> Result;
		Result.SetNum(Building.StoreyCount());
		for (FPlacedProp Prop : Placed)
		{
			if (!Prop.bRemoved && Prop.bSolid && Prop.Mount == EPropMount::Floor)
				Result[Building.Slot(Prop.Storey)].Boxes.Add(Prop.Box);
		}
		return Result;
	}

	/** The first mode a target held to that it can't be reached by now, or false if none. */
	bool LostMode(FTarget Target, EMover&out Mode) const
	{
		Mode = EMover::Walk;
		for (int M = 0; M < 3; M++)
		{
			if (Target.Has(EMover(M)) && !Reachable.Reaches(EMover(M), Target.Point))
			{
				Mode = EMover(M);
				return true;
			}
		}
		return false;
	}

	/**
	 * Take away props that block a way that was there before: for each point that can't be reached
	 * any more, the props across the shortest way to it, until everything is reached again.
	 */
	void ClearTheWay()
	{
		TArray<bool> Changed;
		Changed.SetNum(Building.StoreyCount());
		bool bAll = true;
		for (int Round = 0; Round < 400; Round++)
		{
			Reachable.Update(AllSolids(), bAll, Changed);
			bAll = false;
			for (int I = 0; I < Changed.Num(); I++)
				Changed[I] = false;
			TArray<FTarget> Lost;
			for (FTarget Target : Targets)
			{
				EMover Mode;
				if (LostMode(Target, Mode))
					Lost.Add(Target);
			}
			if (Lost.Num() == 0)
				return;
			bool bCleared = false;
			// The ways found so far, by mode and storey.
			TArray<int> WayKeys;
			TArray<FPathList> Ways;
			for (FTarget Target : Lost)
			{
				EMover Mode;
				LostMode(Target, Mode);
				int Key = int(Mode) * 1000 + Target.Point.Storey + 100;
				int Known = WayKeys.FindIndex(Key);
				if (Known < 0)
				{
					FPathList Way;
					Way.From = Reachable.WaysOn(Mode, Target.Point.Storey);
					WayKeys.Add(Key);
					Ways.Add(Way);
					Known = Ways.Num() - 1;
				}
				TArray<int> Path;
				if (!Reachable.TraceTo(Ways[Known].From, Target.Point, Path))
					continue;
				float Radius = Reach::Radius(Mode);
				float Limit = (Radius - 1e-6) * (Radius - 1e-6);
				TArray<int> Here;
				for (int P = 0; P < Placed.Num(); P++)
				{
					FPlacedProp Prop = Placed[P];
					if (!Prop.bRemoved && Prop.bSolid && Prop.Mount == EPropMount::Floor && Prop.Storey == Target.Point.Storey)
						Here.Add(P);
				}
				for (int K : Path)
				{
					float X = Reachable.PointX(K);
					float Z = Reachable.PointZ(K);
					for (int P : Here)
					{
						if (Placed[P].bRemoved)
							continue;
						FBoxXZ Box = Placed[P].Box;
						float Dx = Math::Max(Math::Max(Box.MinX - X, 0.0), X - Box.MaxX);
						float Dz = Math::Max(Math::Max(Box.MinZ - Z, 0.0), Z - Box.MaxZ);
						if (Dx * Dx + Dz * Dz < Limit)
						{
							Placed[P].bRemoved = true;
							Dropped++;
							bCleared = true;
							Changed[Building.Slot(Placed[P].Storey)] = true;
						}
					}
				}
			}
			if (!bCleared)
			{
				// Nothing to clear on the way to any of them: give up on the newest solid prop.
				int Last = -1;
				for (int P = Placed.Num() - 1; P >= 0; P--)
				{
					if (!Placed[P].bRemoved && Placed[P].bSolid && Placed[P].Mount == EPropMount::Floor)
					{
						Last = P;
						break;
					}
				}
				if (Last < 0)
					return;
				Placed[Last].bRemoved = true;
				Dropped++;
				Changed[Building.Slot(Placed[Last].Storey)] = true;
			}
		}
	}

	// ---- Placing ----

	/** Stand a prop on the floor of a storey, if it fits there; returns whether it did. */
	bool Stand(EProp Model, int Storey, float X, float Z, float Turn, int Room, bool bFence = false, bool bLoose = false)
	{
		FPropKind Kind = Props::Kind(Model);
		FBoxXZ Box = Reach::Footprint(Model, X, Z, Turn);
		float Base = Storey * Tiles::STOREY;
		for (FColRow Cell : Building.CellsUnder(Box))
		{
			if (!Building.Standable(Storey, Cell.Col, Cell.Row))
				return false;
			// Never across into another room, unless it's a cage's fence, between rooms.
			if (!bFence && Room >= 0 && RoomAt(Storey, Cell.Col, Cell.Row) != Room)
				return false;
		}
		for (FBoxXZ Kept : Reserved[Building.Slot(Storey)].Boxes)
		{
			if (Reach::Overlaps(Box, Kept))
				return false;
		}
		if (bLoose && OnRoute(Storey, Box))
			return false;
		float Top = Base + Kind.Height;
		// A fence's end posts may go into the wall they meet.
		float Margin = bFence ? -0.12 : 0.0;
		for (FLevelBox Blocker : Blockers[Building.Slot(Storey)].Boxes)
		{
			if (Blocker.Y < Top && Reach::Overlaps(Box, Blocker.Footprint(), Margin))
				return false;
		}
		for (FPlacedProp Other : Placed)
		{
			if (Other.bRemoved || Other.Storey != Storey || !Reach::Overlaps(Box, Other.Box))
				continue;
			if (Other.Mount == EPropMount::Floor)
				return false;
			// Under something hanging from the ceiling, only if it's lower.
			if (Other.Mount == EPropMount::Ceiling && Other.Bottom < Top + 0.05)
				return false;
			if (Other.Mount == EPropMount::Wall && Other.Bottom < Top + 0.05)
				return false;
		}
		Place(Model, Storey, X, Base, Z, Turn, Room, Box, Base, Top, EPropMount::Floor, Kind.bSolid);
		return true;
	}

	void Place(EProp Model, int Storey, float X, float Y, float Z, float Turn, int Room, FBoxXZ Box, float Bottom, float Top, EPropMount Mount, bool bSolid)
	{
		FPlacedProp Prop;
		Prop.Spawn.Model = Model;
		Prop.Spawn.X = X;
		Prop.Spawn.Y = Y;
		Prop.Spawn.Z = Z;
		Prop.Spawn.Turn = Turn;
		Prop.Spawn.Room = Room;
		Prop.Storey = Storey;
		Prop.Box = Box;
		Prop.Bottom = Bottom;
		Prop.Top = Top;
		Prop.Mount = Mount;
		Prop.bSolid = bSolid;
		Placed.Add(Prop);
	}

	/**
	 * Hang a prop from the ceiling of a storey, if there's a ceiling over all of it at one height and
	 * nothing in the way; returns whether it did.
	 */
	bool Hang(EProp Model, int Storey, float X, float Z, float Turn, int Room)
	{
		FBoxXZ Box = Reach::Footprint(Model, X, Z, Turn);
		bool bCeiling = false;
		float Ceiling = 0.0;
		for (FColRow Cell : Building.CellsUnder(Box))
		{
			float Here;
			if (!Building.Ceiling(Storey, Cell.Col, Cell.Row, Here) || (bCeiling && Math::Abs(Here - Ceiling) > 0.01))
				return false;
			Ceiling = Here;
			bCeiling = true;
		}
		if (!bCeiling)
			return false;
		FPropKind Kind = Props::Kind(Model);
		float Bottom = Ceiling - Kind.Height;
		for (FPlacedProp Other : Placed)
		{
			if (Other.bRemoved || Other.Storey != Storey || !Reach::Overlaps(Box, Other.Box, 0.05))
				continue;
			if (Other.Mount == EPropMount::Ceiling)
				return false;
			if (Other.Top > Bottom - 0.05)
				return false;
		}
		// Clear of walls, but for the ends of lengths of duct, pipe and tray, which go through them.
		FBoxXZ Clear = Box;
		if (Kind.Width >= Tiles::CELL)
		{
			if (Math::Abs(Math::Sin(Turn)) > 0.5)
			{
				Clear.MinZ += Tiles::WALL;
				Clear.MaxZ -= Tiles::WALL;
			}
			else
			{
				Clear.MinX += Tiles::WALL;
				Clear.MaxX -= Tiles::WALL;
			}
		}
		for (FLevelBox Blocker : Blockers[Building.Slot(Storey)].Boxes)
		{
			if (Blocker.Y < Ceiling - 0.01 && Blocker.Y + Blocker.Height > Bottom + 0.01 && Reach::Overlaps(Clear, Blocker.Footprint()))
				return false;
		}
		Place(Model, Storey, X, Ceiling, Z, Turn, Room, Box, Bottom, Ceiling, EPropMount::Ceiling, false);
		return true;
	}

	/** Hang a prop on a wall face, its bottom this high above the floor; returns whether it did. */
	bool Mount(EProp Model, FWallRun Run, float Along, float Height, int Room)
	{
		FPropKind Kind = Props::Kind(Model);
		if (Along - Kind.Width / 2 < Run.From || Along + Kind.Width / 2 > Run.To)
			return false;
		if (Height + Kind.Height > Run.Height)
			return false;
		ESide Faces = Tiles::Opposite(Run.Side);
		int Dx = Tiles::OffsetX(Faces);
		int Dz = Tiles::OffsetZ(Faces);
		bool bAlongX = Furnish::AlongX(Run.Side);
		float X = bAlongX ? Along : Run.Face;
		float Z = bAlongX ? Run.Face : Along;
		FBoxXZ Box = Reach::Footprint(Model, X + (Dx * Kind.Depth) / 2, Z + (Dz * Kind.Depth) / 2, Reach::Turn(Faces));
		float Base = Run.Storey * Tiles::STOREY;
		float Bottom = Base + Height;
		float Top = Bottom + Kind.Height;
		// Nothing standing in front of it that reaches up to it, nor anything else on the wall there.
		FBoxXZ Front = Reach::Footprint(Model, X + Dx * 0.35, Z + Dz * 0.35, Reach::Turn(Faces));
		for (FPlacedProp Other : Placed)
		{
			if (Other.bRemoved || Other.Storey != Run.Storey)
				continue;
			if (Other.Mount == EPropMount::Floor && Reach::Overlaps(Front, Other.Box) && Other.Top > Bottom - 0.05)
				return false;
			if (Other.Mount != EPropMount::Floor && Reach::Overlaps(Box, Other.Box, 0.05))
			{
				if (Other.Bottom < Top + 0.05 && Other.Top > Bottom - 0.05)
					return false;
			}
		}
		Place(Model, Run.Storey, X, Bottom, Z, Reach::Turn(Faces), Room, Box, Bottom, Top, EPropMount::Wall, false);
		return true;
	}

	/** Add a light. */
	void Light(ELightKind Kind, float X, float Y, float Z, float Turn, FVector Colour, float Power, ELightState State, int Room)
	{
		FLightSpawn Light;
		Light.Kind = Kind;
		Light.X = X;
		Light.Y = Y;
		Light.Z = Z;
		Light.Turn = Turn;
		Light.R = Colour.X;
		Light.G = Colour.Y;
		Light.B = Colour.Z;
		Light.Power = Power;
		Light.State = State;
		Light.Room = Room;
		Lights.Add(Light);
	}

	// ---- Walls ----

	/** The wall faces round a room, merged along each wall, with doorways and arches cut out. */
	TArray<FWallRun> WallRuns(FRoom Room) const
	{
		TArray<FWallRun> Pieces;
		float Height = Room.Storey == Building.Top ? Tiles::STOREY : Tiles::STOREY - Tiles::SLAB;
		for (FColRow Cell : Room.Cells)
		{
			if (!Building.Standable(Room.Storey, Cell.Col, Cell.Row))
				continue;
			FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
			for (int S = 0; S < 4; S++)
			{
				ESide Side = Tiles::SideAt(S);
				int Dx = Tiles::OffsetX(Side);
				int Dz = Tiles::OffsetZ(Side);
				EEdge Edge = Building.Parsed.Edge(Room.Storey, Cell.Col, Cell.Row, Side);
				FTile Next = Building.Tile(Room.Storey, Cell.Col + Dx, Cell.Row + Dz);
				bool bRock = Next.Kind == ETileKind::Solid || Next.Kind == ETileKind::None;
				if (Edge == EEdge::None && !bRock)
					continue;
				float Inset = Edge == EEdge::None ? 0.0 : Tiles::WALL / 2;
				bool bAlongX = Furnish::AlongX(Side);
				float Line = Reach::SideLine(Box, Side);
				float Face = Line - (Dx + Dz) * Inset;
				float From = bAlongX ? Box.MinX : Box.MinZ;
				float To = bAlongX ? Box.MaxX : Box.MaxZ;
				FWallRun Piece;
				Piece.Storey = Room.Storey;
				Piece.Side = Side;
				Piece.Face = Face;
				Piece.Height = Height;
				FOpening Opening;
				if (Tiles::OpeningOf(Edge, Opening))
				{
					float Middle = (From + To) / 2;
					Piece.From = From;
					Piece.To = Middle - Opening.Width / 2;
					Pieces.Add(Piece);
					Piece.From = Middle + Opening.Width / 2;
					Piece.To = To;
					Pieces.Add(Piece);
				}
				else
				{
					Piece.From = From;
					Piece.To = To;
					Pieces.Add(Piece);
				}
			}
		}
		// Join pieces end to end on the same face, then keep clear of the walls at the corners.
		for (int I = 1; I < Pieces.Num(); I++)
		{
			FWallRun Value = Pieces[I];
			int J = I - 1;
			while (J >= 0 && Furnish::PieceAfter(Pieces[J], Value))
			{
				Pieces[J + 1] = Pieces[J];
				J--;
			}
			Pieces[J + 1] = Value;
		}
		TArray<FWallRun> Runs;
		for (FWallRun Piece : Pieces)
		{
			if (Runs.Num() > 0)
			{
				FWallRun Last = Runs.Last();
				if (Last.Side == Piece.Side && Math::Abs(Last.Face - Piece.Face) < 0.001 && Math::Abs(Last.To - Piece.From) < 0.001)
				{
					Runs[Runs.Num() - 1].To = Piece.To;
					continue;
				}
			}
			Runs.Add(Piece);
		}
		TArray<FWallRun> Result;
		for (FWallRun Each : Runs)
		{
			FWallRun Run = Each;
			Run.From += Tiles::WALL / 2 + 0.02;
			Run.To -= Tiles::WALL / 2 + 0.02;
			if (Run.To - Run.From > 0.4)
				Result.Add(Run);
		}
		return Result;
	}

	/** Stand props along a wall, backs to it, one after another, each chosen as it comes. */
	int AlongWall(FWallRun Run, FRoom Room, FChooser Chooser, FAlongWall Options)
	{
		ESide Faces = Tiles::Opposite(Run.Side);
		int Dx = Tiles::OffsetX(Faces);
		int Dz = Tiles::OffsetZ(Faces);
		bool bAlongX = Furnish::AlongX(Run.Side);
		float At = Math::Max(Run.From, Options.bFrom ? Options.From : Run.From);
		float End = Math::Min(Run.To, Options.bTo ? Options.To : Run.To);
		int Count = 0;
		EProp Model;
		bool bModel = Choose(Chooser, Model);
		while (bModel)
		{
			FPropKind Kind = Props::Kind(Model);
			if (At + Kind.Width > End)
				break;
			float Middle = At + Kind.Width / 2;
			float Out = Kind.Depth / 2 + 0.02;
			float X = bAlongX ? Middle : Run.Face + Dx * Out;
			float Z = bAlongX ? Run.Face + Dz * Out : Middle;
			if (Chance(Options.Skip))
			{
				At += Kind.Width + Options.Gap;
				bModel = Choose(Chooser, Model);
			}
			else if (Stand(Model, Run.Storey, X, Z, Reach::Turn(Faces), Room.Id))
			{
				Count++;
				At += Kind.Width + Options.Gap;
				bModel = Choose(Chooser, Model);
			}
			else
			{
				At += Reach::STEP;
			}
		}
		return Count;
	}

	// ---- Doorways and cages ----

	/** A frame in every doorway, and a strip curtain in some between halls and the rooms behind. */
	void FitDoorways()
	{
		for (int Storey = -Building.Basements; Storey <= Building.Top; Storey++)
		{
			for (int Row = 0; Row < Building.Rows; Row++)
			{
				for (int Col = 0; Col < Building.Cols; Col++)
				{
					for (int S = 0; S < 2; S++)
					{
						ESide Side = Tiles::SideAt(S);
						if (Building.Parsed.Edge(Storey, Col, Row, Side) != EEdge::Door)
							continue;
						FBoxXZ Box = Building.CellBox(Col, Row);
						float X = Side == ESide::E ? Box.MaxX : (Box.MinX + Box.MaxX) / 2;
						float Z = Side == ESide::N ? Box.MaxZ : (Box.MinZ + Box.MaxZ) / 2;
						float Turn = Side == ESide::N ? 0.0 : Reach::PI_D / 2;
						int Room = RoomAt(Storey, Col, Row);
						int Other = RoomAt(Storey, Col + Tiles::OffsetX(Side), Row + Tiles::OffsetZ(Side));
						Fixture(EProp::DoorFrame, Storey, X, Z, Turn, Room);
						bool bHall = IsKind(Room, ERoomKind::Hall) || IsKind(Other, ERoomKind::Hall);
						bool bBehind = IsKind(Room, ERoomKind::Stock) || IsKind(Room, ERoomKind::Corridor) || IsKind(Room, ERoomKind::Workshop)
							|| IsKind(Other, ERoomKind::Stock) || IsKind(Other, ERoomKind::Corridor) || IsKind(Other, ERoomKind::Workshop);
						if (bHall && bBehind && Chance(0.6))
							Fixture(EProp::StripCurtain, Storey, X, Z, Turn, Room);
					}
				}
			}
		}
	}

	/** A prop in a doorway: placed where it must be, with nothing checked but that it's free. */
	void Fixture(EProp Model, int Storey, float X, float Z, float Turn, int Room)
	{
		FPropKind Kind = Props::Kind(Model);
		float Base = Storey * Tiles::STOREY;
		Place(Model, Storey, X, Base, Z, Turn, Room, Reach::Footprint(Model, X, Z, Turn), Base, Base + Kind.Height, EPropMount::Floor, Kind.bSolid);
	}

	/**
	 * Fence a cage in from its hall with chain-link panels, end to end along every edge between them,
	 * leaving one panel out for a gap to get in by, kept clear on both sides.
	 */
	void FenceCage(FRoom Room)
	{
		TArray<FCageEdge> Edges;
		for (FColRow Cell : Room.Cells)
		{
			for (int S = 0; S < 4; S++)
			{
				ESide Side = Tiles::SideAt(S);
				int Other = RoomAt(Room.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side));
				if (Other < 0 || !IsKind(Other, ERoomKind::Hall))
					continue;
				if (Building.Parsed.Edge(Room.Storey, Cell.Col, Cell.Row, Side) != EEdge::None)
					continue;
				FCageEdge Edge;
				Edge.Col = Cell.Col;
				Edge.Row = Cell.Row;
				Edge.Side = Side;
				Edges.Add(Edge);
			}
		}
		if (Edges.Num() == 0)
			return;
		// The gap: on an edge both sides of which can be stood on, if there is one.
		TArray<int> Open;
		for (int I = 0; I < Edges.Num(); I++)
		{
			FCageEdge Edge = Edges[I];
			if (Building.Standable(Room.Storey, Edge.Col, Edge.Row)
				&& Building.Standable(Room.Storey, Edge.Col + Tiles::OffsetX(Edge.Side), Edge.Row + Tiles::OffsetZ(Edge.Side)))
				Open.Add(I);
		}
		int GapEdge = Open.Num() > 0 ? Open[PickIndex(Open.Num())] : -1;
		int GapHalf = Chance(0.5) ? 0 : 1;
		float PanelWidth = Props::Kind(EProp::CagePanel).Width;
		for (int E = 0; E < Edges.Num(); E++)
		{
			FCageEdge Edge = Edges[E];
			FBoxXZ Box = Building.CellBox(Edge.Col, Edge.Row);
			bool bAlongX = Furnish::AlongX(Edge.Side);
			float Line = Reach::SideLine(Box, Edge.Side);
			float From = bAlongX ? Box.MinX : Box.MinZ;
			for (int Half = 0; Half < 2; Half++)
			{
				float Middle = From + PanelWidth / 2 + Half * PanelWidth;
				float X = bAlongX ? Middle : Line;
				float Z = bAlongX ? Line : Middle;
				if (E == GapEdge && Half == GapHalf)
				{
					int Dx = Tiles::OffsetX(Edge.Side);
					int Dz = Tiles::OffsetZ(Edge.Side);
					FBoxXZ Kept = Level::MakeBoxXZ(X - 0.95, X + 0.95, Z - 0.95, Z + 0.95);
					if (bAlongX)
					{
						Kept.MinZ = Z - Reach::KEEP_CLEAR;
						Kept.MaxZ = Z + Reach::KEEP_CLEAR;
					}
					else
					{
						Kept.MinX = X - Reach::KEEP_CLEAR;
						Kept.MaxX = X + Reach::KEEP_CLEAR;
					}
					Reserved[Building.Slot(Room.Storey)].Boxes.Add(Kept);
					for (int Sign = 1; Sign >= -1; Sign -= 2)
					{
						FPoint Point = Reach::MakePoint(Room.Storey, X + Sign * Dx * Reach::APPROACH, Z + Sign * Dz * Reach::APPROACH);
						Targets.Add(Reach::MakeTarget(Point, "the way into a cage"));
					}
					continue;
				}
				Stand(EProp::CagePanel, Room.Storey, X, Z, bAlongX ? 0.0 : Reach::PI_D / 2, Room.Id, true);
			}
		}
	}

	// ---- Rooms, by kind ----

	void FurnishRoom(FRoom Room)
	{
		FStyle Style;
		Style.Density = Rng(0.45, 1.15);
		Style.bRansacked = Generate::DressedAs(Room.Kind) != ERoomKind::Entrance && Chance(0.08 + Room.Depth * 0.25);
		switch (Generate::DressedAs(Room.Kind))
		{
			case ERoomKind::Entrance:
				FurnishBay(Room);
				return;
			case ERoomKind::Hall:
				FurnishHall(Room, Style);
				return;
			case ERoomKind::Cage:
				FurnishStore(Room, Style, true);
				return;
			case ERoomKind::Stock:
				FurnishStore(Room, Style, false);
				return;
			case ERoomKind::Workshop:
				FurnishWorkshop(Room, Style);
				return;
			case ERoomKind::Office:
				FurnishOffice(Room, Style);
				return;
			case ERoomKind::Staff:
				FurnishStaff(Room, Style);
				return;
			case ERoomKind::Plant:
				FurnishPlant(Room, Style);
				return;
			case ERoomKind::Corridor:
				FurnishCorridor(Room, Style);
				return;
			default:
				return;
		}
	}

	/** The bounds of a room's cells that can be stood on; false if there are none. */
	bool StandingBounds(FRoom Room, FBoxXZ&out Bounds) const
	{
		bool bAny = false;
		for (FColRow Cell : Room.Cells)
		{
			if (!Building.Standable(Room.Storey, Cell.Col, Cell.Row))
				continue;
			FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
			if (!bAny)
			{
				Bounds = Box;
				bAny = true;
				continue;
			}
			Bounds.MinX = Math::Min(Bounds.MinX, Box.MinX);
			Bounds.MaxX = Math::Max(Bounds.MaxX, Box.MaxX);
			Bounds.MinZ = Math::Min(Bounds.MinZ, Box.MinZ);
			Bounds.MaxZ = Math::Max(Bounds.MaxZ, Box.MaxZ);
		}
		return bAny;
	}

	/** The parts of the next bay of a row, as `bay()` in furnishHall makes them; returns its length. */
	float Bay(EBay Kind, ESide Across, ESide Lengthways, TArray<EProp> Goods, TArray<FBayPart>&out Parts)
	{
		Parts.Reset();
		if (Kind == EBay::Racking)
		{
			FBayPart First;
			First.Model = PickProp(Furnish::List(EProp::PalletRackA, EProp::PalletRackB));
			First.Offset = -0.55;
			First.Faces = Tiles::Opposite(Across);
			Parts.Add(First);
			FBayPart Second;
			Second.Model = PickProp(Furnish::List(EProp::PalletRackA, EProp::PalletRackB));
			Second.Offset = 0.55;
			Second.Faces = Across;
			Parts.Add(Second);
			return 2.7;
		}
		if (Kind == EBay::Containers)
		{
			FBayPart Part;
			Part.Model = PickProp(Furnish::List(EProp::ContainerA, EProp::ContainerB, EProp::ContainerC));
			Part.Offset = 0.0;
			Part.Faces = Chance(0.5) ? Lengthways : Tiles::Opposite(Lengthways);
			Parts.Add(Part);
			return 6.06 + 0.3;
		}
		EProp Model = PickProp(Goods);
		FPropKind Size = Props::Kind(Model);
		// Turned so its longer side runs along the row, two deep.
		bool bLong = Size.Width >= Size.Depth;
		float Length = Math::Max(Size.Width, Size.Depth) + 0.25;
		ESide Facing = bLong ? Across : Lengthways;
		float Half = Math::Min(Size.Width, Size.Depth) / 2 + 0.05;
		FBayPart First;
		First.Model = Model;
		First.Offset = -Half;
		First.Faces = Tiles::Opposite(Facing);
		Parts.Add(First);
		FBayPart Second;
		Second.Model = Model;
		Second.Offset = Half;
		Second.Faces = Facing;
		Parts.Add(Second);
		return Length;
	}

	/**
	 * Rows of something across a rectangle, along x or z, with aisles between them: each row is bays
	 * end to end, broken by a cross aisle now and then, each bay one or more props side by side across
	 * the row. Returns where the aisles run, across, for lights and signs to go over.
	 */
	TArray<float> Rows(FRoom Room, FBoxXZ Area, bool bAlongZ, EBay Kind, ESide Across, ESide Lengthways, TArray<EProp> Goods,
		float Depth, float Aisle, int CrossEvery, float Skip)
	{
		float A0 = bAlongZ ? Area.MinX : Area.MinZ;
		float A1 = bAlongZ ? Area.MaxX : Area.MaxZ;
		float L0 = bAlongZ ? Area.MinZ : Area.MinX;
		float L1 = bAlongZ ? Area.MaxZ : Area.MaxX;
		float Span = A1 - A0;
		int Count = Math::FloorToInt((Span + Aisle) / (Depth + Aisle));
		TArray<float> Aisles;
		if (Count <= 0)
			return Aisles;
		float Spare = Span - (Count * Depth + (Count - 1) * Aisle);
		for (int I = 0; I < Count; I++)
		{
			float AcrossAt = A0 + Spare / 2 + Depth / 2 + I * (Depth + Aisle);
			if (I > 0)
				Aisles.Add(AcrossAt - Depth / 2 - Aisle / 2);
			float At = L0;
			int InRow = 0;
			while (At < L1)
			{
				TArray<FBayPart> Parts;
				float Length = Bay(Kind, Across, Lengthways, Goods, Parts);
				if (At + Length > L1)
					break;
				if (CrossEvery > 0 && InRow >= CrossEvery)
				{
					At += 2.4;
					InRow = 0;
					continue;
				}
				float Middle = At + Length / 2;
				bool bAny = false;
				if (!Chance(Skip))
				{
					for (FBayPart Part : Parts)
					{
						float X = bAlongZ ? AcrossAt + Part.Offset : Middle;
						float Z = bAlongZ ? Middle : AcrossAt + Part.Offset;
						bAny = Stand(Part.Model, Room.Storey, X, Z, Reach::Turn(Part.Faces), Room.Id) || bAny;
					}
				}
				At += bAny ? Length : Reach::STEP * 2;
				if (bAny)
					InRow++;
			}
		}
		// The aisles, and the space along each side outside the rows too.
		return Aisles;
	}

	/** Points down the middle of an aisle that a sofa must still get along. */
	void AisleTargets(FRoom Room, FBoxXZ Area, bool bAlongZ, TArray<float> Aisles)
	{
		float L0 = bAlongZ ? Area.MinZ : Area.MinX;
		float L1 = bAlongZ ? Area.MaxZ : Area.MaxX;
		for (float AcrossAt : Aisles)
		{
			for (float At = L0 + 0.5; At <= L1 - 0.5; At += 0.5)
			{
				float X = bAlongZ ? AcrossAt : At;
				float Z = bAlongZ ? At : AcrossAt;
				FPoint Point = Reach::MakePoint(Room.Storey, X, Z);
				if (RoomOf(Point) != Room.Id)
					continue;
				Targets.Add(Reach::MakeTarget(Point, "an aisle", 1 << int(EMover::Wide)));
				int K = Reachable.Index(X, Z);
				if (K >= 0)
					Routes[Building.Slot(Room.Storey)].Points.Add(K);
			}
		}
	}

	/** Whether a box comes within half the clear width of a way kept through a room. */
	bool OnRoute(int Storey, FBoxXZ Box) const
	{
		FPointSet Route = Routes[Building.Slot(Storey)];
		if (Route.Points.Num() == 0)
			return false;
		float X0 = Building.X0;
		float Z0 = Building.Z0;
		float Wide = Reach::WIDE;
		float Limit = (Wide - 1e-6) * (Wide - 1e-6);
		for (int J = Math::CeilToInt((Box.MinZ - Wide - Z0) / Reach::STEP); J <= (Box.MaxZ + Wide - Z0) / Reach::STEP; J++)
		{
			float Z = Z0 + J * Reach::STEP;
			float Dz = Math::Max(Math::Max(Box.MinZ - Z, 0.0), Z - Box.MaxZ);
			for (int I = Math::CeilToInt((Box.MinX - Wide - X0) / Reach::STEP); I <= (Box.MaxX + Wide - X0) / Reach::STEP; I++)
			{
				float X = X0 + I * Reach::STEP;
				float Dx = Math::Max(Math::Max(Box.MinX - X, 0.0), X - Box.MaxX);
				if (Dx * Dx + Dz * Dz < Limit && Route.Points.Contains(J * Reachable.Nx + I))
					return true;
			}
		}
		return false;
	}

	/**
	 * Keep ways through a room as it stands now, from one of its doorways and ways up to each of the
	 * others, 1.4 m wide, for loose props to keep off: so they never cut a room in two.
	 */
	void KeepRoutes(FRoom Room)
	{
		if (Routed.Contains(Room.Id))
			return;
		Routed.Add(Room.Id);
		TArray<FPoint> Points;
		for (FTarget Target : Targets)
		{
			if (Target.Why != "an aisle" && Target.Point.Storey == Room.Storey && RoomOf(Target.Point) == Room.Id)
				Points.Add(Target.Point);
		}
		if (Points.Num() < 2)
			return;
		TArray<bool> Clear = Reachable.Clear(EMover::Wide, Room.Storey, SolidsOn(Room.Storey));
		int Nx = Reachable.Nx;
		TArray<int> From;
		From.SetNum(Clear.Num());
		for (int K = 0; K < From.Num(); K++)
			From[K] = -2;
		int First = Reachable.Index(Points[0].X, Points[0].Z);
		if (First < 0 || !Clear[First])
			return;
		// Within the room's bounds and a little round them.
		int I0 = Math::FloorToInt((Room.Bounds.MinX - 1 - Building.X0) / Reach::STEP);
		int I1 = Math::CeilToInt((Room.Bounds.MaxX + 1 - Building.X0) / Reach::STEP);
		int J0 = Math::FloorToInt((Room.Bounds.MinZ - 1 - Building.Z0) / Reach::STEP);
		int J1 = Math::CeilToInt((Room.Bounds.MaxZ + 1 - Building.Z0) / Reach::STEP);
		TArray<int> Queue;
		Queue.Add(First);
		From[First] = -1;
		for (int Head = 0; Head < Queue.Num(); Head++)
		{
			int At = Queue[Head];
			for (int Way = 0; Way < 4; Way++)
			{
				int Next = Reachable.Step(At, Way);
				if (Next < 0 || !Clear[Next] || From[Next] != -2)
					continue;
				int I = Next % Nx;
				int J = Math::IntegerDivisionTrunc(Next, Nx);
				if (I < I0 || I > I1 || J < J0 || J > J1)
					continue;
				From[Next] = At;
				Queue.Add(Next);
			}
		}
		int Slot = Building.Slot(Room.Storey);
		for (int P = 1; P < Points.Num(); P++)
		{
			int Goal = Reachable.Index(Points[P].X, Points[P].Z);
			if (Goal < 0 || From[Goal] == -2)
				continue;
			for (int K = Goal; K >= 0; K = From[K])
				Routes[Slot].Points.Add(K);
		}
	}

	/** Bits and pieces dropped about in the open: to the sides of the way, never across it. */
	void Scatter(FRoom Room, TArray<EProp> Models, int Count, float Jitter)
	{
		FBoxXZ Bounds;
		if (!StandingBounds(Room, Bounds))
			return;
		KeepRoutes(Room);
		int Done = 0;
		for (int Tries = 0; Done < Count && Tries < Count * 12; Tries++)
		{
			EProp Model = PickProp(Models);
			float X = Rng(Bounds.MinX + 0.5, Bounds.MaxX - 0.5);
			float Z = Rng(Bounds.MinZ + 0.5, Bounds.MaxZ - 0.5);
			float Turn = QuarterTurn(PickIndex(4)) + Rng(-Jitter, Jitter);
			if (Stand(Model, Room.Storey, X, Z, Turn, Room.Id, false, true))
				Done++;
		}
	}

	/** `[0, Math.PI / 2, Math.PI, -Math.PI / 2][index]`. */
	float QuarterTurn(int Index) const
	{
		if (Index == 1)
			return Reach::PI_D / 2;
		if (Index == 2)
			return Reach::PI_D;
		if (Index == 3)
			return -Reach::PI_D / 2;
		return 0.0;
	}

	void FurnishBay(FRoom Room)
	{
		// Kept mostly clear for coming and going: things along the walls, and a forklift parked.
		FAlongWall Options;
		Options.Gap = 0.6;
		Options.Skip = 0.35;
		FChooser Chooser = Furnish::Pick(Furnish::List(EProp::PalletStackA, EProp::PalletStackB, EProp::CrateLarge, EProp::Pallet, EProp::DrumGroup), 1);
		for (FWallRun Run : WallRuns(Room))
			AlongWall(Run, Room, Chooser, Options);
		Scatter(Room, Furnish::List(EProp::TrafficCone, EProp::HandTruck, EProp::WeighScale, EProp::Forklift), 3, 0.15);
	}

	void FurnishHall(FRoom Room, FStyle Style)
	{
		FBoxXZ Bounds;
		if (!StandingBounds(Room, Bounds))
			return;
		float Width = Bounds.MaxX - Bounds.MinX;
		float Depth = Bounds.MaxZ - Bounds.MinZ;
		bool bAlongZ = Depth >= Width * 0.8 ? Chance(0.75) : false;
		// "racking", "containers", "mixed" or "bulk".
		int Look = PickIndex(4);
		bool bContainers = Look == 1;
		bool bMixed = Look == 2;
		TArray<FWallRun> Runs = WallRuns(Room);
		// Against the walls: containers end to end, or racking.
		for (FWallRun Run : Runs)
		{
			if ((bContainers || bMixed) && Chance(0.7))
			{
				AlongWallLengthways(Run, Room, Furnish::List(EProp::ContainerA, EProp::ContainerB, EProp::ContainerC));
			}
			else if (Chance(0.8 * Style.Density + 0.2))
			{
				FAlongWall Options;
				Options.Skip = Style.bRansacked ? 0.3 : 0.05;
				AlongWall(Run, Room, Furnish::Pick(Furnish::List(EProp::PalletRackA, EProp::PalletRackB)), Options);
			}
		}
		// In the middle: rows, with an aisle round them.
		float Margin = 1.2 + 2.2;
		FBoxXZ Area = Level::MakeBoxXZ(Bounds.MinX + Margin, Bounds.MaxX - Margin, Bounds.MinZ + Margin, Bounds.MaxZ - Margin);
		float Aisle = Rng(2.2, 3) + (1 - Style.Density) * 0.8;
		ESide Across = bAlongZ ? ESide::E : ESide::N;
		ESide Lengthways = bAlongZ ? ESide::N : ESide::E;
		TArray<float> Aisles;
		float Skip = Style.bRansacked ? 0.25 : 0.03;
		TArray<EProp> NoGoods;
		if (Look == 0 || (bMixed && Chance(0.5)))
		{
			int CrossEvery = 3 + Math::FloorToInt(Random.Next() * 3);
			Aisles = Rows(Room, Area, bAlongZ, EBay::Racking, Across, Lengthways, NoGoods, 2.2, Aisle, CrossEvery, Skip);
		}
		else if (bContainers || bMixed)
		{
			int CrossEvery = 1 + Math::FloorToInt(Random.Next() * 2);
			Aisles = Rows(Room, Area, bAlongZ, EBay::Containers, Across, Lengthways, NoGoods, 2.44, Aisle, CrossEvery, Skip);
		}
		else
		{
			// Bulk: blocks of crates, drums, bags and reels.
			TArray<EProp> Goods = Furnish::List(EProp::CrateLarge, EProp::CrateStack, EProp::DrumGroup, EProp::BigBag, EProp::PalletStackA, EProp::PalletStackB);
			Goods.Add(EProp::WoodCrate);
			Goods.Add(EProp::CrateLong);
			Goods.Add(EProp::CableReel);
			Goods.Add(EProp::WrappedMachine);
			Goods.Add(EProp::IbcTank);
			Aisles = Rows(Room, Area, bAlongZ, EBay::Bulk, Across, Lengthways, Goods, 2.6, Aisle, 3, Style.bRansacked ? 0.35 : 0.12);
		}
		AisleTargets(Room, Area, bAlongZ, Aisles);
		FHallAisles Layout;
		Layout.bAlongZ = bAlongZ;
		Layout.Aisles = Aisles;
		Layout.Area = Area;
		HallAisles.Add(Room.Id, Layout);
		// A forklift, a scale, odds and ends.
		TArray<EProp> Extras = Furnish::List(EProp::Forklift, EProp::Pallet, EProp::HandTruck, EProp::TyreStack, EProp::RopeCoil, EProp::GasCage);
		Extras.Add(EProp::WeighScale);
		Extras.Add(EProp::Cardboard);
		Extras.Add(EProp::Barrel);
		Extras.Add(EProp::PlasticBarrel);
		Extras.Add(EProp::TrafficCone);
		Scatter(Room, Extras, Math::RoundToInt(4 * Style.Density + (Style.bRansacked ? 6 : 0)), Style.bRansacked ? 0.5 : 0.1);
	}

	/** Stand props lengthways along a wall, their sides to it: containers in a row. */
	void AlongWallLengthways(FWallRun Run, FRoom Room, TArray<EProp> Models)
	{
		ESide Faces = Tiles::Opposite(Run.Side);
		int Dx = Tiles::OffsetX(Faces);
		int Dz = Tiles::OffsetZ(Faces);
		bool bAlongX = Furnish::AlongX(Run.Side);
		float At = Run.From;
		while (At < Run.To)
		{
			EProp Model = PickProp(Models);
			FPropKind Kind = Props::Kind(Model);
			if (At + Kind.Depth > Run.To)
				break;
			float Middle = At + Kind.Depth / 2;
			float Out = Kind.Width / 2 + 0.05;
			float X = bAlongX ? Middle : Run.Face + Dx * Out;
			float Z = bAlongX ? Run.Face + Dz * Out : Middle;
			// Its doors to one end or the other, along the wall.
			ESide End = bAlongX ? (Chance(0.5) ? ESide::E : ESide::W) : (Chance(0.5) ? ESide::N : ESide::S);
			if (Stand(Model, Run.Storey, X, Z, Reach::Turn(End), Room.Id))
				At += Kind.Depth + Rng(0.2, 1.5);
			else
				At += Reach::STEP * 2;
		}
	}

	/** A storeroom, or a cage: shelving and racking round the walls, goods in the middle. */
	void FurnishStore(FRoom Room, FStyle Style, bool bCage)
	{
		TArray<EProp> Shelving = Furnish::List(EProp::WallShelfA, EProp::WallShelfB, EProp::PalletRackA, EProp::PalletRackB);
		if (!bCage)
			Shelving.Add(EProp::WallShelfA);
		FAlongWall Options;
		Options.Skip = Style.bRansacked ? 0.3 : 0.1 * (1.2 - Style.Density);
		for (FWallRun Run : WallRuns(Room))
		{
			EProp Kind = PickProp(Shelving);
			bool bRacks = Kind == EProp::PalletRackA || Kind == EProp::PalletRackB;
			FChooser Chooser = bRacks
				? Furnish::Pick(Furnish::List(EProp::PalletRackA, EProp::PalletRackB))
				: Furnish::Pick(Furnish::List(EProp::WallShelfA, EProp::WallShelfB));
			AlongWall(Run, Room, Chooser, Options);
		}
		TArray<EProp> Goods;
		if (bCage)
		{
			Goods = Furnish::List(EProp::CrateLarge, EProp::CrateLong, EProp::WrappedMachine, EProp::CrateStack, EProp::WoodBox, EProp::PalletStackA);
		}
		else
		{
			Goods = Furnish::List(EProp::CrateLarge, EProp::DrumGroup, EProp::BigBag, EProp::CableReel, EProp::PalletStackA, EProp::PalletStackB);
			Goods.Add(EProp::Cardboard);
			Goods.Add(EProp::WoodBox);
			Goods.Add(EProp::Barrel);
			Goods.Add(EProp::PlasticBarrel);
			Goods.Add(EProp::StepLift);
			Goods.Add(EProp::HandTruck);
		}
		int Cells = Room.Cells.Num();
		Scatter(Room, Goods, Math::RoundToInt(Cells * 1.6 * Style.Density + (Style.bRansacked ? Cells : 0)), Style.bRansacked ? 0.6 : 0.08);
	}

	void FurnishWorkshop(FRoom Room, FStyle Style)
	{
		FAlongWall Options;
		Options.Gap = 0.2;
		Options.Skip = 0.15;
		FChooser Chooser = Furnish::Pick(Furnish::List(EProp::Workbench, EProp::Workbench, EProp::ToolCabinet, EProp::WallShelfA, EProp::WallShelfB, EProp::GasCylinder), 1);
		for (FWallRun Run : WallRuns(Room))
			AlongWall(Run, Room, Chooser, Options);
		TArray<EProp> Models = Furnish::List(EProp::WrappedMachine, EProp::TyreStack, EProp::GasCage, EProp::DrumGroup, EProp::ToolCabinet, EProp::PlasticCanister);
		Models.Add(EProp::StepLift);
		Models.Add(EProp::CableReel);
		Scatter(Room, Models, Math::RoundToInt(Room.Cells.Num() * 1.2 * Style.Density), Style.bRansacked ? 0.5 : 0.1);
	}

	void FurnishOffice(FRoom Room, FStyle Style)
	{
		for (FWallRun Run : WallRuns(Room))
		{
			// Desks against the walls with a chair in front, filing cabinets between.
			ESide Faces = Tiles::Opposite(Run.Side);
			int Dx = Tiles::OffsetX(Faces);
			int Dz = Tiles::OffsetZ(Faces);
			bool bAlongX = Furnish::AlongX(Run.Side);
			float At = Run.From;
			while (At < Run.To - 0.5)
			{
				EProp Model = Chance(0.55) ? EProp::Desk : EProp::FilingCabinet;
				FPropKind Kind = Props::Kind(Model);
				if (At + Kind.Width > Run.To)
					break;
				float Middle = At + Kind.Width / 2;
				float Out = Kind.Depth / 2 + 0.02;
				float X = bAlongX ? Middle : Run.Face + Dx * Out;
				float Z = bAlongX ? Run.Face + Dz * Out : Middle;
				if (Chance(0.15 + 0.4 * (1.2 - Style.Density)))
				{
					At += Kind.Width;
				}
				else if (Stand(Model, Run.Storey, X, Z, Reach::Turn(Faces), Room.Id))
				{
					if (Model == EProp::Desk)
					{
						float Out2 = Kind.Depth + 0.35;
						float Cx = bAlongX ? Middle : Run.Face + Dx * Out2;
						float Cz = bAlongX ? Run.Face + Dz * Out2 : Middle;
						float Jitter = Style.bRansacked ? Rng(-1.2, 1.2) : Rng(-0.3, 0.3);
						Stand(EProp::OfficeChair, Run.Storey, Cx, Cz, Reach::Turn(Run.Side) + Jitter, Room.Id);
					}
					At += Kind.Width + 0.3;
				}
				else
				{
					At += Reach::STEP;
				}
			}
		}
		Scatter(Room, Furnish::List(EProp::TrashBin, EProp::WaterCooler, EProp::Cardboard, EProp::FilingCabinet),
			Math::RoundToInt(Room.Cells.Num() * Style.Density), Style.bRansacked ? 0.6 : 0.0);
	}

	void FurnishStaff(FRoom Room, FStyle Style)
	{
		TArray<FWallRun> Runs = WallRuns(Room);
		for (int I = 0; I < Runs.Num(); I++)
		{
			EProp What = EProp::LockerRow;
			if (I > 0 && !PickOrNone(Furnish::List(EProp::LockerRow, EProp::VendingMachine, EProp::WaterCooler), 1, What))
				continue;
			FChooser Chooser;
			Chooser.List.Add(What);
			Chooser.bChance = true;
			Chooser.P = 0.75;
			FAlongWall Options;
			Options.Gap = 0.1;
			AlongWall(Runs[I], Room, Chooser, Options);
		}
		// A table or two in the open, with chairs round it.
		KeepRoutes(Room);
		for (FColRow Cell : Room.Cells)
		{
			if (!Building.Standable(Room.Storey, Cell.Col, Cell.Row))
				continue;
			if (!Chance(0.6 * Style.Density + 0.2))
				continue;
			FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
			float X = (Box.MinX + Box.MaxX) / 2 + Rng(-0.4, 0.4);
			float Z = (Box.MinZ + Box.MaxZ) / 2 + Rng(-0.4, 0.4);
			float Turn = Chance(0.5) ? 0.0 : Reach::PI_D / 2;
			if (!Stand(EProp::StaffTable, Room.Storey, X, Z, Turn, Room.Id, false, true))
				continue;
			for (int Sign = 1; Sign >= -1; Sign -= 2)
			{
				float Ox = Turn == 0 ? 0.0 : Sign * 0.75;
				float Oz = Turn == 0 ? Sign * 0.75 : 0.0;
				float Jitter = Style.bRansacked ? Rng(-1.5, 1.5) : Rng(-0.25, 0.25);
				Stand(EProp::OfficeChair, Room.Storey, X + Ox, Z + Oz, (Sign > 0 ? Reach::PI_D : 0.0) + Turn + Jitter, Room.Id);
			}
		}
		Scatter(Room, Furnish::List(EProp::TrashBin), 1, 0);
	}

	void FurnishPlant(FRoom Room, FStyle Style)
	{
		FAlongWall Options;
		Options.Gap = 0.15;
		Options.Skip = 0.1;
		FChooser Chooser = Furnish::Pick(Furnish::List(EProp::Switchgear, EProp::ElectricalCabinet, EProp::ElectricalCabinet, EProp::Boiler, EProp::GasCylinder), 1);
		for (FWallRun Run : WallRuns(Room))
			AlongWall(Run, Room, Chooser, Options);
		Scatter(Room, Furnish::List(EProp::Boiler, EProp::Barrel, EProp::PlasticBarrel, EProp::IbcTank, EProp::GasCage, EProp::DrumGroup),
			Math::RoundToInt(Room.Cells.Num() * 0.8 * Style.Density), 0.1);
	}

	void FurnishCorridor(FRoom Room, FStyle Style)
	{
		// Mostly clear: now and then something left against a wall.
		FAlongWall Options;
		Options.Gap = 2;
		Options.Skip = 0.6 * (1.3 - Style.Density);
		FChooser Chooser = Furnish::Pick(Furnish::List(EProp::TrashBin, EProp::HandTruck, EProp::Cardboard, EProp::PlasticCanister), 3);
		for (FWallRun Run : WallRuns(Room))
			AlongWall(Run, Room, Chooser, Options);
	}

	// ---- Lights ----

	/** How a fitting in a room this dark, this far in, is doing. */
	ELightState LightState(bool bDark, float Depth)
	{
		if (bDark)
			return ELightState::Dead;
		if (Chance(Math::Max(0.0, (Depth - 0.15) * 0.7)))
			return ELightState::Dead;
		if (Chance(0.03 + Depth * 0.2))
			return ELightState::Flicker;
		return ELightState::On;
	}

	/** How a room's fitting at a point is doing: `state(x, z)` in lightRooms. */
	ELightState StateAt(FRoom Room, bool bDark, float Darkness, float X, float Z)
	{
		if (Generate::DressedAs(Room.Kind) == ERoomKind::Entrance)
			return ELightState::On;
		return LightState(bDark, Math::Max(Darkness, DepthAt(Room.Storey, X, Z) * 0.9));
	}

	/** A room's tint: each room's white differs a little from the next. */
	FVector Tint(FVector Colour)
	{
		float Warmth = Rng(-0.05, 0.05);
		float R = Math::Min(1.0, Math::Max(0.0, (Colour.X + Warmth) * Rng(0.95, 1)));
		float G = Math::Min(1.0, Math::Max(0.0, Colour.Y * Rng(0.95, 1)));
		float B = Math::Min(1.0, Math::Max(0.0, (Colour.Z - Warmth) * Rng(0.95, 1)));
		return FVector(R, G, B);
	}

	/** A ceiling tube with its light: `tube()` in lightRooms. */
	bool Tube(FRoom Room, bool bDark, float Darkness, float X, float Z, bool bAlongZ, FVector Colour, float Power = 1.0)
	{
		float Turn = bAlongZ ? Reach::PI_D / 2 : 0.0;
		if (!Hang(EProp::CeilingTube, Room.Storey, X, Z, Turn, Room.Id))
			return false;
		float Ceiling = Placed.Last().Top;
		Light(ELightKind::Tube, X, Ceiling - 0.06, Z, Turn, Colour, Power, StateAt(Room, bDark, Darkness, X, Z), Room.Id);
		return true;
	}

	void LightRooms()
	{
		for (FRoom Room : Rooms)
		{
			if (Generate::DressedAs(Room.Kind) == ERoomKind::Atrium)
				continue;
			float RoomDarkness = Darkness(Room);
			// Some deep rooms are dark altogether.
			bool bDark = Generate::DressedAs(Room.Kind) != ERoomKind::Entrance && RoomDarkness > 0.55 && Chance((RoomDarkness - 0.45) * 0.9);
			FBoxXZ Bounds;
			if (!StandingBounds(Room, Bounds))
				continue;
			switch (Generate::DressedAs(Room.Kind))
			{
				case ERoomKind::Hall:
				{
					// High-bay lamps over the aisles, a cell apart.
					FVector Colour = Tint(Furnish::HighBay());
					TArray<FGridLine> Lines;
					FHallAisles Layout;
					if (HallAisles.Find(Room.Id, Layout) && Layout.Aisles.Num() > 0)
					{
						for (float AcrossAt : Layout.Aisles)
						{
							FGridLine Line;
							Line.bAlongZ = Layout.bAlongZ;
							Line.Across = AcrossAt;
							Lines.Add(Line);
						}
					}
					else
					{
						Lines = GridLines(Bounds, 4, true);
					}
					for (FGridLine Line : Lines)
					{
						float L0 = Line.bAlongZ ? Bounds.MinZ : Bounds.MinX;
						float L1 = Line.bAlongZ ? Bounds.MaxZ : Bounds.MaxX;
						for (float At = L0 + 2; At < L1; At += Tiles::CELL)
						{
							float X = Line.bAlongZ ? Line.Across : At;
							float Z = Line.bAlongZ ? At : Line.Across;
							if (!Hang(EProp::HighBay, Room.Storey, X, Z, 0, Room.Id))
								continue;
							float Ceiling = Placed.Last().Top;
							Light(ELightKind::Bulb, X, Ceiling - 0.4, Z, 0, Colour, 1.6, StateAt(Room, bDark, RoomDarkness, X, Z), Room.Id);
						}
					}
					break;
				}
				case ERoomKind::Entrance:
				{
					// The loading bay is lit all over.
					FVector Colour = Tint(Furnish::Cold());
					for (FGridLine Line : GridLines(Bounds, 2.5, false))
					{
						for (float At = Bounds.MinX + 1.5; At < Bounds.MaxX - 1; At += 2.5)
							Tube(Room, bDark, RoomDarkness, At, Line.Across, false, Colour, 1.2);
					}
					break;
				}
				case ERoomKind::Stock:
				case ERoomKind::Cage:
				case ERoomKind::Workshop:
				case ERoomKind::Office:
				case ERoomKind::Corridor:
				{
					FVector Base = Generate::DressedAs(Room.Kind) == ERoomKind::Office ? Furnish::Warm() : Generate::DressedAs(Room.Kind) == ERoomKind::Corridor ? Furnish::Cold() : Furnish::ColdGreen();
					FVector Colour = Tint(Base);
					for (FColRow Cell : Room.Cells)
					{
						if (!Building.Standable(Room.Storey, Cell.Col, Cell.Row))
							continue;
						if (Generate::DressedAs(Room.Kind) == ERoomKind::Corridor && (Cell.Col + Cell.Row) % 2 == 1 && Chance(0.6))
							continue;
						FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
						bool bAlongZ = !LongAxisX(Room);
						float X = (Box.MinX + Box.MaxX) / 2;
						float Z = (Box.MinZ + Box.MaxZ) / 2;
						if (!Tube(Room, bDark, RoomDarkness, X, Z, bAlongZ, Colour))
						{
							// Something in the way in the middle: a little to one side.
							Tube(Room, bDark, RoomDarkness, X + (bAlongZ ? 1 : 0), Z + (bAlongZ ? 0 : 1), bAlongZ, Colour);
						}
					}
					break;
				}
				case ERoomKind::Staff:
				case ERoomKind::Plant:
				{
					FVector Colour = Tint(Furnish::BulbColour());
					TArray<FColRow> Cells;
					for (FColRow Cell : Room.Cells)
					{
						float Height;
						if (Building.Ceiling(Room.Storey, Cell.Col, Cell.Row, Height))
							Cells.Add(Cell);
					}
					int Count = Math::Max(1, Math::RoundToInt(Cells.Num() / 3.0));
					for (int I = 0; I < Count && Cells.Num() > 0; I++)
					{
						int Index = PickIndex(Cells.Num());
						FColRow Cell = Cells[Index];
						Cells.RemoveAt(Index);
						FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
						float Ceiling;
						Building.Ceiling(Room.Storey, Cell.Col, Cell.Row, Ceiling);
						float X = (Box.MinX + Box.MaxX) / 2;
						float Z = (Box.MinZ + Box.MaxZ) / 2;
						Light(ELightKind::Bulb, X, Ceiling - 0.3, Z, 0, Colour, 0.6, StateAt(Room, bDark, RoomDarkness, X, Z), Room.Id);
					}
					break;
				}
				default:
					break;
			}
		}
	}

	/** Lines a set distance apart across a box, running along an axis. */
	TArray<FGridLine> GridLines(FBoxXZ Bounds, float Spacing, bool bAlongZ) const
	{
		float A0 = bAlongZ ? Bounds.MinX : Bounds.MinZ;
		float A1 = bAlongZ ? Bounds.MaxX : Bounds.MaxZ;
		TArray<FGridLine> Lines;
		int Count = Math::Max(1, Math::FloorToInt((A1 - A0) / Spacing));
		float Spare = A1 - A0 - (Count - 1) * Spacing;
		for (int I = 0; I < Count; I++)
		{
			FGridLine Line;
			Line.bAlongZ = bAlongZ;
			Line.Across = A0 + Spare / 2 + I * Spacing;
			Lines.Add(Line);
		}
		return Lines;
	}

	/** Whether a room is longest along x: `longAxis(room) === "x"`. */
	bool LongAxisX(FRoom Room) const
	{
		return Room.Bounds.MaxX - Room.Bounds.MinX >= Room.Bounds.MaxZ - Room.Bounds.MinZ;
	}

	// ---- Fittings on walls and ceilings ----

	void HangThings()
	{
		for (FRoom Room : Rooms)
		{
			if (Generate::DressedAs(Room.Kind) == ERoomKind::Atrium)
				continue;
			TArray<FWallRun> Runs = WallRuns(Room);
			// An exit sign over the way out, and an extinguisher beside it.
			FExit Exit;
			if (ExitOf(Room, Exit))
			{
				if (Mount(EProp::ExitSign, Exit.Run, Exit.Along, Exit.Height, Room.Id))
				{
					FPropSpawn Sign = Placed.Last().Spawn;
					ESide Faces = Tiles::Opposite(Exit.Run.Side);
					Light(ELightKind::Exit, Sign.X + Tiles::OffsetX(Faces) * 0.08, Sign.Y + 0.1, Sign.Z + Tiles::OffsetZ(Faces) * 0.08, Sign.Turn,
						Furnish::ExitColour(), 0.15, ELightState::On, Room.Id);
				}
			}
			// Extinguishers: one in a small room, more in a big one.
			int Extinguishers = Math::Max(1, Math::RoundToInt(Room.Cells.Num() / 10.0));
			for (int I = 0; I < Extinguishers && Runs.Num() > 0; I++)
			{
				for (int Tries = 0; Tries < 8; Tries++)
				{
					FWallRun Run = Runs[PickIndex(Runs.Num())];
					if (Mount(EProp::FireExtinguisher, Run, Rng(Run.From + 0.3, Run.To - 0.3), 0.8, Room.Id))
						break;
				}
			}
			// Emergency lights: in plant rooms and anywhere below ground, red or amber.
			int Emergency = Generate::DressedAs(Room.Kind) == ERoomKind::Plant || Room.Storey < 0 ? Math::Max(1, Math::RoundToInt(Room.Cells.Num() / 4.0)) : 0;
			FVector Colour = Chance(0.5) ? Furnish::Red() : Furnish::Amber();
			for (int I = 0; I < Emergency && Runs.Num() > 0; I++)
			{
				for (int Tries = 0; Tries < 8; Tries++)
				{
					FWallRun Run = Runs[PickIndex(Runs.Num())];
					if (EmergencyLight(Run, Rng(Run.From + 0.3, Run.To - 0.3), Room, Colour))
						break;
				}
			}
			// Wall vents, high up.
			if (Runs.Num() > 0 && Chance(0.5))
			{
				FWallRun Run = Runs[PickIndex(Runs.Num())];
				Mount(EProp::WallVent, Run, Rng(Run.From + 0.4, Run.To - 0.4), 2.0, Room.Id);
			}
			CeilingRuns(Room);
			// Cameras in the corners of the bigger rooms.
			if (Generate::DressedAs(Room.Kind) == ERoomKind::Hall || Generate::DressedAs(Room.Kind) == ERoomKind::Entrance || Generate::DressedAs(Room.Kind) == ERoomKind::Cage || Generate::DressedAs(Room.Kind) == ERoomKind::Corridor)
			{
				FBoxXZ Bounds;
				if (StandingBounds(Room, Bounds))
				{
					for (int Corner = 0; Corner < 4; Corner++)
					{
						float X = Corner == 0 || Corner == 2 ? Bounds.MinX + 0.6 : Bounds.MaxX - 0.6;
						float Z = Corner == 0 || Corner == 3 ? Bounds.MinZ + 0.6 : Bounds.MaxZ - 0.6;
						if (Chance(0.5))
						{
							float Turn = Math::Atan2((Bounds.MinX + Bounds.MaxX) / 2 - X, (Bounds.MinZ + Bounds.MaxZ) / 2 - Z);
							Hang(EProp::CctvCamera, Room.Storey, X, Z, Turn, Room.Id);
						}
					}
				}
			}
			// Bay signs over the halls' aisles, at their ends.
			FHallAisles Layout;
			if (HallAisles.Find(Room.Id, Layout))
			{
				float L0 = Layout.bAlongZ ? Layout.Area.MinZ : Layout.Area.MinX;
				float L1 = Layout.bAlongZ ? Layout.Area.MaxZ : Layout.Area.MaxX;
				for (float AcrossAt : Layout.Aisles)
				{
					for (int End = 0; End < 2; End++)
					{
						float At = End == 0 ? L0 + 0.8 : L1 - 0.8;
						float X = Layout.bAlongZ ? AcrossAt : At;
						float Z = Layout.bAlongZ ? At : AcrossAt;
						Hang(EProp::BaySign, Room.Storey, X, Z, Layout.bAlongZ ? 0.0 : Reach::PI_D / 2, Room.Id);
					}
				}
			}
			// Air vents in the ceiling of offices and staff rooms.
			if (Generate::DressedAs(Room.Kind) == ERoomKind::Office || Generate::DressedAs(Room.Kind) == ERoomKind::Staff)
			{
				for (FColRow Cell : Room.Cells)
				{
					if (!Chance(0.5))
						continue;
					FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
					Hang(EProp::DuctVent, Room.Storey, Box.MinX + 1, Box.MinZ + 1, 0, Room.Id);
				}
			}
		}
		// An emergency light at every flight of stairs, at the bottom and the top.
		for (FLink Link : Links)
		{
			if (Link.bPlank)
				continue;
			for (int E = 0; E < 2; E++)
			{
				FPoint End = E == 0 ? Link.A : Link.B;
				int Col = Math::FloorToInt((End.X - Building.X0) / Tiles::CELL);
				int Row = Math::FloorToInt((End.Z - Building.Z0) / Tiles::CELL);
				int Room = RoomAt(End.Storey, Col, Row);
				if (Room < 0)
					continue;
				FBoxXZ Box = Building.CellBox(Col, Row);
				TArray<FWallRun> Runs;
				for (FWallRun Run : WallRuns(Rooms[Room]))
				{
					bool bAlongX = Furnish::AlongX(Run.Side);
					float C0 = bAlongX ? Box.MinX : Box.MinZ;
					float C1 = bAlongX ? Box.MaxX : Box.MaxZ;
					if (Run.From < C1 && Run.To > C0)
						Runs.Add(Run);
				}
				if (Runs.Num() > 0)
				{
					FWallRun Run = Runs[PickIndex(Runs.Num())];
					EmergencyLight(Run, Rng(Run.From + 0.3, Run.To - 0.3), Rooms[Room], Furnish::Amber());
				}
			}
		}
		// And an exit sign over the way out of the building.
		ExitOverEntrance();
	}

	bool EmergencyLight(FWallRun Run, float Along, FRoom Room, FVector Colour)
	{
		if (!Mount(EProp::EmergencyLight, Run, Along, 2.2, Room.Id))
			return false;
		FPropSpawn Fitting = Placed.Last().Spawn;
		ESide Faces = Tiles::Opposite(Run.Side);
		ELightState State = Chance(0.1 + Room.Depth * 0.15) ? ELightState::Flicker : ELightState::On;
		Light(ELightKind::Emergency, Fitting.X + Tiles::OffsetX(Faces) * 0.1, Fitting.Y + 0.07, Fitting.Z + Tiles::OffsetZ(Faces) * 0.1, Fitting.Turn,
			Colour, 0.3, State, Room.Id);
		return true;
	}

	void ExitOverEntrance()
	{
		for (FRoom Entrance : Rooms)
		{
			if (Entrance.Kind != ERoomKind::Entrance)
				continue;
			for (FWallRun Run : WallRuns(Entrance))
			{
				if (Run.Side != ESide::S || !(Run.From < StartPoint.X && Run.To > StartPoint.X))
					continue;
				if (!Mount(EProp::ExitSign, Run, StartPoint.X, 2.4, Entrance.Id))
					return;
				FPropSpawn Sign = Placed.Last().Spawn;
				Light(ELightKind::Exit, Sign.X, Sign.Y + 0.1, Sign.Z + 0.08, Sign.Turn, Furnish::ExitColour(), 0.15, ELightState::On, Entrance.Id);
				return;
			}
			return;
		}
	}

	/**
	 * The way out of a room: the doorway or arch onto the room nearest the entrance, and the wall over
	 * it, on this room's side, to hang an exit sign on.
	 */
	bool ExitOf(FRoom Room, FExit&out Exit) const
	{
		if (Generate::DressedAs(Room.Kind) == ERoomKind::Entrance)
			return false;
		bool bBest = false;
		int BestCol = 0;
		int BestRow = 0;
		ESide BestSide = ESide::N;
		int BestDistance = 0;
		for (FColRow Cell : Room.Cells)
		{
			for (int S = 0; S < 4; S++)
			{
				ESide Side = Tiles::SideAt(S);
				EEdge Edge = Building.Parsed.Edge(Room.Storey, Cell.Col, Cell.Row, Side);
				if (!Tiles::IsOpening(Edge))
					continue;
				int There = DistanceAt(Room.Storey, Cell.Col + Tiles::OffsetX(Side), Cell.Row + Tiles::OffsetZ(Side));
				int Here = DistanceAt(Room.Storey, Cell.Col, Cell.Row);
				if (There < 0 || Here < 0 || There >= Here)
					continue;
				if (!bBest || There < BestDistance)
				{
					bBest = true;
					BestCol = Cell.Col;
					BestRow = Cell.Row;
					BestSide = Side;
					BestDistance = There;
				}
			}
		}
		if (!bBest)
			return false;
		FBoxXZ Box = Building.CellBox(BestCol, BestRow);
		bool bAlongX = Furnish::AlongX(BestSide);
		float Line = Reach::SideLine(Box, BestSide);
		int Dx = Tiles::OffsetX(BestSide);
		int Dz = Tiles::OffsetZ(BestSide);
		FOpening Opening;
		bool bOpening = Tiles::OpeningOf(Building.Parsed.Edge(Room.Storey, BestCol, BestRow, BestSide), Opening);
		float Height = Room.Storey == Building.Top ? Tiles::STOREY : Tiles::STOREY - Tiles::SLAB;
		float Middle = bAlongX ? (Box.MinX + Box.MaxX) / 2 : (Box.MinZ + Box.MaxZ) / 2;
		// The lintel over the opening is the wall it hangs on.
		Exit.Run.Storey = Room.Storey;
		Exit.Run.Side = BestSide;
		Exit.Run.Face = Line - (Dx + Dz) * (Tiles::WALL / 2);
		Exit.Run.From = Middle - 1;
		Exit.Run.To = Middle + 1;
		Exit.Run.Height = Height;
		Exit.Along = Middle;
		Exit.Height = (bOpening ? Opening.Height : 2.2) + 0.06;
		return true;
	}

	/** Ducts, pipes and cable trays in lines under the ceiling of back-of-house rooms and halls. */
	void CeilingRuns(FRoom Room)
	{
		TArray<EProp> Options;
		switch (Generate::DressedAs(Room.Kind))
		{
			case ERoomKind::Plant:
				Options = Furnish::List(EProp::Duct, EProp::PipeRun, EProp::CableTray);
				break;
			case ERoomKind::Stock:
				Options = Furnish::List(EProp::PipeRun, EProp::CableTray);
				break;
			case ERoomKind::Corridor:
				Options = Furnish::List(EProp::CableTray, EProp::PipeRun, EProp::Duct);
				break;
			case ERoomKind::Workshop:
				Options = Furnish::List(EProp::Duct, EProp::CableTray);
				break;
			case ERoomKind::Hall:
				Options = Furnish::List(EProp::Duct, EProp::PipeRun);
				break;
			case ERoomKind::Cage:
				Options = Furnish::List(EProp::CableTray);
				break;
			default:
				return;
		}
		bool bAlongX = LongAxisX(Room);
		int Lines = Generate::DressedAs(Room.Kind) == ERoomKind::Hall || Generate::DressedAs(Room.Kind) == ERoomKind::Plant ? 2 : 1;
		for (int LineIndex = 0; LineIndex < Lines; LineIndex++)
		{
			EProp Model = PickProp(Options);
			// Off the middle of the cells, to miss the lights.
			int OffsetIndex = PickIndex(4);
			float Offset = OffsetIndex == 0 ? -1.3 : OffsetIndex == 1 ? 1.3 : OffsetIndex == 2 ? -0.9 : 0.9;
			TArray<FColRow> Cells;
			for (FColRow Cell : Room.Cells)
			{
				float Height;
				if (Building.Ceiling(Room.Storey, Cell.Col, Cell.Row, Height))
					Cells.Add(Cell);
			}
			// One line down a row or column of the room's cells.
			TArray<int> Lanes;
			for (FColRow Cell : Cells)
			{
				int Lane = bAlongX ? Cell.Row : Cell.Col;
				if (!Lanes.Contains(Lane))
					Lanes.Add(Lane);
			}
			if (Lanes.Num() == 0)
				continue;
			int Lane = Lanes[PickIndex(Lanes.Num())];
			for (FColRow Cell : Cells)
			{
				if ((bAlongX ? Cell.Row : Cell.Col) != Lane)
					continue;
				FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
				float X = bAlongX ? (Box.MinX + Box.MaxX) / 2 : (Box.MinX + Box.MaxX) / 2 + Offset;
				float Z = bAlongX ? (Box.MinZ + Box.MaxZ) / 2 + Offset : (Box.MinZ + Box.MaxZ) / 2;
				Hang(Model, Room.Storey, X, Z, bAlongX ? 0.0 : Reach::PI_D / 2, Room.Id);
			}
		}
	}

	// ---- Loot ----

	void AddLoot(TArray<FLoot>& Loot, EItemKind Kind, int Count, float Low, float High, TArray<ERoomKind> RoomKinds)
	{
		for (int I = 0; I < Count; I++)
		{
			FLoot Each;
			Each.Kind = Kind;
			Each.Low = Low;
			Each.High = High;
			Each.Rooms = RoomKinds;
			Loot.Add(Each);
		}
	}

	/**
	 * The items: flashlights by the entrance, and loot spread through the building, worth more the
	 * further in, the higher up and the darker it is, and most of all in the cages. Each where it can
	 * be reached the way it has to be carried, on clear floor, not in a doorway.
	 */
	TArray<FItemSpawn> PlaceLoot()
	{
		TArray<bool> NoneChanged;
		Reachable.Update(AllSolids(), true, NoneChanged);
		TArray<FItemSpawn> Items;
		for (int I = 0; I < 4; I++)
		{
			float Dx = I == 0 ? -1.5 : I == 1 ? -1.0 : I == 2 ? 1.0 : 1.5;
			Items.Add(Level::MakeItemSpawn(EItemKind::Flashlight, StartPoint.X + Dx, StartPoint.Storey * Tiles::STOREY + 0.05, StartPoint.Z + 1 + (I % 2) * 0.2));
		}
		// Every spot an item could go, scored by how far in, high up and dark it is.
		TArray<FSpot> Spots;
		for (FRoom Room : Rooms)
		{
			if (Generate::DressedAs(Room.Kind) == ERoomKind::Atrium || Generate::DressedAs(Room.Kind) == ERoomKind::Entrance || Generate::DressedAs(Room.Kind) == ERoomKind::Corridor)
				continue;
			float RoomDarkness = Darkness(Room);
			for (FColRow Cell : Room.Cells)
			{
				if (!Building.Standable(Room.Storey, Cell.Col, Cell.Row))
					continue;
				FBoxXZ Box = Building.CellBox(Cell.Col, Cell.Row);
				for (float X = Box.MinX + 0.75; X < Box.MaxX - 0.5; X += 1.25)
				{
					for (float Z = Box.MinZ + 0.75; Z < Box.MaxZ - 0.5; Z += 1.25)
					{
						float Height = Math::Abs(Room.Storey) / float(Math::Max(1, Building.Top));
						FSpot Spot;
						Spot.Point = Reach::MakePoint(Room.Storey, X, Z);
						Spot.Room = Room.Id;
						Spot.Score = 0.5 * DepthAt(Room.Storey, X, Z) + 0.2 * Height + 0.2 * RoomDarkness + (Generate::DressedAs(Room.Kind) == ERoomKind::Cage ? 0.35 : 0) + Rng(0, 0.1);
						Spots.Add(Spot);
					}
				}
			}
		}
		Furnish::SortSpots(Spots);
		// From the cheapest, wanted low in the order, to the dearest, wanted high.
		TArray<FLoot> Loot;
		TArray<ERoomKind> PhoneRooms;
		PhoneRooms.Add(ERoomKind::Hall);
		PhoneRooms.Add(ERoomKind::Stock);
		PhoneRooms.Add(ERoomKind::Office);
		PhoneRooms.Add(ERoomKind::Staff);
		PhoneRooms.Add(ERoomKind::Workshop);
		PhoneRooms.Add(ERoomKind::Cage);
		PhoneRooms.Add(ERoomKind::Plant);
		AddLoot(Loot, EItemKind::Phone, 12, 0, 0.8, PhoneRooms);
		TArray<ERoomKind> BoxRooms;
		BoxRooms.Add(ERoomKind::Hall);
		BoxRooms.Add(ERoomKind::Stock);
		BoxRooms.Add(ERoomKind::Cage);
		BoxRooms.Add(ERoomKind::Workshop);
		AddLoot(Loot, EItemKind::Box, 6, 0.15, 0.85, BoxRooms);
		TArray<ERoomKind> TvRooms;
		TvRooms.Add(ERoomKind::Hall);
		TvRooms.Add(ERoomKind::Stock);
		TvRooms.Add(ERoomKind::Cage);
		TvRooms.Add(ERoomKind::Office);
		AddLoot(Loot, EItemKind::Tv, 4, 0.45, 1, TvRooms);
		TArray<ERoomKind> SofaRooms;
		SofaRooms.Add(ERoomKind::Hall);
		SofaRooms.Add(ERoomKind::Cage);
		SofaRooms.Add(ERoomKind::Stock);
		AddLoot(Loot, EItemKind::Sofa, Chance(0.5) ? 2 : 1, 0.65, 1, SofaRooms);
		TArray<FPoint> Taken;
		for (FLoot Each : Loot)
		{
			FItemKindInfo Info = Items::Kind(Each.Kind);
			float W = Info.Size.X;
			float H = Info.Size.Y;
			float D = Info.Size.Z;
			EMover Mode = Each.Kind == EItemKind::Sofa ? EMover::Wide : Info.Hands == 2 ? EMover::Carry : EMover::Walk;
			int From = Math::FloorToInt(Each.Low * Spots.Num());
			int To = Math::Max(From + 1, Math::FloorToInt(Each.High * Spots.Num()));
			for (int Tries = 0; Tries < 80; Tries++)
			{
				int Index = From + Math::FloorToInt(Random.Next() * (To - From));
				if (Index < 0 || Index >= Spots.Num())
					continue;
				FSpot Spot = Spots[Index];
				if (!Each.Rooms.Contains(Generate::DressedAs(Rooms[Spot.Room].Kind)))
					continue;
				FPoint Point = Spot.Point;
				bool bNear = false;
				for (FPoint Other : Taken)
				{
					if (Other.Storey == Point.Storey && Math::Sqrt((Other.X - Point.X) * (Other.X - Point.X) + (Other.Z - Point.Z) * (Other.Z - Point.Z)) < 3)
						bNear = true;
				}
				if (bNear)
					continue;
				FBoxXZ Box = Level::MakeBoxXZ(Point.X - W / 2 - 0.15, Point.X + W / 2 + 0.15, Point.Z - D / 2 - 0.15, Point.Z + D / 2 + 0.15);
				if (!ClearFor(Point.Storey, Box))
					continue;
				if (!Reachable.Reaches(Mode, Point))
					continue;
				Taken.Add(Point);
				Items.Add(Level::MakeItemSpawn(Each.Kind, Point.X, Point.Storey * Tiles::STOREY + H / 2 + 0.05, Point.Z));
				break;
			}
		}
		return Items;
	}

	/** Whether a box of floor is clear of props, the building and doorways. */
	bool ClearFor(int Storey, FBoxXZ Box) const
	{
		for (FColRow Cell : Building.CellsUnder(Box))
		{
			if (!Building.Standable(Storey, Cell.Col, Cell.Row))
				return false;
		}
		for (FBoxXZ Kept : Reserved[Building.Slot(Storey)].Boxes)
		{
			if (Reach::Overlaps(Box, Kept))
				return false;
		}
		for (FLevelBox Blocker : Blockers[Building.Slot(Storey)].Boxes)
		{
			if (Reach::Overlaps(Box, Blocker.Footprint()))
				return false;
		}
		for (FPlacedProp Prop : Placed)
		{
			if (!Prop.bRemoved && Prop.Storey == Storey && Prop.Mount == EPropMount::Floor && Reach::Overlaps(Box, Prop.Box))
				return false;
		}
		return true;
	}
};

/** The ways found on a storey, as WaysOn gives them, so several can be kept in an array. */
struct FPathList
{
	TArray<int> From;
};
