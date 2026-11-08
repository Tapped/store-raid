import type { Box } from "./collision";
import type { Floor, Ladder, LevelBox } from "./level";

/**
 * Levels built from tiles: a grid of square cells on storeys stacked one above the other. Each tile
 * is one cell on one storey, and the edges between cells can have walls, with or without a doorway,
 * which is how rooms are made. `composeTiles` turns a grid into the floors, boxes and ladders of a
 * level. It's meant to be generated (shared/generate.ts): each side of a tile has a socket,
 * `fits` says which sockets can meet, and `fitsAbove` which tiles can stand on which.
 */

/** Cells are this many meters square, and storeys this far apart. */
export const CELL = 4;
export const STOREY = 3;
/** How far down a pit goes, below its storey. */
export const PIT_DEPTH = 10;
const PIT_WALL = 0.5;
/** Thickness of the ground, of any other floor, and of a plank. */
const GROUND = 0.3;
const SLAB = 0.25;
const PLANK = 0.08;
const PLANK_WIDTH = 0.6;
const RAIL_HEIGHT = 1;
const RAIL = 0.06;
/** Walls between cells: how thick, and how wide and high a doorway in one is. */
const WALL = 0.2;
const DOOR_WIDTH = 1.4;
const DOOR_HEIGHT = 2.2;
/** Stairs block in this many slices, each as high as the ramp at its lower end. */
const STAIR_SLICES = 8;
/** A ladder's width, the wall behind it, and how far out from that wall it can be climbed. */
export const LADDER_WIDTH = 0.7;
export const LADDER_WALL = 0.1;
const LADDER_REACH = 0.7;

export type Side = "n" | "e" | "s" | "w";
export const SIDES: readonly Side[] = ["n", "e", "s", "w"];
export const OPPOSITE: Record<Side, Side> = { n: "s", e: "w", s: "n", w: "e" };
/** One cell over towards a side: x is east, z is north. */
export const OFFSET: Record<Side, [number, number]> = {
  n: [0, 1],
  e: [1, 0],
  s: [0, -1],
  w: [-1, 0],
};

export type Tile =
  /** Walkable all over. */
  | { kind: "floor" }
  /** A floor with a TV on a cabinet against a wall, showing static and droning (client/src/screens.ts). */
  | { kind: "tv" }
  /** Rock, or masonry: filled from its floor to the next. Basements are dug out of it. */
  | { kind: "solid" }
  /** A hole down to `PIT_DEPTH`, with shafts under it: falling in kills. */
  | { kind: "pit" }
  /** A pit with a plank across it, from one side to the other along an axis. */
  | { kind: "bridge"; along: "x" | "z" }
  /** Stairs up one storey, rising towards a side, into a well above. Stairs going down are stairs on the storey below. */
  | { kind: "stairs"; up: Side }
  /** A floor with a ladder up a wall on one side, into a well above. */
  | { kind: "ladder"; up: Side }
  /** Nothing: air above a lower storey. */
  | { kind: "open" }
  /** The air above stairs or a ladder, opening onto the floor they arrive on, towards `from`. */
  | { kind: "well"; from: Side }
  /** The air under a pit, walled in by it, down to the pit's bottom. */
  | { kind: "shaft" };

/**
 * How each tile is written in a grid. Wells and shafts are written as open air, "."; which they are
 * follows from what's above and below.
 */
export const TILE_CHARS: Record<string, Tile> = {
  F: { kind: "floor" },
  T: { kind: "tv" },
  "#": { kind: "solid" },
  P: { kind: "pit" },
  "|": { kind: "bridge", along: "z" },
  "=": { kind: "bridge", along: "x" },
  "^": { kind: "stairs", up: "n" },
  ">": { kind: "stairs", up: "e" },
  v: { kind: "stairs", up: "s" },
  "<": { kind: "stairs", up: "w" },
  n: { kind: "ladder", up: "n" },
  e: { kind: "ladder", up: "e" },
  s: { kind: "ladder", up: "s" },
  w: { kind: "ladder", up: "w" },
  ".": { kind: "open" },
};

/** The character a tile is written as. */
export function tileChar(tile: Tile): string {
  if (tile.kind === "open" || tile.kind === "well" || tile.kind === "shaft") return ".";
  for (const [char, candidate] of Object.entries(TILE_CHARS)) {
    if (JSON.stringify(candidate) === JSON.stringify(tile)) return char;
  }
  throw new Error(`No character for ${JSON.stringify(tile)}`);
}

/** What a tile's side offers its neighbour on the same storey. */
export type Socket =
  | "floor"
  | "solid"
  | "pit"
  | "plank"
  | "stairs-foot"
  | "stairs-top"
  | "stairs-side"
  | "ladder-wall"
  | "arrival"
  | "open";

export function socket(tile: Tile, side: Side): Socket {
  switch (tile.kind) {
    case "floor":
    case "solid":
    case "pit":
    case "open":
      return tile.kind;
    case "tv":
      return "floor";
    case "shaft":
      return "solid";
    case "bridge":
      return (tile.along === "z") === (side === "n" || side === "s") ? "plank" : "pit";
    case "stairs":
      if (side === tile.up) return "stairs-top";
      return side === OPPOSITE[tile.up] ? "stairs-foot" : "stairs-side";
    case "ladder":
      return side === tile.up ? "ladder-wall" : "floor";
    case "well":
      return side === tile.from ? "arrival" : "open";
  }
}

/**
 * Which sockets can meet, either way round. Floors get a railing where they meet open air, and
 * anything can back onto solid rock but what must lead on: a plank, the foot of the stairs, and
 * where stairs or a ladder arrive.
 */
const FITS: Record<Socket, readonly Socket[]> = {
  floor: [
    "floor",
    "solid",
    "pit",
    "plank",
    "stairs-foot",
    "stairs-top",
    "stairs-side",
    "ladder-wall",
    "arrival",
    "open",
  ],
  solid: ["floor", "solid", "pit", "stairs-top", "stairs-side", "ladder-wall", "open"],
  pit: ["floor", "solid", "pit", "stairs-side", "stairs-top", "ladder-wall"],
  plank: ["floor", "plank"],
  "stairs-foot": ["floor"],
  "stairs-top": ["floor", "solid", "pit", "stairs-side", "ladder-wall", "open"],
  "stairs-side": ["floor", "solid", "pit", "stairs-side", "stairs-top", "ladder-wall", "open"],
  "ladder-wall": ["floor", "solid", "pit", "stairs-side", "stairs-top", "ladder-wall", "open"],
  arrival: ["floor"],
  open: ["floor", "solid", "stairs-side", "stairs-top", "ladder-wall", "open"],
};

export function fits(a: Socket, b: Socket): boolean {
  return FITS[a].includes(b);
}

/** Sockets that can be walked through, so a doorway can open onto them. */
const PASSABLE: readonly Socket[] = ["floor", "plank", "stairs-foot", "arrival"];
/** Sockets a wall can't close off. */
const MUST_LEAD_ON: readonly Socket[] = ["plank", "stairs-foot", "arrival"];

const OPEN: Tile = { kind: "open" };

/**
 * Whether `upper` can stand right on top of `lower`: stairs and ladders lead into a well, and pits
 * go down through shafts. Outside the grid, above is open air and below is nothing.
 */
export function fitsAbove(lower: Tile | undefined, upper: Tile | undefined): boolean {
  const climbs = lower?.kind === "stairs" || lower?.kind === "ladder";
  if (climbs) return upper?.kind === "well" && upper.from === lower.up;
  if (upper?.kind === "well") return false;
  const holed = upper?.kind === "pit" || upper?.kind === "bridge" || upper?.kind === "shaft";
  if (lower?.kind === "shaft") return holed;
  // A hole only goes down through shafts, to the bottom of the grid.
  if (holed) return lower === undefined;
  // Nothing below: only what holds itself up, or the bottom of a pit.
  if (lower === undefined) return upper?.kind !== "open";
  return true;
}

/** What's on the edge between two cells on a storey: nothing, a wall, or a wall with a doorway. */
export type Edge = "none" | "wall" | "door";

/**
 * A grid of tiles: the cell in the south-west corner starts at (x, z), and each storey is a list of
 * rows, the northern row first, as on a map. The first storey is the deepest: `basements` storeys
 * lie below the ground, which is storey 0. Storeys above the last given are open air.
 *
 * A storey is written one character per cell, or with its walls drawn in between, every cell
 * surrounded by `+` corners and edges that are `-` or `|` for a wall, `d` for a doorway, or a space
 * for nothing. Walls round the outside of such a storey enclose it.
 */
export interface TileGrid {
  x: number;
  z: number;
  basements?: number;
  storeys: string[][];
}

/** A grid read into tiles and edges, with wells and shafts worked out. */
export interface ParsedGrid {
  cols: number;
  rows: number;
  basements: number;
  /** tiles[storey + basements][row][col], row 0 the southernmost. */
  tiles: Tile[][][];
  /** The edge on a side of a cell, which may be on the outside of the grid. */
  edge(storey: number, col: number, row: number, side: Side): Edge;
  tile(storey: number, col: number, row: number): Tile | undefined;
}

export function parseTiles(grid: TileGrid): ParsedGrid {
  const basements = grid.basements ?? 0;
  const drawn = (lines: string[]) => lines[0]?.startsWith("+") ?? false;
  const ground = grid.storeys[basements];
  const rows = drawn(ground) ? (ground.length - 1) / 2 : ground.length;
  const cols = drawn(ground) ? (ground[0].length - 1) / 2 : ground[0].length;
  const edges = new Map<string, Edge>();
  // Each edge once, by the cell to its south or west.
  const edgeKey = (storey: number, col: number, row: number, side: Side) => {
    if (side === "s") return `${storey},${col},${row - 1},n`;
    if (side === "w") return `${storey},${col - 1},${row},e`;
    return `${storey},${col},${row},${side}`;
  };

  const tiles: Tile[][][] = grid.storeys.map((lines, index) => {
    const storey = index - basements;
    const isDrawn = drawn(lines);
    return Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const line = isDrawn ? lines[2 * (rows - 1 - row) + 1] : lines[rows - 1 - row];
        if (line === undefined) return OPEN;
        const char = isDrawn ? line[2 * col + 1] : line[col];
        if (isDrawn) {
          const mark = (side: Side, value: string | undefined) => {
            const edge: Edge =
              value === "d" ? "door" : value === "-" || value === "|" ? "wall" : "none";
            if (edge !== "none") edges.set(edgeKey(storey, col, row, side), edge);
          };
          const above = lines[2 * (rows - 1 - row)];
          const below = lines[2 * (rows - 1 - row) + 2];
          mark("n", above?.[2 * col + 1]);
          mark("s", below?.[2 * col + 1]);
          mark("w", line[2 * col]);
          mark("e", line[2 * col + 2]);
        }
        const tile = TILE_CHARS[char ?? "."];
        if (!tile) throw new Error(`Unknown tile "${char}" on storey ${storey}`);
        return tile;
      }),
    );
  });
  const at = (storey: number, col: number, row: number) => tiles[storey + basements]?.[row]?.[col];

  // Open air above stairs or a ladder is its well; under a pit, a shaft.
  for (let storey = tiles.length - 1 - basements; storey >= -basements; storey--) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (at(storey, col, row)?.kind !== "open") continue;
        const below = at(storey - 1, col, row);
        const above = at(storey + 1, col, row);
        const cell = tiles[storey + basements][row];
        if (below?.kind === "stairs" || below?.kind === "ladder") {
          cell[col] = { kind: "well", from: below.up };
        } else if (above?.kind === "pit" || above?.kind === "bridge" || above?.kind === "shaft") {
          cell[col] = { kind: "shaft" };
        }
      }
    }
  }

  return {
    cols,
    rows,
    basements,
    tiles,
    tile: (storey, col, row) => {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return undefined;
      if (storey < -basements) return undefined;
      return at(storey, col, row) ?? OPEN;
    },
    edge: (storey, col, row, side) => edges.get(edgeKey(storey, col, row, side)) ?? "none",
  };
}

/** Why a grid's tiles don't fit together, or undefined if they do. */
export function checkTiles(grid: ParsedGrid): string | undefined {
  const { cols, rows, basements } = grid;
  for (let storey = -basements; storey < grid.tiles.length - basements; storey++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = grid.tile(storey, col, row) as Tile;
        const where = `${tile.kind} at storey ${storey}, column ${col}, row ${row}`;
        if (!fitsAbove(grid.tile(storey - 1, col, row), tile)) {
          return `${where} can't stand on ${grid.tile(storey - 1, col, row)?.kind ?? "nothing"}`;
        }
        const above = grid.tile(storey + 1, col, row) ?? OPEN;
        if (!fitsAbove(tile, above)) return `${where} can't have ${above.kind} above it`;
        for (const side of SIDES) {
          const mine = socket(tile, side);
          const edge = grid.edge(storey, col, row, side);
          const next = grid.tile(storey, col + OFFSET[side][0], row + OFFSET[side][1]);
          if (edge === "wall" && MUST_LEAD_ON.includes(mine))
            return `${where}: a wall closes off its ${side} side`;
          if (edge === "door" && !PASSABLE.includes(mine))
            return `${where}: a doorway on its ${side} side leads nowhere`;
          // Across a wall, anything goes but what must lead on.
          if (!next || edge === "wall") continue;
          const theirs = socket(next, OPPOSITE[side]);
          if (!fits(mine, theirs)) return `${where}: its ${side} side can't meet ${next.kind}`;
        }
      }
    }
  }
  return undefined;
}

/** A TV a tile stands somewhere: the middle of the floor under it, and the side its screen faces. */
export interface Screen {
  x: number;
  y: number;
  z: number;
  faces: Side;
}

/** The cabinet a TV stands on, and the TV on it: wide, deep and high, in all. */
export const SCREEN_CABINET = { width: 1.4, depth: 0.45, height: 0.5 };
const SCREEN_HEIGHT = 1.3;

/** The floors, boxes, ladders and TVs of a grid of tiles; throws if the tiles don't fit together. */
export function composeTiles(source: TileGrid): {
  floors: Floor[];
  boxes: LevelBox[];
  ladders: Ladder[];
  screens: Screen[];
} {
  const grid = parseTiles(source);
  const problem = checkTiles(grid);
  if (problem) throw new Error(problem);
  const { cols, rows, basements } = grid;
  const floors: Floor[] = [];
  const boxes: LevelBox[] = [];
  const ladders: Ladder[] = [];
  const screens: Screen[] = [];

  for (let storey = -basements; storey < grid.tiles.length - basements; storey++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = grid.tile(storey, col, row) as Tile;
        const cell: Box = {
          minX: source.x + col * CELL,
          maxX: source.x + (col + 1) * CELL,
          minZ: source.z + row * CELL,
          maxZ: source.z + (row + 1) * CELL,
        };
        const base = storey * STOREY;
        const neighbour = (side: Side) =>
          grid.tile(storey, col + OFFSET[side][0], row + OFFSET[side][1]);
        const thickness = storey === 0 ? GROUND : SLAB;
        // Up to the underside of whatever floor is above, or on the top storey right up to the
        // roof, which a hall puts there, with no floor above to fill the gap.
        const top = storey === grid.tiles.length - basements - 1;
        const ceiling = top ? STOREY : STOREY - SLAB;

        // Walls on the north and east edges, and the south and west ones on the grid's edge, so each
        // edge is built once.
        for (const side of SIDES) {
          const outer = !neighbour(side);
          if (!outer && (side === "s" || side === "w")) continue;
          const edge = grid.edge(storey, col, row, side);
          // Brick round the outside, plaster between rooms.
          const kind = outer ? "wall" : "partition";
          if (edge !== "none") {
            boxes.push(...wallBoxes(cell, side, base, ceiling, edge === "door", kind));
          }
        }

        switch (tile.kind) {
          case "floor":
          case "tv":
          case "ladder": {
            floors.push({ ...cell, y: base, thickness, kind: "floor" });
            // A railing where it meets open air, unless a wall is there already.
            for (const side of SIDES) {
              const next = neighbour(side);
              if (!next || socket(next, OPPOSITE[side]) !== "open") continue;
              if (grid.edge(storey, col, row, side) !== "none") continue;
              boxes.push({ ...edge(cell, side, RAIL), y: base, height: RAIL_HEIGHT, kind: "rail" });
            }
            if (tile.kind === "floor") break;
            if (tile.kind === "tv") {
              const screen = placeScreen(cell, base, (side) => {
                const next = neighbour(side);
                return (
                  !next || next.kind === "solid" || grid.edge(storey, col, row, side) === "wall"
                );
              });
              screens.push(screen);
              boxes.push({
                ...screenFootprint(screen),
                y: base,
                height: SCREEN_HEIGHT,
                kind: "furniture",
              });
              break;
            }
            // The wall it stands against, up to the floor it leads to: climbers press against it.
            const wall = edge(cell, tile.up, LADDER_WALL);
            boxes.push({ ...wall, y: base, height: STOREY, kind: "wall" });
            // Where it can be climbed: in front of it, as wide as it is and a little more.
            const [dx] = OFFSET[tile.up];
            const middle = { x: (cell.minX + cell.maxX) / 2, z: (cell.minZ + cell.maxZ) / 2 };
            const across = LADDER_WIDTH / 2 + 0.1;
            const reach = edge(cell, tile.up, LADDER_WALL + LADDER_REACH);
            ladders.push({
              ...(dx
                ? { ...reach, minZ: middle.z - across, maxZ: middle.z + across }
                : { ...reach, minX: middle.x - across, maxX: middle.x + across }),
              y: base,
              top: base + STOREY,
              toward: tile.up,
            });
            break;
          }
          case "solid":
            boxes.push({ ...cell, y: base, height: ceiling, kind: "wall" });
            break;
          case "pit":
          case "bridge": {
            // Walls round the hole, under the floors next to it, so nobody walks under them.
            for (const side of SIDES) {
              const next = neighbour(side);
              if (next?.kind === "pit" || next?.kind === "bridge") continue;
              const wall = outside(cell, side, PIT_WALL);
              boxes.push({ ...wall, y: base - PIT_DEPTH, height: PIT_DEPTH, kind: "pit" });
            }
            if (tile.kind === "bridge") {
              const middle =
                tile.along === "z" ? (cell.minX + cell.maxX) / 2 : (cell.minZ + cell.maxZ) / 2;
              const across = [middle - PLANK_WIDTH / 2, middle + PLANK_WIDTH / 2];
              const plank =
                tile.along === "z"
                  ? { ...cell, minX: across[0], maxX: across[1] }
                  : { ...cell, minZ: across[0], maxZ: across[1] };
              floors.push({ ...plank, y: base, thickness: PLANK, kind: "plank" });
            }
            break;
          }
          case "stairs": {
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
          case "well":
          case "shaft":
            break;
        }
      }
    }
  }
  return { floors, boxes, ladders, screens };
}

/**
 * Where a TV stands in its cell: its back to the first side with a wall, or rock, behind it, facing
 * away; with none, in the middle, facing south. Never against a doorway.
 */
function placeScreen(cell: Box, y: number, walled: (side: Side) => boolean): Screen {
  const middle = { x: (cell.minX + cell.maxX) / 2, z: (cell.minZ + cell.maxZ) / 2 };
  const back = SIDES.find(walled);
  if (!back) return { ...middle, y, faces: "s" };
  const [dx, dz] = OFFSET[back];
  const away = CELL / 2 - WALL / 2 - SCREEN_CABINET.depth / 2 - 0.05;
  return { x: middle.x + dx * away, y, z: middle.z + dz * away, faces: OPPOSITE[back] };
}

/** The ground a TV's cabinet stands on. */
function screenFootprint({ x, z, faces }: Screen): Box {
  const alongX = faces === "n" || faces === "s";
  const [halfX, halfZ] = alongX
    ? [SCREEN_CABINET.width / 2, SCREEN_CABINET.depth / 2]
    : [SCREEN_CABINET.depth / 2, SCREEN_CABINET.width / 2];
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

/** A wall along one side of a cell, astride the edge, with a doorway in the middle if asked. */
function wallBoxes(
  cell: Box,
  side: Side,
  y: number,
  height: number,
  door: boolean,
  kind: "wall" | "partition",
): LevelBox[] {
  const alongX = side === "n" || side === "s";
  const line = { n: cell.maxZ, s: cell.minZ, e: cell.maxX, w: cell.minX }[side];
  const [start, end] = alongX ? [cell.minX, cell.maxX] : [cell.minZ, cell.maxZ];
  const span = (from: number, to: number, bottom: number, top: number): LevelBox =>
    alongX
      ? {
          minX: from,
          maxX: to,
          minZ: line - WALL / 2,
          maxZ: line + WALL / 2,
          y: bottom,
          height: top - bottom,
          kind,
        }
      : {
          minX: line - WALL / 2,
          maxX: line + WALL / 2,
          minZ: from,
          maxZ: to,
          y: bottom,
          height: top - bottom,
          kind,
        };
  if (!door) return [span(start, end, y, y + height)];
  const middle = (start + end) / 2;
  return [
    span(start, middle - DOOR_WIDTH / 2, y, y + height),
    span(middle + DOOR_WIDTH / 2, end, y, y + height),
    // Over the doorway, out of everyone's way.
    span(middle - DOOR_WIDTH / 2, middle + DOOR_WIDTH / 2, y + DOOR_HEIGHT, y + height),
  ];
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
