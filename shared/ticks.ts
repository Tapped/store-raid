import type { Box } from "./collision";
import type { Level, LevelBox } from "./level";
import type { Mechanics } from "./mechanics";
import { groundUnder } from "./movement";
import { near } from "./spatial";

/**
 * Large ticks, the first building's enemy: what they are in numbers, and the questions about a
 * level that the server asks to move them (server/src/ticks.ts) and the client to draw them
 * (client/src/ticks.ts). They wait on top of racking in the dark, drop onto whoever walks under,
 * hunt across the floor and leap, latch on and drain health until pulled off, and back away from a
 * flashlight's beam.
 */

/**
 * What a tick is doing, synced as `Tick.state`:
 *
 * - `perched`: waiting on top of racking; `wary` when a beam has found it there, and it won't drop.
 * - `airborne`: dropping, leaping, or thrown off someone.
 * - `wandering`: on the floor with nobody to hunt, or with the lights up.
 * - `hunting`: after a player; `fleeing`: backing away from a light.
 * - `latched`: on a player (`Tick.victim`), draining their health.
 * - `stunned`: on its back for a moment, after being pulled off.
 */
export type TickState =
  | "perched"
  | "wary"
  | "airborne"
  | "wandering"
  | "hunting"
  | "fleeing"
  | "latched"
  | "stunned";

/** What a player's health starts at. */
export const MAX_HEALTH = 100;

/** `MoveInput.pitch` is radians times this, a whole number: how far up the player looks. */
export const PITCH_SCALE = 80;

/** A tick's collision radius and height, in meters. */
export const TICK_RADIUS = 0.3;
export const TICK_HEIGHT = 0.45;

export const TICK = {
  /** Health a latched tick takes a second: about a quarter of a minute from full to dead. */
  bite: 7,
  /** Meters a second: wandering, hunting and fleeing. Players walk at 5 and run at 7.5. */
  wander: 0.5,
  hunt: 3.4,
  flee: 4.2,
  /** How much faster they are at dawn than when the raid starts. */
  dawn: 1.4,
  /** Radians a second they turn at. */
  turn: 7,
  /** How far they sense a player, and how far above or below them that player may be. */
  sense: 11,
  senseHeight: 2.5,
  /** A perched tick drops on a player who comes this near, on the ground, to the foot of its perch. */
  dropRange: 2.2,
  /** On the floor, it leaps at a player this near, and is in the air this long. */
  leapRange: 2.6,
  leapTime: 0.45,
  /** Seconds before it leaps again. */
  leapRest: 2.5,
  /** How near a player's middle it must pass in the air to latch on. */
  latch: 0.6,
  /** How fast they fall, in meters per second per second: slower than players, to be seen coming. */
  gravity: 14,
  /** Seconds on its back after being pulled off. */
  stun: 2.5,
  /** Half the angle of the part of a flashlight's beam that they mind, in radians, and how far. */
  beam: 0.3,
  beamRange: 14,
  /** Seconds it stays afraid after the light leaves it. */
  afraid: 2.5,
  /** Seconds of someone else's beam on a latched tick before it lets go. */
  letGo: 0.5,
  /** How bright a playground's lights must be (`state.light`) for them not to hunt. */
  bright: 0.5,
  /** How far a player can reach to pull a tick off someone else. */
  reach: 1.5,
} as const;

/** How high above a player's feet, and how far in front of them, a latched tick's middle is. */
export const LATCH_HEIGHT = 1.4;
export const LATCH_AHEAD = 0.32;

/** Where ticks start in the playground, which has no racking: on the floor by the concepts. */
const PLAYGROUND_TICKS = [
  { x: 11.5, y: 0, z: -8 },
  { x: 9.5, y: 0, z: -6 },
];

/** A place on top of racking for a tick to wait, and the box it's on. */
export interface Perch {
  x: number;
  y: number;
  z: number;
  box?: LevelBox;
}

/** Racking this tall or taller is worth dropping from. */
const PERCH_HEIGHT = 1.6;
/** Perches along a long run of shelving are this far apart. */
const PERCH_SPACING = 2.6;

/**
 * Everywhere in a level a tick could wait: along the tops of its racking and shelving, away from
 * its light fittings and its truck. The playground has spots on the floor instead.
 */
export function perches(level: Level): Perch[] {
  if (level.name === "playground") return PLAYGROUND_TICKS.map((spot) => ({ ...spot }));
  const found: Perch[] = [];
  for (const box of level.boxes) {
    if (box.kind !== "shelf" || box.height < PERCH_HEIGHT) continue;
    const width = box.maxX - box.minX;
    const depth = box.maxZ - box.minZ;
    const count = Math.max(1, Math.round(Math.max(width, depth) / PERCH_SPACING));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = width >= depth ? box.minX + width * t : (box.minX + box.maxX) / 2;
      const z = width >= depth ? (box.minZ + box.maxZ) / 2 : box.minZ + depth * t;
      const y = box.y + box.height;
      if (litByFittings(level, x, box.y, z)) continue;
      if (level.dock && distanceToBox(level.dock, x, z) < 6) continue;
      found.push({ x, y, z, box });
    }
  }
  return found;
}

/** How many ticks a level starts a raid with, of the perches it has. */
export function tickCount(level: Level, available: number): number {
  if (level.name === "playground") return available;
  return Math.min(available, Math.max(4, Math.min(12, Math.round(available * 0.12))));
}

function distanceToBox(box: Box, x: number, z: number): number {
  return Math.hypot(
    Math.max(box.minX - x, 0, x - box.maxX),
    Math.max(box.minZ - z, 0, z - box.maxZ),
  );
}

/**
 * Whether a point on a floor is in the light of one of the level's working fittings: ticks keep
 * out of it, so the lit rooms by the entrance are safe. Levels without fittings are never lit.
 */
export function litByFittings(level: Level, x: number, y: number, z: number): boolean {
  for (const light of level.lights) {
    if (light.state !== "on" || light.kind === "exit") continue;
    const dy = light.y - y;
    if (dy < 0 || dy > 3.4) continue;
    const reach = 2.5 + 2 * Math.min(2, light.power);
    if ((light.x - x) ** 2 + (light.z - z) ** 2 < reach * reach) return true;
  }
  return false;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Boxes that stop a look or a beam of light: not railings, chain-link or the edge of a pit. */
function opaque(box: LevelBox): boolean {
  return box.kind !== "mesh" && box.kind !== "rail" && box.kind !== "pit";
}

/**
 * Whether nothing solid lies on the straight line between two points, so light from one reaches
 * the other. `ignore` is a box to look through: the one a perched tick sits on.
 */
export function clearLine(level: Level, a: Point, b: Point, ignore?: LevelBox): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.ceil(length / 0.25);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    for (const box of near(level.boxes, x, z)) {
      if (box === ignore || !opaque(box)) continue;
      if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) {
        if (y > box.y && y < box.y + box.height) return false;
      }
    }
  }
  return true;
}

/** A flashlight's beam: where it starts, the unit vector it points along, and who holds it. */
export interface Beam extends Point {
  dx: number;
  dy: number;
  dz: number;
  holder?: string;
}

/** Whether a point is in the part of a beam that ticks mind, walls aside. */
export function inBeam(beam: Beam, point: Point): boolean {
  const x = point.x - beam.x;
  const y = point.y - beam.y;
  const z = point.z - beam.z;
  const distance = Math.hypot(x, y, z);
  if (distance > TICK.beamRange) return false;
  if (distance < 0.5) return true;
  return (x * beam.dx + y * beam.dy + z * beam.dz) / distance > Math.cos(TICK.beam);
}

type Steps = Pick<Mechanics, "stepUp" | "stepDown">;

/**
 * Where a tick's feet would be if it stood at (x, z) having come from height `y`, or undefined if
 * it can't stand there: no floor within a step, something in the way, or (with `dark`) in the
 * light of a fitting.
 */
export function standing(
  level: Level,
  x: number,
  y: number,
  z: number,
  m: Steps,
  dark = false,
): number | undefined {
  const ground = groundUnder(level, x, z, y + m.stepUp);
  if (!Number.isFinite(ground) || y - ground > m.stepDown + 0.3) return undefined;
  for (const box of near(level.boxes, x, z)) {
    if (box.y + box.height <= ground + m.stepUp || box.y >= ground + TICK_HEIGHT) continue;
    if (distanceToBox(box, x, z) < TICK_RADIUS) return undefined;
  }
  if (dark && litByFittings(level, x, ground, z)) return undefined;
  return ground;
}

/** The size of a cell of the grid ticks find their way over, in meters. */
const CELL = 0.5;
/** A search gives up after looking at this many cells: the player is too far round for now. */
const MAX_CELLS = 1500;
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * A way across the floor from one point to another for a tick, round racking and walls and up or
 * down stairs, as points to walk to in turn, the last of them the goal; undefined if there's none
 * short enough to find. A* over a grid of half-meter cells, each as high as the floor there. Ticks
 * keep out of the light of fittings, so a way never goes through it.
 */
export function findPath(level: Level, from: Point, to: Point, m: Steps): Point[] | undefined {
  interface Cell {
    col: number;
    row: number;
    y: number;
    cost: number;
    score: number;
    parent?: Cell;
  }
  const col = (x: number) => Math.round(x / CELL);
  const goal = { col: col(to.x), row: col(to.z) };
  const key = (c: number, r: number, y: number) => `${c},${r},${Math.round(y / 1.5)}`;
  const guess = (c: number, r: number) => Math.hypot(c - goal.col, r - goal.row) * CELL;
  const start: Cell = { col: col(from.x), row: col(from.z), y: from.y, cost: 0, score: 0 };
  const open: Cell[] = [start];
  const best = new Map<string, number>([[key(start.col, start.row, start.y), 0]]);
  let looked = 0;
  while (open.length > 0 && looked++ < MAX_CELLS) {
    // The most promising cell: a plain search of the list, which stays short.
    let at = 0;
    for (let i = 1; i < open.length; i++) if (open[i].score < open[at].score) at = i;
    const cell = open[at];
    open[at] = open[open.length - 1];
    open.pop();
    if (
      Math.abs(cell.col - goal.col) <= 1 &&
      Math.abs(cell.row - goal.row) <= 1 &&
      Math.abs(cell.y - to.y) < 1.2
    ) {
      const path: Point[] = [{ x: to.x, y: cell.y, z: to.z }];
      for (let c: Cell | undefined = cell; c?.parent; c = c.parent) {
        path.unshift({ x: c.col * CELL, y: c.y, z: c.row * CELL });
      }
      return path;
    }
    for (const [dc, dr] of NEIGHBOURS) {
      const c = cell.col + dc;
      const r = cell.row + dr;
      const y = standing(level, c * CELL, cell.y, r * CELL, m, true);
      if (y === undefined) continue;
      const cost = cell.cost + Math.hypot(dc, dr) * CELL;
      const k = key(c, r, y);
      if ((best.get(k) ?? Number.POSITIVE_INFINITY) <= cost) continue;
      best.set(k, cost);
      open.push({ col: c, row: r, y, cost, score: cost + guess(c, r), parent: cell });
    }
  }
  return undefined;
}
