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
  Vector4,
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
import { addTerrain, SURFACE_TILE as FLOOR_TILE } from "./terrain";

const WALL_TILE = 3;
const LOBBY_TARGET = new Vector3(91.5, 3, -45); // on the harbour street between the rows of street lights
const DUSK_REFLECTION = new Color3(0.7, 0.72, 0.8);

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

/** First-person camera, in the player's eyes. `LocalPlayer` moves and turns it; it reads no input itself. */
export function createPlayerCamera(scene: Scene, name: string): FreeCamera {
  const camera = new FreeCamera(name, Vector3.Zero(), scene);
  camera.inputs.clear();
  camera.fov = 1.1; // vertical, in radians
  camera.minZ = 0.05; // close enough not to cut into what's held, or a wall right in front
  return camera;
}

/** Static world: lights, ground and the level's boxes from shared/level.ts. */
export function createWorld(engine: AbstractEngine, level: Level): World {
  const scene = new Scene(engine);
  scene.clearColor = HORIZON.toColor4().toLinearSpace();
  addSky(scene);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.003;
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
  scene.environmentIntensity = 0.28;
  // That image is a sunny day, so cool what every surface takes from it. A material's constructor
  // announces it before setting its own fields, hence the wait for it to finish.
  scene.onNewMaterialAddedObservable.add((material) => {
    if (!(material instanceof PBRMaterial)) return;
    queueMicrotask(() => material.reflectionColor.copyFrom(DUSK_REFLECTION));
  });
  gradePicture(scene.imageProcessingConfiguration);

  // Overcast dusk: most light comes from the whole sky, and the sun only leaves faint shadows.
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.18;
  hemi.diffuse = new Color3(0.72, 0.76, 0.86);
  hemi.groundColor = new Color3(0.12, 0.12, 0.15);
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.3), scene);
  sun.position = new Vector3(20, 40, -20);
  sun.intensity = 0.8;
  sun.diffuse = new Color3(0.78, 0.84, 1);
  const shadows = new ShadowGenerator(SHADOW_MAP_SIZE, sun);
  configureShadows(shadows);
  shadows.setDarkness(0.35);

  const floorMat = storeSurface("floor", scene);
  // Dark and damp, like wet asphalt: the sky glances off it.
  floorMat.albedoColor = new Color3(0.32, 0.33, 0.36);
  floorMat.roughness = 0.6;
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
    dock.material = dockMaterial;
    dock.receiveShadows = true;
  }

  const wallMat = storeSurface("wall", scene);
  wallMat.albedoColor = new Color3(0.85, 0.82, 0.82);
  const plainShelves: Mesh[] = [];
  const shelfMat = surfaceMaterial("shelfMat", scene, new Color3(0.2, 0.3, 0.45), {
    roughness: 0.5,
  });
  for (const [i, box] of level.boxes.entries()) {
    // Railings, pits and stairs are drawn by addTerrain.
    if (box.kind !== "wall" && box.kind !== "shelf") continue;
    const width = box.maxX - box.minX;
    const depth = box.maxZ - box.minZ;
    const tiled = (u: number, v: number) => new Vector4(0, 0, u / WALL_TILE, v / WALL_TILE);
    const mesh = MeshBuilder.CreateBox(
      `box${i}`,
      {
        width,
        depth,
        height: box.height,
        wrap: true,
        // Back, front, right, left, top, bottom, so the bricks stay the same size on every face.
        faceUV: [
          tiled(width, box.height),
          tiled(width, box.height),
          tiled(depth, box.height),
          tiled(depth, box.height),
          tiled(width, depth),
          tiled(width, depth),
        ],
      },
      scene,
    );
    mesh.position.set((box.minX + box.maxX) / 2, box.y + box.height / 2, (box.minZ + box.maxZ) / 2);
    mesh.material = box.kind === "shelf" ? shelfMat : wallMat;
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
    if (box.kind === "shelf") plainShelves.push(mesh);
  }

  return { scene, level, lobbyCamera, shadows, plainShelves };
}
