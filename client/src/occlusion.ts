import type { Scene, StaticSound, Vector3 } from "@babylonjs/core";
import type { Level } from "../../shared/level";
import { tunables } from "./tuning";

/**
 * Sounds heard through walls: quieter and muffled. Each frame a straight line is drawn from the
 * listener's ears to every occluded sound, and every wall, floor and shelf it passes through adds
 * to how blocked the sound is. One wall turns a sound down to `wallGain` and cuts everything above
 * about `wallCutoff` Hz; two walls do that twice. The change glides over `glide` seconds, so stepping
 * past a doorframe doesn't jump, except when a one-shot starts, which takes the right value at once.
 *
 * Babylon's sounds have no filter of their own, so a low-pass filter and a gain go in between the
 * sound's last Web Audio node and the bus it plays into, which are Babylon internals. If they're
 * not where we expect (after a Babylon update), sounds play unoccluded and a warning says so.
 */

/** How much each kind of thing blocks sound, as a share of one wall. */
const BLOCKS: Record<string, number> = {
  wall: 1,
  partition: 1,
  floor: 1,
  plank: 0.3,
  shelf: 0.35,
  rail: 0,
  pit: 0,
  stairs: 0,
  // The harbour's houses and clutter, and its paving, which is never between two people on it.
  scenery: 0.5,
  ground: 0,
};
const OPEN_CUTOFF = 20000;
const WALLS = tunables(
  "Sound/Occlusion",
  {
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
  },
  // Every sound again, at once.
  () => {
    const ear = listening?.activeCamera?.globalPosition;
    if (ear) for (const entry of occluded.values()) apply(entry, ear, true);
  },
);
/** A line has to go this many meters through something for it to count, so touching doesn't. */
const THROUGH = 0.05;

interface Blocker {
  min: [number, number, number];
  max: [number, number, number];
  amount: number;
}

interface Occluded {
  sound: StaticSound;
  context: BaseAudioContext;
  filter: BiquadFilterNode;
  gain: GainNode;
  /** Walls' worth between the sound and the listener, as last set. */
  blocked: number;
}

/** The Babylon internals we wire into: the sound's output node and its bus's input node. */
interface Internals {
  _outNode?: AudioNode | null;
  outBus?: { _inNode?: AudioNode | null } | null;
  engine?: { _audioContext?: BaseAudioContext };
}

let blockers: Blocker[] = [];
let listening: Scene | undefined;
const occluded = new Map<StaticSound, Occluded>();
let warned = false;

/** Occlude sounds by this level's walls, floors and shelves, heard from the scene's active camera. */
export function occludeIn(scene: Scene, level: Level) {
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
  if (listening) return;
  listening = scene;
  scene.onBeforeRenderObservable.add(() => {
    const ear = scene.activeCamera?.globalPosition;
    if (!ear) return;
    for (const entry of occluded.values()) apply(entry, ear, false);
  });
}

/** Have a placed (spatial) sound muffled by whatever is between it and the listener, from now on. */
export function occlude(sound: StaticSound) {
  const internals = sound as unknown as Internals;
  const out = internals._outNode;
  const bus = internals.outBus?._inNode;
  const context = internals.engine?._audioContext;
  if (!out || !bus || !context) {
    if (!warned)
      console.warn("Can't reach Babylon's audio nodes: sounds won't be muffled by walls");
    warned = true;
    return;
  }
  const filter = new BiquadFilterNode(context, {
    type: "lowpass",
    frequency: OPEN_CUTOFF,
    Q: Math.SQRT1_2,
  });
  const gain = new GainNode(context);
  try {
    out.disconnect(bus);
  } catch {
    // Not connected yet: nothing to take apart.
  }
  out.connect(filter).connect(gain).connect(bus);
  occluded.set(sound, { sound, context, filter, gain, blocked: 0 });
  // Put Babylon's own connection back before it takes the sound apart, which expects it.
  const dispose = sound.dispose.bind(sound);
  sound.dispose = () => {
    occluded.delete(sound);
    out.disconnect(filter);
    gain.disconnect();
    out.connect(bus);
    dispose();
  };
}

/** Set a sound's occlusion for where it is now, at once: for a one-shot just moved and started. */
export function snapOcclusion(sound: StaticSound) {
  const entry = occluded.get(sound);
  const ear = listening?.activeCamera?.globalPosition;
  if (entry && ear) apply(entry, ear, true);
}

function apply(entry: Occluded, ear: Vector3, snap: boolean) {
  const blocked = blockedBetween(ear, entry.sound.spatial.position);
  if (!snap && Math.abs(blocked - entry.blocked) < 0.01) return;
  entry.blocked = blocked;
  const gain = WALLS.wallGain ** blocked;
  const cutoff = Math.max(
    WALLS.minCutoff,
    OPEN_CUTOFF * (WALLS.wallCutoff / OPEN_CUTOFF) ** blocked,
  );
  const now = entry.context.currentTime;
  for (const [param, value] of [
    [entry.gain.gain, gain],
    [entry.filter.frequency, cutoff],
  ] as const) {
    if (snap) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    } else {
      param.setTargetAtTime(value, now, WALLS.glide);
    }
  }
}

/** Walls' worth of stuff the straight line from a to b passes through. */
function blockedBetween(a: Vector3, b: Vector3): number {
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
