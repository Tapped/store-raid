/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

/** Arena size in world units (meters). The arena is centred on the origin. */
export const ARENA_SIZE = 40;

/** Player collision radius, fitted to the character model's body. */
export const PLAYER_RADIUS = 0.3;

/** Player collision height, about that of the character model. */
export const PLAYER_HEIGHT = 1.8;

/** Where the first-person camera sits: the player's eyes. */
export const EYE_HEIGHT = 1.65;

/**
 * What can be carried: its size (x = long side), how many hands each carrier needs for it, and how
 * many people it takes to lift it.
 */
export const ITEM_KINDS = {
  phone: { size: [0.25, 0.08, 0.18], hands: 1, carriers: 1 },
  tv: { size: [1.2, 0.75, 0.15], hands: 2, carriers: 1 },
  box: { size: [1, 1, 1], hands: 2, carriers: 1 },
  sofa: { size: [2.4, 0.9, 0.9], hands: 2, carriers: 2 },
} as const;
export type ItemKind = keyof typeof ITEM_KINDS;

/** Every player has two hands, each holding one thing, or both holding the same two-handed thing. */
export const HANDS = ["left", "right"] as const;
export type Hand = (typeof HANDS)[number];

/** What a player holds: the id of the item in each hand, "" when it's empty. */
export type Holding = Record<Hand, string>;

/** The hand a grab uses: the right if it's free, else the left; undefined when both are full. */
export function grabbingHand(holding: Holding): Hand | undefined {
  if (!holding.right) return "right";
  if (!holding.left) return "left";
  return undefined;
}

/** Climbing a ladder takes a free hand: a phone in the other is fine, a TV or two phones aren't. */
export function canClimb(holding: Holding): boolean {
  return grabbingHand(holding) !== undefined;
}

/** The hand a drop empties: the last one to grab, so the left if it holds anything. */
export function droppingHand(holding: Holding): Hand | undefined {
  if (holding.left) return "left";
  if (holding.right) return "right";
  return undefined;
}

/** Units per second at full input. */
export const PLAYER_SPEED = 6;

/** How high a player steps up without noticing, and how far down they follow the floor before falling. */
export const STEP_UP = 0.35;
export const STEP_DOWN = 0.3;
/** How fast players climb a ladder, in meters per second. */
export const CLIMB_SPEED = 2.5;

/** How fast players fall, in meters per second per second. */
export const GRAVITY = 20;

/** Seconds a dimmer takes to fade the lights from fully on to off, or back. */
export const DIM_TIME = 3;

export const MAX_PLAYERS = 16;

/** Full deflection of a MoveInput axis; inputs are whole numbers so prediction stays exact. */
export const MOVE_SCALE = 100;

/**
 * MoveInput's yaw is radians times this, a whole number in ±π × YAW_SCALE. Yaw is the way the player
 * looks around y, as in Babylon: 0 looks along +z, π/2 along +x.
 */
export const YAW_SCALE = 10000;

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
