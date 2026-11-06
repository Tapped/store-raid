import type { Box } from "./collision";
import { ARENA_SIZE, type ItemKind } from "./constants";
import { type GenerateOptions, generate } from "./generate";
import { CELL, composeTiles, type Screen, type Side, STOREY } from "./tiles";

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
  /** A partition is a wall between rooms, inside a building. */
  kind: "wall" | "partition" | "shelf" | "rail" | "pit" | "stairs" | "furniture";
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

/**
 * Where a ladder can be climbed: the strip in front of it, from its foot at `y` up to the floor it
 * leads to at `top`. Players climb it by walking `toward` the wall it's on and go down by backing away.
 */
export interface Ladder extends Box {
  y: number;
  top: number;
  toward: Side;
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
  ladders: Ladder[];
  /** Players who fall below this die, and things that fall below it go back where they started. */
  killY: number;
  /** A dimmer on the wall for the lights, where there is one: hold grab on it to fade them. */
  dimmer: { x: number; y: number; z: number; turn: number } | undefined;
  /** Where finished items go: an item whose centre is in here counts as delivered. */
  dock: Box | undefined;
  /**
   * The way in and out, in the outer wall, where a vent above it hums: the level's ambience is
   * loudest there (client/src/ambience.ts).
   */
  entrance: { x: number; y: number; z: number };
  /** TVs showing static, from `tv` tiles (client/src/screens.ts). */
  screens: Screen[];
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
  { kind: "flashlight", x: -0.5, y: 0.05, z: 11 },
  { kind: "flashlight", x: 0.5, y: 0.05, z: 11 },
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
  ladders: [],
  killY: -10,
  dimmer: undefined,
  dock: DOCK,
  // Above the opening onto the dock.
  entrance: { x: 0, y: 2.6, z: HALF },
  screens: [],
  items: STORE_ITEMS,
  // Along the front of the store, by the dock.
  spawnPoint: (index) => ({ x: -12 + (index % 8) * 3.4, z: 13 + (index % 2) * 2 }),
  roof: undefined,
};

// The playground: one brick hall under a roof on steel beams, to try things out in, built from tiles
// (shared/tiles.ts) inside four walls. Items wait in a row along the west wall, with a dock to
// deliver to in the north-west corner; a pit with a plank across fills the east side; stairs and a
// ladder go up to a mezzanine along the north wall, and stairs on to a platform above that; stairs
// and a ladder go down to a basement under the middle, where a TV shows static; new things to look
// at stand in the south-east corner (client/src/playground.ts).
const HALL_X = 16; // half the hall's width (x) and length (z), inside the walls
const HALL_Z = 12;
const HALL_HEIGHT = 9;

/**
 * Eight cells across and six deep, on a basement, the ground and two storeys above. Each storey's
 * northern row comes first; the basement is dug out of rock, and open under the pit.
 */
const PLAYGROUND_TILES = composeTiles({
  x: -HALL_X,
  z: -HALL_Z,
  basements: 1,
  storeys: [
    ["########", "#####...", "#####...", "#F^F#...", "#TFFe###", "########"],
    ["FFFFFFFF", "FFFFFP|P", "FFF^nP|P", "FF.FFP|P", "FFFF.FFF", "FFFFFFFF"],
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
  ladders: PLAYGROUND_TILES.ladders,
  // A storey below the basement: in the pit, and nowhere else.
  killY: -STOREY - 4,
  // On the south wall, behind where players start.
  dimmer: { x: -6, y: 1.3, z: -HALL_Z, turn: 0 },
  dock: { minX: -HALL_X, maxX: -HALL_X + CELL, minZ: HALL_Z - 3, maxZ: HALL_Z },
  // The hall has no door: this is the south wall, behind where players start.
  entrance: { x: 0, y: 2.6, z: -HALL_Z },
  screens: PLAYGROUND_TILES.screens,
  items: [
    { kind: "phone", x: -14, y: 0.1, z: -9 },
    { kind: "phone", x: -14, y: 0.1, z: -8 },
    { kind: "flashlight", x: -14, y: 0.05, z: -10 },
    { kind: "flashlight", x: -13.4, y: 0.05, z: -10 },
    { kind: "box", x: -14, y: 0.6, z: -6 },
    { kind: "tv", x: -14, y: 0.5, z: -3 },
    { kind: "sofa", x: -13.5, y: 0.5, z: 1 },
    // One up on the mezzanine, to carry down the stairs.
    { kind: "box", x: -6, y: STOREY + 0.6, z: 6 },
  ],
  // In the middle of the south side, facing north.
  spawnPoint: (index) => ({ x: -3 + (index % 4) * 2, z: -10.5 + (Math.floor(index / 4) % 2) }),
  roof: HALL_HEIGHT,
};

/** How big generated levels are, in cells and storeys. */
export const GENERATED_SIZE: Omit<GenerateOptions, "seed"> = {
  cols: 8,
  rows: 6,
  storeys: 3,
  basements: 1,
};

/**
 * A level generated from a seed (shared/generate.ts): rooms on a basement, the ground and a storey
 * above, under a roof. Players come in on the south side, where the dock and the dimmer are, and
 * the items are spread over floors they can walk to.
 */
function generatedLevel(seed: number): Level {
  const generated = generate({ ...GENERATED_SIZE, seed });
  const { cols, rows, storeys, basements } = GENERATED_SIZE;
  const x = (-cols * CELL) / 2;
  const z = (-rows * CELL) / 2;
  const tiles = composeTiles({ ...generated.grid, x, z });
  const centre = (cell: { col: number; row: number }) => ({
    x: x + (cell.col + 0.5) * CELL,
    z: z + (cell.row + 0.5) * CELL,
  });
  const entrance = centre(generated.entrance);
  // The same items on the same floors every time for a seed.
  const kinds: ItemKind[] = ["flashlight", "phone", "phone", "phone", "box", "box", "tv", "sofa"];
  const others = generated.floors.filter((cell) => cell !== generated.floors[0]);
  const spots = others.filter(
    (_, i) => i % Math.max(1, Math.floor(others.length / kinds.length)) === 0,
  );
  return {
    name: `generated-${seed}`,
    size: Math.max(cols, rows) * CELL + 2,
    boxes: tiles.boxes,
    floors: tiles.floors,
    ladders: tiles.ladders,
    killY: -basements * STOREY - 4,
    dimmer: { x: entrance.x - 1.2, y: 1.3, z: z + 0.1, turn: 0 },
    dock: { minX: entrance.x - 1.5, maxX: entrance.x + 1.5, minZ: z + 0.2, maxZ: z + 1.6 },
    entrance: { x: entrance.x, y: 2.6, z },
    screens: tiles.screens,
    items: spots.slice(0, kinds.length).map((cell, i) => ({
      kind: kinds[i],
      ...centre(cell),
      y: cell.storey * STOREY + 0.6,
    })),
    spawnPoint: (index) => ({ x: entrance.x - 1 + (index % 3), z: entrance.z + 0.5 }),
    roof: (storeys - basements) * STOREY,
  };
}

/** Every level, by the name a room and `?level=` use. */
export const LEVELS = { store: STORE, playground: PLAYGROUND } satisfies Record<string, Level>;
export type LevelName = keyof typeof LEVELS;

const generatedLevels = new Map<number, Level>();

/** The level of that name, `generated-<seed>` for a generated one, else the playground. */
export function levelNamed(name: unknown): Level {
  if (Object.hasOwn(LEVELS, String(name))) return LEVELS[name as LevelName];
  const seed = /^generated-([0-9]+)$/.exec(String(name))?.[1];
  if (seed === undefined) return PLAYGROUND;
  let level = generatedLevels.get(Number(seed));
  if (!level) {
    level = generatedLevel(Number(seed));
    generatedLevels.set(Number(seed), level);
  }
  return level;
}
