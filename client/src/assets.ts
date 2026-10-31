import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  type AssetContainer,
  ImportMeshAsync,
  LoadAssetContainerAsync,
  type Scene,
} from "@babylonjs/core";

/**
 * URL of a shared asset, served at /assets/ for every build, so the path is always absolute:
 * assetUrl("models/props/crate.glb") → "/assets/models/props/crate.glb"
 */
export function assetUrl(path: string): string {
  return `/assets/${path.replace(/^\/+/, "")}`;
}

/** Load a .glb from the shared assets, or build a placeholder if it doesn't exist yet. */
export async function loadModel(
  scene: Scene,
  path: string,
  placeholder: () => AbstractMesh,
): Promise<AbstractMesh> {
  try {
    const result = await ImportMeshAsync(assetUrl(path), scene);
    return result.meshes[0];
  } catch {
    return placeholder();
  }
}

const containers = new Map<string, Promise<AssetContainer | undefined>>();

/** Load a .glb once, to copy with instantiateModelsToScene; undefined if it doesn't exist yet. */
export function loadContainer(scene: Scene, path: string): Promise<AssetContainer | undefined> {
  let container = containers.get(path);
  if (!container) {
    container = LoadAssetContainerAsync(assetUrl(path), scene).catch((err) => {
      console.warn(`Could not load ${path}`, err);
      return undefined;
    });
    containers.set(path, container);
  }
  return container;
}
