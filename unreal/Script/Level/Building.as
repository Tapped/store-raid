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
// Wear (grime, corners, scuffs, damp, oil, mottling), which the web game bakes into vertex colours, is
// worked out per pixel by the material from what each skin's custom data says about where it is
// (FWear). Cladding has its corrugations in the geometry, as sheets laid over its flat face
// (Corrugations()). Where wall boxes overlap in a plane (walls end to end, a doorway's head on the
// walls beside it), only the first face drawn there is kept, the tallest walls drawn first, so no two
// faces share a plane and flicker.
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
	/** Shallow downstand beams across a slab ceiling, along the room's long axis. */
	bool bBeams = true;
	/** Painted lines on the floor a meter in from the walls. */
	bool bLanes = false;
	/** Steel columns along the outer walls, a cell apart. */
	bool bPilasters = false;
	/** How grimy it is, before how far in the room is: 0 clean, 1 filthy. */
	float Dirt = 0.5;
	/** Scuffed bands at trolley height. */
	bool bScuffs = true;
	/** Water stains and a tide line. */
	bool bDamp = false;
	/** Oil on the floor, 0 to 1. */
	float Oil = 0.0;
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
			Finish.Dirt = 0.8;
			Finish.bDamp = true;
			Finish.Oil = 0.4;
			return Finish;
		}
		switch (Kind)
		{
			case ERoomKind::Reefer:
				// A cold store: insulated steel panels floor to ceiling, a pale sealed floor.
				Finish.Floor = Painted(n"floor-paint", Rgb(0.32, 0.36, 0.38));
				Finish.bKick = true;
				Finish.KickHeight = 0.2;
				Finish.Kick = Painted(n"painted-steel", Rgb(0.08, 0.16, 0.3));
				Finish.Lower = Painted(n"painted-plaster", Vary(Rgb(0.62, 0.64, 0.63), Salt, 0.03));
				Finish.Upper = Finish.Lower;
				Finish.bBand = true;
				Finish.BandHeight = 0.08;
				Finish.Band = Painted(n"painted-steel", Rgb(0.08, 0.16, 0.3));
				Finish.Dado = 1.6;
				Finish.Dirt = 0.3;
				break;
			case ERoomKind::Quarantine:
				// A storeroom gone bad: hazard striping round the foot of the walls, filth and damp.
				Finish.KickHeight = 0.3;
				Finish.Kick = Plain(n"hazard");
				Finish.Lower = Painted(n"concrete-block", Scale(Vary(Livery.Light, Salt + 4, 0.08), 0.8));
				Finish.Upper = Finish.Lower;
				Finish.bPilasters = true;
				Finish.Dirt = 0.9;
				Finish.bDamp = true;
				break;
			case ERoomKind::Guard:
				return FinishFor(ERoomKind::Office, bBasement, Livery, Salt);
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
				Finish.bLanes = Kind == ERoomKind::Entrance || Kind == ERoomKind::Hall;
				Finish.bPilasters = true;
				Finish.Dirt = Kind == ERoomKind::Entrance ? 0.55 : 0.45;
				break;
			case ERoomKind::Stock:
				Finish.Lower = Painted(n"concrete-block", Scale(Vary(Livery.Light, Salt + 4, 0.08), 0.92));
				Finish.Upper = Finish.Lower;
				Finish.bPilasters = true;
				Finish.Dirt = 0.6;
				break;
			case ERoomKind::Workshop:
				Finish.bKick = false;
				Finish.Lower = Painted(n"painted-steel", Scale(Vary(Livery.Steel, Salt, 0.04), 1.6));
				Finish.Dado = 1.3;
				Finish.bBand = true;
				Finish.BandHeight = 0.05;
				Finish.Band = Painted(n"painted-steel", Livery.Accent);
				Finish.Dirt = 0.75;
				Finish.Oil = 1;
				break;
			case ERoomKind::Office:
				Finish.Floor = Painted(n"carpet-tile", Vary(Livery.Carpet, Salt, 0.04));
				Finish.KickHeight = 0.1;
				Finish.Kick = Plain(n"rubber");
				Finish.Lower = Painted(n"painted-plaster", Light);
				Finish.Upper = Painted(n"painted-plaster", Light);
				Finish.bTiled = true;
				Finish.bBeams = false;
				Finish.Dirt = 0.18;
				Finish.bScuffs = false;
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
				Finish.bBeams = false;
				Finish.Dirt = 0.3;
				Finish.bScuffs = false;
				break;
			case ERoomKind::Plant:
				Finish.bKick = false;
				Finish.Lower = Plain(n"concrete-wall");
				Finish.Upper = Plain(n"concrete-wall");
				Finish.Dirt = 0.8;
				Finish.bDamp = true;
				Finish.Oil = 0.4;
				break;
			case ERoomKind::Corridor:
				Finish.Floor = Painted(n"floor-paint", Vary(Livery.CorridorFloor, Salt, 0.04));
				Finish.Lower = Painted(n"concrete-block", Scale(Vary(Livery.Accent, Salt, 0.04), 0.85));
				Finish.Dado = 1.0;
				Finish.Upper = Painted(n"concrete-block", Light);
				Finish.bBeams = false;
				Finish.Dirt = 0.6;
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

/** A stretch of a wall's face already drawn in its plane: from A0 to A1 along it and Y0 to Y1 up. */
struct FFaceSpan
{
	float A0 = 0.0;
	float A1 = 0.0;
	float Y0 = 0.0;
	float Y1 = 0.0;
};

/** The spans drawn in one plane, as a map's value. */
struct FFaceSpans
{
	TArray<FFaceSpan> Items;
};

/** One stretch of wall in a band of height, and what covers it. */
struct FZone
{
	float From = 0.0;
	float To = 0.0;
	FCoat Coat;
};

/** A doorway, arch or gate through a wall: the gap it leaves, from its floor to its head. */
struct FWallOpening
{
	int Storey = 0;
	EEdge Kind = EEdge::Door;
	float MinX = 0.0;
	float MaxX = 0.0;
	float MinZ = 0.0;
	float MaxZ = 0.0;
	float Y0 = 0.0;
	float Y1 = 0.0;
	/** Whether it runs along x, in a wall facing north and south. */
	bool bAlongX = false;
};

/** A flight of stairs, to place points on it: `at()` in building.ts's stairs(). */
struct FStairs
{
	bool bAlongX = false;
	/** Which way along it rises: +1 or -1. */
	int Sign = 1;
	float A0 = 0.0;
	float A1 = 0.0;

	/** The point T of the way up from the foot, at `Across` and height Y. */
	FVector At(float T, float Across, float Y) const
	{
		const float A = Sign > 0 ? A0 + T * (A1 - A0) : A1 - T * (A1 - A0);
		return bAlongX ? FVector(A, Y, Across) : FVector(Across, Y, A);
	}
};

/** A ladder's line, to place points on it: `point()` in building.ts's ladders(). */
struct FLadderLine
{
	int DX = 0;
	int DZ = 0;
	float MidX = 0.0;
	float MidZ = 0.0;
	/** Where the ladder stands, across from the wall. */
	float Line = 0.0;

	/** A point `Across` its middle, `Out` from it away from the wall, at height Y. */
	FVector At(float Across, float Out, float Y) const
	{
		return DX != 0 ? FVector(Line - DX * Out, Y, MidZ + Across) : FVector(MidX + Across, Y, Line - DZ * Out);
	}

	/** A point on a hoop of the cage at height Y, Angle round from one side. */
	FVector Arc(float Y, float Angle) const
	{
		return At(Math::Cos(Angle) * (Tiles::LADDER_WIDTH / 2 + 0.02), 0.04 + Math::Sin(Angle) * 0.62, Y);
	}
};

/**
 * How a skin wears: what M_Surface needs to work out client/src/building.ts's wear per pixel, in the
 * instance's custom data 3 to 14 (see Tools/import/surfaces.py). Heights and places in game meters.
 */
struct FWear
{
	/** 1 a wall facing a room, 2 a floor, 3 a ceiling, 4 steelwork and the rest; 0 none. */
	int Kind = 4;
	/** The floor of its storey; steelwork is dirtiest just above it. Below -999: the skin's own storey's. */
	float Base = -1000.0;
	float Ceiling = 0.0;
	/** `dirtOf`: the room's dirt, worse the further in it is; steelwork's own. */
	float Dirt = 0.3;
	/** 1 scuffs, 2 damp. */
	int Flags = 0;
	/** A wall's storey; a floor's oil. */
	float Extra = 0.0;
	/**
	 * A wall: where its corners are along it (A, B), and how dark each is (C, D). A floor or ceiling:
	 * the faces of the walls west, east, south and north of it, far off where there's none.
	 */
	float A = -10000.0;
	float B = 10000.0;
	float C = -10000.0;
	float D = 10000.0;
	/** A floor's tone: bare concrete is sealed darker than the bake's fresh slab. */
	float Tone = 1.0;
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
	/** Steps in a flight of stairs. */
	const int STEPS = 16;
	/** Railing posts placed so far, by where they stand, so railings that meet share one. */
	TSet<FString> Posts;
	/** Every doorway, arch and gate in the walls. */
	TArray<FWallOpening> Openings;
	/** How far below the roof a suspended ceiling hangs: just clear of the deck's ribs. */
	const float SUSPENDED_DROP = 0.045;
	/** The wear of whatever is placed next: steelwork's unless a wall, floor or ceiling sets its own. */
	FWear Wear;
	/** Walls' faces drawn so far, by plane (PlaneKey()). */
	TMap<FString, FFaceSpans> Drawn;

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
		FindOpenings();
		for (const FFloor& Floor : Level.Floors)
		{
			if (!Floor.bHasRise)
				AddSolid(Level::MakeLevelBox(Floor.Footprint(), Floor.Y - Floor.Thickness, Floor.Thickness, ELevelBoxKind::Wall));
		}

		// Walls tallest first: where faces overlap in a plane, the first drawn is kept, so a doorway's
		// head gives way to the full-height walls beside it.
		TArray<int> ByHeight;
		for (int Index = 0; Index < Level.Boxes.Num(); Index++)
		{
			const ELevelBoxKind Kind = Level.Boxes[Index].Kind;
			if (Kind == ELevelBoxKind::Wall || Kind == ELevelBoxKind::Partition || Kind == ELevelBoxKind::Pit)
				ByHeight.Add(Index);
		}
		for (int I = 1; I < ByHeight.Num(); I++)
		{
			const int Index = ByHeight[I];
			int J = I - 1;
			while (J >= 0 && Level.Boxes[ByHeight[J]].Height < Level.Boxes[Index].Height)
			{
				ByHeight[J + 1] = ByHeight[J];
				J--;
			}
			ByHeight[J + 1] = Index;
		}
		for (int Index : ByHeight)
		{
			Walls(Level.Boxes[Index]);
			if (Level.Boxes[Index].Kind == ELevelBoxKind::Pit)
				PitEdges(Level.Boxes[Index]);
		}
		for (const FLevelBox& Box : Level.Boxes)
		{
			switch (Box.Kind)
			{
				case ELevelBoxKind::Rail:
					Railing(Box);
					break;
				default:
					break;
			}
		}
		for (const FFloor& Floor : Level.Floors)
			Floors(Floor);
		for (const FLadder& Ladder : Level.Ladders)
			DrawLadder(Ladder);
		for (const FWallOpening& Opening : Openings)
		{
			if (Opening.Kind == EEdge::Door)
				Threshold(Opening);
			else
				OpeningTrim(Opening);
		}
		for (const FRoom& Room : Level.Rooms)
		{
			Lanes(Room);
			Beams(Room);
		}
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
			ERoomKind Dressed = Generate::DressedAs(Kind);
			bBasement = Storey < 0 && Dressed != ERoomKind::Office && Dressed != ERoomKind::Staff;
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
				FaceUnlessDrawn(Box, false, Sign, FaceZ, A0, A1, Box.Y, Top);
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
				FaceUnlessDrawn(Box, true, Sign, FaceX, A0, A1, Box.Y, Top);
			}
		}
		// The underside of a doorway's head, as the wall's upper coat, and a top no floor covers.
		const float CX = (Box.MinX + Box.MaxX) / 2;
		const float CZ = (Box.MinZ + Box.MaxZ) / 2;
		if (Box.Y > StoreyOf(Box.Y + 0.01) * Tiles::STOREY + 0.5 && !Inside(CX, Box.Y - LOOK, CZ))
		{
			const FFinish Finish = FinishAt(StoreyOf(Box.Y), ColOf(CX), RowOf(CZ));
			FWallOpening Opening;
			FCoat Under = Finish.Upper.Surface == n"corrugated" ? Finish.Lower : Finish.Upper;
			if (OpeningAt(CX, Box.Y, CZ, Opening) && Opening.Kind == EEdge::Arch)
				Under = Building::Painted(n"painted-steel", Livery.Accent);
			AddSkin(Under, Box.MinX, Box.MaxX, Box.Y, Box.Y + SKIN, Box.MinZ, Box.MaxZ);
		}
		if (!Inside(CX, Top + LOOK, CZ) && Box.Kind != ELevelBoxKind::Pit)
			AddSkin(Building::Plain(n"concrete-wall"), Box.MinX, Box.MaxX, Top - SKIN, Top, Box.MinZ, Box.MaxZ);
	}

	/** Which plane a wall's face is in: facing along x or z, which way, and where. */
	FString PlaneKey(bool bAlongX, int Sign, float Face)
	{
		const int Axis = bAlongX ? 1 : 0;
		return f"{Axis} {Sign} {Math::RoundToInt(Face * 1000)}";
	}

	/**
	 * A piece of a wall's side, as WallFace() has it, less what of it faces already drawn in its plane
	 * cover at every height it has: those parts would share their plane with it and flicker.
	 */
	void FaceUnlessDrawn(FLevelBox Box, bool bAlongX, int Sign, float Face, float A0, float A1, float Y0, float Y1)
	{
		const FString Key = PlaneKey(bAlongX, Sign, Face);
		TArray<FFaceSpan> Left;
		FFaceSpan Whole;
		Whole.A0 = A0;
		Whole.A1 = A1;
		Whole.Y0 = Y0;
		Whole.Y1 = Y1;
		Left.Add(Whole);
		FFaceSpans Before;
		if (Drawn.Find(Key, Before))
		{
			for (const FFaceSpan& Done : Before.Items)
			{
				if (Done.Y0 > Y0 + 0.001 || Done.Y1 < Y1 - 0.001)
					continue;
				TArray<FFaceSpan> Cut;
				for (const FFaceSpan& Part : Left)
				{
					if (Done.A1 <= Part.A0 || Done.A0 >= Part.A1)
					{
						Cut.Add(Part);
						continue;
					}
					FFaceSpan Lo = Part;
					Lo.A1 = Done.A0;
					FFaceSpan Hi = Part;
					Hi.A0 = Done.A1;
					if (Lo.A1 - Lo.A0 >= 0.005)
						Cut.Add(Lo);
					if (Hi.A1 - Hi.A0 >= 0.005)
						Cut.Add(Hi);
				}
				Left = Cut;
			}
		}
		for (const FFaceSpan& Part : Left)
		{
			const float Mid = (Part.A0 + Part.A1) / 2;
			const float LookX = bAlongX ? Face + Sign * LOOK : Mid;
			const float LookZ = bAlongX ? Mid : Face + Sign * LOOK;
			if (WallFace(Box, LookX, LookZ, Y0, Y1, bAlongX, Sign, Face, Part.A0, Part.A1))
			{
				FFaceSpans& Spans = Drawn.FindOrAdd(Key);
				Spans.Items.Add(Part);
			}
		}
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
	 * finish in front, by height above that storey's floor. Whether it was drawn.
	 */
	bool WallFace(FLevelBox Box, float LookX, float LookZ, float Y0, float Y1, bool bAlongX, int Sign, float Face, float A0, float A1)
	{
		const float MidY = (Y0 + Y1) / 2;
		if (Inside(LookX, MidY, LookZ))
			return false;
		const int Storey = StoreyOf(Y0 + 0.01);
		const float Base = Storey * Tiles::STOREY;
		const int Col = ColOf(LookX);
		const int Row = RowOf(LookZ);
		TArray<FZone> Zones;
		const float Mid = (A0 + A1) / 2;
		ZonesOf(Box, Storey, Col, Row, bAlongX ? Face : Mid, MidY, bAlongX ? Mid : Face, Zones);
		Wear = WallWear(Storey, Col, Row, bAlongX, Sign, Face, A0, A1, Y0, Y1);
		for (const FZone& Zone : Zones)
		{
			const float From = Math::Max(Y0, Base + Zone.From);
			const float To = Math::Min(Y1, Base + Zone.To);
			if (To - From < 0.002)
				continue;
			FacePlate(Zone.Coat, bAlongX, Face, Sign > 0 ? -SKIN : SKIN, A0, A1, From, To);
			if (Zone.Coat.Surface == n"corrugated")
				Corrugations(Zone.Coat, bAlongX, Sign, Face, A0, A1, From, To);
			// Skirting and trim strips stand proud of the wall, to catch the light along their tops.
			if (To - From <= 0.12 && (Zone.Coat.Surface == n"rubber" || Zone.Coat.Surface == n"painted-steel"))
				FacePlate(Zone.Coat, bAlongX, Face, Sign * (Zone.Coat.Surface == n"rubber" ? 0.012 : 0.008), A0, A1, From, To);
		}
		Wear = FWear();
		if (!InGrid(Col, Row) || Box.Kind == ELevelBoxKind::Pit || IsRock(Box))
			return true;
		const FFinish Finish = FinishAt(Storey, Col, Row);
		const float Ceiling = CeilingOf(Storey);
		const int Top = Parsed.Levels - Parsed.Basements - 1;
		if (Y1 >= Ceiling - 0.001)
		{
			// Under the roof, a closure angle where the wall meets the deck, hiding the ribs' ends.
			if (Storey == Top && !(Finish.bTiled && Suspended(Col, Row)))
				FacePlate(Building::Painted(n"painted-steel", Livery.Steel), bAlongX, Face, Sign * 0.05, A0, A1, Ceiling - 0.07, Ceiling);
			// A trim where walls meet a tiled ceiling.
			if (Finish.bTiled)
			{
				const float Y = Storey == Top ? Ceiling - SUSPENDED_DROP : Ceiling;
				FacePlate(Building::Painted(n"painted-steel", Building::Rgb(0.86, 0.86, 0.84)), bAlongX, Face, Sign * 0.022, A0, A1, Y - 0.022, Y);
			}
		}
		// Steel columns along the outer walls of big rooms, a cell apart.
		if (IsOuter(Box) && Finish.bPilasters && Storey >= 0 && Y0 <= Base + 0.001 && Y1 >= Ceiling - 0.001)
		{
			const float Origin = bAlongX ? Z0 : X0;
			const int Last = bAlongX ? Parsed.Rows : Parsed.Cols;
			for (int K = Math::CeilToInt((A0 - Origin - 0.001) / Tiles::CELL); Origin + K * Tiles::CELL < A1 - 0.35; K++)
			{
				if (K > 0 && K < Last)
					Pilaster(Storey, Col, Row, bAlongX, Sign, Face, Origin + K * Tiles::CELL);
			}
		}
		return true;
	}

	/** A plate on a wall's face from Face out by Out (negative: into the wall), A0 to A1 along it. */
	void FacePlate(FCoat Coat, bool bAlongX, float Face, float Out, float A0, float A1, float Y0, float Y1)
	{
		const float Lo = Math::Min(Face, Face + Out);
		const float Hi = Math::Max(Face, Face + Out);
		if (bAlongX)
			AddSkin(Coat, Lo, Hi, Y0, Y1, A0, A1);
		else
			AddSkin(Coat, A0, A1, Y0, Y1, Lo, Hi);
	}

	/**
	 * `corrugated()`: cladding's corrugations as geometry, over the flat face of a wall facing out
	 * along x (`bAlongX`) or z by `Sign` from `Face`, from A0 to A1 along it and from Y0 to Y1. Whole
	 * sheets (models/level/corrugated-sheet) where they fit between the texture's side laps, every
	 * 0.762 m from 0, so their crests are the texture's; single corrugations (corrugated-strip) past
	 * them; and the flat face under them shows in what's left at the ends, under one corrugation.
	 */
	void Corrugations(FCoat Coat, bool bAlongX, int Sign, float Face, float A0, float A1, float Y0, float Y1)
	{
		const float PITCH = 0.0762;
		const int PER_SHEET = 10;
		// The models stand out along their +X, run along their -Y from their origin, and rise along +Z.
		const FVector Out = bAlongX ? World::ToWorld(Sign, 0, 0) : World::ToWorld(0, 0, Sign);
		const FRotator Rotation = FRotator::MakeFromXZ(Out, FVector(0, 0, 1));
		const FVector Along = bAlongX ? World::ToWorld(0, 0, 1) : World::ToWorld(1, 0, 0);
		const bool bForward = Rotation.RightVector.DotProduct(Along) < 0;
		const int First = Math::CeilToInt(A0 / PITCH - 0.001);
		const int Last = Math::FloorToInt(A1 / PITCH + 0.001);
		int K = First;
		while (K < Last)
		{
			const bool bSheet = ((K % PER_SHEET) + PER_SHEET) % PER_SHEET == 0 && K + PER_SHEET <= Last;
			const int Count = bSheet ? PER_SHEET : 1;
			const float Start = (bForward ? K : K + Count) * PITCH;
			const FVector At = bAlongX ? World::ToWorld(Face, Y0, Start) : World::ToWorld(Start, Y0, Face);
			const FTransform Transform(Rotation, At, FVector(1, 1, Y1 - Y0));
			const FName Model = bSheet ? n"corrugated-sheet" : n"corrugated-strip";
			AddPainted(MeshFor(Coat.Surface, Model), Coat.Surface, Coat, Transform);
			K += Count;
		}
	}

	/** `pilaster()`: a steel column half buried in an outer wall at `At` along it, and its base plate. */
	void Pilaster(int Storey, int Col, int Row, bool bAlongX, int Sign, float Face, float At)
	{
		// Not where a wall meets this one.
		const float PX = bAlongX ? Face + Sign * 0.5 : At;
		const float PZ = bAlongX ? At : Face + Sign * 0.5;
		const float Base = Storey * Tiles::STOREY;
		for (float DX = -0.28; DX <= 0.29; DX += 0.14)
		{
			for (float DZ = -0.28; DZ <= 0.29; DZ += 0.14)
			{
				if (Inside(PX + DX, Base + 1, PZ + DZ))
					return;
			}
		}
		const FCoat Steel = Building::Painted(n"painted-steel", Livery.Steel);
		const float Lo = Math::Min(Face, Face + Sign * 0.07) - 0.01;
		const float Hi = Math::Max(Face, Face + Sign * 0.07);
		const float Half = 0.11;
		const float Ceiling = CeilingOf(Storey);
		if (bAlongX)
			AddSkin(Steel, Lo, Hi, Base, Ceiling, At - Half, At + Half);
		else
			AddSkin(Steel, At - Half, At + Half, Base, Ceiling, Lo, Hi);
		// A base plate, where there's a floor for it to stand on.
		const ETileKind Standing = Parsed.Tile(Storey, Col, Row).Kind;
		if (Standing != ETileKind::Floor && Standing != ETileKind::Tv && Standing != ETileKind::Ladder)
			return;
		const float Lo2 = Math::Min(Face, Face + Sign * 0.1) - 0.01;
		const float Hi2 = Math::Max(Face, Face + Sign * 0.1);
		if (bAlongX)
			AddSkin(Steel, Lo2, Hi2, Base, Base + 0.025, At - Half - 0.04, At + Half + 0.04);
		else
			AddSkin(Steel, At - Half - 0.04, At + Half + 0.04, Base, Base + 0.025, Lo2, Hi2);
	}

	bool IsRock(FLevelBox Box)
	{
		return Box.Kind == ELevelBoxKind::Wall && Box.MaxX - Box.MinX >= Tiles::CELL - 0.1 && Box.MaxZ - Box.MinZ >= Tiles::CELL - 0.1;
	}

	bool IsOuter(FLevelBox Box)
	{
		return Box.Kind == ELevelBoxKind::Wall && !IsRock(Box) && Math::Min(Box.MaxX - Box.MinX, Box.MaxZ - Box.MinZ) > Tiles::LADDER_WALL + 0.01;
	}

	/** Where a storey's ceiling is: the underside of the slab above, or the roof over the top storey. */
	float CeilingOf(int Storey)
	{
		const float Base = Storey * Tiles::STOREY;
		if (Storey == Parsed.Levels - Parsed.Basements - 1)
			return Base + Tiles::STOREY;
		return Base + Tiles::STOREY - (Storey + 1 == 0 ? Tiles::GROUND : Tiles::SLAB);
	}

	/** Whether a cell on the top storey has a suspended ceiling instead of the roof's deck. */
	bool Suspended(int Col, int Row)
	{
		const int Top = Parsed.Levels - Parsed.Basements - 1;
		const ETileKind Kind = Parsed.Tile(Top, Col, Row).Kind;
		if (Kind != ETileKind::Floor && Kind != ETileKind::Tv && Kind != ETileKind::Ladder)
			return false;
		return FinishAt(Top, Col, Row).bTiled;
	}

	/** `zonesOf`: the coats a wall face takes, by height above its floor. */
	void ZonesOf(FLevelBox Box, int Storey, int Col, int Row, float CX, float MidY, float CZ, TArray<FZone>& Zones)
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
		// Arch reveals: hazard stripes where they're hit, steel above.
		FWallOpening Opening;
		if (OpeningAt(CX, MidY, CZ, Opening) && Opening.Kind == EEdge::Arch)
		{
			Zone(Zones, -99, 1.2, Building::Plain(n"hazard"));
			Zone(Zones, 1.2, 99, Building::Painted(n"painted-steel", Livery.Accent));
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
			if (Floor.Kind == EFloorKind::Stairs)
				Stairs(Floor);
			else
			{
				UInstancedStaticMeshComponent Mesh = MeshFor(n"concrete-floor");
				AddPainted(Mesh, n"concrete-floor", Building::Plain(n"concrete-floor"), Shapes::RampTransform(Floor));
			}
			return;
		}
		if (Floor.Kind == EFloorKind::Plank)
		{
			Plank(Floor);
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
				Wear = InGrid(Col, Row) ? SurfaceWear(2, Storey, Col, Row, X, X1, Z, Z1, Floor.Y + 0.5) : FWear();
				if (Top.Surface == n"concrete-floor")
					Wear.Tone = 0.8;
				AddSkin(Top, X, X1, Floor.Y - SKIN, Floor.Y, Z, Z1);
				Wear = FWear();
				if (Inside((X + X1) / 2, Bottom - LOOK, (Z + Z1) / 2) || !InGrid(Col, Row) || Storey - 1 < -Parsed.Basements)
					continue;
				const bool bTiled = FinishAt(Storey - 1, Col, Row).bTiled;
				Wear = SurfaceWear(3, Storey - 1, Col, Row, X, X1, Z, Z1, Bottom - 0.3);
				AddSkin(Building::Plain(bTiled ? n"ceiling-tile" : n"concrete-wall"), X, X1, Bottom, Bottom + SKIN, Z, Z1);
				Wear = FWear();
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
				Wear = SurfaceWear(3, Top, Col, Row, X, X + Tiles::CELL, Z, Z + Tiles::CELL, Y - 0.3);
				if (bTiled && Suspended(Col, Row))
					AddSkin(Building::Plain(n"ceiling-tile"), X, X + Tiles::CELL, Y - SUSPENDED_DROP, Y - SUSPENDED_DROP + SKIN, Z, Z + Tiles::CELL);
				AddSkin(Building::Plain(n"metal-deck"), X, X + Tiles::CELL, Y, Y + SKIN, Z, Z + Tiles::CELL);
				Wear = FWear();
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

	// ---- Stairs, railings, ladders, pits and planks ----

	/** `stairs()`: sixteen steps with hazard nosings, sides where open, handrails and stringers. */
	void Stairs(FFloor Floor)
	{
		const int Storey = StoreyOf(Floor.Y + 0.01);
		const ESide Toward = Floor.RiseToward;
		const bool bAlongX = Tiles::OffsetX(Toward) != 0;
		FStairs S;
		S.bAlongX = bAlongX;
		S.Sign = bAlongX ? Tiles::OffsetX(Toward) : Tiles::OffsetZ(Toward);
		S.A0 = bAlongX ? Floor.MinX : Floor.MinZ;
		S.A1 = bAlongX ? Floor.MaxX : Floor.MaxZ;
		const float C0 = bAlongX ? Floor.MinZ : Floor.MinX;
		const float C1 = bAlongX ? Floor.MaxZ : Floor.MaxX;
		const float Length = S.A1 - S.A0;
		const float Base = Floor.Y;
		const float Height = Floor.RiseHeight;
		const int Col = ColOf((Floor.MinX + Floor.MaxX) / 2);
		const int Row = RowOf((Floor.MinZ + Floor.MaxZ) / 2);
		TArray<ESide> Sides;
		Sides.Add(bAlongX ? ESide::N : ESide::E);
		Sides.Add(bAlongX ? ESide::S : ESide::W);

		const FCoat Concrete = Building::Plain(n"concrete-floor");
		const FCoat Wall = Building::Plain(n"concrete-wall");
		const FCoat Hazard = Building::Plain(n"hazard");
		const float Skin = SKIN / Length;
		for (int I = 0; I < STEPS; I++)
		{
			const float T0 = float(I) / STEPS;
			const float T1 = float(I + 1) / STEPS;
			const float Y = Tread(Base, Height, I);
			const float Below = I == 0 ? Base : Tread(Base, Height, I - 1);
			// The tread, its riser and a hazard nosing on its front edge.
			Block(Concrete, S.At(T0, C0, Y - SKIN), S.At(T1, C1, Y));
			Block(Concrete, S.At(T0, C0, Below), S.At(T0 + Skin, C1, Y));
			Block(Hazard, S.At(T0 + 0.004, C0 + 0.08, Y - 0.002), S.At(T0 + 0.05 / Length + 0.004, C1 - 0.08, Y + 0.004));
			for (ESide Side : Sides)
			{
				if (!StairSideOpen(Storey, Col, Row, Side))
					continue;
				const int Out = bAlongX ? Tiles::OffsetZ(Side) : Tiles::OffsetX(Side);
				const float Across = Out > 0 ? C1 : C0;
				Block(Wall, S.At(T0, Across - Out * SKIN, Base), S.At(T1, Across, Y));
			}
		}
		// The back of the stairs, under the top step.
		Block(Wall, S.At(1 - Skin, C0, Base), S.At(1, C1, Tread(Base, Height, STEPS - 1)));

		// Handrails up both sides: posts, top and middle rails, and a steel stringer along open
		// sides; against a wall, a rail on brackets.
		const FCoat Rail = Building::Painted(n"painted-steel", Livery.Rail);
		const FCoat Steel = Building::Painted(n"painted-steel", Livery.Steel);
		for (ESide Side : Sides)
		{
			const int Out = bAlongX ? Tiles::OffsetZ(Side) : Tiles::OffsetX(Side);
			const bool bWalled = !StairSideOpen(Storey, Col, Row, Side);
			const float Inset = bWalled ? Tiles::WALL / 2 + 0.07 : 0.03;
			const float Across = Out > 0 ? C1 - Inset : C0 + Inset;
			Bar(Rail, S.At(-0.02, Across, Base + 0.95), S.At(1.02, Across, Base + Height + 0.95), 0.044, 0.044);
			if (bWalled)
			{
				const float AtWall = Out > 0 ? C1 - Tiles::WALL / 2 : C0 + Tiles::WALL / 2;
				for (float T = 0.1; T < 1; T += 0.3)
					Bar(Rail, S.At(T, Across, Base + Height * T + 0.9), S.At(T, AtWall, Base + Height * T + 0.9), 0.016, 0.016);
				continue;
			}
			Bar(Rail, S.At(0, Across, Base + 0.5), S.At(1, Across, Base + Height + 0.5), 0.032, 0.032);
			const int PostCount = Math::CeilToInt(Length / 1.1);
			for (int K = 0; K <= PostCount; K++)
			{
				const float T = float(K) / PostCount;
				const FVector Top = S.At(T, Across, Base + Height * T + 0.95);
				const float FootY = Tread(Base, Height, Math::Min(STEPS - 1, Math::FloorToInt(T * STEPS)));
				Block(Rail, FVector(Top.X - 0.02, FootY, Top.Z - 0.02), FVector(Top.X + 0.02, Top.Y, Top.Z + 0.02));
			}
			// The stringer: a steel plate along the side, following the nosings.
			const float Plate = (Out > 0 ? C1 : C0) + Out * 0.008;
			Bar(Steel, S.At(0, Plate, Base + 0.02), S.At(1, Plate, Base + Height - 0.06), 0.012, 0.24);
		}
	}

	/** Where the top of step I is: halfway up its rise, as the web game draws it. */
	float Tread(float Base, float Height, int I)
	{
		return Base + Height * (I + 0.5) / STEPS;
	}

	/** A side of the stairs open to the room beside, so drawn: no wall, and something other than rock. */
	bool StairSideOpen(int Storey, int Col, int Row, ESide Side)
	{
		const FTile Next = Parsed.Tile(Storey, Col + Tiles::OffsetX(Side), Row + Tiles::OffsetZ(Side));
		return Parsed.Edge(Storey, Col, Row, Side) == EEdge::None && Next.Kind != ETileKind::None && Next.Kind != ETileKind::Solid;
	}

	/** `railings()`: top and middle rails, a kick plate, posts on base plates, and the slab's nose. */
	void Railing(FLevelBox Box)
	{
		const int Storey = StoreyOf(Box.Y);
		const FCoat Rail = Building::Painted(n"painted-steel", Livery.Rail);
		const bool bAlongX = Box.MaxX - Box.MinX > Box.MaxZ - Box.MinZ;
		const float Mid = bAlongX ? (Box.MinZ + Box.MaxZ) / 2 : (Box.MinX + Box.MaxX) / 2;
		const float Start = bAlongX ? Box.MinX : Box.MinZ;
		const float End = bAlongX ? Box.MaxX : Box.MaxZ;
		const float Top = Box.Y + Box.Height;
		Bar(Rail, AlongAt(bAlongX, Start, Top - 0.025, Mid), AlongAt(bAlongX, End, Top - 0.025, Mid), 0.05, 0.05);
		Bar(Rail, AlongAt(bAlongX, Start, Box.Y + 0.5, Mid), AlongAt(bAlongX, End, Box.Y + 0.5, Mid), 0.032, 0.032);
		// The kick plate, standing on the slab's edge.
		RailSpan(Rail, bAlongX, Start, End, Mid - 0.004, Mid + 0.004, Box.Y, Box.Y + 0.1);
		// The slab's nose: a steel angle over its edge, and hazard paint inside the railing.
		const float Across0 = bAlongX ? Box.MinZ : Box.MinX;
		const float Across1 = bAlongX ? Box.MaxZ : Box.MaxX;
		const float Middle = (Start + End) / 2;
		const int Sign = OpenBeyond(Storey, bAlongX, Middle, Across1 + 0.05) ? 1 : (OpenBeyond(Storey, bAlongX, Middle, Across0 - 0.05) ? -1 : 0);
		if (Sign != 0)
		{
			const float Edge = Sign > 0 ? Across1 : Across0;
			const FCoat Steel = Building::Painted(n"painted-steel", Livery.Steel);
			RailSpan(Steel, bAlongX, Start, End, Edge - Sign * 0.05, Edge + Sign * 0.006, Box.Y, Box.Y + 0.006);
			RailSpan(Steel, bAlongX, Start, End, Edge, Edge + Sign * 0.006, Box.Y - 0.1, Box.Y + 0.006);
			RailSpan(Building::Plain(n"hazard"), bAlongX, Start, End, Edge - Sign * 0.07, Edge - Sign * 0.19, Box.Y, Box.Y + 0.003);
		}
		const int Count = Math::Max(1, Math::RoundToInt((End - Start) / 1.33));
		for (int I = 0; I <= Count; I++)
		{
			const FVector P = AlongAt(bAlongX, Start + (End - Start) * I / Count, Top, Mid);
			const FString Key = f"{Math::RoundToInt(P.X * 20)},{Math::RoundToInt(P.Y * 20)},{Math::RoundToInt(P.Z * 20)}";
			if (Posts.Contains(Key))
				continue;
			Posts.Add(Key);
			Block(Rail, FVector(P.X - 0.025, Box.Y, P.Z - 0.025), FVector(P.X + 0.025, Top - 0.05, P.Z + 0.025));
			// A base plate bolted down.
			Block(Rail, FVector(P.X - 0.05, Box.Y, P.Z - 0.05), FVector(P.X + 0.05, Box.Y + 0.012, P.Z + 0.05));
		}
	}

	/** A point along a railing (A) at a height, on its middle line across. */
	FVector AlongAt(bool bAlongX, float A, float Y, float Across)
	{
		return bAlongX ? FVector(A, Y, Across) : FVector(Across, Y, A);
	}

	/** A box along a railing from Start to End, between two lines across and two heights. */
	void RailSpan(FCoat Coat, bool bAlongX, float Start, float End, float Across0, float Across1, float Y0, float Y1)
	{
		Block(Coat, AlongAt(bAlongX, Start, Y0, Across0), AlongAt(bAlongX, End, Y1, Across1));
	}

	/** Whether the cell past a railing, at this point across it, is open air. */
	bool OpenBeyond(int Storey, bool bAlongX, float Middle, float Across)
	{
		const int Col = bAlongX ? ColOf(Middle) : ColOf(Across);
		const int Row = bAlongX ? RowOf(Across) : RowOf(Middle);
		const ETileKind Kind = Parsed.Tile(Storey, Col, Row).Kind;
		return Kind == ETileKind::Open || Kind == ETileKind::Well;
	}

	/** `ladders()`: flat-bar stiles, round rungs, brackets back to the wall and a safety cage. */
	void DrawLadder(FLadder Ladder)
	{
		const FCoat Steel = Building::Plain(n"galvanised");
		const int DX = Tiles::OffsetX(Ladder.Toward);
		const int DZ = Tiles::OffsetZ(Ladder.Toward);
		const int Sign = DX != 0 ? DX : DZ;
		FLadderLine L;
		L.DX = DX;
		L.DZ = DZ;
		L.MidX = (Ladder.MinX + Ladder.MaxX) / 2;
		L.MidZ = (Ladder.MinZ + Ladder.MaxZ) / 2;
		// The wall's face, and the ladder a hand's width out from it.
		const float Face = DX != 0 ? (DX > 0 ? Ladder.MaxX : Ladder.MinX) : (DZ > 0 ? Ladder.MaxZ : Ladder.MinZ);
		L.Line = Face - Sign * Tiles::LADDER_WALL - Sign * 0.14;
		const float Top = Ladder.Top + 1.05;
		const float Half = Tiles::LADDER_WIDTH / 2;
		const FVector Out = DX != 0 ? FVector(1, 0, 0) : FVector(0, 0, 1);
		for (int Side = -1; Side <= 1; Side += 2)
		{
			Bar(Steel, L.At(Side * Half, 0, Ladder.Y), L.At(Side * Half, 0, Top), 0.016, 0.06, Out);
			for (float Y = Ladder.Y + 0.4; Y < Top; Y += 1.3)
				Bar(Steel, L.At(Side * Half, -0.03, Y), L.At(Side * Half, -0.14, Y), 0.024, 0.024);
		}
		for (float Y = Ladder.Y + 0.3; Y < Top - 0.1; Y += 0.3)
			Bar(Steel, L.At(-Half, 0, Y), L.At(Half, 0, Y), 0.026, 0.026);
		// The cage, from head height up: hoops of flat bar, and three uprights.
		TArray<float> Hoops;
		for (float Y = Ladder.Y + 2.3; Y <= Top + 0.0001; Y += 0.7)
			Hoops.Add(Y);
		for (float Y : Hoops)
		{
			for (int K = 0; K < 8; K++)
				Bar(Steel, L.Arc(Y, K * PI / 8), L.Arc(Y, (K + 1) * PI / 8), 0.008, 0.05, FVector(0, 1, 0));
		}
		if (Hoops.Num() > 1)
		{
			TArray<float> Angles;
			Angles.Add(0.5);
			Angles.Add(PI / 2);
			Angles.Add(PI - 0.5);
			for (float Angle : Angles)
				Bar(Steel, L.Arc(Hoops[0], Angle), L.Arc(Hoops.Last(), Angle), 0.02, 0.02);
		}
	}

	/** `pits()`: a steel angle on the slab's nose over a pit, and hazard paint on the floor behind it. */
	void PitEdges(FLevelBox Box)
	{
		const float Top = Box.Y + Box.Height;
		const int Storey = StoreyOf(Top);
		const bool bAlongX = Box.MaxX - Box.MinX > Box.MaxZ - Box.MinZ;
		const float A0 = bAlongX ? Box.MinX : Box.MinZ;
		const float A1 = bAlongX ? Box.MaxX : Box.MaxZ;
		const FCoat Steel = Building::Painted(n"painted-steel", Livery.Steel);
		for (int S = -1; S <= 1; S += 2)
		{
			const float E = bAlongX ? (S > 0 ? Box.MaxZ : Box.MinZ) : (S > 0 ? Box.MaxX : Box.MinX);
			const int Col = bAlongX ? ColOf((Box.MinX + Box.MaxX) / 2) : ColOf(E + S * 0.05);
			const int Row = bAlongX ? RowOf(E + S * 0.05) : RowOf((Box.MinZ + Box.MaxZ) / 2);
			const ETileKind Kind = Parsed.Tile(Storey, Col, Row).Kind;
			if (Kind != ETileKind::Pit && Kind != ETileKind::Bridge)
				continue;
			RailSpan(Steel, bAlongX, A0, A1, E, E + S * 0.006, Top - 0.06, Top + 0.004);
			RailSpan(Steel, bAlongX, A0, A1, E, E - S * 0.06, Top, Top + 0.005);
			RailSpan(Building::Plain(n"hazard"), bAlongX, A0, A1, E - S * 0.06, E - S * 0.2, Top, Top + 0.003);
		}
	}

	/** `planks()`: two scaffold boards across a pit, with steel bands round their ends. */
	void Plank(FFloor Floor)
	{
		const int Storey = StoreyOf(Floor.Y + 0.01);
		const bool bAlongX = Floor.MaxX - Floor.MinX > Floor.MaxZ - Floor.MinZ;
		const int Col = ColOf((Floor.MinX + Floor.MaxX) / 2);
		const int Row = RowOf((Floor.MinZ + Floor.MaxZ) / 2);
		const bool bBridgeBefore = Parsed.Tile(Storey, Col - (bAlongX ? 1 : 0), Row - (bAlongX ? 0 : 1)).Kind == ETileKind::Bridge;
		const bool bBridgeAfter = Parsed.Tile(Storey, Col + (bAlongX ? 1 : 0), Row + (bAlongX ? 0 : 1)).Kind == ETileKind::Bridge;
		const float A0 = (bAlongX ? Floor.MinX : Floor.MinZ) - (bBridgeBefore ? 0.003 : 0.2);
		const float A1 = (bAlongX ? Floor.MaxX : Floor.MaxZ) + (bBridgeAfter ? 0.003 : 0.2);
		const float C0 = bAlongX ? Floor.MinZ : Floor.MinX;
		const float C1 = bAlongX ? Floor.MaxZ : Floor.MaxX;
		const float Width = (C1 - C0 - 0.02) / 2;
		const float Y0 = Floor.Y - 0.045;
		for (int K = 0; K < 2; K++)
		{
			const float B0 = C0 + K * (Width + 0.02);
			const float B1 = B0 + Width;
			const float Lift = K * 0.004;
			RailSpan(Building::Plain(n"wood-plank"), bAlongX, A0, A1, B0, B1, Y0, Floor.Y + Lift);
			RailSpan(Building::Plain(n"galvanised"), bAlongX, A0 + 0.06, A0 + 0.09, B0 - 0.002, B1 + 0.002, Y0 - 0.002, Floor.Y + Lift + 0.002);
			RailSpan(Building::Plain(n"galvanised"), bAlongX, A1 - 0.09, A1 - 0.06, B0 - 0.002, B1 + 0.002, Y0 - 0.002, Floor.Y + Lift + 0.002);
		}
	}

	// ---- Openings, lanes and beams ----

	/** `findOpenings()`: every doorway, arch and gate, from the grid's edges. */
	void FindOpenings()
	{
		for (int Storey = -Parsed.Basements; Storey < Parsed.Levels - Parsed.Basements; Storey++)
		{
			for (int Row = 0; Row < Parsed.Rows; Row++)
			{
				for (int Col = 0; Col < Parsed.Cols; Col++)
				{
					for (int Index = 0; Index < 4; Index++)
					{
						const ESide Side = Tiles::SideAt(Index);
						const bool bOuter = !InGrid(Col + Tiles::OffsetX(Side), Row + Tiles::OffsetZ(Side));
						if (!bOuter && (Side == ESide::S || Side == ESide::W))
							continue;
						const EEdge Edge = Parsed.Edge(Storey, Col, Row, Side);
						if (Edge != EEdge::Door && Edge != EEdge::Arch && Edge != EEdge::Gate)
							continue;
						const float Width = Edge == EEdge::Door ? Tiles::DOOR_WIDTH : (Edge == EEdge::Arch ? Tiles::ARCH_WIDTH : Tiles::GATE_WIDTH);
						const float Height = Edge == EEdge::Door ? Tiles::DOOR_HEIGHT : (Edge == EEdge::Arch ? Tiles::ARCH_HEIGHT : Tiles::GATE_HEIGHT);
						const float CellX = X0 + Col * Tiles::CELL;
						const float CellZ = Z0 + Row * Tiles::CELL;
						const bool bAlongX = Side == ESide::N || Side == ESide::S;
						const float Line = Side == ESide::N ? CellZ + Tiles::CELL : (Side == ESide::S ? CellZ : (Side == ESide::E ? CellX + Tiles::CELL : CellX));
						const float Mid = bAlongX ? CellX + Tiles::CELL / 2 : CellZ + Tiles::CELL / 2;
						FWallOpening Made;
						Made.Storey = Storey;
						Made.Kind = Edge;
						Made.bAlongX = bAlongX;
						Made.MinX = bAlongX ? Mid - Width / 2 : Line - Tiles::WALL / 2;
						Made.MaxX = bAlongX ? Mid + Width / 2 : Line + Tiles::WALL / 2;
						Made.MinZ = bAlongX ? Line - Tiles::WALL / 2 : Mid - Width / 2;
						Made.MaxZ = bAlongX ? Line + Tiles::WALL / 2 : Mid + Width / 2;
						Made.Y0 = Storey * Tiles::STOREY;
						Made.Y1 = Made.Y0 + Height;
						Openings.Add(Made);
					}
				}
			}
		}
	}

	/** The opening whose boundary a point lies on, if any. */
	bool OpeningAt(float X, float Y, float Z, FWallOpening& Found)
	{
		const float E = 0.002;
		for (const FWallOpening& Each : Openings)
		{
			if (X >= Each.MinX - E && X <= Each.MaxX + E && Z >= Each.MinZ - E && Z <= Each.MaxZ + E && Y >= Each.Y0 - E && Y <= Each.Y1 + E)
			{
				Found = Each;
				return true;
			}
		}
		return false;
	}

	/** `openingTrims()`: steel angles on an arch's or a gate's corners and a plate over it, both sides. */
	void OpeningTrim(FWallOpening O)
	{
		const FCoat Steel = Building::Painted(n"painted-steel", Livery.Accent);
		const float Leg = 0.05;
		const float T = 0.006;
		const float L0 = O.bAlongX ? O.MinX : O.MinZ;
		const float L1 = O.bAlongX ? O.MaxX : O.MaxZ;
		const float F0 = O.bAlongX ? O.MinZ : O.MinX;
		const float F1 = O.bAlongX ? O.MaxZ : O.MaxX;
		for (int Side = 0; Side < 2; Side++)
		{
			const float Face = Side == 0 ? F0 : F1;
			const int Out = Side == 0 ? -1 : 1;
			for (int End = 0; End < 2; End++)
			{
				const float Jamb = End == 0 ? L0 : L1;
				const int Into = End == 0 ? -1 : 1;
				// The leg on the wall's face and the leg on the reveal.
				RailSpan(Steel, O.bAlongX, Math::Min(Jamb, Jamb + Into * Leg), Math::Max(Jamb, Jamb + Into * Leg), Face, Face + Out * T, O.Y0, O.Y1 + T);
				RailSpan(Steel, O.bAlongX, Math::Min(Jamb, Jamb - Into * T), Math::Max(Jamb, Jamb - Into * T), Face, Face - Out * Leg, O.Y0, O.Y1);
			}
			// The plate over the opening.
			RailSpan(Steel, O.bAlongX, L0 - 0.1, L1 + 0.1, Face, Face + Out * 0.012, O.Y1, O.Y1 + 0.22);
		}
	}

	/** `thresholds()`: a tread plate across a doorway into a plant room or a workshop, or below ground. */
	void Threshold(FWallOpening O)
	{
		const float X = (O.MinX + O.MaxX) / 2;
		const float Z = (O.MinZ + O.MaxZ) / 2;
		const float OX = O.bAlongX ? 0 : 0.3;
		const float OZ = O.bAlongX ? 0.3 : 0;
		bool bRough = O.Storey < 0;
		for (int K = -1; K <= 1; K += 2)
		{
			const int Room = RoomOf(O.Storey, ColOf(X + K * OX), RowOf(Z + K * OZ));
			if (Room >= 0 && (Generate::DressedAs(Level.Rooms[Room].Kind) == ERoomKind::Plant || Generate::DressedAs(Level.Rooms[Room].Kind) == ERoomKind::Workshop))
				bRough = true;
		}
		if (!bRough)
			return;
		const float Grow = 0.18;
		AddSkin(Building::Plain(n"diamond-plate"), O.MinX - (O.bAlongX ? 0 : Grow), O.MaxX + (O.bAlongX ? 0 : Grow), O.Y0, O.Y0 + 0.006, O.MinZ - (O.bAlongX ? Grow : 0), O.MaxZ + (O.bAlongX ? Grow : 0));
	}

	/** Whether a cell's side is closed: a wall or opening on it, or rock or nothing beyond. */
	bool Walled(int Storey, int Col, int Row, ESide Side)
	{
		const FTile Next = Parsed.Tile(Storey, Col + Tiles::OffsetX(Side), Row + Tiles::OffsetZ(Side));
		return Parsed.Edge(Storey, Col, Row, Side) != EEdge::None || Next.Kind == ETileKind::None || Next.Kind == ETileKind::Solid;
	}

	bool FloorBeyond(int Storey, int Col, int Row, ESide Side)
	{
		const ETileKind Next = Parsed.Tile(Storey, Col + Tiles::OffsetX(Side), Row + Tiles::OffsetZ(Side)).Kind;
		return Next == ETileKind::Floor || Next == ETileKind::Tv;
	}

	/** `lanes()`: painted lines on the floors of halls and the loading bay, a meter in from their walls. */
	void Lanes(FRoom Room)
	{
		if (Room.Storey < 0 || Room.Cells.Num() == 0 || !FinishAt(Room.Storey, Room.Cells[0].Col, Room.Cells[0].Row).bLanes)
			return;
		const float INSET = 1.0;
		const float WIDTH = 0.1;
		const float Base = Room.Storey * Tiles::STOREY;
		const FCoat Paint = Building::Plain(n"floor-paint");
		for (const FColRow& Cell : Room.Cells)
		{
			const ETileKind Kind = Parsed.Tile(Room.Storey, Cell.Col, Cell.Row).Kind;
			if (Kind != ETileKind::Floor && Kind != ETileKind::Tv)
				continue;
			const float CX0 = X0 + Cell.Col * Tiles::CELL;
			const float CZ0 = Z0 + Cell.Row * Tiles::CELL;
			for (int Index = 0; Index < 4; Index++)
			{
				const ESide Side = Tiles::SideAt(Index);
				if (!Walled(Room.Storey, Cell.Col, Cell.Row, Side))
					continue;
				const bool bAlongX = Side == ESide::N || Side == ESide::S;
				const ESide S0 = bAlongX ? ESide::W : ESide::S;
				const ESide S1 = bAlongX ? ESide::E : ESide::N;
				const float A0 = bAlongX ? CX0 : CZ0;
				const float A1 = A0 + Tiles::CELL;
				// Lines along x run into the corners; lines along z stop at them.
				const float Trim = bAlongX ? INSET : INSET + WIDTH;
				// Ending short of whatever isn't floor beyond the cell: a pit's edge, stairs.
				const float Start = Walled(Room.Storey, Cell.Col, Cell.Row, S0) ? A0 + Trim : (FloorBeyond(Room.Storey, Cell.Col, Cell.Row, S0) ? A0 : A0 + 0.3);
				const float End = Walled(Room.Storey, Cell.Col, Cell.Row, S1) ? A1 - Trim : (FloorBeyond(Room.Storey, Cell.Col, Cell.Row, S1) ? A1 : A1 - 0.3);
				if (End - Start < 0.2)
					continue;
				float Line = CX0 + INSET;
				if (Side == ESide::N)
					Line = CZ0 + Tiles::CELL - INSET;
				else if (Side == ESide::S)
					Line = CZ0 + INSET;
				else if (Side == ESide::E)
					Line = CX0 + Tiles::CELL - INSET;
				const float L0 = Side == ESide::N || Side == ESide::E ? Line - WIDTH : Line;
				RailSpan(Paint, bAlongX, Start, End, L0, L0 + WIDTH, Base, Base + 0.003);
			}
		}
	}

	/** Where the slab over a cell is, from below: false if there's none (open air, or the roof). */
	bool SlabOver(int Storey, int Col, int Row, float& Bottom)
	{
		if (Storey >= Parsed.Levels - Parsed.Basements - 1)
			return false;
		const ETileKind Here = Parsed.Tile(Storey, Col, Row).Kind;
		if (Here == ETileKind::None || Here == ETileKind::Solid)
			return false;
		const ETileKind Above = Parsed.Tile(Storey + 1, Col, Row).Kind;
		if (Above != ETileKind::Floor && Above != ETileKind::Tv && Above != ETileKind::Ladder && Above != ETileKind::Stairs && Above != ETileKind::Solid)
			return false;
		Bottom = CeilingOf(Storey);
		return true;
	}

	/** `ceilings()`'s beams: shallow downstands along a room's long axis, on the edges between its cells. */
	void Beams(FRoom Room)
	{
		if (Room.Cells.Num() == 0)
			return;
		const FFinish Finish = FinishAt(Room.Storey, Room.Cells[0].Col, Room.Cells[0].Row);
		if (!Finish.bBeams || Finish.bTiled)
			return;
		const bool bAlongX = Room.Bounds.MaxX - Room.Bounds.MinX >= Room.Bounds.MaxZ - Room.Bounds.MinZ;
		TSet<int> Cells;
		for (const FColRow& Cell : Room.Cells)
			Cells.Add(CellKey(Cell.Col, Cell.Row));
		const FCoat Concrete = Building::Plain(n"concrete-wall");
		const float Width = 0.36;
		const float Depth = 0.12;
		for (const FColRow& Cell : Room.Cells)
		{
			const int NC = bAlongX ? Cell.Col : Cell.Col + 1;
			const int NR = bAlongX ? Cell.Row + 1 : Cell.Row;
			float Y = 0;
			float Next = 0;
			if (!Cells.Contains(CellKey(NC, NR)) || !SlabOver(Room.Storey, Cell.Col, Cell.Row, Y) || !SlabOver(Room.Storey, NC, NR, Next))
				continue;
			const float CX0 = X0 + Cell.Col * Tiles::CELL;
			const float CZ0 = Z0 + Cell.Row * Tiles::CELL;
			if (bAlongX)
				AddSkin(Concrete, CX0, CX0 + Tiles::CELL, Y - Depth, Y + 0.01, CZ0 + Tiles::CELL - Width / 2, CZ0 + Tiles::CELL + Width / 2);
			else
				AddSkin(Concrete, CX0 + Tiles::CELL - Width / 2, CX0 + Tiles::CELL + Width / 2, Y - Depth, Y + 0.01, CZ0, CZ0 + Tiles::CELL);
		}
	}

	/** A box between two corners in game meters, in any order. */
	void Block(FCoat Coat, FVector A, FVector B)
	{
		AddSkin(Coat, Math::Min(A.X, B.X), Math::Max(A.X, B.X), Math::Min(A.Y, B.Y), Math::Max(A.Y, B.Y), Math::Min(A.Z, B.Z), Math::Max(A.Z, B.Z));
	}

	/**
	 * A bar from P0 to P1 in game meters, `Width` thick across and `Depth` along `Up` (game axes), as
	 * the part builder's bar() with a rectangular section.
	 */
	void Bar(FCoat Coat, FVector P0, FVector P1, float Width, float Depth, FVector Up = FVector(0, 1, 0))
	{
		const FVector W0 = World::ToWorld(P0.X, P0.Y, P0.Z);
		const FVector W1 = World::ToWorld(P1.X, P1.Y, P1.Z);
		const FVector Along = W1 - W0;
		const float Length = Along.Size() / 100.0;
		if (Length < 0.0005)
			return;
		FVector Normal = World::ToWorld(Up.X, Up.Y, Up.Z).GetSafeNormal();
		if (Math::Abs(Along.GetSafeNormal().DotProduct(Normal)) > 0.99)
			Normal = Math::Abs(Along.GetSafeNormal().Z) > 0.9 ? FVector(1, 0, 0) : FVector(0, 0, 1);
		const FRotator Rotation = FRotator::MakeFromXZ(Along, Normal);
		AddPainted(MeshFor(Coat.Surface), Coat.Surface, Coat, FTransform(Rotation, (W0 + W1) / 2, FVector(Length, Width, Depth)));
	}

	// ---- Wear ----

	float SmoothStep(float A, float B, float X)
	{
		const float T = Math::Clamp((X - A) / (B - A), 0.0, 1.0);
		return T * T * (3 - 2 * T);
	}

	/** `dirtOf`: how dirty a room is overall, from its finish, how far in it is and its storey. */
	float DirtOf(FFinish Finish, int Storey, int Col, int Row)
	{
		const int Room = RoomOf(Storey, Col, Row);
		const float Depth = Room >= 0 ? Level.Rooms[Room].Depth : (Storey < 0 ? 0.8 : 0.3);
		return Finish.Dirt * (1 + 0.6 * Depth) + (Storey < 0 ? 0.25 : 0.0);
	}

	/** The wear of a wall facing a room from cell (Col, Row): the room's, and how dark the face's corners are. */
	FWear WallWear(int Storey, int Col, int Row, bool bAlongX, int Sign, float Face, float A0, float A1, float Y0, float Y1)
	{
		FWear Made;
		if (!InGrid(Col, Row))
			return Made;
		const FFinish Finish = FinishAt(Storey, Col, Row);
		Made.Kind = 1;
		Made.Base = Storey * Tiles::STOREY;
		Made.Ceiling = CeilingOf(Storey);
		Made.Dirt = DirtOf(Finish, Storey, Col, Row);
		Made.Flags = (Finish.bScuffs ? 1 : 0) + (Finish.bDamp || Storey < 0 ? 2 : 0);
		Made.Extra = Storey;
		// Corners as they are below doorways' heads, where doorways are open.
		const float Y = Y0 < Made.Base + Tiles::DOOR_HEIGHT ? Made.Base + 1.0 : (Y0 + Y1) / 2;
		const float Front = Face + Sign * 0.06;
		Made.A = CornerOf(bAlongX, Front, A0, 1, Y);
		Made.B = CornerOf(bAlongX, Front, A1, -1, Y);
		Made.C = SmoothStep(0.42, 0.8, Enclosed(bAlongX ? Front : Made.A, Y, bAlongX ? Made.A : Front, 0.45));
		Made.D = SmoothStep(0.42, 0.8, Enclosed(bAlongX ? Front : Made.B, Y, bAlongX ? Made.B : Front, 0.45));
		return Made;
	}

	/** Where a wall's face shows from: past a wall that crosses its end, going `Dir` along it from `From`. */
	float CornerOf(bool bAlongX, float Front, float From, int Dir, float Y)
	{
		float At = From;
		for (int Step = 0; Step < 20 && Inside(bAlongX ? Front : At, Y, bAlongX ? At : Front); Step++)
			At += Dir * 0.02;
		return At;
	}

	/** `enclosed`: the share of the square R round a point that's solid at height Y. */
	float Enclosed(float X, float Y, float Z, float R)
	{
		TSet<int> Seen;
		float Sum = 0;
		for (int Col = ColOf(X - R); Col <= ColOf(X + R); Col++)
		{
			for (int Row = RowOf(Z - R); Row <= RowOf(Z + R); Row++)
			{
				FIndices Near;
				if (!SolidsIn.Find(CellKey(Col, Row), Near))
					continue;
				for (int Index : Near.Items)
				{
					if (Seen.Contains(Index))
						continue;
					Seen.Add(Index);
					const FLevelBox& Box = Solids[Index];
					if (Y < Box.Y || Y > Box.Y + Box.Height)
						continue;
					const float W = Math::Min(Box.MaxX, X + R) - Math::Max(Box.MinX, X - R);
					const float D = Math::Min(Box.MaxZ, Z + R) - Math::Max(Box.MinZ, Z - R);
					if (W > 0 && D > 0)
						Sum += W * D;
				}
			}
		}
		return Math::Min(1.0, Sum / (4 * R * R));
	}

	/**
	 * The wear of a floor (Kind 2) or a ceiling (3) over a cell of a storey, from MinX to MaxX and MinZ
	 * to MaxZ: its room's, and where the walls round it are, found at height Y.
	 */
	FWear SurfaceWear(int Kind, int Storey, int Col, int Row, float MinX, float MaxX, float MinZ, float MaxZ, float Y)
	{
		FWear Made;
		const FFinish Finish = FinishAt(Storey, Col, Row);
		Made.Kind = Kind;
		Made.Base = Storey * Tiles::STOREY;
		Made.Ceiling = CeilingOf(Storey);
		Made.Dirt = DirtOf(Finish, Storey, Col, Row);
		Made.Flags = Finish.bDamp || Storey < 0 ? 2 : 0;
		Made.Extra = Kind == 2 ? Finish.Oil : 0.0;
		Made.A = WallFaceBy(true, MinX, 1, MinZ, MaxZ, Y);
		Made.B = WallFaceBy(true, MaxX, -1, MinZ, MaxZ, Y);
		Made.C = WallFaceBy(false, MinZ, 1, MinX, MaxX, Y);
		Made.D = WallFaceBy(false, MaxZ, -1, MinX, MaxX, Y);
		return Made;
	}

	/**
	 * Where the face of a wall along one side of a floor is: the side at `Edge` across x (`bX`) or z,
	 * the floor lying `Inward` from it, from Lo to Hi along it. Far off if there's no wall there.
	 */
	float WallFaceBy(bool bX, float Edge, int Inward, float Lo, float Hi, float Y)
	{
		for (int K = 0; K < 3; K++)
		{
			const float Along = Lo + (Hi - Lo) * (K == 0 ? 0.5 : (K == 1 ? 0.25 : 0.75));
			bool bFound = false;
			float Deepest = 0;
			for (float D = -0.3; D <= 0.61; D += 0.05)
			{
				if (Inside(bX ? Edge + Inward * D : Along, Y, bX ? Along : Edge + Inward * D))
				{
					bFound = true;
					Deepest = D;
				}
			}
			if (bFound)
				return Edge + Inward * (Deepest + 0.025);
		}
		return -Inward * 10000.0;
	}

	// ---- Drawing ----

	/**
	 * The instanced mesh for a surface: the engine's cube in the surface's material, painted per
	 * instance; or a model of models/level in it (`Model`), with the baked bumps at half strength, as
	 * the model has them in its geometry.
	 */
	UInstancedStaticMeshComponent MeshFor(FName Surface, FName Model = NAME_None)
	{
		const FName Key = Model == NAME_None ? Surface : FName(f"{Surface}/{Model}");
		UInstancedStaticMeshComponent Found;
		if (Meshes.Find(Key, Found))
			return Found;
		UInstancedStaticMeshComponent Made = UInstancedStaticMeshComponent::Create(this, Key);
		UStaticMesh Shape = Model == NAME_None ? Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube")) : Models::Mesh(f"level/{Model}");
		if (Shape == nullptr)
			Log(f"StoreRaid: model level/{Model} isn't imported: pnpm run ue import level/{Model}");
		Made.SetStaticMesh(Shape);
		Made.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Made.SetMobility(EComponentMobility::Static);
		Made.SetNumCustomDataFloats(15);
		const FString Name = Surface.ToString();
		UMaterialInterface Material = Cast<UMaterialInterface>(LoadObject(nullptr, f"/Game/Surfaces/{Name}/MI_{Name}.MI_{Name}"));
		if (Material != nullptr && Model != NAME_None)
		{
			UMaterialInstanceDynamic Softer = Material::CreateDynamicMaterialInstance(Material);
			Softer.SetScalarParameterValue(n"Bump", 0.5);
			Material = Softer;
		}
		if (Material != nullptr)
			Made.SetMaterial(0, Material);
		else
			Log(f"StoreRaid: surface {Name} isn't imported: pnpm run ue surfaces {Name}");
		Meshes.Add(Key, Made);
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
		// The wear, after the paint: see FWear.
		float Base = Wear.Base;
		if (Base < -999)
			Base = StoreyOf(Transform.Location.Z / 100.0) * Tiles::STOREY;
		TArray<float> Data;
		Data.Add(Paint.R);
		Data.Add(Paint.G);
		Data.Add(Paint.B);
		Data.Add(Wear.Kind);
		Data.Add(Base);
		Data.Add(Wear.Ceiling);
		Data.Add(Wear.Dirt);
		Data.Add(Wear.Flags);
		Data.Add(Wear.Extra);
		Data.Add(Wear.A);
		Data.Add(Wear.B);
		Data.Add(Wear.C);
		Data.Add(Wear.D);
		Data.Add(Seed);
		Data.Add(Wear.Tone);
		for (int K = 0; K < Data.Num(); K++)
			Mesh.SetCustomDataValue(Index, K, Data[K], false);
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
