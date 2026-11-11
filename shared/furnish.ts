import type { Box } from "./collision";
import { ITEM_KINDS, type ItemKind, PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP } from "./constants";
import { type Generated, random } from "./generate";
import type { ItemSpawn, LevelBox, LightSpawn, PropSpawn, Room, RoomKind } from "./level";
import { PROPS, type PropName } from "./props";
import {
  CELL,
  GROUND,
  isOpening,
  OFFSET,
  OPPOSITE,
  openingOf,
  type ParsedGrid,
  parseTiles,
  SIDES,
  type Side,
  SLAB,
  STOREY,
  type Tile,
  type TileGrid,
  WALL,
} from "./tiles";

/**
 * The third layer of a generated level, after the layout and the tiles (shared/generate.ts): what
 * stands in each room, how it's lit, and where the loot is. Halls get rows of pallet racking and
 * shipping containers with bay signs and high-bay lamps over the aisles; cages are fenced in with
 * chain-link; storerooms, workshops, offices, staff and plant rooms get what they're for along
 * their walls and in their middles; every room gets its fittings: door frames, extinguishers, exit
 * signs on the way out, ducts and pipes under the ceiling, cameras. Lights are fewer, flickering
 * and dead the further in a room is, and some deep rooms are dark. Loot is worth more the further
 * in, the higher up and the darker it is.
 *
 * Some rules hold whatever the seed, and are checked here, not hoped for (`checkFurnished` checks
 * them again on a finished level):
 *
 * - Every way through keeps a clear width of 1.4 m, so two people carrying a sofa get through: a
 *   flood fill over a fine grid with a disc that wide finds every doorway, stairs and aisle it found
 *   before anything was placed, and props that get in its way are taken away again.
 * - Doorways, the feet and tops of stairs, ladders, plank ends, the dock and where players start
 *   are kept clear.
 * - Wall props hang on a wall that's there, and ceiling props under a ceiling that's there.
 * - Every item can be reached from the entrance, the two-handed ones without a ladder, and the
 *   sofas by that 1.4 m disc.
 *
 * Pure: the same level from the same seed, on the server and every client.
 */

/** A point on a storey. */
interface Point {
  storey: number;
  x: number;
  z: number;
}

/**
 * Ways of getting about: anyone walking, up ladders and over planks; someone carrying a two-handed
 * thing, who can't climb; and two people with a sofa between them, who need 1.4 m and can't take a
 * plank either.
 */
type Mode = "walk" | "carry" | "wide";
const MODES: readonly Mode[] = ["walk", "carry", "wide"];
/** The clear width every way through keeps, halved. */
const WIDE = 0.7;
const RADIUS: Record<Mode, number> = { walk: PLAYER_RADIUS, carry: PLAYER_RADIUS, wide: WIDE };
/** The fine grid the flood fills go over, in meters. */
const STEP = 0.25;
/** How far in front of a doorway, the foot of stairs and such the point that must be reached is. */
const APPROACH = 1;
/** How deep the space kept clear in front of a doorway, stairs or a ladder is. */
const KEEP_CLEAR = 1.8;

const TURN: Record<Side, number> = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 };

/** Whether two boxes overlap by more than a hair. */
function overlaps(a: Box, b: Box, margin = 0): boolean {
  const e = 0.005 - margin;
  return a.minX < b.maxX - e && b.minX < a.maxX - e && a.minZ < b.maxZ - e && b.minZ < a.maxZ - e;
}

/** The ground a prop covers, standing at a point and turned so. */
function footprint(model: PropName, x: number, z: number, turn: number): Box {
  const [width, , depth] = PROPS[model].size;
  const c = Math.abs(Math.cos(turn));
  const s = Math.abs(Math.sin(turn));
  const halfX = (c * width + s * depth) / 2;
  const halfZ = (s * width + c * depth) / 2;
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

/** A grid of tiles, read, with what the layers above need to know about its cells. */
class Building {
  readonly parsed: ParsedGrid;
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly basements: number;
  /** The highest storey. */
  readonly top: number;
  constructor(grid: TileGrid) {
    this.parsed = parseTiles(grid);
    this.x0 = grid.x;
    this.z0 = grid.z;
    this.cols = this.parsed.cols;
    this.rows = this.parsed.rows;
    this.basements = this.parsed.basements;
    this.top = this.parsed.tiles.length - this.basements - 1;
  }
  storeys(): number[] {
    const result: number[] = [];
    for (let s = -this.basements; s <= this.top; s++) result.push(s);
    return result;
  }
  tile(storey: number, col: number, row: number): Tile | undefined {
    if (storey < -this.basements || storey > this.top) return undefined;
    return this.parsed.tile(storey, col, row);
  }
  /** Somewhere to walk on: floor, a TV's floor, or a ladder's. */
  walkable(storey: number, col: number, row: number): boolean {
    const kind = this.tile(storey, col, row)?.kind;
    return kind === "floor" || kind === "tv" || kind === "ladder";
  }
  /** Somewhere a prop can stand: plain floor. */
  standable(storey: number, col: number, row: number): boolean {
    const kind = this.tile(storey, col, row)?.kind;
    return kind === "floor" || kind === "tv";
  }
  /**
   * The underside of the ceiling over a cell, or undefined where there isn't one: under the roof on
   * the top storey, else under a floor slab above. Not over stairs, wells or open air.
   */
  ceiling(storey: number, col: number, row: number): number | undefined {
    if (!this.walkable(storey, col, row)) return undefined;
    const base = storey * STOREY;
    if (storey === this.top) return base + STOREY;
    if (!this.walkable(storey + 1, col, row)) return undefined;
    return base + STOREY - (storey + 1 === 0 ? GROUND : SLAB);
  }
  cellBox(col: number, row: number): Box {
    return {
      minX: this.x0 + col * CELL,
      maxX: this.x0 + (col + 1) * CELL,
      minZ: this.z0 + row * CELL,
      maxZ: this.z0 + (row + 1) * CELL,
    };
  }
  /** The cells a box covers. */
  cellsUnder(box: Box): { col: number; row: number }[] {
    const cells: { col: number; row: number }[] = [];
    const c0 = Math.floor((box.minX - this.x0 + 0.001) / CELL);
    const c1 = Math.floor((box.maxX - this.x0 - 0.001) / CELL);
    const r0 = Math.floor((box.minZ - this.z0 + 0.001) / CELL);
    const r1 = Math.floor((box.maxZ - this.z0 - 0.001) / CELL);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) cells.push({ col, row });
    }
    return cells;
  }
  /** The point in a cell in the middle of its edge on one side, this far in. */
  inFront(storey: number, col: number, row: number, side: Side, depth: number): Point {
    const box = this.cellBox(col, row);
    const [dx, dz] = OFFSET[side];
    const x = (box.minX + box.maxX) / 2 + dx * (CELL / 2 - depth);
    const z = (box.minZ + box.maxZ) / 2 + dz * (CELL / 2 - depth);
    return { storey, x, z };
  }
  /** The strip along a cell's side, this deep, as wide as asked and centred, or the whole side. */
  strip(col: number, row: number, side: Side, depth: number, width = CELL): Box {
    const box = this.cellBox(col, row);
    const middle = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
    const along = side === "n" || side === "s";
    const across = along
      ? { minX: middle.x - width / 2, maxX: middle.x + width / 2 }
      : { minZ: middle.z - width / 2, maxZ: middle.z + width / 2 };
    switch (side) {
      case "n":
        return { ...box, ...across, minZ: box.maxZ - depth };
      case "s":
        return { ...box, ...across, maxZ: box.minZ + depth };
      case "e":
        return { ...box, ...across, minX: box.maxX - depth };
      case "w":
        return { ...box, ...across, maxX: box.minX + depth };
    }
  }
}

/** One way between two points that isn't across a floor: stairs, a ladder, a plank. */
interface Link {
  a: Point;
  b: Point;
  ladder: boolean;
  plank: boolean;
}

/** Every flight of stairs, ladder and run of planks, from the floor at one end to the other. */
function linksOf(building: Building): Link[] {
  const links: Link[] = [];
  for (const storey of building.storeys()) {
    for (let row = 0; row < building.rows; row++) {
      for (let col = 0; col < building.cols; col++) {
        const tile = building.tile(storey, col, row);
        if (tile?.kind === "stairs" || tile?.kind === "ladder") {
          const [dx, dz] = OFFSET[tile.up];
          const b = building.inFront(storey + 1, col + dx, row + dz, OPPOSITE[tile.up], APPROACH);
          const a =
            tile.kind === "stairs"
              ? building.inFront(storey, col - dx, row - dz, tile.up, APPROACH)
              : building.inFront(storey, col, row, tile.up, 0.6);
          links.push({ a, b, ladder: tile.kind === "ladder", plank: false });
        }
        if (tile?.kind === "bridge") {
          // From the start of each run of planks to its end.
          const [back, ahead]: Side[] = tile.along === "z" ? ["s", "n"] : ["w", "e"];
          const [bx, bz] = OFFSET[back];
          if (building.tile(storey, col + bx, row + bz)?.kind === "bridge") continue;
          const [ax, az] = OFFSET[ahead];
          let end = { col, row };
          while (building.tile(storey, end.col + ax, end.row + az)?.kind === "bridge") {
            end = { col: end.col + ax, row: end.row + az };
          }
          links.push({
            a: building.inFront(storey, col + bx, row + bz, ahead, APPROACH),
            b: building.inFront(storey, end.col + ax, end.row + az, back, APPROACH),
            ladder: false,
            plank: true,
          });
        }
      }
    }
  }
  return links;
}

/** What blocks a player standing on a storey: anything between a step up and their head. */
function blocksOn(box: LevelBox, storey: number): boolean {
  const base = storey * STOREY;
  return box.y < base + PLAYER_HEIGHT - 0.001 && box.y + box.height > base + STEP_UP + 0.001;
}

/**
 * Where players can get to, over a fine grid on every storey: which points are clear of everything
 * by a mover's radius and joined to the entrance across floors, up stairs and ladders and over
 * planks, for each way of getting about.
 */
class Reach {
  readonly nx: number;
  readonly nz: number;
  /** Per storey, whether each point is over somewhere to walk. */
  private readonly floor = new Map<number, Uint8Array>();
  /** Per mode and storey, the points the building itself blocks. */
  private readonly fixed = new Map<string, Uint8Array>();
  /** Per mode and storey, each point's patch of clear floor, -1 if blocked; and the patches reached. */
  private readonly labels = new Map<string, Int32Array>();
  private readonly reached = new Map<string, Set<number>>();

  constructor(
    readonly building: Building,
    fixedBoxes: readonly LevelBox[],
    readonly links: readonly Link[],
    readonly start: Point,
  ) {
    this.nx = building.cols * (CELL / STEP) + 1;
    this.nz = building.rows * (CELL / STEP) + 1;
    const per = CELL / STEP;
    for (const storey of building.storeys()) {
      const floor = new Uint8Array(this.nx * this.nz);
      for (let j = 0; j < this.nz; j++) {
        const rows = j % per === 0 ? [j / per - 1, j / per] : [Math.floor(j / per)];
        for (let i = 0; i < this.nx; i++) {
          const cols = i % per === 0 ? [i / per - 1, i / per] : [Math.floor(i / per)];
          let ok = false;
          for (const row of rows) {
            for (const col of cols) ok ||= building.walkable(storey, col, row);
          }
          floor[j * this.nx + i] = ok ? 1 : 0;
        }
      }
      this.floor.set(storey, floor);
      const mine = fixedBoxes.filter((box) => blocksOn(box, storey));
      for (const mode of MODES) {
        if (mode === "carry") continue;
        const blocked = new Uint8Array(this.nx * this.nz);
        for (const box of mine) this.mark(blocked, box, RADIUS[mode]);
        this.fixed.set(`${mode},${storey}`, blocked);
      }
    }
  }

  /** The grid point nearest a place. */
  index(x: number, z: number): number {
    const i = Math.round((x - this.building.x0) / STEP);
    const j = Math.round((z - this.building.z0) / STEP);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** Mark the points a box blocks for a mover of a radius. */
  private mark(blocked: Uint8Array, box: Box, radius: number) {
    const { x0, z0 } = this.building;
    const limit = (radius - 1e-6) ** 2;
    const i0 = Math.max(0, Math.ceil((box.minX - radius - x0) / STEP));
    const i1 = Math.min(this.nx - 1, Math.floor((box.maxX + radius - x0) / STEP));
    const j0 = Math.max(0, Math.ceil((box.minZ - radius - z0) / STEP));
    const j1 = Math.min(this.nz - 1, Math.floor((box.maxZ + radius - z0) / STEP));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + j * STEP;
      const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * STEP;
        const dx = Math.max(box.minX - x, 0, x - box.maxX);
        if (dx * dx + dz * dz < limit) blocked[j * this.nx + i] = 1;
      }
    }
  }

  /** The points clear for a mode on a storey, with these props' boxes in the way too. */
  clear(mode: Mode, storey: number, props: readonly Box[]): Uint8Array {
    const fixed = this.fixed.get(`${mode === "carry" ? "walk" : mode},${storey}`) as Uint8Array;
    const blocked = fixed.slice();
    for (const box of props) this.mark(blocked, box, RADIUS[mode]);
    const floor = this.floor.get(storey) as Uint8Array;
    for (let k = 0; k < blocked.length; k++) blocked[k] = floor[k] && !blocked[k] ? 1 : 0;
    return blocked;
  }

  /** The grid point next to one, the way given (0 to 3), or -1 off the edge of the grid. */
  step(at: number, way: number): number {
    const i = at % this.nx;
    if (way === 0) return i === 0 ? -1 : at - 1;
    if (way === 1) return i === this.nx - 1 ? -1 : at + 1;
    if (way === 2) return at - this.nx;
    const next = at + this.nx;
    return next >= this.nx * this.nz ? -1 : next;
  }

  /**
   * Work out what each mode reaches with these props in the way, by storey. Only the storeys in
   * `changed` are filled again, if it's given: the others are as they were.
   */
  update(props: (storey: number) => readonly Box[], changed?: ReadonlySet<number>) {
    for (const mode of MODES) {
      const reachedPatches = new Set<number>();
      const patchOf = new Map<number, Int32Array>();
      for (const storey of this.building.storeys()) {
        const kept =
          changed && !changed.has(storey) ? this.labels.get(`${mode},${storey}`) : undefined;
        // Carrying is walking without ladders: the same patches.
        const known = mode === "carry" ? this.labels.get(`walk,${storey}`) : kept;
        const label = known ?? this.patches(this.clear(mode, storey, props(storey)));
        this.labels.set(`${mode},${storey}`, label);
        patchOf.set(storey, label);
      }
      // Patches are numbered per storey: a node is the storey and the patch.
      const node = (point: Point) => {
        const label = patchOf.get(point.storey);
        const k = this.index(point.x, point.z);
        if (!label || k < 0 || label[k] < 0) return undefined;
        return (point.storey + 64) * 1e6 + label[k];
      };
      const edges = new Map<number, number[]>();
      for (const link of this.links) {
        if (mode !== "walk" && link.ladder) continue;
        if (mode === "wide" && link.plank) continue;
        const a = node(link.a);
        const b = node(link.b);
        if (a === undefined || b === undefined) continue;
        edges.set(a, [...(edges.get(a) ?? []), b]);
        edges.set(b, [...(edges.get(b) ?? []), a]);
      }
      const first = node(this.start);
      if (first !== undefined) {
        const queue = [first];
        reachedPatches.add(first);
        while (queue.length > 0) {
          const at = queue.pop() as number;
          for (const next of edges.get(at) ?? []) {
            if (reachedPatches.has(next)) continue;
            reachedPatches.add(next);
            queue.push(next);
          }
        }
      }
      this.reached.set(mode, reachedPatches);
    }
  }

  /** Each clear point's patch: the clear points joined to it, numbered; -1 where it isn't clear. */
  private patches(clear: Uint8Array): Int32Array {
    const label = new Int32Array(clear.length).fill(-1);
    const queue = new Int32Array(clear.length);
    const { nx } = this;
    const n = clear.length;
    let patches = 0;
    for (let k = 0; k < clear.length; k++) {
      if (!clear[k] || label[k] >= 0) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = k;
      label[k] = patches;
      while (head < tail) {
        const at = queue[head++];
        const i = at % nx;
        if (i > 0 && clear[at - 1] && label[at - 1] < 0) {
          label[at - 1] = patches;
          queue[tail++] = at - 1;
        }
        if (i < nx - 1 && clear[at + 1] && label[at + 1] < 0) {
          label[at + 1] = patches;
          queue[tail++] = at + 1;
        }
        if (at >= nx && clear[at - nx] && label[at - nx] < 0) {
          label[at - nx] = patches;
          queue[tail++] = at - nx;
        }
        if (at + nx < n && clear[at + nx] && label[at + nx] < 0) {
          label[at + nx] = patches;
          queue[tail++] = at + nx;
        }
      }
      patches++;
    }
    return label;
  }

  /** Whether a point can be got to, as of the last update. */
  reaches(mode: Mode, point: Point): boolean {
    const label = this.labels.get(`${mode},${point.storey}`);
    const k = this.index(point.x, point.z);
    if (!label || k < 0 || label[k] < 0) return false;
    return this.reached.get(mode)?.has((point.storey + 64) * 1e6 + label[k]) ?? false;
  }

  /** Whether a grid point on a storey is reached, as of the last update. */
  reachedAt(mode: Mode, storey: number, k: number): boolean {
    const label = this.labels.get(`${mode},${storey}`);
    if (!label || label[k] < 0) return false;
    return this.reached.get(mode)?.has((storey + 64) * 1e6 + label[k]) ?? false;
  }

  /**
   * The ways from wherever on a storey is reached now, over what only the building blocks: for each
   * grid point, the one before it on the shortest way to it, -1 where a way starts, -2 where none
   * goes. `traceTo` follows one back.
   */
  waysOn(mode: Mode, storey: number): Int32Array {
    const clear = this.clear(mode, storey, []);
    const from = new Int32Array(clear.length).fill(-2);
    const queue = new Int32Array(clear.length);
    let tail = 0;
    for (let k = 0; k < clear.length; k++) {
      if (clear[k] && this.reachedAt(mode, storey, k)) {
        from[k] = -1;
        queue[tail++] = k;
      }
    }
    for (let head = 0; head < tail; head++) {
      const at = queue[head];
      for (let way = 0; way < 4; way++) {
        const next = this.step(at, way);
        if (next < 0 || !clear[next] || from[next] !== -2) continue;
        from[next] = at;
        queue[tail++] = next;
      }
    }
    return from;
  }

  /** The grid points of the way to a point, from `waysOn`, or undefined if none goes there. */
  traceTo(from: Int32Array, point: Point): number[] | undefined {
    const goal = this.index(point.x, point.z);
    if (goal < 0 || from[goal] === -2) return undefined;
    const path: number[] = [];
    for (let k = goal; k >= 0; k = from[k]) path.push(k);
    return path;
  }

  /** Where a grid point is. */
  pointAt(k: number): { x: number; z: number } {
    return {
      x: this.building.x0 + (k % this.nx) * STEP,
      z: this.building.z0 + Math.floor(k / this.nx) * STEP,
    };
  }
}

/** A point that has to stay reachable, in the modes that reached it before anything was placed. */
interface Target extends Point {
  why: string;
  modes: Mode[];
  /** Whether its modes have been cut down to those that reached it before anything was placed. */
  checked?: boolean;
}

/** The points every level keeps reachable: doorways, both ends of every way up, where players start. */
function targetsOf(building: Building, links: readonly Link[], start: Point): Target[] {
  const targets: Target[] = [{ ...start, why: "the entrance", modes: [...MODES] }];
  for (const link of links) {
    const what = link.ladder ? "a ladder" : link.plank ? "a plank" : "stairs";
    targets.push({ ...link.a, why: `the foot of ${what}`, modes: [...MODES] });
    targets.push({ ...link.b, why: `the top of ${what}`, modes: [...MODES] });
  }
  for (const storey of building.storeys()) {
    for (let row = 0; row < building.rows; row++) {
      for (let col = 0; col < building.cols; col++) {
        for (const side of ["n", "e"] as const) {
          const [dx, dz] = OFFSET[side];
          if (!isOpening(building.parsed.edge(storey, col, row, side))) continue;
          if (!building.walkable(storey, col, row)) continue;
          if (!building.walkable(storey, col + dx, row + dz)) continue;
          for (const [c, r, s] of [
            [col, row, side],
            [col + dx, row + dz, OPPOSITE[side]],
          ] as const) {
            targets.push({
              ...building.inFront(storey, c, r, s, APPROACH),
              why: "a doorway",
              modes: [...MODES],
            });
          }
        }
      }
    }
  }
  return targets;
}

/** A wall face along part of one side of a room's cells, to stand things against or hang them on. */
interface WallRun {
  storey: number;
  /** The side of the room the wall is on: what stands against it faces the other way. */
  side: Side;
  /** Where its face is, across: z for a wall on the north or south, x for east or west. */
  face: number;
  /** Where it starts and ends, along. */
  from: number;
  to: number;
  /** How high it goes above the floor. */
  height: number;
}

/** Parts of a room this furnishing gives a look of its own. */
interface Style {
  /** How full it is, about 0.4 to 1.2. */
  density: number;
  /** Turned over: things missing, things dropped, crates knocked askew. */
  ransacked: boolean;
}

/** What `furnish` makes of a generated level. */
export interface Furnished {
  rooms: Room[];
  props: PropSpawn[];
  /** The props' collision boxes, of kind "furniture" or "shelf", to add to the level's. */
  boxes: LevelBox[];
  lights: LightSpawn[];
  items: ItemSpawn[];
  /** How many props were taken away again because they were in the way. */
  dropped: number;
}

interface PlacedProp {
  spawn: PropSpawn;
  storey: number;
  /** What it covers on the ground, and from how high to how high. */
  box: Box;
  bottom: number;
  top: number;
  mount: "floor" | "wall" | "ceiling";
  solid: boolean;
  removed: boolean;
}

/** Light colours, linear RGB, before each room's own tint. */
const COLOURS = {
  cold: [0.82, 0.92, 1] as const,
  coldGreen: [0.8, 1, 0.85] as const,
  warm: [1, 0.85, 0.62] as const,
  bulb: [1, 0.72, 0.42] as const,
  highBay: [0.95, 0.9, 0.8] as const,
  red: [1, 0.08, 0.04] as const,
  amber: [1, 0.42, 0.05] as const,
  exit: [0.1, 1, 0.3] as const,
};

/**
 * Furnish a generated level: its rooms, their props and lights, and its items. `boxes` are the
 * tiles' boxes, `start` where players come in, and `spawns` where they stand to begin with.
 */
export function furnish(
  seed: number,
  generated: Generated,
  grid: TileGrid,
  boxes: readonly LevelBox[],
  start: Point,
  keepClear: readonly Box[],
): Furnished {
  return new Furnisher(seed, generated, grid, boxes, start, keepClear).run();
}

class Furnisher {
  private readonly next: () => number;
  private readonly building: Building;
  private readonly links: Link[];
  private readonly reach: Reach;
  private readonly placed: PlacedProp[] = [];
  private readonly lights: LightSpawn[] = [];
  /** Per storey, what props mustn't stand on, and what the building blocks. */
  private readonly reserved = new Map<number, Box[]>();
  private readonly blockers = new Map<number, LevelBox[]>();
  private readonly targets: Target[];
  private rooms: Room[] = [];
  private roomAt: (storey: number, col: number, row: number) => number;
  private dropped = 0;

  constructor(
    seed: number,
    private readonly generated: Generated,
    grid: TileGrid,
    tileBoxes: readonly LevelBox[],
    private readonly start: Point,
    keepClear: readonly Box[],
  ) {
    this.next = random(seed * 7919 + 17);
    this.building = new Building(grid);
    this.links = linksOf(this.building);
    this.reach = new Reach(this.building, tileBoxes, this.links, start);
    this.targets = targetsOf(this.building, this.links, start);
    this.roomAt = (storey, col, row) => generated.roomAt({ storey, col, row });
    for (const storey of this.building.storeys()) {
      const base = storey * STOREY;
      this.blockers.set(
        storey,
        tileBoxes.filter((box) => box.y < base + STOREY - 0.01 && box.y + box.height > base + 0.01),
      );
      this.reserved.set(storey, storey === start.storey ? [...keepClear] : []);
    }
    this.reserveWaysThrough();
  }

  private rng(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  private chance(p: number): boolean {
    return this.next() < p;
  }
  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }

  run(): Furnished {
    this.makeRooms();
    this.fitDoorways();
    // Cages first, so their fences go up before the halls round them fill.
    for (const room of this.rooms) if (room.kind === "cage") this.fenceCage(room);
    for (const room of this.rooms) this.furnishRoom(room);
    // What each mode reaches in the bare building: only what was reached then is held to.
    this.reach.update(() => []);
    for (const target of this.targets) {
      target.modes = target.modes.filter((mode) => this.reach.reaches(mode, target));
      target.checked = true;
    }
    this.clearTheWay();
    this.lightRooms();
    this.hangThings();
    const items = this.placeLoot();
    const live = this.placed.filter((prop) => !prop.removed);
    return {
      rooms: this.rooms,
      props: live.map((prop) => prop.spawn),
      boxes: live
        .filter((prop) => prop.solid && prop.mount === "floor")
        .map((prop) => ({
          ...prop.box,
          y: prop.bottom,
          height: prop.top - prop.bottom,
          kind: /rack|shelf/.test(prop.spawn.model) ? ("shelf" as const) : ("furniture" as const),
        })),
      lights: this.lights,
      items,
      dropped: this.dropped,
    };
  }

  // ---- Rooms ----

  /** The level's rooms, with how far in each is, 0 at the entrance to 1 at the farthest. */
  private makeRooms() {
    const { building, generated } = this;
    const averages = generated.rooms.map((room) => {
      const near: number[] = [];
      for (const { col, row } of room.cells) {
        const here = generated.distance({ storey: room.storey, col, row });
        if (here !== undefined) near.push(here);
        else {
          // Open air: how far the floors round it are.
          for (const side of SIDES) {
            const [dx, dz] = OFFSET[side];
            const there = generated.distance({ storey: room.storey, col: col + dx, row: row + dz });
            if (there !== undefined) near.push(there);
          }
        }
      }
      return near.length > 0 ? near.reduce((a, b) => a + b, 0) / near.length : 0;
    });
    const farthest = Math.max(1, ...averages);
    this.rooms = generated.rooms.map((room, id) => {
      const boxes = room.cells.map(({ col, row }) => building.cellBox(col, row));
      return {
        id,
        kind: room.kind,
        storey: room.storey,
        y: room.storey * STOREY,
        bounds: {
          minX: Math.min(...boxes.map((b) => b.minX)),
          maxX: Math.max(...boxes.map((b) => b.maxX)),
          minZ: Math.min(...boxes.map((b) => b.minZ)),
          maxZ: Math.max(...boxes.map((b) => b.maxZ)),
        },
        cells: room.cells,
        depth: room.kind === "entrance" ? 0 : averages[id] / farthest,
      };
    });
  }

  /** How far in a point is, 0 at the entrance to 1 at the farthest cell. */
  private depthAt(storey: number, x: number, z: number): number {
    const col = Math.floor((x - this.building.x0) / CELL);
    const row = Math.floor((z - this.building.z0) / CELL);
    const here = this.generated.distance({ storey, col, row });
    return here === undefined ? 1 : Math.min(1, here / this.farthest());
  }
  private farthestCache = 0;
  private farthest(): number {
    if (this.farthestCache > 0) return this.farthestCache;
    let most = 1;
    for (const room of this.generated.rooms) {
      for (const { col, row } of room.cells) {
        most = Math.max(most, this.generated.distance({ storey: room.storey, col, row }) ?? 0);
      }
    }
    this.farthestCache = most;
    return most;
  }

  /** How dark a room is meant to be, 0 to 1: deeper, higher up and below ground are darker. */
  private darkness(room: Room): number {
    if (room.kind === "entrance") return 0;
    const height = room.storey < 0 ? 0.2 : room.storey * 0.08;
    return Math.min(1, room.depth * 0.85 + height);
  }

  // ---- Keeping the way clear ----

  /** Keep doorways, both ends of stairs and ladders, and plank ends clear of props. */
  private reserveWaysThrough() {
    const { building } = this;
    const keep = (storey: number, box: Box) => this.reserved.get(storey)?.push(box);
    for (const storey of building.storeys()) {
      for (let row = 0; row < building.rows; row++) {
        for (let col = 0; col < building.cols; col++) {
          const tile = building.tile(storey, col, row);
          for (const side of SIDES) {
            const opening = openingOf(building.parsed.edge(storey, col, row, side));
            if (opening)
              keep(storey, building.strip(col, row, side, KEEP_CLEAR, opening.width + 1));
          }
          if (tile?.kind === "stairs" || tile?.kind === "ladder") {
            const [dx, dz] = OFFSET[tile.up];
            keep(storey + 1, building.strip(col + dx, row + dz, OPPOSITE[tile.up], KEEP_CLEAR));
            if (tile.kind === "stairs") {
              keep(storey, building.strip(col - dx, row - dz, tile.up, KEEP_CLEAR));
            } else {
              keep(storey, building.cellBox(col, row));
            }
          }
          if (tile?.kind === "bridge") {
            const ends: Side[] = tile.along === "z" ? ["n", "s"] : ["e", "w"];
            for (const side of ends) {
              const [dx, dz] = OFFSET[side];
              if (building.tile(storey, col + dx, row + dz)?.kind === "bridge") continue;
              keep(storey, building.strip(col + dx, row + dz, OPPOSITE[side], KEEP_CLEAR, 2.4));
            }
          }
        }
      }
    }
  }

  /** The solid floor props on a storey, as boxes. */
  private solidsOn(storey: number): Box[] {
    return this.placed
      .filter((p) => !p.removed && p.solid && p.mount === "floor" && p.storey === storey)
      .map((p) => p.box);
  }

  /**
   * Take away props that block a way that was there before: for each point that can't be reached
   * any more, the props across the shortest way to it, until everything is reached again.
   */
  private clearTheWay() {
    let changed: Set<number> | undefined;
    for (let round = 0; round < 400; round++) {
      this.reach.update((storey) => this.solidsOn(storey), changed);
      changed = new Set();
      const lost = this.targets.filter((target) =>
        target.modes.some((mode) => !this.reach.reaches(mode, target)),
      );
      if (lost.length === 0) return;
      let cleared = false;
      const ways = new Map<string, Int32Array>();
      for (const target of lost) {
        const mode = target.modes.find((m) => !this.reach.reaches(m, target)) as Mode;
        const key = `${mode},${target.storey}`;
        let from = ways.get(key);
        if (!from) {
          from = this.reach.waysOn(mode, target.storey);
          ways.set(key, from);
        }
        const path = this.reach.traceTo(from, target);
        if (!path) continue;
        const radius = RADIUS[mode];
        const here = this.placed.filter(
          (p) => !p.removed && p.solid && p.mount === "floor" && p.storey === target.storey,
        );
        for (const k of path) {
          const { x, z } = this.reach.pointAt(k);
          for (const prop of here) {
            if (prop.removed) continue;
            const dx = Math.max(prop.box.minX - x, 0, x - prop.box.maxX);
            const dz = Math.max(prop.box.minZ - z, 0, z - prop.box.maxZ);
            if (dx * dx + dz * dz < (radius - 1e-6) ** 2) {
              prop.removed = true;
              this.dropped++;
              cleared = true;
              changed.add(prop.storey);
            }
          }
        }
      }
      if (!cleared) {
        // Nothing to clear on the way to any of them: give up on the newest solid prop.
        const last = [...this.placed]
          .reverse()
          .find((p) => !p.removed && p.solid && p.mount === "floor");
        if (!last) return;
        last.removed = true;
        this.dropped++;
        changed.add(last.storey);
      }
    }
  }

  // ---- Placing ----

  /** Stand a prop on the floor of a storey, if it fits there; returns whether it did. */
  private stand(
    model: PropName,
    storey: number,
    x: number,
    z: number,
    turn: number,
    room: number,
    options: { reserved?: boolean; fence?: boolean; loose?: boolean } = {},
  ): boolean {
    const kind = PROPS[model];
    const box = footprint(model, x, z, turn);
    const base = storey * STOREY;
    for (const { col, row } of this.building.cellsUnder(box)) {
      if (!this.building.standable(storey, col, row)) return false;
      // Never across into another room, unless it's a cage's fence, between rooms.
      if (!options.fence && room >= 0 && this.roomAt(storey, col, row) !== room) return false;
    }
    if (!options.reserved && this.reserved.get(storey)?.some((r) => overlaps(box, r))) {
      return false;
    }
    if (options.loose && this.onRoute(storey, box)) return false;
    const top = base + kind.size[1];
    // A fence's end posts may go into the wall they meet.
    const blocked = (b: LevelBox) => b.y < top && overlaps(box, b, options.fence ? -0.12 : 0);
    if (this.blockers.get(storey)?.some(blocked)) return false;
    for (const other of this.placed) {
      if (other.removed || other.storey !== storey || !overlaps(box, other.box)) continue;
      if (other.mount === "floor") return false;
      // Under something hanging from the ceiling, only if it's lower.
      if (other.mount === "ceiling" && other.bottom < top + 0.05) return false;
      if (other.mount === "wall" && other.bottom < top + 0.05) return false;
    }
    this.placed.push({
      spawn: { model, x, y: base, z, turn, room },
      storey,
      box,
      bottom: base,
      top,
      mount: "floor",
      solid: kind.solid,
      removed: false,
    });
    return true;
  }

  /**
   * Hang a prop from the ceiling of a storey, if there's a ceiling over all of it at one height and
   * nothing in the way; returns whether it did.
   */
  private hang(
    model: PropName,
    storey: number,
    x: number,
    z: number,
    turn: number,
    room: number,
  ): boolean {
    const box = footprint(model, x, z, turn);
    let ceiling: number | undefined;
    for (const { col, row } of this.building.cellsUnder(box)) {
      const here = this.building.ceiling(storey, col, row);
      if (here === undefined || (ceiling !== undefined && Math.abs(here - ceiling) > 0.01)) {
        return false;
      }
      ceiling = here;
    }
    if (ceiling === undefined) return false;
    const bottom = ceiling - PROPS[model].size[1];
    for (const other of this.placed) {
      if (other.removed || other.storey !== storey || !overlaps(box, other.box, 0.05)) continue;
      if (other.mount === "ceiling") return false;
      if (other.top > bottom - 0.05) return false;
    }
    // Clear of walls, but for the ends of lengths of duct, pipe and tray, which go through them.
    const clear = { ...box };
    if (PROPS[model].size[0] >= CELL) {
      if (Math.abs(Math.sin(turn)) > 0.5) {
        clear.minZ += WALL;
        clear.maxZ -= WALL;
      } else {
        clear.minX += WALL;
        clear.maxX -= WALL;
      }
    }
    const top = ceiling;
    const inTheWay = (b: LevelBox) =>
      b.y < top - 0.01 && b.y + b.height > bottom + 0.01 && overlaps(clear, b);
    if (this.blockers.get(storey)?.some(inTheWay)) return false;
    this.placed.push({
      spawn: { model, x, y: ceiling, z, turn, room },
      storey,
      box,
      bottom,
      top: ceiling,
      mount: "ceiling",
      solid: false,
      removed: false,
    });
    return true;
  }

  /** Hang a prop on a wall face, its bottom this high above the floor; returns whether it did. */
  private mount(
    model: PropName,
    run: WallRun,
    along: number,
    height: number,
    room: number,
  ): boolean {
    const [width, tall, depth] = PROPS[model].size;
    if (along - width / 2 < run.from || along + width / 2 > run.to) return false;
    if (height + tall > run.height) return false;
    const faces = OPPOSITE[run.side];
    const [dx, dz] = OFFSET[faces];
    const alongX = run.side === "n" || run.side === "s";
    const x = alongX ? along : run.face;
    const z = alongX ? run.face : along;
    const box = footprint(model, x + (dx * depth) / 2, z + (dz * depth) / 2, TURN[faces]);
    const base = run.storey * STOREY;
    const bottom = base + height;
    const top = bottom + tall;
    // Nothing standing in front of it that reaches up to it, nor anything else on the wall there.
    const front = footprint(model, x + dx * 0.35, z + dz * 0.35, TURN[faces]);
    for (const other of this.placed) {
      if (other.removed || other.storey !== run.storey) continue;
      if (other.mount === "floor" && overlaps(front, other.box) && other.top > bottom - 0.05) {
        return false;
      }
      if (other.mount !== "floor" && overlaps(box, other.box, 0.05)) {
        if (other.bottom < top + 0.05 && other.top > bottom - 0.05) return false;
      }
    }
    this.placed.push({
      spawn: { model, x, y: bottom, z, turn: TURN[faces], room },
      storey: run.storey,
      box,
      bottom,
      top,
      mount: "wall",
      solid: false,
      removed: false,
    });
    return true;
  }

  /** Add a light, and the fitting it's in, if it has one, already placed. */
  private light(light: Omit<LightSpawn, "color"> & { color: readonly number[] }) {
    this.lights.push({ ...light, color: [light.color[0], light.color[1], light.color[2]] });
  }

  // ---- Walls ----

  /** The wall faces round a room, merged along each wall, with doorways and arches cut out. */
  private wallRuns(room: Room): WallRun[] {
    const { building } = this;
    const pieces: WallRun[] = [];
    const height = room.storey === building.top ? STOREY : STOREY - SLAB;
    for (const { col, row } of room.cells) {
      if (!building.standable(room.storey, col, row)) continue;
      const box = building.cellBox(col, row);
      for (const side of SIDES) {
        const [dx, dz] = OFFSET[side];
        const edge = building.parsed.edge(room.storey, col, row, side);
        const next = building.tile(room.storey, col + dx, row + dz);
        const rock = next?.kind === "solid" || next === undefined;
        if (edge === "none" && !rock) continue;
        const inset = edge === "none" ? 0 : WALL / 2;
        const alongX = side === "n" || side === "s";
        const line = { n: box.maxZ, s: box.minZ, e: box.maxX, w: box.minX }[side];
        const face = line - (dx + dz) * inset;
        const [from, to] = alongX ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
        const opening = openingOf(edge);
        if (opening) {
          const middle = (from + to) / 2;
          pieces.push({
            storey: room.storey,
            side,
            face,
            from,
            to: middle - opening.width / 2,
            height,
          });
          pieces.push({
            storey: room.storey,
            side,
            face,
            from: middle + opening.width / 2,
            to,
            height,
          });
        } else {
          pieces.push({ storey: room.storey, side, face, from, to, height });
        }
      }
    }
    // Join pieces end to end on the same face, then keep clear of the walls at the corners.
    pieces.sort((a, b) =>
      a.side !== b.side
        ? a.side.localeCompare(b.side)
        : a.face !== b.face
          ? a.face - b.face
          : a.from - b.from,
    );
    const runs: WallRun[] = [];
    for (const piece of pieces) {
      const last = runs[runs.length - 1];
      if (
        last &&
        last.side === piece.side &&
        Math.abs(last.face - piece.face) < 0.001 &&
        Math.abs(last.to - piece.from) < 0.001
      ) {
        last.to = piece.to;
      } else {
        runs.push({ ...piece });
      }
    }
    for (const run of runs) {
      run.from += WALL / 2 + 0.02;
      run.to -= WALL / 2 + 0.02;
    }
    return runs.filter((run) => run.to - run.from > 0.4);
  }

  /** Stand props along a wall, backs to it, one after another, each chosen as it comes. */
  private alongWall(
    run: WallRun,
    room: Room,
    choose: () => PropName | undefined,
    options: { gap?: number; from?: number; to?: number; skip?: number } = {},
  ): number {
    const faces = OPPOSITE[run.side];
    const [dx, dz] = OFFSET[faces];
    const alongX = run.side === "n" || run.side === "s";
    let at = Math.max(run.from, options.from ?? run.from);
    const end = Math.min(run.to, options.to ?? run.to);
    let count = 0;
    let model = choose();
    while (model) {
      const [width, , depth] = PROPS[model].size;
      if (at + width > end) break;
      const middle = at + width / 2;
      const out = depth / 2 + 0.02;
      const x = alongX ? middle : run.face + dx * out;
      const z = alongX ? run.face + dz * out : middle;
      if (this.chance(options.skip ?? 0)) {
        at += width + (options.gap ?? 0);
        model = choose();
      } else if (this.stand(model, run.storey, x, z, TURN[faces], room.id)) {
        count++;
        at += width + (options.gap ?? 0);
        model = choose();
      } else {
        at += STEP;
      }
    }
    return count;
  }

  // ---- Doorways and cages ----

  /** A frame in every doorway, and a strip curtain in some between halls and the rooms behind. */
  private fitDoorways() {
    const { building } = this;
    for (const storey of building.storeys()) {
      for (let row = 0; row < building.rows; row++) {
        for (let col = 0; col < building.cols; col++) {
          for (const side of ["n", "e"] as const) {
            if (building.parsed.edge(storey, col, row, side) !== "door") continue;
            const [dx, dz] = OFFSET[side];
            const box = building.cellBox(col, row);
            const x = side === "e" ? box.maxX : (box.minX + box.maxX) / 2;
            const z = side === "n" ? box.maxZ : (box.minZ + box.maxZ) / 2;
            const turn = side === "n" ? 0 : Math.PI / 2;
            const room = this.roomAt(storey, col, row);
            const other = this.roomAt(storey, col + dx, row + dz);
            this.fixture("door-frame", storey, x, z, turn, room);
            const kinds = [this.rooms[room]?.kind, this.rooms[other]?.kind];
            const behind = kinds.some((k) => k === "stock" || k === "corridor" || k === "workshop");
            if (kinds.includes("hall") && behind && this.chance(0.6)) {
              this.fixture("strip-curtain", storey, x, z, turn, room);
            }
          }
        }
      }
    }
  }

  /** A prop in a doorway: placed where it must be, with nothing checked but that it's free. */
  private fixture(
    model: PropName,
    storey: number,
    x: number,
    z: number,
    turn: number,
    room: number,
  ) {
    const box = footprint(model, x, z, turn);
    const base = storey * STOREY;
    this.placed.push({
      spawn: { model, x, y: base, z, turn, room },
      storey,
      box,
      bottom: base,
      top: base + PROPS[model].size[1],
      mount: "floor",
      solid: PROPS[model].solid,
      removed: false,
    });
  }

  /**
   * Fence a cage in from its hall with chain-link panels, end to end along every edge between them,
   * leaving one panel out for a gap to get in by, kept clear on both sides.
   */
  private fenceCage(room: Room) {
    const { building } = this;
    const edges: { col: number; row: number; side: Side }[] = [];
    for (const { col, row } of room.cells) {
      for (const side of SIDES) {
        const [dx, dz] = OFFSET[side];
        const other = this.roomAt(room.storey, col + dx, row + dz);
        if (other < 0 || this.rooms[other]?.kind !== "hall") continue;
        if (building.parsed.edge(room.storey, col, row, side) !== "none") continue;
        edges.push({ col, row, side });
      }
    }
    if (edges.length === 0) return;
    // The gap: on an edge both sides of which can be stood on, if there is one.
    const open = edges.filter(({ col, row, side }) => {
      const [dx, dz] = OFFSET[side];
      return (
        building.standable(room.storey, col, row) &&
        building.standable(room.storey, col + dx, row + dz)
      );
    });
    const gapEdge = open.length > 0 ? this.pick(open) : undefined;
    const gapHalf = this.chance(0.5) ? 0 : 1;
    const [panelWidth] = PROPS["cage-panel"].size;
    for (const edge of edges) {
      const box = building.cellBox(edge.col, edge.row);
      const alongX = edge.side === "n" || edge.side === "s";
      const line = { n: box.maxZ, s: box.minZ, e: box.maxX, w: box.minX }[edge.side];
      const start = alongX ? box.minX : box.minZ;
      for (let half = 0; half < 2; half++) {
        const middle = start + panelWidth / 2 + half * panelWidth;
        const x = alongX ? middle : line;
        const z = alongX ? line : middle;
        if (edge === gapEdge && half === gapHalf) {
          const [dx, dz] = OFFSET[edge.side];
          const keep = { minX: x - 0.95, maxX: x + 0.95, minZ: z - 0.95, maxZ: z + 0.95 };
          if (alongX) {
            keep.minZ = z - KEEP_CLEAR;
            keep.maxZ = z + KEEP_CLEAR;
          } else {
            keep.minX = x - KEEP_CLEAR;
            keep.maxX = x + KEEP_CLEAR;
          }
          this.reserved.get(room.storey)?.push(keep);
          for (const sign of [1, -1]) {
            this.targets.push({
              storey: room.storey,
              x: x + sign * dx * APPROACH,
              z: z + sign * dz * APPROACH,
              why: "the way into a cage",
              modes: ["walk", "carry", "wide"],
            });
          }
          continue;
        }
        this.stand("cage-panel", room.storey, x, z, alongX ? 0 : Math.PI / 2, room.id, {
          fence: true,
        });
      }
    }
  }

  // ---- Rooms, by kind ----

  private furnishRoom(room: Room) {
    const style: Style = {
      density: this.rng(0.45, 1.15),
      ransacked: room.kind !== "entrance" && this.chance(0.08 + room.depth * 0.25),
    };
    switch (room.kind) {
      case "entrance":
        return this.furnishBay(room);
      case "hall":
        return this.furnishHall(room, style);
      case "cage":
        return this.furnishStore(room, style, true);
      case "stock":
        return this.furnishStore(room, style, false);
      case "workshop":
        return this.furnishWorkshop(room, style);
      case "office":
        return this.furnishOffice(room, style);
      case "staff":
        return this.furnishStaff(room, style);
      case "plant":
        return this.furnishPlant(room, style);
      case "corridor":
        return this.furnishCorridor(room, style);
      case "atrium":
        return;
    }
  }

  /** The bounds of a room's cells that can be stood on. */
  private standingBounds(room: Room): Box | undefined {
    const boxes = room.cells
      .filter(({ col, row }) => this.building.standable(room.storey, col, row))
      .map(({ col, row }) => this.building.cellBox(col, row));
    if (boxes.length === 0) return undefined;
    return {
      minX: Math.min(...boxes.map((b) => b.minX)),
      maxX: Math.max(...boxes.map((b) => b.maxX)),
      minZ: Math.min(...boxes.map((b) => b.minZ)),
      maxZ: Math.max(...boxes.map((b) => b.maxZ)),
    };
  }

  /**
   * Rows of something across a rectangle, along x or z, with aisles between them: each row is
   * bays end to end, broken by a cross aisle now and then, each bay one or more props side by side
   * across the row. Returns where the aisles run, across, for lights and signs to go over.
   */
  private rows(
    room: Room,
    area: Box,
    along: "x" | "z",
    bay: () => { length: number; parts: { model: PropName; offset: number; faces: Side }[] },
    depth: number,
    aisle: number,
    options: { crossEvery?: number; skip?: number } = {},
  ): number[] {
    const [a0, a1] = along === "z" ? [area.minX, area.maxX] : [area.minZ, area.maxZ];
    const [l0, l1] = along === "z" ? [area.minZ, area.maxZ] : [area.minX, area.maxX];
    const span = a1 - a0;
    const count = Math.floor((span + aisle) / (depth + aisle));
    if (count <= 0) return [];
    const spare = span - (count * depth + (count - 1) * aisle);
    const aisles: number[] = [];
    for (let i = 0; i < count; i++) {
      const across = a0 + spare / 2 + depth / 2 + i * (depth + aisle);
      if (i > 0) aisles.push(across - depth / 2 - aisle / 2);
      let at = l0;
      let inRow = 0;
      const crossEvery = options.crossEvery ?? 0;
      while (at < l1) {
        const { length, parts } = bay();
        if (at + length > l1) break;
        if (crossEvery > 0 && inRow >= crossEvery) {
          at += 2.4;
          inRow = 0;
          continue;
        }
        const middle = at + length / 2;
        let any = false;
        if (!this.chance(options.skip ?? 0)) {
          for (const part of parts) {
            const x = along === "z" ? across + part.offset : middle;
            const z = along === "z" ? middle : across + part.offset;
            any = this.stand(part.model, room.storey, x, z, TURN[part.faces], room.id) || any;
          }
        }
        at += any ? length : STEP * 2;
        if (any) inRow++;
      }
    }
    // The aisles, and the space along each side outside the rows too.
    return aisles;
  }

  /** Points down the middle of an aisle that a sofa must still get along. */
  private aisleTargets(room: Room, area: Box, along: "x" | "z", aisles: number[]) {
    const [l0, l1] = along === "z" ? [area.minZ, area.maxZ] : [area.minX, area.maxX];
    for (const across of aisles) {
      for (let at = l0 + 0.5; at <= l1 - 0.5; at += 0.5) {
        const x = along === "z" ? across : at;
        const z = along === "z" ? at : across;
        const col = Math.floor((x - this.building.x0) / CELL);
        const row = Math.floor((z - this.building.z0) / CELL);
        if (this.roomAt(room.storey, col, row) !== room.id) continue;
        this.targets.push({ storey: room.storey, x, z, why: "an aisle", modes: ["wide"] });
        const k = this.reach.index(x, z);
        if (k >= 0) {
          if (!this.routes.has(room.storey)) this.routes.set(room.storey, new Set());
          this.routes.get(room.storey)?.add(k);
        }
      }
    }
  }

  /** Per storey, the grid points on the ways kept through rooms, which loose props keep off. */
  private readonly routes = new Map<number, Set<number>>();
  private readonly routed = new Set<number>();

  /** Whether a box comes within half the clear width of a way kept through a room. */
  private onRoute(storey: number, box: Box): boolean {
    const route = this.routes.get(storey);
    if (!route || route.size === 0) return false;
    const { x0, z0 } = this.building;
    const limit = (WIDE - 1e-6) ** 2;
    for (
      let j = Math.ceil((box.minZ - WIDE - z0) / STEP);
      j <= (box.maxZ + WIDE - z0) / STEP;
      j++
    ) {
      const z = z0 + j * STEP;
      const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
      for (
        let i = Math.ceil((box.minX - WIDE - x0) / STEP);
        i <= (box.maxX + WIDE - x0) / STEP;
        i++
      ) {
        const x = x0 + i * STEP;
        const dx = Math.max(box.minX - x, 0, x - box.maxX);
        if (dx * dx + dz * dz < limit && route.has(j * this.reach.nx + i)) return true;
      }
    }
    return false;
  }

  /**
   * Keep ways through a room as it stands now, from one of its doorways and ways up to each of the
   * others, 1.4 m wide, for loose props to keep off: so they never cut a room in two.
   */
  private keepRoutes(room: Room) {
    if (this.routed.has(room.id)) return;
    this.routed.add(room.id);
    const { building, reach } = this;
    const inRoom = (p: Point) =>
      p.storey === room.storey &&
      this.roomAt(
        p.storey,
        Math.floor((p.x - building.x0) / CELL),
        Math.floor((p.z - building.z0) / CELL),
      ) === room.id;
    const points = this.targets.filter((t) => t.why !== "an aisle" && inRoom(t));
    if (points.length < 2) return;
    const props = this.placed
      .filter((p) => !p.removed && p.solid && p.mount === "floor" && p.storey === room.storey)
      .map((p) => p.box);
    const clear = reach.clear("wide", room.storey, props);
    const { nx } = reach;
    const from = new Int32Array(clear.length).fill(-2);
    const first = reach.index(points[0].x, points[0].z);
    if (first < 0 || !clear[first]) return;
    // Within the room's bounds and a little round them.
    const i0 = Math.floor((room.bounds.minX - 1 - building.x0) / STEP);
    const i1 = Math.ceil((room.bounds.maxX + 1 - building.x0) / STEP);
    const j0 = Math.floor((room.bounds.minZ - 1 - building.z0) / STEP);
    const j1 = Math.ceil((room.bounds.maxZ + 1 - building.z0) / STEP);
    const queue = [first];
    from[first] = -1;
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      for (let way = 0; way < 4; way++) {
        const next = reach.step(at, way);
        if (next < 0 || !clear[next] || from[next] !== -2) continue;
        const i = next % nx;
        const j = Math.floor(next / nx);
        if (i < i0 || i > i1 || j < j0 || j > j1) continue;
        from[next] = at;
        queue.push(next);
      }
    }
    let route = this.routes.get(room.storey);
    if (!route) {
      route = new Set();
      this.routes.set(room.storey, route);
    }
    for (const point of points.slice(1)) {
      const goal = reach.index(point.x, point.z);
      if (goal < 0 || from[goal] === -2) continue;
      for (let k = goal; k >= 0; k = from[k]) route.add(k);
    }
  }

  /** Bits and pieces dropped about in the open: to the sides of the way, never across it. */
  private scatter(room: Room, models: readonly PropName[], count: number, jitter: number) {
    const bounds = this.standingBounds(room);
    if (!bounds) return;
    this.keepRoutes(room);
    for (let i = 0, tries = 0; i < count && tries < count * 12; tries++) {
      const model = this.pick(models);
      const x = this.rng(bounds.minX + 0.5, bounds.maxX - 0.5);
      const z = this.rng(bounds.minZ + 0.5, bounds.maxZ - 0.5);
      const turn = this.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + this.rng(-jitter, jitter);
      if (this.stand(model, room.storey, x, z, turn, room.id, { loose: true })) i++;
    }
  }

  private furnishBay(room: Room) {
    // Kept mostly clear for coming and going: things along the walls, and a forklift parked.
    for (const run of this.wallRuns(room)) {
      this.alongWall(
        run,
        room,
        () =>
          this.pick<PropName | undefined>([
            "pallet-stack-a",
            "pallet-stack-b",
            "crate-large",
            "pallet",
            "drum-group",
            undefined,
          ]),
        { gap: 0.6, skip: 0.35 },
      );
    }
    this.scatter(room, ["traffic-cone", "hand-truck", "weigh-scale", "forklift"], 3, 0.15);
  }

  private furnishHall(room: Room, style: Style) {
    const bounds = this.standingBounds(room);
    if (!bounds) return;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const along: "x" | "z" = depth >= width * 0.8 ? (this.chance(0.75) ? "z" : "x") : "x";
    const look = this.pick(["racking", "containers", "mixed", "bulk"] as const);
    const runs = this.wallRuns(room);
    // Against the walls: containers end to end, or racking.
    for (const run of runs) {
      if ((look === "containers" || look === "mixed") && this.chance(0.7)) {
        this.alongWallLengthways(run, room, ["container-a", "container-b", "container-c"]);
      } else if (this.chance(0.8 * style.density + 0.2)) {
        this.alongWall(run, room, () => this.pick(["pallet-rack-a", "pallet-rack-b"] as const), {
          skip: style.ransacked ? 0.3 : 0.05,
        });
      }
    }
    // In the middle: rows, with an aisle round them.
    const margin = 1.2 + 2.2;
    const area = {
      minX: bounds.minX + margin,
      maxX: bounds.maxX - margin,
      minZ: bounds.minZ + margin,
      maxZ: bounds.maxZ - margin,
    };
    const aisle = this.rng(2.2, 3) + (1 - style.density) * 0.8;
    const across: Side = along === "z" ? "e" : "n";
    const lengthways: Side = along === "z" ? "n" : "e";
    let aisles: number[] = [];
    const skip = style.ransacked ? 0.25 : 0.03;
    if (look === "racking" || (look === "mixed" && this.chance(0.5))) {
      aisles = this.rows(
        room,
        area,
        along,
        () => ({
          length: 2.7,
          parts: [
            {
              model: this.pick(["pallet-rack-a", "pallet-rack-b"] as const),
              offset: -0.55,
              faces: OPPOSITE[across],
            },
            {
              model: this.pick(["pallet-rack-a", "pallet-rack-b"] as const),
              offset: 0.55,
              faces: across,
            },
          ],
        }),
        2.2,
        aisle,
        { crossEvery: 3 + Math.floor(this.next() * 3), skip },
      );
    } else if (look === "containers" || look === "mixed") {
      aisles = this.rows(
        room,
        area,
        along,
        () => ({
          length: 6.06 + 0.3,
          parts: [
            {
              model: this.pick(["container-a", "container-b", "container-c"] as const),
              offset: 0,
              faces: this.chance(0.5) ? lengthways : OPPOSITE[lengthways],
            },
          ],
        }),
        2.44,
        aisle,
        { crossEvery: 1 + Math.floor(this.next() * 2), skip },
      );
    } else {
      // Bulk: blocks of crates, drums, bags and reels.
      const goods: PropName[] = [
        "crate-large",
        "crate-stack",
        "drum-group",
        "big-bag",
        "pallet-stack-a",
        "pallet-stack-b",
        "wood-crate",
        "crate-long",
        "cable-reel",
        "wrapped-machine",
        "ibc-tank",
      ];
      aisles = this.rows(
        room,
        area,
        along,
        () => {
          const model = this.pick(goods);
          const [w, , d] = PROPS[model].size;
          // Turned so its longer side runs along the row, two deep.
          const long = w >= d;
          const length = Math.max(w, d) + 0.25;
          const facing = long ? across : lengthways;
          const half = Math.min(w, d) / 2 + 0.05;
          return {
            length,
            parts: [
              { model, offset: -half, faces: OPPOSITE[facing] },
              { model, offset: half, faces: facing },
            ],
          };
        },
        2.6,
        aisle,
        { crossEvery: 3, skip: style.ransacked ? 0.35 : 0.12 },
      );
    }
    this.aisleTargets(room, area, along, aisles);
    this.hallAisles.set(room.id, { along, aisles, area });
    // A forklift, a scale, odds and ends.
    const extras: PropName[] = [
      "forklift",
      "pallet",
      "hand-truck",
      "tyre-stack",
      "rope-coil",
      "gas-cage",
      "weigh-scale",
      "cardboard",
      "barrel",
      "plastic-barrel",
      "traffic-cone",
    ];
    this.scatter(
      room,
      extras,
      Math.round(4 * style.density + (style.ransacked ? 6 : 0)),
      style.ransacked ? 0.5 : 0.1,
    );
  }

  /** Where each hall's aisles are, for the lamps and bay signs over them. */
  private readonly hallAisles = new Map<
    number,
    { along: "x" | "z"; aisles: number[]; area: Box }
  >();

  /** Stand props lengthways along a wall, their sides to it: containers in a row. */
  private alongWallLengthways(run: WallRun, room: Room, models: readonly PropName[]) {
    const faces = OPPOSITE[run.side];
    const [dx, dz] = OFFSET[faces];
    const alongX = run.side === "n" || run.side === "s";
    let at = run.from;
    while (at < run.to) {
      const model = this.pick(models);
      const [width, , depth] = PROPS[model].size;
      if (at + depth > run.to) break;
      const middle = at + depth / 2;
      const out = width / 2 + 0.05;
      const x = alongX ? middle : run.face + dx * out;
      const z = alongX ? run.face + dz * out : middle;
      // Its doors to one end or the other, along the wall.
      const end: Side = alongX ? (this.chance(0.5) ? "e" : "w") : this.chance(0.5) ? "n" : "s";
      if (this.stand(model, run.storey, x, z, TURN[end], room.id)) at += depth + this.rng(0.2, 1.5);
      else at += STEP * 2;
    }
  }

  /** A storeroom, or a cage: shelving and racking round the walls, goods in the middle. */
  private furnishStore(room: Room, style: Style, cage: boolean) {
    const shelving: PropName[] = cage
      ? ["wall-shelf-a", "wall-shelf-b", "pallet-rack-a", "pallet-rack-b"]
      : ["wall-shelf-a", "wall-shelf-b", "pallet-rack-a", "pallet-rack-b", "wall-shelf-a"];
    for (const run of this.wallRuns(room)) {
      const kind = this.pick(shelving);
      const racks = kind.startsWith("pallet-rack");
      this.alongWall(
        run,
        room,
        () =>
          racks
            ? this.pick(["pallet-rack-a", "pallet-rack-b"] as const)
            : this.pick(["wall-shelf-a", "wall-shelf-b"] as const),
        { skip: style.ransacked ? 0.3 : 0.1 * (1.2 - style.density) },
      );
    }
    const goods: PropName[] = cage
      ? [
          "crate-large",
          "crate-long",
          "wrapped-machine",
          "crate-stack",
          "wood-box",
          "pallet-stack-a",
        ]
      : [
          "crate-large",
          "drum-group",
          "big-bag",
          "cable-reel",
          "pallet-stack-a",
          "pallet-stack-b",
          "cardboard",
          "wood-box",
          "barrel",
          "plastic-barrel",
          "step-lift",
          "hand-truck",
        ];
    const cells = room.cells.length;
    this.scatter(
      room,
      goods,
      Math.round(cells * 1.6 * style.density + (style.ransacked ? cells : 0)),
      style.ransacked ? 0.6 : 0.08,
    );
  }

  private furnishWorkshop(room: Room, style: Style) {
    for (const run of this.wallRuns(room)) {
      this.alongWall(
        run,
        room,
        () =>
          this.pick<PropName | undefined>([
            "workbench",
            "workbench",
            "tool-cabinet",
            "wall-shelf-a",
            "wall-shelf-b",
            "gas-cylinder",
            undefined,
          ]),
        { gap: 0.2, skip: 0.15 },
      );
    }
    this.scatter(
      room,
      [
        "wrapped-machine",
        "tyre-stack",
        "gas-cage",
        "drum-group",
        "tool-cabinet",
        "plastic-canister",
        "step-lift",
        "cable-reel",
      ],
      Math.round(room.cells.length * 1.2 * style.density),
      style.ransacked ? 0.5 : 0.1,
    );
  }

  private furnishOffice(room: Room, style: Style) {
    for (const run of this.wallRuns(room)) {
      // Desks against the walls with a chair in front, filing cabinets between.
      const faces = OPPOSITE[run.side];
      const [dx, dz] = OFFSET[faces];
      const alongX = run.side === "n" || run.side === "s";
      let at = run.from;
      while (at < run.to - 0.5) {
        const model: PropName = this.chance(0.55) ? "desk" : "filing-cabinet";
        const [width, , depth] = PROPS[model].size;
        if (at + width > run.to) break;
        const middle = at + width / 2;
        const out = depth / 2 + 0.02;
        const x = alongX ? middle : run.face + dx * out;
        const z = alongX ? run.face + dz * out : middle;
        if (this.chance(0.25 * (1.2 - style.density))) {
          at += width;
        } else if (this.stand(model, run.storey, x, z, TURN[faces], room.id)) {
          if (model === "desk") {
            const out2 = depth + 0.35;
            const cx = alongX ? middle : run.face + dx * out2;
            const cz = alongX ? run.face + dz * out2 : middle;
            const jitter = style.ransacked ? this.rng(-1.2, 1.2) : this.rng(-0.3, 0.3);
            this.stand("office-chair", run.storey, cx, cz, TURN[run.side] + jitter, room.id);
          }
          at += width + 0.1;
        } else {
          at += STEP;
        }
      }
    }
    this.scatter(
      room,
      ["trash-bin", "water-cooler", "cardboard", "filing-cabinet"],
      Math.round(room.cells.length * style.density),
      style.ransacked ? 0.6 : 0,
    );
  }

  private furnishStaff(room: Room, style: Style) {
    const runs = this.wallRuns(room);
    for (const [i, run] of runs.entries()) {
      const what =
        i === 0
          ? "locker-row"
          : this.pick(["locker-row", "vending-machine", "water-cooler", undefined] as const);
      if (!what) continue;
      this.alongWall(run, room, () => (this.chance(0.75) ? what : undefined), { gap: 0.1 });
    }
    // A table or two in the open, with chairs round it.
    this.keepRoutes(room);
    const cells = room.cells.filter(({ col, row }) =>
      this.building.standable(room.storey, col, row),
    );
    for (const { col, row } of cells) {
      if (!this.chance(0.6 * style.density + 0.2)) continue;
      const box = this.building.cellBox(col, row);
      const x = (box.minX + box.maxX) / 2 + this.rng(-0.4, 0.4);
      const z = (box.minZ + box.maxZ) / 2 + this.rng(-0.4, 0.4);
      const turn = this.chance(0.5) ? 0 : Math.PI / 2;
      if (!this.stand("staff-table", room.storey, x, z, turn, room.id, { loose: true })) continue;
      for (const sign of [1, -1]) {
        const [ox, oz] = turn === 0 ? [0, sign * 0.75] : [sign * 0.75, 0];
        const jitter = style.ransacked ? this.rng(-1.5, 1.5) : this.rng(-0.25, 0.25);
        this.stand(
          "office-chair",
          room.storey,
          x + ox,
          z + oz,
          (sign > 0 ? Math.PI : 0) + turn + jitter,
          room.id,
        );
      }
    }
    this.scatter(room, ["trash-bin"], 1, 0);
  }

  private furnishPlant(room: Room, style: Style) {
    for (const run of this.wallRuns(room)) {
      this.alongWall(
        run,
        room,
        () =>
          this.pick<PropName | undefined>([
            "switchgear",
            "electrical-cabinet",
            "electrical-cabinet",
            "boiler",
            "gas-cylinder",
            undefined,
          ]),
        { gap: 0.15, skip: 0.1 },
      );
    }
    this.scatter(
      room,
      ["boiler", "barrel", "plastic-barrel", "ibc-tank", "gas-cage", "drum-group"],
      Math.round(room.cells.length * 0.8 * style.density),
      0.1,
    );
  }

  private furnishCorridor(room: Room, style: Style) {
    // Mostly clear: now and then something left against a wall.
    for (const run of this.wallRuns(room)) {
      this.alongWall(
        run,
        room,
        () =>
          this.pick<PropName | undefined>([
            "trash-bin",
            "hand-truck",
            "cardboard",
            "plastic-canister",
            undefined,
            undefined,
            undefined,
          ]),
        { gap: 2, skip: 0.6 * (1.3 - style.density) },
      );
    }
  }

  // ---- Lights ----

  /** How a fitting in a room this dark, this far in, is doing. */
  private lightState(dark: boolean, depth: number): LightSpawn["state"] {
    if (dark) return "dead";
    if (this.chance(Math.max(0, (depth - 0.15) * 0.7))) return "dead";
    if (this.chance(0.03 + depth * 0.2)) return "flicker";
    return "on";
  }

  /** A room's tint: each room's white differs a little from the next. */
  private tint(colour: readonly number[]): number[] {
    const warmth = this.rng(-0.05, 0.05);
    return [colour[0] + warmth, colour[1], colour[2] - warmth].map((c) =>
      Math.min(1, Math.max(0, c * this.rng(0.95, 1))),
    );
  }

  private lightRooms() {
    for (const room of this.rooms) {
      if (room.kind === "atrium") continue;
      const darkness = this.darkness(room);
      // Some deep rooms are dark altogether.
      const dark =
        room.kind !== "entrance" && darkness > 0.55 && this.chance((darkness - 0.45) * 0.9);
      const state = (x: number, z: number) =>
        room.kind === "entrance"
          ? "on"
          : this.lightState(dark, Math.max(darkness, this.depthAt(room.storey, x, z) * 0.9));
      const tube = (
        x: number,
        z: number,
        along: "x" | "z",
        colour: readonly number[],
        power = 1,
      ) => {
        const turn = along === "x" ? 0 : Math.PI / 2;
        if (!this.hang("ceiling-tube", room.storey, x, z, turn, room.id)) return false;
        const ceiling = this.placed[this.placed.length - 1].top;
        this.light({
          kind: "tube",
          x,
          y: ceiling - 0.06,
          z,
          turn,
          color: colour,
          power,
          state: state(x, z),
          room: room.id,
        });
        return true;
      };
      const bounds = this.standingBounds(room);
      if (!bounds) continue;
      switch (room.kind) {
        case "hall": {
          // High-bay lamps over the aisles, a cell apart.
          const colour = this.tint(COLOURS.highBay);
          const layout = this.hallAisles.get(room.id);
          const lines =
            layout && layout.aisles.length > 0
              ? layout.aisles.map((across) => ({ along: layout.along, across }))
              : this.gridLines(bounds, 4, "z");
          for (const line of lines) {
            const [l0, l1] =
              line.along === "z" ? [bounds.minZ, bounds.maxZ] : [bounds.minX, bounds.maxX];
            for (let at = l0 + 2; at < l1; at += CELL) {
              const x = line.along === "z" ? line.across : at;
              const z = line.along === "z" ? at : line.across;
              if (!this.hang("high-bay", room.storey, x, z, 0, room.id)) continue;
              const ceiling = this.placed[this.placed.length - 1].top;
              this.light({
                kind: "bulb",
                x,
                y: ceiling - 0.4,
                z,
                turn: 0,
                color: colour,
                power: 1.6,
                state: state(x, z),
                room: room.id,
              });
            }
          }
          break;
        }
        case "entrance": {
          // The loading bay is lit all over.
          const colour = this.tint(COLOURS.cold);
          for (const line of this.gridLines(bounds, 2.5, "x")) {
            for (let at = bounds.minX + 1.5; at < bounds.maxX - 1; at += 2.5) {
              tube(at, line.across, "x", colour, 1.2);
            }
          }
          break;
        }
        case "stock":
        case "cage":
        case "workshop":
        case "office":
        case "corridor": {
          const colour = this.tint(
            room.kind === "office"
              ? COLOURS.warm
              : room.kind === "corridor"
                ? COLOURS.cold
                : COLOURS.coldGreen,
          );
          for (const { col, row } of room.cells) {
            if (!this.building.standable(room.storey, col, row)) continue;
            if (room.kind === "corridor" && (col + row) % 2 === 1 && this.chance(0.6)) continue;
            const box = this.building.cellBox(col, row);
            const along = this.longAxis(room);
            const x = (box.minX + box.maxX) / 2;
            const z = (box.minZ + box.maxZ) / 2;
            if (!tube(x, z, along, colour)) {
              // Something in the way in the middle: a little to one side.
              const [ox, oz] = along === "z" ? [1, 0] : [0, 1];
              tube(x + ox, z + oz, along, colour);
            }
          }
          break;
        }
        case "staff":
        case "plant": {
          const colour = this.tint(COLOURS.bulb);
          const cells = room.cells.filter(
            ({ col, row }) => this.building.ceiling(room.storey, col, row) !== undefined,
          );
          const count = Math.max(1, Math.round(cells.length / 3));
          for (let i = 0; i < count && cells.length > 0; i++) {
            const { col, row } = cells.splice(Math.floor(this.next() * cells.length), 1)[0];
            const box = this.building.cellBox(col, row);
            const ceiling = this.building.ceiling(room.storey, col, row) as number;
            const x = (box.minX + box.maxX) / 2;
            const z = (box.minZ + box.maxZ) / 2;
            this.light({
              kind: "bulb",
              x,
              y: ceiling - 0.3,
              z,
              turn: 0,
              color: colour,
              power: 0.6,
              state: state(x, z),
              room: room.id,
            });
          }
          break;
        }
      }
    }
  }

  /** Lines a set distance apart across a box, running along an axis. */
  private gridLines(bounds: Box, spacing: number, along: "x" | "z") {
    const [a0, a1] = along === "z" ? [bounds.minX, bounds.maxX] : [bounds.minZ, bounds.maxZ];
    const lines: { along: "x" | "z"; across: number }[] = [];
    const count = Math.max(1, Math.floor((a1 - a0) / spacing));
    const spare = a1 - a0 - (count - 1) * spacing;
    for (let i = 0; i < count; i++) lines.push({ along, across: a0 + spare / 2 + i * spacing });
    return lines;
  }

  /** Which way a room is longest. */
  private longAxis(room: Room): "x" | "z" {
    const { bounds } = room;
    return bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ ? "x" : "z";
  }

  // ---- Fittings on walls and ceilings ----

  private hangThings() {
    for (const room of this.rooms) {
      if (room.kind === "atrium") continue;
      const runs = this.wallRuns(room);
      const exit = this.exitOf(room);
      // An exit sign over the way out, and an extinguisher beside it.
      if (exit) {
        const placed = this.mount("exit-sign", exit.run, exit.along, exit.height, room.id);
        if (placed) {
          const sign = this.placed[this.placed.length - 1];
          const [dx, dz] = OFFSET[OPPOSITE[exit.run.side]];
          this.light({
            kind: "exit",
            x: sign.spawn.x + dx * 0.08,
            y: sign.spawn.y + 0.1,
            z: sign.spawn.z + dz * 0.08,
            turn: sign.spawn.turn,
            color: COLOURS.exit,
            power: 0.15,
            state: "on",
            room: room.id,
          });
        }
      }
      // Extinguishers: one in a small room, more in a big one.
      const extinguishers = Math.max(1, Math.round(room.cells.length / 10));
      for (let i = 0; i < extinguishers && runs.length > 0; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const run = this.pick(runs);
          if (
            this.mount(
              "fire-extinguisher",
              run,
              this.rng(run.from + 0.3, run.to - 0.3),
              0.8,
              room.id,
            )
          )
            break;
        }
      }
      // Emergency lights: in plant rooms and anywhere below ground, red or amber.
      const emergency =
        room.kind === "plant" || room.storey < 0
          ? Math.max(1, Math.round(room.cells.length / 4))
          : 0;
      const colour = this.chance(0.5) ? COLOURS.red : COLOURS.amber;
      for (let i = 0; i < emergency && runs.length > 0; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const run = this.pick(runs);
          if (this.emergencyLight(run, this.rng(run.from + 0.3, run.to - 0.3), room, colour)) break;
        }
      }
      // Wall vents, high up.
      if (runs.length > 0 && this.chance(0.5)) {
        const run = this.pick(runs);
        this.mount("wall-vent", run, this.rng(run.from + 0.4, run.to - 0.4), 2.0, room.id);
      }
      this.ceilingRuns(room);
      // Cameras in the corners of the bigger rooms.
      if (
        room.kind === "hall" ||
        room.kind === "entrance" ||
        room.kind === "cage" ||
        room.kind === "corridor"
      ) {
        const bounds = this.standingBounds(room);
        if (bounds) {
          for (const [x, z] of [
            [bounds.minX + 0.6, bounds.minZ + 0.6],
            [bounds.maxX - 0.6, bounds.maxZ - 0.6],
            [bounds.minX + 0.6, bounds.maxZ - 0.6],
            [bounds.maxX - 0.6, bounds.minZ + 0.6],
          ]) {
            if (this.chance(0.5)) {
              this.hang(
                "cctv-camera",
                room.storey,
                x,
                z,
                Math.atan2(
                  (bounds.minX + bounds.maxX) / 2 - x,
                  (bounds.minZ + bounds.maxZ) / 2 - z,
                ),
                room.id,
              );
            }
          }
        }
      }
      // Bay signs over the halls' aisles, at their ends.
      const layout = this.hallAisles.get(room.id);
      if (layout) {
        const [l0, l1] =
          layout.along === "z"
            ? [layout.area.minZ, layout.area.maxZ]
            : [layout.area.minX, layout.area.maxX];
        for (const across of layout.aisles) {
          for (const at of [l0 + 0.8, l1 - 0.8]) {
            const x = layout.along === "z" ? across : at;
            const z = layout.along === "z" ? at : across;
            this.hang(
              "bay-sign",
              room.storey,
              x,
              z,
              layout.along === "z" ? 0 : Math.PI / 2,
              room.id,
            );
          }
        }
      }
      // Air vents in the ceiling of offices and staff rooms.
      if (room.kind === "office" || room.kind === "staff") {
        for (const { col, row } of room.cells) {
          if (!this.chance(0.5)) continue;
          const box = this.building.cellBox(col, row);
          this.hang("duct-vent", room.storey, box.minX + 1, box.minZ + 1, 0, room.id);
        }
      }
    }
    // An emergency light at every flight of stairs, at the bottom and the top.
    for (const link of this.links) {
      if (link.plank) continue;
      for (const end of [link.a, link.b]) {
        const col = Math.floor((end.x - this.building.x0) / CELL);
        const row = Math.floor((end.z - this.building.z0) / CELL);
        const room = this.roomAt(end.storey, col, row);
        if (room < 0) continue;
        const runs = this.wallRuns(this.rooms[room]).filter((run) => {
          const box = this.building.cellBox(col, row);
          const alongX = run.side === "n" || run.side === "s";
          const [c0, c1] = alongX ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
          return run.from < c1 && run.to > c0;
        });
        if (runs.length > 0) {
          const run = this.pick(runs);
          this.emergencyLight(
            run,
            this.rng(run.from + 0.3, run.to - 0.3),
            this.rooms[room],
            COLOURS.amber,
          );
        }
      }
    }
    // And an exit sign over the way out of the building.
    this.exitOverEntrance();
  }

  private emergencyLight(
    run: WallRun,
    along: number,
    room: Room,
    colour: readonly number[],
  ): boolean {
    if (!this.mount("emergency-light", run, along, 2.2, room.id)) return false;
    const fitting = this.placed[this.placed.length - 1];
    const [dx, dz] = OFFSET[OPPOSITE[run.side]];
    this.light({
      kind: "emergency",
      x: fitting.spawn.x + dx * 0.1,
      y: fitting.spawn.y + 0.07,
      z: fitting.spawn.z + dz * 0.1,
      turn: fitting.spawn.turn,
      color: colour,
      power: 0.3,
      state: this.chance(0.1 + room.depth * 0.15) ? "flicker" : "on",
      room: room.id,
    });
    return true;
  }

  private exitOverEntrance() {
    const entrance = this.rooms.find((room) => room.kind === "entrance");
    if (!entrance) return;
    const runs = this.wallRuns(entrance).filter(
      (run) => run.side === "s" && run.from < this.start.x && run.to > this.start.x,
    );
    const run = runs[0];
    if (!run || !this.mount("exit-sign", run, this.start.x, 2.4, entrance.id)) return;
    const sign = this.placed[this.placed.length - 1];
    this.light({
      kind: "exit",
      x: sign.spawn.x,
      y: sign.spawn.y + 0.1,
      z: sign.spawn.z + 0.08,
      turn: sign.spawn.turn,
      color: COLOURS.exit,
      power: 0.15,
      state: "on",
      room: entrance.id,
    });
  }

  /**
   * The way out of a room: the doorway or arch onto the room nearest the entrance, and the wall over
   * it, on this room's side, to hang an exit sign on.
   */
  private exitOf(room: Room): { run: WallRun; along: number; height: number } | undefined {
    if (room.kind === "entrance") return undefined;
    const { building, generated } = this;
    let best: { col: number; row: number; side: Side; distance: number } | undefined;
    for (const { col, row } of room.cells) {
      for (const side of SIDES) {
        const edge = building.parsed.edge(room.storey, col, row, side);
        if (!isOpening(edge)) continue;
        const [dx, dz] = OFFSET[side];
        const there = generated.distance({ storey: room.storey, col: col + dx, row: row + dz });
        const here = generated.distance({ storey: room.storey, col, row });
        if (there === undefined || here === undefined || there >= here) continue;
        if (!best || there < best.distance) best = { col, row, side, distance: there };
      }
    }
    if (!best) return undefined;
    const box = building.cellBox(best.col, best.row);
    const alongX = best.side === "n" || best.side === "s";
    const line = { n: box.maxZ, s: box.minZ, e: box.maxX, w: box.minX }[best.side];
    const [dx, dz] = OFFSET[best.side];
    const opening = openingOf(building.parsed.edge(room.storey, best.col, best.row, best.side));
    const height = room.storey === building.top ? STOREY : STOREY - SLAB;
    const middle = alongX ? (box.minX + box.maxX) / 2 : (box.minZ + box.maxZ) / 2;
    return {
      // The lintel over the opening is the wall it hangs on.
      run: {
        storey: room.storey,
        side: best.side,
        face: line - (dx + dz) * (WALL / 2),
        from: middle - 1,
        to: middle + 1,
        height,
      },
      along: middle,
      height: (opening?.height ?? 2.2) + 0.06,
    };
  }

  /** Ducts, pipes and cable trays in lines under the ceiling of back-of-house rooms and halls. */
  private ceilingRuns(room: Room) {
    const kinds: Partial<Record<RoomKind, PropName[]>> = {
      plant: ["duct", "pipe-run", "cable-tray"],
      stock: ["pipe-run", "cable-tray"],
      corridor: ["cable-tray", "pipe-run", "duct"],
      workshop: ["duct", "cable-tray"],
      hall: ["duct", "pipe-run"],
      cage: ["cable-tray"],
    };
    const options = kinds[room.kind];
    if (!options) return;
    const along = this.longAxis(room);
    const lines = room.kind === "hall" || room.kind === "plant" ? 2 : 1;
    for (let line = 0; line < lines; line++) {
      const model = this.pick(options);
      // Off the middle of the cells, to miss the lights.
      const offset = this.pick([-1.3, 1.3, -0.9, 0.9]);
      const cells = room.cells.filter(
        ({ col, row }) => this.building.ceiling(room.storey, col, row) !== undefined,
      );
      // One line down a row or column of the room's cells.
      const lanes = [...new Set(cells.map(({ col, row }) => (along === "x" ? row : col)))];
      if (lanes.length === 0) continue;
      const lane = this.pick(lanes);
      for (const { col, row } of cells) {
        if ((along === "x" ? row : col) !== lane) continue;
        const box = this.building.cellBox(col, row);
        const x = along === "x" ? (box.minX + box.maxX) / 2 : (box.minX + box.maxX) / 2 + offset;
        const z = along === "x" ? (box.minZ + box.maxZ) / 2 + offset : (box.minZ + box.maxZ) / 2;
        this.hang(model, room.storey, x, z, along === "x" ? 0 : Math.PI / 2, room.id);
      }
    }
  }

  // ---- Loot ----

  /**
   * The items: flashlights by the entrance, and loot spread through the building, worth more the
   * further in, the higher up and the darker it is, and most of all in the cages. Each where it can
   * be reached the way it has to be carried, on clear floor, not in a doorway.
   */
  private placeLoot(): ItemSpawn[] {
    this.reach.update((storey) => this.solidsOn(storey));
    const items: ItemSpawn[] = [];
    const { start } = this;
    for (const [i, dx] of [-1.8, -1.4, 1.4, 1.8].entries()) {
      items.push({
        kind: "flashlight",
        x: start.x + dx,
        y: start.storey * STOREY + 0.05,
        z: start.z + 1.5 + (i % 2) * 0.3,
      });
    }
    // Every spot an item could go, scored by how far in, high up and dark it is.
    const spots: { point: Point; room: Room; score: number }[] = [];
    for (const room of this.rooms) {
      if (room.kind === "atrium" || room.kind === "entrance" || room.kind === "corridor") continue;
      const darkness = this.darkness(room);
      for (const { col, row } of room.cells) {
        if (!this.building.standable(room.storey, col, row)) continue;
        const box = this.building.cellBox(col, row);
        for (let x = box.minX + 0.75; x < box.maxX - 0.5; x += 1.25) {
          for (let z = box.minZ + 0.75; z < box.maxZ - 0.5; z += 1.25) {
            const point = { storey: room.storey, x, z };
            const height = Math.abs(room.storey) / Math.max(1, this.building.top);
            const score =
              0.5 * this.depthAt(room.storey, x, z) +
              0.2 * height +
              0.2 * darkness +
              (room.kind === "cage" ? 0.35 : 0) +
              this.rng(0, 0.1);
            spots.push({ point, room, score });
          }
        }
      }
    }
    spots.sort((a, b) => a.score - b.score);
    // From the cheapest, wanted low in the order, to the dearest, wanted high.
    const loot: { kind: ItemKind; band: [number, number]; rooms: RoomKind[] }[] = [];
    const add = (kind: ItemKind, count: number, band: [number, number], rooms: RoomKind[]) => {
      for (let i = 0; i < count; i++) loot.push({ kind, band, rooms });
    };
    add("phone", 12, [0, 0.8], ["hall", "stock", "office", "staff", "workshop", "cage", "plant"]);
    add("box", 6, [0.15, 0.85], ["hall", "stock", "cage", "workshop"]);
    add("tv", 4, [0.45, 1], ["hall", "stock", "cage", "office"]);
    add("sofa", this.chance(0.5) ? 2 : 1, [0.65, 1], ["hall", "cage", "stock"]);
    const taken: Point[] = [];
    for (const { kind, band, rooms } of loot) {
      const [w, h, d] = ITEM_KINDS[kind].size;
      const mode: Mode = kind === "sofa" ? "wide" : ITEM_KINDS[kind].hands === 2 ? "carry" : "walk";
      const from = Math.floor(band[0] * spots.length);
      const to = Math.max(from + 1, Math.floor(band[1] * spots.length));
      for (let tries = 0; tries < 80; tries++) {
        const spot = spots[from + Math.floor(this.next() * (to - from))];
        if (!spot || !rooms.includes(spot.room.kind)) continue;
        const { point } = spot;
        if (
          taken.some(
            (t) => t.storey === point.storey && Math.hypot(t.x - point.x, t.z - point.z) < 3,
          )
        )
          continue;
        const box = {
          minX: point.x - w / 2 - 0.15,
          maxX: point.x + w / 2 + 0.15,
          minZ: point.z - d / 2 - 0.15,
          maxZ: point.z + d / 2 + 0.15,
        };
        if (!this.clearFor(point.storey, box)) continue;
        if (!this.reach.reaches(mode, point)) continue;
        taken.push(point);
        items.push({ kind, x: point.x, y: point.storey * STOREY + h / 2 + 0.05, z: point.z });
        break;
      }
    }
    return items;
  }

  /** Whether a box of floor is clear of props, the building and doorways. */
  private clearFor(storey: number, box: Box): boolean {
    for (const { col, row } of this.building.cellsUnder(box)) {
      if (!this.building.standable(storey, col, row)) return false;
    }
    if (this.reserved.get(storey)?.some((r) => overlaps(box, r))) return false;
    if (this.blockers.get(storey)?.some((b) => overlaps(box, b))) return false;
    return !this.placed.some(
      (p) => !p.removed && p.storey === storey && p.mount === "floor" && overlaps(box, p.box),
    );
  }
}
