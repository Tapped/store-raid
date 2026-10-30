import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  type Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { ARENA_SIZE } from "../../shared/constants";
import { LEVEL_BOXES } from "../../shared/level";

export interface World {
  scene: Scene;
  /** Slowly circles the arena while nobody has joined. */
  lobbyCamera: ArcRotateCamera;
  shadows: ShadowGenerator;
}

/** Third-person camera behind a player (looking towards +z). Its player's device turns it. */
export function createPlayerCamera(scene: Scene, name: string): ArcRotateCamera {
  const camera = new ArcRotateCamera(name, -Math.PI / 2, 1.0, 16, Vector3.Zero(), scene);
  camera.lowerBetaLimit = 0.3;
  camera.upperBetaLimit = 1.4;
  return camera;
}

/** Static world: lights, ground and the level boxes from shared/level.ts. */
export function createWorld(engine: Engine): World {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.53, 0.72, 0.9, 1);

  const lobbyCamera = new ArcRotateCamera("lobby", -Math.PI / 2, 0.9, 38, Vector3.Zero(), scene);

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.3), scene);
  sun.position = new Vector3(20, 40, -20);
  sun.intensity = 0.8;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.useBlurExponentialShadowMap = true;

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: ARENA_SIZE, height: ARENA_SIZE },
    scene,
  );
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.35, 0.55, 0.3);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
  ground.receiveShadows = true;

  const wallMat = new StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = new Color3(0.6, 0.58, 0.55);
  for (const [i, box] of LEVEL_BOXES.entries()) {
    const mesh = MeshBuilder.CreateBox(
      `box${i}`,
      { width: box.maxX - box.minX, depth: box.maxZ - box.minZ, height: box.height },
      scene,
    );
    mesh.position.set((box.minX + box.maxX) / 2, box.height / 2, (box.minZ + box.maxZ) / 2);
    mesh.material = wallMat;
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
  }

  return { scene, lobbyCamera, shadows };
}
