import { TransformNode } from "@babylonjs/core";
import { loadContainer } from "./assets";
import type { World } from "./scene";

/** Scenery near the dock: drawn only, so it has no collision and players walk through it. */
const PROPS: { model: string; x: number; y?: number; z: number; turn?: number }[] = [
  { model: "wood-crate", x: -9, z: 14.5, turn: 0.3 },
  { model: "miners-oil-lamp", x: -9, y: 1.74, z: 14.5 },
  { model: "cardboard", x: -6.5, z: 14, turn: -0.5 },
  { model: "cardboard", x: 8, z: 15, turn: 1.1 },
  { model: "wood-crate", x: 10.5, z: 15.5, turn: -0.2 },
];

/** Place the props. One whose model is missing is left out. */
export async function addProps(world: World): Promise<void> {
  for (const { model, x, y = 0, z, turn = 0 } of PROPS) {
    const container = await loadContainer(world.scene, `models/props/${model}.glb`);
    if (!container) continue;
    // A glTF root carries its own handedness transform, so move and turn a parent instead.
    const holder = new TransformNode(model, world.scene);
    holder.position.set(x, y, z);
    holder.rotation.y = turn;
    for (const root of container.instantiateModelsToScene().rootNodes) {
      root.parent = holder;
    }
    for (const mesh of holder.getChildMeshes()) {
      mesh.receiveShadows = true;
      world.shadows.addShadowCaster(mesh);
    }
  }
}
