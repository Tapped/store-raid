import {
  type AbstractEngine,
  ArcRotateCamera,
  Color3,
  Color4,
  CubeTexture,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  type Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { ARENA_SIZE } from "../../shared/constants";
import { DOCK, LEVEL_BOXES } from "../../shared/level";
import { assetUrl } from "./assets";
import {
  addCameraEffects,
  configureShadows,
  SHADOW_MAP_SIZE,
  skyColor,
  surfaceMaterial,
} from "./graphics";
import { storeSurface } from "./store";

const FLOOR_TILE = 6; // meters that one repeat of a surface texture covers
const WALL_TILE = 3;

export interface World {
  scene: Scene;
  /** Slowly circles the arena while nobody has joined. */
  lobbyCamera: ArcRotateCamera;
  shadows: ShadowGenerator;
  /** Stand-ins for the shelf models, removed when those have loaded. */
  plainShelves: Mesh[];
}

/** Third-person camera behind a player (looking towards +z). Its player's device turns it. */
export function createPlayerCamera(scene: Scene, name: string): ArcRotateCamera {
  const camera = new ArcRotateCamera(name, -Math.PI / 2, 1.0, 16, Vector3.Zero(), scene);
  camera.lowerBetaLimit = 0.3;
  camera.upperBetaLimit = 1.4;
  return camera;
}

/** Static world: lights, ground and the level boxes from shared/level.ts. */
export function createWorld(engine: AbstractEngine): World {
  const scene = new Scene(engine);
  scene.clearColor = skyColor(new Color4(0.53, 0.72, 0.9, 1));

  const lobbyCamera = new ArcRotateCamera("lobby", -Math.PI / 2, 0.9, 38, Vector3.Zero(), scene);
  addCameraEffects(scene, lobbyCamera);

  // Image-based lighting: what PBR surfaces reflect and most of their soft ambient light.
  scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
    assetUrl("textures/environment.env"),
    scene,
  );
  scene.environmentIntensity = 0.7;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType =
    ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.2;
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.3), scene);
  sun.position = new Vector3(20, 40, -20);
  sun.intensity = 2.5;
  const shadows = new ShadowGenerator(SHADOW_MAP_SIZE, sun);
  configureShadows(shadows);

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: ARENA_SIZE, height: ARENA_SIZE },
    scene,
  );
  const floorTiles = ARENA_SIZE / FLOOR_TILE;
  ground.material = storeSurface("floor", scene, [floorTiles, floorTiles]);
  ground.receiveShadows = true;

  const dock = MeshBuilder.CreateGround(
    "dock",
    { width: DOCK.maxX - DOCK.minX, height: DOCK.maxZ - DOCK.minZ },
    scene,
  );
  dock.position.set((DOCK.minX + DOCK.maxX) / 2, 0, (DOCK.minZ + DOCK.maxZ) / 2);
  const dockMaterial = storeSurface("dock", scene, [
    (DOCK.maxX - DOCK.minX) / FLOOR_TILE,
    (DOCK.maxZ - DOCK.minZ) / FLOOR_TILE,
  ]);
  dockMaterial.albedoColor = new Color3(1, 0.72, 0.1);
  dock.material = dockMaterial;
  dock.receiveShadows = true;

  const wallMat = storeSurface("wall", scene);
  const plainShelves: Mesh[] = [];
  const shelfMat = surfaceMaterial("shelfMat", scene, new Color3(0.2, 0.3, 0.45), {
    roughness: 0.5,
  });
  for (const [i, box] of LEVEL_BOXES.entries()) {
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
    mesh.position.set((box.minX + box.maxX) / 2, box.height / 2, (box.minZ + box.maxZ) / 2);
    mesh.material = box.kind === "shelf" ? shelfMat : wallMat;
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
    if (box.kind === "shelf") plainShelves.push(mesh);
  }

  return { scene, lobbyCamera, shadows, plainShelves };
}
