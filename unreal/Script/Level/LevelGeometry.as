// A level's floors, boxes and ladders, put in the world: what shared/ composed and every machine
// builds the same from the same data. Floors and boxes are instances of the engine's cube on one
// instanced mesh, with collision, so the movement component walks on them and steps up them; ramps
// (stairs) are cubes pitched to the slope. Ladders become the movement component's ladder volumes.
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

	/** The ladders, in the movement component's terms, for every character to climb. */
	TArray<FStoreRaidLadder> Ladders;

	void Build(FComposedTiles Composed)
	{
		Blocks.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube")));
		Blocks.SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Blocks.SetCollisionProfileName(n"BlockAll");

		for (const FFloor& Floor : Composed.Floors)
			AddFloor(Floor);
		for (const FLevelBox& Box : Composed.Boxes)
			AddBlock(Box.MinX, Box.MaxX, Box.Y, Box.Y + Box.Height, Box.MinZ, Box.MaxZ);

		Ladders.Empty();
		for (const FLadder& Ladder : Composed.Ladders)
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

	/** A box from its extents in game meters. */
	void AddBlock(float MinX, float MaxX, float MinY, float MaxY, float MinZ, float MaxZ)
	{
		const FVector Centre = World::ToWorld((MinX + MaxX) / 2, (MinY + MaxY) / 2, (MinZ + MaxZ) / 2);
		// The engine's cube is 1 m on a side.
		const FVector Scale(MaxZ - MinZ, MaxX - MinX, MaxY - MinY);
		Blocks.AddInstance(FTransform(FRotator::ZeroRotator, Centre, Scale), true);
	}

	void AddFloor(FFloor Floor)
	{
		if (!Floor.bHasRise)
		{
			AddBlock(Floor.MinX, Floor.MaxX, Floor.Y - Floor.Thickness, Floor.Y, Floor.MinZ, Floor.MaxZ);
			return;
		}
		// A ramp: a slab whose top runs from Y at the low end to Y + RiseHeight at the side it rises towards.
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
		Blocks.AddInstance(FTransform(Rotation, Centre, FVector(Length, Width, Floor.Thickness)), true);
	}
}
