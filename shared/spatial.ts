import type { Box } from "./collision";

/** Fewer things than this are just looked through, one by one. */
const FEW = 64;
/** The grid's cell size, in meters. */
const CELL = 4;
/**
 * How far around itself each thing is filed: more than a mover's radius plus how far it goes in a
 * step, so a lookup at a point finds everything a mover there could touch.
 */
const REACH = 1;

const grids = new WeakMap<readonly Box[], Map<number, Box[]>>();
const NOTHING: readonly never[] = [];

const key = (col: number, row: number) => (col + 32768) * 65536 + (row + 32768);

/**
 * The things among `all` that may be within REACH of a point: everything, for a few, else those
 * filed in the cell of a grid over them that the point is in, in the order they're in `all`. The
 * grid is made the first time and kept as long as the array is, so `all` mustn't change after.
 * The same for the same array and point every time, so movement stays a pure function.
 */
export function near<T extends Box>(all: readonly T[], x: number, z: number): readonly T[] {
  if (all.length < FEW) return all;
  let grid = grids.get(all) as Map<number, T[]> | undefined;
  if (!grid) {
    grid = new Map();
    for (const box of all) {
      const [col0, col1] = [box.minX - REACH, box.maxX + REACH].map((v) => Math.floor(v / CELL));
      const [row0, row1] = [box.minZ - REACH, box.maxZ + REACH].map((v) => Math.floor(v / CELL));
      for (let col = col0; col <= col1; col++) {
        for (let row = row0; row <= row1; row++) {
          const cell = grid.get(key(col, row));
          if (cell) cell.push(box);
          else grid.set(key(col, row), [box]);
        }
      }
    }
    grids.set(all, grid);
  }
  return grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NOTHING;
}
