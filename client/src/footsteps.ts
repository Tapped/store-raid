import type { Scene, Vector3 } from "@babylonjs/core";
import { PLAYER_SPEED, RUN_SPEED } from "../../shared/constants";
import { OneShots } from "./audio";

const STEPS = [1, 2, 3, 4, 5].map((n) => `audio/sfx/footstep-concrete-${n}.ogg`);

/** Steps per second at walking speed; standing still the gait idles at 0.3 of that. */
const STEP_RATE = 2.2;
/** Slower than this (m/s) is standing, with no steps. */
const MOVING_SPEED = 0.5;
/** How loud a step is at walking speed; running steps are louder, slow ones softer. */
const STEP_VOLUME = 0.5;

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
    this.phase += dt * STEP_RATE * Math.PI * (0.3 + this.pace);
    return grounded && speed > MOVING_SPEED && Math.floor(this.phase / Math.PI) !== before;
  }

  /** How loud the step that just landed is. */
  get volume(): number {
    return STEP_VOLUME * (0.4 + 0.6 * this.pace);
  }
}

let sounds: Promise<OneShots | undefined> | undefined;

/** Plays a footstep at someone's feet: the concrete steps, shared by everyone on the page. */
export function playFootstep(scene: Scene, at: Vector3, volume: number): void {
  sounds ??= OneShots.load(scene, STEPS, 4);
  void sounds.then((steps) => steps?.play(at, volume));
}
