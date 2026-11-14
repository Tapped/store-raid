import type { Box } from "./collision";
import type { Floor, LevelBox } from "./level";
import type { Side } from "./tiles";

/**
 * The crew's truck: a box truck with benches along the walls of its cargo space, open at the back,
 * with a ramp down to the ground. It's where a round starts and ends, and whatever lies in its
 * cargo space is the crew's loot.
 *
 * The numbers are the model's (scripts/models/truck.py, models/level/truck.glb): meters from its
 * origin on the ground under the middle of the cargo box, the cab towards +z and the ramp towards
 * -z. Change them together.
 */
export const TRUCK = {
  /** The cargo box, outside: half its width, its ends and its top. */
  halfWidth: 1.25,
  back: -3.1,
  front: 3.1,
  top: 3.3,
  /** The cargo space inside: half its width, its ends, its floor and ceiling. */
  inside: { halfWidth: 1.19, back: -3.07, front: 3.03, floor: 0.95, ceiling: 3.15 },
  /** The ramp from the floor's edge down to the ground: half its width and where it lands. */
  ramp: { halfWidth: 1.05, foot: -5.9 },
  /** A bench along each side wall, from the bulkhead back. */
  bench: { depth: 0.45, back: 0.1, front: 3.0, height: 0.45 },
  /** The cab, which nobody gets into: half its width, its front and its top. */
  cab: { halfWidth: 1.15, front: 5.1, top: 2.8 },
  /** The caged lamp on the ceiling. */
  lamp: { x: 0, y: 3.05, z: 1.6 },
} as const;

/** How thick the cargo box's walls are to walk into: more than the model's, so nobody slips through. */
const WALL = 0.25;

/** Where a truck stands: its origin, and how many quarter turns clockwise from north its cab faces. */
export interface TruckPlace {
  x: number;
  y: number;
  z: number;
  turns: 0 | 1 | 2 | 3;
}

/** A parked truck, as a level needs it. */
export interface ParkedTruck {
  place: TruckPlace;
  /** What stops players: the chassis, walls, bulkhead and cab, the benches and the roof. */
  boxes: LevelBox[];
  /** What they stand on: the cargo floor and the ramp. */
  floors: Floor[];
  /** The cargo space: loot in here counts, and so do the players in it when the truck leaves. */
  dock: Box;
  /** Where the index-th player stands when a round begins, between the benches. */
  spawn(index: number): { x: number; y: number; z: number };
  /** Where the ceiling lamp hangs. */
  lamp: { x: number; y: number; z: number };
  /** The foot of the ramp, on the ground. */
  rampFoot: { x: number; z: number };
}

const SIDES: readonly Side[] = ["n", "e", "s", "w"];

/** A truck parked at `place`, in the level's space. */
export function parkTruck(place: TruckPlace): ParkedTruck {
  const { inside, ramp, bench, cab } = TRUCK;
  // A quarter turn clockwise takes the model's +z to +x.
  const point = (x: number, z: number) => {
    let [px, pz] = [x, z];
    for (let i = 0; i < place.turns; i++) [px, pz] = [pz, -px];
    return { x: place.x + px, z: place.z + pz };
  };
  const box = (minX: number, maxX: number, minZ: number, maxZ: number): Box => {
    const a = point(minX, minZ);
    const b = point(maxX, maxZ);
    return {
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minZ: Math.min(a.z, b.z),
      maxZ: Math.max(a.z, b.z),
    };
  };
  const solid = (
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    top: number,
  ): LevelBox => ({
    ...box(minX, maxX, minZ, maxZ),
    y: place.y + y,
    height: top - y,
    kind: "scenery",
  });
  const half = TRUCK.halfWidth;
  const wide = inside.halfWidth + WALL;
  const boxes: LevelBox[] = [
    // The chassis and wheels under the floor.
    solid(-half, half, TRUCK.back, TRUCK.front, 0, inside.floor - 0.05),
    // The side walls.
    solid(-wide, -inside.halfWidth, TRUCK.back, inside.front, 0, TRUCK.top),
    solid(inside.halfWidth, wide, TRUCK.back, inside.front, 0, TRUCK.top),
    // The bulkhead, and the cab beyond it.
    solid(-wide, wide, inside.front, TRUCK.front + 0.1, 0, TRUCK.top),
    solid(-cab.halfWidth, cab.halfWidth, TRUCK.front + 0.1, cab.front, 0, cab.top),
    // The roof, for those who jump.
    solid(-half, half, TRUCK.back, TRUCK.front, inside.ceiling, TRUCK.top),
    // The benches.
    ...[-1, 1].map((side) =>
      solid(
        Math.min(side * inside.halfWidth, side * (inside.halfWidth - bench.depth)),
        Math.max(side * inside.halfWidth, side * (inside.halfWidth - bench.depth)),
        bench.back,
        bench.front,
        inside.floor,
        inside.floor + bench.height,
      ),
    ),
  ];
  const floors: Floor[] = [
    {
      ...box(-inside.halfWidth, inside.halfWidth, TRUCK.back, inside.front),
      y: place.y + inside.floor,
      thickness: 0.1,
      kind: "ground",
    },
    {
      ...box(-ramp.halfWidth, ramp.halfWidth, ramp.foot, TRUCK.back),
      y: place.y,
      thickness: 0.1,
      kind: "ground",
      // Up towards the cab, whichever way that faces.
      rise: { toward: SIDES[place.turns], height: inside.floor },
    },
  ];
  return {
    place,
    boxes,
    floors,
    dock: box(-inside.halfWidth, inside.halfWidth, inside.back, inside.front),
    spawn: (index) => {
      // In twos down the aisle, from the bulkhead back.
      const row = Math.floor(index / 2) % 5;
      const at = point(index % 2 === 0 ? -0.36 : 0.36, 2.5 - row * 0.62);
      return { ...at, y: place.y + inside.floor };
    },
    lamp: { ...point(TRUCK.lamp.x, TRUCK.lamp.z), y: place.y + TRUCK.lamp.y },
    rampFoot: point(0, ramp.foot),
  };
}
