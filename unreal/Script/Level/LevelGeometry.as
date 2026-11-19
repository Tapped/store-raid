// A level's floors, boxes and ladders, put in the world: what shared/ composed and every machine
// builds the same from the same data. Floors and boxes are instances of the engine's cube on one
// instanced mesh, with collision, so the movement component walks on them and steps up them; ramps
// (stairs) are cubes pitched to the slope. In a building drawn by room (Building.as) they're hidden. Ladders become the movement component's ladder volumes.
//
// Game coordinates (meters, x east, y up, z north) become Unreal's (cm, X north, Y east, Z up) here
// and nowhere else: see World::ToWorld().

namespace World
{
	/** A point in game meters as an Unreal location. */
	FVector ToWorld(float X, float Y, float Z)
	{
		return FVector(Z * 100.0, X * 100.0, Y * 100.0);
	}

	/** An Unreal location as game meters on the ground plane: x east, z north. */
	FVector2D GameXZ(FVector Location)
	{
		return FVector2D(Location.Y / 100.0, Location.X / 100.0);
	}

	/** The way a side faces, in Unreal's axes. */
	FVector SideVector(ESide Side)
	{
		switch (Side)
		{
			case ESide::N:
				return FVector(1, 0, 0);
			case ESide::E:
				return FVector(0, 1, 0);
			case ESide::S:
				return FVector(-1, 0, 0);
			case ESide::W:
				return FVector(0, -1, 0);
		}
		return FVector(1, 0, 0);
	}
}

class ALevelGeometry : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	UInstancedStaticMeshComponent Blocks;
	default Blocks.Mobility = EComponentMobility::Static;

	/** Small things on the walls, like the dimmer's plate: drawn even when Blocks isn't. */
	UPROPERTY(DefaultComponent, Attach = Blocks)
	UInstancedStaticMeshComponent Fixtures;
	default Fixtures.Mobility = EComponentMobility::Static;

	/** Boxes that only collide, drawn by something else: the TVs' (Screens.as). */
	UPROPERTY(DefaultComponent, Attach = Blocks)
	UInstancedStaticMeshComponent Unseen;
	default Unseen.Mobility = EComponentMobility::Static;
	default Unseen.bHiddenInGame = true;

	/** The ladders, in the movement component's terms, for every character to climb. */
	TArray<FStoreRaidLadder> Ladders;

	void Build(FLevel Level)
	{
		Blocks.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube")));
		Blocks.SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Blocks.SetCollisionProfileName(n"BlockAll");
		Fixtures.SetStaticMesh(Blocks.StaticMesh);
		Fixtures.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Unseen.SetStaticMesh(Blocks.StaticMesh);
		Unseen.SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Unseen.SetCollisionProfileName(n"BlockAll");
		// A building drawn by room (ALevelBuilding) covers its boxes in skins, so they only collide.
		// The dedicated server draws nothing anyway.
		if (Level.Grid.Storeys.Num() > 0)
			Blocks.SetVisibility(false);

		for (const FFloor& Floor : Level.Floors)
			AddFloor(Floor);
		for (const FLevelBox& Box : Level.Boxes)
		{
			if (IsScreen(Level, Box))
				Unseen.AddInstance(Shapes::BoxTransform(Box.MinX, Box.MaxX, Box.Y, Box.Y + Box.Height, Box.MinZ, Box.MaxZ), true);
			else
				AddBlock(Box.MinX, Box.MaxX, Box.Y, Box.Y + Box.Height, Box.MinZ, Box.MaxZ);
		}
		// The roof over a building, which nobody reaches: a slab on its walls.
		if (Level.Roof > 0)
		{
			const FBoxXZ Roof = Level.Footprint;
			AddBlock(Roof.MinX - Tiles::WALL, Roof.MaxX + Tiles::WALL, Level.Roof, Level.Roof + Tiles::SLAB, Roof.MinZ - Tiles::WALL, Roof.MaxZ + Tiles::WALL);
		}

		Ladders.Empty();
		for (const FLadder& Ladder : Level.Ladders)
		{
			FStoreRaidLadder Volume;
			Volume.Min = World::ToWorld(Ladder.MinX, Ladder.Y, Ladder.MinZ);
			Volume.Max = World::ToWorld(Ladder.MaxX, Ladder.Top, Ladder.MaxZ);
			Volume.Toward = World::SideVector(Ladder.Toward);
			// LADDER_WALL + PLAYER_RADIUS: a climber's middle stays this far out from the wall.
			Volume.Gap = (Tiles::LADDER_WALL + 0.3) * 100.0;
			Ladders.Add(Volume);
		}
	}

	/** Whether a box is a TV's, standing where one of the level's screens does: Screens.as draws those. */
	bool IsScreen(FLevel Level, FLevelBox Box) const
	{
		if (Box.Kind != ELevelBoxKind::Furniture)
			return false;
		for (const FScreen& Screen : Level.Screens)
		{
			const FBoxXZ Foot = Tiles::ScreenFootprint(Screen);
			if (Math::Abs(Box.Y - Screen.Y) < 0.01 && Math::Abs(Box.MinX - Foot.MinX) < 0.01 && Math::Abs(Box.MaxX - Foot.MaxX) < 0.01
				&& Math::Abs(Box.MinZ - Foot.MinZ) < 0.01 && Math::Abs(Box.MaxZ - Foot.MaxZ) < 0.01)
				return true;
		}
		return false;
	}

	/** A box that blocks and is always drawn, from its extents in game meters. */
	void AddFixture(float MinX, float MaxX, float MinY, float MaxY, float MinZ, float MaxZ)
	{
		AddBlock(MinX, MaxX, MinY, MaxY, MinZ, MaxZ);
		Fixtures.AddInstance(Shapes::BoxTransform(MinX, MaxX, MinY, MaxY, MinZ, MaxZ), true);
	}

	/** A box from its extents in game meters. */
	void AddBlock(float MinX, float MaxX, float MinY, float MaxY, float MinZ, float MaxZ)
	{
		Blocks.AddInstance(Shapes::BoxTransform(MinX, MaxX, MinY, MaxY, MinZ, MaxZ), true);
	}

	void AddFloor(FFloor Floor)
	{
		if (!Floor.bHasRise)
			AddBlock(Floor.MinX, Floor.MaxX, Floor.Y - Floor.Thickness, Floor.Y, Floor.MinZ, Floor.MaxZ);
		else
			Blocks.AddInstance(Shapes::RampTransform(Floor), true);
	}
}

namespace Shapes
{
	/** The engine's cube (1 m on a side) as a box from its extents in game meters. */
	FTransform BoxTransform(float MinX, float MaxX, float MinY, float MaxY, float MinZ, float MaxZ)
	{
		const FVector Centre = World::ToWorld((MinX + MaxX) / 2, (MinY + MaxY) / 2, (MinZ + MaxZ) / 2);
		return FTransform(FRotator::ZeroRotator, Centre, FVector(MaxZ - MinZ, MaxX - MinX, MaxY - MinY));
	}

	/** The engine's cube as a ramp: a slab whose top runs from Y at the low end to Y + RiseHeight at the side it rises towards. */
	FTransform RampTransform(FFloor Floor)
	{
		const bool bAlongZ = Floor.RiseToward == ESide::N || Floor.RiseToward == ESide::S;
		const float Across = bAlongZ ? Floor.MaxZ - Floor.MinZ : Floor.MaxX - Floor.MinX;
		const float Width = bAlongZ ? Floor.MaxX - Floor.MinX : Floor.MaxZ - Floor.MinZ;
		const float Slope = Math::Atan2(Floor.RiseHeight, Across);
		const float Length = Math::Sqrt(Across * Across + Floor.RiseHeight * Floor.RiseHeight);

		// The middle of the top surface, then down half the thickness along the slab's normal.
		const FVector Toward = World::SideVector(Floor.RiseToward);
		const FRotator Rotation(Math::RadiansToDegrees(Slope), Toward.ToOrientationRotator().Yaw, 0);
		const FVector TopMiddle = World::ToWorld((Floor.MinX + Floor.MaxX) / 2, Floor.Y + Floor.RiseHeight / 2, (Floor.MinZ + Floor.MaxZ) / 2);
		const FVector Centre = TopMiddle - Rotation.UpVector * Floor.Thickness * 50.0;
		return FTransform(Rotation, Centre, FVector(Length, Width, Floor.Thickness));
	}
}
