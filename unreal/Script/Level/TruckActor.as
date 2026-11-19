// The crew's truck in the world, on every machine: its model, the hatch's model turning on its hinge,
// the ceiling lamp, and what players collide with, which the model doesn't give: the boxes and floors
// of FParkedTruck, invisible. The hatch is a ramp to walk on only once it's all the way down; until
// then a wall closes the back (terrainOf() in shared/truck.ts). The game state sets where it is.
//
// Every machine builds its own truck, so it isn't replicated, and what players stand on must be
// Static: a movable floor is a moving base to the character movement, whose corrections then name an
// actor the client can't resolve, and it ignores them. So the solids are instances added to static
// instanced meshes, as the level's blocks are, and only the drawn parts move.
class ATruck : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;
	default Root.Mobility = EComponentMobility::Static;

	/** The truck's model, drawn only. */
	UPROPERTY(DefaultComponent, Attach = Root)
	UStaticMeshComponent Body;
	default Body.Mobility = EComponentMobility::Movable;
	default Body.SetCollisionEnabled(ECollisionEnabled::NoCollision);

	/** The hinge, along the floor's back edge, and the hatch's model on it, lying out behind it. */
	UPROPERTY(DefaultComponent, Attach = Root)
	USceneComponent Hinge;
	default Hinge.Mobility = EComponentMobility::Movable;

	UPROPERTY(DefaultComponent, Attach = Hinge)
	UStaticMeshComponent Hatch;
	default Hatch.Mobility = EComponentMobility::Movable;
	default Hatch.SetCollisionEnabled(ECollisionEnabled::NoCollision);

	/** The boxes and floor, in level space, never drawn. */
	UPROPERTY(DefaultComponent, Attach = Root)
	UInstancedStaticMeshComponent Solid;
	default Solid.Mobility = EComponentMobility::Static;
	default Solid.bHiddenInGame = true;

	/** The ramp to walk on, and the wall across the back: one solid at a time, each an instance of its own. */
	UPROPERTY(DefaultComponent, Attach = Root)
	UInstancedStaticMeshComponent Ramp;
	default Ramp.Mobility = EComponentMobility::Static;
	default Ramp.bHiddenInGame = true;

	UPROPERTY(DefaultComponent, Attach = Root)
	UInstancedStaticMeshComponent Wall;
	default Wall.Mobility = EComponentMobility::Static;
	default Wall.bHiddenInGame = true;

	UPROPERTY(DefaultComponent, Attach = Root)
	UPointLightComponent Lamp;
	default Lamp.Mobility = EComponentMobility::Movable;

	FParkedTruck Parked;
	/** Where the hatch is drawn and solid, 0 up to 1 down. */
	float Shown = -1;
	/** The hatch's motor as it starts to move, and its latch as it comes to rest (Sound/Truck in truck.ts). */
	FOneShots Motor;
	FOneShots Latch;

	/** Set the truck up where it's parked. The actor stays at the origin; its parts are in level space. */
	void Build(FParkedTruck InParked)
	{
		Parked = InParked;
		UStaticMesh Cube = Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube"));

		const FTruckPlace Place = Parked.Place;
		const FRotator Facing(0, Place.Yaw(), 0);
		Body.SetWorldLocationAndRotation(World::ToWorld(Place.X, Place.Y, Place.Z), Facing);
		UStaticMesh Model = Models::Mesh("level/truck");
		if (Model != nullptr)
			Body.SetStaticMesh(Model);
		else
		{
			Log("StoreRaid: level/truck isn't imported: pnpm run ue import level/truck");
			Body.SetStaticMesh(Cube);
			Body.SetWorldScale3D(FVector(6.2, 2.5, 3.3));
			Body.AddWorldOffset(FVector(0, 0, 165));
		}

		const FVector HingeAt = Truck::PlacedPoint(Place, FVector(0, Truck::HINGE_Y, Truck::HINGE_Z));
		Hinge.SetWorldLocationAndRotation(World::ToWorld(HingeAt.X, HingeAt.Y, HingeAt.Z), Facing);
		UStaticMesh HatchModel = Models::Mesh("level/truck-hatch");
		if (HatchModel != nullptr)
			Hatch.SetStaticMesh(HatchModel);
		else
		{
			// A slab lying out behind the hinge, as the model does.
			Hatch.SetStaticMesh(Cube);
			Hatch.SetRelativeScale3D(FVector(Truck::HATCH_LENGTH, Truck::HATCH_HALF_WIDTH * 2, 0.08));
			Hatch.SetRelativeLocation(FVector(-Truck::HATCH_LENGTH * 50, 0, 0));
		}

		Solid.SetStaticMesh(Cube);
		Solid.SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Solid.SetCollisionProfileName(n"BlockAll");
		for (const FLevelBox& Box : Parked.Boxes)
			AddCube(Box.MinX, Box.MaxX, Box.Y, Box.Y + Box.Height, Box.MinZ, Box.MaxZ);
		for (const FFloor& Floor : Parked.Floors)
			AddCube(Floor.MinX, Floor.MaxX, Floor.Y - Floor.Thickness, Floor.Y, Floor.MinZ, Floor.MaxZ);

		Ramp.SetStaticMesh(Cube);
		Ramp.SetCollisionProfileName(n"BlockAll");
		Ramp.AddInstance(Shapes::RampTransform(Parked.Ramp), true);
		Wall.SetStaticMesh(Cube);
		Wall.SetCollisionProfileName(n"BlockAll");
		const FLevelBox Back = Parked.HatchWall;
		Wall.AddInstance(Shapes::BoxTransform(Back.MinX, Back.MaxX, Back.Y, Back.Y + Back.Height, Back.MinZ, Back.MaxZ), true);

		Lamp.SetWorldLocation(World::ToWorld(Parked.Lamp.X, Parked.Lamp.Y - 0.1, Parked.Lamp.Z));
		Lamp.SetIntensityUnits(ELightUnits::Lumens);
		Lamp.SetIntensity(1200);
		Lamp.SetAttenuationRadius(700);
		Lamp.SetLightColor(FLinearColor(1.0, 0.85, 0.65));
		Lamp.SetCastShadows(true);
		Lamp.SetVisibility(!System::IsDedicatedServer());

		Show(1);
	}

	/**
	 * The motor as the hatch leaves rest (up or down), slowed to sound deeper, and the latch as it
	 * comes to rest again, from the hinge. A jump from rest to rest, as a round puts it back, is silent.
	 */
	void HearHatch(float From, float To)
	{
		const bool bFromRest = From == 0 || From == 1;
		const bool bToRest = To == 0 || To == 1;
		if (From < 0 || bFromRest == bToRest || !Sounds::Heard())
			return;
		if (!Motor.bLoaded)
		{
			Motor.Load(Sounds::List("hatch-motor"));
			Latch.Load(Sounds::List("hatch-latch"));
		}
		if (bFromRest)
			Motor.PlayOn(Hinge, 0.7, 0.04, 0.45);
		else
			Latch.PlayOn(Hinge, 0.9, 0.1, 0.7);
	}

	void AddCube(float MinX, float MaxX, float MinY, float MaxY, float MinZ, float MaxZ)
	{
		Solid.AddInstance(Shapes::BoxTransform(MinX, MaxX, MinY, MaxY, MinZ, MaxZ), true);
	}

	/** The hatch at this point, 0 up (shut) to 1 down (the ramp): turned, and solid as it is. */
	void Show(float At)
	{
		if (At == Shown)
			return;
		HearHatch(Shown, At);
		Shown = At;
		// Eased at both ends, as a ram starts and stops. The model lies out behind the hinge (-X):
		// shut, that end is turned up; down, it's tipped below level onto the ground.
		const float Eased = At * At * (3 - 2 * At);
		const float Down = Math::RadiansToDegrees(Truck::HatchDown());
		Hinge.SetRelativeRotation(FRotator(-90 + (90 + Down) * Eased, Parked.Place.Yaw(), 0));
		const bool bDown = At >= 1;
		Ramp.SetCollisionEnabled(bDown ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
		Wall.SetCollisionEnabled(bDown ? ECollisionEnabled::NoCollision : ECollisionEnabled::QueryAndPhysics);
	}
}
