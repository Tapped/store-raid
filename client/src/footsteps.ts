import type { Scene, Vector3 } from "@babylonjs/core";
import { PLAYER_SPEED, RUN_SPEED } from "../../shared/constants";
import { OneShots } from "./audio";
import { tunables } from "./tuning";

const STEPS = [1, 2, 3, 4, 5].map((n) => `audio/sfx/footstep-concrete-${n}.ogg`);

/** Slower than this (m/s) is standing, with no steps. */
const MOVING_SPEED = 0.5;
/**
 * How loud steps are at walking speed, running ones louder and slow ones softer: someone else's
 * from a meter away, and our own; and how fast they come.
 */
export const FOOTSTEPS = tunables("Sound/Footsteps", {
  theirs: { value: 0.15, min: 0, max: 2, hint: "Someone else's, from a meter away" },
  own: { value: 0.15, min: 0, max: 2, hint: "Our own" },
  stepRate: {
    value: 2.2,
    min: 0.5,
    max: 5,
    hint: "Steps per second at walking speed; standing, the gait idles at 0.3 of that",
  },
});

/**
 * How someone's feet go: a phase that turns faster the faster they go, with a foot landing every
 * half turn (every π). The hand bob follows it, so the hands dip as a foot lands.
 */
export class Gait {
  /** Radians; a foot lands at every multiple of π. */
  phase = 0;
  /** How fast they go, from 0 standing to 1 walking and RUN_SPEED / PLAYER_SPEED running. */
  pace = 0;

  /** Once a frame, with how fast they go across the ground. Returns whether a foot landed. */
  update(dt: number, speed: number, grounded: boolean): boolean {
    this.pace = Math.min(RUN_SPEED / PLAYER_SPEED, speed / PLAYER_SPEED);
    const before = Math.floor(this.phase / Math.PI);
    this.phase += dt * FOOTSTEPS.stepRate * Math.PI * (0.3 + this.pace);
    return grounded && speed > MOVING_SPEED && Math.floor(this.phase / Math.PI) !== before;
  }

  /** How loud the step that just landed is, from walking: louder running, softer slow. */
  get volume(): number {
    return 0.4 + 0.6 * this.pace;
  }
}

let theirs: Promise<OneShots | undefined> | undefined;
let ours: Promise<OneShots | undefined> | undefined;

/** Plays a footstep at someone else's feet, heard from there: the concrete steps. */
export function playFootstep(scene: Scene, at: Vector3, volume: number): void {
  theirs ??= OneShots.load(scene, STEPS, 4);
  void theirs.then((steps) => steps?.play(at, volume * FOOTSTEPS.theirs));
}

/** Plays one of our own footsteps: heard straight, as from our own feet, not from a place. */
export function playOwnFootstep(scene: Scene, volume: number): void {
  ours ??= OneShots.load(scene, STEPS, 2, { spatial: false });
  void ours.then((steps) => steps?.play(undefined, volume * FOOTSTEPS.own));
}
