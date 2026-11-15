// The playground's grid of tiles: mirrors PLAYGROUND_GRID and the hall's measures in
// shared/level.ts. Game coordinates: meters, x east, y up, z north.
//
// The playground: one brick hall under a roof on steel beams, to try things out in, built from tiles
// (Tiles.as) inside four walls. Items wait in a row along the west wall, with a dock to deliver to in
// the north-west corner; a pit with a plank across fills the east side; stairs and a ladder go up to
// a mezzanine along the north wall, and stairs on to a platform above that; stairs and a ladder go
// down to a basement under the middle, where a TV shows static.
//
// Still to come with the `Level` type: the hall's four outer walls, its items, dimmer, dock,
// entrance, spawn points and killY.

namespace Playground
{
	/** Half the hall's width (x) and length (z), inside the walls, and how high its roof is. */
	const float HALL_X = 16.0;
	const float HALL_Z = 12.0;
	const float HALL_HEIGHT = 9.0;

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
