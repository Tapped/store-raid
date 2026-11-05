import type { Box } from "./collision";
import type { Floor, LevelBox } from "./level";

/**
 * Levels built from tiles: a grid of square cells on storeys stacked one above the other. Each tile
 * is one cell on one storey, written as a character, and `composeTiles` turns a grid of them into
 * the floors and boxes a level is made of. They're meant to be generated later by wave function
 * collapse: each side of a tile has a socket (`socket`), and `fits` says which sockets can meet.
 */

/** Cells are this many meters square, and storeys this far apart. */
export const CELL = 4;
export const STOREY = 3;
/** How far down a pit goes. */
export const PIT_DEPTH = 10;
const PIT_WALL = 0.5;
/** Thickness of the ground, of an upper floor, and of a plank. */
const GROUND = 0.3;
const SLAB = 0.25;
const PLANK = 0.08;
const PLANK_WIDTH = 0.6;
const RAIL_HEIGHT = 1;
const RAIL = 0.06;
/** Stairs block in this many slices, each as high as the ramp at its lower end. */
const STAIR_SLICES = 8;

export type Side = "n" | "e" | "s" | "w";
export const SIDES: readonly Side[] = ["n", "e", "s", "w"];
export const OPPOSITE: Record<Side, Side> = { n: "s", e: "w", s: "n", w: "e" };
/** One cell over towards a side: x is east, z is north. */
const OFFSET: Record<Side, [number, number]> = { n: [0, 1], e: [1, 0], s: [0, -1], w: [-1, 0] };

export type Tile =
  /** Walkable all over. */
  | { kind: "floor" }
  /** A hole down to `PIT_DEPTH`, the ground storey only: falling in kills. */
  | { kind: "pit" }
  /** A pit with a plank across it, from one side to the other along an axis. */
  | { kind: "bridge"; along: "x" | "z" }
  /** Stairs up one storey, rising towards a side. The cell above must be open, and the next cell on the storey above, beyond the top, a floor. */
  | { kind: "stairs"; up: Side }
  /** Nothing: air above a lower storey. */
  | { kind: "open" };

/** How each tile is written in a grid. */
export const TILE_CHARS: Record<string, Tile> = {
  F: { kind: "floor" },
  P: { kind: "pit" },
  "|": { kind: "bridge", along: "z" },
  "=": { kind: "bridge", along: "x" },
  "^": { kind: "stairs", up: "n" },
  ">": { kind: "stairs", up: "e" },
  v: { kind: "stairs", up: "s" },
  "<": { kind: "stairs", up: "w" },
  ".": { kind: "open" },
};

/** What a tile's side offers its neighbour on the same storey. */
export type Socket =
  | "floor"
  | "pit"
  | "plank"
  | "stairs-foot"
  | "stairs-top"
  | "stairs-side"
  | "open";

export function socket(tile: Tile, side: Side): Socket {
  switch (tile.kind) {
    case "floor":
    case "pit":
    case "open":
      return tile.kind;
    case "bridge":
      return (tile.along === "z") === (side === "n" || side === "s") ? "plank" : "pit";
    case "stairs":
      if (side === tile.up) return "stairs-top";
      return side === OPPOSITE[tile.up] ? "stairs-foot" : "stairs-side";
  }
}

/** Which sockets can meet, either way round. Upper floors get a railing where they meet open air. */
const FITS: Record<Socket, readonly Socket[]> = {
  floor: ["floor", "pit", "plank", "stairs-foot", "stairs-top", "stairs-side", "open"],
  pit: ["floor", "pit", "stairs-side", "stairs-top"],
  plank: ["floor", "plank"],
  "stairs-foot": ["floor"],
  "stairs-top": ["floor", "pit", "stairs-side", "open"],
  "stairs-side": ["floor", "pit", "stairs-side", "stairs-top", "open"],
  open: ["floor", "stairs-side", "stairs-top", "open"],
};

export function fits(a: Socket, b: Socket): boolean {
  return FITS[a].includes(b);
}

/**
 * A grid of tiles: the cell in the south-west corner starts at (x, z), and each storey is a list of
 * rows of tile characters, the northern row first, as on a map. Storey 0 is the ground.
 */
export interface TileGrid {
  x: number;
  z: number;
  storeys: string[][];
}

/** The floors and boxes of a grid of tiles, after checking the tiles fit together. */
export function composeTiles(grid: TileGrid): { floors: Floor[]; boxes: LevelBox[] } {
  const rows = grid.storeys[0].length;
  const cols = grid.storeys[0][0].length;
  const tileAt = (storey: number, col: number, row: number): Tile | undefined => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return undefined;
    const line = grid.storeys[storey]?.[rows - 1 - row];
    if (!line) return storey > 0 ? TILE_CHARS["."] : undefined;
    const tile = TILE_CHARS[line[col]];
    if (!tile) throw new Error(`Unknown tile "${line[col]}" on storey ${storey}`);
    return tile;
  };
  const floors: Floor[] = [];
  const boxes: LevelBox[] = [];

  for (let storey = 0; storey < grid.storeys.length; storey++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = tileAt(storey, col, row) as Tile;
        const where = `${tile.kind} at storey ${storey}, column ${col}, row ${row}`;
        const cell: Box = {
          minX: grid.x + col * CELL,
          maxX: grid.x + (col + 1) * CELL,
          minZ: grid.z + row * CELL,
          maxZ: grid.z + (row + 1) * CELL,
        };
        const base = storey * STOREY;
        const neighbour = (side: Side, up = 0) =>
          tileAt(storey + up, col + OFFSET[side][0], row + OFFSET[side][1]);

        for (const side of SIDES) {
          const next = neighbour(side);
          if (next && !fits(socket(tile, side), socket(next, OPPOSITE[side]))) {
            throw new Error(`${where}: its ${side} side can't meet ${next.kind}`);
          }
        }

        switch (tile.kind) {
          case "floor": {
            floors.push({ ...cell, y: base, thickness: storey ? SLAB : GROUND, kind: "floor" });
            if (storey === 0) break;
            // A railing where it meets open air, except where stairs come up.
            for (const side of SIDES) {
              if (neighbour(side)?.kind !== "open") continue;
              const below = neighbour(side, -1);
              if (below?.kind === "stairs" && below.up === OPPOSITE[side]) continue;
              boxes.push({ ...edge(cell, side, RAIL), y: base, height: RAIL_HEIGHT, kind: "rail" });
            }
            break;
          }
          case "pit":
          case "bridge": {
            if (storey > 0) throw new Error(`${where}: pits only go in the ground`);
            // Walls round the hole, under the floors next to it, so nobody walks under them.
            for (const side of SIDES) {
              const next = neighbour(side);
              if (next?.kind === "pit" || next?.kind === "bridge") continue;
              const wall = outside(cell, side, PIT_WALL);
              boxes.push({ ...wall, y: -PIT_DEPTH, height: PIT_DEPTH, kind: "pit" });
            }
            if (tile.kind === "bridge") {
              const middle =
                tile.along === "z" ? (cell.minX + cell.maxX) / 2 : (cell.minZ + cell.maxZ) / 2;
              const across = [middle - PLANK_WIDTH / 2, middle + PLANK_WIDTH / 2];
              const plank =
                tile.along === "z"
                  ? { ...cell, minX: across[0], maxX: across[1] }
                  : { ...cell, minZ: across[0], maxZ: across[1] };
              floors.push({ ...plank, y: 0, thickness: PLANK, kind: "plank" });
            }
            break;
          }
          case "stairs": {
            const above = tileAt(storey + 1, col, row);
            if (above?.kind !== "open") throw new Error(`${where}: the cell above must be open`);
            const top = neighbour(tile.up, 1);
            if (top?.kind !== "floor") {
              throw new Error(
                `${where}: there must be a floor on storey ${storey + 1} beyond its top`,
              );
            }
            floors.push({
              ...cell,
              y: base,
              thickness: SLAB,
              kind: "stairs",
              rise: { toward: tile.up, height: STOREY },
            });
            // Solid underneath, in slices that each reach the ramp's lower end, so nobody walks
            // into it from below but they can walk up it.
            for (let i = 0; i < STAIR_SLICES; i++) {
              const slice = sliceOf(cell, tile.up, i / STAIR_SLICES, (i + 1) / STAIR_SLICES);
              if (i > 0) {
                boxes.push({
                  ...slice,
                  y: base,
                  height: (STOREY * i) / STAIR_SLICES,
                  kind: "stairs",
                });
              }
              // Railings up both sides, reaching above the ramp at the slice's upper end.
              const height = (STOREY * (i + 1)) / STAIR_SLICES + RAIL_HEIGHT;
              for (const side of SIDES) {
                if (side === tile.up || side === OPPOSITE[tile.up]) continue;
                boxes.push({ ...edge(slice, side, RAIL), y: base, height, kind: "stairs" });
              }
            }
            break;
          }
          case "open":
            if (storey === 0)
              throw new Error(`${where}: the ground storey can't be open; use a pit`);
            break;
        }
      }
    }
  }
  return { floors, boxes };
}

/** The strip of a box this thick along one of its sides, inside it. */
function edge(box: Box, side: Side, thickness: number): Box {
  switch (side) {
    case "n":
      return { ...box, minZ: box.maxZ - thickness };
    case "s":
      return { ...box, maxZ: box.minZ + thickness };
    case "e":
      return { ...box, minX: box.maxX - thickness };
    case "w":
      return { ...box, maxX: box.minX + thickness };
  }
}

/** A box this deep just outside one side of another. */
function outside(box: Box, side: Side, depth: number): Box {
  const [dx, dz] = OFFSET[side];
  const width = box.maxX - box.minX;
  const length = box.maxZ - box.minZ;
  const moved = {
    minX: box.minX + dx * width,
    maxX: box.maxX + dx * width,
    minZ: box.minZ + dz * length,
    maxZ: box.maxZ + dz * length,
  };
  return edge(moved, OPPOSITE[side], depth);
}

/** The part of a box between two fractions of the way towards a side. */
function sliceOf(box: Box, toward: Side, from: number, to: number): Box {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  switch (toward) {
    case "n":
      return { ...box, minZ: lerp(box.minZ, box.maxZ, from), maxZ: lerp(box.minZ, box.maxZ, to) };
    case "s":
      return { ...box, minZ: lerp(box.maxZ, box.minZ, to), maxZ: lerp(box.maxZ, box.minZ, from) };
    case "e":
      return { ...box, minX: lerp(box.minX, box.maxX, from), maxX: lerp(box.minX, box.maxX, to) };
    case "w":
      return { ...box, minX: lerp(box.maxX, box.minX, to), maxX: lerp(box.maxX, box.minX, from) };
  }
}
