// Unit tests for furnishing (Reach.as, Furnish.as, Warehouse.as): every seed in
// unreal/Tools/fixtures/furnished.txt must come out of Warehouse::Build as it did when the fixture
// was written: the same rooms, props, props' boxes, lights and items, in order, to the micrometre
// (within 2, which the fixture needed when it was the web game's, from V8's sines and arctangents).
// What the port makes is written to Saved/furnished.txt, to diff; after changing the generator,
// furnishing or the props on purpose, `pnpm run ue fixtures` makes that the fixture.

namespace FurnishTest
{
	/** A length in whole micrometres, as the fixture has it. */
	FString Um(float Value)
	{
		return f"{Math::RoundToInt(Value * 1000000.0)}";
	}

	FString BoxKindName(ELevelBoxKind Kind)
	{
		if (Kind == ELevelBoxKind::Mesh)
			return "mesh";
		if (Kind == ELevelBoxKind::Shelf)
			return "shelf";
		return "furniture";
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

	FString LightStateName(ELightState State)
	{
		switch (State)
		{
			case ELightState::On: return "on";
			case ELightState::Flicker: return "flicker";
			case ELightState::Dead: return "dead";
		}
		return "";
	}

	/** A furnished level as the fixture has it, line by line. */
	TArray<FString> Dump(int Seed, FWarehouse Level)
	{
		TArray<FString> Lines;
		Lines.Add(f"seed {Seed} tiles {Level.Tiles.Boxes.Num()} dropped {Level.Dropped}");
		for (FRoom Room : Level.Rooms)
		{
			FBoxXZ B = Room.Bounds;
			Lines.Add(f"room {Room.Id} {Generate::RoomKindName(Room.Kind)} {Room.Storey} {Um(Room.Y)} {Um(B.MinX)} {Um(B.MaxX)} {Um(B.MinZ)} {Um(B.MaxZ)} {Um(Room.Depth)} {Room.Cells.Num()}");
		}
		for (FPropSpawn Prop : Level.Props)
			Lines.Add(f"prop {Props::Name(Prop.Model)} {Um(Prop.X)} {Um(Prop.Y)} {Um(Prop.Z)} {Um(Prop.Turn)} {Prop.Room}");
		for (int I = Level.Tiles.Boxes.Num(); I < Level.Boxes.Num(); I++)
		{
			FLevelBox Box = Level.Boxes[I];
			Lines.Add(f"box {BoxKindName(Box.Kind)} {Um(Box.MinX)} {Um(Box.MaxX)} {Um(Box.MinZ)} {Um(Box.MaxZ)} {Um(Box.Y)} {Um(Box.Height)}");
		}
		for (FLightSpawn Light : Level.Lights)
			Lines.Add(f"light {LightKindName(Light.Kind)} {Um(Light.X)} {Um(Light.Y)} {Um(Light.Z)} {Um(Light.Turn)} {Um(Light.R)} {Um(Light.G)} {Um(Light.B)} {Um(Light.Power)} {LightStateName(Light.State)} {Light.Room}");
		for (FItemSpawn Item : Level.Items)
			Lines.Add(f"item {Items::KindName(Item.Kind)} {Um(Item.X)} {Um(Item.Y)} {Um(Item.Z)}");
		return Lines;
	}

	/** Whether two lines say the same, numbers within 2 of each other. */
	bool Same(FString Expected, FString Got)
	{
		if (Expected == Got)
			return true;
		TArray<FString> A;
		TArray<FString> B;
		Expected.ParseIntoArray(A, " ", true);
		Got.ParseIntoArray(B, " ", true);
		if (A.Num() != B.Num())
			return false;
		for (int I = 0; I < A.Num(); I++)
		{
			if (A[I].Compare(B[I], ESearchCase::CaseSensitive) == 0)
				continue;
			if (!A[I].IsNumeric() || !B[I].IsNumeric())
				return false;
			if (Math::Abs(String::Conv_StringToInt(A[I]) - String::Conv_StringToInt(B[I])) > 2)
				return false;
		}
		return true;
	}
}

void Test_FurnishedAsTheFixture(FUnitTest& T)
{
	FString Path = FPaths::ProjectDir() + "Tools/fixtures/furnished.txt";
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, Path))
	{
		T.AssertTrue(false, "no fixture at " + Path + ": run pnpm run ue fixtures");
		return;
	}
	TArray<FString> Expected;
	Text.ParseIntoArray(Expected, "\n", true);

	FString Written;
	int Line = 0;
	int Seeds = 0;
	int Failed = 0;
	while (Line < Expected.Num())
	{
		FString Header = Expected[Line];
		TArray<FString> Words;
		Header.ParseIntoArray(Words, " ", true);
		if (Words.Num() < 2 || Words[0] != "seed")
		{
			T.AssertTrue(false, f"line {Line + 1} of the fixture should start a seed: {Header}");
			return;
		}
		int Seed = String::Conv_StringToInt(Words[1]);
		int End = Line + 1;
		while (End < Expected.Num() && !Expected[End].StartsWith("seed "))
			End++;

		float Began = System::GetGameTimeInSeconds();
		FWarehouse Level = Warehouse::Build(Seed);
		Seeds++;
		if (!Level.Problem.IsEmpty())
		{
			T.AssertTrue(false, f"seed {Seed}: " + Level.Problem);
			Written += f"seed {Seed}: {Level.Problem}\n";
			Failed++;
			Line = End;
			continue;
		}
		TArray<FString> Got = FurnishTest::Dump(Seed, Level);
		for (FString Each : Got)
			Written += Each + "\n";
		int Count = End - Line;
		bool bSame = Got.Num() == Count;
		for (int I = 0; I < Math::Min(Count, Got.Num()); I++)
		{
			if (!FurnishTest::Same(Expected[Line + I], Got[I]))
			{
				Log(f"furnished seed {Seed}, line {I + 1}: expected {Expected[Line + I]} got {Got[I]}");
				bSame = false;
				break;
			}
		}
		if (!bSame)
		{
			Log(f"furnished seed {Seed}: {Got.Num()} lines, expected {Count}");
			Failed++;
		}
		Line = End;
	}
	FFileHelper::SaveStringToFile(Written, FPaths::ProjectSavedDir() + "furnished.txt");
	T.AssertTrue(Seeds > 0, "the fixture has seeds");
	T.AssertEquals(0, Failed, f"seeds unlike the fixture, of {Seeds}");
	Log(f"furnished {Seeds} seeds, {Failed} unlike the fixture");
}
