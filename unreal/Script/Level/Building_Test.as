// Unit tests for the building's port (Building.as): its seed, hash and liveries are the web game's,
// number for number (client/src/parts.ts and building.ts).

void Test_BuildingLiveryMatchesTheWebGame(FUnitTest& T)
{
	// seedOf() reads only the digits a name ends in: no sign.
	T.AssertEquals(1, Building::SeedOf("generated-1"), "generated-1's seed");
	T.AssertEquals(42, Building::SeedOf("generated-42"), "generated-42's seed");
	// hash3(1, 1, 7.3) in parts.ts.
	T.AssertTrue(Math::Abs(Building::Hash3(1, 1, 7.3) - 0.2690074238926172) < 1e-9, "hash3(1, 1, 7.3)");
	// Seed 1's accent is the green, as the web game paints generated-1.
	FLinearColor Accent = Building::LiveryOf(Building::SeedOf("generated-1")).Accent;
	T.AssertTrue(Math::Abs(Accent.R - 0.2) < 1e-6 && Math::Abs(Accent.G - 0.34) < 1e-6, "generated-1's accent");
}
