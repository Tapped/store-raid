import { Color3, type Mesh, MeshBuilder, Quaternion, TransformNode } from "@babylonjs/core";
import { ITEM_KINDS, type ItemKind } from "../../shared/constants";
import { surfaceMaterial } from "./graphics";
import type { World } from "./scene";

const COLORS: Record<ItemKind, Color3> = {
  phone: new Color3(0.85, 0.86, 0.88),
  tv: new Color3(0.06, 0.06, 0.07),
  box: new Color3(0.62, 0.45, 0.26),
  sofa: new Color3(0.2, 0.34, 0.55),
};
const DELIVERED_GLOW = new Color3(0.05, 0.25, 0.08);

/** Sofa parts inside its physics box, as [width, height, depth, x, y, z] around the centre. */
const SOFA_PARTS = [
  [2.4, 0.5, 0.9, 0, -0.2, 0],
  [2.4, 0.4, 0.25, 0, 0.25, 0.325],
  [0.25, 0.4, 0.65, -1.075, 0.25, -0.125],
  [0.25, 0.4, 0.65, 1.075, 0.25, -0.125],
];

/** The visual for one physics item, a box for now; the server decides where it is. */
export class ItemView {
  private readonly root: TransformNode;
  private readonly material;

  constructor(world: World, id: string, kind: ItemKind) {
    const { scene } = world;
    this.root = new TransformNode(id, scene);
    this.root.rotationQuaternion = new Quaternion();
    this.material = surfaceMaterial(`${id}-mat`, scene, COLORS[kind], { roughness: 0.7 });

    const [width, height, depth] = ITEM_KINDS[kind].size;
    const parts = kind === "sofa" ? SOFA_PARTS : [[width, height, depth, 0, 0, 0]];
    for (const [i, [w, h, d, x, y, z]] of parts.entries()) {
      const part: Mesh = MeshBuilder.CreateBox(
        `${id}-${i}`,
        { width: w, height: h, depth: d },
        scene,
      );
      part.parent = this.root;
      part.position.set(x, y, z);
      part.material = this.material;
      part.receiveShadows = true;
      world.shadows.addShadowCaster(part);
    }
  }

  setPose(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
    this.root.position.set(x, y, z);
    // Interpolated field by field, so no longer exactly unit length.
    this.root.rotationQuaternion?.set(qx, qy, qz, qw).normalize();
  }

  setDelivered(delivered: boolean) {
    this.material.emissiveColor = delivered ? DELIVERED_GLOW : Color3.Black();
  }

  dispose() {
    this.root.dispose(false, true);
  }
}
