import type { Box } from "./collision";
import { ARENA_SIZE } from "./constants";

const HALF = ARENA_SIZE / 2;
const WALL = 1;

/**
 * Static level geometry, used by the server for collision and by the client for rendering.
 * Boxes are axis-aligned on the ground plane (x/z); `height` is visual only.
 */
export const LEVEL_BOXES: (Box & { height: number })[] = [
  // Outer walls
  { minX: -HALF - WALL, maxX: HALF + WALL, minZ: HALF, maxZ: HALF + WALL, height: 2 },
  { minX: -HALF - WALL, maxX: HALF + WALL, minZ: -HALF - WALL, maxZ: -HALF, height: 2 },
  { minX: HALF, maxX: HALF + WALL, minZ: -HALF, maxZ: HALF, height: 2 },
  { minX: -HALF - WALL, maxX: -HALF, minZ: -HALF, maxZ: HALF, height: 2 },
  // Pillars
  { minX: -9, maxX: -7, minZ: -9, maxZ: -7, height: 3 },
  { minX: 7, maxX: 9, minZ: -9, maxZ: -7, height: 3 },
  { minX: -9, maxX: -7, minZ: 7, maxZ: 9, height: 3 },
  { minX: 7, maxX: 9, minZ: 7, maxZ: 9, height: 3 },
  // Centre block
  { minX: -2, maxX: 2, minZ: -1, maxZ: 1, height: 1.5 },
];

/** Spawn points on a ring around the centre block. */
export function spawnPoint(index: number): { x: number; z: number } {
  const angle = index * 2.399963; // golden angle — never two spawns on top of each other
  const radius = 5 + (index % 3) * 3;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
