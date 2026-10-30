import { resolveCircleBox } from "./collision";
import { MOVE_SCALE, PLAYER_RADIUS, PLAYER_SPEED } from "./constants";
import { LEVEL_BOXES } from "./level";

/**
 * Structural types on purpose: the same step runs on a server Schema instance and on the
 * client reconciler's plain predicted copy.
 */
export interface MoverState {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface MoveInputLike {
  moveX: number;
  moveZ: number;
}

/**
 * The single movement step, run identically by the server (once per received input) and by
 * the client reconciler (predict, then replay on correction).
 *
 * Pure function of (state, input, dt): no clocks, no randomness, no reads outside its
 * arguments and static level data. Break that and client prediction drifts from the server.
 *
 * Player-vs-player pushing is NOT done here (it depends on other players); the server does it
 * after all inputs are applied, and the reconciler corrects us when it happens.
 */
export function stepMover(mover: MoverState, input: MoveInputLike, dt: number): void {
  let dirX = input.moveX / MOVE_SCALE;
  let dirZ = input.moveZ / MOVE_SCALE;

  // Analog: a half-pushed stick walks. Cap the length so a diagonal isn't faster than straight.
  const length = Math.hypot(dirX, dirZ);
  if (length > 1) {
    dirX /= length;
    dirZ /= length;
  }

  let vx = dirX * PLAYER_SPEED;
  let vz = dirZ * PLAYER_SPEED;

  const circle = { x: mover.x + vx * dt, z: mover.z + vz * dt, radius: PLAYER_RADIUS };
  for (const box of LEVEL_BOXES) {
    const { dx, dz } = resolveCircleBox(circle, box);
    // Kill velocity heading into the wall so the reconciler replays the same stop.
    if (dx !== 0 && Math.sign(dx) !== Math.sign(vx)) vx = 0;
    if (dz !== 0 && Math.sign(dz) !== Math.sign(vz)) vz = 0;
  }

  mover.x = circle.x;
  mover.z = circle.z;
  mover.vx = vx;
  mover.vz = vz;
}
