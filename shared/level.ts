import type { Box } from "./collision";
import { ARENA_SIZE, type ItemKind } from "./constants";
import { CELL, composeTiles, type Side, STOREY } from "./tiles";

const HALF = ARENA_SIZE / 2;
const WALL = 1;
const WALL_HEIGHT = 3;
const DOOR = 6; // half the width of the opening to the loading dock
const DOCK_DEPTH = 8;

const SHELF_WIDTH = 1.2;
const SHELF_HEIGHT = 2.4;
/** Shelf rows run along z; the aisles between them are wide enough for two people and a sofa. */
const SHELF_ROWS = [-15, -9, -3, 3, 9, 15];
const SHELF_SPANS = [
  [-12, -2],
  [1, 11],
];

/**
 * Static level geometry, used by the server for collision and by the client for rendering. Boxes
 * are axis-aligned and block from `y` up to `y + height`. "stairs" boxes are drawn as part of the
 * stairs' floor, not on their own.
 */
export type LevelBox = Box & {
  y: number;
  height: number;
  kind: "wall" | "shelf" | "rail" | "pit" | "stairs";
};

/**
 * Something to walk on: its top is at `y`, or for stairs a ramp rising `rise.height` from `y` at one
 * side to the other, `toward`. Players stand where their centre is over one, so they fall off the
 * edge of a plank. `thickness` is how far down it's solid.
 */
export interface Floor extends Box {
  y: number;
  thickness: number;
  kind: "floor" | "plank" | "stairs";
  rise?: { toward: Side; height: number };
}

/** How high a floor's top is at a point over it. */
export function floorHeight(floor: Floor, x: number, z: number): number {
  const { rise } = floor;
  if (!rise) return floor.y;
  const along = (value: number, min: number, max: number) =>
    Math.min(1, Math.max(0, (value - min) / (max - min)));
  const t = {
    n: along(z, floor.minZ, floor.maxZ),
    s: 1 - along(z, floor.minZ, floor.maxZ),
    e: along(x, floor.minX, floor.maxX),
    w: 1 - along(x, floor.minX, floor.maxX),
  }[rise.toward];
  return floor.y + t * rise.height;
}

/** Where an item starts, just off the ground, so it settles when a room opens. */
export interface ItemSpawn {
  kind: ItemKind;
  x: number;
  y: number;
  z: number;
}

/** One building: what the server simulates and the client draws for it. */
export interface Level {
  name: string;
  /** Width and length of its floor, centred on the origin. */
  size: number;
  boxes: LevelBox[];
  floors: Floor[];
  /** Players who fall below this die, and things that fall below it go back where they started. */
  killY: number;
  /** A dimmer on the wall for the lights, where there is one: hold grab on it to fade them. */
  dimmer: { x: number; y: number; z: number; turn: number } | undefined;
  /** Where finished items go: an item whose centre is in here counts as delivered. */
  dock: Box | undefined;
  items: ItemSpawn[];
  /** Where the index-th player to join starts, unless they've been here before. */
  spawnPoint(index: number): { x: number; z: number };
  /** How high its roof is, or undefined if it's open to the sky. */
  roof: number | undefined;
}

/** Where finished items go. An item whose centre is in here counts as delivered. */
const DOCK: Box = { minX: -DOOR, maxX: DOOR, minZ: HALF, maxZ: HALF + DOCK_DEPTH };

const STORE_BOXES: LevelBox[] = [
  // Outer walls, with an opening onto the dock in the north one
  ...[
    { minX: -HALF - WALL, maxX: -DOOR, minZ: HALF, maxZ: HALF + WALL },
    { minX: DOOR, maxX: HALF + WALL, minZ: HALF, maxZ: HALF + WALL },
    { minX: -HALF - WALL, maxX: HALF + WALL, minZ: -HALF - WALL, maxZ: -HALF },
    { minX: HALF, maxX: HALF + WALL, minZ: -HALF, maxZ: HALF },
    { minX: -HALF - WALL, maxX: -HALF, minZ: -HALF, maxZ: HALF },
    // The dock
    { minX: -DOOR - WALL, maxX: -DOOR, minZ: HALF + WALL, maxZ: HALF + DOCK_DEPTH },
    { minX: DOOR, maxX: DOOR + WALL, minZ: HALF + WALL, maxZ: HALF + DOCK_DEPTH },
    {
      minX: -DOOR - WALL,
      maxX: DOOR + WALL,
      minZ: HALF + DOCK_DEPTH,
      maxZ: HALF + DOCK_DEPTH + WALL,
    },
  ].map((box) => ({ ...box, y: 0, height: WALL_HEIGHT, kind: "wall" as const })),
  ...SHELF_ROWS.flatMap((x) =>
    SHELF_SPANS.map(([minZ, maxZ]) => ({
      minX: x - SHELF_WIDTH / 2,
      maxX: x + SHELF_WIDTH / 2,
      minZ,
      maxZ,
      y: 0,
      height: SHELF_HEIGHT,
      kind: "shelf" as const,
    })),
  ),
];

const STORE_ITEMS: ItemSpawn[] = [
  { kind: "sofa", x: 0, y: 0.5, z: -16 },
  { kind: "sofa", x: -12, y: 0.5, z: -16 },
  { kind: "box", x: 6, y: 0.6, z: -6 },
  { kind: "box", x: -6, y: 0.6, z: -6 },
  { kind: "box", x: 12, y: 0.6, z: 6 },
  { kind: "box", x: -12, y: 0.6, z: 6 },
  { kind: "box", x: 0, y: 0.6, z: 6 },
  { kind: "box", x: 12, y: 0.6, z: -16 },
  { kind: "phone", x: 5.6, y: 0.1, z: 9 },
  { kind: "phone", x: 6.4, y: 0.1, z: 9 },
  { kind: "phone", x: 0, y: 0.1, z: -8 },
  { kind: "phone", x: -12, y: 0.1, z: -9 },
  { kind: "phone", x: 12, y: 0.1, z: 2 },
  { kind: "tv", x: -6, y: 0.5, z: 9 },
  { kind: "tv", x: 12, y: 0.5, z: -10 },
];

/** The megastore: shelving in rows, open to the night sky, with the loading dock to the north. */
const STORE: Level = {
  name: "store",
  size: ARENA_SIZE,
  boxes: STORE_BOXES,
  floors: [
    { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF, y: 0, thickness: 0.3, kind: "floor" },
    { ...DOCK, y: 0, thickness: 0.3, kind: "floor" },
  ],
  killY: -10,
  dimmer: undefined,
  dock: DOCK,
  items: STORE_ITEMS,
  // Along the front of the store, by the dock.
  spawnPoint: (index) => ({ x: -12 + (index % 8) * 3.4, z: 13 + (index % 2) * 2 }),
  roof: undefined,
};

// The playground: one brick hall under a roof on steel beams, to try things out in, built from tiles
// (shared/tiles.ts) inside four walls. Items wait in a row along the west wall, with a dock to
// deliver to in the north-west corner; a pit with a plank across fills the east side; stairs go up
// to a mezzanine along the north wall, and on to a platform above that; new things to look at
// stand in the south-east corner (client/src/playground.ts).
const HALL_X = 16; // half the hall's width (x) and length (z), inside the walls
const HALL_Z = 12;
const HALL_HEIGHT = 9;

/** Eight cells across and six deep, three storeys. Each storey's northern row comes first. */
const PLAYGROUND_TILES = composeTiles({
  x: -HALL_X,
  z: -HALL_Z,
  storeys: [
    ["FFFFFFFF", "FFFFFP|P", "FFF^FP|P", "FFFFFP|P", "FFFFFFFF", "FFFFFFFF"],
    [".F<FF...", ".FFFF..."],
    ["FF......"],
  ],
});

const PLAYGROUND: Level = {
  name: "playground",
  size: 2 * (HALL_X + WALL),
  boxes: [
    ...[
      { minX: -HALL_X - WALL, maxX: HALL_X + WALL, minZ: HALL_Z, maxZ: HALL_Z + WALL },
      { minX: -HALL_X - WALL, maxX: HALL_X + WALL, minZ: -HALL_Z - WALL, maxZ: -HALL_Z },
      { minX: HALL_X, maxX: HALL_X + WALL, minZ: -HALL_Z, maxZ: HALL_Z },
      { minX: -HALL_X - WALL, maxX: -HALL_X, minZ: -HALL_Z, maxZ: HALL_Z },
    ].map((box) => ({ ...box, y: 0, height: HALL_HEIGHT, kind: "wall" as const })),
    ...PLAYGROUND_TILES.boxes,
  ],
  floors: PLAYGROUND_TILES.floors,
  killY: -4,
  // On the south wall, behind where players start.
  dimmer: { x: -6, y: 1.3, z: -HALL_Z, turn: 0 },
  dock: { minX: -HALL_X, maxX: -HALL_X + CELL, minZ: HALL_Z - 3, maxZ: HALL_Z },
  items: [
    { kind: "phone", x: -14, y: 0.1, z: -9 },
    { kind: "phone", x: -14, y: 0.1, z: -8 },
    { kind: "box", x: -14, y: 0.6, z: -6 },
    { kind: "tv", x: -14, y: 0.5, z: -3 },
    { kind: "sofa", x: -13.5, y: 0.5, z: 1 },
    // One up on the mezzanine, to carry down the stairs.
    { kind: "box", x: -6, y: STOREY + 0.6, z: 6 },
  ],
  // In the middle of the south side, facing north.
  spawnPoint: (index) => ({ x: -3 + (index % 4) * 2, z: -9 + (Math.floor(index / 4) % 2) }),
  roof: HALL_HEIGHT,
};

/** Every level, by the name a room and `?level=` use. */
export const LEVELS = { store: STORE, playground: PLAYGROUND } satisfies Record<string, Level>;
export type LevelName = keyof typeof LEVELS;

/** The level of that name, else the playground. */
export function levelNamed(name: unknown): Level {
  return Object.hasOwn(LEVELS, String(name)) ? LEVELS[name as LevelName] : PLAYGROUND;
}
