import {
  Color3,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { PLAYER_RADIUS } from "../../shared/constants";
import { surfaceMaterial } from "./graphics";
import type { World } from "./scene";

const HEIGHT = 1.8;

/**
 * The visual for one player: a coloured capsule with a floating name tag. The tag is a billboard
 * in the scene, not screen-space UI, so it faces the camera and sits right in every split pane.
 */
export class PlayerView {
  private readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly tag: Mesh;

  constructor(world: World, name: string, color: string) {
    const scene: Scene = world.scene;
    this.root = new TransformNode(`player-${name}`, scene);

    this.body = MeshBuilder.CreateCapsule(
      `player-${name}-body`,
      { radius: PLAYER_RADIUS, height: HEIGHT },
      scene,
    );
    this.body.parent = this.root;
    this.body.position.y = HEIGHT / 2;
    this.body.material = surfaceMaterial(`player-${name}-mat`, scene, Color3.FromHexString(color), {
      roughness: 0.35,
    });
    world.shadows.addShadowCaster(this.body);

    this.tag = MeshBuilder.CreatePlane(`player-${name}-tag`, { width: 2, height: 0.5 }, scene);
    this.tag.parent = this.root;
    this.tag.position.y = HEIGHT + 0.5;
    this.tag.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    this.tag.isPickable = false;
    const texture = new DynamicTexture(`player-${name}-text`, { width: 256, height: 64 }, scene);
    texture.hasAlpha = true;
    texture.drawText(name, null, 48, "bold 44px system-ui, sans-serif", "white", "transparent");
    const tagMat = new StandardMaterial(`player-${name}-tagmat`, scene);
    tagMat.diffuseTexture = texture;
    tagMat.emissiveColor = Color3.White();
    tagMat.disableLighting = true;
    tagMat.useAlphaFromDiffuseTexture = true;
    this.tag.material = tagMat;
  }

  setPosition(x: number, z: number) {
    this.root.position.x = x;
    this.root.position.z = z;
  }

  dispose() {
    this.root.dispose(false, true);
  }
}
