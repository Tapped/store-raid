// A generated building, drawn by room kind: what client/src/building.ts does, in a first cut. Every
// face of a wall, floor and ceiling takes the finish of the room it faces: kick band, lower coat,
// dado band, upper coat and cladding up the walls, the floor's surface, a bare slab or ceiling tiles
// overhead, all in the building's livery from its seed. The finishes and liveries are the web game's,
// number for number, so a seed is painted the same in both.
//
// Faces are thin boxes (skins) on the faces of the level's own boxes, an instanced mesh per surface of
// the surface library (`pnpm run ue surfaces`), each instance painted through its custom data. The
// material projects its textures from the world (see Tools/import/surfaces.py), so a skin needs no
// texture coordinates. The level's collision boxes are hidden under them (ALevelGeometry).
//
// How it differs from the web game, for now: no wear (grime, scuffs, damp in vertex colours),
// pilasters, beams, lane lines, door trims, stair treads, ladders' rungs or railings' tubes (a
// railing is a painted box); and where boxes overlap at a corner, two faces can share a plane.
// Built on clients, never the dedicated server.

/** A surface and the paint on it, in sRGB: the table's own paint unless `bPainted`. */
struct FCoat
{
	FName Surface;
	bool bPainted = false;
	FLinearColor Paint;
};

/** How a room is finished: `Finish` in building.ts. Heights are above its floor. */
struct FFinish
{
	FCoat Floor;
	bool bKick = false;
	float KickHeight = 0.0;
	FCoat Kick;
	FCoat Lower;
	float Dado = 1.2;
	bool bBand = false;
	float BandHeight = 0.0;
	FCoat Band;
	FCoat Upper;
	/** Cladding on the outer walls from `CladFrom` up, above ground. */
	bool bClad = false;
	float CladFrom = 0.0;
	FCoat Clad;
	/** Ceiling tiles overhead, else the bare slab. */
	bool bTiled = false;
};

/** The colours one building is painted in, chosen from its seed, in sRGB. */
struct FLivery
{
	FLinearColor Accent;
	FLinearColor Light;
	FLinearColor Dark;
	FLinearColor Rail;
	FLinearColor Carpet;
	FLinearColor Vinyl;
	FLinearColor CorridorFloor;
	FLinearColor Steel;
	FLinearColor Cladding;
};

namespace Building
{
	/** `hash3` in parts.ts, bit for bit: a number from 0 to 1 for three numbers, to 1/50. */
	float Hash3(float X, float Y, float Z)
	{
		int64 A = Generate::Imul(int64(Math::FloorToInt(X * 50 + 0.5)) & 0xFFFFFFFF, 0x27d4eb2d);
		int64 B = Generate::Imul(int64(Math::FloorToInt(Y * 50 + 0.5)) & 0xFFFFFFFF, 0x165667b1);
		int64 C = Generate::Imul(int64(Math::FloorToInt(Z * 50 + 0.5)) & 0xFFFFFFFF, 0x9e3779b1);
		int64 H = A ^ B ^ C;
		H = Generate::Imul(H ^ (H >> 15), 0x85ebca77);
		H = Generate::Imul(H ^ (H >> 13), 0xc2b2ae3d);
		return float(H ^ (H >> 16)) / 4294967296.0;
	}

	/** `seedOf` in building.ts: the number a level's name ends in. */
	int SeedOf(FString Name)
	{
		int At = Name.Len();
		// Digits only: IsNumeric() takes a lone "-" as a number too, which made generated-1 seed -1.
		while (At > 0 && "0123456789".Contains(Name.Mid(At - 1, 1)))
			At--;
		// Every level drawn this way is generated-<seed>; the TS hashes other names.
		return At < Name.Len() ? String::Conv_StringToInt(Name.RightChop(At)) : 7;
	}

	FLinearColor Rgb(float R, float G, float B)
	{
		return FLinearColor(R, G, B, 1);
	}

	FLinearColor Pick(TArray<FLinearColor> List, int Seed, float Salt)
	{
		return List[Math::FloorToInt(Hash3(Seed, Salt, 7.3) * List.Num()) % List.Num()];
	}

	FLivery LiveryOf(int Seed)
	{
		TArray<FLinearColor> Accents;
		Accents.Add(Rgb(0.16, 0.29, 0.42));
		Accents.Add(Rgb(0.2, 0.34, 0.27));
		Accents.Add(Rgb(0.46, 0.17, 0.13));
		Accents.Add(Rgb(0.13, 0.31, 0.33));
		Accents.Add(Rgb(0.55, 0.38, 0.12));
		Accents.Add(Rgb(0.3, 0.27, 0.36));
		TArray<FLinearColor> Lights;
		Lights.Add(Rgb(0.7, 0.69, 0.64));
		Lights.Add(Rgb(0.65, 0.68, 0.66));
		Lights.Add(Rgb(0.72, 0.68, 0.6));
		Lights.Add(Rgb(0.64, 0.65, 0.67));
		TArray<FLinearColor> Darks;
		Darks.Add(Rgb(0.4, 0.42, 0.43));
		Darks.Add(Rgb(0.35, 0.38, 0.37));
		Darks.Add(Rgb(0.46, 0.44, 0.4));
		Darks.Add(Rgb(0.33, 0.35, 0.4));
		TArray<FLinearColor> Rails;
		Rails.Add(Rgb(0.86, 0.64, 0.08));
		Rails.Add(Rgb(0.86, 0.64, 0.08));
		Rails.Add(Rgb(0.78, 0.3, 0.1));
		TArray<FLinearColor> Carpets;
		Carpets.Add(Rgb(0.26, 0.29, 0.33));
		Carpets.Add(Rgb(0.3, 0.26, 0.26));
		Carpets.Add(Rgb(0.22, 0.27, 0.28));
		Carpets.Add(Rgb(0.28, 0.28, 0.25));
		TArray<FLinearColor> Vinyls;
		Vinyls.Add(Rgb(0.7, 0.68, 0.62));
		Vinyls.Add(Rgb(0.6, 0.65, 0.65));
		Vinyls.Add(Rgb(0.72, 0.63, 0.53));
		Vinyls.Add(Rgb(0.62, 0.62, 0.66));
		TArray<FLinearColor> CorridorFloors;
		CorridorFloors.Add(Rgb(0.36, 0.43, 0.39));
		CorridorFloors.Add(Rgb(0.44, 0.44, 0.46));
		CorridorFloors.Add(Rgb(0.48, 0.4, 0.32));
		TArray<FLinearColor> Claddings;
		Claddings.Add(Rgb(0.52, 0.56, 0.55));
		Claddings.Add(Rgb(0.6, 0.6, 0.57));
		Claddings.Add(Rgb(0.47, 0.52, 0.56));
		Claddings.Add(Rgb(0.56, 0.54, 0.49));
		TArray<FLinearColor> Steels;
		Steels.Add(Rgb(0.3, 0.33, 0.36));
		Steels.Add(Rgb(0.42, 0.4, 0.36));
		Steels.Add(Rgb(0.28, 0.3, 0.28));

		FLivery Livery;
		Livery.Accent = Pick(Accents, Seed, 1);
		Livery.Light = Pick(Lights, Seed, 2);
		Livery.Dark = Pick(Darks, Seed, 3);
		Livery.Rail = Pick(Rails, Seed, 4);
		Livery.Carpet = Pick(Carpets, Seed, 5);
		Livery.Vinyl = Pick(Vinyls, Seed, 6);
		Livery.CorridorFloor = Pick(CorridorFloors, Seed, 7);
		Livery.Steel = Pick(Steels, Seed, 8);
		Livery.Cladding = Pick(Claddings, Seed, 9);
		return Livery;
	}

	/** `vary`: a paint a little off the livery's, different in each room. */
	FLinearColor Vary(FLinearColor Colour, float Salt, float Amount = 0.05)
	{
		const float K = 1 + (Hash3(Salt, 3.1, 9.7) - 0.5) * 2 * Amount;
		const float Warm = (Hash3(Salt, 5.3, 1.1) - 0.5) * Amount * 0.6;
		return Rgb(Math::Min(1.0, Colour.R * K * (1 + Warm)), Math::Min(1.0, Colour.G * K), Math::Min(1.0, Colour.B * K * (1 - Warm)));
	}

	FLinearColor Scale(FLinearColor Colour, float K)
	{
		return Rgb(Colour.R * K, Colour.G * K, Colour.B * K);
	}

	FCoat Plain(FName Surface)
	{
		FCoat Coat;
		Coat.Surface = Surface;
		return Coat;
	}

	FCoat Painted(FName Surface, FLinearColor Paint)
	{
		FCoat Coat;
		Coat.Surface = Surface;
		Coat.bPainted = true;
		Coat.Paint = Paint;
		return Coat;
	}

	/** `finishFor`: how each kind of room is finished, with this livery and the room's own salt. */
	FFinish FinishFor(ERoomKind Kind, bool bBasement, FLivery Livery, float Salt)
	{
		const FLinearColor Light = Vary(Livery.Light, Salt);
		FFinish Finish;
		Finish.Floor = Plain(n"concrete-floor");
		Finish.bKick = true;
		Finish.KickHeight = 0.15;
		Finish.Kick = Painted(n"concrete-block", Scale(Vary(Livery.Dark, Salt + 1), 0.7));
		Finish.Lower = Painted(n"concrete-block", Light);
		Finish.Dado = 1.2;
		Finish.Upper = Painted(n"concrete-block", Light);
		if (bBasement)
		{
			Finish.bKick = false;
			Finish.Lower = Plain(n"concrete-wall");
			Finish.Upper = Plain(n"concrete-wall");
			return Finish;
		}
		switch (Kind)
		{
			case ERoomKind::Entrance:
			case ERoomKind::Hall:
			case ERoomKind::Cage:
			case ERoomKind::Atrium:
				if (Kind == ERoomKind::Entrance)
				{
					Finish.KickHeight = 0.3;
					Finish.Kick = Plain(n"hazard");
				}
				else
				{
					Finish.KickHeight = 0.2;
					Finish.Kick = Painted(n"concrete-block", Scale(Vary(Livery.Dark, Salt + 1), 0.6));
				}
				Finish.Lower = Painted(n"concrete-block", Vary(Livery.Dark, Salt));
				Finish.bBand = true;
				Finish.BandHeight = 0.12;
				Finish.Band = Painted(n"concrete-block", Livery.Accent);
				Finish.bClad = true;
				Finish.CladFrom = 2.1;
				Finish.Clad = Painted(n"corrugated", Vary(Livery.Cladding, Salt + 2, 0.03));
				break;
			case ERoomKind::Stock:
				Finish.Lower = Painted(n"concrete-block", Scale(Vary(Livery.Light, Salt + 4, 0.08), 0.92));
				Finish.Upper = Finish.Lower;
				break;
			case ERoomKind::Workshop:
				Finish.bKick = false;
				Finish.Lower = Painted(n"painted-steel", Scale(Vary(Livery.Steel, Salt, 0.04), 1.6));
				Finish.Dado = 1.3;
				Finish.bBand = true;
				Finish.BandHeight = 0.05;
				Finish.Band = Painted(n"painted-steel", Livery.Accent);
				break;
			case ERoomKind::Office:
				Finish.Floor = Painted(n"carpet-tile", Vary(Livery.Carpet, Salt, 0.04));
				Finish.KickHeight = 0.1;
				Finish.Kick = Plain(n"rubber");
				Finish.Lower = Painted(n"painted-plaster", Light);
				Finish.Upper = Painted(n"painted-plaster", Light);
				Finish.bTiled = true;
				break;
			case ERoomKind::Staff:
				Finish.Floor = Painted(n"vinyl-tile", Vary(Livery.Vinyl, Salt, 0.04));
				Finish.bKick = false;
				Finish.Lower = Plain(n"wall-tile");
				Finish.Dado = 1.5;
				Finish.bBand = true;
				Finish.BandHeight = 0.04;
				Finish.Band = Painted(n"painted-steel", Livery.Accent);
				Finish.Upper = Painted(n"painted-plaster", Light);
				Finish.bTiled = true;
				break;
			case ERoomKind::Plant:
				Finish.bKick = false;
				Finish.Lower = Plain(n"concrete-wall");
				Finish.Upper = Plain(n"concrete-wall");
				break;
			case ERoomKind::Corridor:
				Finish.Floor = Painted(n"floor-paint", Vary(Livery.CorridorFloor, Salt, 0.04));
				Finish.Lower = Painted(n"concrete-block", Scale(Vary(Livery.Accent, Salt, 0.04), 0.85));
				Finish.Dado = 1.0;
				Finish.Upper = Painted(n"concrete-block", Light);
				break;
			default:
				break;
		}
		return Finish;
	}

	/**
	 * The paint a surface has when a coat doesn't give one, in sRGB: `tint` in client/src/surfaceTable.ts,
	 * for the surfaces that can be painted. The others show no paint at all, as black.
	 */
	FLinearColor TableTint(FName Surface)
	{
		if (Surface == n"floor-paint")
			return Rgb(0.85, 0.66, 0.08);
		if (Surface == n"vinyl-tile")
			return Rgb(0.78, 0.76, 0.71);
		if (Surface == n"carpet-tile")
			return Rgb(0.26, 0.29, 0.33);
		if (Surface == n"painted-plaster")
			return Rgb(0.8, 0.79, 0.74);
		if (Surface == n"concrete-block")
			return Rgb(0.78, 0.77, 0.73);
		if (Surface == n"corrugated")
			return Rgb(0.55, 0.6, 0.6);
		if (Surface == n"painted-steel")
			return Rgb(0.3, 0.36, 0.42);
		if (Surface == n"hazard")
			return Rgb(0.86, 0.64, 0.05);
		if (Surface == n"tarpaulin")
			return Rgb(0.16, 0.3, 0.5);
		return Rgb(0, 0, 0);
	}

	bool Paintable(FName Surface)
	{
		return TableTint(Surface).R > 0;
	}

	/** sRGB to linear as Babylon's toLinearSpace does it, a power of 2.2, so paints match the web game's. */
	FLinearColor Linear(FLinearColor Colour)
	{
		return FLinearColor(Math::Pow(Colour.R, 2.2), Math::Pow(Colour.G, 2.2), Math::Pow(Colour.B, 2.2), 1);
	}
}

/** Indices into a list, as a map's value: script can't nest containers. */
struct FIndices
{
	TArray<int> Items;
};

/** One stretch of wall in a band of height, and what covers it. */
struct FZone
{
	float From = 0.0;
	float To = 0.0;
	FCoat Coat;
};

class ALevelBuilding : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;
	default Root.Mobility = EComponentMobility::Static;

	/** The instanced mesh of each surface, made as the first skin of it is placed. */
	TMap<FName, UInstancedStaticMeshComponent> Meshes;

	FLevel Level;
	FParsedGrid Parsed;
	float X0 = 0.0;
	float Z0 = 0.0;
	int Seed = 0;
	FLivery Livery;
	/** The room in each cell, by Parsed.Index, or -1. */
	TArray<int> RoomAt;
	/** Each room's finish, by its id, and the finish of a cell with no room, by storey below ground or not. */
	TMap<int, FFinish> Finishes;
	/** The boxes and floors that hide a face, as boxes, and which of them are in each cell. */
	TArray<FLevelBox> Solids;
	TMap<int, FIndices> SolidsIn;
	int Skins = 0;

	/** How thick a skin is: it lies on a face, inside the box. */
	const float SKIN = 0.01;
	/** How far out from a face to look for what it faces. */
	const float LOOK = 0.05;
	/** On the outside, concrete up to here, and cladding above. */
	const float PLINTH = 1.1;

	void Build(FLevel InLevel)
	{
		Level = InLevel;
		Parsed = Tiles::ParseTiles(Level.Grid);
		X0 = Level.Grid.X;
		Z0 = Level.Grid.Z;
		Seed = Building::SeedOf(Level.Name);
		Livery = Building::LiveryOf(Seed);
		RoomAt.SetNum(Parsed.AllTiles.Num());
		for (int Index = 0; Index < RoomAt.Num(); Index++)
			RoomAt[Index] = -1;
		for (const FRoom& Room : Level.Rooms)
		{
			for (const FColRow& Cell : Room.Cells)
				RoomAt[Parsed.Index(Room.Storey, Cell.Col, Cell.Row)] = Room.Id;
		}
		for (const FLevelBox& Box : Level.Boxes)
		{
			if (Box.Kind == ELevelBoxKind::Wall || Box.Kind == ELevelBoxKind::Partition || Box.Kind == ELevelBoxKind::Pit)
				AddSolid(Box);
		}
		for (const FFloor& Floor : Level.Floors)
		{
			if (!Floor.bHasRise)
				AddSolid(Level::MakeLevelBox(Floor.Footprint(), Floor.Y - Floor.Thickness, Floor.Thickness, ELevelBoxKind::Wall));
		}

		for (const FLevelBox& Box : Level.Boxes)
		{
			switch (Box.Kind)
			{
				case ELevelBoxKind::Wall:
				case ELevelBoxKind::Partition:
				case ELevelBoxKind::Pit:
					Walls(Box);
					break;
				case ELevelBoxKind::Rail:
					AddSkin(Building::Painted(n"painted-steel", Livery.Rail), Box.MinX, Box.MaxX, Box.Y, Box.Y + Box.Height, Box.MinZ, Box.MaxZ);
					break;
				default:
					break;
			}
		}
		for (const FFloor& Floor : Level.Floors)
			Floors(Floor);
		if (Level.Roof > 0)
			Roof();
		Log(f"StoreRaid: building drawn: {Skins} faces on {Meshes.Num()} surfaces");
	}

	// ---- What's where ----

	int CellKey(int Col, int Row)
	{
		return (Col + 1000) * 4000 + Row + 1000;
	}

	int ColOf(float X)
	{
		return Math::FloorToInt((X - X0) / Tiles::CELL);
	}

	int RowOf(float Z)
	{
		return Math::FloorToInt((Z - Z0) / Tiles::CELL);
	}

	void AddSolid(FLevelBox Box)
	{
		const int Index = Solids.Num();
		Solids.Add(Box);
		for (int Col = ColOf(Box.MinX); Col <= ColOf(Box.MaxX); Col++)
		{
			for (int Row = RowOf(Box.MinZ); Row <= RowOf(Box.MaxZ); Row++)
			{
				FIndices& In = SolidsIn.FindOrAdd(CellKey(Col, Row));
				In.Items.Add(Index);
			}
		}
	}

	/** Whether a point is inside a wall or a floor, more than a millimetre in. */
	bool Inside(float X, float Y, float Z)
	{
		FIndices Near;
		if (!SolidsIn.Find(CellKey(ColOf(X), RowOf(Z)), Near))
			return false;
		const float E = 0.001;
		for (int Index : Near.Items)
		{
			const FLevelBox& Box = Solids[Index];
			if (X > Box.MinX + E && X < Box.MaxX - E && Z > Box.MinZ + E && Z < Box.MaxZ - E && Y > Box.Y + E && Y < Box.Y + Box.Height - E)
				return true;
		}
		return false;
	}

	int StoreyOf(float Y)
	{
		return Math::FloorToInt(Y / Tiles::STOREY + 0.001);
	}

	bool InGrid(int Col, int Row)
	{
		return Col >= 0 && Row >= 0 && Col < Parsed.Cols && Row < Parsed.Rows;
	}

	int RoomOf(int Storey, int Col, int Row)
	{
		if (!InGrid(Col, Row) || Storey < -Parsed.Basements || Storey + Parsed.Basements >= Parsed.Levels)
			return -1;
		return RoomAt[Parsed.Index(Storey, Col, Row)];
	}

	/** `finish()`: the finish of a cell's room; an atrium's walls are the room's below it. */
	FFinish FinishAt(int Storey, int Col, int Row)
	{
		int Room = RoomOf(Storey, Col, Row);
		int S = Storey;
		while (Room >= 0 && Level.Rooms[Room].Kind == ERoomKind::Atrium && S > -Parsed.Basements)
		{
			S--;
			const int Below = RoomOf(S, Col, Row);
			if (Below >= 0)
				Room = Below;
		}
		ERoomKind Kind = ERoomKind::Hall;
		bool bBasement = Storey < 0;
		if (Room >= 0 && Level.Rooms[Room].Kind != ERoomKind::Atrium)
		{
			Kind = Level.Rooms[Room].Kind;
			bBasement = Storey < 0 && Kind != ERoomKind::Office && Kind != ERoomKind::Staff;
		}
		const int Key = bBasement ? -2 - Math::Max(Room, 0) * 2 : (Room >= 0 ? Room * 2 : -1);
		FFinish Found;
		if (Finishes.Find(Key, Found))
			return Found;
		Found = Building::FinishFor(Kind, bBasement, Livery, Seed * 31 + Math::Max(Room, 0) * 7);
		Finishes.Add(Key, Found);
		return Found;
	}

	// ---- Walls ----

	/** Each side of a wall box, cut at the cells' edges, finished by what it faces. */
	void Walls(FLevelBox Box)
	{
		const float Top = Box.Y + Box.Height;
		// Facing north and south: along x at z = MaxZ or MinZ.
		for (int Sign = -1; Sign <= 1; Sign += 2)
		{
			const float FaceZ = Sign > 0 ? Box.MaxZ : Box.MinZ;
			for (float A0 : Cuts(Box.MinX, Box.MaxX, X0))
			{
				const float A1 = Math::Min(Box.MaxX, NextCut(A0, X0));
				if (A1 - A0 < 0.005)
					continue;
				WallFace(Box, (A0 + A1) / 2, FaceZ + Sign * LOOK, Box.Y, Top, false, Sign, FaceZ, A0, A1);
			}
		}
		for (int Sign = -1; Sign <= 1; Sign += 2)
		{
			const float FaceX = Sign > 0 ? Box.MaxX : Box.MinX;
			for (float A0 : Cuts(Box.MinZ, Box.MaxZ, Z0))
			{
				const float A1 = Math::Min(Box.MaxZ, NextCut(A0, Z0));
				if (A1 - A0 < 0.005)
					continue;
				WallFace(Box, FaceX + Sign * LOOK, (A0 + A1) / 2, Box.Y, Top, true, Sign, FaceX, A0, A1);
			}
		}
		// The underside of a doorway's head, as the wall's upper coat, and a top no floor covers.
		const float CX = (Box.MinX + Box.MaxX) / 2;
		const float CZ = (Box.MinZ + Box.MaxZ) / 2;
		if (Box.Y > StoreyOf(Box.Y + 0.01) * Tiles::STOREY + 0.5 && !Inside(CX, Box.Y - LOOK, CZ))
		{
			const FFinish Finish = FinishAt(StoreyOf(Box.Y), ColOf(CX), RowOf(CZ));
			AddSkin(Finish.Upper, Box.MinX, Box.MaxX, Box.Y, Box.Y + SKIN, Box.MinZ, Box.MaxZ);
		}
		if (!Inside(CX, Top + LOOK, CZ) && Box.Kind != ELevelBoxKind::Pit)
			AddSkin(Building::Plain(n"concrete-wall"), Box.MinX, Box.MaxX, Top - SKIN, Top, Box.MinZ, Box.MaxZ);
	}

	/** Where a span is cut: its start and every cell edge in it. */
	TArray<float> Cuts(float A0, float A1, float Origin)
	{
		TArray<float> Result;
		Result.Add(A0);
		float At = NextCut(A0, Origin);
		while (At < A1 - 0.005)
		{
			Result.Add(At);
			At = NextCut(At, Origin);
		}
		return Result;
	}

	float NextCut(float A, float Origin)
	{
		return Origin + (Math::FloorToInt((A - Origin) / Tiles::CELL + 0.0001) + 1) * Tiles::CELL;
	}

	/**
	 * One piece of a wall's side, facing out along x (`bAlongX`) or z by `Sign` from `Face`, from A0 to
	 * A1 along it and from Y0 to Y1: skipped if what it faces is solid, else covered in the zones of the
	 * finish in front, by height above that storey's floor.
	 */
	void WallFace(FLevelBox Box, float LookX, float LookZ, float Y0, float Y1, bool bAlongX, int Sign, float Face, float A0, float A1)
	{
		const float MidY = (Y0 + Y1) / 2;
		if (Inside(LookX, MidY, LookZ))
			return;
		const int Storey = StoreyOf(Y0 + 0.01);
		const float Base = Storey * Tiles::STOREY;
		const int Col = ColOf(LookX);
		const int Row = RowOf(LookZ);
		TArray<FZone> Zones;
		ZonesOf(Box, Storey, Col, Row, Zones);
		for (const FZone& Zone : Zones)
		{
			const float From = Math::Max(Y0, Base + Zone.From);
			const float To = Math::Min(Y1, Base + Zone.To);
			if (To - From < 0.002)
				continue;
			if (bAlongX)
			{
				const float C0 = Sign > 0 ? Face - SKIN : Face;
				AddSkin(Zone.Coat, C0, C0 + SKIN, From, To, A0, A1);
			}
			else
			{
				const float C0 = Sign > 0 ? Face - SKIN : Face;
				AddSkin(Zone.Coat, A0, A1, From, To, C0, C0 + SKIN);
			}
		}
	}

	/** `zonesOf`: the coats a wall face takes, by height above its floor. */
	void ZonesOf(FLevelBox Box, int Storey, int Col, int Row, TArray<FZone>& Zones)
	{
		const float Width = Box.MaxX - Box.MinX;
		const float Depth = Box.MaxZ - Box.MinZ;
		const bool bRock = Box.Kind == ELevelBoxKind::Wall && Width >= Tiles::CELL - 0.1 && Depth >= Tiles::CELL - 0.1;
		const bool bOuter = Box.Kind == ELevelBoxKind::Wall && !bRock && Math::Min(Width, Depth) > Tiles::LADDER_WALL + 0.01;
		if (Box.Kind == ELevelBoxKind::Pit || bRock)
		{
			Zone(Zones, -99, 99, Building::Plain(n"concrete-wall"));
			return;
		}
		// Outside the building: a concrete plinth and cladding over it; below ground, earth.
		if (!InGrid(Col, Row))
		{
			if (Storey < 0)
				return;
			Zone(Zones, -99, PLINTH, Building::Plain(n"concrete-block"));
			Zone(Zones, PLINTH, 99, Building::Painted(n"corrugated", Livery.Cladding));
			return;
		}
		// Below ground, the outer walls hold the earth back: cast concrete.
		if (bOuter && Storey < 0)
		{
			Zone(Zones, -99, 99, Building::Plain(n"concrete-wall"));
			return;
		}
		const FFinish Finish = FinishAt(Storey, Col, Row);
		const bool bClad = bOuter && Finish.bClad && Storey >= 0;
		// Where there's no floor in front at this storey, the wall carries on as it is above.
		const ETileKind Kind = Parsed.Tile(Storey, Col, Row).Kind;
		if (Kind == ETileKind::Open || Kind == ETileKind::Well || Kind == ETileKind::Pit || Kind == ETileKind::Bridge || Kind == ETileKind::Shaft)
		{
			Zone(Zones, -99, 99, bClad ? Finish.Clad : Finish.Upper);
			return;
		}
		float Y = -99;
		if (Finish.bKick)
		{
			Zone(Zones, Y, Finish.KickHeight, Finish.Kick);
			Y = Finish.KickHeight;
		}
		Zone(Zones, Y, Finish.Dado, Finish.Lower);
		Y = Finish.Dado;
		if (Finish.bBand)
		{
			Zone(Zones, Y, Y + Finish.BandHeight, Finish.Band);
			Y += Finish.BandHeight;
		}
		if (bClad)
		{
			Zone(Zones, Y, Finish.CladFrom, Finish.Upper);
			Zone(Zones, Finish.CladFrom, 99, Finish.Clad);
		}
		else
			Zone(Zones, Y, 99, Finish.Upper);
	}

	void Zone(TArray<FZone>& Zones, float From, float To, FCoat Coat)
	{
		FZone Made;
		Made.From = From;
		Made.To = To;
		Made.Coat = Coat;
		Zones.Add(Made);
	}

	// ---- Floors and ceilings ----

	/** A floor's top in its room's floor, its underside as the ceiling of the room below, cell by cell. */
	void Floors(FFloor Floor)
	{
		if (Floor.Kind == EFloorKind::Ground)
			return;
		if (Floor.bHasRise)
		{
			UInstancedStaticMeshComponent Mesh = MeshFor(n"concrete-floor");
			AddPainted(Mesh, n"concrete-floor", Building::Plain(n"concrete-floor"), Shapes::RampTransform(Floor));
			return;
		}
		if (Floor.Kind == EFloorKind::Plank)
		{
			AddSkin(Building::Plain(n"wood-plank"), Floor.MinX, Floor.MaxX, Floor.Y - Floor.Thickness, Floor.Y, Floor.MinZ, Floor.MaxZ);
			return;
		}
		const float Bottom = Floor.Y - Floor.Thickness;
		const int Storey = StoreyOf(Floor.Y + 0.01);
		for (float X : Cuts(Floor.MinX, Floor.MaxX, X0))
		{
			const float X1 = Math::Min(Floor.MaxX, NextCut(X, X0));
			for (float Z : Cuts(Floor.MinZ, Floor.MaxZ, Z0))
			{
				const float Z1 = Math::Min(Floor.MaxZ, NextCut(Z, Z0));
				const int Col = ColOf((X + X1) / 2);
				const int Row = RowOf((Z + Z1) / 2);
				const FCoat Top = InGrid(Col, Row) ? FinishAt(Storey, Col, Row).Floor : Building::Plain(n"concrete-floor");
				AddSkin(Top, X, X1, Floor.Y - SKIN, Floor.Y, Z, Z1);
				if (Inside((X + X1) / 2, Bottom - LOOK, (Z + Z1) / 2) || !InGrid(Col, Row) || Storey - 1 < -Parsed.Basements)
					continue;
				const bool bTiled = FinishAt(Storey - 1, Col, Row).bTiled;
				AddSkin(Building::Plain(bTiled ? n"ceiling-tile" : n"concrete-wall"), X, X1, Bottom, Bottom + SKIN, Z, Z1);
			}
		}
		// Edges showing at wells and pits.
		const float Mid = (Floor.Y + Bottom) / 2;
		const FCoat Edge = Building::Painted(n"painted-steel", Livery.Accent);
		if (!Inside(Floor.MinX - LOOK, Mid, (Floor.MinZ + Floor.MaxZ) / 2) && Edged(Floor.MinX - LOOK, Floor.Y, (Floor.MinZ + Floor.MaxZ) / 2))
			AddSkin(Edge, Floor.MinX, Floor.MinX + SKIN, Bottom, Floor.Y, Floor.MinZ, Floor.MaxZ);
		if (!Inside(Floor.MaxX + LOOK, Mid, (Floor.MinZ + Floor.MaxZ) / 2) && Edged(Floor.MaxX + LOOK, Floor.Y, (Floor.MinZ + Floor.MaxZ) / 2))
			AddSkin(Edge, Floor.MaxX - SKIN, Floor.MaxX, Bottom, Floor.Y, Floor.MinZ, Floor.MaxZ);
		if (!Inside((Floor.MinX + Floor.MaxX) / 2, Mid, Floor.MinZ - LOOK) && Edged((Floor.MinX + Floor.MaxX) / 2, Floor.Y, Floor.MinZ - LOOK))
			AddSkin(Edge, Floor.MinX, Floor.MaxX, Bottom, Floor.Y, Floor.MinZ, Floor.MinZ + SKIN);
		if (!Inside((Floor.MinX + Floor.MaxX) / 2, Mid, Floor.MaxZ + LOOK) && Edged((Floor.MinX + Floor.MaxX) / 2, Floor.Y, Floor.MaxZ + LOOK))
			AddSkin(Edge, Floor.MinX, Floor.MaxX, Bottom, Floor.Y, Floor.MaxZ - SKIN, Floor.MaxZ);
	}

	/** Whether past a floor's edge there's open air to see it from, inside the building. */
	bool Edged(float X, float Y, float Z)
	{
		const int Col = ColOf(X);
		const int Row = RowOf(Z);
		if (!InGrid(Col, Row))
			return false;
		const ETileKind Kind = Parsed.Tile(StoreyOf(Y + 0.01), Col, Row).Kind;
		return Kind == ETileKind::Open || Kind == ETileKind::Well || Kind == ETileKind::Pit || Kind == ETileKind::Bridge || Kind == ETileKind::Stairs;
	}

	/** The roof: a steel deck seen from below, ceiling tiles in the rooms that have them, steel on top. */
	void Roof()
	{
		const float Y = Level.Roof;
		const int Top = Parsed.Levels - Parsed.Basements - 1;
		for (int Row = 0; Row < Parsed.Rows; Row++)
		{
			for (int Col = 0; Col < Parsed.Cols; Col++)
			{
				const float X = X0 + Col * Tiles::CELL;
				const float Z = Z0 + Row * Tiles::CELL;
				// The top storey's cell, or the first one down with a floor, under open air.
				int Storey = Top;
				while (Storey > -Parsed.Basements && Parsed.Tile(Storey, Col, Row).Kind == ETileKind::Open)
					Storey--;
				const bool bTiled = Storey == Top && FinishAt(Top, Col, Row).bTiled;
				AddSkin(Building::Plain(bTiled ? n"ceiling-tile" : n"metal-deck"), X, X + Tiles::CELL, Y, Y + SKIN, Z, Z + Tiles::CELL);
			}
		}
		const FBoxXZ Roof = Level.Footprint;
		const float W = Tiles::WALL;
		AddSkin(Building::Painted(n"painted-steel", Livery.Steel), Roof.MinX - W, Roof.MaxX + W, Y + Tiles::SLAB - SKIN, Y + Tiles::SLAB, Roof.MinZ - W, Roof.MaxZ + W);
		// Its edges, clad as the walls under them.
		const FCoat Clad = Building::Painted(n"corrugated", Livery.Cladding);
		AddSkin(Clad, Roof.MinX - W, Roof.MaxX + W, Y, Y + Tiles::SLAB, Roof.MinZ - W, Roof.MinZ - W + SKIN);
		AddSkin(Clad, Roof.MinX - W, Roof.MaxX + W, Y, Y + Tiles::SLAB, Roof.MaxZ + W - SKIN, Roof.MaxZ + W);
		AddSkin(Clad, Roof.MinX - W, Roof.MinX - W + SKIN, Y, Y + Tiles::SLAB, Roof.MinZ - W, Roof.MaxZ + W);
		AddSkin(Clad, Roof.MaxX + W - SKIN, Roof.MaxX + W, Y, Y + Tiles::SLAB, Roof.MinZ - W, Roof.MaxZ + W);
	}

	// ---- Drawing ----

	/** The instanced mesh for a surface: the engine's cube in the surface's material, painted per instance. */
	UInstancedStaticMeshComponent MeshFor(FName Surface)
	{
		UInstancedStaticMeshComponent Found;
		if (Meshes.Find(Surface, Found))
			return Found;
		UInstancedStaticMeshComponent Made = UInstancedStaticMeshComponent::Create(this, Surface);
		Made.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube")));
		Made.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Made.SetMobility(EComponentMobility::Static);
		Made.SetNumCustomDataFloats(3);
		const FString Name = Surface.ToString();
		UMaterialInterface Material = Cast<UMaterialInterface>(LoadObject(nullptr, f"/Game/Surfaces/{Name}/MI_{Name}.MI_{Name}"));
		if (Material != nullptr)
			Made.SetMaterial(0, Material);
		else
			Log(f"StoreRaid: surface {Name} isn't imported: pnpm run ue surfaces {Name}");
		Meshes.Add(Surface, Made);
		return Made;
	}

	/** A skin: a box in game meters covered in a coat. */
	void AddSkin(FCoat Coat, float MinX, float MaxX, float MinY, float MaxY, float MinZ, float MaxZ)
	{
		UInstancedStaticMeshComponent Mesh = MeshFor(Coat.Surface);
		AddPainted(Mesh, Coat.Surface, Coat, Shapes::BoxTransform(MinX, MaxX, MinY, MaxY, MinZ, MaxZ));
	}

	void AddPainted(UInstancedStaticMeshComponent Mesh, FName Surface, FCoat Coat, FTransform Transform)
	{
		const int Index = Mesh.AddInstance(Transform, true);
		FLinearColor Paint = FLinearColor(0, 0, 0, 1);
		if (Building::Paintable(Surface))
			Paint = Building::Linear(Coat.bPainted ? Coat.Paint : Building::TableTint(Surface));
		Mesh.SetCustomDataValue(Index, 0, Paint.R, false);
		Mesh.SetCustomDataValue(Index, 1, Paint.G, false);
		Mesh.SetCustomDataValue(Index, 2, Paint.B, false);
		Skins++;
	}
}

// sr.building: draws this machine's building again, to see a change to Building.as without a restart
// (script reloads a function's body in place, but the building is only drawn when the level is built).
const FConsoleCommand BuildingCommand("sr.building", n"OnBuildingCommand");
void OnBuildingCommand(TArray<FString> Arguments)
{
	TArray<ALevelBuilding> Drawn;
	GetAllActorsOfClass(Drawn);
	for (ALevelBuilding Each : Drawn)
	{
		FLevel Level = Each.Level;
		Each.DestroyActor();
		ALevelBuilding Again = Cast<ALevelBuilding>(SpawnActor(ALevelBuilding));
		Again.Build(Level);
	}
}
