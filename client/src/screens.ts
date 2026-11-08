import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { ITEM_KINDS } from "../../shared/constants";
import { SCREEN_CABINET, type Side } from "../../shared/tiles";
import { loadContainer } from "./assets";
import { type Falloff, Loop } from "./audio";
import { surfaceMaterial } from "./graphics";
import type { World } from "./scene";
import { tunables } from "./tuning";

/**
 * The TVs of `tv` tiles (shared/tiles.ts): the TV item's model on a low cabinet, its screen showing
 * static and droning a glitchy, screechy loop that's heard a few rooms away.
 *
 * The static is coarse on purpose: TAA blends each pixel with what was there before, unless that's
 * out of the range of its neighbours, so grains a few pixels across change sharply where fine ones
 * would smear into grey.
 */
const LOOP = "audio/sfx/tv-static.ogg";
const DRONE = tunables(
  "Sound/TVs",
  { volume: { value: 0.2, min: 0, max: 3, hint: "Each TV's static" } },
  ({ volume }) => {
    for (const sound of drones) sound.volume = volume;
  },
);
const drones: Loop[] = [];
/** Full volume within 2 meters, then half as loud each time the distance doubles, to 30. */
const REACH: Falloff = { near: 2, far: 30, rolloff: 1 };
/** Grains across and down the screen, and how many times a second they change. */
const GRAINS = [96, 60];
const RATE = 24;
const GLOW = new Color3(0.34, 0.36, 0.4);

/** The screen of the TV's model (scripts/models/tv.py): its size, and how far above the middle. */
const [TV_WIDTH, TV_HEIGHT, TV_DEPTH] = ITEM_KINDS.tv.size;
const SCREEN = { width: TV_WIDTH - 0.024, height: TV_HEIGHT - 0.042, up: 0.009 };

const TURN: Record<Side, number> = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 };

export async function addScreens(world: World): Promise<void> {
  const { scene, level, shadows } = world;
  if (level.screens.length === 0) return;

  const noise = staticTexture(world);
  const glass = new StandardMaterial("screen-static", scene);
  glass.disableLighting = true;
  glass.emissiveTexture = noise;
  glass.emissiveColor = GLOW;
  glass.diffuseColor = Color3.Black();
  glass.specularColor = Color3.Black();
  const wood = surfaceMaterial("screen-cabinet", scene, new Color3(0.2, 0.13, 0.08), {
    roughness: 0.6,
  });

  const tv = await loadContainer(scene, "models/props/tv.glb");

  for (const [i, { x, y, z, faces }] of level.screens.entries()) {
    // Built facing +z, then turned to face its way.
    const holder = new TransformNode(`screen-${i}`, scene);
    holder.position.set(x, y, z);
    holder.rotation.y = TURN[faces];

    const cabinet = MeshBuilder.CreateBox(
      `screen-cabinet-${i}`,
      { width: SCREEN_CABINET.width, height: SCREEN_CABINET.height, depth: SCREEN_CABINET.depth },
      scene,
    );
    cabinet.parent = holder;
    cabinet.position.y = SCREEN_CABINET.height / 2;
    cabinet.material = wood;

    const middle = SCREEN_CABINET.height + TV_HEIGHT / 2;
    if (tv) {
      const set = new TransformNode(`screen-tv-${i}`, scene);
      set.parent = holder;
      set.position.y = middle;
      // A glTF root carries its own handedness transform, so move a parent instead.
      for (const root of tv.instantiateModelsToScene().rootNodes) root.parent = set;
    } else {
      const set = MeshBuilder.CreateBox(
        `screen-tv-${i}`,
        { width: TV_WIDTH, height: TV_HEIGHT, depth: TV_DEPTH },
        scene,
      );
      set.parent = holder;
      set.position.y = middle;
      set.material = surfaceMaterial(`screen-tv-${i}`, scene, new Color3(0.03, 0.03, 0.035));
    }

    const face = MeshBuilder.CreatePlane(
      `screen-static-${i}`,
      { width: SCREEN.width, height: SCREEN.height },
      scene,
    );
    face.parent = holder;
    face.position.set(0, middle + SCREEN.up, TV_DEPTH / 2 + 0.002);
    // Planes face -z.
    face.rotation.y = Math.PI;
    face.material = glass;
    face.isPickable = false;

    for (const mesh of holder.getChildMeshes()) {
      if (mesh === face) continue;
      mesh.receiveShadows = true;
      shadows.addShadowCaster(mesh);
    }

    // Each TV somewhere else in the loop, so two of them don't sound like one.
    void Loop.play(scene, LOOP, {
      at: new Vector3(x, y + middle, z),
      volume: DRONE.volume,
      falloff: REACH,
      phase: i * 0.37,
    }).then((drone) => drone && drones.push(drone));
  }
}

/** Grey grains that change `RATE` times a second, with a darker band rolling down through them. */
function staticTexture({ scene }: World): DynamicTexture {
  const [width, height] = GRAINS;
  const texture = new DynamicTexture(
    "screen-static",
    { width, height },
    scene,
    false,
    Texture.NEAREST_SAMPLINGMODE,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(width, height);
  let band = 0;
  let wait = 0;
  const draw = () => {
    const flicker = 0.75 + 0.25 * Math.random();
    for (let row = 0; row < height; row++) {
      // The band: a soft dip in brightness, a fifth of the screen high.
      const from = (row / height - band + 1) % 1;
      const shade = flicker * (1 - 0.45 * Math.exp(-(((from - 0.1) / 0.06) ** 2)));
      for (let col = 0; col < width; col++) {
        const grain = Math.random() ** 1.6 * 255 * shade;
        const at = 4 * (row * width + col);
        image.data[at] = grain;
        image.data[at + 1] = grain;
        image.data[at + 2] = grain;
        image.data[at + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    texture.update(false);
  };
  draw();
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    band = (band + dt * 0.35) % 1;
    wait -= dt;
    if (wait > 0) return;
    wait = 1 / RATE;
    draw();
  });
  return texture;
}
