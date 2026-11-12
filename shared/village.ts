import type { Box } from "./collision";
import type { ItemKind } from "./constants";
import type { Floor, ItemSpawn, LevelBox } from "./level";

/**
 * The village: a farm hamlet on the floor of a West Norwegian valley, abandoned since the 1960s. A
 * gravel track comes in from the south, where the crew's truck stops, and runs north through the
 * hamlet beside a small river to a stave church on a knoll. Farmsteads stand round their yards on
 * both sides of the track, one across the river over a footbridge, and a boathouse by a pool in it.
 * Steep valley sides close it in.
 *
 * Pure and seeded, like shared/generate.ts, so the server and every client build the same village:
 * `villageLayout()` gives what the server needs (floors and boxes, items, the truck) and what the
 * client draws (every model's place, client/src/village.ts). `villageGround()` is the height of the
 * ground anywhere, drawn and walked on alike.
 *
 * Players walk on floors, flat or ramps (shared/level.ts), so the walkable ground is built of them:
 * the valley floor rises gently north as ramps in strips across the valley, cut by the river's
 * channel, whose banks are ramps across it; the knoll is a flat top, reached by a ramp between
 * stone walls. Everywhere players can stand, `villageGround()` is exactly the floor's height (the
 * river's banks to within a few centimetres), so nothing floats or sinks. Outside, the ground rises
 * freely into the valley sides, where scenery boxes keep players out.
 *
 * x runs east, z north, y up, in meters; the truck stops at the south end, around z = -120.
 */

/** The village's seed: there's one village for now, `?level=village`. */
export const VILLAGE_SEED = 1;

/** Every model the village is drawn from, `models/village/<name>.glb`: width (x), depth (z) and height. */
export const VILLAGE_MODELS = {
  "log-farmhouse": [11, 6.5, 5.5],
  stabbur: [5, 5.5, 6],
  boathouse: [5, 9, 4.5],
  outhouse: [1.4, 1.4, 2.4],
  woodshed: [4, 3, 3],
  "clad-house": [9, 7.5, 7.5],
  barn: [15, 9, 8.5],
  "stave-church": [9, 15, 17],
  "roundpole-fence": [4, 0.5, 1.2],
  "stone-wall": [4, 0.9, 1],
  "stone-wall-end": [1.2, 0.9, 1],
  "field-gate": [3, 0.3, 1.3],
  "hay-rack": [6, 0.5, 1.9],
  well: [1.6, 1.6, 2.2],
  rowboat: [1.5, 4.8, 0.7],
  "hay-cart": [1.6, 3.6, 1.5],
  woodpile: [2.4, 0.8, 1.3],
  "milk-ramp": [2, 1.4, 1.5],
  "power-pole": [0.4, 1.8, 8],
  "grave-cross": [0.6, 0.2, 1.1],
  grindstone: [1.1, 0.6, 1],
  sledge: [0.9, 2.4, 0.6],
  "spruce-a": [4, 4, 14],
  "spruce-b": [3, 3, 9],
  "birch-a": [5, 5, 11],
  "birch-b": [3.5, 3.5, 7],
  "birch-dead": [3, 3, 8],
  "boulder-a": [3.5, 3, 2.4],
  "boulder-b": [2, 1.8, 1.3],
  "boulder-c": [1, 0.9, 0.6],
  "rock-outcrop": [8, 6, 3.5],
  stump: [0.8, 0.8, 0.6],
  "fallen-log": [0.8, 6, 0.7],
  "grass-tuft": [0.8, 0.8, 0.5],
  heather: [1, 1, 0.35],
  fern: [0.9, 0.9, 0.6],
} as const satisfies Record<string, readonly [number, number, number]>;
export type VillageModel = keyof typeof VILLAGE_MODELS;

/**
 * A model standing in the village. Its origin is the middle of its base, and its front faces `turn`
 * radians round y from north (+z), clockwise seen from above, as `PropSpawn.turn` does.
 */
export interface VillagePlacement {
  model: VillageModel;
  x: number;
  y: number;
  z: number;
  turn: number;
}

/** A footbridge's deck, which the client draws: players walk on it, `y` is its top. */
export interface Bridge extends Box {
  y: number;
}

export interface VillageLayout {
  floors: Floor[];
  /** Everything solid, all of kind "scenery": the client draws them as models, or not at all. */
  boxes: LevelBox[];
  items: ItemSpawn[];
  /** Where the truck stops: the level's dock. */
  dock: Box;
  /** Where players start, in order, beside the truck. */
  spawns: { x: number; y: number; z: number }[];
  /** Every model, solid or not. */
  placements: VillagePlacement[];
  bridges: Bridge[];
  /** Yards, kept clear: for the client to wear the grass down in. */
  yards: Box[];
}

/** The walkable valley floor runs from here north to `NORTH`, where the knoll rises. */
export const SOUTH = -136;
const NORTH = 108;
/** The knoll's flat top, and how high it is. */
const PLATEAU: Box = { minX: -12, maxX: 10, minZ: 110, maxZ: 134 };
const KNOLL_TOP = 7;
/** How far round the top the knoll's sides fall to the valley floor. */
const KNOLL_SLOPE = 5;
/** The ramp up to the churchyard gate: half its width, and where it starts and ends. */
const PATH = { half: 2.5, from: 94, to: PLATEAU.minZ };
/** How far either side of the ramp its embankment falls to the valley floor. */
const EMBANKMENT = 4;
/** The river: how deep its bed is below the banks, how wide each bank's slope, and the water's depth below the banks. */
export const RIVER_DEPTH = 0.6;
export const RIVER_BANK = 2;
export const RIVER_WATER = 0.15;
/** Half the track's width. */
export const ROAD_HALF = 2;
/** The valley side starts to rise this far outside the walkable floor. */
const SIDE_START = 0.5;
/** The least gap left between solid things placed at random, so there's always a way between them. */
const WAY = 1.4;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Heights of the valley floor going north: straight between these, every one at a whole meter. */
const FLOOR_KNOTS: [number, number][] = [
  [-2000, 0],
  [-90, 0],
  [-40, 0.6],
  [20, 1.6],
  [70, 2.4],
  [100, 2.8],
  [150, 2.8],
];
const HEADWALL = 150;

/** The index of the knot that starts the stretch of floor holding [z, z + 1). */
function knotOf(z: number): number {
  let i = 0;
  while (i < FLOOR_KNOTS.length - 2 && FLOOR_KNOTS[i + 1][0] <= z) i++;
  return i;
}

/** The valley floor's height at a point north or south, before the river and the sides. */
export function valleyFloor(z: number): number {
  if (z > HEADWALL) {
    // The headwall at the valley's head, levelling off at the top.
    const h = 2.8 + 0.004 * (z - HEADWALL) ** 2;
    return h < 200 ? h : 200 + (h - 200) * 0.1;
  }
  const i = knotOf(z);
  const [z0, y0] = FLOOR_KNOTS[i];
  const [z1, y1] = FLOOR_KNOTS[i + 1];
  return lerp(y0, y1, (z - z0) / (z1 - z0));
}

/** Where the middle of the track is, across the valley. It meets the knoll's ramp at x = 0. */
export function roadX(z: number): number {
  return (-4 + 5 * Math.sin((z + 40) / 42)) * smooth((PATH.from + 2 - z) / 30);
}

/** Where the middle of the river is. */
export function riverX(z: number): number {
  return 26 + 7 * Math.sin(z / 33 + 0.6) + 3 * Math.sin(z / 11.5 + 2);
}

/** Half the width of the river's bed: wider at the pool by the boathouse. */
function riverHalf(z: number): number {
  return 2.4 + 0.7 * Math.sin(z / 19) + 2.6 * Math.exp(-(((z - 60) / 9) ** 2));
}

/** The walkable floor's west and east edges. */
export function westEdge(z: number): number {
  return -46 + 5 * Math.sin(z / 37 + 1) + 3 * Math.sin(z / 13);
}
export function eastEdge(z: number): number {
  return riverX(z) + 24 + 4 * Math.sin(z / 29);
}

/**
 * The river's bed in the strip of valley [strip, strip + 1), from x = `a` to `b`, whole meters so
 * the drawn ground's vertices fall on its edges. Its banks slope down to it over `RIVER_BANK`.
 */
export function channel(strip: number): { a: number; b: number } {
  const z = strip + 0.5;
  const middle = riverX(z);
  const half = riverHalf(z);
  return { a: Math.round(middle - half), b: Math.round(middle + half) };
}

/** The water's surface, at a point north or south. */
export function waterLevel(z: number): number {
  return valleyFloor(z) - RIVER_WATER;
}

/** The ramp up the knoll at a point along it. */
function pathHeight(z: number): number {
  return lerp(valleyFloor(PATH.from), KNOLL_TOP, clamp01((z - PATH.from) / (PATH.to - PATH.from)));
}

function hash(ix: number, iz: number, salt: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash(ix, iz, salt);
  const b = hash(ix + 1, iz, salt);
  const c = hash(ix, iz + 1, salt);
  const d = hash(ix + 1, iz + 1, salt);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

/** Fractal noise from 0 to 1, about 0.5 on average. */
export function fbm(x: number, z: number, octaves: number, salt: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x, z, salt + i * 17);
    total += amplitude;
    x *= 2.03;
    z *= 2.03;
    amplitude *= 0.5;
  }
  return sum / total;
}

/** How far a valley side has risen, `s` meters out from where it starts. */
function sideRise(s: number, x: number, z: number): number {
  const steep = s < 10 ? 0.04 * s * s : 4 + 0.9 * (s - 10) + 0.0011 * (s - 10) ** 2;
  // Levelling off into the fells, so a ridge line shows against the sky, with peaks along it.
  const ridge = 150 + 110 * fbm(x / 160, z / 160, 3, 13);
  const base = steep < ridge ? steep : ridge + (steep - ridge) * 0.12;
  // Ridges and gullies, growing with the height.
  const rough = (fbm(x / 45, z / 45, 4, 11) - 0.5) * Math.min(1, s / 14) * (8 + 0.2 * s);
  return Math.max(0, base + rough);
}

/** Meters outside the walkable valley floor, across the valley: below 0 inside it. */
export function outside(x: number, z: number): number {
  return Math.max(westEdge(z) - x, x - eastEdge(z));
}

/**
 * How high the ground is anywhere, as drawn. Where players can stand it's the floors' height:
 * the valley floor and the river's channel in it, the knoll's top and the ramp up to it.
 */
export function villageGround(x: number, z: number): number {
  const floor = valleyFloor(z);
  // The ramp up the knoll, between its walls.
  if (Math.abs(x) <= PATH.half && z >= PATH.from && z <= PATH.to) return pathHeight(z);
  let h = floor;
  const { a, b } = channel(Math.floor(z));
  if (x > a - RIVER_BANK && x < b + RIVER_BANK) {
    const t =
      x < a ? (x - (a - RIVER_BANK)) / RIVER_BANK : x > b ? (b + RIVER_BANK - x) / RIVER_BANK : 1;
    h -= RIVER_DEPTH * t;
  }
  const s = outside(x, z) - SIDE_START;
  if (s > 0) h += sideRise(s, x, z);
  // The knoll: a flat top, its sides falling steeply and rockily to the valley floor.
  const dx = Math.max(PLATEAU.minX - x, 0, x - PLATEAU.maxX);
  const dz = Math.max(PLATEAU.minZ - z, 0, z - PLATEAU.maxZ);
  const d = Math.hypot(dx, dz);
  if (d === 0) return KNOLL_TOP;
  if (d < KNOLL_SLOPE) {
    const rock = (fbm(x / 3, z / 3, 3, 23) - 0.5) * 1.6 * Math.sin((Math.PI * d) / KNOLL_SLOPE);
    h = Math.max(h, floor + (KNOLL_TOP - floor) * (1 - smooth(d / KNOLL_SLOPE)) + rock);
  }
  // The embankment the ramp runs up on.
  const across = Math.abs(x) - PATH.half;
  if (across > 0 && across < EMBANKMENT && z >= PATH.from && z <= PATH.to) {
    const top = pathHeight(z);
    h = Math.max(h, top - (top - floor) * smooth(across / EMBANKMENT));
  }
  return h;
}

/** A seeded random number generator: mulberry32. */
function random(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlaps = (a: Box, b: Box) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
/** The gap between two boxes: 0 or less if they touch or overlap. */
const gapBetween = (a: Box, b: Box) =>
  Math.max(a.minX - b.maxX, b.minX - a.maxX, a.minZ - b.maxZ, b.minZ - a.maxZ);
const around = (x: number, z: number, hx: number, hz: number): Box => ({
  minX: x - hx,
  maxX: x + hx,
  minZ: z - hz,
  maxZ: z + hz,
});
const grown = (box: Box, by: number): Box => ({
  minX: box.minX - by,
  maxX: box.maxX + by,
  minZ: box.minZ - by,
  maxZ: box.maxZ + by,
});

/** Boxes filed in a grid, to find those near a point quickly. */
class Grid {
  private readonly cells = new Map<number, Box[]>();
  readonly all: Box[] = [];
  constructor(private readonly size = 8) {}
  private key(col: number, row: number) {
    return (col + 4096) * 8192 + (row + 4096);
  }
  add(box: Box) {
    this.all.push(box);
    for (
      let col = Math.floor(box.minX / this.size);
      col <= Math.floor(box.maxX / this.size);
      col++
    ) {
      for (
        let row = Math.floor(box.minZ / this.size);
        row <= Math.floor(box.maxZ / this.size);
        row++
      ) {
        const cell = this.cells.get(this.key(col, row));
        if (cell) cell.push(box);
        else this.cells.set(this.key(col, row), [box]);
      }
    }
  }
  /** Whether anything filed comes within `gap` of a box. */
  near(box: Box, gap: number): boolean {
    const area = grown(box, gap);
    for (
      let col = Math.floor(area.minX / this.size);
      col <= Math.floor(area.maxX / this.size);
      col++
    ) {
      for (
        let row = Math.floor(area.minZ / this.size);
        row <= Math.floor(area.maxZ / this.size);
        row++
      ) {
        for (const other of this.cells.get(this.key(col, row)) ?? []) {
          if (gapBetween(box, other) < gap) return true;
        }
      }
    }
    return false;
  }
}

/** How far a model's footprint reaches either way, turned a whole number of quarter turns. */
function halfExtents(model: VillageModel, turn: number, scale = 1): [number, number] {
  const [w, d] = VILLAGE_MODELS[model];
  const c = Math.abs(Math.cos(turn));
  const s = Math.abs(Math.sin(turn));
  return [((w * c + d * s) / 2) * scale, ((w * s + d * c) / 2) * scale];
}

/** The lowest ground under a footprint's corners and middle: what a level model stands at. */
function lowestUnder(box: Box): number {
  const { minX, maxX, minZ, maxZ } = box;
  return Math.min(
    villageGround(minX, minZ),
    villageGround(maxX, minZ),
    villageGround(minX, maxZ),
    villageGround(maxX, maxZ),
    villageGround((minX + maxX) / 2, (minZ + maxZ) / 2),
  );
}

/** Builds the village from a seed. The same seed gives the same village, on every machine. */
export function villageLayout(seed: number): VillageLayout {
  const rand = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const floors: Floor[] = [];
  const boxes: LevelBox[] = [];
  const items: ItemSpawn[] = [];
  const placements: VillagePlacement[] = [];
  const bridges: Bridge[] = [];
  const yards: Box[] = [];
  /** Everything solid placed so far, and the places to keep clear: the track, yards, fronts of buildings. */
  const solids = new Grid();
  const clear = new Grid(16);

  const solid = (box: Box, y: number, height: number) => {
    boxes.push({ ...box, y, height, kind: "scenery" });
    solids.add(box);
  };
  const keepClear = (box: Box) => clear.add(box);
  /** Whether a box is clear of the places kept clear, and at least `gap` from anything solid. */
  const fits = (box: Box, gap = WAY) => !clear.near(box, 0) && !solids.near(box, gap);
  /** Whether a point is in the walkable valley, `margin` inside its edges, off the knoll and ramp. */
  const inValley = (x: number, z: number, margin = 0) =>
    z > SOUTH + margin &&
    z < NORTH - margin &&
    x > westEdge(z) + margin &&
    x < eastEdge(z) - margin &&
    !(
      z > PATH.from - margin &&
      x > PLATEAU.minX - KNOLL_SLOPE - margin &&
      x < PLATEAU.maxX + KNOLL_SLOPE + margin
    );
  const inRiver = (x: number, z: number, margin = 0) => {
    const { a, b } = channel(Math.floor(z));
    return x > a - RIVER_BANK - margin && x < b + RIVER_BANK + margin;
  };

  /**
   * Stands a model at a point, at the lowest ground under its footprint, with a box over what's
   * solid of it: `solidScale` of its footprint, as high as `height` (its own by default).
   */
  const place = (
    model: VillageModel,
    x: number,
    z: number,
    turn: number,
    {
      solidScale = 1,
      height,
      sink = 0,
      y,
    }: { solidScale?: number; height?: number; sink?: number; y?: number } = {},
  ) => {
    const [hx, hz] = halfExtents(model, turn);
    const footprint = around(x, z, hx, hz);
    const ground = y ?? lowestUnder(footprint) - sink;
    placements.push({ model, x, y: ground, z, turn });
    if (solidScale > 0) {
      const [sx, sz] = halfExtents(model, turn, solidScale);
      solid(around(x, z, sx, sz), ground - 0.5, (height ?? VILLAGE_MODELS[model][2]) + 0.5);
    }
    return footprint;
  };
  /** Places a model only if its solid footprint fits; whether it did. */
  const tryPlace = (
    model: VillageModel,
    x: number,
    z: number,
    turn: number,
    solidScale = 1,
    gap = WAY,
    y?: number,
  ) => {
    const [hx, hz] = halfExtents(model, turn, solidScale);
    if (!fits(around(x, z, hx, hz), gap)) return false;
    place(model, x, z, turn, { solidScale, y });
    return true;
  };
  /** A tree's height: the lowest ground round its trunk, a little lower, so no root shows. */
  const treeY = (x: number, z: number) => lowestUnder(around(x, z, 0.4, 0.4)) - 0.15;
  const item = (kind: ItemKind, x: number, z: number) => {
    const lift = { phone: 0.1, flashlight: 0.05, tv: 0.5, box: 0.6, sofa: 0.5 }[kind];
    items.push({ kind, x, y: villageGround(x, z) + lift, z });
  };

  // --- The ground: the valley floor in strips across it, cut by the river's channel. ---
  const ground = (
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    rise?: Floor["rise"],
  ): Floor => ({
    minX,
    maxX,
    minZ,
    maxZ,
    y,
    thickness: 0.5,
    kind: "ground",
    ...(rise ? { rise } : {}),
  });
  for (let start = SOUTH - 2; start < NORTH; ) {
    const { a, b } = channel(start);
    const knot = knotOf(start);
    let end = start + 1;
    while (end < NORTH && knotOf(end) === knot && channel(end).a === a && channel(end).b === b)
      end++;
    const y0 = valleyFloor(start);
    const y1 = valleyFloor(end);
    const rise = y1 - y0 > 1e-9 ? { toward: "n" as const, height: y1 - y0 } : undefined;
    floors.push(ground(-140, a - RIVER_BANK, start, end, y0, rise));
    floors.push(ground(a, b, start, end, y0 - RIVER_DEPTH, rise));
    floors.push(ground(b + RIVER_BANK, 160, start, end, y0, rise));
    // The banks slope across the valley, so they can't also rise along it: a strip each, where it does.
    const step = rise ? 1 : end - start;
    for (let z = start; z < end; z += step) {
      const y = valleyFloor(z + step / 2) - RIVER_DEPTH;
      floors.push(ground(a - RIVER_BANK, a, z, z + step, y, { toward: "w", height: RIVER_DEPTH }));
      floors.push(ground(b, b + RIVER_BANK, z, z + step, y, { toward: "e", height: RIVER_DEPTH }));
    }
    start = end;
  }
  // The knoll's top, and the ramp up to it.
  floors.push(ground(PLATEAU.minX, PLATEAU.maxX, PLATEAU.minZ, PLATEAU.maxZ, KNOLL_TOP));
  const pathFoot = pathHeight(PATH.from);
  floors.push(
    ground(-PATH.half, PATH.half, PATH.from, PATH.to, pathFoot, {
      toward: "n",
      height: KNOLL_TOP - pathFoot,
    }),
  );

  // --- The edges: the valley sides, the ends of the valley, the knoll's sides. ---
  const SEGMENT = 2;
  for (let z = SOUTH - 4; z < NORTH + 4; z += SEGMENT) {
    const west = Math.max(westEdge(z), westEdge(z + SEGMENT));
    const east = Math.min(eastEdge(z), eastEdge(z + SEGMENT));
    const y = valleyFloor(z) - 1;
    solid({ minX: west - 4, maxX: west, minZ: z, maxZ: z + SEGMENT }, y, 7);
    solid({ minX: east, maxX: east + 4, minZ: z, maxZ: z + SEGMENT }, y, 7);
  }
  const knollFoot = grown(PLATEAU, KNOLL_SLOPE);
  // Across the valley behind the truck, and north of it either side of the knoll.
  solid(
    { minX: westEdge(SOUTH) - 8, maxX: eastEdge(SOUTH) + 8, minZ: SOUTH - 4, maxZ: SOUTH },
    -1,
    7,
  );
  const northY = valleyFloor(NORTH) - 1;
  solid({ minX: -80, maxX: knollFoot.minX, minZ: NORTH, maxZ: NORTH + 4 }, northY, 8);
  solid({ minX: knollFoot.maxX, maxX: 120, minZ: NORTH, maxZ: NORTH + 4 }, northY, 8);
  // The knoll's sides, all round its top but where the ramp comes up.
  const knollY = valleyFloor(PATH.from) - 1;
  const knollHeight = KNOLL_TOP + 1.5 - knollY;
  solid(
    { minX: knollFoot.minX, maxX: PLATEAU.minX, minZ: knollFoot.minZ, maxZ: knollFoot.maxZ },
    knollY,
    knollHeight,
  );
  solid(
    { minX: PLATEAU.maxX, maxX: knollFoot.maxX, minZ: knollFoot.minZ, maxZ: knollFoot.maxZ },
    knollY,
    knollHeight,
  );
  solid(
    { minX: PLATEAU.minX, maxX: PLATEAU.maxX, minZ: PLATEAU.maxZ, maxZ: knollFoot.maxZ },
    knollY,
    knollHeight,
  );
  for (const [minX, maxX] of [
    [PLATEAU.minX, -PATH.half],
    [PATH.half, PLATEAU.maxX],
  ]) {
    solid({ minX, maxX, minZ: knollFoot.minZ, maxZ: PLATEAU.minZ }, knollY, knollHeight);
  }
  // The ramp's embankment, under stone walls either side, in steps as high as the ramp beside them.
  for (let z = PATH.from; z < knollFoot.minZ; z += 4) {
    const top = pathHeight(Math.min(z + 4, PATH.to)) + 1;
    for (const [minX, maxX] of [
      [-PATH.half - EMBANKMENT, -PATH.half],
      [PATH.half, PATH.half + EMBANKMENT],
    ]) {
      solid({ minX, maxX, minZ: z, maxZ: Math.min(z + 4, knollFoot.minZ) }, knollY, top - knollY);
    }
  }
  for (let z = PATH.from; z < PATH.to - 0.5; z += 4) {
    for (const side of [-1, 1]) {
      const x = side * (PATH.half + 0.45);
      placements.push({
        model: "stone-wall",
        x,
        y: villageGround(x, z) - 0.05,
        z: z + 2,
        turn: Math.PI / 2,
      });
    }
  }

  // --- The track, and the truck at its south end. ---
  for (let z = SOUTH; z < PATH.from + 2; z += 2) {
    const x = roadX(z + 1);
    keepClear({ minX: x - ROAD_HALF - 1, maxX: x + ROAD_HALF + 1, minZ: z, maxZ: z + 2 });
  }
  keepClear({ minX: -PATH.half, maxX: PATH.half, minZ: PATH.from, maxZ: PATH.to + 2 });
  const truckZ = -120;
  const truckX = roadX(truckZ);
  const dock = { minX: truckX - 1.5, maxX: truckX + 1.5, minZ: truckZ - 4, maxZ: truckZ + 4 };
  keepClear({ minX: truckX - 8, maxX: truckX + 8, minZ: SOUTH, maxZ: truckZ + 12 });
  const spawns: VillageLayout["spawns"] = [];
  for (let i = 0; i < 8; i++) {
    const z = truckZ + 6 + (Math.floor(i / 4) % 2) * 1.5;
    const x = roadX(z) - 3 + (i % 4) * 2;
    spawns.push({ x, y: villageGround(x, z), z });
  }
  for (const [i, dx] of [-0.6, -0.2, 0.2, 0.6].entries())
    item("flashlight", truckX + dx, truckZ + 5 + (i % 2) * 0.3);

  // --- The churchyard on the knoll. ---
  const churchX = (PLATEAU.minX + PLATEAU.maxX) / 2;
  const churchZ = 124;
  place("stave-church", churchX, churchZ, Math.PI, { y: KNOLL_TOP });
  const churchFront = churchZ - VILLAGE_MODELS["stave-church"][1] / 2;
  keepClear({ minX: churchX - 3, maxX: churchX + 3, minZ: PATH.to, maxZ: churchFront });
  item("box", churchX + 1.6, churchFront - 1.5);
  item("phone", churchX - 1.2, churchFront - 1);
  item("phone", churchX - 0.6, churchFront - 1.2);
  // Its wall, just inside the top's edge, with a gap for the gate.
  // A wall along a line of the churchyard. Its segments meet the next wall at the corners; where it
  // stops at the gate, `ends` says which end, it finishes in a wall end, whose flat end (at the
  // model's -x) meets the last segment and whose rubble spills on towards the gate.
  const END = 1.25;
  const wallLine = (x0: number, z0: number, x1: number, z1: number, ends: (0 | 1)[] = []) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const reserved = ends.length * END;
    const count = Math.floor((length - reserved) / 4);
    const turn = x0 === x1 ? Math.PI / 2 : 0;
    const spare = (length - reserved - count * 4) / 2;
    const start = (ends.includes(0) ? END : 0) + spare;
    const at = (d: number) => ({ x: lerp(x0, x1, d / length), z: lerp(z0, z1, d / length) });
    for (let i = 0; i < count; i++) {
      const { x, z } = at(start + 2 + i * 4);
      place("stone-wall", x, z, turn, { y: KNOLL_TOP - 0.05, solidScale: 1 });
    }
    // Whether the model's +x runs the way the line does.
    const along = Math.cos(turn) * (x1 - x0) - Math.sin(turn) * (z1 - z0) > 0;
    for (const end of ends) {
      const { x, z } = at(end === 0 ? start - END / 2 : start + count * 4 + END / 2);
      // At the line's far end the wall is behind it: its flat -x faces back along the line.
      const flip = (end === 1) === along ? 0 : Math.PI;
      place("stone-wall-end", x, z, turn + flip, { y: KNOLL_TOP - 0.05, solidScale: 0.8 });
    }
  };
  const inset = 0.6;
  const wallBox = grown(PLATEAU, -inset);
  wallLine(wallBox.minX, wallBox.maxZ, wallBox.maxX, wallBox.maxZ);
  wallLine(wallBox.minX, wallBox.minZ, wallBox.minX, wallBox.maxZ);
  wallLine(wallBox.maxX, wallBox.minZ, wallBox.maxX, wallBox.maxZ);
  wallLine(wallBox.minX, wallBox.minZ, -PATH.half - 0.4, wallBox.minZ, [1]);
  wallLine(PATH.half + 0.4, wallBox.minZ, wallBox.maxX, wallBox.minZ, [0]);
  // Graves either side of the church, in rows, facing the ramp.
  const [churchHalfX] = halfExtents("stave-church", Math.PI);
  for (const [from, to] of [
    [wallBox.minX + 1.4, churchX - churchHalfX - 1.6],
    [churchX + churchHalfX + 1.6, wallBox.maxX - 1.4],
  ]) {
    for (let z = PATH.to + 3; z < wallBox.maxZ - 1.5; z += 1.9) {
      for (let x = from; x <= to; x += 1.5) {
        if (rand() < 0.25) continue;
        const turn = Math.PI + (rand() - 0.5) * 0.12;
        place("grave-cross", x + (rand() - 0.5) * 0.2, z, turn, {
          y: KNOLL_TOP - 0.1 - rand() * 0.15,
        });
      }
    }
  }
  // A birch by the gate, and spruce behind the church.
  placements.push({
    model: "birch-a",
    x: wallBox.minX + 1.2,
    y: KNOLL_TOP - 0.2,
    z: wallBox.minZ + 1.5,
    turn: rand() * 6,
  });
  placements.push({
    model: "spruce-a",
    x: wallBox.maxX - 1.5,
    y: KNOLL_TOP - 0.2,
    z: wallBox.maxZ - 1.5,
    turn: rand() * 6,
  });
  placements.push({
    model: "spruce-b",
    x: wallBox.minX + 1.5,
    y: KNOLL_TOP - 0.2,
    z: wallBox.maxZ - 1.2,
    turn: rand() * 6,
  });

  // --- The farmsteads: buildings round a yard, each open to the track. ---
  interface Tun {
    /** Which side of whatever it opens onto: -1 west, 1 east. */
    side: -1 | 1;
    z: number;
    /** The x of the edge it opens onto: the track's side, or the river's bank. */
    edge: number;
    house: "log-farmhouse" | "clad-house";
    yard: number;
    depth: number;
    barn: boolean;
    stabbur: boolean;
    /** Loot: what lies about the yard. */
    loot: ItemKind[];
  }
  const tun = ({ side, z, edge, house, yard: width, depth, barn, stabbur, loot }: Tun) => {
    const near = edge + side * 3;
    const far = near + side * width;
    const yard = {
      minX: Math.min(near, far),
      maxX: Math.max(near, far),
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    };
    const middle = (yard.minX + yard.maxX) / 2;
    keepClear(yard);
    yards.push(yard);
    // The way in from the track.
    keepClear({ minX: Math.min(edge, near), maxX: Math.max(edge, near), minZ: z - 3, maxZ: z + 3 });
    const fronts: { x: number; z: number; turn: number }[] = [];
    const building = (model: VillageModel, x: number, bz: number, turn: number) => {
      const footprint = place(model, x, bz, turn);
      // The way in at its front.
      const fx = Math.sin(turn);
      const fz = Math.cos(turn);
      const [hx, hz] = halfExtents(model, turn);
      const reach = 2.5;
      keepClear({
        minX: fx > 0.5 ? footprint.maxX : fx < -0.5 ? footprint.minX - reach : footprint.minX,
        maxX: fx > 0.5 ? footprint.maxX + reach : fx < -0.5 ? footprint.minX : footprint.maxX,
        minZ: fz > 0.5 ? footprint.maxZ : fz < -0.5 ? footprint.minZ - reach : footprint.minZ,
        maxZ: fz > 0.5 ? footprint.maxZ + reach : fz < -0.5 ? footprint.minZ : footprint.maxZ,
      });
      fronts.push({ x: x + fx * (hx + 1), z: bz + fz * (hz + 1), turn });
      return footprint;
    };
    // The house across the yard, facing it.
    const houseTurn = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const [houseX] = halfExtents(house, houseTurn);
    const hx = far + side * (houseX + 0.3);
    const hz = z + (rand() - 0.5) * 3;
    const housePrint = building(house, hx, hz, houseTurn);
    // The barn on the north side, its ramp behind it, and the stabbur on the south side.
    if (barn) {
      const bz = yard.maxZ + 4.5 + 0.6;
      const bx = middle + side * 0.5;
      building("barn", bx, bz, Math.PI);
      solid(around(bx, bz + 4.5 + 2, 2, 2), valleyFloor(bz) - 0.5, 3);
    }
    if (stabbur) building("stabbur", middle - side * (width / 4), yard.minZ - 2.75 - 0.8, 0);
    // A woodshed, an outhouse, a well, wherever they fit.
    const woodshed = [
      [hx, housePrint.minZ - 1.6 - 2, houseTurn],
      [hx, housePrint.maxZ + 1.6 + 2, houseTurn],
    ] as const;
    for (const [x, wz, turn] of woodshed) {
      if (tryPlace("woodshed", x, wz, turn)) {
        if (rand() < 0.7) tryPlace("woodpile", x + side * 2.6, wz, Math.PI / 2, 1, 0.3);
        break;
      }
    }
    for (const [x, oz] of [
      [hx + side * 1.5, housePrint.maxZ + 2.2],
      [hx + side * 1.5, housePrint.minZ - 2.2],
      [hx + side * 5, hz],
    ]) {
      if (tryPlace("outhouse", x, oz, houseTurn)) break;
    }
    // The well, out in the yard: the yard is kept clear, so it goes in by hand.
    const wx = middle + side * (width / 4) * (rand() < 0.5 ? 1 : -1) * 0.6;
    const wz = z + (rand() < 0.5 ? 1 : -1) * (depth / 4);
    place("well", wx, wz, 0);
    // Old tools left about.
    const tools: VillageModel[] = ["grindstone", "sledge", "hay-cart"];
    for (const tool of tools) {
      if (rand() < 0.4) continue;
      for (let attempt = 0; attempt < 6; attempt++) {
        const tx = lerp(yard.minX - 4, yard.maxX + 4, rand());
        const tz = lerp(yard.minZ - 6, yard.maxZ + 6, rand());
        if (overlaps(around(tx, tz, 1.5, 1.5), yard) || !inValley(tx, tz, 2)) continue;
        if (tryPlace(tool, tx, tz, rand() < 0.5 ? 0 : Math.PI / 2)) break;
      }
    }
    // A milk ramp by the track at the gate, and a birch over the yard.
    if (house === "log-farmhouse") {
      tryPlace(
        "milk-ramp",
        edge + side * 1.8,
        z + 4.5,
        side < 0 ? Math.PI / 2 : -Math.PI / 2,
        0.9,
        0.5,
      );
    }
    for (const [cx, cz] of [
      [yard.minX - 2, yard.minZ - 2],
      [yard.maxX + 2, yard.maxZ + 2],
      [yard.minX - 2, yard.maxZ + 2],
    ]) {
      if (tryPlace("birch-a", cx, cz, rand() * 6, 0.12, WAY, treeY(cx, cz))) break;
    }
    // The loot: in the yard, and at the doors.
    const spots = [
      ...fronts.map((front) => [front.x, front.z]),
      [middle, z],
      [middle + 2, z - 2],
      [middle - 2, z + 2],
    ];
    for (const [i, kind] of loot.entries()) {
      const [x, iz] = spots[i % spots.length];
      item(kind, x + (kind === "phone" ? (rand() - 0.5) * 0.8 : 0), iz);
    }
    return yard;
  };

  const westTun = (z: number, spec: Omit<Tun, "side" | "z" | "edge">) =>
    tun({ side: -1, z, edge: roadX(z) - ROAD_HALF, ...spec });
  const eastTun = (z: number, spec: Omit<Tun, "side" | "z" | "edge">) =>
    tun({ side: 1, z, edge: roadX(z) + ROAD_HALF, ...spec });
  westTun(-74, {
    house: "log-farmhouse",
    yard: 16,
    depth: 18,
    barn: true,
    stabbur: true,
    loot: ["phone", "box", "tv", "sofa", "phone"],
  });
  eastTun(-26, {
    house: "clad-house",
    yard: 8,
    depth: 16,
    barn: false,
    stabbur: true,
    loot: ["phone", "tv", "box"],
  });
  westTun(38, {
    house: "log-farmhouse",
    yard: 16,
    depth: 18,
    barn: true,
    stabbur: true,
    loot: ["phone", "box", "sofa", "tv", "phone"],
  });

  // --- The footbridge, and the farmstead across the river. ---
  const bridgeZ = 4;
  const deckHalf = 0.8;
  {
    const lo = Math.min(channel(bridgeZ - 1).a, channel(bridgeZ).a) - RIVER_BANK;
    const hi = Math.max(channel(bridgeZ - 1).b, channel(bridgeZ).b) + RIVER_BANK;
    // Low enough to step onto from most of the way down the banks.
    const bank = valleyFloor(bridgeZ);
    const y = bank + 0.06;
    const deck = { minX: lo - 1, maxX: hi + 1, minZ: bridgeZ - deckHalf, maxZ: bridgeZ + deckHalf };
    bridges.push({ ...deck, y });
    floors.push(ground(deck.minX, deck.maxX, deck.minZ, deck.maxZ, y));
    // Nobody wades under it, and its rails keep walkers on it.
    const under = { minX: lo, maxX: hi, minZ: deck.minZ, maxZ: deck.maxZ };
    solid(under, bank - RIVER_DEPTH - 1, RIVER_DEPTH + 1 - 0.02);
    solid({ ...under, maxZ: deck.minZ + 0.1 }, y, 1);
    solid({ ...under, minZ: deck.maxZ - 0.1 }, y, 1);
    // The way to it from the track, and on from it.
    keepClear({
      minX: roadX(bridgeZ),
      maxX: deck.maxX + 3,
      minZ: bridgeZ - 2.4,
      maxZ: bridgeZ + 2.4,
    });
    tun({
      side: 1,
      z: bridgeZ + 6,
      edge: deck.maxX,
      house: "log-farmhouse",
      yard: 8,
      depth: 16,
      barn: false,
      stabbur: true,
      loot: ["phone", "box", "tv"],
    });
  }

  // --- The boathouse, by the pool, its doors to the water, and its boat. ---
  {
    const z = 60;
    const { a } = channel(z);
    const turn = Math.PI / 2;
    const [hx] = halfExtents("boathouse", turn);
    const x = a - RIVER_BANK - hx - 0.2;
    place("boathouse", x, z, turn);
    keepClear(around(x, z - 4.5, hx, 1.5));
    keepClear({ minX: roadX(z), maxX: x - hx, minZ: z - 2, maxZ: z + 2 });
    // The boat lies rolled on its side on the bank beside it, as boats are laid up.
    place("rowboat", x + 0.5, z + 2.5 + 1.6, Math.PI / 2 + 0.06);
    item("tv", x, z - 3.6);
    item("box", x + hx - 1, z - 3.4);
  }

  // --- Fences and walls along the track, broken here and there, with the poles of an old line. ---
  // A line's own segments abut, so each is checked against what was there before the line, and
  // the line goes in once it's done.
  let line: { box: Box; y: number; height: number }[] = [];
  const endLine = () => {
    for (const { box, y, height } of line) solid(box, y, height);
    line = [];
  };
  for (const side of [-1, 1] as const) {
    let kind: VillageModel = side < 0 ? "roundpole-fence" : "stone-wall";
    let left = 0;
    let segment = 0;
    for (let z = SOUTH + 26; z < PATH.from - 6; z += 4, segment++) {
      if (left-- <= 0) {
        kind = rand() < 0.6 ? "roundpole-fence" : "stone-wall";
        left = 6 + Math.floor(rand() * 10);
      }
      const mid = z + 2;
      const dx = roadX(mid + 0.5) - roadX(mid - 0.5);
      const angle = Math.atan2(dx, 1);
      const x = roadX(mid) + side * (ROAD_HALF + 1.7);
      // A pole every so often on the east side, in a gap of its own.
      if (side > 0 && segment % 11 === 5) {
        const pole = around(x, mid, 0.25, 0.25);
        if (fits(pole, 1.6)) place("power-pole", x, mid, angle, { solidScale: 0.6 });
        continue;
      }
      if (rand() < 0.22) continue;
      // Two boxes, each round half the turned segment.
      const thick = kind === "stone-wall" ? 0.8 : 0.3;
      const parts = [-1, 1].map((half) => {
        const cx = x + half * Math.sin(angle);
        const cz = mid + half * Math.cos(angle);
        return around(
          cx,
          cz,
          Math.abs(Math.sin(angle)) * 1 + thick / 2,
          Math.abs(Math.cos(angle)) * 1 + 0.02,
        );
      });
      if (
        !parts.every((part) => fits(part, 0.6) && inValley((part.minX + part.maxX) / 2, mid, 1.5))
      )
        continue;
      const turn = angle + (side < 0 ? -Math.PI / 2 : Math.PI / 2);
      const height = VILLAGE_MODELS[kind][2];
      const y = Math.min(villageGround(x, z), villageGround(x, z + 4)) - 0.03;
      placements.push({ model: kind, x, y, z: mid, turn });
      for (const part of parts) line.push({ box: part, y: y - 0.5, height: height + 0.5 });
    }
    endLine();
  }
  // Field walls out from the track, across the meadows, broken in places.
  for (const side of [-1, 1] as const) {
    for (let z = SOUTH + 40; z < PATH.from - 10; z += 26 + rand() * 18) {
      let x = roadX(z) + side * (ROAD_HALF + 5);
      for (let n = 0; n < 12; n++, x += side * 4) {
        if (rand() < 0.2) continue;
        const box = around(x, z, 2, 0.45);
        if (!inValley(x, z, 3) || inRiver(x, z, 2)) break;
        if (!fits(box, WAY)) continue;
        const y = lowestUnder(box) - 0.05;
        placements.push({ model: "stone-wall", x, y, z, turn: 0 });
        line.push({ box, y: y - 0.5, height: 1.5 });
      }
      endLine();
    }
  }
  // Hay racks standing in the meadows.
  for (let n = 0, tries = 0; n < 9 && tries < 300; tries++) {
    const z = lerp(SOUTH + 30, PATH.from - 8, rand());
    const x = lerp(westEdge(z) + 6, eastEdge(z) - 6, rand());
    if (inRiver(x, z, 3) || Math.abs(x - roadX(z)) < 8) continue;
    const turn = rand() < 0.5 ? 0 : Math.PI / 2;
    if (tryPlace("hay-rack", x, z, turn, 1, 2)) n++;
  }
  // A dead birch and boulders across the track behind the truck, where it can't be driven on.
  place("birch-dead", truckX - 3, SOUTH - 1, 0, { solidScale: 0 });
  placements.push({
    model: "fallen-log",
    x: truckX + 0.5,
    y: villageGround(truckX, SOUTH - 2) - 0.1,
    z: SOUTH - 2,
    turn: 1.45,
  });
  place("boulder-a", truckX + 5, SOUTH - 2.5, 0.7, { solidScale: 0 });

  // --- Trees, rocks and logs in the valley, thick by its sides and the river, thin in the meadows. ---
  const trees: VillageModel[] = ["spruce-a", "spruce-b", "birch-a", "birch-b", "birch-dead"];
  /** How much of a tree's footprint stops players: the trunk, or a spruce's low branches. */
  const trunk: Partial<Record<VillageModel, number>> = {
    "spruce-a": 0.3,
    "spruce-b": 0.3,
    "birch-a": 0.1,
    "birch-b": 0.12,
    "birch-dead": 0.12,
  };
  const CELL = 3;
  for (let z = SOUTH; z < NORTH; z += CELL) {
    for (let x = -60; x < 70; x += CELL) {
      const px = x + rand() * CELL;
      const pz = z + rand() * CELL;
      const roll = rand();
      if (!inValley(px, pz, 2)) continue;
      const fromSide = Math.min(px - westEdge(pz), eastEdge(pz) - px);
      const { a, b } = channel(Math.floor(pz));
      const fromRiver = Math.min(Math.abs(px - (a - RIVER_BANK)), Math.abs(px - (b + RIVER_BANK)));
      const wet = !inRiver(px, pz) && fromRiver < 3;
      const density = 0.5 * Math.exp(-fromSide / 5) + (wet ? 0.12 : 0) + 0.008;
      if (roll > density) continue;
      // Spruce by the valley sides, birch out in the open and by the water.
      const model: VillageModel = wet
        ? pick(["birch-a", "birch-b", "birch-b", "birch-dead"] as const)
        : fromSide < 8 && rand() < 0.65
          ? pick(["spruce-a", "spruce-b"] as const)
          : pick(trees);
      if (inRiver(px, pz, 0.5)) continue;
      tryPlace(model, px, pz, rand() * Math.PI * 2, trunk[model] ?? 0.2, WAY, treeY(px, pz));
    }
  }
  for (let n = 0, tries = 0; tries < 900 && n < 150; tries++) {
    const z = lerp(SOUTH, NORTH, rand());
    const x = lerp(-60, 70, rand());
    if (!inValley(x, z, 1.5) || inRiver(x, z, 0.5)) continue;
    const fromSide = Math.min(x - westEdge(z), eastEdge(z) - x);
    if (rand() > 0.15 + Math.exp(-fromSide / 8)) continue;
    const model = pick([
      "boulder-a",
      "boulder-b",
      "boulder-b",
      "boulder-c",
      "boulder-c",
      "stump",
      "stump",
      "fallen-log",
    ] as const);
    const turn = model === "fallen-log" ? (rand() < 0.5 ? 0 : Math.PI / 2) : rand() * Math.PI * 2;
    // Round things: their footprint, turned any way, fits in a box of the smaller side.
    const scale = model === "fallen-log" ? 0.9 : 0.7;
    const square = model !== "fallen-log";
    if (square) {
      const [w, d] = VILLAGE_MODELS[model];
      const half = (Math.min(w, d) * scale) / 2;
      const box = around(x, z, half, half);
      if (!fits(box)) continue;
      const y = lowestUnder(box) - 0.15;
      placements.push({ model, x, y, z, turn });
      solid(box, y - 0.5, VILLAGE_MODELS[model][2] + 0.4);
    } else if (!tryPlace(model, x, z, turn, scale)) continue;
    n++;
  }

  // --- Outside: forest up the valley sides, boulders and outcrops, drawn only. ---
  const FOREST = 8;
  for (let z = -330; z < 330; z += FOREST) {
    for (let x = -330; x < 330; x += FOREST) {
      const px = x + rand() * FOREST;
      const pz = z + rand() * FOREST;
      const roll = rand();
      const out = outside(px, pz);
      if (out < 3 && pz > SOUTH - 6 && pz < NORTH + 6) continue;
      if (Math.abs(px - roadX(pz)) < ROAD_HALF + 2 || inRiver(px, pz, 1.5)) continue;
      if (
        Math.hypot(
          Math.max(knollFoot.minX - px, 0, px - knollFoot.maxX),
          Math.max(knollFoot.minZ - pz, 0, pz - knollFoot.maxZ),
        ) < 1
      )
        continue;
      const y = villageGround(px, pz);
      const high = y - valleyFloor(pz);
      // Thinning out towards the tree line, and in clumps.
      const clump = fbm(px / 60, pz / 60, 2, 31);
      const density =
        (out < 0 ? 0.08 : 0.85) * smooth((240 - high) / 120) * smooth((clump - 0.3) / 0.3);
      if (roll > density) continue;
      const model: VillageModel =
        high > 120 && rand() < 0.4
          ? "birch-dead"
          : rand() < 0.72
            ? pick(["spruce-a", "spruce-a", "spruce-b"] as const)
            : pick(["birch-a", "birch-b"] as const);
      // Sunk a little, on a slope, so no root shows under it.
      placements.push({ model, x: px, y: y - 0.4, z: pz, turn: rand() * Math.PI * 2 });
    }
  }
  for (let n = 0; n < 260; n++) {
    const z = lerp(-320, 320, rand());
    const side = rand() < 0.5 ? -1 : 1;
    const out = 4 + rand() ** 1.6 * 200;
    const x = side < 0 ? westEdge(z) - out : eastEdge(z) + out;
    const y = villageGround(x, z);
    const model =
      out > 25 && rand() < 0.5
        ? "rock-outcrop"
        : pick(["boulder-a", "boulder-b", "boulder-c"] as const);
    placements.push({ model, x, y: y - 0.5, z, turn: rand() * Math.PI * 2 });
  }

  // --- Grass, heather and ferns: thick along the track's verges and round things, thin in the open. ---
  const PLANT = 1.1;
  for (let z = -200; z < 140; z += PLANT) {
    for (let x = -90; x < 100; x += PLANT) {
      const px = x + rand() * PLANT;
      const pz = z + rand() * PLANT;
      const roll = rand();
      const out = outside(px, pz);
      if (out > 30) continue;
      const fromRoad = Math.abs(px - roadX(pz));
      // Not on the knoll's steep sides or its ramp, but in the churchyard, round the graves.
      const onKnoll =
        px > knollFoot.minX && px < knollFoot.maxX && pz > PATH.from - 1 && pz < knollFoot.maxZ;
      const inYard = overlaps(around(px, pz, 0, 0), grown(PLATEAU, -0.8));
      if (onKnoll && (!inYard || Math.abs(px - churchX) < 2)) continue;
      if (inRiver(px, pz, -0.6)) continue;
      // The grass ridge down the middle of the track, and nothing else on it.
      if (fromRoad < ROAD_HALF + 0.2) {
        if (pz < PATH.from && fromRoad < 0.35 && roll < 0.55) {
          placements.push({
            model: "grass-tuft",
            x: px,
            y: villageGround(px, pz) - 0.05,
            z: pz,
            turn: rand() * 6.3,
          });
        }
        continue;
      }
      const verge = fromRoad < ROAD_HALF + 3 ? 0.75 : 0;
      const edge = out > -6 ? 0.5 : 0;
      const meadow = 0.11 + 0.1 * fbm(px / 9, pz / 9, 2, 41);
      const worn = yards.some((yard) => overlaps(around(px, pz, 0, 0), yard)) ? 0.3 : 1;
      const density = Math.max(verge, edge, meadow) * worn * (out > 0 ? smooth(1 - out / 30) : 1);
      if (roll > density) continue;
      // Nothing grows inside a building, or on the bridge.
      const spot = around(px, pz, 0.05, 0.05);
      if (out < 0 && (solids.near(spot, 0) || bridges.some((deck) => overlaps(spot, deck))))
        continue;
      const kind: VillageModel =
        out > -4 && rand() < 0.45
          ? rand() < 0.5
            ? "heather"
            : "fern"
          : rand() < 0.08
            ? "fern"
            : "grass-tuft";
      placements.push({
        model: kind,
        x: px,
        y: villageGround(px, pz) - 0.05,
        z: pz,
        turn: rand() * 6.3,
      });
    }
  }

  return { floors, boxes, items, dock, spawns, placements, bridges, yards };
}

const layouts = new Map<number, VillageLayout>();

/** The village of a seed, built once. */
export function village(seed: number): VillageLayout {
  let layout = layouts.get(seed);
  if (!layout) {
    layout = villageLayout(seed);
    layouts.set(seed, layout);
  }
  return layout;
}
