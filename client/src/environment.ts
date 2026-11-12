import { Color3, Vector3 } from "@babylonjs/core";
import type { Environment as EnvironmentName } from "../../shared/level";
import { roadX } from "../../shared/village";
import { addHarbour } from "./harbour";
import { addProps } from "./props";
import type { World } from "./scene";
import { HARBOUR_SKY, type SkyColours } from "./sky";
import { addVillage, addVillageAmbience } from "./village";

/**
 * What surrounds a level outdoors, as the level declares it (`Level.environment`): how its sky,
 * fog and light look, where the lobby camera circles, and what draws it. createWorld sets up the
 * look; main.ts calls `draw` once the world exists. Levels with none (the playground hall, generated
 * buildings) keep the harbour's sky and light up their own insides.
 */
export interface Environment {
  sky: SkyColours;
  /**
   * The fog's colour in sRGB, 0–255, where it isn't the sky's haze: darker than the sky, the land
   * fades into silhouettes against it.
   */
  fog?: readonly [number, number, number];
  /**
   * The outdoor light, tunable in the panel under `group`: the whole sky's light, the one light
   * that casts shadows (the sun, or a moon behind cloud), reflections and soft ambient, and fog.
   */
  light: { group: string; hemi: number; sun: number; environment: number; fog: number };
  /** The sky light's colour from above and below, and the sun's, where they differ from dusk's. */
  colours?: { sky: Color3; ground: Color3; sun: Color3 };
  /** The spot the lobby camera circles while nobody has joined. */
  lobby: { target: Vector3; beta: number; radius: number };
  /** Draws it; settles once it has loaded. */
  draw(world: World): Promise<unknown>;
  /** Its own ambience, in place of the vent's hum at the level's entrance (ambience.ts). */
  ambience?(world: World): Promise<unknown>;
}

export const ENVIRONMENTS: Record<EnvironmentName, Environment> = {
  // The store's harbour: an overcast dusk, street lights, and the store's crates by its dock.
  harbour: {
    sky: HARBOUR_SKY,
    light: {
      group: "Rendering/Outdoor light",
      hemi: 0.18,
      sun: 0.8,
      environment: 0.28,
      fog: 0.003,
    },
    // On the harbour street between the rows of street lights.
    lobby: { target: new Vector3(91.5, 3, -45), beta: 1.45, radius: 7 },
    draw: (world) => Promise.all([addProps(world), addHarbour(world.scene)]),
  },
  // A deep valley on an overcast autumn night: no lamps for miles, a little moonlight through the
  // cloud, and mist that swallows the valley sides.
  village: {
    sky: { cloudDark: [36, 41, 52], cloudLight: [76, 82, 96], haze: [56, 62, 74] },
    fog: [30, 34, 43],
    light: {
      group: "Rendering/Village light",
      hemi: 0.28,
      sun: 0.45,
      environment: 0.2,
      fog: 0.0042,
    },
    colours: {
      sky: new Color3(0.62, 0.7, 0.88),
      ground: new Color3(0.08, 0.09, 0.1),
      sun: new Color3(0.7, 0.8, 1),
    },
    // On the track at the first farm, looking about the valley.
    lobby: { target: new Vector3(roadX(-60), 3, -60), beta: 1.42, radius: 8 },
    draw: (world) => addVillage(world),
    ambience: (world) => addVillageAmbience(world),
  },
};
