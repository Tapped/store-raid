/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

/** Arena size in world units (meters). The arena is centred on the origin. */
export const ARENA_SIZE = 40;

/** Player collision radius. */
export const PLAYER_RADIUS = 0.5;

/** Units per second at full input. */
export const PLAYER_SPEED = 6;

export const MAX_PLAYERS = 16;

/** Players sharing one screen. */
export const MAX_LOCAL_PLAYERS = 4;

/** Full deflection of a MoveInput axis; inputs are whole numbers so prediction stays exact. */
export const MOVE_SCALE = 100;

/** Player colours, assigned by join order. */
export const PLAYER_COLORS = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#46f0f0",
  "#f032e6",
];
