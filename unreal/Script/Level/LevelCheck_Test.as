// Unit tests for the level check's port (LevelCheck.as): generated levels keep every rule, as they
// do in the web game (`pnpm exec tsx scripts/generate.ts --many 200`), and a level spoiled on purpose
// is caught.

void Test_GeneratedLevelsKeepTheRules(FUnitTest& T)
{
	for (int Seed = 1; Seed <= 3; Seed++)
	{
		FWarehouse Level = Warehouse::Build(Seed);
		T.AssertTrue(Level.Problem.IsEmpty(), f"seed {Seed} makes a level: {Level.Problem}");
		TArray<FString> Problems = LevelCheck::Check(Level);
		for (FString Problem : Problems)
			Log(f"level check, seed {Seed}: {Problem}");
		T.AssertEquals(0, Problems.Num(), f"problems with seed {Seed}");
	}
}

void Test_LevelCheckCatchesProblems(FUnitTest& T)
{
	FWarehouse Level = Warehouse::Build(1);
	// A crate on the dock, and a tube light with no tube.
	Level.Boxes.Add(Level::MakeLevelBox(Level.Dock, 0, 1, ELevelBoxKind::Furniture));
	FLightSpawn Light;
	Light.Kind = ELightKind::Tube;
	Light.X = Level.Dock.CentreX();
	Light.Y = 2.9;
	Light.Z = Level.Dock.CentreZ();
	Level.Lights.Add(Light);
	TArray<FString> Problems = LevelCheck::Check(Level);
	FString All;
	for (FString Problem : Problems)
	{
		Log(f"level check, spoiled: {Problem}");
		All += Problem + "\n";
	}
	T.AssertTrue(All.Contains("stands on the dock"), "a prop on the dock is caught");
	T.AssertTrue(All.Contains("light at") && All.Contains("has no fitting"), "a light with no fitting is caught");
}
