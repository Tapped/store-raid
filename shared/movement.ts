import { resolveCircleBox } from "./collision";
import { MOVE_SCALE, PLAYER_HEIGHT, PLAYER_RADIUS } from "./constants";
import { type Floor, floorHeight, type Ladder, type Level, type LevelBox } from "./level";
import type { Mechanics } from "./mechanics";
import { LADDER_WALL, OFFSET } from "./tiles";

/**
 * Structural types on purpose: the same step runs on a server Schema instance and on the
 * client reconciler's plain predicted copy.
 */
export interface MoverState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 1 rested, 0 spent: see RUN_TIME. */
  stamina: number;
  /** Ran out of stamina, and can't run until it's back to RUN_AGAIN. */
  winded: boolean;
}

/** What players walk on and bump into. */
export type Terrain = Pick<Level, "boxes" | "floors" | "ladders">;

export interface MoveInputLike {
  moveX: number;
  moveZ: number;
  run?: boolean;
  /** Whether jump is held. Optional, so bots that never jump needn't send it. */
  jump?: boolean;
}

/**
 * The single movement step, run identically by the server (once per received input) and by
 * the client reconciler (predict, then replay on correction).
 *
 * Pure function of (state, input, dt), the level's static `terrain` and the room's `mechanics`: no
 * clocks, no randomness, no reads outside its arguments. Break that and client prediction drifts
 * from the server.
 *
 * Players walk on the highest floor under their centre that they can step up onto, follow it down
 * stairs, and fall when it drops away. Boxes only stop them where they overlap them in height. On a
 * ladder, walking into it climbs, backing away climbs down, and nobody falls off it backwards; but
 * with no hand free to climb with, a ladder is just a wall, and its hatch a hole.
 *
 * Holding jump jumps whenever they stand on the ground, not while they climb. In the air they step
 * up over nothing, so a jump clears only what is lower than their feet, and floors overhead stop
 * it, so nobody's head goes through the stairs or the storey above.
 *
 * Player-vs-player pushing is NOT done here (it depends on other players); the server does it
 * after all inputs are applied, and the reconciler corrects us when it happens.
 */
export function stepMover(
  mover: MoverState,
  input: MoveInputLike,
  dt: number,
  terrain: Terrain,
  /** The rules they move by: the room's, synced from the server. */
  m: Mechanics,
  /** Whether they have a hand free to climb with: see `canClimb`. */
  climbs = true,
): void {
  let dirX = input.moveX / MOVE_SCALE;
  let dirZ = input.moveZ / MOVE_SCALE;

  // Analog: a half-pushed stick walks. Cap the length so a diagonal isn't faster than straight.
  const length = Math.hypot(dirX, dirZ);
  if (length > 1) {
    dirX /= length;
    dirZ /= length;
  }

  // On a ladder when pushing into it, or anywhere off the ground in front of it.
  const ladder = climbs ? ladderAt(terrain, mover.x, mover.y, mover.z, m.stepDown) : undefined;
  let climb: number | undefined;
  if (ladder) {
    const [towardX, towardZ] = OFFSET[ladder.toward];
    const into = dirX * towardX + dirZ * towardZ;
    const ground = groundUnder(terrain, mover.x, mover.z, mover.y + m.stepUp);
    if (into > 0.2 || mover.y > ground + m.stepDown) {
      climb = into;
      // Backing away climbs down instead of stepping off.
      if (into < 0) {
        dirX -= into * towardX;
        dirZ -= into * towardZ;
      }
    }
  }

  // Stairs slow them down, and running up them is harder work. A ladder has its own pace.
  const pace =
    climb === undefined ? paceAt(terrain, mover.x, mover.y, mover.z, dirX, dirZ, m) : FLAT;

  // Running takes stamina, more going up, and only happens on the ground, moving, with some left.
  const running = input.run === true && climb === undefined && length > 0 && !mover.winded;
  if (running) {
    mover.stamina = Math.max(0, mover.stamina - (dt * pace.effort) / m.runTime);
    if (mover.stamina === 0) mover.winded = true;
  } else {
    mover.stamina = Math.min(1, mover.stamina + dt / m.restTime);
    if (mover.stamina >= m.runAgain) mover.winded = false;
  }

  const speed = (running ? m.runSpeed : m.walkSpeed) * pace.speed;
  let vx = dirX * speed;
  let vz = dirZ * speed;

  const circle = { x: mover.x + vx * dt, z: mover.z + vz * dt, radius: PLAYER_RADIUS };
  // Below the top, a climber stays against the ladder, even having come onto it from above.
  if (ladder && climb !== undefined && mover.y < ladder.top - m.stepUp) {
    const gap = LADDER_WALL + PLAYER_RADIUS;
    if (ladder.toward === "n") circle.z = Math.min(circle.z, ladder.maxZ - gap);
    if (ladder.toward === "s") circle.z = Math.max(circle.z, ladder.minZ + gap);
    if (ladder.toward === "e") circle.x = Math.min(circle.x, ladder.maxX - gap);
    if (ladder.toward === "w") circle.x = Math.max(circle.x, ladder.minX + gap);
  }
  // In the air nobody steps up: a railing stops a jump that doesn't clear it.
  const airborne =
    climb === undefined &&
    (mover.vy > 0 ||
      mover.y - groundUnder(terrain, mover.x, mover.z, mover.y + m.stepUp) > m.stepDown);
  const lift = airborne ? 0 : m.stepUp;
  for (const box of terrain.boxes) {
    if (!blocks(box, mover.y, lift)) continue;
    const { dx, dz } = resolveCircleBox(circle, box);
    // Kill velocity heading into the wall so the reconciler replays the same stop.
    if (dx !== 0 && Math.sign(dx) !== Math.sign(vx)) vx = 0;
    if (dz !== 0 && Math.sign(dz) !== Math.sign(vz)) vz = 0;
  }

  mover.x = circle.x;
  mover.z = circle.z;
  mover.vx = vx;
  mover.vz = vz;

  const ground = groundUnder(terrain, circle.x, circle.z, mover.y + m.stepUp);
  const grounded = mover.vy <= 0 && mover.y - ground <= m.stepDown;
  if (ladder && climb !== undefined) {
    mover.vy = 0;
    mover.y = Math.max(ground, Math.min(ladder.top, mover.y + climb * m.climbSpeed * dt));
  } else if (grounded && !input.jump) {
    mover.y = ground;
    mover.vy = 0;
  } else {
    if (grounded) {
      mover.y = ground;
      mover.vy = m.jumpSpeed;
    }
    const y = mover.y;
    mover.vy -= m.gravity * dt;
    mover.y += mover.vy * dt;
    // Heads bump the floor above: only one that was over it, not one it already stands under.
    const ceiling = ceilingOver(terrain, circle.x, circle.z, y + PLAYER_HEIGHT);
    if (mover.vy > 0 && mover.y + PLAYER_HEIGHT > ceiling) {
      mover.y = Math.max(y, ceiling - PLAYER_HEIGHT);
      mover.vy = 0;
    }
    if (mover.y <= ground) {
      mover.y = ground;
      mover.vy = 0;
    }
  }
}

/** Whether a box is in the way of a player with their feet at this height, above what they step up. */
function blocks(box: LevelBox, y: number, lift: number): boolean {
  return box.y + box.height > y + lift && box.y < y + PLAYER_HEIGHT;
}

/** The ladder a player standing here can climb, if any. */
function ladderAt(
  terrain: Terrain,
  x: number,
  y: number,
  z: number,
  stepDown: number,
): Ladder | undefined {
  return terrain.ladders.find(
    (ladder) =>
      x >= ladder.minX &&
      x <= ladder.maxX &&
      z >= ladder.minZ &&
      z <= ladder.maxZ &&
      y >= ladder.y - stepDown &&
      y <= ladder.top,
  );
}

/** How a walker's speed and effort change with the ground under them: see `paceAt`. */
export interface Pace {
  /** The share of their speed on the flat that they keep. */
  speed: number;
  /** How much harder than on the flat it is to go: 1 or more. */
  effort: number;
}

const FLAT: Pace = { speed: 1, effort: 1 };

/**
 * The pace of anything walking the level from here in this direction: players, and anything that
 * chases them, so all of them are slowed the same. On stairs their speed is along the slope, not
 * across the ground, and going up costs more, by `uphill` for every meter it rises per meter across:
 * they go slower, and running there tires them faster. Flat ground, the air, and across the stairs
 * leave them as they are.
 *
 * `dirX`, `dirZ` is the way they're going, of any length. Pure, like `stepMover`.
 */
export function paceAt(
  terrain: Terrain,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  m: Pick<Mechanics, "uphill" | "stepUp" | "stepDown">,
): Pace {
  const length = Math.hypot(dirX, dirZ);
  const floor = floorUnder(terrain, x, z, y + m.stepUp);
  if (length === 0 || !floor?.rise || y - floorHeight(floor, x, z) > m.stepDown) return FLAT;
  const [towardX, towardZ] = OFFSET[floor.rise.toward];
  const across = towardX !== 0 ? floor.maxX - floor.minX : floor.maxZ - floor.minZ;
  // Meters up per meter across in this direction: below 0 going down.
  const grade = ((floor.rise.height / across) * (dirX * towardX + dirZ * towardZ)) / length;
  const effort = 1 + m.uphill * Math.max(0, grade);
  return { speed: 1 / Math.hypot(1, grade) / effort, effort };
}

/** The highest floor under a point that isn't above `below`, if any. */
function floorUnder(terrain: Terrain, x: number, z: number, below: number): Floor | undefined {
  let found: Floor | undefined;
  let ground = Number.NEGATIVE_INFINITY;
  for (const floor of terrain.floors) {
    if (x < floor.minX || x > floor.maxX || z < floor.minZ || z > floor.maxZ) continue;
    const height = floorHeight(floor, x, z);
    if (height <= below && height > ground) {
      ground = height;
      found = floor;
    }
  }
  return found;
}

/** The top of the highest floor under a point that isn't above `below`; -Infinity over a hole. */
export function groundUnder(terrain: Terrain, x: number, z: number, below: number): number {
  const floor = floorUnder(terrain, x, z, below);
  return floor ? floorHeight(floor, x, z) : Number.NEGATIVE_INFINITY;
}

/** The bottom of the lowest floor over a point that is above `above`; Infinity under open sky. */
function ceilingOver(terrain: Terrain, x: number, z: number, above: number): number {
  let ceiling = Number.POSITIVE_INFINITY;
  for (const floor of terrain.floors) {
    if (x < floor.minX || x > floor.maxX || z < floor.minZ || z > floor.maxZ) continue;
    const height = floorHeight(floor, x, z) - floor.thickness;
    if (height >= above && height < ceiling) ceiling = height;
  }
  return ceiling;
}
