import { Color3, type Mesh, MeshBuilder, Quaternion, StandardMaterial } from "@babylonjs/core";
import { CRATE_SIZE } from "../../shared/constants";
import type { World } from "./scene";

/** The visual for one physics crate; the server decides where it is. */
export class CrateView {
  private readonly mesh: Mesh;

  constructor(world: World, id: string) {
    this.mesh = MeshBuilder.CreateBox(id, { size: CRATE_SIZE }, world.scene);
    const mat = new StandardMaterial(`${id}-mat`, world.scene);
    mat.diffuseColor = new Color3(0.62, 0.45, 0.26);
    this.mesh.material = mat;
    this.mesh.receiveShadows = true;
    this.mesh.rotationQuaternion = new Quaternion();
    world.shadows.addShadowCaster(this.mesh);
  }

  setPose(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
    this.mesh.position.set(x, y, z);
    // Interpolated field by field, so no longer exactly unit length.
    this.mesh.rotationQuaternion?.set(qx, qy, qz, qw).normalize();
  }

  dispose() {
    this.mesh.dispose(false, true);
  }
}
