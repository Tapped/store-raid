import { resolveCircleBox } from "./collision";
import {
  CLIMB_SPEED,
  GRAVITY,
  MOVE_SCALE,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  STEP_DOWN,
  STEP_UP,
} from "./constants";
import { floorHeight, type Ladder, type Level, type LevelBox } from "./level";
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
}

/** What players walk on and bump into. */
export type Terrain = Pick<Level, "boxes" | "floors" | "ladders">;

export interface MoveInputLike {
  moveX: number;
  moveZ: number;
}

/**
 * The single movement step, run identically by the server (once per received input) and by
 * the client reconciler (predict, then replay on correction).
 *
 * Pure function of (state, input, dt) and the level's static `terrain`: no clocks, no randomness, no
 * reads outside its arguments. Break that and client prediction drifts from the server.
 *
 * Players walk on the highest floor under their centre that they can step up onto, follow it down
 * stairs, and fall when it drops away. Boxes only stop them where they overlap them in height. On a
 * ladder, walking into it climbs, backing away climbs down, and nobody falls off it backwards.
 *
 * Player-vs-player pushing is NOT done here (it depends on other players); the server does it
 * after all inputs are applied, and the reconciler corrects us when it happens.
 */
export function stepMover(
  mover: MoverState,
  input: MoveInputLike,
  dt: number,
  terrain: Terrain,
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
  const ladder = ladderAt(terrain, mover.x, mover.y, mover.z);
  let climb: number | undefined;
  if (ladder) {
    const [towardX, towardZ] = OFFSET[ladder.toward];
    const into = dirX * towardX + dirZ * towardZ;
    const ground = groundUnder(terrain, mover.x, mover.z, mover.y + STEP_UP);
    if (into > 0.2 || mover.y > ground + STEP_DOWN) {
      climb = into;
      // Backing away climbs down instead of stepping off.
      if (into < 0) {
        dirX -= into * towardX;
        dirZ -= into * towardZ;
      }
    }
  }

  let vx = dirX * PLAYER_SPEED;
  let vz = dirZ * PLAYER_SPEED;

  const circle = { x: mover.x + vx * dt, z: mover.z + vz * dt, radius: PLAYER_RADIUS };
  // Below the top, a climber stays against the ladder, even having come onto it from above.
  if (ladder && climb !== undefined && mover.y < ladder.top - STEP_UP) {
    const gap = LADDER_WALL + PLAYER_RADIUS;
    if (ladder.toward === "n") circle.z = Math.min(circle.z, ladder.maxZ - gap);
    if (ladder.toward === "s") circle.z = Math.max(circle.z, ladder.minZ + gap);
    if (ladder.toward === "e") circle.x = Math.min(circle.x, ladder.maxX - gap);
    if (ladder.toward === "w") circle.x = Math.max(circle.x, ladder.minX + gap);
  }
  for (const box of terrain.boxes) {
    if (!blocks(box, mover.y)) continue;
    const { dx, dz } = resolveCircleBox(circle, box);
    // Kill velocity heading into the wall so the reconciler replays the same stop.
    if (dx !== 0 && Math.sign(dx) !== Math.sign(vx)) vx = 0;
    if (dz !== 0 && Math.sign(dz) !== Math.sign(vz)) vz = 0;
  }

  mover.x = circle.x;
  mover.z = circle.z;
  mover.vx = vx;
  mover.vz = vz;

  const ground = groundUnder(terrain, circle.x, circle.z, mover.y + STEP_UP);
  if (ladder && climb !== undefined) {
    mover.vy = 0;
    mover.y = Math.max(ground, Math.min(ladder.top, mover.y + climb * CLIMB_SPEED * dt));
  } else if (mover.vy <= 0 && mover.y - ground <= STEP_DOWN) {
    mover.y = ground;
    mover.vy = 0;
  } else {
    mover.vy -= GRAVITY * dt;
    mover.y += mover.vy * dt;
    if (mover.y <= ground) {
      mover.y = ground;
      mover.vy = 0;
    }
  }
}

/** Whether a box is in the way of a player standing at this height, above what they step up. */
function blocks(box: LevelBox, y: number): boolean {
  return box.y + box.height > y + STEP_UP && box.y < y + PLAYER_HEIGHT;
}

/** The ladder a player standing here can climb, if any. */
function ladderAt(terrain: Terrain, x: number, y: number, z: number): Ladder | undefined {
  return terrain.ladders.find(
    (ladder) =>
      x >= ladder.minX &&
      x <= ladder.maxX &&
      z >= ladder.minZ &&
      z <= ladder.maxZ &&
      y >= ladder.y - STEP_DOWN &&
      y <= ladder.top,
  );
}

/** The top of the highest floor under a point that isn't above `below`; -Infinity over a hole. */
export function groundUnder(terrain: Terrain, x: number, z: number, below: number): number {
  let ground = Number.NEGATIVE_INFINITY;
  for (const floor of terrain.floors) {
    if (x < floor.minX || x > floor.maxX || z < floor.minZ || z > floor.maxZ) continue;
    const height = floorHeight(floor, x, z);
    if (height <= below && height > ground) ground = height;
  }
  return ground;
}
