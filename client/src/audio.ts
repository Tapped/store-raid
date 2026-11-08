import { type Scene, type TransformNode, Vector3 } from "@babylonjs/core";
import { assetUrl } from "./assets";
import { blockedBetween, muffling } from "./occlusion";
import { tunables } from "./tuning";

/**
 * Sound, on the Web Audio API: one audio context for the page, heard from wherever the scene's
 * active camera is (the lobby camera, then the player's eyes).
 *
 * Every sound playing has its own small graph. One placed in the world goes
 *
 *   source → volume → muffle (low-pass) → walls (gain) → panner → master → speakers
 *
 * The panner places it and fades it with distance; the muffle and walls make it quieter and duller
 * for every wall, floor and shelf between it and the listener (occlusion.ts). Once a frame, before
 * the scene renders, the listener moves to the camera and every placed sound to where it is now,
 * and its occlusion is worked out again. A sound starts with all of that already set for where it
 * is, so a short one, like a footstep, is heard from the right place from its first sample.
 *
 * One heard straight, not from a place (our own footsteps, the ambience's bed), goes
 * source → volume → master, and neither fades nor pans.
 *
 * Browsers keep the context suspended until the player clicks or presses a key. Loops started
 * before then begin once it runs; one-shots played before then are dropped, not saved up.
 *
 * Babylon's scene is left-handed (z forward) and Web Audio right-handed, so z is mirrored on the
 * way in: a point (x, y, z) in the scene is (x, y, -z) to the audio graph.
 */

const MIX = tunables(
  "Sound/Mix",
  { master: { value: 1, min: 0, max: 2, hint: "Everything's volume" } },
  ({ master }) => {
    if (engine) engine.master.gain.value = master;
  },
);

/**
 * How a placed sound fades with distance: full volume within `near` meters, then by `rolloff` as
 * the distance grows (Web Audio's inverse model), and no quieter past `far`. Read every frame, so
 * changing one changes every sound that follows it at once.
 */
export interface Falloff {
  near: number;
  far: number;
  rolloff: number;
}

/** How placed sounds fade unless they say otherwise. */
export const FALLOFF: Falloff = tunables("Sound/Falloff", {
  near: {
    value: 1,
    min: 0.1,
    max: 10,
    hint: "Meters within which a placed sound is at full volume",
  },
  far: { value: 30, min: 2, max: 100, step: 1, hint: "Meters past which it gets no quieter" },
  rolloff: { value: 2.48, min: 0, max: 5, hint: "How fast it fades with distance" },
});

/** Seconds the listener and placed sounds take to follow a move, so they glide between frames. */
const POSITION_GLIDE = 0.02;
const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

/** Where a placed sound is heard from: a fixed point, or a node it follows as it moves. */
export type Place = Vector3 | TransformNode;

function whereIs(place: Place): Vector3 {
  return place instanceof Vector3 ? place : place.getAbsolutePosition();
}

/** Set an AudioParam at once (`glide` undefined), or glide it there over about `glide` seconds. */
function setParam(param: AudioParam, value: number, now: number, glide?: number) {
  if (glide === undefined) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
  } else {
    param.setTargetAtTime(value, now, glide);
  }
}

/** The placed part of a sound's graph: volume → muffle → walls → panner → master. */
class Emitter {
  /** Where the sound goes in, and its volume. */
  readonly input: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly walls: GainNode;
  private readonly panner: PannerNode;
  /** The muffling last set, so an unchanged one isn't scheduled again every frame. */
  private gain = Number.NaN;
  private cutoff = Number.NaN;

  constructor(
    private readonly audio: AudioEngine,
    private readonly place: Place,
    private readonly falloff: Falloff,
  ) {
    const { context } = audio;
    this.input = new GainNode(context);
    this.filter = new BiquadFilterNode(context, { type: "lowpass", Q: Math.SQRT1_2 });
    this.walls = new GainNode(context);
    this.panner = new PannerNode(context, { panningModel: "HRTF", distanceModel: "inverse" });
    this.input.connect(this.filter).connect(this.walls).connect(this.panner).connect(audio.master);
    this.update(true);
    audio.emitters.add(this);
  }

  /**
   * Move to where it is now, fade as its falloff says, and muffle by what's in the way: at once
   * when `snap`, as a sound starts, else gliding there.
   */
  update(snap: boolean) {
    const { context, ear } = this.audio;
    const now = context.currentTime;
    const at = whereIs(this.place);
    const glide = snap ? undefined : POSITION_GLIDE;
    setParam(this.panner.positionX, at.x, now, glide);
    setParam(this.panner.positionY, at.y, now, glide);
    setParam(this.panner.positionZ, -at.z, now, glide);
    this.panner.refDistance = this.falloff.near;
    this.panner.maxDistance = this.falloff.far;
    this.panner.rolloffFactor = this.falloff.rolloff;

    const muffle = muffling(ear ? blockedBetween(ear, at) : 0);
    if (!snap && muffle.gain === this.gain && muffle.cutoff === this.cutoff) return;
    this.gain = muffle.gain;
    this.cutoff = muffle.cutoff;
    const wallGlide = snap ? undefined : muffle.glide;
    setParam(this.walls.gain, muffle.gain, now, wallGlide);
    setParam(this.filter.frequency, muffle.cutoff, now, wallGlide);
  }

  dispose() {
    this.audio.emitters.delete(this);
    this.input.disconnect();
    this.panner.disconnect();
  }
}

/** The page's audio: its context, the master volume, and the placed sounds to keep up to date. */
class AudioEngine {
  readonly context = new AudioContext();
  readonly master = new GainNode(this.context, { gain: MIX.master });
  readonly emitters = new Set<Emitter>();
  /** Where the listener is in the scene; undefined until there's a camera. */
  ear: Vector3 | undefined;

  constructor(private readonly scene: Scene) {
    this.master.connect(this.context.destination);
    this.resumeOnInteraction();
    scene.onBeforeRenderObservable.add(() => this.update());
  }

  /** Whether the browser lets the page make sound yet. */
  get running(): boolean {
    return this.context.state === "running";
  }

  private resumeOnInteraction() {
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const resume = () => {
      void this.context.resume().then(() => {
        if (!this.running) return;
        for (const event of events) document.removeEventListener(event, resume, true);
      });
    };
    for (const event of events) document.addEventListener(event, resume, true);
  }

  private update() {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    this.ear = camera.globalPosition;
    const forward = camera.getDirection(FORWARD);
    const up = camera.getDirection(UP);
    const { listener, currentTime: now } = this.context;
    const values: [AudioParam, number][] = [
      [listener.positionX, this.ear.x],
      [listener.positionY, this.ear.y],
      [listener.positionZ, -this.ear.z],
      [listener.forwardX, forward.x],
      [listener.forwardY, forward.y],
      [listener.forwardZ, -forward.z],
      [listener.upX, up.x],
      [listener.upY, up.y],
      [listener.upZ, -up.z],
    ];
    for (const [param, value] of values) setParam(param, value, now, POSITION_GLIDE);
    for (const emitter of this.emitters) emitter.update(false);
  }
}

let engine: AudioEngine | undefined;

function audioEngine(scene: Scene): AudioEngine {
  engine ??= new AudioEngine(scene);
  return engine;
}

const buffers = new Map<string, Promise<AudioBuffer | undefined>>();

/** A sound file under assets/, decoded once and shared; undefined if it's missing or won't decode. */
export function soundBuffer(scene: Scene, path: string): Promise<AudioBuffer | undefined> {
  let buffer = buffers.get(path);
  if (!buffer) {
    const { context } = audioEngine(scene);
    buffer = (async () => {
      try {
        const response = await fetch(assetUrl(path));
        // Vite answers a missing file with its HTML page.
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || type.startsWith("text/html")) throw new Error(`${response.status}`);
        return await context.decodeAudioData(await response.arrayBuffer());
      } catch (err) {
        console.warn(`No sound at ${path}`, err);
        return undefined;
      }
    })();
    buffers.set(path, buffer);
  }
  return buffer;
}

/** How a sound is played: how loud, and where from. */
export interface PlayOptions {
  volume?: number;
  /** Heard from here, fading with distance and muffled by walls; else heard straight. */
  at?: Place;
  /** How it fades with distance, if placed: by default the shared falloff settings. */
  falloff?: Falloff;
}

interface Playing {
  source: AudioBufferSourceNode;
  /** Its volume. */
  volume: GainNode;
  stop(): void;
}

/** One playing of a buffer, through a graph of its own that's taken apart when it ends. */
function playBuffer(
  audio: AudioEngine,
  buffer: AudioBuffer,
  { volume = 1, at, falloff = FALLOFF }: PlayOptions,
  { rate = 1, loop = false, offset = 0 } = {},
): Playing {
  const { context } = audio;
  const source = new AudioBufferSourceNode(context, { buffer, loop, playbackRate: rate });
  // A point is copied, so moving the vector it came from doesn't move the sound.
  const place = at instanceof Vector3 ? at.clone() : at;
  const emitter = place ? new Emitter(audio, place, falloff) : undefined;
  const gain = emitter?.input ?? new GainNode(context);
  gain.gain.value = volume;
  if (!emitter) gain.connect(audio.master);
  source.connect(gain);
  const done = () => {
    source.disconnect();
    if (emitter) emitter.dispose();
    else gain.disconnect();
  };
  source.onended = done;
  source.start(context.currentTime, offset);
  return {
    source,
    volume: gain,
    stop: () => {
      source.onended = null;
      source.stop();
      done();
    },
  };
}

/**
 * Short sounds played now and then, such as footsteps: each play picks one of the variants at
 * random, at a slightly different pitch and volume, so repeats don't sound the same. Every play is
 * a sound of its own, so they overlap freely, and each stays where it was played, or follows the
 * node it was played at.
 */
export class OneShots {
  private readonly playing = new Set<Playing>();

  private constructor(
    private readonly audio: AudioEngine,
    private readonly variants: AudioBuffer[],
  ) {}

  /** The sounds at these paths; undefined if none of them load. */
  static async load(scene: Scene, paths: string[]): Promise<OneShots | undefined> {
    const audio = audioEngine(scene);
    const loaded = (await Promise.all(paths.map((p) => soundBuffer(scene, p)))).filter((b) => !!b);
    return loaded.length ? new OneShots(audio, loaded) : undefined;
  }

  /** The longest variant, in seconds at normal speed. */
  get duration(): number {
    return Math.max(...this.variants.map((b) => b.duration));
  }

  /**
   * Play one at about `volume`, from `at` (heard straight if not given), its pitch varied by up
   * to `pitch` either way (0.1 is 10%) around `rate`. Dropped if the browser doesn't let the page
   * make sound yet.
   */
  play({ volume = 1, at, falloff }: PlayOptions, { pitch = 0.1, rate = 1 } = {}): void {
    if (!this.audio.running) return;
    const buffer = this.variants[Math.floor(Math.random() * this.variants.length)];
    const sound = playBuffer(
      this.audio,
      buffer,
      { volume: volume * (0.75 + 0.25 * Math.random()), at, falloff },
      { rate: rate * (1 + pitch * (2 * Math.random() - 1)) },
    );
    this.playing.add(sound);
    sound.source.addEventListener("ended", () => this.playing.delete(sound));
  }

  /** Stop everything still playing. */
  dispose() {
    for (const sound of this.playing) sound.stop();
    this.playing.clear();
  }
}

/** A sound that loops until it's disposed, such as a TV's static. */
export class Loop {
  private constructor(private readonly sound: Playing) {}

  /**
   * Start looping the sound at `path`, `phase` of the way through it (0 to 1), so copies of one
   * loop don't line up. If the browser doesn't let the page make sound yet, it begins once it
   * does. Undefined if the file is missing.
   */
  static async play(
    scene: Scene,
    path: string,
    { phase = 0, ...options }: PlayOptions & { phase?: number } = {},
  ): Promise<Loop | undefined> {
    const buffer = await soundBuffer(scene, path);
    if (!buffer) return undefined;
    const offset = (((phase % 1) + 1) % 1) * buffer.duration;
    return new Loop(playBuffer(audioEngine(scene), buffer, options, { loop: true, offset }));
  }

  set volume(volume: number) {
    this.sound.volume.gain.value = volume;
  }

  dispose() {
    this.sound.stop();
  }
}
