import {
  type AbstractEngine,
  ArcRotateCamera,
  Color3,
  CubeTexture,
  DirectionalLight,
  FreeCamera,
  HemisphericLight,
  type Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  Vector3,
} from "@babylonjs/core";
import type { Level } from "../../shared/level";
import { assetUrl } from "./assets";
import {
  addCameraEffects,
  configureShadows,
  gradePicture,
  SHADOW_MAP_SIZE,
  surfaceMaterial,
} from "./graphics";
import { addSky, HORIZON } from "./sky";
import { storeSurface } from "./store";
import { addTerrain, SURFACE_TILE as FLOOR_TILE, worldBox } from "./terrain";
import { tunables } from "./tuning";
import { addSurfaceVariation } from "./variation";

const WALL_TILE = 3;
const LOBBY_TARGET = new Vector3(91.5, 3, -45); // on the harbour street between the rows of street lights
const DUSK_REFLECTION = new Color3(0.7, 0.72, 0.8);
/** Lights a PBR surface takes at once: the sky and sun, and flashlights. */
const MAX_LIGHTS = 6;

/**
 * Which lights a surface keeps when more shine on it than it can take: the scene's own first, then
 * our own flashlight, then everyone else's. Higher goes first.
 */
export const LIGHT_PRIORITY = { scene: 10, own: 5, other: 1 };

export interface World {
  scene: Scene;
  /** The building this page plays in, from `?level=`. */
  level: Level;
  /** Slowly circles a spot in the harbour while nobody has joined. */
  lobbyCamera: ArcRotateCamera;
  shadows: ShadowGenerator;
  /** Stand-ins for the shelf models, removed when those have loaded. */
  plainShelves: Mesh[];
}

const VIEW = tunables(
  "Rendering/Camera",
  { fov: { value: 1.1, min: 0.4, max: 2, hint: "Vertical field of view, in radians" } },
  ({ fov }) => {
    for (const camera of playerCameras) camera.fov = fov;
  },
);
const playerCameras = new Set<FreeCamera>();

/** First-person camera, in the player's eyes. `LocalPlayer` moves and turns it; it reads no input itself. */
export function createPlayerCamera(scene: Scene, name: string): FreeCamera {
  const camera = new FreeCamera(name, Vector3.Zero(), scene);
  camera.inputs.clear();
  camera.fov = VIEW.fov;
  playerCameras.add(camera);
  camera.onDisposeObservable.addOnce(() => playerCameras.delete(camera));
  camera.minZ = 0.05; // close enough not to cut into what's held, or a wall right in front
  return camera;
}

/** Static world: lights, ground and the level's boxes from shared/level.ts. */
export function createWorld(engine: AbstractEngine, level: Level): World {
  const scene = new Scene(engine);
  scene.clearColor = HORIZON.toColor4().toLinearSpace();
  addSky(scene);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = HORIZON;

  const lobbyCamera = level.roof
    ? new ArcRotateCamera("lobby", -Math.PI / 2, 1.2, 9, new Vector3(0, 2, 0), scene)
    : new ArcRotateCamera("lobby", -Math.PI / 2, 1.45, 7, LOBBY_TARGET, scene);
  addCameraEffects(scene, lobbyCamera);

  // Image-based lighting: what PBR surfaces reflect and most of their soft ambient light.
  scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
    assetUrl("textures/environment.env"),
    scene,
  );
  // That image is a sunny day, so cool what every surface takes from it. A material's constructor
  // announces it before setting its own fields, hence the wait for it to finish.
  scene.onNewMaterialAddedObservable.add((material) => {
    if (!(material instanceof PBRMaterial)) return;
    queueMicrotask(() => {
      material.reflectionColor.copyFrom(DUSK_REFLECTION);
      material.maxSimultaneousLights = MAX_LIGHTS;
    });
  });
  gradePicture(scene.imageProcessingConfiguration);

  // Overcast dusk: most light comes from the whole sky, and the sun only leaves faint shadows.
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.diffuse = new Color3(0.72, 0.76, 0.86);
  hemi.groundColor = new Color3(0.12, 0.12, 0.15);
  hemi.renderPriority = LIGHT_PRIORITY.scene;
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.3), scene);
  sun.position = new Vector3(20, 40, -20);
  sun.diffuse = new Color3(0.78, 0.84, 1);
  sun.renderPriority = LIGHT_PRIORITY.scene;
  const shadows = new ShadowGenerator(SHADOW_MAP_SIZE, sun);
  configureShadows(shadows);
  // Overcast dusk outdoors: how much light comes from the sky, the sun and the reflections. Halls
  // light themselves: see addPlayground.
  if (!level.roof) {
    const outdoors = tunables(
      "Rendering/Outdoor light",
      {
        hemi: { value: 0.18, min: 0, max: 2, hint: "Light from the whole sky" },
        sun: { value: 0.8, min: 0, max: 3, hint: "The one light that casts shadows" },
        environment: {
          value: 0.28,
          min: 0,
          max: 2,
          hint: "What surfaces reflect, and soft ambient",
        },
        fog: { value: 0.003, min: 0, max: 0.05, step: 0.0001 },
      },
      (values) => light(values),
    );
    const light = (values: typeof outdoors) => {
      hemi.intensity = values.hemi;
      sun.intensity = values.sun;
      scene.environmentIntensity = values.environment;
      scene.fogDensity = values.fog;
    };
    light(outdoors);
  }
  const shadowSettings = tunables(
    "Rendering/Shadows",
    { darkness: { value: 0.35, min: 0, max: 1, hint: "0 is black shadows, 1 none" } },
    ({ darkness }) => shadows.setDarkness(darkness),
  );
  shadows.setDarkness(shadowSettings.darkness);

  const floorMat = storeSurface("floor", scene);
  // Dark and damp, like wet asphalt: the sky glances off it.
  floorMat.albedoColor = new Color3(0.32, 0.33, 0.36);
  floorMat.roughness = 0.6;
  addSurfaceVariation(floorMat, { sampling: { kind: "hex" }, brightness: 0.2 });
  addTerrain(scene, level, shadows, floorMat);

  if (level.dock) {
    const { minX, maxX, minZ, maxZ } = level.dock;
    const dock = MeshBuilder.CreateGround(
      "dock",
      { width: maxX - minX, height: maxZ - minZ },
      scene,
    );
    // A hair above the floor, which covers the dock in the playground.
    dock.position.set((minX + maxX) / 2, 0.002, (minZ + maxZ) / 2);
    const dockMaterial = storeSurface("dock", scene, [
      (maxX - minX) / FLOOR_TILE,
      (maxZ - minZ) / FLOOR_TILE,
    ]);
    dockMaterial.albedoColor = new Color3(0.85, 0.58, 0.08);
    addSurfaceVariation(dockMaterial, { sampling: { kind: "hex", cells: 3 }, patch: 4 });
    dock.material = dockMaterial;
    dock.receiveShadows = true;
  }

  const wallMat = storeSurface("wall", scene);
  wallMat.albedoColor = new Color3(0.85, 0.82, 0.82);
  // The brick texture has 20 courses.
  addSurfaceVariation(wallMat, { sampling: { kind: "courses", rows: 20 }, grime: 0.35 });
  const plainShelves: Mesh[] = [];
  // Painted plaster between rooms, so a building's inside doesn't look like its outside.
  const plaster = surfaceMaterial("plaster", scene, new Color3(0.72, 0.7, 0.66), {
    roughness: 0.9,
  });
  const shelfMat = surfaceMaterial("shelfMat", scene, new Color3(0.2, 0.3, 0.45), {
    roughness: 0.5,
  });
  for (const [i, box] of level.boxes.entries()) {
    // Railings, pits and stairs are drawn by addTerrain.
    if (box.kind !== "wall" && box.kind !== "partition" && box.kind !== "shelf") continue;
    // World-space texture coordinates: walls built of many boxes carry on one pattern.
    const mesh = worldBox(
      `box${i}`,
      new Vector3(box.minX, box.y, box.minZ),
      new Vector3(box.maxX, box.y + box.height, box.maxZ),
      scene,
      WALL_TILE,
    );
    mesh.material = { shelf: shelfMat, partition: plaster, wall: wallMat }[box.kind];
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
    if (box.kind === "shelf") plainShelves.push(mesh);
  }

  return { scene, level, lobbyCamera, shadows, plainShelves };
}
