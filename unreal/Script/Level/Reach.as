// What both furnishing a generated level (Furnish.as) and checking one (shared/levelCheck.ts) need
// to know about a building: mirrors `Building`, `linksOf`, `blocksOn`, `Reach` and `targetsOf` in
// shared/furnish.ts, number for number.
//
// How it differs from the TS, where Angelscript makes it:
// - Per-storey and per-mode maps of arrays are flat arrays, by `Slot()`.
// - `Reach.update` takes each storey's prop boxes as an FBoxList per storey, and which storeys
//   changed as bools, rather than a function and a set.

/**
 * Ways of getting about: anyone walking, up ladders and over planks; someone carrying a two-handed
 * thing, who can't climb; and two people with a sofa between them, who need 1.4 m and can't take a
 * plank either.
 */
enum EMover
{
	Walk,
	Carry,
	Wide,
};

/** A point on a storey. */
struct FPoint
{
	int Storey = 0;
	float X = 0.0;
	float Z = 0.0;
};

/** One way between two points that isn't across a floor: stairs, a ladder, a plank. */
struct FLink
{
	FPoint A;
	FPoint B;
	bool bLadder = false;
	bool bPlank = false;
};

/** A point that has to stay reachable, in the modes that reached it before anything was placed. */
struct FTarget
{
	FPoint Point;
	FString Why;
	/** Bits by EMover. */
	int Modes = 7;

	bool Has(EMover Mode) const
	{
		return (Modes & (1 << int(Mode))) != 0;
	}
};

/** A list of boxes, so lists of them can be kept in an array. */
struct FBoxList
{
	TArray<FBoxXZ> Boxes;
};

namespace Reach
{
	/** The clear width every way through keeps, halved. */
	const float WIDE = 0.7;
	/** The fine grid the flood fills go over, in meters. */
	const float STEP = 0.25;
	/** How far in front of a doorway, the foot of stairs and such the point that must be reached is. */
	const float APPROACH = 1.0;
	/** How deep the space kept clear in front of a doorway, stairs or a ladder is. */
	const float KEEP_CLEAR = 1.8;
	/** PLAYER_RADIUS, PLAYER_HEIGHT and STEP_UP in shared/constants.ts. */
	const float PLAYER_RADIUS = 0.3;
	const float PLAYER_HEIGHT = 1.8;
	const float STEP_UP = 0.35;
	/** Math.PI, as JS has it: Unreal's PI is single precision. */
	const float PI_D = 3.141592653589793;

	float Radius(EMover Mode)
	{
		return Mode == EMover::Wide ? WIDE : PLAYER_RADIUS;
	}

	/** Which way a prop faces that's turned towards a side: TURN. */
	float Turn(ESide Side)
	{
		switch (Side)
		{
			case ESide::N:
				return 0.0;
			case ESide::E:
				return PI_D / 2;
			case ESide::S:
				return PI_D;
			case ESide::W:
				return -PI_D / 2;
		}
		return 0.0;
	}

	/** Whether two boxes overlap by more than a hair. */
	bool Overlaps(FBoxXZ A, FBoxXZ B, float Margin = 0.0)
	{
		float E = 0.005 - Margin;
		return A.MinX < B.MaxX - E && B.MinX < A.MaxX - E && A.MinZ < B.MaxZ - E && B.MinZ < A.MaxZ - E;
	}

	/** The ground a prop covers, standing at a point and turned so. */
	FBoxXZ Footprint(EProp Model, float X, float Z, float Turn)
	{
		FPropKind Kind = Props::Kind(Model);
		float C = Math::Abs(Math::Cos(Turn));
		float S = Math::Abs(Math::Sin(Turn));
		float HalfX = (C * Kind.Width + S * Kind.Depth) / 2;
		float HalfZ = (S * Kind.Width + C * Kind.Depth) / 2;
		return Level::MakeBoxXZ(X - HalfX, X + HalfX, Z - HalfZ, Z + HalfZ);
	}

	/** What blocks a player standing on a storey: anything between a step up and their head. */
	bool BlocksOn(FLevelBox Box, int Storey)
	{
		float Base = Storey * Tiles::STOREY;
		return Box.Y < Base + PLAYER_HEIGHT - 0.001 && Box.Y + Box.Height > Base + STEP_UP + 0.001;
	}

	FPoint MakePoint(int Storey, float X, float Z)
	{
		FPoint Point;
		Point.Storey = Storey;
		Point.X = X;
		Point.Z = Z;
		return Point;
	}

	/** The coordinate of the line a side of a box is on: `{ n: maxZ, s: minZ, e: maxX, w: minX }[side]`. */
	float SideLine(FBoxXZ Box, ESide Side)
	{
		switch (Side)
		{
			case ESide::N:
				return Box.MaxZ;
			case ESide::S:
				return Box.MinZ;
			case ESide::E:
				return Box.MaxX;
			case ESide::W:
				return Box.MinX;
		}
		return 0.0;
	}

	/** Every flight of stairs, ladder and run of planks, from the floor at one end to the other. */
	TArray<FLink> LinksOf(FBuilding Building)
	{
		TArray<FLink> Links;
		for (int Storey = -Building.Basements; Storey <= Building.Top; Storey++)
		{
			for (int Row = 0; Row < Building.Rows; Row++)
			{
				for (int Col = 0; Col < Building.Cols; Col++)
				{
					FTile Tile = Building.Tile(Storey, Col, Row);
					if (Tile.Kind == ETileKind::Stairs || Tile.Kind == ETileKind::Ladder)
					{
						int Dx = Tiles::OffsetX(Tile.Up);
						int Dz = Tiles::OffsetZ(Tile.Up);
						FLink Link;
						Link.B = Building.InFront(Storey + 1, Col + Dx, Row + Dz, Tiles::Opposite(Tile.Up), APPROACH);
						Link.A = Tile.Kind == ETileKind::Stairs
							? Building.InFront(Storey, Col - Dx, Row - Dz, Tile.Up, APPROACH)
							: Building.InFront(Storey, Col, Row, Tile.Up, 0.6);
						Link.bLadder = Tile.Kind == ETileKind::Ladder;
						Links.Add(Link);
					}
					if (Tile.Kind == ETileKind::Bridge)
					{
						// From the start of each run of planks to its end.
						ESide Back = Tile.Along == ETileAxis::Z ? ESide::S : ESide::W;
						ESide Ahead = Tile.Along == ETileAxis::Z ? ESide::N : ESide::E;
						int Bx = Tiles::OffsetX(Back);
						int Bz = Tiles::OffsetZ(Back);
						if (Building.Tile(Storey, Col + Bx, Row + Bz).Kind == ETileKind::Bridge)
							continue;
						int Ax = Tiles::OffsetX(Ahead);
						int Az = Tiles::OffsetZ(Ahead);
						int EndCol = Col;
						int EndRow = Row;
						while (Building.Tile(Storey, EndCol + Ax, EndRow + Az).Kind == ETileKind::Bridge)
						{
							EndCol += Ax;
							EndRow += Az;
						}
						FLink Link;
						Link.A = Building.InFront(Storey, Col + Bx, Row + Bz, Ahead, APPROACH);
						Link.B = Building.InFront(Storey, EndCol + Ax, EndRow + Az, Back, APPROACH);
						Link.bPlank = true;
						Links.Add(Link);
					}
				}
			}
		}
		return Links;
	}

	FTarget MakeTarget(FPoint Point, FString Why, int Modes = 7)
	{
		FTarget Target;
		Target.Point = Point;
		Target.Why = Why;
		Target.Modes = Modes;
		return Target;
	}

	/** The points every level keeps reachable: doorways, both ends of every way up, where players start. */
	TArray<FTarget> TargetsOf(FBuilding Building, TArray<FLink> Links, FPoint Start)
	{
		TArray<FTarget> Targets;
		Targets.Add(MakeTarget(Start, "the entrance"));
		for (FLink Link : Links)
		{
			FString What = Link.bLadder ? "a ladder" : Link.bPlank ? "a plank" : "stairs";
			Targets.Add(MakeTarget(Link.A, "the foot of " + What));
			Targets.Add(MakeTarget(Link.B, "the top of " + What));
		}
		for (int Storey = -Building.Basements; Storey <= Building.Top; Storey++)
		{
			for (int Row = 0; Row < Building.Rows; Row++)
			{
				for (int Col = 0; Col < Building.Cols; Col++)
				{
					for (int S = 0; S < 2; S++)
					{
						ESide Side = Tiles::SideAt(S);
						int Dx = Tiles::OffsetX(Side);
						int Dz = Tiles::OffsetZ(Side);
						if (!Tiles::IsOpening(Building.Parsed.Edge(Storey, Col, Row, Side)))
							continue;
						if (!Building.Walkable(Storey, Col, Row))
							continue;
						if (!Building.Walkable(Storey, Col + Dx, Row + Dz))
							continue;
						Targets.Add(MakeTarget(Building.InFront(Storey, Col, Row, Side, APPROACH), "a doorway"));
						Targets.Add(MakeTarget(Building.InFront(Storey, Col + Dx, Row + Dz, Tiles::Opposite(Side), APPROACH), "a doorway"));
					}
				}
			}
		}
		return Targets;
	}
}

/** A grid of tiles, read, with what the layers above need to know about its cells. */
struct FBuilding
{
	FParsedGrid Parsed;
	float X0 = 0.0;
	float Z0 = 0.0;
	int Cols = 0;
	int Rows = 0;
	int Basements = 0;
	/** The highest storey. */
	int Top = 0;

	void Read(FTileGrid Grid)
	{
		Parsed = Tiles::ParseTiles(Grid);
		X0 = Grid.X;
		Z0 = Grid.Z;
		Cols = Parsed.Cols;
		Rows = Parsed.Rows;
		Basements = Parsed.Basements;
		Top = Parsed.Levels - Basements - 1;
	}

	/** How many storeys there are, and where one's things are kept in per-storey arrays. */
	int StoreyCount() const
	{
		return Top + Basements + 1;
	}

	int Slot(int Storey) const
	{
		return Storey + Basements;
	}

	bool HasStorey(int Storey) const
	{
		return Storey >= -Basements && Storey <= Top;
	}

	FTile Tile(int Storey, int Col, int Row) const
	{
		if (Storey < -Basements || Storey > Top)
			return FTile();
		return Parsed.Tile(Storey, Col, Row);
	}

	/** Somewhere to walk on: floor, a TV's floor, or a ladder's. */
	bool Walkable(int Storey, int Col, int Row) const
	{
		ETileKind Kind = Tile(Storey, Col, Row).Kind;
		return Kind == ETileKind::Floor || Kind == ETileKind::Tv || Kind == ETileKind::Ladder;
	}

	/** Somewhere a prop can stand: plain floor. */
	bool Standable(int Storey, int Col, int Row) const
	{
		ETileKind Kind = Tile(Storey, Col, Row).Kind;
		return Kind == ETileKind::Floor || Kind == ETileKind::Tv;
	}

	/**
	 * The underside of the ceiling over a cell, false where there isn't one: under the roof on the top
	 * storey, else under a floor slab above. Not over stairs, wells or open air.
	 */
	bool Ceiling(int Storey, int Col, int Row, float&out Height) const
	{
		Height = 0.0;
		if (!Walkable(Storey, Col, Row))
			return false;
		float Base = Storey * Tiles::STOREY;
		if (Storey == Top)
		{
			Height = Base + Tiles::STOREY;
			return true;
		}
		if (!Walkable(Storey + 1, Col, Row))
			return false;
		Height = Base + Tiles::STOREY - (Storey + 1 == 0 ? Tiles::GROUND : Tiles::SLAB);
		return true;
	}

	FBoxXZ CellBox(int Col, int Row) const
	{
		return Level::MakeBoxXZ(X0 + Col * Tiles::CELL, X0 + (Col + 1) * Tiles::CELL, Z0 + Row * Tiles::CELL, Z0 + (Row + 1) * Tiles::CELL);
	}

	/** The cells a box covers. */
	TArray<FColRow> CellsUnder(FBoxXZ Box) const
	{
		TArray<FColRow> Cells;
		int C0 = Math::FloorToInt((Box.MinX - X0 + 0.001) / Tiles::CELL);
		int C1 = Math::FloorToInt((Box.MaxX - X0 - 0.001) / Tiles::CELL);
		int R0 = Math::FloorToInt((Box.MinZ - Z0 + 0.001) / Tiles::CELL);
		int R1 = Math::FloorToInt((Box.MaxZ - Z0 - 0.001) / Tiles::CELL);
		for (int Row = R0; Row <= R1; Row++)
		{
			for (int Col = C0; Col <= C1; Col++)
			{
				FColRow Cell;
				Cell.Col = Col;
				Cell.Row = Row;
				Cells.Add(Cell);
			}
		}
		return Cells;
	}

	/** The point in a cell in the middle of its edge on one side, this far in. */
	FPoint InFront(int Storey, int Col, int Row, ESide Side, float Depth) const
	{
		FBoxXZ Box = CellBox(Col, Row);
		float X = (Box.MinX + Box.MaxX) / 2 + Tiles::OffsetX(Side) * (Tiles::CELL / 2 - Depth);
		float Z = (Box.MinZ + Box.MaxZ) / 2 + Tiles::OffsetZ(Side) * (Tiles::CELL / 2 - Depth);
		return Reach::MakePoint(Storey, X, Z);
	}

	/** The strip along a cell's side, this deep, as wide as asked and centred, or the whole side. */
	FBoxXZ Strip(int Col, int Row, ESide Side, float Depth, float Width = 4.0) const
	{
		FBoxXZ Box = CellBox(Col, Row);
		float MiddleX = (Box.MinX + Box.MaxX) / 2;
		float MiddleZ = (Box.MinZ + Box.MaxZ) / 2;
		FBoxXZ Result = Box;
		if (Side == ESide::N || Side == ESide::S)
		{
			Result.MinX = MiddleX - Width / 2;
			Result.MaxX = MiddleX + Width / 2;
		}
		else
		{
			Result.MinZ = MiddleZ - Width / 2;
			Result.MaxZ = MiddleZ + Width / 2;
		}
		if (Side == ESide::N)
			Result.MinZ = Box.MaxZ - Depth;
		else if (Side == ESide::S)
			Result.MaxZ = Box.MinZ + Depth;
		else if (Side == ESide::E)
			Result.MinX = Box.MaxX - Depth;
		else
			Result.MaxX = Box.MinX + Depth;
		return Result;
	}
};

/**
 * Where players can get to, over a fine grid on every storey: which points are clear of everything
 * by a mover's radius and joined to the entrance across floors, up stairs and ladders and over
 * planks, for each way of getting about.
 */
struct FReach
{
	FBuilding Building;
	TArray<FLink> Links;
	FPoint Start;
	int Nx = 0;
	int Nz = 0;
	/** Per storey, whether each point is over somewhere to walk: at Slot * N + k. */
	TArray<bool> Floor;
	/** Per mode (walk or wide) and storey, the points the building itself blocks: at (Mode * S + Slot) * N + k. */
	TArray<bool> Fixed;
	/** Per mode and storey, each point's patch of clear floor, -1 if blocked; whether there is one yet. */
	TArray<int> Labels;
	TArray<bool> Labelled;
	/** Per mode, the patches reached. */
	TSet<int> ReachedWalk;
	TSet<int> ReachedCarry;
	TSet<int> ReachedWide;

	void Build(FBuilding InBuilding, TArray<FLevelBox> FixedBoxes, TArray<FLink> InLinks, FPoint InStart)
	{
		Building = InBuilding;
		Links = InLinks;
		Start = InStart;
		int Per = Math::RoundToInt(Tiles::CELL / Reach::STEP);
		Nx = Building.Cols * Per + 1;
		Nz = Building.Rows * Per + 1;
		int N = Nx * Nz;
		int Storeys = Building.StoreyCount();
		Floor.SetNum(Storeys * N);
		Fixed.SetNum(3 * Storeys * N);
		Labels.SetNum(3 * Storeys * N);
		Labelled.SetNum(3 * Storeys);
		for (int I = 0; I < Labelled.Num(); I++)
			Labelled[I] = false;
		for (int Storey = -Building.Basements; Storey <= Building.Top; Storey++)
		{
			int Base = Building.Slot(Storey) * N;
			for (int J = 0; J < Nz; J++)
			{
				int Row0 = J % Per == 0 ? Math::IntegerDivisionTrunc(J, Per) - 1 : Math::IntegerDivisionTrunc(J, Per);
				int Row1 = Math::IntegerDivisionTrunc(J, Per);
				for (int I = 0; I < Nx; I++)
				{
					int Col0 = I % Per == 0 ? Math::IntegerDivisionTrunc(I, Per) - 1 : Math::IntegerDivisionTrunc(I, Per);
					int Col1 = Math::IntegerDivisionTrunc(I, Per);
					bool bOk = false;
					for (int Row = Row0; Row <= Row1; Row++)
					{
						for (int Col = Col0; Col <= Col1; Col++)
						{
							if (Building.Walkable(Storey, Col, Row))
								bOk = true;
						}
					}
					Floor[Base + J * Nx + I] = bOk;
				}
			}
			TArray<FLevelBox> Mine;
			for (FLevelBox Box : FixedBoxes)
			{
				if (Reach::BlocksOn(Box, Storey))
					Mine.Add(Box);
			}
			for (int M = 0; M < 3; M++)
			{
				if (EMover(M) == EMover::Carry)
					continue;
				int Fix = (M * Storeys + Building.Slot(Storey)) * N;
				for (int K = 0; K < N; K++)
					Fixed[Fix + K] = false;
				for (FLevelBox Box : Mine)
					MarkInto(Fixed, Fix, Box.Footprint(), Reach::Radius(EMover(M)));
			}
		}
	}

	/** The grid point nearest a place. */
	int Index(float X, float Z) const
	{
		int I = Math::RoundToInt((X - Building.X0) / Reach::STEP);
		int J = Math::RoundToInt((Z - Building.Z0) / Reach::STEP);
		if (I < 0 || J < 0 || I >= Nx || J >= Nz)
			return -1;
		return J * Nx + I;
	}

	/** Mark the points a box blocks for a mover of a radius, in an array from an offset. */
	void MarkInto(TArray<bool>& Blocked, int Offset, FBoxXZ Box, float Radius) const
	{
		float X0 = Building.X0;
		float Z0 = Building.Z0;
		float Limit = (Radius - 1e-6) * (Radius - 1e-6);
		int I0 = Math::Max(0, Math::CeilToInt((Box.MinX - Radius - X0) / Reach::STEP));
		int I1 = Math::Min(Nx - 1, Math::FloorToInt((Box.MaxX + Radius - X0) / Reach::STEP));
		int J0 = Math::Max(0, Math::CeilToInt((Box.MinZ - Radius - Z0) / Reach::STEP));
		int J1 = Math::Min(Nz - 1, Math::FloorToInt((Box.MaxZ + Radius - Z0) / Reach::STEP));
		for (int J = J0; J <= J1; J++)
		{
			float Z = Z0 + J * Reach::STEP;
			float Dz = Math::Max(Math::Max(Box.MinZ - Z, 0.0), Z - Box.MaxZ);
			for (int I = I0; I <= I1; I++)
			{
				float X = X0 + I * Reach::STEP;
				float Dx = Math::Max(Math::Max(Box.MinX - X, 0.0), X - Box.MaxX);
				if (Dx * Dx + Dz * Dz < Limit)
					Blocked[Offset + J * Nx + I] = true;
			}
		}
	}

	/** The points clear for a mode on a storey, with these props' boxes in the way too. */
	TArray<bool> Clear(EMover Mode, int Storey, TArray<FBoxXZ> PropBoxes) const
	{
		int N = Nx * Nz;
		int M = Mode == EMover::Carry ? int(EMover::Walk) : int(Mode);
		int Fix = (M * Building.StoreyCount() + Building.Slot(Storey)) * N;
		TArray<bool> Blocked;
		Blocked.SetNum(N);
		for (int K = 0; K < N; K++)
			Blocked[K] = Fixed[Fix + K];
		for (FBoxXZ Box : PropBoxes)
			MarkInto(Blocked, 0, Box, Reach::Radius(Mode));
		int FloorAt = Building.Slot(Storey) * N;
		for (int K = 0; K < N; K++)
			Blocked[K] = Floor[FloorAt + K] && !Blocked[K];
		return Blocked;
	}

	/** The grid point next to one, the way given (0 to 3), or -1 off the edge of the grid. */
	int Step(int At, int Way) const
	{
		int I = At % Nx;
		if (Way == 0)
			return I == 0 ? -1 : At - 1;
		if (Way == 1)
			return I == Nx - 1 ? -1 : At + 1;
		if (Way == 2)
			return At - Nx;
		int Next = At + Nx;
		return Next >= Nx * Nz ? -1 : Next;
	}

	int LabelSlot(EMover Mode, int Storey) const
	{
		return int(Mode) * Building.StoreyCount() + Building.Slot(Storey);
	}

	/**
	 * Work out what each mode reaches with these props in the way, by storey (`Props[Slot]`). Only the
	 * storeys whose `Changed[Slot]` is set are filled again, unless `bAll`: the others are as they were.
	 */
	void Update(TArray<FBoxList> Props, bool bAll, TArray<bool> Changed)
	{
		int N = Nx * Nz;
		for (int M = 0; M < 3; M++)
		{
			EMover Mode = EMover(M);
			for (int Storey = -Building.Basements; Storey <= Building.Top; Storey++)
			{
				int Slot = LabelSlot(Mode, Storey);
				bool bKept = !bAll && !Changed[Building.Slot(Storey)] && Labelled[Slot];
				if (Mode == EMover::Carry)
				{
					// Carrying is walking without ladders: the same patches.
					int Walk = LabelSlot(EMover::Walk, Storey);
					for (int K = 0; K < N; K++)
						Labels[Slot * N + K] = Labels[Walk * N + K];
				}
				else if (!bKept)
				{
					Patches(Clear(Mode, Storey, Props[Building.Slot(Storey)].Boxes), Slot * N);
				}
				Labelled[Slot] = true;
			}
			// Patches are numbered per storey: a node is the storey and the patch.
			TArray<int> EdgeA;
			TArray<int> EdgeB;
			for (FLink Link : Links)
			{
				if (Mode != EMover::Walk && Link.bLadder)
					continue;
				if (Mode == EMover::Wide && Link.bPlank)
					continue;
				int A = Node(Mode, Link.A);
				int B = Node(Mode, Link.B);
				if (A < 0 || B < 0)
					continue;
				EdgeA.Add(A);
				EdgeB.Add(B);
			}
			TSet<int> Reached;
			int First = Node(Mode, Start);
			if (First >= 0)
			{
				Reached.Add(First);
				bool bGrew = true;
				while (bGrew)
				{
					bGrew = false;
					for (int E = 0; E < EdgeA.Num(); E++)
					{
						bool bA = Reached.Contains(EdgeA[E]);
						bool bB = Reached.Contains(EdgeB[E]);
						if (bA == bB)
							continue;
						Reached.Add(bA ? EdgeB[E] : EdgeA[E]);
						bGrew = true;
					}
				}
			}
			if (Mode == EMover::Walk)
				ReachedWalk = Reached;
			else if (Mode == EMover::Carry)
				ReachedCarry = Reached;
			else
				ReachedWide = Reached;
		}
	}

	/** Update with nothing in the way but the building. */
	void UpdateBare()
	{
		TArray<FBoxList> None;
		None.SetNum(Building.StoreyCount());
		TArray<bool> Changed;
		Update(None, true, Changed);
	}

	/** The node of a point's patch, or -1 where it's blocked or off the grid. */
	int Node(EMover Mode, FPoint Point) const
	{
		if (!Building.HasStorey(Point.Storey))
			return -1;
		int Slot = LabelSlot(Mode, Point.Storey);
		int K = Index(Point.X, Point.Z);
		if (!Labelled[Slot] || K < 0)
			return -1;
		int Label = Labels[Slot * Nx * Nz + K];
		if (Label < 0)
			return -1;
		return (Point.Storey + 64) * 1000000 + Label;
	}

	bool ReachedHas(EMover Mode, int Node) const
	{
		if (Mode == EMover::Walk)
			return ReachedWalk.Contains(Node);
		if (Mode == EMover::Carry)
			return ReachedCarry.Contains(Node);
		return ReachedWide.Contains(Node);
	}

	/** Each clear point's patch, written into Labels from an offset: -1 where it isn't clear. */
	void Patches(TArray<bool> Clear, int Offset)
	{
		int N = Clear.Num();
		for (int K = 0; K < N; K++)
			Labels[Offset + K] = -1;
		TArray<int> Queue;
		Queue.SetNum(N);
		int Count = 0;
		for (int K = 0; K < N; K++)
		{
			if (!Clear[K] || Labels[Offset + K] >= 0)
				continue;
			int Head = 0;
			int Tail = 0;
			Queue[Tail++] = K;
			Labels[Offset + K] = Count;
			while (Head < Tail)
			{
				int At = Queue[Head++];
				int I = At % Nx;
				if (I > 0 && Clear[At - 1] && Labels[Offset + At - 1] < 0)
				{
					Labels[Offset + At - 1] = Count;
					Queue[Tail++] = At - 1;
				}
				if (I < Nx - 1 && Clear[At + 1] && Labels[Offset + At + 1] < 0)
				{
					Labels[Offset + At + 1] = Count;
					Queue[Tail++] = At + 1;
				}
				if (At >= Nx && Clear[At - Nx] && Labels[Offset + At - Nx] < 0)
				{
					Labels[Offset + At - Nx] = Count;
					Queue[Tail++] = At - Nx;
				}
				if (At + Nx < N && Clear[At + Nx] && Labels[Offset + At + Nx] < 0)
				{
					Labels[Offset + At + Nx] = Count;
					Queue[Tail++] = At + Nx;
				}
			}
			Count++;
		}
	}

	/** Whether a point can be got to, as of the last update. */
	bool Reaches(EMover Mode, FPoint Point) const
	{
		int At = Node(Mode, Point);
		return At >= 0 && ReachedHas(Mode, At);
	}

	/** Whether a grid point on a storey is reached, as of the last update. */
	bool ReachedAt(EMover Mode, int Storey, int K) const
	{
		int Slot = LabelSlot(Mode, Storey);
		if (!Labelled[Slot])
			return false;
		int Label = Labels[Slot * Nx * Nz + K];
		if (Label < 0)
			return false;
		return ReachedHas(Mode, (Storey + 64) * 1000000 + Label);
	}

	/**
	 * The ways from wherever on a storey is reached now, over what only the building blocks: for each
	 * grid point, the one before it on the shortest way to it, -1 where a way starts, -2 where none
	 * goes. TraceTo follows one back.
	 */
	TArray<int> WaysOn(EMover Mode, int Storey) const
	{
		TArray<FBoxXZ> NoProps;
		TArray<bool> Open = Clear(Mode, Storey, NoProps);
		int N = Open.Num();
		TArray<int> From;
		From.SetNum(N);
		TArray<int> Queue;
		Queue.SetNum(N);
		int Tail = 0;
		for (int K = 0; K < N; K++)
		{
			From[K] = -2;
			if (Open[K] && ReachedAt(Mode, Storey, K))
			{
				From[K] = -1;
				Queue[Tail++] = K;
			}
		}
		for (int Head = 0; Head < Tail; Head++)
		{
			int At = Queue[Head];
			for (int Way = 0; Way < 4; Way++)
			{
				int Next = Step(At, Way);
				if (Next < 0 || !Open[Next] || From[Next] != -2)
					continue;
				From[Next] = At;
				Queue[Tail++] = Next;
			}
		}
		return From;
	}

	/** The grid points of the way to a point, from WaysOn; false if none goes there. */
	bool TraceTo(TArray<int> From, FPoint Point, TArray<int>&out Path) const
	{
		Path.Reset();
		int Goal = Index(Point.X, Point.Z);
		if (Goal < 0 || From[Goal] == -2)
			return false;
		for (int K = Goal; K >= 0; K = From[K])
			Path.Add(K);
		return true;
	}

	/** Where a grid point is. */
	float PointX(int K) const
	{
		return Building.X0 + (K % Nx) * Reach::STEP;
	}

	float PointZ(int K) const
	{
		return Building.Z0 + Math::IntegerDivisionTrunc(K, Nx) * Reach::STEP;
	}
};
