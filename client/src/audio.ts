import {
  type AudioEngineV2,
  CreateAudioEngineAsync,
  CreateSoundAsync,
  CreateSoundBufferAsync,
  type IStaticSoundOptions,
  type Scene,
  type StaticSound,
  type StaticSoundBuffer,
  type Vector3,
} from "@babylonjs/core";
import { assetUrl } from "./assets";

/**
 * Sound, through Babylon's audio engine: one for the page, heard from wherever the scene's active
 * camera is (the lobby camera, then the player's eyes). Browsers keep it silent until the player
 * clicks or presses a key, and sounds played before then are dropped.
 */
let engine: Promise<AudioEngineV2> | undefined;

export function audioEngine(scene: Scene): Promise<AudioEngineV2> {
  engine ??= (async () => {
    const audio = await CreateAudioEngineAsync({
      disableDefaultUI: true,
      resumeOnInteraction: true,
    });
    const follow = () => audio.listener.attach(scene.activeCamera);
    follow();
    scene.onActiveCameraChanged.add(follow);
    return audio;
  })();
  return engine;
}

const buffers = new Map<string, Promise<StaticSoundBuffer | undefined>>();

/** A sound file under assets/, decoded once and shared; undefined if it's missing or won't decode. */
export function soundBuffer(scene: Scene, path: string): Promise<StaticSoundBuffer | undefined> {
  let buffer = buffers.get(path);
  if (!buffer) {
    buffer = audioEngine(scene).then((audio) =>
      CreateSoundBufferAsync(assetUrl(path), {}, audio).catch((err) => {
        console.warn(`No sound at ${path}`, err);
        return undefined;
      }),
    );
    buffers.set(path, buffer);
  }
  return buffer;
}

/** How sounds in the world fade with distance: full volume within 1 m, gone past 30 m. */
export const SPATIAL: Partial<IStaticSoundOptions> = {
  spatialEnabled: true,
  spatialPanningModel: "HRTF",
  spatialDistanceModel: "inverse",
  spatialMinDistance: 1,
  spatialMaxDistance: 30,
  spatialRolloffFactor: 1.2,
};

/**
 * Short sounds played at places in the world, such as footsteps: each play picks one of the
 * variants at random, at a slightly different pitch and volume, so repeats don't sound the same.
 * Each variant has a few voices, so a sound can start while the last one is still ringing.
 */
export class OneShots {
  private constructor(private variants: { voices: StaticSound[]; next: number }[]) {}

  static async load(scene: Scene, paths: string[], voices = 3): Promise<OneShots | undefined> {
    const audio = await audioEngine(scene);
    const loaded = (await Promise.all(paths.map((p) => soundBuffer(scene, p)))).filter((b) => !!b);
    if (!loaded.length) return undefined;
    const variants = await Promise.all(
      loaded.map(async (buffer) => ({
        voices: await Promise.all(
          Array.from({ length: voices }, (_, i) =>
            CreateSoundAsync(`${buffer.name}-${i}`, buffer, { ...SPATIAL, maxInstances: 1 }, audio),
          ),
        ),
        next: 0,
      })),
    );
    return new OneShots(variants);
  }

  /** Play one at `at`, at about `volume`, its pitch varied by up to `pitch` either way (0.1 is 10%). */
  play(at: Vector3, volume: number, pitch = 0.1) {
    const variant = this.variants[Math.floor(Math.random() * this.variants.length)];
    const voice = variant.voices[variant.next];
    variant.next = (variant.next + 1) % variant.voices.length;
    voice.spatial.position = at.clone();
    voice.volume = volume * (0.75 + 0.25 * Math.random());
    voice.playbackRate = 1 + pitch * (2 * Math.random() - 1);
    voice.play();
  }

  dispose() {
    for (const variant of this.variants) for (const voice of variant.voices) voice.dispose();
  }
}
