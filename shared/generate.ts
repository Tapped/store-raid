import {
  checkTiles,
  type Edge,
  fits,
  fitsAbove,
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
 * Levels generated from a seed, in two layers. First the layout: each storey is split into rooms,
 * walled off from each other, with doorways joining them all up. Then the tiles, by wave function
 * collapse: every cell gets the tile that fits its neighbours, the walls and doorways between them,
 * and what's above and below it. Anything that can't be reached from the entrance is filled in or
 * taken away, and the result is a `TileGrid` like a hand-written one. Props are left to a later layer.
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

export interface Generated {
  grid: Omit<TileGrid, "x" | "z">;
  /** Where players come in: a floor on the ground storey, on the southern edge. */
  entrance: Cell;
  /** Every floor that can be walked to from the entrance, for putting things on. */
  floors: Cell[];
  /** How many tries it took: a try fails when the tiles can't be made to fit. */
  attempts: number;
}

const MAX_ATTEMPTS = 50;

/** Every tile there is, and how likely each is wherever it fits, on the ground and higher up. */
const VARIANTS: { tile: Tile; ground: number; high: number }[] = [
  { tile: { kind: "floor" }, ground: 12, high: 8 },
  // One a level at most, most of the time (see ONLY_ONE).
  { tile: { kind: "tv" }, ground: 0.4, high: 0.4 },
  { tile: { kind: "solid" }, ground: 1.5, high: 0.5 },
  { tile: { kind: "pit" }, ground: 1.2, high: 0 },
  { tile: { kind: "bridge", along: "x" }, ground: 0.5, high: 0 },
  { tile: { kind: "bridge", along: "z" }, ground: 0.5, high: 0 },
  ...SIDES.map((up) => ({ tile: { kind: "stairs", up } as Tile, ground: 0.35, high: 0.35 })),
  ...SIDES.map((up) => ({ tile: { kind: "ladder", up } as Tile, ground: 0.25, high: 0.25 })),
  { tile: { kind: "open" }, ground: 0, high: 3 },
  ...SIDES.map((from) => ({ tile: { kind: "well", from } as Tile, ground: 1, high: 1 })),
  { tile: { kind: "shaft" }, ground: 1, high: 1 },
];
const COUNT = VARIANTS.length;
/** Tiles there's only one of in a level: once a cell has one, no other cell can. */
const ONLY_ONE = VARIANTS.flatMap((variant, v) => (variant.tile.kind === "tv" ? [v] : []));

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
  if (edge === "door" && !(PASSABLE.includes(mine) && PASSABLE.includes(theirs))) return false;
  return fits(mine, theirs);
}

/** Same seed, same numbers, on every machine. */
function random(seed: number): () => number {
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
  const openAir = new Set<string>();
  for (let storey = -basements; storey < storeys - basements; storey++) {
    const airy = layOutRooms(cols, rows, storey > 0, next, (col, row, side, edge) =>
      edges.set(edgeKey(storey, col, row, side), edge),
    );
    airy.forEach((isAiry, i) => {
      if (isAiry) openAir.add(`${storey},${i % cols},${Math.floor(i / cols)}`);
    });
  }

  /** A doorway in a wall on an edge, if there is one. */
  const openUp = (storey: number, col: number, row: number, side: Side) => {
    if (edgeAt(storey, col, row, side) === "wall")
      edges.set(edgeKey(storey, col, row, side), "door");
  };

  // 2. The tiles, by wave function collapse.
  const total = storeys * rows * cols;
  const possible = Array.from({ length: total }, () => new Array<boolean>(COUNT).fill(true));
  const cells: Cell[] = [];
  for (let storey = -basements; storey < storeys - basements; storey++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) cells.push({ storey, col, row });
    }
  }
  const entrance: Cell = { storey: 0, col: Math.floor(cols / 2), row: 0 };

  // What each cell can be on its own: at the top, at the bottom, against the outer walls.
  for (const { storey, col, row } of cells) {
    const here = possible[index(storey, col, row)];
    for (let v = 0; v < COUNT; v++) {
      const tile = VARIANTS[v].tile;
      const weight = storey > 0 ? VARIANTS[v].high : VARIANTS[v].ground;
      let ok = weight > 0 || tile.kind === "well" || tile.kind === "shaft";
      if (storey === -basements && !fitsAbove(undefined, tile)) ok = false;
      if (storey === storeys - basements - 1 && !fitsAbove(tile, { kind: "open" })) ok = false;
      for (const side of SIDES) {
        const [dx, dz] = OFFSET[side];
        if (inside(storey, col + dx, row + dz)) continue;
        if (MUST_LEAD_ON.includes(socket(tile, side))) ok = false;
      }
      // Open-air rooms are just that, or the well over a way up.
      if (openAir.has(`${storey},${col},${row}`) && !airy(tile)) ok = false;
      here[v] = ok;
    }
  }
  /** Settle a cell on one tile before the collapse starts. */
  const place = (cell: Cell, tile: Tile) => {
    const here = possible[index(cell.storey, cell.col, cell.row)];
    const v = VARIANTS.findIndex(
      (variant) => JSON.stringify(variant.tile) === JSON.stringify(tile),
    );
    const ok = here[v];
    here.fill(false);
    here[v] = ok;
    return ok;
  };
  place(entrance, { kind: "floor" });
  // A way up from every storey, part of the layout, so no storey is cut off: stairs, or now and then
  // a ladder, somewhere other than the entrance, leading from inside the grid to inside it, with
  // doorways only at its foot and where it arrives. Walls there get doorways.
  for (let storey = -basements; storey < storeys - basements - 1; storey++) {
    let placed = false;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      const cell = { storey, col: Math.floor(next() * cols), row: Math.floor(next() * rows) };
      const up = SIDES[Math.floor(next() * 4)];
      const kind = next() < 0.3 ? "ladder" : "stairs";
      const [dx, dz] = OFFSET[up];
      const foot = OPPOSITE[up];
      const atEntrance =
        cell.storey === entrance.storey && cell.col === entrance.col && cell.row === entrance.row;
      if (atEntrance || !inside(storey + 1, cell.col + dx, cell.row + dz)) continue;
      if (kind === "stairs" && !inside(storey, cell.col - dx, cell.row - dz)) continue;
      const doorways = (at: number, allowed: (side: Side) => boolean) =>
        SIDES.some((side) => !allowed(side) && edgeAt(at, cell.col, cell.row, side) === "door");
      if (doorways(storey, (side) => (kind === "stairs" ? side === foot : side !== up))) continue;
      if (doorways(storey + 1, (side) => side === up)) continue;
      // It has to arrive on something it can stand on.
      if (openAir.has(`${storey + 1},${cell.col + dx},${cell.row + dz}`)) continue;
      if (openAir.has(`${storey},${cell.col},${cell.row}`)) continue;
      if (!place(cell, { kind, up })) continue;
      if (kind === "stairs") openUp(storey, cell.col, cell.row, foot);
      openUp(storey + 1, cell.col, cell.row, up);
      placed = true;
    }
    if (!placed) return `no room for a way up from storey ${storey}`;
  }

  /** The cells next to one, and whether a tile there fits a tile here. */
  const neighbours = ({ storey, col, row }: Cell) => {
    const found: { cell: Cell; allows: (mine: Tile, theirs: Tile) => boolean }[] = [];
    for (const side of SIDES) {
      const [dx, dz] = OFFSET[side];
      if (!inside(storey, col + dx, row + dz)) continue;
      const edge = edgeAt(storey, col, row, side);
      found.push({
        cell: { storey, col: col + dx, row: row + dz },
        allows: (mine, theirs) => besides(mine, theirs, side, edge),
      });
    }
    if (inside(storey + 1, col, row)) {
      found.push({ cell: { storey: storey + 1, col, row }, allows: (m, t) => fitsAbove(m, t) });
    }
    if (inside(storey - 1, col, row)) {
      found.push({ cell: { storey: storey - 1, col, row }, allows: (m, t) => fitsAbove(t, m) });
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
        let changed = false;
        for (let t = 0; t < COUNT; t++) {
          if (!theirs[t]) continue;
          let supported = false;
          for (let m = 0; m < COUNT && !supported; m++) {
            supported = mine[m] && allows(VARIANTS[m].tile, VARIANTS[t].tile);
          }
          if (!supported) {
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
  for (;;) {
    // The undecided cell with the fewest tiles left, ties broken at random.
    let best: Cell | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const cell of cells) {
      const count = possible[index(cell.storey, cell.col, cell.row)].filter(Boolean).length;
      if (count <= 1) continue;
      const score = count + next() * 0.5;
      if (score < bestScore) {
        best = cell;
        bestScore = score;
      }
    }
    if (!best) break;
    const here = possible[index(best.storey, best.col, best.row)];
    const weights = VARIANTS.map((variant, v) =>
      here[v] ? (best.storey > 0 ? variant.high : variant.ground) || 0.01 : 0,
    );
    let pick = next() * weights.reduce((a, b) => a + b, 0);
    let chosen = 0;
    while ((pick >= weights[chosen] || weights[chosen] === 0) && chosen < COUNT - 1) {
      pick -= weights[chosen];
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
  const key = ({ storey, col, row }: Cell) => `${storey},${col},${row}`;
  for (const cell of cells) {
    const v = possible[index(cell.storey, cell.col, cell.row)].indexOf(true);
    tiles.set(key(cell), VARIANTS[v].tile);
  }
  const tileAt = (cell: Cell) => tiles.get(key(cell));

  // 3. Everything that can't be walked to from the entrance is filled in, or taken away.
  const reached = new Set<string>([key(entrance)]);
  const queue = [entrance];
  while (queue.length > 0) {
    const cell = queue.pop() as Cell;
    const tile = tileAt(cell) as Tile;
    const steps: Cell[] = [];
    for (const side of SIDES) {
      const [dx, dz] = OFFSET[side];
      const other = { storey: cell.storey, col: cell.col + dx, row: cell.row + dz };
      const theirs = tileAt(other);
      if (!theirs || edgeAt(cell.storey, cell.col, cell.row, side) === "wall") continue;
      if (WALKS.includes(socket(tile, side)) && WALKS.includes(socket(theirs, OPPOSITE[side]))) {
        steps.push(other);
      }
    }
    // Up stairs or a ladder, and down them from where they arrive.
    if (tile.kind === "stairs" || tile.kind === "ladder") {
      const [dx, dz] = OFFSET[tile.up];
      steps.push({ storey: cell.storey + 1, col: cell.col + dx, row: cell.row + dz });
    }
    for (const side of SIDES) {
      const [dx, dz] = OFFSET[side];
      const below = { storey: cell.storey - 1, col: cell.col - dx, row: cell.row - dz };
      const climb = tileAt(below);
      if ((climb?.kind === "stairs" || climb?.kind === "ladder") && climb.up === side) {
        steps.push(below);
      }
    }
    for (const step of steps) {
      if (reached.has(key(step))) continue;
      reached.add(key(step));
      queue.push(step);
    }
  }
  const walkable = (tile: Tile) =>
    tile.kind === "floor" ||
    tile.kind === "tv" ||
    tile.kind === "ladder" ||
    tile.kind === "stairs" ||
    tile.kind === "bridge";
  for (const cell of cells) {
    const tile = tileAt(cell) as Tile;
    if (!walkable(tile) || reached.has(key(cell))) continue;
    if (tile.kind === "bridge") tiles.set(key(cell), { kind: "pit" });
    // In the ground, rock; above it, air.
    else tiles.set(key(cell), cell.storey <= 0 ? { kind: "solid" } : { kind: "open" });
    if (tile.kind === "stairs" || tile.kind === "ladder") {
      tiles.set(key({ ...cell, storey: cell.storey + 1 }), { kind: "open" });
    }
  }
  // Doorways onto what's gone become walls.
  for (const [edgeId, edge] of edges) {
    if (edge !== "door") continue;
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

  // Every storey needs somewhere to stand, or it isn't worth having.
  for (let storey = -basements; storey < storeys - basements; storey++) {
    const count = cells.filter((cell) => cell.storey === storey && reached.has(key(cell))).length;
    if (count < 3) return `storey ${storey} can hardly be reached`;
  }

  const grid = {
    basements,
    storeys: drawStoreys(options, tileAt, edgeAt),
  };
  const problem = checkTiles(parseTiles({ ...grid, x: 0, z: 0 }));
  if (problem) return problem;
  const floors = cells.filter((cell) => reached.has(key(cell)) && tileAt(cell)?.kind === "floor");
  return { grid, entrance, floors };
}

/**
 * Split a storey into rooms, from one big one, and decide which are open air above the storey below
 * (only above the ground, and never all of them). Walls go between rooms that aren't open air, and
 * doorways join them all up, along a spanning tree, with a few more for loops. Open-air rooms have
 * no walls round them: the floors beside them get railings instead. Returns which cells are open air.
 */
function layOutRooms(
  cols: number,
  rows: number,
  aboveGround: boolean,
  next: () => number,
  setEdge: (col: number, row: number, side: Side, edge: Edge) => void,
): boolean[] {
  const room = new Array<number>(cols * rows);
  let rooms = 0;
  const split = (col: number, row: number, width: number, depth: number) => {
    const area = width * depth;
    const stop = area <= 2 ? 1 : area <= 4 ? 0.6 : area <= 8 ? 0.3 : 0;
    if (next() < stop) {
      for (let r = row; r < row + depth; r++) {
        for (let c = col; c < col + width; c++) room[r * cols + c] = rooms;
      }
      rooms++;
      return;
    }
    // Cut the long way, and not off a strip one cell thin unless it's narrow already.
    const cut = (length: number) =>
      length <= 3 ? 1 + Math.floor(next() * (length - 1)) : 2 + Math.floor(next() * (length - 3));
    if (width >= depth) {
      const at = cut(width);
      split(col, row, at, depth);
      split(col + at, row, width - at, depth);
    } else {
      const at = cut(depth);
      split(col, row, width, at);
      split(col, row + at, width, depth - at);
    }
  };
  split(0, 0, cols, rows);
  const airy = Array.from({ length: rooms }, () => aboveGround && next() < 0.35);
  if (airy.every(Boolean)) airy[0] = false;

  // The edges between each pair of solid rooms that touch.
  const between = new Map<string, [number, number, Side][]>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      for (const side of ["n", "e"] as const) {
        const [dx, dz] = OFFSET[side];
        if (col + dx >= cols || row + dz >= rows) continue;
        const a = room[row * cols + col];
        const b = room[(row + dz) * cols + col + dx];
        if (a === b || airy[a] || airy[b]) continue;
        setEdge(col, row, side, "wall");
        const pair = `${Math.min(a, b)},${Math.max(a, b)}`;
        between.set(pair, [...(between.get(pair) ?? []), [col, row, side]]);
      }
    }
  }
  // A spanning tree of doorways, in random order, so every room is joined; then a few loops.
  const parent = Array.from({ length: rooms }, (_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const pairs = [...between.keys()].sort().map((pair) => ({ pair, order: next() }));
  pairs.sort((a, b) => a.order - b.order);
  for (const { pair } of pairs) {
    const [a, b] = pair.split(",").map(Number);
    const joins = find(a) !== find(b);
    if (!joins && next() > 0.25) continue;
    parent[find(a)] = find(b);
    const options = between.get(pair) ?? [];
    const [col, row, side] = options[Math.floor(next() * options.length)];
    setEdge(col, row, side, "door");
  }
  return room.map((id) => airy[id]);
}

/** A generated storey, drawn with its walls as `parseTiles` reads them. */
function drawStoreys(
  { cols, rows, storeys, basements }: GenerateOptions,
  tileAt: (cell: Cell) => Tile | undefined,
  edgeAt: (storey: number, col: number, row: number, side: Side) => Edge,
): string[][] {
  const result: string[][] = [];
  for (let storey = -basements; storey < storeys - basements; storey++) {
    const lines: string[] = [];
    for (let row = rows - 1; row >= 0; row--) {
      let top = "+";
      let middle = "";
      for (let col = 0; col < cols; col++) {
        const north = edgeAt(storey, col, row, "n");
        top += `${north === "door" ? "d" : north === "wall" ? "-" : " "}+`;
        const west = edgeAt(storey, col, row, "w");
        middle += west === "door" ? "d" : west === "wall" ? "|" : " ";
        middle += tileChar(tileAt({ storey, col, row }) as Tile);
      }
      const east = edgeAt(storey, cols - 1, row, "e");
      middle += east === "door" ? "d" : "|";
      lines.push(top, middle);
    }
    lines.push(`+${"-+".repeat(cols)}`);
    result.push(lines);
  }
  return result;
}
