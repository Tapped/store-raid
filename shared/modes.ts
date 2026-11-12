import type { Box } from "./collision";
import { ITEM_KINDS, type ItemKind } from "./constants";
import { type Level, levelNamed } from "./level";

/**
 * What a room is for. In the playground, features are tried out: no rounds, nobody dies, the lights
 * on the dimmer. A game is the real thing: rounds of a raid on the building, in phases.
 */
export const MODES = ["playground", "game"] as const;
export type Mode = (typeof MODES)[number];

/**
 * The mode asked for, else the level's own (`Level.mode`): the playground hall is for trying things
 * out, and the harbour for walking around; the rest are games.
 */
export function modeFor(levelName: string, asked?: unknown): Mode {
  if (MODES.includes(asked as Mode)) return asked as Mode;
  return levelNamed(levelName).mode ?? "game";
}

/**
 * A game's round, in order: the crew gathers in the truck and readies up, raids the building until
 * everyone alive is back in the truck and wants to leave, or until dawn, and sees how it went.
 * Then it starts over.
 */
export type Phase = "lobby" | "raid" | "results";

/**
 * Who a player is this round. Only those `playing` are in the building; everyone else watches
 * through the eyes of those who are: the `dead`, those `lost` outside the truck at dawn, and those
 * `waiting` because they joined after the raid began.
 */
export type Role = "playing" | "dead" | "lost" | "waiting";

/** Seconds from the start of a raid to dawn. */
export const RAID_TIME = 10 * 60;
/** Seconds between everyone being ready and the raid starting. */
export const START_TIME = 3;
/** Seconds the results show before the next round's lobby. */
export const RESULTS_TIME = 10;
/** How bright the lights are in a game: dimmed, so the flashlight matters. */
export const GAME_LIGHT = 0.35;
/** The share of a building's loot the truck must hold to clear it. */
const QUOTA_SHARE = 0.5;

/** What an item sells for. Flashlights are gear, not loot. */
export function itemValue(kind: ItemKind): number {
  return ITEM_KINDS[kind].value;
}

/** The loot the truck must hold to clear a level: a share of all there is, in tens. */
export function quotaFor(level: Level): number {
  const total = level.items.reduce((sum, item) => sum + itemValue(item.kind), 0);
  return Math.max(10, Math.round((total * QUOTA_SHARE) / 10) * 10);
}

/** Whether a point is inside a box, on the ground. */
export function inside(box: Box | undefined, x: number, z: number): boolean {
  return !!box && x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ;
}
