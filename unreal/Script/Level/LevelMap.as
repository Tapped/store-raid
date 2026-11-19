// Generated warehouses as text, to look at a layout and check its rules from the terminal without
// running the game: `pnpm run ue level <seed>` draws one, `pnpm run ue level --many <count>` checks
// every rule on seeds 1 to count. Both run these console commands in a headless editor; they work in
// any running process too (`pnpm run ue exec server sr.map 7`).

namespace LevelMap
{
	/** Each line starts with this, for the dev tools to pick out of the log. */
	const FString PREFIX = "StoreRaid map: ";

	/** One letter for a room kind, as the zone view draws it. */
	FString KindLetter(ERoomKind Kind)
	{
		switch (Kind)
		{
			case ERoomKind::Entrance: return "E";
			case ERoomKind::Hall: return "H";
			case ERoomKind::Cage: return "C";
			case ERoomKind::Workshop: return "W";
			case ERoomKind::Stock: return "S";
			case ERoomKind::Office: return "O";
			case ERoomKind::Staff: return "B";
			case ERoomKind::Plant: return "P";
			case ERoomKind::Corridor: return "K";
			case ERoomKind::Atrium: return "A";
			case ERoomKind::Reefer: return "R";
			case ERoomKind::Quarantine: return "Q";
			case ERoomKind::Guard: return "G";
			case ERoomKind::Rock: return "#";
		}
		return "?";
	}

	const FString LEGEND = "zones: E entrance, H hall, C cage, W workshop, S stock, O office, B staff (break room), P plant, K corridor, A atrium, R reefer, Q quarantine, G guard, # rock";

	/**
	 * Each storey, top first, as its tiles with their walls (as ParseTiles reads them) and beside that
	 * the same walls with each cell's room kind instead of its tile.
	 */
	TArray<FString> Draw(FGenerated Generated)
	{
		TArray<FString> Lines;
		FGenerateOptions Options = Generated.Options;
		for (int Index = Generated.Grid.Storeys.Num() - 1; Index >= 0; Index--)
		{
			int Storey = Index - Options.Basements;
			Lines.Add(f"storey {Storey}");
			TArray<FString> Drawn = Generated.Grid.Storeys[Index].Lines;
			for (int L = 0; L < Drawn.Num(); L++)
			{
				FString Tiles = Drawn[L];
				FString Zones = Tiles;
				// Lines alternate walls and cells, from the north; cells sit at odd characters.
				if (L % 2 == 1)
				{
					int Row = Options.Rows - 1 - Math::IntegerDivisionTrunc(L, 2);
					Zones = "";
					for (int I = 0; I < Tiles.Len(); I++)
					{
						FString Char = Tiles.Mid(I, 1);
						if (I % 2 == 1)
						{
							FCell Cell;
							Cell.Storey = Storey;
							Cell.Col = Math::IntegerDivisionTrunc(I - 1, 2);
							Cell.Row = Row;
							int Room = Generated.RoomAt(Cell);
							Char = Room >= 0 ? KindLetter(Generated.Rooms[Room].Kind) : Char == "#" ? "#" : " ";
						}
						Zones += Char;
					}
				}
				Lines.Add(Tiles + "    " + Zones);
			}
		}
		Lines.Add(LEGEND);
		return Lines;
	}
}

// sr.map <seed>: draws the generated warehouse from a seed, its storeys as tiles and as zones.
const FConsoleCommand MapCommand("sr.map", n"OnMapCommand");
void OnMapCommand(TArray<FString> Arguments)
{
	int Seed = Arguments.Num() > 0 ? String::Conv_StringToInt(Arguments[0]) : 1;
	FGenerated Generated = Generate::Generate(Warehouse::Size(Seed));
	if (!Generated.Problem.IsEmpty())
	{
		Log(LevelMap::PREFIX + f"seed {Seed}: no level, {Generated.Problem}");
		return;
	}
	Log(LevelMap::PREFIX + f"seed {Seed}, {Generated.Attempts} attempts");
	for (FString Line : LevelMap::Draw(Generated))
		Log(LevelMap::PREFIX + Line);
}

// sr.levelcheck <first> [last]: builds and furnishes the warehouses from those seeds and checks every
// rule on each (LevelCheck.as), a line per seed: `ok` and how long it took, or what's wrong. Script
// may only run for 10 s at a time, about five levels, so `pnpm run ue level --many` sends one a seed.
const FConsoleCommand LevelCheckCommand("sr.levelcheck", n"OnLevelCheckCommand");
void OnLevelCheckCommand(TArray<FString> Arguments)
{
	int First = Arguments.Num() > 0 ? String::Conv_StringToInt(Arguments[0]) : 1;
	int Last = Arguments.Num() > 1 ? String::Conv_StringToInt(Arguments[1]) : First;
	for (int Seed = First; Seed <= Last; Seed++)
	{
		FDateTime Clock = FDateTime::UtcNow();
		FWarehouse Level = Warehouse::Build(Seed);
		if (!Level.Problem.IsEmpty())
		{
			Log(LevelMap::PREFIX + f"seed {Seed} problem: no level, {Level.Problem}");
			continue;
		}
		TArray<FString> Problems = LevelCheck::Check(Level);
		for (FString Problem : Problems)
			Log(LevelMap::PREFIX + f"seed {Seed} problem: {Problem}");
		double Seconds = (FDateTime::UtcNow() - Clock).GetTotalSeconds();
		if (Problems.Num() == 0)
			Log(LevelMap::PREFIX + f"seed {Seed} ok {Seconds :.2} s");
	}
}
