import type { RoomKind } from "./level";
import {
  checkTiles,
  type Edge,
  fits,
  fitsAbove,
  isOpening,
  OFFSET,
  OPPOSITE,
  parseTiles,
  SIDES,
  type Side,
  type Socket,
  socket,
  type Tile,
  type TileGrid,
  tileChar,
} from "./tiles";

/**
 * Levels generated from a seed, in two layers. First the layout: each storey of the building is
 * split into rooms that each have a kind (a loading bay at the entrance, big storage halls behind
 * it with bonded cages in their corners, storerooms and workshops at the back, offices and staff
 * rooms upstairs, plant rooms in the basement, corridors, and atriums open to the storey below),
 * walled off from each other, with doorways and arches joining
 * them all up and stairs or ladders between the storeys. Then the tiles, by wave function collapse:
 * every cell gets the tile that fits its neighbours, the walls and doorways between them, what's
 * above and below it, and what its room is for. Anything that can't be reached from the entrance is
 * filled in or taken away, and the result is a `TileGrid` like a hand-written one, with the rooms
 * and how far each cell is from the entrance. What stands in the rooms is the next layer's
 * (shared/furnish.ts).
 *
 * Pure: the same options give the same level on the server and every client.
 */

export interface GenerateOptions {
  seed: number;
  cols: number;
  rows: number;
  /** Storeys in all, of which the first `basements` are below the ground. */
  storeys: number;
  basements: number;
}

/** A cell of a generated grid. */
export interface Cell {
  storey: number;
  col: number;
  row: number;
}

/** A room as the layout made it: its kind, its storey, and the cells it still has that aren't rock. */
export interface GeneratedRoom {
  kind: RoomKind;
  storey: number;
  cells: { col: number; row: number }[];
}

export interface Generated {
  grid: Omit<TileGrid, "x" | "z">;
  /** Where players come in: a floor on the ground storey, on the southern edge. */
  entrance: Cell;
  /** Every floor that can be walked to from the entrance, for putting things on. */
  floors: Cell[];
  rooms: GeneratedRoom[];
  /** The room a cell is in, an index into `rooms`, or -1 for rock and anything outside them. */
  roomAt(cell: Cell): number;
  /**
   * How far a cell is from the entrance, walking, in cells (climbing a storey counts as two), or
   * undefined if it can't be walked to.
   */
  distance(cell: Cell): number | undefined;
  /** How many tries it took: a try fails when the tiles can't be made to fit. */
  attempts: number;
}

const MAX_ATTEMPTS = 50;

/** Every tile there is. */
const VARIANTS: Tile[] = [
  { kind: "floor" },
  { kind: "tv" },
  { kind: "solid" },
  { kind: "pit" },
  { kind: "bridge", along: "x" },
  { kind: "bridge", along: "z" },
  ...SIDES.map((up): Tile => ({ kind: "stairs", up })),
  ...SIDES.map((up): Tile => ({ kind: "ladder", up })),
  { kind: "open" },
  ...SIDES.map((from): Tile => ({ kind: "well", from })),
  { kind: "shaft" },
];
const COUNT = VARIANTS.length;
/** Tiles there's only one of in a level: once a cell has one, no other cell can. */
const ONLY_ONE = VARIANTS.flatMap((tile, v) => (tile.kind === "tv" ? [v] : []));

/**
 * What a room in the layout is for: a kind of room, or rock, which is left solid (the parts of a
 * basement nobody dug out).
 */
type LayoutKind = RoomKind | "rock";

/**
 * How likely each tile is in a room of each kind, wherever it fits. Stairs, ladders and bridges are
 * per way they face. Wells and shafts go wherever stairs, ladders or pits need them, and open air
 * only in atriums. Pits can only be dug where there's a basement under them to go down through.
 */
const WEIGHTS: Record<LayoutKind, Partial<Record<Tile["kind"], number>>> = {
  entrance: { floor: 1 },
  hall: { floor: 16, tv: 0.3, solid: 0.1, pit: 0.08, bridge: 0.03, stairs: 0.03, ladder: 0.01 },
  cage: { floor: 1 },
  workshop: { floor: 10, tv: 0.3, solid: 0.1, ladder: 0.03 },
  stock: { floor: 10, solid: 0.6, pit: 0.5, bridge: 0.25, stairs: 0.06, ladder: 0.06 },
  office: { floor: 10, tv: 0.4, solid: 0.1, stairs: 0.01, ladder: 0.03 },
  staff: { floor: 10, tv: 0.7, solid: 0.1, ladder: 0.03 },
  plant: { floor: 8, solid: 0.9, pit: 0.6, bridge: 0.3, stairs: 0.04, ladder: 0.08 },
  corridor: { floor: 12, stairs: 0.02, ladder: 0.04 },
  atrium: { open: 1 },
  rock: { solid: 1 },
};

/** Sockets a doorway can open onto, and those a wall can't close off; as in shared/tiles.ts. */
const PASSABLE: readonly Socket[] = ["floor", "plank", "stairs-foot", "arrival"];
const MUST_LEAD_ON: readonly Socket[] = ["plank", "stairs-foot", "arrival"];
/** Sockets that can be walked across into the next cell on the same storey. */
const WALKS: readonly Socket[] = ["floor", "plank", "stairs-foot"];

const airy = (tile: Tile) => tile.kind === "open" || tile.kind === "well" || tile.kind === "shaft";

/** Whether tile `a` can have tile `b` next to it, towards `side`, across an edge. */
function besides(a: Tile, b: Tile, side: Side, edge: Edge): boolean {
  const mine = socket(a, side);
  const theirs = socket(b, OPPOSITE[side]);
  if (edge === "wall") {
    // A wall closes off what's on either side, but has to stand on something.
    return !MUST_LEAD_ON.includes(mine) && !MUST_LEAD_ON.includes(theirs) && !(airy(a) && airy(b));
  }
  if (isOpening(edge) && !(PASSABLE.includes(mine) && PASSABLE.includes(theirs))) return false;
  return fits(mine, theirs);
}

/**
 * Which tiles each tile allows next to it, as bits: towards each side across no wall, a wall or an
 * opening (index side × 3 + edge), then above it (12) and below it (13).
 */
const ALLOWS: number[][] = [
  ...SIDES.flatMap((side) =>
    (["none", "wall", "door"] as const).map((edge) =>
      VARIANTS.map((mine) =>
        VARIANTS.reduce(
          (bits, theirs, t) => (besides(mine, theirs, side, edge) ? bits | (1 << t) : bits),
          0,
        ),
      ),
    ),
  ),
  VARIANTS.map((mine) =>
    VARIANTS.reduce((bits, theirs, t) => (fitsAbove(mine, theirs) ? bits | (1 << t) : bits), 0),
  ),
  VARIANTS.map((mine) =>
    VARIANTS.reduce((bits, theirs, t) => (fitsAbove(theirs, mine) ? bits | (1 << t) : bits), 0),
  ),
];

/** Same seed, same numbers, on every machine. */
export function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function generate(options: GenerateOptions): Generated {
  const next = random(options.seed);
  const failures = new Map<string, number>();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = tryGenerate(options, next);
    if (typeof result !== "string") return { ...result, attempts: attempt };
    failures.set(result, (failures.get(result) ?? 0) + 1);
  }
  const why = [...failures].map(([reason, count]) => `${count} × ${reason}`).join("; ");
  throw new Error(`No level from seed ${options.seed} in ${MAX_ATTEMPTS} tries: ${why}`);
}

function tryGenerate(options: GenerateOptions, next: () => number) {
  const { cols, rows, storeys, basements } = options;
  const index = (storey: number, col: number, row: number) =>
    ((storey + basements) * rows + row) * cols + col;
  const inside = (storey: number, col: number, row: number) =>
    storey >= -basements &&
    storey < storeys - basements &&
    col >= 0 &&
    col < cols &&
    row >= 0 &&
    row < rows;
  const key = ({ storey, col, row }: Cell) => `${storey},${col},${row}`;
  const entrance: Cell = { storey: 0, col: Math.floor(cols / 2), row: 0 };

  // 1. The layout: rooms on every storey, and the edges between cells.
  const edges = new Map<string, Edge>();
  const edgeKey = (storey: number, col: number, row: number, side: Side) => {
    if (side === "s") return `${storey},${col},${row - 1},n`;
    if (side === "w") return `${storey},${col - 1},${row},e`;
    return `${storey},${col},${row},${side}`;
  };
  const edgeAt = (storey: number, col: number, row: number, side: Side): Edge => {
    const [dx, dz] = OFFSET[side];
    if (!inside(storey, col + dx, row + dz)) return "wall";
    return edges.get(edgeKey(storey, col, row, side)) ?? "none";
  };
  const plans = layOut(options, entrance.col, next);
  const plan = (storey: number) => plans[storey + basements];
  const kindAt = (storey: number, col: number, row: number): LayoutKind | undefined => {
    if (!inside(storey, col, row)) return undefined;
    const storeyPlan = plan(storey);
    return storeyPlan.kinds[storeyPlan.room[row * cols + col]];
  };
  for (let storey = -basements; storey < storeys - basements; storey++) {
    joinRooms(plan(storey), cols, rows, next, (col, row, side, edge) =>
      edges.set(edgeKey(storey, col, row, side), edge),
    );
  }

  /** An opening in a wall on an edge, if there is one. */
  const openUp = (storey: number, col: number, row: number, side: Side) => {
    if (edgeAt(storey, col, row, side) === "wall")
      edges.set(edgeKey(storey, col, row, side), "door");
  };

  // 2. The tiles, by wave function collapse.
  const total = storeys * rows * cols;
  const possible = Array.from({ length: total }, () => new Array<boolean>(COUNT).fill(true));
  const weights = Array.from({ length: total }, () => new Array<number>(COUNT).fill(0));
  const cells: Cell[] = [];
  for (let storey = -basements; storey < storeys - basements; storey++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) cells.push({ storey, col, row });
    }
  }

  // What each cell can be on its own: by its room, at the top, at the bottom, against the outer walls.
  for (const { storey, col, row } of cells) {
    const here = possible[index(storey, col, row)];
    const weighed = weights[index(storey, col, row)];
    const kind = kindAt(storey, col, row) ?? "rock";
    for (let v = 0; v < COUNT; v++) {
      const tile = VARIANTS[v];
      const weight = WEIGHTS[kind][tile.kind] ?? 0;
      weighed[v] = weight;
      // Wells and shafts follow from what's below or above, in any room but rock or a cage.
      const follows = tile.kind === "well" || tile.kind === "shaft";
      let ok = weight > 0 || (kind !== "rock" && kind !== "cage" && follows);
      // Pits only on the ground, over a basement: anywhere else they'd hang over a room.
      if ((tile.kind === "pit" || tile.kind === "bridge") && storey !== 0) ok = false;
      if (storey === -basements && !fitsAbove(undefined, tile)) ok = false;
      if (storey === storeys - basements - 1 && !fitsAbove(tile, { kind: "open" })) ok = false;
      for (const side of SIDES) {
        const [dx, dz] = OFFSET[side];
        if (inside(storey, col + dx, row + dz)) continue;
        if (MUST_LEAD_ON.includes(socket(tile, side))) ok = false;
      }
      here[v] = ok;
    }
  }
  /** Settle a cell on one tile before the collapse starts. */
  const place = (cell: Cell, tile: Tile) => {
    const here = possible[index(cell.storey, cell.col, cell.row)];
    const v = VARIANTS.findIndex((variant) => JSON.stringify(variant) === JSON.stringify(tile));
    const ok = here[v];
    here.fill(false);
    here[v] = ok;
    return ok;
  };
  place(entrance, { kind: "floor" });

  // Ways up from every storey, part of the layout, so no storey is cut off: stairs at the back, or
  // now and then a ladder, and from the ground up broad stairs in the halls too. Each leads from
  // inside the grid to inside it, with doorways only at its foot and where it arrives, and walls
  // there get doorways.
  const placeWayUp = (storey: number, from: readonly LayoutKind[], ladders: boolean) => {
    const candidates = cells.filter(
      (cell) =>
        cell.storey === storey &&
        from.includes(kindAt(storey, cell.col, cell.row) as LayoutKind) &&
        key(cell) !== key(entrance),
    );
    for (let tries = 0; tries < 60 && candidates.length > 0; tries++) {
      const cell = candidates[Math.floor(next() * candidates.length)];
      const up = SIDES[Math.floor(next() * 4)];
      const kind = ladders && next() < 0.3 ? "ladder" : "stairs";
      const [dx, dz] = OFFSET[up];
      const foot = OPPOSITE[up];
      const arrives = kindAt(storey + 1, cell.col + dx, cell.row + dz);
      if (!arrives || arrives === "rock" || arrives === "atrium" || arrives === "cage") continue;
      const above = kindAt(storey + 1, cell.col, cell.row);
      if (above === "rock" || above === "cage") continue;
      if (kind === "stairs") {
        const before = kindAt(storey, cell.col - dx, cell.row - dz);
        if (!before || before === "rock" || before === "atrium") continue;
        if (key({ storey, col: cell.col - dx, row: cell.row - dz }) === key(entrance)) continue;
      }
      const doorways = (at: number, allowed: (side: Side) => boolean) =>
        SIDES.some((side) => !allowed(side) && isOpening(edgeAt(at, cell.col, cell.row, side)));
      if (doorways(storey, (side) => (kind === "stairs" ? side === foot : side !== up))) continue;
      if (doorways(storey + 1, (side) => side === up)) continue;
      if (!place(cell, { kind, up })) continue;
      if (kind === "stairs") openUp(storey, cell.col, cell.row, foot);
      openUp(storey + 1, cell.col, cell.row, up);
      return true;
    }
    return false;
  };
  for (let storey = -basements; storey < storeys - basements - 1; storey++) {
    const back = placeWayUp(
      storey,
      ["stock", "corridor", "plant", "staff", "office", "workshop"],
      true,
    );
    // The main way up, from one hall to the next.
    const front = storey >= 0 && placeWayUp(storey, ["hall"], false);
    if (!back && !front) return `no room for a way up from storey ${storey}`;
  }

  /** The cells next to one, and whether a tile there fits a tile here. */
  const neighbours = ({ storey, col, row }: Cell) => {
    const found: { cell: Cell; allows: readonly number[] }[] = [];
    for (const [s, side] of SIDES.entries()) {
      const [dx, dz] = OFFSET[side];
      if (!inside(storey, col + dx, row + dz)) continue;
      const edge = edgeAt(storey, col, row, side);
      found.push({
        cell: { storey, col: col + dx, row: row + dz },
        allows: ALLOWS[s * 3 + (edge === "none" ? 0 : edge === "wall" ? 1 : 2)],
      });
    }
    if (inside(storey + 1, col, row)) {
      found.push({ cell: { storey: storey + 1, col, row }, allows: ALLOWS[12] });
    }
    if (inside(storey - 1, col, row)) {
      found.push({ cell: { storey: storey - 1, col, row }, allows: ALLOWS[13] });
    }
    return found;
  };

  /** Drop what no longer fits next to what's left; false if a cell runs out of tiles. */
  const propagate = (queue: Cell[]): boolean => {
    while (queue.length > 0) {
      const cell = queue.pop() as Cell;
      const mine = possible[index(cell.storey, cell.col, cell.row)];
      for (const { cell: other, allows } of neighbours(cell)) {
        const theirs = possible[index(other.storey, other.col, other.row)];
        // What any tile still possible here allows there.
        let allowed = 0;
        for (let m = 0; m < COUNT; m++) if (mine[m]) allowed |= allows[m];
        let changed = false;
        for (let t = 0; t < COUNT; t++) {
          if (theirs[t] && !(allowed & (1 << t))) {
            theirs[t] = false;
            changed = true;
          }
        }
        if (changed) {
          if (!theirs.includes(true)) return false;
          queue.push(other);
        }
      }
    }
    return true;
  };

  if (!propagate([...cells])) return "the tiles contradict each other from the start";
  // Ties between cells with as few tiles left are broken at random, the same way all through.
  const tieBreak = cells.map(() => next() * 0.5);
  let undecided = [...cells.keys()];
  for (;;) {
    // The undecided cell with the fewest tiles left.
    let best: Cell | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    undecided = undecided.filter((i) => {
      const cell = cells[i];
      const here = possible[index(cell.storey, cell.col, cell.row)];
      let count = 0;
      for (let v = 0; v < COUNT; v++) if (here[v]) count++;
      if (count <= 1) return false;
      const score = count + tieBreak[i];
      if (score < bestScore) {
        best = cell;
        bestScore = score;
      }
      return true;
    });
    if (!best) break;
    const here = possible[index(best.storey, best.col, best.row)];
    const weighed = weights[index(best.storey, best.col, best.row)];
    const chances = weighed.map((weight, v) => (here[v] ? weight || 0.01 : 0));
    let pick = next() * chances.reduce((a, b) => a + b, 0);
    let chosen = 0;
    while ((pick >= chances[chosen] || chances[chosen] === 0) && chosen < COUNT - 1) {
      pick -= chances[chosen];
      chosen++;
    }
    here.fill(false);
    here[chosen] = true;
    const changed = [best];
    if (ONLY_ONE.includes(chosen)) {
      for (const cell of cells) {
        const there = possible[index(cell.storey, cell.col, cell.row)];
        if (cell === best || !there[chosen]) continue;
        there[chosen] = false;
        if (!there.includes(true)) return "a cell ran out of tiles";
        changed.push(cell);
      }
    }
    if (!propagate(changed)) return "a cell ran out of tiles";
  }

  const tiles = new Map<string, Tile>();
  for (const cell of cells) {
    const v = possible[index(cell.storey, cell.col, cell.row)].indexOf(true);
    tiles.set(key(cell), VARIANTS[v]);
  }
  const tileAt = (cell: Cell) => tiles.get(key(cell));

  // 3. Everything that can't be walked to from the entrance is filled in, or taken away. How far
  // each cell is, on the way, by the cheapest path: a step to the next cell is one, a storey two.
  const distances = new Map<string, number>([[key(entrance), 0]]);
  const buckets: Cell[][] = [[entrance]];
  for (let at = 0; at < buckets.length; at++) {
    for (const cell of buckets[at] ?? []) {
      if (distances.get(key(cell)) !== at) continue;
      const tile = tileAt(cell) as Tile;
      const steps: [Cell, number][] = [];
      for (const side of SIDES) {
        const [dx, dz] = OFFSET[side];
        const other = { storey: cell.storey, col: cell.col + dx, row: cell.row + dz };
        const theirs = tileAt(other);
        if (!theirs || edgeAt(cell.storey, cell.col, cell.row, side) === "wall") continue;
        if (WALKS.includes(socket(tile, side)) && WALKS.includes(socket(theirs, OPPOSITE[side]))) {
          steps.push([other, 1]);
        }
      }
      // Up stairs or a ladder, and down them from where they arrive.
      if (tile.kind === "stairs" || tile.kind === "ladder") {
        const [dx, dz] = OFFSET[tile.up];
        steps.push([{ storey: cell.storey + 1, col: cell.col + dx, row: cell.row + dz }, 2]);
      }
      for (const side of SIDES) {
        const [dx, dz] = OFFSET[side];
        const below = { storey: cell.storey - 1, col: cell.col - dx, row: cell.row - dz };
        const climb = tileAt(below);
        if ((climb?.kind === "stairs" || climb?.kind === "ladder") && climb.up === side) {
          steps.push([below, 2]);
        }
      }
      for (const [step, cost] of steps) {
        const known = distances.get(key(step));
        if (known !== undefined && known <= at + cost) continue;
        distances.set(key(step), at + cost);
        buckets[at + cost] ??= [];
        buckets[at + cost].push(step);
      }
    }
  }
  const reached = (cell: Cell) => distances.has(key(cell));
  const walkable = (tile: Tile) =>
    tile.kind === "floor" ||
    tile.kind === "tv" ||
    tile.kind === "ladder" ||
    tile.kind === "stairs" ||
    tile.kind === "bridge";
  for (const cell of cells) {
    const tile = tileAt(cell) as Tile;
    if (!walkable(tile) || reached(cell)) continue;
    if (tile.kind === "bridge") tiles.set(key(cell), { kind: "pit" });
    // In the ground, rock; above it, air.
    else tiles.set(key(cell), cell.storey <= 0 ? { kind: "solid" } : { kind: "open" });
    if (tile.kind === "stairs" || tile.kind === "ladder") {
      tiles.set(key({ ...cell, storey: cell.storey + 1 }), { kind: "open" });
    }
  }
  // Openings onto what's gone become walls.
  for (const [edgeId, edge] of edges) {
    if (!isOpening(edge)) continue;
    const [storey, col, row, side] = edgeId.split(",") as [string, string, string, Side];
    const cell = { storey: Number(storey), col: Number(col), row: Number(row) };
    const [dx, dz] = OFFSET[side];
    const other = { ...cell, col: cell.col + dx, row: cell.row + dz };
    const mine = socket(tileAt(cell) as Tile, side);
    const theirs = socket(tileAt(other) as Tile, OPPOSITE[side]);
    if (!PASSABLE.includes(mine) || !PASSABLE.includes(theirs)) edges.set(edgeId, "wall");
  }
  // And walls left with air on both sides, standing on nothing, go.
  for (const edgeId of edges.keys()) {
    const [storey, col, row, side] = edgeId.split(",") as [string, string, string, Side];
    const cell = { storey: Number(storey), col: Number(col), row: Number(row) };
    const [dx, dz] = OFFSET[side];
    const other = tileAt({ ...cell, col: cell.col + dx, row: cell.row + dz });
    if (other && airy(tileAt(cell) as Tile) && airy(other)) edges.delete(edgeId);
  }

  // Every storey needs a fair bit to stand on, or it isn't worth having.
  for (let storey = -basements; storey < storeys - basements; storey++) {
    const count = cells.filter((cell) => cell.storey === storey && reached(cell)).length;
    if (count < 6) return `storey ${storey} can hardly be reached`;
  }

  const grid = {
    basements,
    storeys: drawStoreys(options, tileAt, edgeAt),
  };
  const problem = checkTiles(parseTiles({ ...grid, x: 0, z: 0 }));
  if (problem) return problem;
  const floors = cells.filter((cell) => reached(cell) && tileAt(cell)?.kind === "floor");

  // The rooms that are left: whatever has a cell that isn't rock, in order of storey.
  const rooms: GeneratedRoom[] = [];
  const roomIds = new Map<string, number>();
  for (let storey = -basements; storey < storeys - basements; storey++) {
    const { room, kinds } = plan(storey);
    const found = new Map<number, number>();
    for (let i = 0; i < room.length; i++) {
      const kind = kinds[room[i]];
      const cell = { storey, col: i % cols, row: Math.floor(i / cols) };
      if (kind === "rock" || tileAt(cell)?.kind === "solid") continue;
      let id = found.get(room[i]);
      if (id === undefined) {
        id = rooms.length;
        found.set(room[i], id);
        rooms.push({ kind, storey, cells: [] });
      }
      rooms[id].cells.push({ col: cell.col, row: cell.row });
      roomIds.set(key(cell), id);
    }
  }
  return {
    grid,
    entrance,
    floors,
    rooms,
    roomAt: (cell: Cell) => roomIds.get(key(cell)) ?? -1,
    distance: (cell: Cell) => distances.get(key(cell)),
  };
}

/** One storey's layout: the room each cell is in, by `row * cols + col`, and each room's kind. */
interface StoreyPlan {
  room: number[];
  kinds: LayoutKind[];
}

/** A storey's layout as it's drawn up: rooms painted over each other, the last on top. */
class Painter {
  readonly room: number[];
  readonly kinds: LayoutKind[] = [];
  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.room = new Array<number>(cols * rows).fill(-1);
  }
  /** A new room of a kind over a rectangle of cells; returns its id. */
  paint(kind: LayoutKind, col: number, row: number, width: number, depth: number): number {
    const id = this.kinds.length;
    this.kinds.push(kind);
    this.repaint(id, col, row, width, depth);
    return id;
  }
  /** A rectangle of cells, given to a room there already is. */
  repaint(id: number, col: number, row: number, width: number, depth: number) {
    for (let r = Math.max(0, row); r < Math.min(this.rows, row + depth); r++) {
      for (let c = Math.max(0, col); c < Math.min(this.cols, col + width); c++) {
        this.room[r * this.cols + c] = id;
      }
    }
  }
  /** The plan, with rooms that lost all their cells left out and anything unpainted rock. */
  plan(): StoreyPlan {
    const used = new Map<number, number>();
    const kinds: LayoutKind[] = [];
    const room = this.room.map((id) => {
      const kind = id < 0 ? "rock" : this.kinds[id];
      const was = id < 0 ? -1 : id;
      let now = used.get(was);
      if (now === undefined) {
        now = kinds.length;
        used.set(was, now);
        kinds.push(kind);
      }
      return now;
    });
    return { room, kinds };
  }
}

/**
 * Split a length into pieces between `min` and `max` long, at random, as evenly as it comes. A
 * length shorter than `min` is one piece.
 */
function pieces(length: number, min: number, max: number, next: () => number): number[] {
  const result: number[] = [];
  let left = length;
  while (left > 0) {
    if (left <= max) {
      result.push(left);
      break;
    }
    // Keep enough over for at least one more piece.
    const most = Math.min(max, left - min);
    const piece = most <= min ? min : min + Math.floor(next() * (most - min + 1));
    result.push(piece);
    left -= piece;
  }
  return result;
}

/** Split a length into `count` pieces, each at least `min` long, at random; fewer if it's too short. */
function divide(length: number, count: number, min: number, next: () => number): number[] {
  const n = Math.max(1, Math.min(count, Math.floor(length / min)));
  const result = new Array<number>(n).fill(min);
  for (let left = length - n * min; left > 0; left--) result[Math.floor(next() * n)]++;
  return result;
}

/** A rectangle of cells. */
interface Rect {
  col: number;
  row: number;
  width: number;
  depth: number;
}

/**
 * The building's layout, storey by storey from the deepest, as a harbour warehouse is laid out. On
 * the ground: the loading bay at the entrance, in the middle of the south side; big storage halls
 * behind and around it, some with a bonded cage in a back corner; maybe a shipping office or
 * storeroom in a front corner; and a strip of storerooms along the back, often with a corridor in
 * front of them. Above: more halls at the front round an atrium open to the hall below, and
 * offices, staff rooms, workshops and storerooms along a corridor at the back; the top storey is
 * more often all back of house. In the basement: plant and stock rooms off a
 * corridor, under the back of the building, and rock elsewhere.
 */
function layOut(options: GenerateOptions, entranceCol: number, next: () => number): StoreyPlan[] {
  const { cols, rows, storeys, basements } = options;
  const plans: StoreyPlan[] = new Array(storeys);
  const top = storeys - basements - 1;

  // The ground.
  const ground = new Painter(cols, rows);
  const back = 3 + (next() < 0.4 ? 1 : 0);
  const front = rows - back;
  const hallCount = next() < 0.3 ? 1 : next() < 0.7 ? 2 : 3;
  const halls: Rect[] = [];
  let col = 0;
  for (const width of divide(cols, hallCount, 4, next)) {
    ground.paint("hall", col, 0, width, front);
    halls.push({ col, row: 0, width, depth: front });
    col += width;
  }
  if (next() < 0.5) {
    const width = 2 + Math.floor(next() * 2);
    const depth = 2 + Math.floor(next() * 2);
    const west = next() < 0.5;
    ground.paint(next() < 0.5 ? "office" : "stock", west ? 0 : cols - width, 0, width, depth);
  }
  const lobbyWidth = 3 + (next() < 0.4 ? 1 : 0);
  const lobby: Rect = {
    col: entranceCol - Math.floor(lobbyWidth / 2),
    row: 0,
    width: lobbyWidth,
    depth: 2,
  };
  ground.paint("entrance", lobby.col, lobby.row, lobby.width, lobby.depth);
  for (const hall of halls) {
    if (next() < 0.45) paintCage(ground, hall, [lobby], next);
  }
  layOutBack(ground, front, back, next() < 0.55, "ground", next);
  plans[basements] = ground.plan();

  // Above the ground: the atrium over the biggest hall, which may go up more than one storey.
  const biggest = halls.reduce((a, b) => (b.width * b.depth > a.width * a.depth ? b : a));
  let atria: Rect[] = [];
  if (biggest.width >= 4 && biggest.depth >= 4) {
    const width = Math.min(biggest.width - 2, 2 + Math.floor(next() * 3));
    const depth = Math.min(biggest.depth - 2, 2 + Math.floor(next() * 3));
    atria.push({
      col: biggest.col + 1 + Math.floor(next() * (biggest.width - 1 - width)),
      row: biggest.row + 1 + Math.floor(next() * (biggest.depth - 1 - depth)),
      width,
      depth,
    });
  }
  // Now and then the lobby is open to the storey above too.
  if (next() < 0.35) atria.push(lobby);
  for (let storey = 1; storey <= top; storey++) {
    const upper = new Painter(cols, rows);
    const upperBack = 3 + (next() < 0.5 ? 1 : 0);
    const upperFront = rows - upperBack;
    if (storey === 1 || next() < 0.45) {
      // Storage, in one hall or two, with a cage more often than on the ground.
      const split = next() < 0.5 ? pieces(cols, 5, cols - 5, next) : [cols];
      let at = 0;
      for (const width of split) {
        const hall = { col: at, row: 0, width, depth: upperFront };
        upper.paint("hall", hall.col, hall.row, hall.width, hall.depth);
        if (next() < 0.6) paintCage(upper, hall, atria, next);
        at += width;
      }
    } else {
      layOutBack(upper, 0, upperFront, true, "front", next);
    }
    layOutBack(upper, upperFront, upperBack, next() < 0.75, "upstairs", next);
    for (const atrium of atria) {
      upper.paint("atrium", atrium.col, atrium.row, atrium.width, atrium.depth);
    }
    plans[basements + storey] = upper.plan();
    // An atrium only goes on up now and then.
    atria = atria.filter(() => next() < 0.45);
  }

  // The basements: under the back of the building, dug out of rock.
  for (let storey = -1; storey >= -basements; storey--) {
    const basement = new Painter(cols, rows);
    const depth = Math.min(rows, 5 + Math.floor(next() * 3));
    const from = Math.floor(next() * 3);
    const to = cols - Math.floor(next() * 3);
    const corridor = rows - depth + 1 + Math.floor(next() * (depth - 2));
    basement.paint("corridor", from, corridor, to - from, 1);
    for (const [row, rowDepth] of [
      [rows - depth, corridor - (rows - depth)],
      [corridor + 1, rows - corridor - 1],
    ]) {
      if (rowDepth <= 0) continue;
      let at = from;
      for (const width of pieces(to - from, 2, 5, next)) {
        const small = width * rowDepth <= 6;
        basement.paint(small || next() < 0.5 ? "plant" : "stock", at, row, width, rowDepth);
        at += width;
      }
    }
    plans[basements + storey] = basement.plan();
  }
  return plans;
}

/**
 * Back of house in a strip of rows: maybe a corridor along its southern side, then rooms side by
 * side behind it. On the ground they're mostly stock rooms, with a staff room or office at one end
 * now and then; upstairs, offices and staff rooms with the odd stock room. At the front of a storey
 * that isn't storage, a mix, either side of a corridor down the middle.
 */
function layOutBack(
  painter: Painter,
  row: number,
  depth: number,
  corridor: boolean,
  where: "ground" | "upstairs" | "front",
  next: () => number,
) {
  const { cols } = painter;
  if (!corridor || depth < 3) {
    layOutRooms(painter, row, depth, where, next);
  } else if (where === "front") {
    const middle = row + 2 + Math.floor(next() * Math.max(1, depth - 4));
    painter.paint("corridor", 0, middle, cols, 1);
    layOutRooms(painter, row, middle - row, where, next);
    layOutRooms(painter, middle + 1, row + depth - middle - 1, where, next);
  } else {
    painter.paint("corridor", 0, row, cols, 1);
    layOutRooms(painter, row + 1, depth - 1, where, next);
  }
}

/** Rooms side by side in a strip of rows, and one behind the other where it's deep. */
function layOutRooms(
  painter: Painter,
  from: number,
  depth: number,
  where: "ground" | "upstairs" | "front",
  next: () => number,
) {
  if (depth <= 0) return;
  const { cols } = painter;
  const widths =
    where === "ground"
      ? pieces(cols, 3, 6, next)
      : pieces(cols, 2, where === "front" ? 5 : 4, next);
  let at = 0;
  for (const [i, width] of widths.entries()) {
    let row = from;
    for (const [j, roomDepth] of pieces(depth, 2, where === "ground" ? 4 : 3, next).entries()) {
      const area = width * roomDepth;
      let kind: LayoutKind;
      if (where === "ground") {
        const end = i === 0 || i === widths.length - 1;
        const small = end && width <= 4 && next() < 0.35;
        const pick = next();
        kind =
          small || j > 0 ? (pick < 0.35 ? "staff" : pick < 0.7 ? "office" : "workshop") : "stock";
      } else if (area >= 8 && next() < (where === "front" ? 0.5 : 0.3)) {
        kind = next() < 0.5 ? "stock" : next() < 0.5 ? "workshop" : "office";
      } else {
        const pick = next();
        kind = pick < 0.5 ? "office" : pick < 0.8 ? "staff" : "workshop";
      }
      painter.paint(kind, at, row, width, roomDepth);
      row += roomDepth;
    }
    at += width;
  }
}

/**
 * A bonded cage in a back corner of a hall, two or three cells each way, clear of the rectangles
 * given (the loading bay, atriums). It has no walls on the hall's side: the furnishing layer fences
 * it in with chain-link (shared/furnish.ts).
 */
function paintCage(painter: Painter, hall: Rect, avoid: Rect[], next: () => number) {
  const width = Math.min(hall.width - 2, 2 + Math.floor(next() * 2));
  const depth = Math.min(hall.depth - 2, 2 + Math.floor(next() * 2));
  if (width < 2 || depth < 2) return;
  const col = next() < 0.5 ? hall.col : hall.col + hall.width - width;
  const row = hall.row + hall.depth - depth;
  const overlaps = (r: Rect) =>
    col < r.col + r.width && r.col < col + width && row < r.row + r.depth && r.row < row + depth;
  if (avoid.some(overlaps)) return;
  painter.paint("cage", col, row, width, depth);
}

/** People and forklifts move between these, through arches rather than doorways. */
const PUBLIC: readonly LayoutKind[] = ["entrance", "hall"];

/**
 * Walls go between the rooms of a storey that aren't open air or rock, and doorways join them all
 * up, along a spanning tree, with a few more for loops. Halls and the loading bay are joined by
 * arches, every other cell of the wall between them. A cage has no wall on its hall's side, and is
 * walled off from anything else with no way through. Open-air rooms have no walls round them:
 * the floors beside them get railings instead.
 */
function joinRooms(
  { room, kinds }: StoreyPlan,
  cols: number,
  rows: number,
  next: () => number,
  setEdge: (col: number, row: number, side: Side, edge: Edge) => void,
) {
  const walled = (id: number) => kinds[id] !== "atrium" && kinds[id] !== "rock";
  // The edges between each pair of walled rooms that touch.
  const between = new Map<string, [number, number, Side][]>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      for (const side of ["n", "e"] as const) {
        const [dx, dz] = OFFSET[side];
        if (col + dx >= cols || row + dz >= rows) continue;
        const a = room[row * cols + col];
        const b = room[(row + dz) * cols + col + dx];
        if (a === b || !walled(a) || !walled(b)) continue;
        // Chain-link, not a wall, between a cage and its hall.
        const other = kinds[a] === "cage" ? b : kinds[b] === "cage" ? a : -1;
        if (other >= 0 && kinds[other] === "hall") continue;
        setEdge(col, row, side, "wall");
        if (other >= 0) continue;
        const pair = `${Math.min(a, b)},${Math.max(a, b)}`;
        between.set(pair, [...(between.get(pair) ?? []), [col, row, side]]);
      }
    }
  }
  // A spanning tree of doorways, in random order, so every room is joined; then a few loops.
  const parent = kinds.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const pairs = [...between.keys()].sort().map((pair) => ({ pair, order: next() }));
  pairs.sort((a, b) => a.order - b.order);
  for (const { pair } of pairs) {
    const [a, b] = pair.split(",").map(Number);
    const options = between.get(pair) ?? [];
    if (PUBLIC.includes(kinds[a]) && PUBLIC.includes(kinds[b])) {
      // A colonnade of arches: the loading bay opens right up, halls every other cell.
      const lobby = kinds[a] === "entrance" || kinds[b] === "entrance";
      const offset = Math.floor(next() * 2);
      options.forEach(([col, row, side], i) => {
        if (lobby || i % 2 === offset || options.length === 1) setEdge(col, row, side, "arch");
      });
      parent[find(a)] = find(b);
      continue;
    }
    const joins = find(a) !== find(b);
    if (!joins && next() > 0.3) continue;
    parent[find(a)] = find(b);
    const first = Math.floor(next() * options.length);
    const [col, row, side] = options[first];
    setEdge(col, row, side, "door");
    // A long wall now and then gets a second doorway, well away from the first.
    if (options.length >= 5 && next() < 0.4) {
      const second = (first + Math.floor(options.length / 2)) % options.length;
      const [col2, row2, side2] = options[second];
      setEdge(col2, row2, side2, "door");
    }
  }
}

/** A generated storey, drawn with its walls as `parseTiles` reads them. */
function drawStoreys(
  { cols, rows, storeys, basements }: GenerateOptions,
  tileAt: (cell: Cell) => Tile | undefined,
  edgeAt: (storey: number, col: number, row: number, side: Side) => Edge,
): string[][] {
  const mark = (edge: Edge, wall: string) =>
    edge === "door" ? "d" : edge === "arch" ? "a" : edge === "wall" ? wall : " ";
  const result: string[][] = [];
  for (let storey = -basements; storey < storeys - basements; storey++) {
    const lines: string[] = [];
    for (let row = rows - 1; row >= 0; row--) {
      let top = "+";
      let middle = "";
      for (let col = 0; col < cols; col++) {
        top += `${mark(edgeAt(storey, col, row, "n"), "-")}+`;
        middle += mark(edgeAt(storey, col, row, "w"), "|");
        middle += tileChar(tileAt({ storey, col, row }) as Tile);
      }
      middle += mark(edgeAt(storey, cols - 1, row, "e"), "|");
      lines.push(top, middle);
    }
    lines.push(`+${"-+".repeat(cols)}`);
    result.push(lines);
  }
  return result;
}
