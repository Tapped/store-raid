import { CreateSoundAsync, type StaticSound, Vector3 } from "@babylonjs/core";
import { audioEngine, SPATIAL, soundBuffer } from "./audio";
import { occlude } from "./occlusion";
import type { World } from "./scene";
import { tunables } from "./tuning";

/**
 * The level's ambience: a dark machinery room tone with wind through a vent, on a loop. It's heard
 * quietly everywhere, and loudly from a vent above the entrance, so players can find the way out
 * by ear. Walls and floors between the player and the vent muffle it (occlusion.ts).
 *
 * That's two copies of the one loop: a bed that isn't placed anywhere, and the vent, placed at
 * `level.entrance`. The vent starts half the loop in, so the two never line up, which would comb-
 * filter the tones into a hollow, phasey sound wherever the two are about as loud.
 */
const LOOP = "audio/sfx/vent-hum.ogg";
const VOLUME = tunables(
  "Sound/Ambience",
  {
    bed: { value: 0.12, min: 0, max: 1, hint: "The room tone heard everywhere" },
    vent: { value: 1, min: 0, max: 3, hint: "The vent above the entrance" },
  },
  ({ bed, vent }) => {
    if (!sounds) return;
    sounds.bed.volume = bed;
    sounds.vent.volume = vent;
  },
);
let sounds: { bed: StaticSound; vent: StaticSound } | undefined;
/** Full volume within this many meters of the vent, then half as loud each time the distance doubles. */
const VENT_NEAR = 4;
const VENT_FAR = 60;

export async function addAmbience(world: World): Promise<void> {
  const { scene, level } = world;
  const [audio, buffer] = await Promise.all([audioEngine(scene), soundBuffer(scene, LOOP)]);
  if (!buffer) return;
  const [bed, vent] = [
    await CreateSoundAsync("ambience-bed", buffer, { loop: true, volume: VOLUME.bed }, audio),
    await CreateSoundAsync(
      "ambience-vent",
      buffer,
      {
        ...SPATIAL,
        loop: true,
        volume: VOLUME.vent,
        spatialMinDistance: VENT_NEAR,
        spatialMaxDistance: VENT_FAR,
        spatialRolloffFactor: 1,
        spatialPosition: new Vector3(level.entrance.x, level.entrance.y, level.entrance.z),
      },
      audio,
    ),
  ];
  occlude(vent);
  sounds = { bed, vent };
  // Looping sounds played before the browser lets the page make sound start once it does.
  bed.play();
  vent.play({ startOffset: buffer.duration / 2 });
}
