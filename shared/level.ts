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

/** Where finished items go. An item whose centre is in here counts as delivered. */
export const DOCK: Box = { minX: -DOOR, maxX: DOOR, minZ: HALF, maxZ: HALF + DOCK_DEPTH };

/**
 * Static level geometry, used by the server for collision and by the client for rendering.
 * Boxes are axis-aligned on the ground plane (x/z); `height` is how far up they block physics.
 */
export const LEVEL_BOXES: (Box & { height: number; kind: "wall" | "shelf" })[] = [
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

/** Where items start, just off the ground, so they settle when a room opens. */
export const ITEM_SPAWNS: { kind: ItemKind; x: number; y: number; z: number }[] = [
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

/** Spawn points along the front of the store, by the dock. */
export function spawnPoint(index: number): { x: number; z: number } {
  return { x: -12 + (index % 8) * 3.4, z: 13 + (index % 2) * 2 };
}
