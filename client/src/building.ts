import {
  Color3,
  type Mesh,
  MeshBuilder,
  type Scene,
  type ShadowGenerator,
  StandardMaterial,
} from "@babylonjs/core";
import type { Floor, Level, LevelBox, Room, RoomKind } from "../../shared/level";
import {
  ARCH_HEIGHT,
  CELL,
  DOOR_HEIGHT,
  GROUND,
  LADDER_WALL,
  LADDER_WIDTH,
  OFFSET,
  OPPOSITE,
  openingOf,
  type ParsedGrid,
  parseTiles,
  SIDES,
  type Side,
  SLAB,
  STOREY,
  WALL,
} from "../../shared/tiles";
import { hash3, noise3, PartBuilder, smoothstep, type Vec3 } from "./parts";
import type { SurfaceName } from "./surfaces";
import { tunables } from "./tuning";

/**
 * The building of a tile-built level (`level.grid`): walls, floors, ceilings, stairs, railings,
 * ladders, pits and planks, drawn from the grid, its rooms and the collision boxes, so what's drawn
 * is what blocks. Every face takes the finish of the room it faces (see FINISHES), with paint from
 * the building's livery, and wear baked into its vertex colours: dirt rising from the floor,
 * darker corners, scuffs at trolley height, damp below ground, all worse the further in a room is.
 * Built by the part builder (parts.ts) into a mesh per surface and storey.
 *
 * Walls are found by rasterising the collision boxes of each storey onto a 10 cm plan, in bands of
 * height (under a doorway's head, under an arch's, up to the ceiling, the slab above), and taking
 * the faces between solid and empty: corners, T-junctions and doorways come out exactly as the
 * collision has them, and no face is drawn twice.
 *
 * The roof is drawn by addRoof, from addPlayground, so the tile viewer can hide it with the roof.
 */

/** How dirty things get, by eye. */
const WEAR = tunables("Look/Building wear", {
  grime: { value: 0.55, min: 0, max: 1.5, hint: "Dirt rising up walls from the floor" },
  corners: { value: 0.5, min: 0, max: 1.5, hint: "Darker in corners and where walls meet floors" },
  scuffs: { value: 0.18, min: 0, max: 0.6, hint: "Scuffed bands at trolley height" },
  damp: { value: 0.3, min: 0, max: 1, hint: "Water stains below ground and in plant rooms" },
  depth: { value: 0.6, min: 0, max: 2, hint: "How much dirtier the furthest rooms are" },
  mottle: { value: 0.12, min: 0, max: 0.4, hint: "Slow patchiness everywhere" },
});

const R = 0.1;
const EPS = 1e-4;

/** What's solid on the plan. */
const OUTER = 1;
const PARTITION = 2;
const ROCK = 3;
const PIT = 4;
const SLAB_EDGE = 5;
const LADDER = 6;

/** A surface and the paint on it, in sRGB, for painted surfaces. */
interface Coat {
  surface: SurfaceName;
  paint?: Color3;
}

/** How a room is finished. Heights are above its floor. */
interface Finish {
  floor: Coat;
  /** A kick band or skirting along the foot of the walls. */
  kick?: { height: number; coat: Coat };
  lower: Coat;
  /** Where the lower coat stops. */
  dado: number;
  /** A stripe from the dado up. */
  band?: { height: number; coat: Coat };
  upper: Coat;
  /** On the outer walls above `cladFrom`, above ground: cladding. */
  clad?: { from: number; coat: Coat };
  ceiling: "slab" | "tile";
  /** How grimy it is, before depth: 0 clean, 1 filthy. */
  dirt: number;
  scuffs: boolean;
  damp: boolean;
  beams: boolean;
  lanes: boolean;
  pilasters: boolean;
  /** Oil on the floor, 0 to 1. */
  oil: number;
}

/** The colours one building is painted in, chosen from its seed. */
interface Livery {
  /** Doors' surrounds, steelwork, the dado band: the building's own colour. */
  accent: Color3;
  /** Light wall paint. */
  light: Color3;
  /** Dark paint for the lower walls of halls. */
  dark: Color3;
  /** Railings. */
  rail: Color3;
  carpet: Color3;
  vinyl: Color3;
  corridorFloor: Color3;
  steel: Color3;
  /** Cladding's paint, from inside. */
  cladding: Color3;
}

const rgb = (r: number, g: number, b: number) => new Color3(r, g, b);
const ACCENTS = [
  rgb(0.16, 0.29, 0.42),
  rgb(0.2, 0.34, 0.27),
  rgb(0.46, 0.17, 0.13),
  rgb(0.13, 0.31, 0.33),
  rgb(0.55, 0.38, 0.12),
  rgb(0.3, 0.27, 0.36),
];
const LIGHTS = [
  rgb(0.7, 0.69, 0.64),
  rgb(0.65, 0.68, 0.66),
  rgb(0.72, 0.68, 0.6),
  rgb(0.64, 0.65, 0.67),
];
const DARKS = [
  rgb(0.4, 0.42, 0.43),
  rgb(0.35, 0.38, 0.37),
  rgb(0.46, 0.44, 0.4),
  rgb(0.33, 0.35, 0.4),
];
const RAILS = [rgb(0.86, 0.64, 0.08), rgb(0.86, 0.64, 0.08), rgb(0.78, 0.3, 0.1)];
const CARPETS = [
  rgb(0.26, 0.29, 0.33),
  rgb(0.3, 0.26, 0.26),
  rgb(0.22, 0.27, 0.28),
  rgb(0.28, 0.28, 0.25),
];
const VINYLS = [
  rgb(0.7, 0.68, 0.62),
  rgb(0.6, 0.65, 0.65),
  rgb(0.72, 0.63, 0.53),
  rgb(0.62, 0.62, 0.66),
];
const CORRIDOR_FLOORS = [rgb(0.36, 0.43, 0.39), rgb(0.44, 0.44, 0.46), rgb(0.48, 0.4, 0.32)];
const CLADDINGS = [
  rgb(0.52, 0.56, 0.55),
  rgb(0.6, 0.6, 0.57),
  rgb(0.47, 0.52, 0.56),
  rgb(0.56, 0.54, 0.49),
];
const STEELS = [rgb(0.3, 0.33, 0.36), rgb(0.42, 0.4, 0.36), rgb(0.28, 0.3, 0.28)];

function liveryOf(seed: number): Livery {
  const pick = <T>(list: readonly T[], salt: number) =>
    list[Math.floor(hash3(seed, salt, 7.3) * list.length) % list.length];
  return {
    accent: pick(ACCENTS, 1),
    light: pick(LIGHTS, 2),
    dark: pick(DARKS, 3),
    rail: pick(RAILS, 4),
    carpet: pick(CARPETS, 5),
    vinyl: pick(VINYLS, 6),
    corridorFloor: pick(CORRIDOR_FLOORS, 7),
    steel: pick(STEELS, 8),
    cladding: pick(CLADDINGS, 9),
  };
}

/** A paint a little off the livery's, different in each room. */
function vary(color: Color3, salt: number, amount = 0.05): Color3 {
  const k = 1 + (hash3(salt, 3.1, 9.7) - 0.5) * 2 * amount;
  const warm = (hash3(salt, 5.3, 1.1) - 0.5) * amount * 0.6;
  return new Color3(
    Math.min(1, color.r * k * (1 + warm)),
    Math.min(1, color.g * k),
    Math.min(1, color.b * k * (1 - warm)),
  );
}

/** How each kind of room is finished, with this building's livery and the room's own salt. */
function finishFor(kind: RoomKind | "basement", livery: Livery, salt: number): Finish {
  const light = vary(livery.light, salt);
  const plain = (surface: SurfaceName, paint?: Color3): Coat => ({ surface, paint });
  const base: Finish = {
    floor: plain("concrete-floor"),
    kick: { height: 0.15, coat: plain("concrete-block", vary(livery.dark, salt + 1).scale(0.7)) },
    lower: plain("concrete-block", light),
    dado: 1.2,
    upper: plain("concrete-block", light),
    ceiling: "slab",
    dirt: 0.5,
    scuffs: true,
    damp: false,
    beams: true,
    lanes: false,
    pilasters: false,
    oil: 0,
  };
  switch (kind) {
    case "entrance":
    case "hall":
    case "cage":
    case "atrium":
      return {
        ...base,
        kick:
          kind === "entrance"
            ? { height: 0.3, coat: plain("hazard") }
            : {
                height: 0.2,
                coat: plain("concrete-block", vary(livery.dark, salt + 1).scale(0.6)),
              },
        lower: plain("concrete-block", vary(livery.dark, salt)),
        dado: 1.2,
        band: { height: 0.12, coat: plain("concrete-block", livery.accent) },
        clad: { from: 2.1, coat: plain("corrugated", vary(livery.cladding, salt + 2, 0.03)) },
        lanes: kind === "entrance" || kind === "hall",
        pilasters: true,
        dirt: kind === "entrance" ? 0.55 : 0.45,
      };
    case "stock":
      return {
        ...base,
        lower: plain("concrete-block", vary(livery.light, salt + 4, 0.08).scale(0.92)),
        upper: plain("concrete-block", vary(livery.light, salt + 4, 0.08).scale(0.92)),
        dirt: 0.6,
        pilasters: true,
      };
    case "workshop":
      return {
        ...base,
        floor: plain("concrete-floor"),
        kick: undefined,
        lower: plain("painted-steel", vary(livery.steel, salt, 0.04).scale(1.6)),
        dado: 1.3,
        band: { height: 0.05, coat: plain("painted-steel", livery.accent) },
        dirt: 0.75,
        oil: 1,
      };
    case "office":
      return {
        ...base,
        floor: plain("carpet-tile", vary(livery.carpet, salt, 0.04)),
        kick: { height: 0.1, coat: plain("rubber") },
        lower: plain("painted-plaster", light),
        upper: plain("painted-plaster", light),
        ceiling: "tile",
        dirt: 0.18,
        scuffs: false,
        beams: false,
      };
    case "staff":
      return {
        ...base,
        floor: plain("vinyl-tile", vary(livery.vinyl, salt, 0.04)),
        kick: undefined,
        lower: plain("wall-tile"),
        dado: 1.5,
        band: { height: 0.04, coat: plain("painted-steel", livery.accent) },
        upper: plain("painted-plaster", light),
        ceiling: "tile",
        dirt: 0.3,
        scuffs: false,
        beams: false,
      };
    case "plant":
    case "basement":
      return {
        ...base,
        kick: undefined,
        lower: plain("concrete-wall"),
        upper: plain("concrete-wall"),
        dirt: 0.8,
        damp: true,
        oil: 0.4,
      };
    case "corridor":
      return {
        ...base,
        floor: plain("floor-paint", vary(livery.corridorFloor, salt, 0.04)),
        lower: plain("concrete-block", vary(livery.accent, salt, 0.04).scale(0.85)),
        dado: 1.0,
        band: undefined,
        upper: plain("concrete-block", light),
        dirt: 0.6,
        beams: false,
      };
  }
}

/** Heights above a floor that walls are cut at, so wear has rows of vertices to vary along. */
const ROWS = [0, 0.06, 0.15, 0.3, 0.5, 0.8, 1.1, 1.5, 1.9, 2.2, 2.4, 2.6, 2.75, 3];

interface Plan {
  storey: number;
  base: number;
  /** Band boundaries, absolute: base, door head, arch head, ceiling, and the slab's top if any. */
  ys: number[];
  /** One plan a band: the code of what's solid in each 10 cm pixel, or 0. */
  bands: Uint8Array[];
  /** Summed-area tables of the bands, for how enclosed a point is. */
  sums: Int32Array[];
  ceiling: number;
}

interface Opening {
  storey: number;
  kind: "door" | "arch";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y0: number;
  y1: number;
  alongX: boolean;
}

/** Everything a drawing needs to know about the level. */
class Context {
  readonly parsed: ParsedGrid;
  readonly top: number;
  readonly bottom: number;
  readonly minX: number;
  readonly minZ: number;
  readonly W: number;
  readonly H: number;
  readonly plans = new Map<number, Plan>();
  readonly livery: Livery;
  readonly seed: number;
  private readonly roomAt = new Map<string, Room>();
  private readonly finishes = new Map<string, Finish>();
  readonly openings: Opening[] = [];

  constructor(readonly level: Level) {
    const grid = level.grid as NonNullable<Level["grid"]>;
    this.parsed = parseTiles(grid);
    this.bottom = -this.parsed.basements;
    this.top = this.parsed.tiles.length - this.parsed.basements - 1;
    this.seed = seedOf(level.name);
    this.livery = liveryOf(this.seed);
    for (const room of level.rooms) {
      for (const { col, row } of room.cells) this.roomAt.set(`${room.storey},${col},${row}`, room);
    }
    let minX = grid.x;
    let minZ = grid.z;
    let maxX = grid.x + this.parsed.cols * CELL;
    let maxZ = grid.z + this.parsed.rows * CELL;
    for (const box of this.solids()) {
      minX = Math.min(minX, box.minX);
      minZ = Math.min(minZ, box.minZ);
      maxX = Math.max(maxX, box.maxX);
      maxZ = Math.max(maxZ, box.maxZ);
    }
    this.minX = minX - 2 * R;
    this.minZ = minZ - 2 * R;
    this.W = Math.round((maxX - this.minX) / R) + 2;
    this.H = Math.round((maxZ - this.minZ) / R) + 2;
    for (let s = this.bottom; s <= this.top; s++) this.plans.set(s, this.rasterise(s));
    // Walls that go on up through a slab, drawn through it too.
    for (let s = this.bottom; s < this.top; s++) {
      const plan = this.plan(s);
      const above = this.plan(s + 1);
      const slab = plan.bands[3];
      if (!slab) continue;
      for (let k = 0; k < slab.length; k++) {
        const below = plan.bands[2][k];
        if (below && below !== SLAB_EDGE && above.bands[0][k]) slab[k] = below;
      }
    }
    for (const plan of this.plans.values()) {
      plan.sums = plan.bands.map((band) => this.summed(band));
    }
    this.findOpenings();
  }

  plan(storey: number): Plan {
    return this.plans.get(storey) as Plan;
  }

  /** The boxes drawn as walls. */
  solids(): LevelBox[] {
    return this.level.boxes.filter(
      (b) => b.kind === "wall" || b.kind === "partition" || b.kind === "pit",
    );
  }

  /** The column and row of the cell a point is in. */
  cellOf(x: number, z: number): [number, number] {
    const grid = this.level.grid as NonNullable<Level["grid"]>;
    return [Math.floor((x - grid.x) / CELL), Math.floor((z - grid.z) / CELL)];
  }

  cellBox(col: number, row: number) {
    const grid = this.level.grid as NonNullable<Level["grid"]>;
    return {
      minX: grid.x + col * CELL,
      maxX: grid.x + (col + 1) * CELL,
      minZ: grid.z + row * CELL,
      maxZ: grid.z + (row + 1) * CELL,
    };
  }

  inGrid(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.parsed.cols && row < this.parsed.rows;
  }

  tile(storey: number, col: number, row: number) {
    if (storey < this.bottom || storey > this.top) return undefined;
    return this.parsed.tile(storey, col, row);
  }

  /** The room a cell is in, or the nearest room's on its storey. */
  room(storey: number, col: number, row: number): Room | undefined {
    const direct = this.roomAt.get(`${storey},${col},${row}`);
    if (direct) return direct;
    for (let r = 1; r <= 3; r++) {
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          const near = this.roomAt.get(`${storey},${col + dc},${row + dr}`);
          if (near) return near;
        }
      }
    }
    return undefined;
  }

  /** The finish of a cell's room; an atrium's walls are the room's below it. */
  finish(storey: number, col: number, row: number): Finish {
    let room = this.room(storey, col, row);
    let s = storey;
    while (room?.kind === "atrium" && s > this.bottom) {
      s--;
      room = this.room(s, col, row) ?? room;
    }
    const kind: RoomKind | "basement" =
      room && room.kind !== "atrium"
        ? storey < 0 && room.kind !== "office" && room.kind !== "staff"
          ? "basement"
          : room.kind
        : storey < 0
          ? "basement"
          : "hall";
    const key = `${kind}|${room?.id ?? -1}`;
    let finish = this.finishes.get(key);
    if (!finish) {
      finish = finishFor(kind, this.livery, this.seed * 31 + (room?.id ?? 0) * 7);
      this.finishes.set(key, finish);
    }
    return finish;
  }

  /** How far in a room is, 0 to 1, from the entrance. */
  depth(storey: number, col: number, row: number): number {
    return this.room(storey, col, row)?.depth ?? (storey < 0 ? 0.8 : 0.3);
  }

  private ceilingOf(storey: number): number {
    const base = storey * STOREY;
    if (storey === this.top) return base + STOREY;
    return base + STOREY - (storey + 1 === 0 ? GROUND : SLAB);
  }

  private rasterise(storey: number): Plan {
    const base = storey * STOREY;
    const ceiling = this.ceilingOf(storey);
    const ys = [base, base + DOOR_HEIGHT, base + ARCH_HEIGHT, ceiling];
    if (storey < this.top) ys.push(base + STOREY);
    const bands = ys.slice(1).map(() => new Uint8Array(this.W * this.H));
    for (const box of this.solids()) {
      const code = codeOf(box);
      for (let b = 0; b < bands.length; b++) {
        const mid = (ys[b] + ys[b + 1]) / 2;
        if (box.y > mid || box.y + box.height < mid) continue;
        this.fill(bands[b], box, code, true);
      }
    }
    if (storey < this.top) {
      for (const floor of this.level.floors) {
        if (floor.kind !== "floor" && floor.kind !== "stairs") continue;
        if (Math.round(floor.y / STOREY) !== storey + 1) continue;
        this.fill(bands[3], floor, SLAB_EDGE, false);
      }
    }
    return { storey, base, ys, bands, sums: [], ceiling };
  }

  private fill(
    band: Uint8Array,
    box: { minX: number; maxX: number; minZ: number; maxZ: number },
    code: number,
    overwrite: boolean,
  ) {
    const i0 = Math.max(0, Math.round((box.minX - this.minX) / R));
    const i1 = Math.min(this.W, Math.round((box.maxX - this.minX) / R));
    const j0 = Math.max(0, Math.round((box.minZ - this.minZ) / R));
    const j1 = Math.min(this.H, Math.round((box.maxZ - this.minZ) / R));
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const k = i + j * this.W;
        if (overwrite || band[k] === 0) band[k] = code;
      }
    }
  }

  private summed(band: Uint8Array): Int32Array {
    const W = this.W + 1;
    const sums = new Int32Array(W * (this.H + 1));
    for (let j = 0; j < this.H; j++) {
      let row = 0;
      for (let i = 0; i < this.W; i++) {
        row += band[i + j * this.W] ? 1 : 0;
        sums[i + 1 + (j + 1) * W] = sums[i + 1 + j * W] + row;
      }
    }
    return sums;
  }

  /** The share of the square `r` round a point that's solid in a storey's band. */
  enclosed(storey: number, band: number, x: number, z: number, r: number): number {
    const plan = this.plans.get(storey);
    const sums = plan?.sums[Math.min(band, (plan?.sums.length ?? 1) - 1)];
    if (!sums) return 0;
    const W = this.W + 1;
    const clampI = (v: number) => Math.max(0, Math.min(this.W, Math.round(v)));
    const clampJ = (v: number) => Math.max(0, Math.min(this.H, Math.round(v)));
    const i0 = clampI((x - r - this.minX) / R);
    const i1 = clampI((x + r - this.minX) / R);
    const j0 = clampJ((z - r - this.minZ) / R);
    const j1 = clampJ((z + r - this.minZ) / R);
    const area = (i1 - i0) * (j1 - j0);
    if (area <= 0) return 0;
    const sum = sums[i1 + j1 * W] - sums[i0 + j1 * W] - sums[i1 + j0 * W] + sums[i0 + j0 * W];
    return sum / area;
  }

  /** The band of a storey's plan a height is in. */
  bandAt(plan: Plan, y: number): number {
    for (let b = 0; b < plan.bands.length; b++) if (y < plan.ys[b + 1] - EPS) return b;
    return plan.bands.length - 1;
  }

  private findOpenings() {
    const { parsed } = this;
    for (let s = this.bottom; s <= this.top; s++) {
      for (let row = 0; row < parsed.rows; row++) {
        for (let col = 0; col < parsed.cols; col++) {
          for (const side of SIDES) {
            const outer = !this.inGrid(col + OFFSET[side][0], row + OFFSET[side][1]);
            if (!outer && (side === "s" || side === "w")) continue;
            const edge = parsed.edge(s, col, row, side);
            const opening = openingOf(edge);
            if (!opening || (edge !== "door" && edge !== "arch")) continue;
            const cell = this.cellBox(col, row);
            const alongX = side === "n" || side === "s";
            const line = { n: cell.maxZ, s: cell.minZ, e: cell.maxX, w: cell.minX }[side];
            const mid = alongX ? (cell.minX + cell.maxX) / 2 : (cell.minZ + cell.maxZ) / 2;
            const half = opening.width / 2;
            this.openings.push({
              storey: s,
              kind: edge,
              alongX,
              minX: alongX ? mid - half : line - WALL / 2,
              maxX: alongX ? mid + half : line + WALL / 2,
              minZ: alongX ? line - WALL / 2 : mid - half,
              maxZ: alongX ? line + WALL / 2 : mid + half,
              y0: s * STOREY,
              y1: s * STOREY + opening.height,
            });
          }
        }
      }
    }
  }

  /** The opening whose boundary a point lies on, if any. */
  openingAt(x: number, y: number, z: number): Opening | undefined {
    const e = 0.002;
    return this.openings.find(
      (o) =>
        x >= o.minX - e &&
        x <= o.maxX + e &&
        z >= o.minZ - e &&
        z <= o.maxZ + e &&
        y >= o.y0 - e &&
        y <= o.y1 + e,
    );
  }
}

const contexts = new WeakMap<Level, Context>();

function contextOf(level: Level): Context {
  let ctx = contexts.get(level);
  if (!ctx) {
    ctx = new Context(level);
    contexts.set(level, ctx);
  }
  return ctx;
}

function seedOf(name: string): number {
  const match = /([0-9]+)$/.exec(name);
  if (match) return Number(match[1]);
  let h = 7;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return h;
}

function codeOf(box: LevelBox): number {
  if (box.kind === "partition") return PARTITION;
  if (box.kind === "pit") return PIT;
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  if (w >= CELL - 0.1 && d >= CELL - 0.1) return ROCK;
  if (Math.min(w, d) <= LADDER_WALL + 0.01) return LADDER;
  return OUTER;
}

/** Breakpoints for a span: its ends, every `step` in world space, and near its ends. */
function cuts(a0: number, a1: number, step: number, near = 0.15): number[] {
  const points = new Set<number>([a0, a1]);
  for (let k = Math.ceil((a0 + EPS) / step) * step; k < a1 - EPS; k += step) points.add(round(k));
  if (a1 - a0 > 2 * near + 0.1) {
    points.add(round(a0 + near));
    points.add(round(a1 - near));
  }
  return [...points].sort((a, b) => a - b);
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function fractions(points: number[], a0: number, a1: number): number[] {
  return points.map((p) => (p - a0) / (a1 - a0));
}

/** Rows of a wall from y0 to y1, on a storey whose floor is at base. */
function rows(base: number, y0: number, y1: number): number[] {
  const points = new Set<number>([y0, y1]);
  for (let s = base - STOREY; s <= base + STOREY; s += STOREY) {
    for (const r of ROWS) {
      const y = round(s + r);
      if (y > y0 + EPS && y < y1 - EPS) points.add(y);
    }
  }
  return [...points].sort((a, b) => a - b);
}

/** Linear paint for the builder. */
function linear(color: Color3 | undefined): Color3 | undefined {
  return color?.toLinearSpace();
}

/**
 * Draws the building of a tile-built level; returns its meshes. Shadows are cast where the level
 * has no light fittings, as the playground's sun does.
 */
export function addBuilding(scene: Scene, level: Level, shadows?: ShadowGenerator): Mesh[] {
  const ctx = contextOf(level);
  const parts = new PartBuilder();
  for (let s = ctx.bottom; s <= ctx.top; s++) {
    parts.chunk = `s${s}`;
    walls(ctx, parts, s);
    caps(ctx, parts, s);
  }
  floors(ctx, parts);
  ceilings(ctx, parts);
  stairs(ctx, parts);
  railings(ctx, parts);
  ladders(ctx, parts);
  pits(ctx, parts);
  planks(ctx, parts);
  openingTrims(ctx, parts);
  lanes(ctx, parts);
  thresholds(ctx, parts);
  loadingDoor(ctx, parts);
  const meshes = parts.build(scene, "building");
  if (shadows && level.lights.length === 0) {
    for (const mesh of meshes) shadows.addShadowCaster(mesh);
  }
  pitBottom(scene, level);
  return meshes;
}

// ---- Wear ----

interface WearPlace {
  storey: number;
  /** The floor's height. */
  base: number;
  ceiling: number;
  finish: Finish;
  depth: number;
}

/** How dirty a room is overall, from its finish, depth and storey. */
function dirtOf(place: WearPlace): number {
  const below = place.storey < 0 ? 0.25 : 0;
  return place.finish.dirt * (1 + WEAR.depth * place.depth) + below;
}

function mottle(x: number, y: number, z: number, seed: number): number {
  const n =
    noise3(x / 2.3, y / 2.3, z / 2.3, seed) * 0.65 +
    noise3(x / 0.7, y / 0.7, z / 0.7, seed + 9) * 0.35;
  return 1 + (n - 0.5) * 2 * WEAR.mottle;
}

/** Wear on a wall facing a room: grime from the floor, corners, scuffs, damp, the ceiling's edge. */
function wallWear(ctx: Context, place: WearPlace) {
  const plan = ctx.plan(place.storey);
  const dirt = dirtOf(place);
  return (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const h = y - place.base;
    let k = mottle(x, y, z, ctx.seed);
    // Grime from the floor, patchy.
    const patch = 0.6 + 0.4 * noise3(x * 1.3, 0, z * 1.3, ctx.seed + 3);
    k *= 1 - WEAR.grime * dirt * 0.6 * (1 - smoothstep(0, 0.5, h)) * patch;
    // Corners: how much of what's round the point, just in front of the wall, is solid.
    if (Math.abs(ny) < 0.5) {
      const band = ctx.bandAt(plan, y);
      const occ = ctx.enclosed(place.storey, band, x + nx * 0.06, z + nz * 0.06, 0.45);
      k *= 1 - WEAR.corners * 0.7 * smoothstep(0.42, 0.8, occ);
      // Outside corners and reveals get knocked about: a little lighter, chipped.
      if (occ < 0.3) k *= 1 + 0.08 * hash3(x, y * 0.5, z);
      // Scuffs at trolley height.
      if (place.finish.scuffs && h > 0.1 && h < 1.2) {
        const s = smoothstep(0.5, 0.75, noise3(x * 1.6, y * 3, z * 1.6, ctx.seed + 5));
        k *= 1 - WEAR.scuffs * s * dirt * smoothstep(0.1, 0.3, h) * (1 - smoothstep(0.9, 1.2, h));
      }
      // Damp: stains running down from the ceiling, and a tide line at the foot.
      if (place.finish.damp || place.storey < 0) {
        const along = Math.abs(nx) > 0.5 ? z : x;
        const streak = smoothstep(0.62, 0.8, noise3(along * 1.8, 0.5, place.storey, ctx.seed + 11));
        const reach = 0.6 + 1.6 * noise3(along * 0.7, 2.5, place.storey, ctx.seed + 12);
        k *=
          1 -
          WEAR.damp *
            0.8 *
            streak *
            smoothstep(place.ceiling - place.base - reach, place.ceiling - place.base, h);
        k *= 1 - WEAR.damp * 0.4 * (1 - smoothstep(0.2, 0.45, h));
      }
    }
    // Under the ceiling, where it's never cleaned.
    k *= 1 - 0.15 * (1 - smoothstep(0, 0.4, place.ceiling - y));
    return Math.max(0.15, k);
  };
}

const FLOOR_TONE = 0.8;

function floorWear(ctx: Context, place: WearPlace) {
  const dirt = dirtOf(place);
  // Bare concrete is a sealed, darker grey than the bake's fresh slab.
  const tone = place.finish.floor.surface === "concrete-floor" ? FLOOR_TONE : 1;
  return (x: number, y: number, z: number) => {
    let k = mottle(x, y, z, ctx.seed) * tone;
    const occ = ctx.enclosed(place.storey, 0, x, z, 0.4);
    k *= 1 - WEAR.corners * 0.6 * smoothstep(0.05, 0.6, occ) * (0.5 + dirt * 0.5);
    if (place.finish.oil > 0) {
      const oil = smoothstep(0.55, 0.78, noise3(x / 1.4, 0, z / 1.4, ctx.seed + 21));
      k *= 1 - 0.4 * place.finish.oil * oil;
    }
    k *= 1 - 0.15 * dirt * noise3(x / 3, 1, z / 3, ctx.seed + 22);
    return Math.max(0.2, k);
  };
}

function ceilingWear(ctx: Context, place: WearPlace) {
  const plan = ctx.plan(place.storey);
  const band = plan.bands.length > 3 ? 2 : plan.bands.length - 1;
  return (x: number, y: number, z: number) => {
    let k = mottle(x, y, z, ctx.seed + 1);
    const occ = ctx.enclosed(place.storey, band, x, z, 0.4);
    k *= 1 - WEAR.corners * 0.5 * smoothstep(0.05, 0.6, occ);
    if (place.finish.damp || place.storey < 0) {
      const stain = smoothstep(0.6, 0.8, noise3(x / 1.7, 3, z / 1.7, ctx.seed + 31));
      k *= 1 - WEAR.damp * 0.7 * stain;
    }
    return Math.max(0.2, k);
  };
}

/** Plain wear for steelwork and fittings: mottled, darker low down. */
function steelWear(ctx: Context, base: number, dirt = 0.5) {
  return (x: number, y: number, z: number) => {
    let k = mottle(x, y, z, ctx.seed + 2);
    k *= 1 - 0.3 * dirt * (1 - smoothstep(0, 0.4, y - base));
    return k;
  };
}

function placeAt(ctx: Context, storey: number, x: number, z: number): WearPlace {
  const [col, row] = ctx.cellOf(x, z);
  const plan = ctx.plan(storey);
  return {
    storey,
    base: storey * STOREY,
    ceiling: plan.ceiling,
    finish: ctx.finish(storey, col, row),
    depth: ctx.depth(storey, col, row),
  };
}

// ---- Walls ----

/** The faces between solid and empty on one storey's plan, merged into rectangles. */
function walls(ctx: Context, parts: PartBuilder, storey: number) {
  const plan = ctx.plan(storey);
  const { W, H } = ctx;
  const nb = plan.bands.length;
  const attrs = new Map<string, number>();
  const attrList: { code: number; col: number; row: number }[] = [{ code: 0, col: 0, row: 0 }];
  const intern = (code: number, col: number, row: number) => {
    const key = `${code},${col},${row}`;
    let id = attrs.get(key);
    if (id === undefined) {
      id = attrList.length;
      attrList.push({ code, col, row });
      attrs.set(key, id);
    }
    return id;
  };
  // What a face is, by its solid side's code and the cell of its empty side; 0 for no face.
  const faceAttr = (code: number, ei: number, ej: number) => {
    const x = ctx.minX + (ei + 0.5) * R;
    const z = ctx.minZ + (ej + 0.5) * R;
    const [col, row] = ctx.cellOf(x, z);
    if (!ctx.inGrid(col, row)) return 0;
    const tile = ctx.tile(storey, col, row);
    if (!tile || tile.kind === "solid" || tile.kind === "shaft") return 0;
    return intern(code, col, row);
  };

  for (const axis of ["x", "z"] as const) {
    const lines = axis === "x" ? W : H;
    const length = axis === "x" ? H : W;
    const plus = new Int32Array(nb * length);
    const minus = new Int32Array(nb * length);
    for (let line = 1; line < lines; line++) {
      plus.fill(0);
      minus.fill(0);
      let any = false;
      for (let b = 0; b < nb; b++) {
        const band = plan.bands[b];
        for (let t = 0; t < length; t++) {
          const ka = axis === "x" ? line - 1 + t * W : t + (line - 1) * W;
          const kb = axis === "x" ? line + t * W : t + line * W;
          const a = band[ka];
          const c = band[kb];
          if ((a === 0) === (c === 0)) continue;
          if (a !== 0) {
            const id = axis === "x" ? faceAttr(a, line, t) : faceAttr(a, t, line);
            if (id) {
              plus[b * length + t] = id;
              any = true;
            }
          } else {
            const id = axis === "x" ? faceAttr(c, line - 1, t) : faceAttr(c, t, line - 1);
            if (id) {
              minus[b * length + t] = id;
              any = true;
            }
          }
        }
      }
      if (!any) continue;
      const coord = (axis === "x" ? ctx.minX : ctx.minZ) + line * R;
      const start = axis === "x" ? ctx.minZ : ctx.minX;
      for (const [grid, sign] of [
        [plus, 1],
        [minus, -1],
      ] as const) {
        for (const rect of mergePlane(grid, nb, length)) {
          const attr = attrList[rect.attr];
          wallRect(ctx, parts, plan, {
            axis,
            sign,
            coord,
            a0: start + rect.t0 * R,
            a1: start + rect.t1 * R,
            y0: plan.ys[rect.b0],
            y1: plan.ys[rect.b1],
            code: attr.code,
            col: attr.col,
            row: attr.row,
          });
        }
      }
    }
  }
}

/** Rectangles of one plane of faces: columns split where any band changes, merged up, then across. */
function mergePlane(grid: Int32Array, nb: number, length: number) {
  const rects: { t0: number; t1: number; b0: number; b1: number; attr: number }[] = [];
  const breaks: number[] = [];
  for (let t = 0; t <= length; t++) {
    let change = t === 0 || t === length;
    if (!change) {
      for (let b = 0; b < nb; b++) {
        if (grid[b * length + t] !== grid[b * length + t - 1]) {
          change = true;
          break;
        }
      }
    }
    if (change) breaks.push(t);
  }
  let open: { t0: number; t1: number; b0: number; b1: number; attr: number }[] = [];
  for (let c = 0; c < breaks.length - 1; c++) {
    const t0 = breaks[c];
    const t1 = breaks[c + 1];
    const segments: { b0: number; b1: number; attr: number }[] = [];
    for (let b = 0; b < nb; b++) {
      const attr = grid[b * length + t0];
      if (!attr) continue;
      const last = segments[segments.length - 1];
      if (last && last.b1 === b && last.attr === attr) last.b1 = b + 1;
      else segments.push({ b0: b, b1: b + 1, attr });
    }
    const same =
      open.length === segments.length &&
      open.every(
        (o, i) => o.b0 === segments[i].b0 && o.b1 === segments[i].b1 && o.attr === segments[i].attr,
      ) &&
      open.length > 0 &&
      open[0].t1 === t0;
    if (same) {
      for (const o of open) o.t1 = t1;
    } else {
      rects.push(...open);
      open = segments.map((s) => ({ ...s, t0, t1 }));
    }
  }
  rects.push(...open);
  return rects;
}

interface WallFace {
  axis: "x" | "z";
  sign: 1 | -1;
  coord: number;
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  code: number;
  col: number;
  row: number;
}

/** The coats a wall face takes, by height above its floor. */
function zonesOf(
  ctx: Context,
  face: WallFace,
  plan: Plan,
  finish: Finish,
): [number, number, Coat][] {
  const livery = ctx.livery;
  if (face.code === ROCK || face.code === PIT) return [[-1, 99, { surface: "concrete-wall" }]];
  if (face.code === SLAB_EDGE)
    return [[-1, 99, { surface: "painted-steel", paint: livery.accent }]];
  // Arch reveals: hazard stripes where they're hit, steel above.
  const mid = (face.a0 + face.a1) / 2;
  const [cx, cz] = face.axis === "x" ? [face.coord, mid] : [mid, face.coord];
  const opening = ctx.openingAt(cx, (face.y0 + face.y1) / 2, cz);
  if (opening?.kind === "arch") {
    return [
      [-1, 1.2, { surface: "hazard" }],
      [1.2, 99, { surface: "painted-steel", paint: livery.accent }],
    ];
  }
  // Below ground, the outer walls hold the earth back: cast concrete.
  if (face.code === OUTER && plan.storey < 0) return [[-1, 99, { surface: "concrete-wall" }]];
  // Where there's no floor in front of it at this storey, a wall carries on as it is above: no
  // skirting or dado floating in the air.
  const tile = ctx.tile(plan.storey, face.col, face.row);
  if (
    tile &&
    (tile.kind === "open" || tile.kind === "well" || tile.kind === "pit" || tile.kind === "bridge")
  ) {
    const coat =
      face.code === OUTER && finish.clad && plan.storey >= 0 ? finish.clad.coat : finish.upper;
    return [[-1, 99, coat]];
  }
  const zones: [number, number, Coat][] = [];
  let y = -1;
  if (finish.kick) {
    zones.push([y, finish.kick.height, finish.kick.coat]);
    y = finish.kick.height;
  }
  zones.push([y, finish.dado, finish.lower]);
  y = finish.dado;
  if (finish.band) {
    zones.push([y, y + finish.band.height, finish.band.coat]);
    y += finish.band.height;
  }
  if (face.code === OUTER && finish.clad && plan.storey >= 0) {
    zones.push([y, finish.clad.from, finish.upper]);
    zones.push([finish.clad.from, 99, finish.clad.coat]);
  } else {
    zones.push([y, 99, finish.upper]);
  }
  return zones;
}

function wallRect(ctx: Context, parts: PartBuilder, plan: Plan, face: WallFace) {
  const finish = ctx.finish(plan.storey, face.col, face.row);
  const place: WearPlace = {
    storey: plan.storey,
    base: plan.base,
    ceiling: plan.ceiling,
    finish,
    depth: ctx.depth(plan.storey, face.col, face.row),
  };
  parts.wear = wallWear(ctx, place);
  const normal: Vec3 = face.axis === "x" ? [face.sign, 0, 0] : [0, 0, face.sign];
  const columns = cuts(face.a0, face.a1, 0.5);
  for (const [z0, z1, coat] of zonesOf(ctx, face, plan, finish)) {
    const y0 = Math.max(face.y0, plan.base + z0);
    const y1 = Math.min(face.y1, plan.base + z1);
    if (y1 - y0 < EPS) continue;
    parts.paint = linear(coat.paint);
    if (coat.surface === "corrugated") {
      corrugated(parts, face, normal, y0, y1);
      continue;
    }
    const origin: Vec3 = face.axis === "x" ? [face.coord, y0, face.a0] : [face.a0, y0, face.coord];
    const u: Vec3 = face.axis === "x" ? [0, 0, face.a1 - face.a0] : [face.a1 - face.a0, 0, 0];
    parts.quad(
      coat.surface,
      origin,
      u,
      [0, y1 - y0, 0],
      normal,
      fractions(columns, face.a0, face.a1),
      fractions(rows(plan.base, y0, y1), y0, y1),
    );
  }
  // Under the roof, a closure angle where the wall meets the deck, hiding the ribs' ends.
  if (plan.storey === ctx.top && face.y1 >= plan.ceiling - EPS && face.code !== SLAB_EDGE) {
    const tiled = finish.ceiling === "tile" && suspended(ctx, face.col, face.row);
    if (!tiled) {
      parts.paint = linear(ctx.livery.steel);
      parts.wear = steelWear(ctx, plan.base, 0);
      const out = face.sign * 0.05;
      const [lo, hi] = [
        Math.min(face.coord, face.coord + out),
        Math.max(face.coord, face.coord + out),
      ];
      const y = plan.ceiling;
      if (face.axis === "x")
        parts.box("painted-steel", [lo, y - 0.07, face.a0], [hi, y, face.a1], 0.003, ["+y"]);
      else parts.box("painted-steel", [face.a0, y - 0.07, lo], [face.a1, y, hi], 0.003, ["+y"]);
    }
  }
  // A trim where walls meet a tiled ceiling.
  if (finish.ceiling === "tile" && face.y1 >= plan.ceiling - EPS && face.code !== SLAB_EDGE) {
    parts.paint = linear(rgb(0.86, 0.86, 0.84));
    parts.wear = steelWear(ctx, plan.base, 0);
    const out = face.sign * 0.022;
    const y = plan.storey === ctx.top ? plan.ceiling - SUSPENDED_DROP : plan.ceiling;
    if (face.axis === "x") {
      parts.box(
        "painted-steel",
        [Math.min(face.coord, face.coord + out), y - 0.022, face.a0],
        [Math.max(face.coord, face.coord + out), y, face.a1],
        0.002,
      );
    } else {
      parts.box(
        "painted-steel",
        [face.a0, y - 0.022, Math.min(face.coord, face.coord + out)],
        [face.a1, y, Math.max(face.coord, face.coord + out)],
        0.002,
      );
    }
  }
  // Steel columns along the outer walls of big rooms, a cell apart.
  if (
    face.code === OUTER &&
    finish.pilasters &&
    plan.storey >= 0 &&
    face.y0 <= plan.base + EPS &&
    face.y1 >= plan.ceiling - EPS
  ) {
    const grid = ctx.level.grid as NonNullable<Level["grid"]>;
    const origin = face.axis === "x" ? grid.z : grid.x;
    for (
      let k = Math.ceil((face.a0 - origin + 0.35) / CELL);
      origin + k * CELL < face.a1 - 0.35;
      k++
    ) {
      pilaster(ctx, parts, plan, face, origin + k * CELL);
    }
  }
}

/**
 * Corrugated cladding, its profile in the geometry: vertical corrugations 76.2 mm apart, 18 mm
 * deep, standing proud of the wall, in phase with the texture's (crests where u is a whole number
 * of pitches), so the bake's laps and screws sit in its valleys.
 */
function corrugated(parts: PartBuilder, face: WallFace, normal: Vec3, y0: number, y1: number) {
  const pitch = 0.0762;
  const depth = 0.018;
  // The texture's u along this face, as the builder's box projection gives it, in meters.
  const flip = face.axis === "x" ? face.sign : -face.sign;
  const us: number[] = [];
  const first = Math.floor(Math.min(face.a0 * flip, face.a1 * flip) / (pitch / 6));
  const last = Math.ceil(Math.max(face.a0 * flip, face.a1 * flip) / (pitch / 6));
  for (let k = first; k <= last; k++) {
    const a = Math.min(face.a1, Math.max(face.a0, (k * pitch) / 6 / flip));
    if (us.length === 0 || Math.abs(a - us[us.length - 1]) > 1e-5) us.push(a);
  }
  us.sort((p, q) => p - q);
  const along: Vec3 = face.axis === "x" ? [0, 0, 1] : [1, 0, 0];
  parts.sheet(
    "corrugated",
    us,
    rows(Math.floor(y0 / STOREY + EPS) * STOREY, y0, y1),
    (a, y) => {
      const phase = (2 * Math.PI * a * flip) / pitch;
      const d = depth * (0.5 + 0.5 * Math.cos(phase)) + 0.003;
      // How fast it comes out along a, and the normal leaning against that.
      const slope = -depth * 0.5 * Math.sin(phase) * ((2 * Math.PI * flip) / pitch);
      const len = Math.hypot(1, slope);
      const out = face.sign * d;
      const p: Vec3 = face.axis === "x" ? [face.coord + out, y, a] : [a, y, face.coord + out];
      const n: Vec3 = [
        (normal[0] - slope * along[0]) / len,
        0,
        (normal[2] - slope * along[2]) / len,
      ];
      return [p, n];
    },
    { bump: 0.5 },
  );
}

/** A steel column half buried in an outer wall: its flange and the edges of its web. */
function pilaster(ctx: Context, parts: PartBuilder, plan: Plan, face: WallFace, at: number) {
  // Not where a wall meets this one.
  const [px, pz] =
    face.axis === "x" ? [face.coord + face.sign * 0.5, at] : [at, face.coord + face.sign * 0.5];
  if (ctx.enclosed(plan.storey, 0, px, pz, 0.28) > 0.01) return;
  parts.paint = linear(ctx.livery.steel);
  parts.wear = steelWear(ctx, plan.base, 0.6);
  const out = 0.07;
  const half = 0.11;
  const y0 = plan.base;
  const y1 = plan.ceiling;
  const lo = Math.min(face.coord, face.coord + face.sign * out);
  const hi = Math.max(face.coord, face.coord + face.sign * out);
  if (face.axis === "x")
    parts.box("painted-steel", [lo - 0.01, y0, at - half], [hi, y1, at + half], 0.006, [
      "-y",
      "+y",
    ]);
  else
    parts.box("painted-steel", [at - half, y0, lo - 0.01], [at + half, y1, hi], 0.006, [
      "-y",
      "+y",
    ]);
  // A base plate.
  const plate = 0.025;
  const lo2 = Math.min(face.coord, face.coord + face.sign * (out + 0.03));
  const hi2 = Math.max(face.coord, face.coord + face.sign * (out + 0.03));
  if (face.axis === "x")
    parts.box(
      "painted-steel",
      [lo2 - 0.01, y0, at - half - 0.04],
      [hi2, y0 + plate, at + half + 0.04],
      0.004,
      ["-y"],
    );
  else
    parts.box(
      "painted-steel",
      [at - half - 0.04, y0, lo2 - 0.01],
      [at + half + 0.04, y0 + plate, hi2],
      0.004,
      ["-y"],
    );
}

/** Tops of walls that stop under open air, and the undersides of door and arch heads. */
function caps(ctx: Context, parts: PartBuilder, storey: number) {
  const plan = ctx.plan(storey);
  const { W, H } = ctx;
  const nb = plan.bands.length;
  for (let b = 0; b < nb; b++) {
    const lower = plan.bands[b];
    const upper =
      b + 1 < nb ? plan.bands[b + 1] : storey < ctx.top ? ctx.plan(storey + 1).bands[0] : undefined;
    if (!upper) continue;
    const y = plan.ys[b + 1];
    const ups = new Int32Array(W * H);
    const downs = new Int32Array(W * H);
    let any = false;
    for (let k = 0; k < W * H; k++) {
      const a = lower[k];
      const c = upper[k];
      if (a && !c && a !== SLAB_EDGE) {
        ups[k] = a;
        any = true;
      } else if (!a && c && c !== SLAB_EDGE && b + 1 < nb) {
        downs[k] = c;
        any = true;
      }
    }
    if (!any) continue;
    for (const [grid, up] of [
      [ups, true],
      [downs, false],
    ] as const) {
      for (const rect of greedy(grid, W, H)) {
        const x0 = ctx.minX + rect.i0 * R;
        const x1 = ctx.minX + rect.i1 * R;
        const z0 = ctx.minZ + rect.j0 * R;
        const z1 = ctx.minZ + rect.j1 * R;
        const [col, row] = ctx.cellOf((x0 + x1) / 2, (z0 + z1) / 2);
        if (!ctx.inGrid(col, row)) continue;
        const finish = ctx.finish(storey, col, row);
        let coat: Coat;
        const opening = ctx.openingAt((x0 + x1) / 2, y, (z0 + z1) / 2);
        if (up) coat = { surface: "concrete-wall" };
        else if (opening?.kind === "arch")
          coat = { surface: "painted-steel", paint: ctx.livery.accent };
        else coat = finish.upper.surface === "corrugated" ? finish.lower : finish.upper;
        parts.paint = linear(coat.paint);
        parts.wear = steelWear(ctx, plan.base, 0);
        parts.quad(
          coat.surface,
          [x0, y, z0],
          [x1 - x0, 0, 0],
          [0, 0, z1 - z0],
          [0, up ? 1 : -1, 0],
        );
      }
    }
  }
}

/** Rectangles covering the non-zero pixels of a grid, each of one value. */
function greedy(grid: Int32Array, W: number, H: number) {
  const done = new Uint8Array(W * H);
  const rects: { i0: number; i1: number; j0: number; j1: number; value: number }[] = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = i + j * W;
      const value = grid[k];
      if (!value || done[k]) continue;
      let i1 = i + 1;
      while (i1 < W && grid[i1 + j * W] === value && !done[i1 + j * W]) i1++;
      let j1 = j + 1;
      grow: while (j1 < H) {
        for (let t = i; t < i1; t++) {
          if (grid[t + j1 * W] !== value || done[t + j1 * W]) break grow;
        }
        j1++;
      }
      for (let jj = j; jj < j1; jj++) for (let ii = i; ii < i1; ii++) done[ii + jj * W] = 1;
      rects.push({ i0: i, i1, j0: j, j1, value });
    }
  }
  return rects;
}

// ---- Floors and ceilings ----

function storeyOf(y: number): number {
  return Math.round(y / STOREY);
}

function floors(ctx: Context, parts: PartBuilder) {
  for (const floor of ctx.level.floors) {
    if (floor.kind !== "floor") continue;
    const storey = storeyOf(floor.y);
    parts.chunk = `s${storey}`;
    const x = (floor.minX + floor.maxX) / 2;
    const z = (floor.minZ + floor.maxZ) / 2;
    const place = placeAt(ctx, storey, x, z);
    parts.wear = floorWear(ctx, place);
    parts.paint = linear(place.finish.floor.paint);
    parts.quad(
      place.finish.floor.surface,
      [floor.minX, floor.y, floor.minZ],
      [floor.maxX - floor.minX, 0, 0],
      [0, 0, floor.maxZ - floor.minZ],
      [0, 1, 0],
      fractions(cuts(floor.minX, floor.maxX, 0.5), floor.minX, floor.maxX),
      fractions(cuts(floor.minZ, floor.maxZ, 0.5), floor.minZ, floor.maxZ),
    );
  }
}

/** Bare concrete soffits, rougher than the walls' bake, so tubes close by don't glint on them. */
const SOFFIT = {
  roughness: 1.35,
  bump: 0.7,
  // Hex tiling, turned any way: the bake's stains and board marks would line up in rows otherwise.
  variation: { sampling: { kind: "hex" as const, cells: 1.6, rotate: 1, contrast: 0.4 } },
};
/** How far below the roof a suspended ceiling hangs: just clear of the deck's ribs. */
const SUSPENDED_DROP = 0.045;

/** Whether a cell on the top storey has a suspended ceiling instead of the roof's deck. */
function suspended(ctx: Context, col: number, row: number): boolean {
  const tile = ctx.tile(ctx.top, col, row);
  if (tile?.kind !== "floor" && tile?.kind !== "tv" && tile?.kind !== "ladder") return false;
  return ctx.finish(ctx.top, col, row).ceiling === "tile";
}

/** The undersides of floors over rooms, and shallow downstand beams in the bigger rooms. */
function ceilings(ctx: Context, parts: PartBuilder) {
  const slabs = new Map<string, Floor>();
  for (const floor of ctx.level.floors) {
    if (floor.kind !== "floor" && floor.kind !== "stairs") continue;
    const storey = storeyOf(floor.y) - 1;
    if (storey < ctx.bottom) continue;
    const [col, row] = ctx.cellOf((floor.minX + floor.maxX) / 2, (floor.minZ + floor.maxZ) / 2);
    const tile = ctx.tile(storey, col, row);
    if (!tile || tile.kind === "solid") continue;
    slabs.set(`${storey},${col},${row}`, floor);
    parts.chunk = `s${storey}`;
    const place = placeAt(
      ctx,
      storey,
      (floor.minX + floor.maxX) / 2,
      (floor.minZ + floor.maxZ) / 2,
    );
    const y = floor.y - floor.thickness;
    parts.wear = ceilingWear(ctx, place);
    parts.paint = undefined;
    const surface: SurfaceName = place.finish.ceiling === "tile" ? "ceiling-tile" : "concrete-wall";
    parts.quad(
      surface,
      [floor.minX, y, floor.minZ],
      [floor.maxX - floor.minX, 0, 0],
      [0, 0, floor.maxZ - floor.minZ],
      [0, -1, 0],
      fractions(cuts(floor.minX, floor.maxX, 1, 0.3), floor.minX, floor.maxX),
      fractions(cuts(floor.minZ, floor.maxZ, 1, 0.3), floor.minZ, floor.maxZ),
      surface === "concrete-wall" ? SOFFIT : undefined,
    );
  }
  // Under the roof, offices and staff rooms get a suspended ceiling, just under the deck.
  const top = ctx.top;
  const roof = ctx.level.roof ?? (top + 1) * STOREY;
  for (let row = 0; row < ctx.parsed.rows; row++) {
    for (let col = 0; col < ctx.parsed.cols; col++) {
      if (!suspended(ctx, col, row)) continue;
      const cell = ctx.cellBox(col, row);
      parts.chunk = `s${top}`;
      const place = placeAt(ctx, top, (cell.minX + cell.maxX) / 2, (cell.minZ + cell.maxZ) / 2);
      parts.wear = ceilingWear(ctx, place);
      parts.paint = undefined;
      parts.quad(
        "ceiling-tile",
        [cell.minX, roof - SUSPENDED_DROP, cell.minZ],
        [CELL, 0, 0],
        [0, 0, CELL],
        [0, -1, 0],
        fractions(cuts(cell.minX, cell.maxX, 1, 0.3), cell.minX, cell.maxX),
        fractions(cuts(cell.minZ, cell.maxZ, 1, 0.3), cell.minZ, cell.maxZ),
      );
    }
  }
  // Beams along each room's long axis, on the edges between its cells.
  const BEAM = { width: 0.36, depth: 0.12 };
  for (const room of ctx.level.rooms) {
    const finish = ctx.finish(room.storey, room.cells[0].col, room.cells[0].row);
    if (!finish.beams || finish.ceiling !== "slab") continue;
    const alongX = room.bounds.maxX - room.bounds.minX >= room.bounds.maxZ - room.bounds.minZ;
    const cells = new Set(room.cells.map(({ col, row }) => `${col},${row}`));
    const has = (col: number, row: number) =>
      cells.has(`${col},${row}`) && slabs.has(`${room.storey},${col},${row}`);
    parts.chunk = `s${room.storey}`;
    for (const { col, row } of room.cells) {
      // The edge to the north (along x) or east (along z) of this cell, if the room carries on.
      const [nc, nr] = alongX ? [col, row + 1] : [col + 1, row];
      if (!has(col, row) || !has(nc, nr)) continue;
      const slab = slabs.get(`${room.storey},${col},${row}`) as Floor;
      const y = slab.y - slab.thickness;
      const cell = ctx.cellBox(col, row);
      const place = placeAt(
        ctx,
        room.storey,
        (cell.minX + cell.maxX) / 2,
        (cell.minZ + cell.maxZ) / 2,
      );
      parts.wear = ceilingWear(ctx, place);
      parts.paint = undefined;
      parts.uvs = (px, py, pz) => [alongX ? px : pz, py * 3];
      if (alongX) {
        parts.box(
          "concrete-wall",
          [cell.minX, y - BEAM.depth, cell.maxZ - BEAM.width / 2],
          [cell.maxX, y + 0.01, cell.maxZ + BEAM.width / 2],
          0.015,
          ["+y", "-x", "+x"],
        );
      } else {
        parts.box(
          "concrete-wall",
          [cell.maxX - BEAM.width / 2, y - BEAM.depth, cell.minZ],
          [cell.maxX + BEAM.width / 2, y + 0.01, cell.maxZ],
          0.015,
          ["+y", "-z", "+z"],
        );
      }
      parts.uvs = undefined;
    }
  }
}

// ---- Stairs ----

const STEPS = 16;

function stairs(ctx: Context, parts: PartBuilder) {
  for (const floor of ctx.level.floors) {
    if (floor.kind !== "stairs" || !floor.rise) continue;
    const storey = storeyOf(floor.y);
    parts.chunk = `s${storey}`;
    const toward = floor.rise.toward;
    const [dx, dz] = OFFSET[toward];
    const alongX = dx !== 0;
    const sign = alongX ? dx : dz;
    const base = floor.y;
    const height = floor.rise.height;
    const [a0, a1] = alongX ? [floor.minX, floor.maxX] : [floor.minZ, floor.maxZ];
    const [c0, c1] = alongX ? [floor.minZ, floor.maxZ] : [floor.minX, floor.maxX];
    const length = a1 - a0;
    // Along the stairs from its foot, to world.
    const at = (t: number, across: number, y: number): Vec3 => {
      const a = sign > 0 ? a0 + t * length : a1 - t * length;
      return alongX ? [a, y, across] : [across, y, a];
    };
    const forward: Vec3 = alongX ? [sign, 0, 0] : [0, 0, sign];
    const sideNormal = (s: number): Vec3 => (alongX ? [0, 0, s] : [s, 0, 0]);
    const [col, row] = ctx.cellOf((floor.minX + floor.maxX) / 2, (floor.minZ + floor.maxZ) / 2);
    const place = placeAt(
      ctx,
      storey,
      (floor.minX + floor.maxX) / 2,
      (floor.minZ + floor.maxZ) / 2,
    );
    const sides = SIDES.filter((s) => s !== toward && s !== OPPOSITE[toward]);
    // Sides open to the room beside: drawn, with a steel stringer. Walled ones are in the wall.
    const open = (side: Side) => {
      const next = ctx.tile(storey, col + OFFSET[side][0], row + OFFSET[side][1]);
      return ctx.parsed.edge(storey, col, row, side) === "none" && !!next && next.kind !== "solid";
    };
    const tread = (i: number) => base + (height * (i + 0.5)) / STEPS;
    for (let i = 0; i < STEPS; i++) {
      const t0 = i / STEPS;
      const t1 = (i + 1) / STEPS;
      const y = tread(i);
      const below = i === 0 ? base : tread(i - 1);
      parts.wear = floorWear(ctx, place);
      parts.paint = undefined;
      // The tread.
      const p0 = at(t0, c0, y);
      const p1 = at(t1, c0, y);
      const q0 = at(t0, c1, y);
      parts.quad(
        "concrete-floor",
        p0,
        sub3(p1, p0),
        sub3(q0, p0),
        [0, 1, 0],
        [0, 1],
        cuts(0, c1 - c0, 0.5).map((v) => v / (c1 - c0)),
      );
      // The riser.
      const r0 = at(t0, c0, below);
      parts.quad(
        "concrete-floor",
        r0,
        [0, y - below, 0],
        sub3(at(t0, c1, below), r0),
        scale3(forward, -1),
        [0, 1],
        cuts(0, c1 - c0, 0.5).map((v) => v / (c1 - c0)),
      );
      // A hazard nosing on its front edge.
      const n0 = at(t0 + 0.004, c0 + 0.08, y);
      const n1 = at(t0 + 0.05 / length + 0.004, c1 - 0.08, y + 0.004);
      parts.paint = undefined;
      parts.wear = steelWear(ctx, base, 0.2);
      parts.box(
        "hazard",
        [Math.min(n0[0], n1[0]), y - 0.002, Math.min(n0[2], n1[2])],
        [Math.max(n0[0], n1[0]), y + 0.004, Math.max(n0[2], n1[2])],
        0.002,
        ["-y"],
      );
      // The sides.
      for (const side of sides) {
        if (!open(side)) continue;
        const s = OFFSET[side][alongX ? 1 : 0];
        const across = s > 0 ? c1 : c0;
        parts.wear = wallWear(ctx, place);
        const f0 = at(t0, across, base);
        parts.quad(
          "concrete-wall",
          f0,
          sub3(at(t1, across, base), f0),
          [0, y - base, 0],
          sideNormal(s),
          [0, 1],
          fractions(rows(base, base, y), base, y),
        );
      }
    }
    // The back of the stairs, under the top step.
    const topY = tread(STEPS - 1);
    parts.wear = wallWear(ctx, place);
    const b0 = at(1, c0, base);
    parts.quad(
      "concrete-wall",
      b0,
      sub3(at(1, c1, base), b0),
      [0, topY - base, 0],
      forward,
      cuts(0, c1 - c0, 0.5).map((v) => v / (c1 - c0)),
      fractions(rows(base, base, topY), base, topY),
    );
    // Handrails up both sides, where the collision has them: posts, top and middle rails, and a
    // stringer along open sides; against a wall, a rail on brackets.
    for (const side of sides) {
      const s = OFFSET[side][alongX ? 1 : 0];
      const walled = !open(side);
      const across =
        s > 0 ? c1 - (walled ? WALL / 2 + 0.07 : 0.03) : c0 + (walled ? WALL / 2 + 0.07 : 0.03);
      const ramp = (t: number) => base + height * t;
      parts.paint = linear(ctx.livery.rail);
      parts.wear = steelWear(ctx, base, 0.3);
      const tube = square(0.022);
      const foot = at(-0.02, across, ramp(0) + 0.95);
      const head = at(1.02, across, ramp(1) + 0.95);
      parts.bar("painted-steel", foot, head, tube);
      if (walled) {
        for (let t = 0.1; t < 1; t += 0.3) {
          const p = at(t, across, ramp(t) + 0.95);
          const w = at(t, s > 0 ? c1 - WALL / 2 : c0 + WALL / 2, ramp(t) + 0.9);
          parts.bar("painted-steel", [p[0], p[1] - 0.05, p[2]], w, square(0.008));
        }
        continue;
      }
      parts.bar(
        "painted-steel",
        at(0, across, ramp(0) + 0.5),
        at(1, across, ramp(1) + 0.5),
        square(0.016),
      );
      const posts = Math.ceil(length / 1.1);
      for (let k = 0; k <= posts; k++) {
        const t = k / posts;
        const top = at(t, across, ramp(t) + 0.95);
        const footY = tread(Math.min(STEPS - 1, Math.floor(t * STEPS)));
        parts.box(
          "painted-steel",
          [top[0] - 0.02, footY, top[2] - 0.02],
          [top[0] + 0.02, top[1], top[2] + 0.02],
          0.004,
        );
      }
      // The stringer: a steel plate along the side, following the nosings.
      const outward = s * 0.008;
      const sAcross = (s > 0 ? c1 : c0) + outward;
      parts.paint = linear(ctx.livery.steel);
      parts.bar(
        "painted-steel",
        at(0, sAcross, base + 0.06),
        at(1, sAcross, base + height - 0.02),
        [
          [-0.006, -0.16],
          [0.006, -0.16],
          [0.006, 0.08],
          [-0.006, 0.08],
        ],
      );
    }
  }
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function square(half: number): [number, number][] {
  return [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
}
function octagon(r: number): [number, number][] {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

// ---- Railings, ladders, pits and planks ----

function railings(ctx: Context, parts: PartBuilder) {
  const posts = new Set<string>();
  for (const box of ctx.level.boxes) {
    if (box.kind !== "rail") continue;
    const storey = storeyOf(box.y);
    parts.chunk = `s${storey}`;
    parts.paint = linear(ctx.livery.rail);
    parts.wear = steelWear(ctx, box.y, 0.4);
    const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
    const mid = alongX ? (box.minZ + box.maxZ) / 2 : (box.minX + box.maxX) / 2;
    const [start, end] = alongX ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
    const at = (a: number, y: number): Vec3 => (alongX ? [a, y, mid] : [mid, y, a]);
    const top = box.y + box.height;
    parts.bar("painted-steel", at(start, top - 0.025), at(end, top - 0.025), square(0.025));
    parts.bar("painted-steel", at(start, box.y + 0.5), at(end, box.y + 0.5), square(0.016));
    // The kick plate, standing on the slab's edge.
    const k0 = at(start, box.y);
    const k1 = at(end, box.y + 0.1);
    const half = 0.004;
    parts.box(
      "painted-steel",
      alongX ? [k0[0], k0[1], mid - half] : [mid - half, k0[1], k0[2]],
      alongX ? [k1[0], k1[1], mid + half] : [mid + half, k1[1], k1[2]],
      0.002,
    );
    const count = Math.max(1, Math.round((end - start) / 1.33));
    for (let i = 0; i <= count; i++) {
      const p = at(start + ((end - start) * i) / count, top);
      const key = `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)},${Math.round(p[2] * 20)}`;
      if (posts.has(key)) continue;
      posts.add(key);
      parts.box(
        "painted-steel",
        [p[0] - 0.025, box.y, p[2] - 0.025],
        [p[0] + 0.025, top - 0.05, p[2] + 0.025],
        0.004,
        ["-y"],
      );
      // A base plate bolted down.
      parts.box(
        "painted-steel",
        [p[0] - 0.05, box.y, p[2] - 0.05],
        [p[0] + 0.05, box.y + 0.012, p[2] + 0.05],
        0.003,
        ["-y"],
      );
    }
  }
}

/** Steel ladders against their walls: flat-bar stiles, round rungs, brackets and a safety cage. */
function ladders(ctx: Context, parts: PartBuilder) {
  for (const ladder of ctx.level.ladders) {
    const storey = storeyOf(ladder.y);
    parts.chunk = `s${storey}`;
    parts.paint = undefined;
    parts.wear = steelWear(ctx, ladder.y, 0.4);
    const [dx, dz] = OFFSET[ladder.toward];
    const middle = { x: (ladder.minX + ladder.maxX) / 2, z: (ladder.minZ + ladder.maxZ) / 2 };
    // The wall's face, and the ladder a hand's width out from it.
    const face = dx ? (dx > 0 ? ladder.maxX : ladder.minX) : dz > 0 ? ladder.maxZ : ladder.minZ;
    const wallFace = face - (dx || dz) * LADDER_WALL;
    const line = wallFace - (dx || dz) * 0.14;
    const point = (across: number, out: number, y: number): Vec3 =>
      dx ? [line - dx * out, y, middle.z + across] : [middle.x + across, y, line - dz * out];
    const top = ladder.top + 1.05;
    for (const side of [-1, 1]) {
      const a = (side * LADDER_WIDTH) / 2;
      parts.bar(
        "galvanised",
        point(a, 0, ladder.y),
        point(a, 0, top),
        [
          [-0.008, -0.03],
          [0.008, -0.03],
          [0.008, 0.03],
          [-0.008, 0.03],
        ],
        dx ? [1, 0, 0] : [0, 0, 1],
      );
      // Brackets back to the wall.
      for (let y = ladder.y + 0.4; y < top; y += 1.3) {
        parts.bar("galvanised", point(a, -0.03, y), point(a, -0.14, y), square(0.012));
      }
    }
    for (let y = ladder.y + 0.3; y < top - 0.1; y += 0.3) {
      parts.bar(
        "galvanised",
        point(-LADDER_WIDTH / 2, 0, y),
        point(LADDER_WIDTH / 2, 0, y),
        octagon(0.013),
      );
    }
    // The cage, from head height up.
    const hoops: number[] = [];
    for (let y = ladder.y + 2.3; y <= top + EPS; y += 0.7) hoops.push(y);
    const arc = (y: number, th: number) =>
      point(Math.cos(th) * (LADDER_WIDTH / 2 + 0.02), 0.04 + Math.sin(th) * 0.62, y);
    const strip: [number, number][] = [
      [-0.004, -0.025],
      [0.004, -0.025],
      [0.004, 0.025],
      [-0.004, 0.025],
    ];
    for (const y of hoops) {
      for (let k = 0; k < 8; k++) {
        parts.bar(
          "galvanised",
          arc(y, (k / 8) * Math.PI),
          arc(y, ((k + 1) / 8) * Math.PI),
          strip,
          [0, 1, 0],
          false,
        );
      }
    }
    if (hoops.length > 1) {
      for (const th of [0.5, Math.PI / 2, Math.PI - 0.5]) {
        parts.bar("galvanised", arc(hoops[0], th), arc(hoops[hoops.length - 1], th), square(0.01));
      }
    }
  }
}

/** The walls of pit shafts, darkening down into the black. */
function pits(ctx: Context, parts: PartBuilder) {
  for (const box of ctx.level.boxes) {
    if (box.kind !== "pit") continue;
    const top = box.y + box.height;
    const storey = storeyOf(top);
    parts.chunk = `s${storey}`;
    const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
    // The face towards the pit: the side whose cell over the top is a pit.
    for (const s of [-1, 1]) {
      const coord = alongX ? (s > 0 ? box.maxZ : box.minZ) : s > 0 ? box.maxX : box.minX;
      const [col, row] = alongX
        ? ctx.cellOf((box.minX + box.maxX) / 2, coord + s * 0.05)
        : ctx.cellOf(coord + s * 0.05, (box.minZ + box.maxZ) / 2);
      const tile = ctx.tile(storey, col, row);
      if (tile?.kind !== "pit" && tile?.kind !== "bridge") continue;
      parts.paint = undefined;
      parts.wear = (x, y, z) =>
        mottle(x, y, z, ctx.seed + 4) * (0.12 + 0.88 * smoothstep(top - 7, top - 0.2, y));
      const [a0, a1] = alongX ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
      const origin: Vec3 = alongX ? [a0, box.y, coord] : [coord, box.y, a0];
      const u: Vec3 = alongX ? [a1 - a0, 0, 0] : [0, 0, a1 - a0];
      const ys = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 0.98, 1];
      parts.quad(
        "concrete-wall",
        origin,
        u,
        [0, box.height - 0.002, 0],
        alongX ? [0, 0, s] : [s, 0, 0],
        fractions(cuts(a0, a1, 1), a0, a1),
        ys,
      );
      // The edge: a steel angle on the slab's nose, and hazard paint on the floor behind it.
      const e = coord;
      parts.paint = linear(ctx.livery.steel);
      parts.wear = steelWear(ctx, top, 0.3);
      const lo = (v: number, w: number) => Math.min(v, v - s * w);
      const hi = (v: number, w: number) => Math.max(v, v - s * w);
      if (alongX) {
        parts.box(
          "painted-steel",
          [a0, top - 0.06, Math.min(e, e + s * 0.006)],
          [a1, top + 0.004, Math.max(e, e + s * 0.006)],
          0.002,
        );
        parts.box("painted-steel", [a0, top, lo(e, 0.06)], [a1, top + 0.005, hi(e, 0.06)], 0.002, [
          "-y",
        ]);
        parts.paint = undefined;
        parts.box(
          "hazard",
          [a0, top, lo(e - s * 0.06, 0.14)],
          [a1, top + 0.003, hi(e - s * 0.06, 0.14)],
          0.002,
          ["-y"],
        );
      } else {
        parts.box(
          "painted-steel",
          [Math.min(e, e + s * 0.006), top - 0.06, a0],
          [Math.max(e, e + s * 0.006), top + 0.004, a1],
          0.002,
        );
        parts.box("painted-steel", [lo(e, 0.06), top, a0], [hi(e, 0.06), top + 0.005, a1], 0.002, [
          "-y",
        ]);
        parts.paint = undefined;
        parts.box(
          "hazard",
          [lo(e - s * 0.06, 0.14), top, a0],
          [hi(e - s * 0.06, 0.14), top + 0.003, a1],
          0.002,
          ["-y"],
        );
      }
    }
  }
}

/** Planks across pits as two scaffold boards with banded ends. */
function planks(ctx: Context, parts: PartBuilder) {
  for (const floor of ctx.level.floors) {
    if (floor.kind !== "plank") continue;
    const storey = storeyOf(floor.y);
    parts.chunk = `s${storey}`;
    const alongX = floor.maxX - floor.minX > floor.maxZ - floor.minZ;
    const [col, row] = ctx.cellOf((floor.minX + floor.maxX) / 2, (floor.minZ + floor.maxZ) / 2);
    const bridgeAt = (dc: number, dr: number) =>
      ctx.tile(storey, col + dc, row + dr)?.kind === "bridge";
    const ext0 = (alongX ? bridgeAt(-1, 0) : bridgeAt(0, -1)) ? 0.003 : 0.2;
    const ext1 = (alongX ? bridgeAt(1, 0) : bridgeAt(0, 1)) ? 0.003 : 0.2;
    const [a0, a1] = alongX
      ? [floor.minX - ext0, floor.maxX + ext1]
      : [floor.minZ - ext0, floor.maxZ + ext1];
    const [c0, c1] = alongX ? [floor.minZ, floor.maxZ] : [floor.minX, floor.maxX];
    const width = (c1 - c0 - 0.02) / 2;
    parts.wear = steelWear(ctx, floor.y, 0.2);
    parts.paint = undefined;
    for (let k = 0; k < 2; k++) {
      const b0 = c0 + k * (width + 0.02);
      const b1 = b0 + width;
      const y0 = floor.y - 0.045;
      const lift = k * 0.004;
      parts.uvs = (x, _y, z) => (alongX ? [x, z * 2] : [z, x * 2]);
      if (alongX) parts.box("wood-plank", [a0, y0, b0], [a1, floor.y + lift, b1], 0.006);
      else parts.box("wood-plank", [b0, y0, a0], [b1, floor.y + lift, a1], 0.006);
      parts.uvs = undefined;
      // Steel bands round the ends.
      for (const end of [a0 + 0.06, a1 - 0.09]) {
        if (alongX)
          parts.box(
            "galvanised",
            [end, y0 - 0.002, b0 - 0.002],
            [end + 0.03, floor.y + lift + 0.002, b1 + 0.002],
            0.001,
          );
        else
          parts.box(
            "galvanised",
            [b0 - 0.002, y0 - 0.002, end],
            [b1 + 0.002, floor.y + lift + 0.002, end + 0.03],
            0.001,
          );
      }
    }
  }
}

// ---- Details ----

/** Arches get steel angles on their corners and a steel plate over them, on both sides. */
function openingTrims(ctx: Context, parts: PartBuilder) {
  for (const o of ctx.openings) {
    if (o.kind !== "arch") continue;
    parts.chunk = `s${o.storey}`;
    parts.paint = linear(ctx.livery.accent);
    parts.wear = steelWear(ctx, o.y0, 0.6);
    const leg = 0.05;
    const t = 0.006;
    const [l0, l1] = o.alongX ? [o.minX, o.maxX] : [o.minZ, o.maxZ];
    const [f0, f1] = o.alongX ? [o.minZ, o.maxZ] : [o.minX, o.maxX];
    const box = (a0: number, a1: number, b0: number, b1: number, y0: number, y1: number) =>
      o.alongX
        ? parts.box("painted-steel", [a0, y0, b0], [a1, y1, b1], 0.002)
        : parts.box("painted-steel", [b0, y0, a0], [b1, y1, a1], 0.002);
    for (const face of [f0, f1]) {
      const out = face === f0 ? -1 : 1;
      const fa = Math.min(face, face + out * t);
      const fb = Math.max(face, face + out * t);
      for (const jamb of [l0, l1]) {
        const into = jamb === l0 ? -1 : 1;
        // The leg on the wall's face and the leg on the reveal.
        box(
          Math.min(jamb, jamb + into * leg),
          Math.max(jamb, jamb + into * leg),
          fa,
          fb,
          o.y0,
          o.y1 + t,
        );
        const ja = Math.min(jamb, jamb - into * t);
        const jb = Math.max(jamb, jamb - into * t);
        box(ja, jb, Math.min(face, face - out * leg), Math.max(face, face - out * leg), o.y0, o.y1);
      }
      // The plate over the arch.
      box(
        l0 - 0.1,
        l1 + 0.1,
        Math.min(face, face + out * 0.012),
        Math.max(face, face + out * 0.012),
        o.y1,
        o.y1 + 0.22,
      );
    }
  }
}

/** Painted lines on the floors of halls and the loading bay, a little in from their walls. */
function lanes(ctx: Context, parts: PartBuilder) {
  const INSET = 1.0;
  const WIDTH = 0.1;
  for (const room of ctx.level.rooms) {
    if (room.storey < 0) continue;
    const finish = ctx.finish(room.storey, room.cells[0].col, room.cells[0].row);
    if (!finish.lanes) continue;
    parts.chunk = `s${room.storey}`;
    const base = room.storey * STOREY;
    const walled = (col: number, row: number, side: Side) => {
      const next = ctx.tile(room.storey, col + OFFSET[side][0], row + OFFSET[side][1]);
      return (
        ctx.parsed.edge(room.storey, col, row, side) !== "none" || !next || next.kind === "solid"
      );
    };
    for (const { col, row } of room.cells) {
      const tile = ctx.tile(room.storey, col, row);
      if (tile?.kind !== "floor" && tile?.kind !== "tv") continue;
      const cell = ctx.cellBox(col, row);
      const place = placeAt(
        ctx,
        room.storey,
        (cell.minX + cell.maxX) / 2,
        (cell.minZ + cell.maxZ) / 2,
      );
      parts.wear = floorWear(ctx, place);
      parts.paint = linear(rgb(0.85, 0.66, 0.08));
      for (const side of SIDES) {
        if (!walled(col, row, side)) continue;
        const alongX = side === "n" || side === "s";
        const [s0, s1] = alongX ? ["w", "e"] : ["s", "n"];
        const [a0, a1] = alongX ? [cell.minX, cell.maxX] : [cell.minZ, cell.maxZ];
        // Lines along x run into the corners; lines along z stop at them.
        const trim = alongX ? INSET : INSET + WIDTH;
        const start = walled(col, row, s0 as Side) ? a0 + trim : a0;
        const end = walled(col, row, s1 as Side) ? a1 - trim : a1;
        if (end - start < 0.2) continue;
        const line = {
          n: cell.maxZ - INSET,
          s: cell.minZ + INSET,
          e: cell.maxX - INSET,
          w: cell.minX + INSET,
        }[side];
        const [l0, l1] = side === "n" || side === "e" ? [line - WIDTH, line] : [line, line + WIDTH];
        // Not across the dock, which is hatched.
        const dock = room.storey === 0 ? ctx.level.dock : undefined;
        const [d0, d1, e0, e1] = dock
          ? alongX
            ? [dock.minZ, dock.maxZ, dock.minX, dock.maxX]
            : [dock.minX, dock.maxX, dock.minZ, dock.maxZ]
          : [0, 0, 0, 0];
        const spans: [number, number][] =
          dock && l1 > d0 && l0 < d1
            ? [
                [start, Math.min(end, e0 - 0.05)],
                [Math.max(start, e1 + 0.05), end],
              ]
            : [[start, end]];
        for (const [s0, s1] of spans) {
          if (s1 - s0 < 0.1) continue;
          if (alongX)
            parts.box("floor-paint", [s0, base, l0], [s1, base + 0.003, l1], 0.001, ["-y"]);
          else parts.box("floor-paint", [l0, base, s0], [l1, base + 0.003, s1], 0.001, ["-y"]);
        }
      }
    }
  }
  // The dock: hatched where finished loot goes.
  const dock = ctx.level.dock;
  if (dock) {
    parts.chunk = "s0";
    parts.paint = undefined;
    parts.wear = (x, y, z) => mottle(x, y, z, ctx.seed + 6) * 0.9;
    parts.box("hazard", [dock.minX, 0, dock.minZ], [dock.maxX, 0.003, dock.maxZ], 0.001, ["-y"]);
  }
}

/** Tread plates across the thresholds of plant rooms and below ground. */
function thresholds(ctx: Context, parts: PartBuilder) {
  for (const o of ctx.openings) {
    if (o.kind !== "door") continue;
    const x = (o.minX + o.maxX) / 2;
    const z = (o.minZ + o.maxZ) / 2;
    const [ox, oz] = o.alongX ? [0, 0.3] : [0.3, 0];
    const kinds = [ctx.cellOf(x - ox, z - oz), ctx.cellOf(x + ox, z + oz)].map(
      ([col, row]) => ctx.room(o.storey, col, row)?.kind,
    );
    if (o.storey >= 0 && !kinds.includes("plant") && !kinds.includes("workshop")) continue;
    parts.chunk = `s${o.storey}`;
    parts.paint = undefined;
    parts.wear = steelWear(ctx, o.y0, 0.5);
    const grow = 0.18;
    parts.box(
      "diamond-plate",
      [o.minX - (o.alongX ? 0 : grow), o.y0, o.minZ - (o.alongX ? grow : 0)],
      [o.maxX + (o.alongX ? 0 : grow), o.y0 + 0.006, o.maxZ + (o.alongX ? grow : 0)],
      0.003,
      ["-y"],
    );
  }
}

/** A roller shutter on the inside of the outer wall at the loading bay, behind the dock. */
function loadingDoor(ctx: Context, parts: PartBuilder) {
  const { level } = ctx;
  if (!level.dock || level.rooms.length === 0) return;
  const grid = level.grid as NonNullable<Level["grid"]>;
  const x = level.entrance.x;
  const face = grid.z + WALL / 2;
  const width = 3.8;
  const height = 2.45;
  const ceiling = ctx.plan(0).ceiling;
  parts.chunk = "s0";
  parts.wear = steelWear(ctx, 0, 0.6);
  // The curtain of slats.
  parts.paint = linear(vary(ctx.livery.steel, ctx.seed + 41, 0.05).scale(1.5));
  const slat = 0.1;
  const vs: number[] = [];
  for (let y = 0.06; y <= height; y += slat / 4) vs.push(round(y));
  parts.sheet("painted-steel", cuts(x - width / 2, x + width / 2, 0.5), vs, (a, y) => {
    const phase = ((y - 0.06) / slat) * Math.PI * 2;
    const d = 0.035 + 0.012 * Math.sin(phase);
    const slope = 0.012 * Math.cos(phase) * ((Math.PI * 2) / slat);
    const len = Math.hypot(1, slope);
    return [
      [a, y, face + d],
      [0, -slope / len, 1 / len],
    ];
  });
  // The bottom rail, rubber-edged.
  parts.paint = linear(ctx.livery.steel);
  parts.box(
    "painted-steel",
    [x - width / 2, 0.02, face],
    [x + width / 2, 0.08, face + 0.07],
    0.005,
  );
  parts.box("rubber", [x - width / 2, 0, face + 0.01], [x + width / 2, 0.02, face + 0.06], 0.004, [
    "-y",
  ]);
  // Guide channels up both sides, hazard-striped where trucks and trolleys hit them.
  for (const s of [-1, 1]) {
    const g0 = x + s * (width / 2 + 0.02);
    const g1 = g0 + s * 0.14;
    const [lo, hi] = [Math.min(g0, g1), Math.max(g0, g1)];
    parts.paint = linear(ctx.livery.accent);
    parts.box("painted-steel", [lo, 1.2, face], [hi, ceiling - 0.4, face + 0.12], 0.006, ["-y"]);
    parts.paint = undefined;
    parts.uvs = (px, py, pz) => [px + py, pz + py];
    parts.box("hazard", [lo, 0, face], [hi, 1.2, face + 0.12], 0.006, ["-y"]);
    parts.uvs = undefined;
  }
  // The drum's housing over it, up to the ceiling.
  parts.paint = linear(ctx.livery.accent);
  parts.box(
    "painted-steel",
    [x - width / 2 - 0.25, ceiling - 0.42, face],
    [x + width / 2 + 0.25, ceiling, face + 0.4],
    0.01,
    ["+y"],
  );
  // A control box beside it.
  parts.paint = linear(rgb(0.7, 0.7, 0.68));
  parts.box(
    "painted-steel",
    [x + width / 2 + 0.35, 1.2, face],
    [x + width / 2 + 0.6, 1.55, face + 0.12],
    0.008,
  );
}

/** The bottom of the pits: too deep to see, so plain black. */
function pitBottom(scene: Scene, level: Level) {
  const bottoms = level.boxes.filter((box) => box.kind === "pit");
  if (bottoms.length === 0) return;
  const deepest = Math.min(...bottoms.map((box) => box.y));
  const bottom = MeshBuilder.CreateGround(
    "pit-bottom",
    { width: level.size, height: level.size },
    scene,
  );
  bottom.position.y = deepest;
  const black = new StandardMaterial("pit-bottom", scene);
  black.disableLighting = true;
  black.emissiveColor = Color3.Black();
  bottom.material = black;
}

// ---- The roof ----

/**
 * The roof over a tile-built level: profiled metal deck on steel beams, each room's beams along
 * its length on the edges between its cells, the deck's ribs across them. Hung from the roof plane,
 * so beams stay clear of the ducts and lights hung along the rooms.
 */
export function addRoof(scene: Scene, level: Level): Mesh[] {
  const ctx = contextOf(level);
  const parts = new PartBuilder();
  const roof = level.roof ?? (ctx.top + 1) * STOREY;
  const storey = ctx.top;
  const { cols, rows: rowCount } = ctx.parsed;
  const along = (col: number, row: number): boolean => {
    const room = ctx.room(storey, col, row);
    if (!room) return true;
    return room.bounds.maxX - room.bounds.minX >= room.bounds.maxZ - room.bounds.minZ;
  };
  parts.chunk = "roof";
  // Cells round the grid's edge reach out over the playground's thick outer walls too.
  const extent = {
    minX: ctx.minX,
    maxX: ctx.minX + ctx.W * R,
    minZ: ctx.minZ,
    maxZ: ctx.minZ + ctx.H * R,
  };
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = ctx.tile(storey, col, row);
      if (tile?.kind === "solid" || suspended(ctx, col, row)) continue;
      const cell = ctx.cellBox(col, row);
      if (col === 0) cell.minX = extent.minX;
      if (col === cols - 1) cell.maxX = extent.maxX;
      if (row === 0) cell.minZ = extent.minZ;
      if (row === rowCount - 1) cell.maxZ = extent.maxZ;
      deck(ctx, parts, cell, roof, along(col, row));
    }
  }
  // Beams.
  const BEAM_DEPTH = 0.32;
  const section: [number, number][] = (() => {
    const f = 0.085;
    const tf = 0.012;
    const tw = 0.005;
    const d = BEAM_DEPTH;
    return [
      [-f, 0],
      [f, 0],
      [f, -tf],
      [tw, -tf],
      [tw, -d + tf],
      [f, -d + tf],
      [f, -d],
      [-f, -d],
      [-f, -d + tf],
      [-tw, -d + tf],
      [-tw, -tf],
      [-f, -tf],
    ];
  })();
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < cols; col++) {
      const alongX = along(col, row);
      const [nc, nr] = alongX ? [col, row + 1] : [col + 1, row];
      if (!ctx.inGrid(nc, nr)) continue;
      const here = ctx.room(storey, col, row);
      const there = ctx.room(storey, nc, nr);
      if (
        ctx.tile(storey, col, row)?.kind === "solid" ||
        ctx.tile(storey, nc, nr)?.kind === "solid"
      )
        continue;
      if (here !== there || along(nc, nr) !== alongX) continue;
      if (suspended(ctx, col, row) || suspended(ctx, nc, nr)) continue;
      if (ctx.parsed.edge(storey, col, row, alongX ? "n" : "e") !== "none") continue;
      const cell = ctx.cellBox(col, row);
      parts.paint = linear(ctx.livery.steel);
      parts.wear = (x, y, z) => mottle(x, y, z, ctx.seed + 8) * 0.95;
      const a: Vec3 = alongX ? [cell.minX, roof, cell.maxZ] : [cell.maxX, roof, cell.minZ];
      const b: Vec3 = alongX ? [cell.maxX, roof, cell.maxZ] : [cell.maxX, roof, cell.maxZ];
      parts.bar("painted-steel", a, b, section, [0, 1, 0], false);
    }
  }
  return parts.build(scene, "roof");
}

/**
 * Profiled deck over a patch of roof, ribs across the beams, as the texture has it: 152 mm apart,
 * the narrow flange 38 mm below the roof and the wide one against it, ribs along the texture's v.
 */
function deck(
  ctx: Context,
  parts: PartBuilder,
  cell: { minX: number; maxX: number; minZ: number; maxZ: number },
  roof: number,
  beamsAlongX: boolean,
) {
  const P = 0.1524;
  const D = 0.038;
  // One period from the middle of a wide flange to the next, as (offset, height).
  const profile: [number, number][] = [
    [-P / 2, 0],
    [-0.033, 0],
    [-0.022, -D],
    [0.022, -D],
    [0.033, 0],
    [P / 2, 0],
  ];
  // Ribs run across the beams: they repeat along the beams' direction.
  const [r0, r1] = beamsAlongX ? [cell.minX, cell.maxX] : [cell.minZ, cell.maxZ];
  const [s0, s1] = beamsAlongX ? [cell.minZ, cell.maxZ] : [cell.minX, cell.maxX];
  parts.paint = undefined;
  parts.wear = (x, y, z) =>
    mottle(x, y, z, ctx.seed + 7) * (0.9 + 0.1 * noise3(x / 5, 0, z / 5, ctx.seed));
  parts.uvs = (x, _y, z) => (beamsAlongX ? [x, z] : [z, x]);
  const stations = cuts(s0, s1, 2, 0.3);
  const point = (r: number, s: number, h: number): Vec3 =>
    beamsAlongX ? [r, roof + h, s] : [s, roof + h, r];
  for (let k = Math.floor(r0 / P) - 1; (k - 0.5) * P < r1; k++) {
    for (let i = 0; i < profile.length - 1; i++) {
      const o0 = k * P + profile[i][0];
      const o1 = k * P + profile[i + 1][0];
      if (o1 <= r0 || o0 >= r1) continue;
      const ha = profile[i][1];
      const hb = profile[i + 1][1];
      const height = (t: number) => ha + ((hb - ha) * (t - o0)) / (o1 - o0);
      const a = Math.max(o0, r0);
      const b = Math.min(o1, r1);
      if (b - a < 1e-5) continue;
      const ya = height(a);
      const yb = height(b);
      // Facing down, tilted on the webs.
      const dr = b - a;
      const dh = yb - ya;
      const len = Math.hypot(dr, dh);
      const nr = dh / len;
      const nh = -dr / len;
      const n: Vec3 = beamsAlongX ? [nr, nh, 0] : [0, nh, nr];
      const p0 = point(a, s0, ya);
      const p1 = point(b, s0, yb);
      const q0 = point(a, s1, ya);
      parts.quad(
        "metal-deck",
        p0,
        sub3(p1, p0),
        sub3(q0, p0),
        n,
        [0, 1],
        fractions(stations, s0, s1),
        { bump: 0.5 },
      );
    }
  }
  parts.uvs = undefined;
}
