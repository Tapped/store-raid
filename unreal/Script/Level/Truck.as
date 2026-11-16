// The crew's truck: mirrors shared/truck.ts. A box truck with benches along the walls of its cargo
// space. Its back is a hatch hinged at the floor: up, it shuts the cargo space; down, it's the ramp to
// the ground. A control box inside and another outside work it. It's where a round starts and ends,
// and whatever lies in its cargo space is the crew's loot.
//
// The numbers are the model's (scripts/models/truck.py, models/level/truck.glb and truck-hatch.glb):
// meters from its origin on the ground under the middle of the cargo box, the cab towards +z and the
// hatch towards -z. Change them together, here and in shared/truck.ts.
//
// The truck is drawn and collided by ATruck (TruckActor.as).

namespace Truck
{
	/** The cargo box, outside: half its width, its ends and its top. */
	const float HALF_WIDTH = 1.25;
	const float BACK = -3.1;
	const float FRONT = 3.1;
	const float TOP = 3.3;
	/** The cargo space inside: half its width, its ends, its floor and ceiling. */
	const float INSIDE_HALF_WIDTH = 1.19;
	const float INSIDE_BACK = -3.07;
	const float INSIDE_FRONT = 3.03;
	const float INSIDE_FLOOR = 0.95;
	const float INSIDE_CEILING = 3.15;
	/** The hatch: its hinge, its length from there, half the width to walk on, and how far its underside is below the hinge's line where it meets the ground. */
	const float HINGE_Y = 0.92;
	const float HINGE_Z = -3.145;
	const float HATCH_LENGTH = 2.3;
	const float HATCH_HALF_WIDTH = 1.05;
	const float HATCH_TOE = 0.037;
	/** A bench along each side wall, from the bulkhead back. */
	const float BENCH_DEPTH = 0.45;
	const float BENCH_BACK = 0.1;
	const float BENCH_FRONT = 3.0;
	const float BENCH_HEIGHT = 0.45;
	/** The seats on each bench, five a side: the first's and the last's z. */
	const float SEAT_FIRST = 0.48;
	const float SEAT_LAST = 2.72;
	const int SEATS_PER_SIDE = 5;
	/** The cab, which nobody gets into: half its width, its front and its top. */
	const float CAB_HALF_WIDTH = 1.15;
	const float CAB_FRONT = 5.1;
	const float CAB_TOP = 2.8;
	/** The caged lamp on the ceiling. */
	const FVector LAMP = FVector(0, 3.05, 1.6);

	/** Seconds the hatch takes to go up or down. */
	const float HATCH_TIME = 3.0;
	/** How thick the cargo box's walls are to walk into: more than the model's, so nobody slips through. */
	const float WALL = 0.25;
	/** How far players sitting on a bench are from its front edge, just clear of it (PLAYER_RADIUS + 0.01). */
	const float SEAT_CLEAR = 0.31;

	/** How far the hatch is tipped below level when it's down, in radians: HATCH_DOWN. */
	float HatchDown()
	{
		return Math::Asin((HINGE_Y - HATCH_TOE) / HATCH_LENGTH);
	}

	/** Where the hatch meets the ground when it's down, in the truck's own z. */
	float HatchFoot()
	{
		return HINGE_Z - HATCH_LENGTH * Math::Cos(HatchDown());
	}

	/** Its two control boxes, by the opening on the -x side: on the wall inside, on the skin outside. */
	TArray<FVector> Panels()
	{
		TArray<FVector> Result;
		Result.Add(FVector(-1.11, 2.2, -2.6));
		Result.Add(FVector(-1.33, 1.4, -2.7));
		return Result;
	}
}

/** Where a truck stands: its origin, and how many quarter turns clockwise from north its cab faces. */
struct FTruckPlace
{
	float X = 0.0;
	float Y = 0.0;
	float Z = 0.0;
	int Turns = 0;

	/** The way its cab faces in the game's degrees: 0 north, 90 east. */
	float Yaw() const
	{
		return Turns * 90.0;
	}
};

/** A seat on a bench, in the level's space. */
struct FSeat
{
	/** Where a seated player is: their feet, in front of the bench. */
	FVector Feet;
	/** Where they face, across the truck, in the game's degrees (0 north, 90 east). */
	float Yaw = 0.0;
	/** The middle of the seat itself, to reach for. */
	FVector At;
};

/** A parked truck, as a level needs it: parkTruck()'s ParkedTruck. */
struct FParkedTruck
{
	FTruckPlace Place;
	/** What stops players: the chassis, walls, bulkhead and cab, the benches and the roof. */
	TArray<FLevelBox> Boxes;
	/** What they stand on: the cargo floor. The ramp is apart, as it comes and goes. */
	TArray<FFloor> Floors;
	/** The ramp the hatch makes when it's down. */
	FFloor Ramp;
	/** What closes the back while the hatch isn't down. */
	FLevelBox HatchWall;
	/** The ground the hatch comes down on: nobody may stand here when it starts to move. */
	FBoxXZ HatchFootprint;
	/** Its control boxes, to reach for. */
	TArray<FVector> Panels;
	/** The cargo space: loot in here counts, and so do the players in it when the truck leaves. */
	FBoxXZ Dock;
	/** The seats on the benches, from the bulkhead back, one side and then the other. */
	TArray<FSeat> Seats;
	/** Where the ceiling lamp hangs. */
	FVector Lamp;

	/** Where the index'th player stands when a round begins, between the benches. */
	FVector Spawn(int Index) const
	{
		// In twos down the aisle, from the bulkhead back.
		const int Row = Math::IntegerDivisionTrunc(Index, 2) % 5;
		const FVector2D At = Truck::Placed(Place, Index % 2 == 0 ? -0.36 : 0.36, 2.5 - Row * 0.62);
		return FVector(At.X, Place.Y + Truck::INSIDE_FLOOR, At.Y);
	}
};

namespace Truck
{
	/** Where a point of the truck's own space (x across, z towards the cab) is in the level, as (x, z). */
	FVector2D Placed(FTruckPlace Place, float X, float Z)
	{
		float PX = X;
		float PZ = Z;
		// A quarter turn clockwise takes the model's +z to +x.
		for (int Turn = 0; Turn < Place.Turns; Turn++)
		{
			const float Was = PX;
			PX = PZ;
			PZ = -Was;
		}
		return FVector2D(Place.X + PX, Place.Z + PZ);
	}

	/** A box of the truck's own space in the level's. */
	FBoxXZ PlacedBox(FTruckPlace Place, float MinX, float MaxX, float MinZ, float MaxZ)
	{
		const FVector2D A = Placed(Place, MinX, MinZ);
		const FVector2D B = Placed(Place, MaxX, MaxZ);
		return Level::MakeBoxXZ(Math::Min(A.X, B.X), Math::Max(A.X, B.X), Math::Min(A.Y, B.Y), Math::Max(A.Y, B.Y));
	}

	FLevelBox Solid(FTruckPlace Place, float MinX, float MaxX, float MinZ, float MaxZ, float Y, float Top)
	{
		return Level::MakeLevelBox(PlacedBox(Place, MinX, MaxX, MinZ, MaxZ), Place.Y + Y, Top - Y, ELevelBoxKind::Scenery);
	}

	/** A point of the truck's own space in the level's, y up from its origin. */
	FVector PlacedPoint(FTruckPlace Place, FVector Point)
	{
		const FVector2D At = Placed(Place, Point.X, Point.Z);
		return FVector(At.X, Place.Y + Point.Y, At.Y);
	}

	/** A truck parked at a place, in the level's space: parkTruck(). */
	FParkedTruck Park(FTruckPlace Place)
	{
		FParkedTruck Parked;
		Parked.Place = Place;
		const float Wide = INSIDE_HALF_WIDTH + WALL;

		// The chassis and wheels under the floor.
		Parked.Boxes.Add(Solid(Place, -HALF_WIDTH, HALF_WIDTH, BACK, FRONT, 0, INSIDE_FLOOR - 0.05));
		// The side walls.
		Parked.Boxes.Add(Solid(Place, -Wide, -INSIDE_HALF_WIDTH, BACK, INSIDE_FRONT, 0, TOP));
		Parked.Boxes.Add(Solid(Place, INSIDE_HALF_WIDTH, Wide, BACK, INSIDE_FRONT, 0, TOP));
		// The bulkhead, and the cab beyond it.
		Parked.Boxes.Add(Solid(Place, -Wide, Wide, INSIDE_FRONT, FRONT + 0.1, 0, TOP));
		Parked.Boxes.Add(Solid(Place, -CAB_HALF_WIDTH, CAB_HALF_WIDTH, FRONT + 0.1, CAB_FRONT, 0, CAB_TOP));
		// The roof, for those who jump.
		Parked.Boxes.Add(Solid(Place, -HALF_WIDTH, HALF_WIDTH, BACK, FRONT, INSIDE_CEILING, TOP));
		// The benches.
		Parked.Boxes.Add(Solid(Place, -INSIDE_HALF_WIDTH, -(INSIDE_HALF_WIDTH - BENCH_DEPTH), BENCH_BACK, BENCH_FRONT, INSIDE_FLOOR, INSIDE_FLOOR + BENCH_HEIGHT));
		Parked.Boxes.Add(Solid(Place, INSIDE_HALF_WIDTH - BENCH_DEPTH, INSIDE_HALF_WIDTH, BENCH_BACK, BENCH_FRONT, INSIDE_FLOOR, INSIDE_FLOOR + BENCH_HEIGHT));

		Parked.Floors.Add(Level::MakeFloor(PlacedBox(Place, -INSIDE_HALF_WIDTH, INSIDE_HALF_WIDTH, BACK, INSIDE_FRONT), Place.Y + INSIDE_FLOOR, 0.1, EFloorKind::Ground));

		// The ramp rises towards the cab, whichever way that faces.
		Parked.Ramp = Level::MakeFloor(PlacedBox(Place, -HATCH_HALF_WIDTH, HATCH_HALF_WIDTH, HatchFoot(), BACK), Place.Y, 0.1, EFloorKind::Ground);
		Parked.Ramp.bHasRise = true;
		Parked.Ramp.RiseToward = Place.Turns == 0 ? ESide::N : Place.Turns == 1 ? ESide::E : Place.Turns == 2 ? ESide::S : ESide::W;
		Parked.Ramp.RiseHeight = INSIDE_FLOOR;

		Parked.HatchWall = Solid(Place, -Wide, Wide, BACK - WALL, BACK, INSIDE_FLOOR - 0.05, TOP);
		Parked.HatchFootprint = PlacedBox(Place, -HALF_WIDTH, HALF_WIDTH, HatchFoot() - 0.3, BACK);
		for (const FVector& Panel : Panels())
			Parked.Panels.Add(PlacedPoint(Place, Panel));

		Parked.Dock = PlacedBox(Place, -INSIDE_HALF_WIDTH, INSIDE_HALF_WIDTH, INSIDE_BACK, INSIDE_FRONT);
		Parked.Lamp = PlacedPoint(Place, LAMP);

		// From the bulkhead back, one side and then the other, so the first to sit face each other.
		const float Edge = INSIDE_HALF_WIDTH - BENCH_DEPTH;
		for (int N = 0; N < 2 * SEATS_PER_SIDE; N++)
		{
			const float Side = N % 2 == 0 ? -1.0 : 1.0;
			const float Z = SEAT_LAST - (SEAT_LAST - SEAT_FIRST) * Math::IntegerDivisionTrunc(N, 2) / (SEATS_PER_SIDE - 1);
			FSeat Seat;
			Seat.Feet = PlacedPoint(Place, FVector(Side * (Edge - SEAT_CLEAR), INSIDE_FLOOR, Z));
			Seat.At = PlacedPoint(Place, FVector(Side * (Edge + BENCH_DEPTH / 2), INSIDE_FLOOR + BENCH_HEIGHT, Z));
			// Facing the other bench: east (90) from the -x side, turned with the truck.
			Seat.Yaw = FRotator::NormalizeAxis(-Side * 90.0 + Place.Yaw());
			Parked.Seats.Add(Seat);
		}
		return Parked;
	}
}
