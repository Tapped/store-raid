// The levels, as every machine builds them from a name: mirrors the `Level` type and `levelNamed()`
// in shared/level.ts. `playground` (the default), and `generated-<seed>`, a generated warehouse
// (Warehouse.as). Still to come: the store, the harbour with its yard, and the village.
//
// How it differs from the TS:
// - Each level has the crew's truck, which the round needs: the playground's along its south wall,
//   and a warehouse's outside its loading door, which is open, on a patch of yard with a fence round
//   it, as the harbour will have it with the yard in between. The web game's halls and
//   `generated-<seed>` had only a bare dock.
// - Lamps are what's lit: the playground's under its roof, a warehouse's from its fittings' lights
//   that aren't dead. What the client drew in shaders, the engine's lights do.

/** A light the level has: where, how bright and how far it reaches, and its colour. */
struct FLamp
{
	FVector At;
	float Lumens = 1000.0;
	/** How far it reaches, in meters. */
	float Radius = 10.0;
	FLinearColor Colour = FLinearColor(1.0, 0.9, 0.75);
	bool bShadows = true;
	/** Its fitting's state: a flickering one stutters. */
	ELightState State = ELightState::On;
	/** What kind of fitting gives it, which shapes its light, if it's a fitting's: else it shines all round. */
	bool bFitting = false;
	ELightKind Kind = ELightKind::Bulb;
	/** Radians round y: a tube's length runs along x before it's turned. */
	float Turn = 0.0;
	/** Its place among the level's fittings, dead ones too, which picks how it flickers. */
	int Fitting = 0;
};

/** One level: what the server simulates and every machine draws for it. */
struct FLevel
{
	FString Name;
	/** What it runs as unless the server's command line says otherwise. */
	EMode Mode = EMode::Playground;
	/** Floors, ladders and TVs from its tiles, and every box that stops players. */
	TArray<FFloor> Floors;
	TArray<FLevelBox> Boxes;
	TArray<FLadder> Ladders;
	TArray<FScreen> Screens;
	/** Players who fall below this die, and things that fall below it go back where they started. */
	float KillY = 0.0;
	/** The dimmer for the lights, on a wall facing north. */
	FVector Dimmer;
	/** Where the crew's truck is parked. */
	FTruckPlace Truck;
	TArray<FItemSpawn> Items;
	/** A vent over where players come in, which the ambience is loudest at, so they can find the way out by ear (level.entrance). */
	FVector Vent;
	/** Where players come in outside a game, the first free one, as spawnPoint(index). */
	TArray<FVector2D> Spawns;
	TArray<FLamp> Lamps;
	TArray<FRoom> Rooms;
	TArray<FPropSpawn> Props;
	TArray<FLightSpawn> Lights;
	/** How high its roof is, over the building's footprint, or 0 for none drawn. */
	float Roof = 0.0;
	FBoxXZ Footprint;
	/** The tiles a building is made of, for drawing it by room; none (no storeys) for the playground. */
	FTileGrid Grid;
	/** Why there's no level of that name, or empty. */
	FString Problem;
};

namespace Levels
{
	/** The level of a name: `generated-<seed>`, else the playground. */
	FLevel Named(FString Name)
	{
		if (Name.StartsWith("generated-"))
		{
			FString Seed = Name.RightChop(10);
			if (Seed.IsNumeric())
				return Generated(String::Conv_StringToInt(Seed));
		}
		return Playground();
	}

	/** What a level runs as unless the server says otherwise: generated levels are games. */
	EMode ModeOf(FString Name)
	{
		return Name.StartsWith("generated-") ? EMode::Game : EMode::Playground;
	}

	FLamp MakeLamp(float X, float Y, float Z, float Lumens, float Radius)
	{
		FLamp Lamp;
		Lamp.At = FVector(X, Y, Z);
		Lamp.Lumens = Lumens;
		Lamp.Radius = Radius;
		return Lamp;
	}

	/** The playground: its tiles inside the hall's four walls, under its roof. */
	FLevel Playground()
	{
		FLevel Level;
		Level.Name = "playground";
		Level.Mode = EMode::Playground;
		FComposedTiles Composed = Tiles::ComposeTiles(Playground::Grid());
		Level.Problem = Composed.Problem;
		Level.Floors = Composed.Floors;
		Level.Boxes = Composed.Boxes;
		Level.Ladders = Composed.Ladders;
		Level.Screens = Composed.Screens;
		// The hall's four walls and its roof, which the grid doesn't have (PLAYGROUND in shared/level.ts).
		const float X = Playground::HALL_X;
		const float Z = Playground::HALL_Z;
		const float W = Playground::WALL;
		const float Top = Playground::HALL_HEIGHT;
		const float Bottom = -Tiles::STOREY;
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(-X - W, -X, -Z, Z), Bottom, Top - Bottom, ELevelBoxKind::Wall));
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(X, X + W, -Z, Z), Bottom, Top - Bottom, ELevelBoxKind::Wall));
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(-X - W, X + W, -Z - W, -Z), Bottom, Top - Bottom, ELevelBoxKind::Wall));
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(-X - W, X + W, Z, Z + W), Bottom, Top - Bottom, ELevelBoxKind::Wall));
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(-X - W, X + W, -Z - W, Z + W), Top, W, ELevelBoxKind::Wall));
		Level.KillY = Playground::KILL_Y;
		Level.Dimmer = Playground::DIMMER;
		// 30 cm out from the south wall: on its face, the wall would muffle it (Sounds.as).
		Level.Vent = FVector(0, 2.6, -Playground::HALL_Z + 0.3);
		Level.Truck = Playground::TruckPlace();
		Level.Items = Playground::Items();
		for (int Index = 0; Index < 8; Index++)
			Level.Spawns.Add(Playground::SpawnPoint(Index));
		// Lamps under the roof in rows 8 m apart, and two in the basement.
		for (float LampX = -12; LampX <= 12; LampX += 8)
		{
			for (float LampZ = -8; LampZ <= 8; LampZ += 8)
				Level.Lamps.Add(MakeLamp(LampX, Playground::HALL_HEIGHT - 0.6, LampZ, 12000, 24));
		}
		Level.Lamps.Add(MakeLamp(-6, -0.6, -4, 4000, 12));
		Level.Lamps.Add(MakeLamp(1, -0.6, -6, 4000, 12));
		return Level;
	}

	/** How far the yard in front of a warehouse reaches out from its south wall, and to each side of the door. */
	const float YARD_DEPTH = 14.0;
	const float YARD_HALF_WIDTH = 7.0;
	const float FENCE_HEIGHT = 2.5;

	/**
	 * A generated warehouse round the origin, its loading door open onto a patch of yard where the
	 * crew's truck is backed up to it, its cab to the south.
	 */
	FLevel Generated(int Seed)
	{
		FLevel Level;
		FWarehouse Warehouse = Warehouse::Build(Seed, false, 0, 0, true);
		Level.Name = Warehouse.Name;
		Level.Mode = EMode::Game;
		Level.Problem = Warehouse.Problem;
		if (!Warehouse.Problem.IsEmpty())
			return Level;
		Level.Floors = Warehouse.Tiles.Floors;
		Level.Boxes = Warehouse.Boxes;
		Level.Ladders = Warehouse.Tiles.Ladders;
		Level.Screens = Warehouse.Tiles.Screens;
		Level.KillY = Warehouse.KillY;
		Level.Dimmer = Warehouse.Dimmer;
		Level.Items = Warehouse.Items;
		Level.Rooms = Warehouse.Rooms;
		Level.Props = Warehouse.Props;
		Level.Lights = Warehouse.Lights;
		Level.Roof = Warehouse.Roof;
		Level.Grid = Warehouse.Grid;
		const float X0 = Warehouse.Grid.X;
		const float Z0 = Warehouse.Grid.Z;
		Level.Footprint = Level::MakeBoxXZ(X0, -X0, Z0, -Z0);
		// Over the loading door, 30 cm in from the front wall (which is astride Z0).
		Level.Vent = FVector(Warehouse.EntranceX, 2.6, Z0 + Tiles::WALL / 2 + 0.3);
		for (int Index = 0; Index < 8; Index++)
			Level.Spawns.Add(FVector2D(Warehouse.EntranceX - 1.5 + (Index % 4), Warehouse.EntranceZ + 0.5 + Math::IntegerDivisionTrunc(Index, 4)));

		// The yard: ground in front of the door, fenced in on its other three sides.
		const float Door = Warehouse.EntranceX;
		const float Outside = Z0 - Tiles::WALL / 2;
		FBoxXZ Yard = Level::MakeBoxXZ(Door - YARD_HALF_WIDTH, Door + YARD_HALF_WIDTH, Outside - YARD_DEPTH, Outside);
		Level.Floors.Add(Level::MakeFloor(Yard, 0, Tiles::GROUND, EFloorKind::Floor));
		const float F = 0.1;
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(Yard.MinX - F, Yard.MinX, Yard.MinZ - F, Yard.MaxZ), 0, FENCE_HEIGHT, ELevelBoxKind::Wall));
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(Yard.MaxX, Yard.MaxX + F, Yard.MinZ - F, Yard.MaxZ), 0, FENCE_HEIGHT, ELevelBoxKind::Wall));
		Level.Boxes.Add(Level::MakeLevelBox(Level::MakeBoxXZ(Yard.MinX - F, Yard.MaxX + F, Yard.MinZ - F, Yard.MinZ), 0, FENCE_HEIGHT, ELevelBoxKind::Wall));
		// The truck backed up to the door: the foot of its ramp a little short of the wall.
		Level.Truck.X = Door;
		Level.Truck.Z = Outside - 0.3 + Truck::HatchFoot();
		Level.Truck.Turns = 2;

		for (int Index = 0; Index < Warehouse.Lights.Num(); Index++)
		{
			const FLightSpawn& Light = Warehouse.Lights[Index];
			if (Light.State == ELightState::Dead)
				continue;
			FLamp Lamp;
			Lamp.bFitting = true;
			Lamp.Kind = Light.Kind;
			Lamp.Turn = Light.Turn;
			Lamp.Fitting = Index;
			Lamp.At = FVector(Light.X, Light.Y, Light.Z);
			Lamp.Colour = FLinearColor(Light.R, Light.G, Light.B);
			Lamp.State = Light.State;
			switch (Light.Kind)
			{
				case ELightKind::Tube:
					Lamp.Lumens = 2500 * Light.Power;
					Lamp.Radius = 10;
					Lamp.bShadows = false;
					break;
				case ELightKind::Bulb:
					// High-bays over the halls' aisles cast the shadows; the bulbs in small rooms don't.
					Lamp.Lumens = 3000 * Light.Power;
					Lamp.Radius = Light.Power > 1 ? 16 : 8;
					Lamp.bShadows = Light.Power > 1;
					break;
				default:
					Lamp.Lumens = 600 * Light.Power;
					Lamp.Radius = 4;
					Lamp.bShadows = false;
					break;
			}
			Level.Lamps.Add(Lamp);
		}
		return Level;
	}
}
