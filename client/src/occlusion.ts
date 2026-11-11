import type { Vector3 } from "@babylonjs/core";
import type { Level } from "../../shared/level";
import { tunables } from "./tuning";

/**
 * Sounds heard through walls: quieter and muffled. A straight line is drawn from the listener's
 * ears to a placed sound, and every wall, floor and shelf it passes through adds to how blocked the
 * sound is. One wall turns a sound down to `wallGain` and cuts everything above about `wallCutoff`
 * Hz; two walls do that twice. audio.ts asks for every placed sound once a frame and glides to the
 * new value over `glide` seconds, so stepping past a doorframe doesn't jump, except when a sound
 * starts, which takes the right value at once.
 */

/** How much each kind of thing blocks sound, as a share of one wall. */
const BLOCKS: Record<string, number> = {
  wall: 1,
  partition: 1,
  floor: 1,
  plank: 0.3,
  shelf: 0.35,
  furniture: 0.3,
  // Chain-link.
  mesh: 0,
  rail: 0,
  pit: 0,
  stairs: 0,
  // The harbour's houses and clutter, and its paving, which is never between two people on it.
  scenery: 0.5,
  ground: 0,
};
const OPEN_CUTOFF = 20000;
const WALLS = tunables("Sound/Occlusion", {
  wallGain: { value: 0.28, min: 0, max: 1, hint: "How loud a sound is through one wall" },
  wallCutoff: { value: 700, min: 100, max: 8000, step: 10, hint: "Hz above which one wall cuts" },
  minCutoff: { value: 180, min: 20, max: 2000, step: 10, hint: "Hz below which walls never cut" },
  glide: {
    value: 0.08,
    min: 0.005,
    max: 1,
    step: 0.005,
    hint: "Seconds the gain and filter take to get most of the way to a new value",
  },
});
/** A line has to go this many meters through something for it to count, so touching doesn't. */
const THROUGH = 0.05;

interface Blocker {
  min: [number, number, number];
  max: [number, number, number];
  amount: number;
}

let blockers: Blocker[] = [];

/** Occlude sounds by this level's walls, floors and shelves. */
export function occludeIn(level: Level) {
  blockers = [
    ...level.boxes.map((b) => ({
      min: [b.minX, b.y, b.minZ] as [number, number, number],
      max: [b.maxX, b.y + b.height, b.maxZ] as [number, number, number],
      amount: BLOCKS[b.kind] ?? 1,
    })),
    ...level.floors.map((f) => ({
      min: [f.minX, f.y - f.thickness, f.minZ] as [number, number, number],
      max: [f.maxX, f.y, f.maxZ] as [number, number, number],
      amount: BLOCKS[f.kind] ?? 1,
    })),
  ].filter((b) => b.amount > 0);
}

/**
 * How a sound behind `blocked` walls' worth of stuff is heard: its gain, the frequency above which
 * it's cut, and the seconds a change takes to get most of the way there.
 */
export function muffling(blocked: number): { gain: number; cutoff: number; glide: number } {
  return {
    gain: WALLS.wallGain ** blocked,
    cutoff: Math.max(WALLS.minCutoff, OPEN_CUTOFF * (WALLS.wallCutoff / OPEN_CUTOFF) ** blocked),
    glide: WALLS.glide,
  };
}

/** Walls' worth of stuff the straight line from a to b passes through. */
export function blockedBetween(a: Vector3, b: Vector3): number {
  const from = [a.x, a.y, a.z];
  const delta = [b.x - a.x, b.y - a.y, b.z - a.z];
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length < THROUGH) return 0;
  let total = 0;
  for (const box of blockers) {
    // Something the sound or the listener is inside, like a vent set into a wall, doesn't block it.
    if (inside(box, a) || inside(box, b)) continue;
    let enter = 0;
    let leave = 1;
    for (let axis = 0; axis < 3 && enter < leave; axis++) {
      const d = delta[axis];
      if (Math.abs(d) < 1e-9) {
        if (from[axis] < box.min[axis] || from[axis] > box.max[axis]) leave = 0;
        continue;
      }
      const t0 = (box.min[axis] - from[axis]) / d;
      const t1 = (box.max[axis] - from[axis]) / d;
      enter = Math.max(enter, Math.min(t0, t1));
      leave = Math.min(leave, Math.max(t0, t1));
    }
    if ((leave - enter) * length > THROUGH) total += box.amount;
  }
  return total;
}

function inside(box: Blocker, p: Vector3): boolean {
  return (
    p.x >= box.min[0] &&
    p.x <= box.max[0] &&
    p.y >= box.min[1] &&
    p.y <= box.max[1] &&
    p.z >= box.min[2] &&
    p.z <= box.max[2]
  );
}
