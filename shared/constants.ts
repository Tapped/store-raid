/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

/** Arena size in world units (meters). The arena is centred on the origin. */
export const ARENA_SIZE = 40;

/** Player collision radius, fitted to the character model's body. */
export const PLAYER_RADIUS = 0.3;

/** Player collision height, about that of the character model. */
export const PLAYER_HEIGHT = 1.8;

/** What can be carried: its size (x = long side) and how many people it takes to lift it. */
export const ITEM_KINDS = {
  box: { size: [1, 1, 1], carriers: 1 },
  sofa: { size: [2.4, 0.9, 0.9], carriers: 2 },
} as const;
export type ItemKind = keyof typeof ITEM_KINDS;

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
