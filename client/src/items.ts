import {
  Color3,
  type Material,
  type Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  TransformNode,
} from "@babylonjs/core";
import { ITEM_KINDS, type ItemKind } from "../../shared/constants";
import { loadContainer } from "./assets";
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

/** A material that can glow, as the plain one and glTF's are. */
type Glowing = Material & { emissiveColor: Color3 };
const glows = (m: Material | null): m is Glowing => !!m && "emissiveColor" in m;

/**
 * The visual for one physics item: its model, `models/props/<kind>.glb` (built by
 * scripts/models/), else boxes until it loads or if there's none. The server decides where it is.
 */
export class ItemView {
  private readonly root: TransformNode;
  private materials: Glowing[];
  private readonly ownGlow = new Map<Glowing, Color3>();
  private boxes: Mesh[] = [];
  private delivered = false;
  private disposed = false;

  constructor(world: World, id: string, kind: ItemKind) {
    const { scene } = world;
    this.root = new TransformNode(id, scene);
    this.root.rotationQuaternion = new Quaternion();
    const material = surfaceMaterial(`${id}-mat`, scene, COLORS[kind], { roughness: 0.7 });
    this.materials = [material];

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
      part.material = material;
      part.receiveShadows = true;
      world.shadows.addShadowCaster(part);
      this.boxes.push(part);
    }
    void this.loadModel(world, id, kind);
  }

  private async loadModel(world: World, id: string, kind: ItemKind) {
    const container = await loadContainer(world.scene, `models/props/${kind}.glb`);
    if (!container || this.disposed) return;
    // Models face +z, and an item's front faces whoever carries it, behind it at -z. A glTF root
    // carries its own handedness transform, so turn a parent instead.
    const holder = new TransformNode(`${id}-model`, world.scene);
    holder.parent = this.root;
    holder.rotation.y = Math.PI;
    // Materials are copied, so each item glows on its own when delivered.
    const { rootNodes } = container.instantiateModelsToScene((name) => `${id}-${name}`, true);
    for (const node of rootNodes) node.parent = holder;
    for (const box of this.boxes) box.dispose(false, true);
    this.boxes = [];
    const meshes = holder.getChildMeshes();
    this.materials = [...new Set(meshes.map((m) => m.material))].filter(glows);
    for (const m of this.materials) {
      // Occlusion baked by scripts/models/ darkens the sky light and sun too, not only reflections:
      // in this dim overcast light that's nearly all the light. Imported models' occlusion maps are
      // too strong for that, so they keep the default.
      if (m instanceof PBRMaterial) m.ambientTextureImpactOnAnalyticalLights = 1;
    }
    for (const mesh of meshes) {
      mesh.receiveShadows = true;
      world.shadows.addShadowCaster(mesh);
    }
    this.setDelivered(this.delivered);
  }

  setPose(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
    this.root.position.set(x, y, z);
    // Interpolated field by field, so no longer exactly unit length.
    this.root.rotationQuaternion?.set(qx, qy, qz, qw).normalize();
  }

  setDelivered(delivered: boolean) {
    this.delivered = delivered;
    for (const m of this.materials) {
      // Lit parts, like a TV's LED, get their own glow back afterwards.
      if (!this.ownGlow.has(m)) this.ownGlow.set(m, m.emissiveColor.clone());
      m.emissiveColor = delivered ? DELIVERED_GLOW : (this.ownGlow.get(m) ?? Color3.Black());
    }
  }

  dispose() {
    this.disposed = true;
    this.root.dispose(false, true);
  }
}
