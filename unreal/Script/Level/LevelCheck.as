// What's wrong with a furnished generated level, checked from the level alone, apart from how it
// was made: mirrors `checkLevel()` in shared/levelCheck.ts, message for message but for how numbers
// are written.
//
// - everything reachable in the bare building (doorways, both ends of stairs, ladders and planks,
//   where players start) still is, the same ways, including 1.4 m wide where it was;
// - every item can be reached the way it has to be carried, and isn't inside anything;
// - nothing solid stands in a doorway, on stairs, at a ladder, on the dock or where players start,
//   nor in a wall or in another prop;
// - floor props stand on floor, wall props hang on a wall that's there all across and up them, and
//   ceiling props under a ceiling, over a floor;
// - every tube, emergency light and exit sign has its fitting.
//
// The level's boxes must be its tiles' boxes, in order, then its props'. It takes an FWarehouse,
// until the `Level` all levels share is ported.

/** A place nothing solid may stand: where, from what height, and what it is. */
struct FKeepClear
{
	FBoxXZ Box;
	float Y = 0.0;
	FString Why;
};

/** A solid floor prop, for checking against the others and the walls. */
struct FSolidProp
{
	FBoxXZ Box;
	float Y = 0.0;
	float Top = 0.0;
	bool bFence = false;
};

/** A stretch of wall behind a wall prop, along it. */
struct FSpan
{
	float Lo = 0.0;
	float Hi = 0.0;
};

namespace LevelCheck
{
	FString Where(FPoint Point)
	{
		return f"({Point.X:.1}, {Point.Z:.1}) on storey {Point.Storey}";
	}

	FString ModeName(EMover Mode)
	{
		if (Mode == EMover::Carry)
			return "carry";
		if (Mode == EMover::Wide)
			return "wide";
		return "walk";
	}

	FString BoxKindName(ELevelBoxKind Kind)
	{
		switch (Kind)
		{
			case ELevelBoxKind::Wall: return "wall";
			case ELevelBoxKind::Partition: return "partition";
			case ELevelBoxKind::Shelf: return "shelf";
			case ELevelBoxKind::Rail: return "rail";
			case ELevelBoxKind::Pit: return "pit";
			case ELevelBoxKind::Stairs: return "stairs";
			case ELevelBoxKind::Furniture: return "furniture";
			case ELevelBoxKind::Scenery: return "scenery";
			case ELevelBoxKind::Mesh: return "mesh";
		}
		return "";
	}

	FString LightKindName(ELightKind Kind)
	{
		switch (Kind)
		{
			case ELightKind::Tube: return "tube";
			case ELightKind::Bulb: return "bulb";
			case ELightKind::Emergency: return "emergency";
			case ELightKind::Exit: return "exit";
		}
		return "";
	}

	FKeepClear MakeKeepClear(FBoxXZ Box, float Y, FString Why)
	{
		FKeepClear Zone;
		Zone.Box = Box;
		Zone.Y = Y;
		Zone.Why = Why;
		return Zone;
	}

	bool Over(FFloor Floor, float X, float Z)
	{
		return X >= Floor.MinX - 0.001 && X <= Floor.MaxX + 0.001 && Z >= Floor.MinZ - 0.001 && Z <= Floor.MaxZ + 0.001;
	}

	/** Flat floor, or stairs where they're at that height: a doorway can open onto either. */
	bool FloorAt(FWarehouse Level, float X, float Z, float Y)
	{
		for (FFloor Floor : Level.Tiles.Floors)
		{
			if (Floor.Kind == EFloorKind::Ground)
				continue;
			if (Over(Floor, X, Z) && Math::Abs(Level::FloorHeight(Floor, X, Z) - Y) < 0.15)
				return true;
		}
		return false;
	}

	bool CeilingAt(FWarehouse Level, float X, float Z, float Y)
	{
		for (FFloor Floor : Level.Tiles.Floors)
		{
			if (Floor.Kind == EFloorKind::Floor && Math::Abs(Floor.Y - Floor.Thickness - Y) < 0.01 && Over(Floor, X, Z))
				return true;
		}
		return Math::Abs(Level.Roof - Y) < 0.01;
	}

	/** A box's corners, this far in: the TS's order. */
	TArray<FVector2D> Corners(FBoxXZ Box, float Inset)
	{
		TArray<FVector2D> Result;
		Result.Add(FVector2D(Box.MinX + Inset, Box.MinZ + Inset));
		Result.Add(FVector2D(Box.MaxX - Inset, Box.MinZ + Inset));
		Result.Add(FVector2D(Box.MinX + Inset, Box.MaxZ - Inset));
		Result.Add(FVector2D(Box.MaxX - Inset, Box.MaxZ - Inset));
		return Result;
	}

	/** The problems with a level, or none. */
	TArray<FString> Check(FWarehouse Level)
	{
		TArray<FString> Problems;
		FBuilding Building;
		Building.Read(Level.Grid);
		TArray<FLevelBox> Bare = Tiles::ComposeTiles(Level.Grid).Boxes;
		TArray<FLink> Links = Reach::LinksOf(Building);
		FVector Spawn = Level.SpawnPoint(1);
		FPoint Start = Reach::MakePoint(0, Spawn.X, Spawn.Z);

		// Reachability, before and after.
		FReach Before;
		Before.Build(Building, Bare, Links, Start);
		Before.UpdateBare();
		FReach After;
		After.Build(Building, Level.Boxes, Links, Start);
		After.UpdateBare();
		for (FTarget Target : Reach::TargetsOf(Building, Links, Start))
		{
			for (int M = 0; M < 3; M++)
			{
				EMover Mode = EMover(M);
				if (Before.Reaches(Mode, Target.Point) && !After.Reaches(Mode, Target.Point))
					Problems.Add(f"{Target.Why} at {Where(Target.Point)} can't be reached ({ModeName(Mode)}) any more");
			}
		}
		for (FItemSpawn Item : Level.Items)
		{
			int Storey = Math::FloorToInt((Item.Y + 0.5) / Tiles::STOREY);
			FPoint Point = Reach::MakePoint(Storey, Item.X, Item.Z);
			FItemKindInfo Info = Items::Kind(Item.Kind);
			EMover Mode = Info.Carriers == 2 ? EMover::Wide : Info.Hands == 2 ? EMover::Carry : EMover::Walk;
			FString Kind = Items::KindName(Item.Kind);
			if (!After.Reaches(Mode, Point))
				Problems.Add(f"a {Kind} at {Where(Point)} can't be reached ({ModeName(Mode)})");
			FBoxXZ Box = Level::MakeBoxXZ(Item.X - Info.Size.X / 2, Item.X + Info.Size.X / 2, Item.Z - Info.Size.Z / 2, Item.Z + Info.Size.Z / 2);
			for (FLevelBox Other : Level.Boxes)
			{
				if (Reach::BlocksOn(Other, Storey) && Reach::Overlaps(Box, Other.Footprint()))
				{
					Problems.Add(f"a {Kind} at {Where(Point)} is inside something");
					break;
				}
			}
		}

		// Places nothing solid stands.
		TArray<FKeepClear> KeepClear;
		KeepClear.Add(MakeKeepClear(Level.Dock, 0, "the dock"));
		for (int I = 0; I < 3; I++)
		{
			FVector At = Level.SpawnPoint(I);
			float R = Reach::PLAYER_RADIUS;
			KeepClear.Add(MakeKeepClear(Level::MakeBoxXZ(At.X - R, At.X + R, At.Z - R, At.Z + R), 0, "where players start"));
		}
		for (FLadder Ladder : Level.Tiles.Ladders)
			KeepClear.Add(MakeKeepClear(Ladder.Footprint(), Ladder.Y, "a ladder"));
		for (FFloor Floor : Level.Tiles.Floors)
		{
			if (Floor.Kind == EFloorKind::Stairs)
				KeepClear.Add(MakeKeepClear(Floor.Footprint(), Floor.Y, "stairs"));
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
						FOpening Opening;
						if (!Tiles::OpeningOf(Building.Parsed.Edge(Storey, Col, Row, Side), Opening))
							continue;
						int Dx = Tiles::OffsetX(Side);
						int Dz = Tiles::OffsetZ(Side);
						KeepClear.Add(MakeKeepClear(Building.Strip(Col, Row, Side, 0.6, Opening.Width), Storey * Tiles::STOREY, "a doorway"));
						KeepClear.Add(MakeKeepClear(Building.Strip(Col + Dx, Row + Dz, Tiles::Opposite(Side), 0.6, Opening.Width), Storey * Tiles::STOREY, "a doorway"));
					}
				}
			}
		}
		for (int I = Bare.Num(); I < Level.Boxes.Num(); I++)
		{
			FLevelBox Box = Level.Boxes[I];
			int Storey = Math::RoundToInt(Box.Y / Tiles::STOREY);
			for (FKeepClear Zone : KeepClear)
			{
				if (Math::Abs(Zone.Y - Box.Y) < Tiles::STOREY / 2 && Reach::Overlaps(Box.Footprint(), Zone.Box))
				{
					FPoint Middle = Reach::MakePoint(Storey, (Box.MinX + Box.MaxX) / 2, (Box.MinZ + Box.MaxZ) / 2);
					Problems.Add(f"a prop at {Where(Middle)} stands on {Zone.Why}");
				}
			}
		}

		// Props where they belong.
		TArray<FSolidProp> Solids;
		for (FPropSpawn Prop : Level.Props)
		{
			FPropKind Kind = Props::Kind(Prop.Model);
			int Base = Math::FloorToInt((Prop.Y - (Kind.Mount == EPropMount::Ceiling ? 0.01 : -0.01)) / Tiles::STOREY);
			FString At = f"{Props::Name(Prop.Model)} at {Where(Reach::MakePoint(Base, Prop.X, Prop.Z))}";
			if (Kind.Mount == EPropMount::Floor)
			{
				FBoxXZ Box = Reach::Footprint(Prop.Model, Prop.X, Prop.Z, Prop.Turn);
				int Off = 0;
				for (FVector2D Corner : Corners(Box, 0.02))
				{
					if (!FloorAt(Level, Corner.X, Corner.Y, Prop.Y))
						Off++;
				}
				// What stands in a doorway needs floor on one side: the other may be where a ladder arrives.
				bool bDoorway = Prop.Model == EProp::DoorFrame || Prop.Model == EProp::StripCurtain;
				if (Off > (bDoorway ? 2 : 0))
					Problems.Add(f"{At} isn't on a floor");
				if (Kind.bSolid)
				{
					FSolidProp Solid;
					Solid.Box = Box;
					Solid.Y = Prop.Y;
					Solid.Top = Prop.Y + Kind.Height;
					Solid.bFence = Prop.Model == EProp::CagePanel;
					Solids.Add(Solid);
				}
			}
			else if (Kind.Mount == EPropMount::Ceiling)
			{
				FBoxXZ Box = Reach::Footprint(Prop.Model, Prop.X, Prop.Z, Prop.Turn);
				for (FVector2D Corner : Corners(Box, 0.05))
				{
					if (!CeilingAt(Level, Corner.X, Corner.Y, Prop.Y))
						Problems.Add(f"{At} isn't under a ceiling");
					else if (!FloorAt(Level, Corner.X, Corner.Y, Base * Tiles::STOREY))
						Problems.Add(f"{At} hangs over no floor");
				}
			}
			else
			{
				// Its back against the face of a wall that's there all across it and all the way up it.
				bool bFacing = false;
				ESide Facing = ESide::N;
				for (int S = 0; S < 4 && !bFacing; S++)
				{
					float Apart = Math::Fmod(Math::Abs(Reach::Turn(Tiles::SideAt(S)) - Prop.Turn), 2 * Reach::PI_D);
					if (Apart < 0.01 || Math::Abs(Apart - 2 * Reach::PI_D) < 0.01)
					{
						bFacing = true;
						Facing = Tiles::SideAt(S);
					}
				}
				if (!bFacing)
				{
					Problems.Add(f"{At} faces no wall");
					continue;
				}
				bool bAlongX = Facing == ESide::N || Facing == ESide::S;
				float Middle = bAlongX ? Prop.X : Prop.Z;
				// The walls behind it, end to end, must cover it.
				TArray<FSpan> Spans;
				for (FLevelBox Box : Level.Boxes)
				{
					if (Box.Kind != ELevelBoxKind::Wall && Box.Kind != ELevelBoxKind::Partition)
						continue;
					if (Box.Y > Prop.Y + 0.01 || Box.Y + Box.Height < Prop.Y + Kind.Height - 0.01)
						continue;
					float Face = Reach::SideLine(Box.Footprint(), Facing);
					if (Math::Abs(Face - (bAlongX ? Prop.Z : Prop.X)) > 0.02)
						continue;
					FSpan Span;
					Span.Lo = bAlongX ? Box.MinX : Box.MinZ;
					Span.Hi = bAlongX ? Box.MaxX : Box.MaxZ;
					// Kept in order of where they start.
					int Into = Spans.Num();
					while (Into > 0 && Spans[Into - 1].Lo > Span.Lo)
						Into--;
					Spans.Insert(Span, Into);
				}
				float Covered = Middle - Kind.Width / 2;
				for (FSpan Span : Spans)
				{
					if (Span.Lo <= Covered + 0.01)
						Covered = Math::Max(Covered, Span.Hi);
				}
				if (Covered < Middle + Kind.Width / 2 - 0.01)
					Problems.Add(f"{At} isn't on a wall");
			}
		}
		for (int I = 0; I < Solids.Num(); I++)
		{
			FSolidProp A = Solids[I];
			FString At = Where(Reach::MakePoint(Math::RoundToInt(A.Y / Tiles::STOREY), A.Box.MinX, A.Box.MinZ));
			for (int J = I + 1; J < Solids.Num(); J++)
			{
				if (Math::Abs(A.Y - Solids[J].Y) < 0.01 && Reach::Overlaps(A.Box, Solids[J].Box))
					Problems.Add(f"props overlap at {At}");
			}
			for (FLevelBox Wall : Bare)
			{
				if (Wall.Y >= A.Top || Wall.Y + Wall.Height <= A.Y + 0.01)
					continue;
				if (Reach::Overlaps(A.Box, Wall.Footprint(), A.bFence ? -0.12 : 0.0))
					Problems.Add(f"a prop at {At} is in a {BoxKindName(Wall.Kind)}");
			}
		}

		// Fittings for the lights that have them.
		for (FLightSpawn Light : Level.Lights)
		{
			EProp Model;
			if (Light.Kind == ELightKind::Tube)
				Model = EProp::CeilingTube;
			else if (Light.Kind == ELightKind::Emergency)
				Model = EProp::EmergencyLight;
			else if (Light.Kind == ELightKind::Exit)
				Model = EProp::ExitSign;
			else
				continue;
			bool bFound = false;
			for (FPropSpawn Prop : Level.Props)
			{
				if (Prop.Model == Model && Math::Sqrt((Prop.X - Light.X) * (Prop.X - Light.X) + (Prop.Z - Light.Z) * (Prop.Z - Light.Z)) < 0.3
					&& Math::Abs(Prop.Y - Light.Y) < 0.3)
				{
					bFound = true;
					break;
				}
			}
			if (!bFound)
			{
				int Storey = Math::FloorToInt(Light.Y / Tiles::STOREY);
				Problems.Add(f"a {LightKindName(Light.Kind)} light at {Where(Reach::MakePoint(Storey, Light.X, Light.Z))} has no fitting");
			}
		}

		Zones(Level, Building, Problems);
		return Problems;
	}

	/**
	 * The zone graph: Warehouse 7 has one each of the rooms behind a single doorway (the guard's post,
	 * the reefer section, quarantine) on the ground, and each has that one doorway, onto a kind of
	 * room it's reached from (Generate::ReachedFrom), besides those onto rooms reached through it.
	 * Nothing leads in from another storey: their cells are floor, or solid.
	 */
	void Zones(FWarehouse Level, FBuilding Building, TArray<FString>& Problems)
	{
		TMap<FString, int> RoomOf;
		for (int Id = 0; Id < Level.Rooms.Num(); Id++)
		{
			for (FColRow Cell : Level.Rooms[Id].Cells)
				RoomOf.Add(f"{Level.Rooms[Id].Storey},{Cell.Col},{Cell.Row}", Id);
		}
		TArray<ERoomKind> Kinds;
		Kinds.Add(ERoomKind::Guard);
		Kinds.Add(ERoomKind::Reefer);
		Kinds.Add(ERoomKind::Quarantine);
		for (ERoomKind Kind : Kinds)
		{
			FString Name = Generate::RoomKindName(Kind);
			int Count = 0;
			for (FRoom Room : Level.Rooms)
			{
				if (Room.Kind != Kind)
					continue;
				Count++;
				if (Room.Storey != 0)
					Problems.Add(f"the {Name} room is on storey {Room.Storey}, not the ground");
				TArray<ERoomKind> Ways;
				for (FColRow Cell : Room.Cells)
				{
					ETileKind Tile = Building.Parsed.Tile(Room.Storey, Cell.Col, Cell.Row).Kind;
					if (Tile != ETileKind::Floor && Tile != ETileKind::Solid)
						Problems.Add(f"the {Name} room has a {Tiles::TileChar(Building.Parsed.Tile(Room.Storey, Cell.Col, Cell.Row))} at {Cell.Col},{Cell.Row}, a way in from another storey");
					for (int S = 0; S < 4; S++)
					{
						ESide Side = Tiles::SideAt(S);
						int Other = -1;
						if (!RoomOf.Find(f"{Room.Storey},{Cell.Col + Tiles::OffsetX(Side)},{Cell.Row + Tiles::OffsetZ(Side)}", Other) || Other == Room.Id)
							continue;
						ERoomKind OtherKind = Level.Rooms[Other].Kind;
						EEdge Edge = Building.Parsed.Edge(Room.Storey, Cell.Col, Cell.Row, Side);
						FString OtherName = Generate::RoomKindName(OtherKind);
						if (Edge == EEdge::None)
							Problems.Add(f"the {Name} room is open to a {OtherName} with no wall at {Cell.Col},{Cell.Row}");
						else if (Tiles::IsOpening(Edge) && !Generate::ReachedFrom(OtherKind).Contains(Kind))
							Ways.Add(OtherKind);
					}
				}
				if (Ways.Num() != 1)
					Problems.Add(f"the {Name} room has {Ways.Num()} ways in, not one");
				else if (!Generate::ReachedFrom(Kind).Contains(Ways[0]))
					Problems.Add(f"the {Name} room opens onto a {Generate::RoomKindName(Ways[0])}");
			}
			if (Count != 1)
				Problems.Add(f"{Count} {Name} rooms, not one");
		}
		// HB-0417's cases are in quarantine, two or three of them, and nothing else is.
		int Cases = 0;
		for (FItemSpawn Item : Level.Items)
		{
			int Storey = Math::FloorToInt((Item.Y + 0.5) / Tiles::STOREY);
			bool bQuarantine = false;
			for (FColRow Cell : Building.CellsUnder(Level::MakeBoxXZ(Item.X, Item.X, Item.Z, Item.Z)))
			{
				int Id = -1;
				if (RoomOf.Find(f"{Storey},{Cell.Col},{Cell.Row}", Id) && Level.Rooms[Id].Kind == ERoomKind::Quarantine)
					bQuarantine = true;
			}
			bool bCase = Item.Kind == EItemKind::TickCase;
			if (bCase)
				Cases++;
			if (bCase && !bQuarantine)
				Problems.Add(f"a tick case at {Where(Reach::MakePoint(Storey, Item.X, Item.Z))} is outside quarantine");
			if (!bCase && bQuarantine)
				Problems.Add(f"a {Items::KindName(Item.Kind)} at {Where(Reach::MakePoint(Storey, Item.X, Item.Z))} is in quarantine");
		}
		if (Cases < 2 || Cases > 3)
			Problems.Add(f"{Cases} tick cases, not two or three");
	}
}
