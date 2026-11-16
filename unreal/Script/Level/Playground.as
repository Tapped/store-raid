// The playground's grid of tiles: mirrors PLAYGROUND_GRID and the hall's measures in
// shared/level.ts. Game coordinates: meters, x east, y up, z north.
//
// The playground: one brick hall under a roof on steel beams, to try things out in, built from tiles
// (Tiles.as) inside four walls. Items wait in a row along the west wall, with a dock to deliver to in
// the north-west corner; a pit with a plank across fills the east side; stairs and a ladder go up to
// a mezzanine along the north wall, and stairs on to a platform above that; stairs and a ladder go
// down to a basement under the middle, where a TV shows static.
//
// Unlike the web game's, the port's playground has the crew's truck, as the harbour has: parked in
// the south-east corner against the south wall, the cab to the east and the ramp towards the hall,
// with a way past its side to the plank across the pit, so the round, the hatch and the seats can be
// tried before the harbour is ported. Its cargo space is the dock. With
// `-mode=game` (or `sr.mode game` on the server) the playground runs rounds, as `?mode=game` did.
//
// Still to come with the `Level` type: its entrance.

namespace Playground
{
	/** Half the hall's width (x) and length (z), inside the walls, and how high its roof is. */
	const float HALL_X = 16.0;
	const float HALL_Z = 12.0;
	const float HALL_HEIGHT = 9.0;
	/** WALL in shared/level.ts: how thick the hall's walls are. */
	const float WALL = 0.5;
	/** A storey below the basement (-STOREY - 4): in the pit, and nowhere else. Falling below it respawns. */
	const float KILL_Y = -7.0;

	/** Where the truck stands: south of the pit, along the south wall, its cab to the east. */
	FTruckPlace TruckPlace()
	{
		FTruckPlace Place;
		Place.X = 10.5;
		Place.Z = -10.6;
		Place.Turns = 1;
		return Place;
	}

	/** The dimmer for the lights, on the south wall behind where players start, facing north. */
	const FVector DIMMER = FVector(-6, 1.3, -12);

	/** The items, waiting in a row along the west wall, and a box up on the mezzanine to carry down. */
	TArray<FItemSpawn> Items()
	{
		TArray<FItemSpawn> Result;
		Result.Add(Level::MakeItemSpawn(EItemKind::Phone, -14, 0.1, -9));
		Result.Add(Level::MakeItemSpawn(EItemKind::Phone, -14, 0.1, -8));
		Result.Add(Level::MakeItemSpawn(EItemKind::Flashlight, -14, 0.05, -10));
		Result.Add(Level::MakeItemSpawn(EItemKind::Flashlight, -13.4, 0.05, -10));
		Result.Add(Level::MakeItemSpawn(EItemKind::Box, -14, 0.6, -6));
		Result.Add(Level::MakeItemSpawn(EItemKind::Tv, -14, 0.5, -3));
		Result.Add(Level::MakeItemSpawn(EItemKind::Sofa, -13.5, 0.5, 1));
		Result.Add(Level::MakeItemSpawn(EItemKind::Box, -6, 3 + 0.6, 6));
		return Result;
	}

	/** Where the index'th player comes in: in the middle of the south side, facing north. */
	FVector2D SpawnPoint(int Index)
	{
		return FVector2D(-3 + (Index % 4) * 2, -10.5 + Math::IntegerDivisionTrunc(Index, 4) % 2);
	}

	/** A storey of a grid from its lines, northern row first. */
	FTileStorey Storey(TArray<FString> Lines)
	{
		FTileStorey Result;
		Result.Lines = Lines;
		return Result;
	}

	/**
	 * Eight cells across and six deep, on a basement, the ground and two storeys above. Each storey's
	 * northern row comes first; the basement is dug out of rock, and open under the pit.
	 * PLAYGROUND_GRID in the TS.
	 */
	FTileGrid Grid()
	{
		FTileGrid Result;
		Result.X = -HALL_X;
		Result.Z = -HALL_Z;
		Result.Basements = 1;

		TArray<FString> Basement;
		Basement.Add("########");
		Basement.Add("#####...");
		Basement.Add("#####...");
		Basement.Add("#F^F#...");
		Basement.Add("#TFFe###");
		Basement.Add("########");
		Result.Storeys.Add(Storey(Basement));

		TArray<FString> Ground;
		Ground.Add("FFFFFFFF");
		Ground.Add("FFFFFP|P");
		Ground.Add("FFF^nP|P");
		Ground.Add("FF.FFP|P");
		Ground.Add("FFFF.FFF");
		Ground.Add("FFFFFFFF");
		Result.Storeys.Add(Storey(Ground));

		TArray<FString> Mezzanine;
		Mezzanine.Add(".F<FF...");
		Mezzanine.Add(".FFFF...");
		Result.Storeys.Add(Storey(Mezzanine));

		TArray<FString> Platform;
		Platform.Add("FF......");
		Result.Storeys.Add(Storey(Platform));

		return Result;
	}
}
