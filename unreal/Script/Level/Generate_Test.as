// Unit tests for the generator (Generate.as): every seed in unreal/Tools/fixtures/generated.txt must
// come out of Generate::Generate as it did when the fixture was written: the same tries, entrance,
// storeys as drawn, rooms, distances and floors, so a change to the generator changes no level by
// accident. The fixture began as the web game's levels, which the port matched. What the port makes
// is written to Saved/generated.txt, to diff; after changing the generator on purpose,
// `pnpm run ue fixtures` makes that the fixture.

namespace GenerateTest
{
	/** The size of generated levels: GENERATED_SIZE in shared/level.ts. */
	FGenerateOptions Sized(int Seed)
	{
		FGenerateOptions Options;
		Options.Seed = Seed;
		Options.Cols = 14;
		Options.Rows = 12;
		Options.Storeys = 4;
		Options.Basements = 1;
		return Options;
	}

	/** A generated level as the fixture has it, line by line. */
	TArray<FString> Dump(FGenerated Generated)
	{
		TArray<FString> Lines;
		FGenerateOptions Options = Generated.Options;
		Lines.Add(f"seed {Options.Seed} attempts {Generated.Attempts}");
		Lines.Add(f"entrance {Generated.Entrance.Storey} {Generated.Entrance.Col} {Generated.Entrance.Row}");
		for (int Index = 0; Index < Generated.Grid.Storeys.Num(); Index++)
		{
			Lines.Add(f"storey {Index - Options.Basements}");
			for (FString Line : Generated.Grid.Storeys[Index].Lines)
				Lines.Add(Line);
		}
		for (int Id = 0; Id < Generated.Rooms.Num(); Id++)
		{
			FGeneratedRoom Room = Generated.Rooms[Id];
			FString Line = f"room {Id} {Generate::RoomKindName(Room.Kind)} {Room.Storey}";
			for (FColRow Cell : Room.Cells)
				Line += f" {Cell.Col},{Cell.Row}";
			Lines.Add(Line);
		}
		for (int Storey = -Options.Basements; Storey < Options.Storeys - Options.Basements; Storey++)
		{
			for (int Row = Options.Rows - 1; Row >= 0; Row--)
			{
				FString Line = f"distance {Storey} {Row}";
				for (int Col = 0; Col < Options.Cols; Col++)
				{
					FCell Cell;
					Cell.Storey = Storey;
					Cell.Col = Col;
					Cell.Row = Row;
					int Distance = Generated.Distance(Cell);
					FString Far = Distance < 0 ? "." : f"{Distance}";
					Line += f" {Far}/{Generated.RoomAt(Cell)}";
				}
				Lines.Add(Line);
			}
		}
		FString Floors = "floors";
		for (FCell Cell : Generated.Floors)
			Floors += f" {Cell.Storey},{Cell.Col},{Cell.Row}";
		Lines.Add(Floors);
		return Lines;
	}
}

void Test_GeneratedAsTheFixture(FUnitTest& T)
{
	FString Path = FPaths::ProjectDir() + "Tools/fixtures/generated.txt";
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, Path))
	{
		T.AssertTrue(false, "no fixture at " + Path + ": run pnpm run ue fixtures");
		return;
	}
	TArray<FString> Expected;
	Text.ParseIntoArray(Expected, "\n", false);
	// The trailing newline leaves an empty last line.
	while (Expected.Num() > 0 && Expected.Last().IsEmpty())
		Expected.RemoveAt(Expected.Num() - 1);

	FString Written;
	int Line = 0;
	int Seeds = 0;
	int Failed = 0;
	while (Line < Expected.Num())
	{
		FString Header = Expected[Line];
		if (!Header.StartsWith("seed "))
		{
			T.AssertTrue(false, f"line {Line + 1} of the fixture should start a seed: {Header}");
			return;
		}
		FString Rest = Header.RightChop(5);
		FString SeedText;
		FString After;
		Rest.Split(" ", SeedText, After);
		int Seed = String::Conv_StringToInt(SeedText);
		// This seed's lines run to the next "seed" line.
		int End = Line + 1;
		while (End < Expected.Num() && !Expected[End].StartsWith("seed "))
			End++;

		FGenerated Generated = Generate::Generate(GenerateTest::Sized(Seed));
		Seeds++;
		if (!Generated.Problem.IsEmpty())
		{
			T.AssertTrue(false, f"seed {Seed}: " + Generated.Problem);
			Failed++;
			Line = End;
			continue;
		}
		TArray<FString> Got = GenerateTest::Dump(Generated);
		for (FString Each : Got)
			Written += Each + "\n";
		int Count = End - Line;
		bool bSame = Got.Num() == Count;
		for (int I = 0; I < Math::Min(Count, Got.Num()); I++)
		{
			if (Got[I] != Expected[Line + I])
			{
				T.AssertTrue(false, f"seed {Seed}, line {I + 1}: expected\n  {Expected[Line + I]}\ngot\n  {Got[I]}");
				bSame = false;
				break;
			}
		}
		if (!bSame)
		{
			if (Got.Num() != Count)
				T.AssertTrue(false, f"seed {Seed}: {Got.Num()} lines, expected {Count}");
			Failed++;
		}
		Line = End;
	}
	FFileHelper::SaveStringToFile(Written, FPaths::ProjectSavedDir() + "generated.txt");
	T.AssertTrue(Seeds > 0, "the fixture has seeds");
	T.AssertEquals(0, Failed, f"seeds unlike the fixture, of {Seeds}");
	Log(f"generated {Seeds} seeds, {Failed} unlike the fixture");
}

void Test_RandomLikeTheWebGame(FUnitTest& T)
{
	// random(1) and random(123456) in shared/generate.ts.
	FRandom One;
	One.State = 1;
	T.AssertAlmostEquals(0.627073940588, One.Next(), 0.000000000001, "random(1) first");
	T.AssertAlmostEquals(0.002735721180, One.Next(), 0.000000000001, "random(1) second");
	T.AssertAlmostEquals(0.527447039960, One.Next(), 0.000000000001, "random(1) third");
	T.AssertAlmostEquals(0.981050967472, One.Next(), 0.000000000001, "random(1) fourth");
	FRandom Other;
	Other.State = 123456;
	T.AssertAlmostEquals(0.382333043497, Other.Next(), 0.000000000001, "random(123456) first");
	T.AssertAlmostEquals(0.797262907494, Other.Next(), 0.000000000001, "random(123456) second");
}

