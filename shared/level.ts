import type { Box } from "./collision";
import { ARENA_SIZE, type ItemKind } from "./constants";

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
 * Static level geometry, used by the server for collision and by the client for rendering.
 * Boxes are axis-aligned on the ground plane (x/z); `height` is how far up they block physics.
 */
export type LevelBox = Box & { height: number; kind: "wall" | "shelf" };

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
  ].map((box) => ({ ...box, height: WALL_HEIGHT, kind: "wall" as const })),
  ...SHELF_ROWS.flatMap((x) =>
    SHELF_SPANS.map(([minZ, maxZ]) => ({
      minX: x - SHELF_WIDTH / 2,
      maxX: x + SHELF_WIDTH / 2,
      minZ,
      maxZ,
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
  dock: DOCK,
  items: STORE_ITEMS,
  // Along the front of the store, by the dock.
  spawnPoint: (index) => ({ x: -12 + (index % 8) * 3.4, z: 13 + (index % 2) * 2 }),
  roof: undefined,
};

// The playground: one brick hall under a roof on steel beams, to try things out in. Items wait in
// a row along the west wall, new things to look at stand along the east wall (client/src/playground.ts),
// and there's a dock to deliver to in the north-west corner.
const HALL_X = 12; // half the hall's width (x) and length (z), inside the walls
const HALL_Z = 9;
const HALL_HEIGHT = 6;

const PLAYGROUND: Level = {
  name: "playground",
  size: 2 * (HALL_X + WALL),
  boxes: [
    { minX: -HALL_X - WALL, maxX: HALL_X + WALL, minZ: HALL_Z, maxZ: HALL_Z + WALL },
    { minX: -HALL_X - WALL, maxX: HALL_X + WALL, minZ: -HALL_Z - WALL, maxZ: -HALL_Z },
    { minX: HALL_X, maxX: HALL_X + WALL, minZ: -HALL_Z, maxZ: HALL_Z },
    { minX: -HALL_X - WALL, maxX: -HALL_X, minZ: -HALL_Z, maxZ: HALL_Z },
  ].map((box) => ({ ...box, height: HALL_HEIGHT, kind: "wall" as const })),
  dock: { minX: -HALL_X, maxX: -HALL_X + 4, minZ: HALL_Z - 3, maxZ: HALL_Z },
  items: [
    { kind: "phone", x: -10, y: 0.1, z: -6 },
    { kind: "phone", x: -10, y: 0.1, z: -5 },
    { kind: "box", x: -10, y: 0.6, z: -3 },
    { kind: "tv", x: -10, y: 0.5, z: 0 },
    { kind: "sofa", x: -9.5, y: 0.5, z: 3.5 },
  ],
  // In the middle of the south half, facing north.
  spawnPoint: (index) => ({ x: -3 + (index % 4) * 2, z: -6 + (Math.floor(index / 4) % 2) }),
  roof: HALL_HEIGHT,
};

/** Every level, by the name a room and `?level=` use. */
export const LEVELS = { store: STORE, playground: PLAYGROUND } satisfies Record<string, Level>;
export type LevelName = keyof typeof LEVELS;

/** The level of that name, else the store. */
export function levelNamed(name: unknown): Level {
  return Object.hasOwn(LEVELS, String(name)) ? LEVELS[name as LevelName] : STORE;
}
