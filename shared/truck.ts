import type { Box } from "./collision";
import { PLAYER_RADIUS } from "./constants";
import type { Floor, Level, LevelBox } from "./level";
import type { Terrain } from "./movement";
import type { Side } from "./tiles";

/**
 * The crew's truck: a box truck with benches along the walls of its cargo space. Its back is a
 * hatch hinged at the floor: up, it shuts the cargo space; down, it's the ramp to the ground. A
 * control box inside and another outside work it. It's where a round starts and ends, and whatever
 * lies in its cargo space is the crew's loot.
 *
 * The numbers are the model's (scripts/models/truck.py, models/level/truck.glb and
 * truck-hatch.glb): meters from its origin on the ground under the middle of the cargo box, the cab
 * towards +z and the hatch towards -z. Change them together.
 */
export const TRUCK = {
  /** The cargo box, outside: half its width, its ends and its top. */
  halfWidth: 1.25,
  back: -3.1,
  front: 3.1,
  top: 3.3,
  /** The cargo space inside: half its width, its ends, its floor and ceiling. */
  inside: { halfWidth: 1.19, back: -3.07, front: 3.03, floor: 0.95, ceiling: 3.15 },
  /**
   * The hatch: where its hinge is, how long it is from there, half the width to walk on, and how
   * far its underside is below the hinge's line where it meets the ground.
   */
  hatch: { hingeY: 0.92, hingeZ: -3.145, length: 2.3, halfWidth: 1.05, toe: 0.037 },
  /** Its control boxes, both by the opening on the -x side: on the wall inside, on the skin outside. */
  panels: [
    { x: -1.11, y: 2.2, z: -2.6 },
    { x: -1.33, y: 1.4, z: -2.7 },
  ],
  /** A bench along each side wall, from the bulkhead back. */
  bench: { depth: 0.45, back: 0.1, front: 3.0, height: 0.45 },
  /** The seats on each bench, five a side: the first's and the last's z. */
  seats: { first: 0.48, last: 2.72, perSide: 5 },
  /** The cab, which nobody gets into: half its width, its front and its top. */
  cab: { halfWidth: 1.15, front: 5.1, top: 2.8 },
  /** The caged lamp on the ceiling. */
  lamp: { x: 0, y: 3.05, z: 1.6 },
} as const;

/** Seconds the hatch takes to go up or down. */
export const HATCH_TIME = 3;

/** How far the hatch is tipped below level when it's down, in radians. */
export const HATCH_DOWN = Math.asin((TRUCK.hatch.hingeY - TRUCK.hatch.toe) / TRUCK.hatch.length);

/** Where the hatch meets the ground when it's down. */
const HATCH_FOOT = TRUCK.hatch.hingeZ - TRUCK.hatch.length * Math.cos(HATCH_DOWN);

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
  /** What they stand on: the cargo floor, and the hatch as a ramp, as it is when it's down. */
  floors: Floor[];
  /** The hatch: see `terrainOf` for what a level is with it up. */
  hatch: {
    /** The ramp it makes when it's down: one of `floors`. */
    ramp: Floor;
    /** What closes the back while it isn't down. */
    wall: LevelBox;
    /** The ground it comes down on: nobody may stand here when it starts to move. */
    footprint: Box;
    /** Its control boxes, to reach for. */
    panels: { x: number; y: number; z: number }[];
  };
  /** The cargo space: loot in here counts, and so do the players in it when the truck leaves. */
  dock: Box;
  /** Where the index-th player stands when a round begins, between the benches. */
  spawn(index: number): { x: number; y: number; z: number };
  /**
   * The seats on the benches: where a player sitting there has their feet, in the aisle just
   * clear of the bench, the yaw they face, across the truck, and the middle of the seat itself.
   */
  seats: Seat[];
  /** Where the ceiling lamp hangs. */
  lamp: { x: number; y: number; z: number };
  /** The foot of the ramp, on the ground. */
  rampFoot: { x: number; z: number };
}

/** A seat on a bench, in the level's space. */
export interface Seat {
  /** Where a seated player is: their feet, in front of the bench. The character sits behind them. */
  x: number;
  y: number;
  z: number;
  /** Where they face, across the truck. */
  yaw: number;
  /** The middle of the seat, to reach for. */
  at: { x: number; y: number; z: number };
}

/** How far players sitting on a bench are from its front edge: just clear of it. */
const SEAT_CLEAR = PLAYER_RADIUS + 0.01;

const SIDES: readonly Side[] = ["n", "e", "s", "w"];

/** Where a point of the truck's own space (x across, z towards the cab) is in the level. */
export function placed(place: TruckPlace, x: number, z: number): { x: number; z: number } {
  let [px, pz] = [x, z];
  // A quarter turn clockwise takes the model's +z to +x.
  for (let i = 0; i < place.turns; i++) [px, pz] = [pz, -px];
  return { x: place.x + px, z: place.z + pz };
}

/** A truck parked at `place`, in the level's space. */
export function parkTruck(place: TruckPlace): ParkedTruck {
  const { inside, hatch, bench, cab } = TRUCK;
  const point = (x: number, z: number) => placed(place, x, z);
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
  const ramp: Floor = {
    ...box(-hatch.halfWidth, hatch.halfWidth, HATCH_FOOT, TRUCK.back),
    y: place.y,
    thickness: 0.1,
    kind: "ground",
    // Up towards the cab, whichever way that faces.
    rise: { toward: SIDES[place.turns], height: inside.floor },
  };
  const floors: Floor[] = [
    {
      ...box(-inside.halfWidth, inside.halfWidth, TRUCK.back, inside.front),
      y: place.y + inside.floor,
      thickness: 0.1,
      kind: "ground",
    },
    ramp,
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
    // From the bulkhead back, one side and then the other, so the first to sit face each other.
    seats: Array.from({ length: 2 * TRUCK.seats.perSide }, (_, n): Seat => {
      const { first, last, perSide } = TRUCK.seats;
      const side = n % 2 === 0 ? -1 : 1;
      const z = last - ((last - first) * Math.floor(n / 2)) / (perSide - 1);
      const edge = inside.halfWidth - bench.depth;
      const feet = point(side * (edge - SEAT_CLEAR), z);
      const seat = point(side * (edge + bench.depth / 2), z);
      return {
        ...feet,
        y: place.y + inside.floor,
        // Facing the other bench: +x from the -x side, turned with the truck.
        yaw: (-side * Math.PI) / 2 + (place.turns * Math.PI) / 2,
        at: { ...seat, y: place.y + inside.floor + bench.height },
      };
    }),
    lamp: { ...point(TRUCK.lamp.x, TRUCK.lamp.z), y: place.y + TRUCK.lamp.y },
    rampFoot: point(0, HATCH_FOOT),
    hatch: {
      ramp,
      wall: solid(-wide, wide, TRUCK.back - WALL, TRUCK.back, inside.floor - 0.05, TRUCK.top),
      footprint: box(-TRUCK.halfWidth, TRUCK.halfWidth, HATCH_FOOT - 0.3, TRUCK.back),
      panels: TRUCK.panels.map((panel) => ({ ...point(panel.x, panel.z), y: place.y + panel.y })),
    },
  };
}

const shut = new WeakMap<object, Terrain>();

/**
 * What players walk on and bump into in a level, with its truck's hatch down or not. The level's
 * own floors and boxes are with it down; while it's up or moving, the ramp is gone and the back is
 * closed. The same arrays every time, so lookups in them stay quick (shared/spatial.ts).
 */
export function terrainOf(
  level: Pick<Level, "boxes" | "floors" | "ladders" | "truck">,
  hatchDown: boolean,
): Terrain {
  const hatch = level.truck?.hatch;
  if (!hatch || hatchDown) return level;
  let terrain = shut.get(level);
  if (!terrain) {
    terrain = {
      boxes: [...level.boxes, hatch.wall],
      floors: level.floors.filter((floor) => floor !== hatch.ramp),
      ladders: level.ladders,
    };
    shut.set(level, terrain);
  }
  return terrain;
}
