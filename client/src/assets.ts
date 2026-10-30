import "@babylonjs/loaders/glTF";
import { type AbstractMesh, ImportMeshAsync, type Scene } from "@babylonjs/core";

/**
 * URL of a shared asset in /srv/assets on the server, served at /assets/ for every build, so the
 * path is always absolute: assetUrl("models/props/crate.glb") → "/assets/models/props/crate.glb"
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
