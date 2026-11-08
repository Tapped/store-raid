import { Vector3 } from "@babylonjs/core";
import { type Falloff, Loop } from "./audio";
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
    vent: { value: 0.5, min: 0, max: 3, hint: "The vent above the entrance" },
  },
  ({ bed, vent }) => {
    if (sounds?.bed) sounds.bed.volume = bed;
    if (sounds?.vent) sounds.vent.volume = vent;
  },
);
let sounds: { bed?: Loop; vent?: Loop } | undefined;
/** Full volume within 4 meters of the vent, then half as loud each time the distance doubles, to 60. */
const VENT_REACH: Falloff = { near: 4, far: 60, rolloff: 1 };

export async function addAmbience(world: World): Promise<void> {
  const { scene, level } = world;
  const { x, y, z } = level.entrance;
  const [bed, vent] = await Promise.all([
    Loop.play(scene, LOOP, { volume: VOLUME.bed }),
    Loop.play(scene, LOOP, {
      at: new Vector3(x, y, z),
      volume: VOLUME.vent,
      falloff: VENT_REACH,
      phase: 0.5,
    }),
  ]);
  sounds = { bed, vent };
}
