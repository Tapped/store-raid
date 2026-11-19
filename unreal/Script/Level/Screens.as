// The TVs of `tv` tiles (FScreen, from ComposeTiles): client/src/screens.ts. The TV item's model on a
// low cabinet, its screen showing static (M_Static, made by `pnpm run ue surfaces`) and droning a
// glitchy, screechy loop that's heard a few rooms away. Drawn on every machine but the server; the
// level's boxes already stop players at them.

namespace Screens
{
	/** Each TV's static (Sound/TVs), full volume within 2 m, then half as loud each time the distance doubles, to 30. */
	const float DRONE = 0.2;
	FFalloff Reach()
	{
		return Sounds::MakeFalloff(2, 30, 1);
	}

	/** The TV item's size (Items::Kind(Tv)), and its model's screen: a little smaller, a little above the middle (scripts/models/tv.py). */
	const float TV_WIDTH = 1.2;
	const float TV_HEIGHT = 0.75;
	const float TV_DEPTH = 0.15;
	const float SCREEN_WIDTH = 1.176;
	const float SCREEN_HEIGHT = 0.708;
	const float SCREEN_UP = 0.009;
	/** The cabinet's colour, a dark wood. */
	const FLinearColor CABINET = FLinearColor(0.2, 0.13, 0.08);

	/** The way a TV facing a side looks, in degrees (0 north, 90 east), as models are turned. */
	float Yaw(ESide Faces)
	{
		switch (Faces)
		{
			case ESide::N:
				return 0;
			case ESide::E:
				return 90;
			case ESide::S:
				return 180;
			case ESide::W:
				return 270;
		}
		return 0;
	}
}

class ALevelScreens : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;

	void Build(TArray<FScreen> All)
	{
		UStaticMesh Cube = Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube"));
		UMaterialInterface Plain = Cast<UMaterialInterface>(LoadObject(nullptr, "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
		UMaterialInterface Static = Cast<UMaterialInterface>(LoadObject(nullptr, "/Game/Surfaces/M_Static.M_Static"));
		if (Static == nullptr)
			Warning("StoreRaid: no M_Static for the TVs' screens: run pnpm run ue surfaces");
		UStaticMesh Tv = Models::Mesh("props/tv");
		const float Middle = Tiles::SCREEN_CABINET_HEIGHT + Screens::TV_HEIGHT / 2;
		for (int I = 0; I < All.Num(); I++)
		{
			const FScreen Screen = All[I];
			const FVector Base = World::ToWorld(Screen.X, Screen.Y, Screen.Z);
			const FRotator Facing(0, Screens::Yaw(Screen.Faces), 0);
			const FVector Ahead = Facing.ForwardVector;

			UStaticMeshComponent Cabinet = Part(Cube, Base + FVector(0, 0, Tiles::SCREEN_CABINET_HEIGHT * 50), Facing,
				FVector(Tiles::SCREEN_CABINET_DEPTH, Tiles::SCREEN_CABINET_WIDTH, Tiles::SCREEN_CABINET_HEIGHT));
			Paint(Cabinet, Plain, Screens::CABINET);

			const FVector Set = Base + FVector(0, 0, Middle * 100);
			if (Tv != nullptr)
				Part(Tv, Set, Facing, FVector(1, 1, 1));
			else
				Paint(Part(Cube, Set, Facing, FVector(Screens::TV_DEPTH, Screens::TV_WIDTH, Screens::TV_HEIGHT)), Plain, FLinearColor(0.03, 0.03, 0.035));

			// A sheet just in front of the TV's screen, unlit, so it shows in the dark.
			UStaticMeshComponent Face = Part(Cube, Set + Ahead * (Screens::TV_DEPTH / 2 + 0.002) * 100 + FVector(0, 0, Screens::SCREEN_UP * 100), Facing,
				FVector(0.002, Screens::SCREEN_WIDTH, Screens::SCREEN_HEIGHT));
			Face.SetCastShadow(false);
			if (Static != nullptr)
				Face.SetMaterial(0, Static);

			// From just in front of the screen, outside the TV's box, which would muffle it from
			// everywhere; each TV somewhere else in the loop, so two of them don't sound like one.
			const FVector Drone = Set + Ahead * (Tiles::SCREEN_CABINET_DEPTH / 2 + 0.1) * 100;
			Sounds::Loop("tv-static", Screens::DRONE, I * 0.37, true, Drone, Screens::Reach());
		}
		Log(f"StoreRaid: {All.Num()} TVs");
	}

	/** A mesh drawn here, with no collision, at a place, turned, scaled. */
	UStaticMeshComponent Part(UStaticMesh Mesh, FVector At, FRotator Facing, FVector Scale)
	{
		UStaticMeshComponent Made = UStaticMeshComponent::Create(this);
		Made.SetStaticMesh(Mesh);
		Made.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Made.SetWorldLocationAndRotation(At, Facing);
		Made.SetWorldScale3D(Scale);
		return Made;
	}

	void Paint(UStaticMeshComponent Mesh, UMaterialInterface Plain, FLinearColor Colour)
	{
		UMaterialInstanceDynamic Material = Mesh.CreateDynamicMaterialInstance(0, Plain);
		if (Material != nullptr)
			Material.SetVectorParameterValue(n"Color", Colour);
	}
}
