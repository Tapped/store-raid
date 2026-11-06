import {
  CLIMB_SPEED,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_SPEED,
  REST_TIME,
  RUN_AGAIN,
  RUN_SPEED,
  RUN_TIME,
  STEP_DOWN,
  STEP_UP,
  UPHILL,
} from "./constants";

/**
 * The rules players move by, as numbers: what `stepMover` and `paceAt` are given rather than read
 * from constants, so they can be tuned while the game runs. The server owns a room's mechanics and
 * syncs them, and each client predicts its own player with the same ones, so the two never disagree.
 * The constants in constants.ts are the defaults, and what each one means is written there.
 */
export interface Mechanics {
  /** PLAYER_SPEED: meters per second at full input. */
  walkSpeed: number;
  /** RUN_SPEED: meters per second at full input while running. */
  runSpeed: number;
  /** RUN_TIME: seconds of running from full stamina to none. */
  runTime: number;
  /** REST_TIME: seconds of not running from no stamina to full. */
  restTime: number;
  /** RUN_AGAIN: the stamina a winded player needs back before they can run again. */
  runAgain: number;
  /** UPHILL: how much harder going up stairs is, per meter of rise per meter across. */
  uphill: number;
  /** STEP_UP: how high a player steps up without noticing. */
  stepUp: number;
  /** STEP_DOWN: how far down a player follows the floor before falling. */
  stepDown: number;
  /** CLIMB_SPEED: meters per second up or down a ladder. */
  climbSpeed: number;
  /** GRAVITY: meters per second per second. */
  gravity: number;
  /** JUMP_SPEED: meters per second up as a jump leaves the ground. */
  jumpSpeed: number;
}

/** The mechanics every room starts with. */
export const MECHANICS: Readonly<Mechanics> = Object.freeze({
  walkSpeed: PLAYER_SPEED,
  runSpeed: RUN_SPEED,
  runTime: RUN_TIME,
  restTime: REST_TIME,
  runAgain: RUN_AGAIN,
  uphill: UPHILL,
  stepUp: STEP_UP,
  stepDown: STEP_DOWN,
  climbSpeed: CLIMB_SPEED,
  gravity: GRAVITY,
  jumpSpeed: JUMP_SPEED,
});

/** How far each can be tuned, and in what steps: the server holds asked-for values to these. */
export const MECHANICS_RANGE: Readonly<
  Record<keyof Mechanics, { min: number; max: number; step: number }>
> = {
  walkSpeed: { min: 0.5, max: 15, step: 0.1 },
  runSpeed: { min: 0.5, max: 25, step: 0.1 },
  runTime: { min: 0.5, max: 30, step: 0.1 },
  restTime: { min: 0.5, max: 30, step: 0.1 },
  runAgain: { min: 0, max: 1, step: 0.01 },
  uphill: { min: 0, max: 3, step: 0.05 },
  stepUp: { min: 0, max: 1, step: 0.01 },
  stepDown: { min: 0, max: 1, step: 0.01 },
  climbSpeed: { min: 0.2, max: 8, step: 0.1 },
  gravity: { min: 1, max: 60, step: 0.5 },
  jumpSpeed: { min: 0, max: 20, step: 0.1 },
};

export const MECHANICS_KEYS = Object.keys(MECHANICS) as (keyof Mechanics)[];

/**
 * The known, finite mechanics in `asked`, each held to its range; anything else is left out. For
 * values off the wire, which can be anything.
 */
export function clampMechanics(asked: unknown): Partial<Mechanics> {
  const clamped: Partial<Mechanics> = {};
  if (typeof asked !== "object" || asked === null) return clamped;
  for (const key of MECHANICS_KEYS) {
    const value = (asked as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const { min, max } = MECHANICS_RANGE[key];
    clamped[key] = Math.min(max, Math.max(min, value));
  }
  return clamped;
}
