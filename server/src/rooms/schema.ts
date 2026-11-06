import { type SchemaType, schema, t } from "@colyseus/schema";

/**
 * One input frame, consumed by `Room.defineInput()`. Flat primitives only:
 * no seq/dt/time — the engine's input counter is the sequence and one input = one fixed step.
 * Analog, in world space: -MOVE_SCALE..MOVE_SCALE on each axis (client turns stick + camera into this).
 */
export const MoveInput = schema({
  moveX: t.int8(),
  moveZ: t.int8(),
  /** Where the player looks, in YAW_SCALE units. Movement ignores it; carrying and others' views use it. */
  yaw: t.int16(),
  /** Whether the run button is held: full input then goes RUN_SPEED instead of PLAYER_SPEED. */
  run: t.boolean(),
  /** Whether jump is held: it jumps whenever the player stands on the ground. */
  jump: t.boolean(),
});
export type MoveInput = SchemaType<typeof MoveInput>;

export const Player = schema({
  name: t.string(),
  color: t.string(),
  x: t.number(),
  /** Height of the player's feet. */
  y: t.number(),
  z: t.number(),
  vx: t.number(),
  vy: t.number(),
  vz: t.number(),
  /** 1 rested, 0 spent: see RUN_TIME. */
  stamina: t.number(),
  /** Ran out of stamina, and can't run until it's back to RUN_AGAIN. */
  winded: t.boolean(),
  /** Where the player looks around y, in radians. */
  yaw: t.number(),
  /** Id of the item in each hand, or "". A two-handed item is in both. */
  left: t.string(),
  right: t.string(),
  /** Who they are this round, a `Role` from shared/modes.ts: only those playing are in the building. */
  role: t.string(),
  /** In the lobby, ready to start; in the raid, in the truck and wanting to leave. */
  ready: t.boolean(),
});
export type Player = SchemaType<typeof Player>;

export const Item = schema({
  kind: t.string(),
  delivered: t.boolean(),
  /** A flashlight that's switched on. Dropping it leaves it on. */
  on: t.boolean(),
  x: t.number(),
  y: t.number(),
  z: t.number(),
  qx: t.number(),
  qy: t.number(),
  qz: t.number(),
  qw: t.number(),
});
export type Item = SchemaType<typeof Item>;

/** The room's mechanics, from shared/mechanics.ts: every player in it moves by these. */
export const Mechanics = schema({
  walkSpeed: t.number(),
  runSpeed: t.number(),
  runTime: t.number(),
  restTime: t.number(),
  runAgain: t.number(),
  uphill: t.number(),
  stepUp: t.number(),
  stepDown: t.number(),
  climbSpeed: t.number(),
  gravity: t.number(),
  jumpSpeed: t.number(),
});
export type Mechanics = SchemaType<typeof Mechanics>;

export const GameState = schema({
  /** What the room is for, a `Mode` from shared/modes.ts: the playground has no rounds. */
  mode: t.string(),
  /** Where a game's round is, a `Phase` from shared/modes.ts. */
  phase: t.string(),
  /** Seconds left: to the raid starting, to dawn, or to the next round. 0 while waiting in the lobby. */
  timeLeft: t.number(),
  /** What the loot in the truck sells for, and what it must reach to clear the level. */
  loot: t.number(),
  quota: t.number(),
  /** After a raid: whether the truck held the quota. */
  cleared: t.boolean(),
  players: t.map(Player),
  items: t.map(Item),
  /** How bright the lights are, from 0 (off) to 1, as the dimmer leaves them. */
  light: t.number(),
  /** The rules players move by. Tuned live in dev, through the `tune` message. */
  mechanics: Mechanics,
});
export type GameState = SchemaType<typeof GameState>;
