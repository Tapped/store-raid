import {
  type AnimationGroup,
  Color3,
  DynamicTexture,
  type InstantiatedEntries,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { PLAYER_RADIUS } from "../../shared/constants";
import { loadContainer } from "./assets";
import { surfaceMaterial } from "./graphics";
import type { World } from "./scene";

const HEIGHT = 1.8;
const CHARACTER = "models/characters/ch17.glb";

/** Slower than this (m/s) counts as standing still. */
const MOVING_SPEED = 0.5;
/** How quickly the measured speed follows the real one, per second. */
const SPEED_SMOOTHING = 10;
/** How quickly the character turns to face where it's walking, per second. */
const TURN_SMOOTHING = 12;
/** Playback rate of the walk clips: players move faster than the clips were recorded walking. */
const WALK_RATE = 2;
/** The walk clip's frame where the feet are closest together: the standing pose, as there's no idle clip. */
const STAND_FRAME = 2;
const BLEND_SPEED = 0.08;

type Pose = "stand" | "walk" | "carry-stand" | "carry-walk";

/**
 * The visual for one player: the character model, or a coloured capsule until it has loaded or if
 * the asset is missing, with a floating name tag. The tag is a billboard in the scene, not
 * screen-space UI, so it faces the camera and sits right in every split pane.
 */
export class PlayerView {
  private readonly root: TransformNode;
  /** Turns to face the walking direction; the name tag stays outside it. */
  private readonly body: TransformNode;
  private readonly capsule: Mesh;
  private readonly tag: Mesh;
  private model: InstantiatedEntries | undefined;
  private pose: Pose | undefined;
  private lastX: number | undefined;
  private lastZ = 0;
  private speed = 0;
  private disposed = false;

  constructor(
    private readonly world: World,
    name: string,
    color: string,
  ) {
    const scene: Scene = world.scene;
    this.root = new TransformNode(`player-${name}`, scene);
    this.body = new TransformNode(`player-${name}-facing`, scene);
    this.body.parent = this.root;

    this.capsule = MeshBuilder.CreateCapsule(
      `player-${name}-body`,
      { radius: PLAYER_RADIUS, height: HEIGHT },
      scene,
    );
    this.capsule.parent = this.root;
    this.capsule.position.y = HEIGHT / 2;
    this.capsule.material = surfaceMaterial(
      `player-${name}-mat`,
      scene,
      Color3.FromHexString(color),
      { roughness: 0.35 },
    );
    world.shadows.addShadowCaster(this.capsule);

    this.tag = MeshBuilder.CreatePlane(`player-${name}-tag`, { width: 2, height: 0.5 }, scene);
    this.tag.parent = this.root;
    this.tag.position.y = HEIGHT + 0.5;
    this.tag.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    this.tag.isPickable = false;
    const texture = new DynamicTexture(`player-${name}-text`, { width: 256, height: 64 }, scene);
    texture.hasAlpha = true;
    // In the player's colour, since the model itself looks the same for everyone.
    texture.drawText(name, null, 48, "bold 44px system-ui, sans-serif", color, "transparent");
    const tagMat = new StandardMaterial(`player-${name}-tagmat`, scene);
    tagMat.diffuseTexture = texture;
    tagMat.emissiveColor = Color3.White();
    tagMat.disableLighting = true;
    tagMat.useAlphaFromDiffuseTexture = true;
    this.tag.material = tagMat;

    void this.loadCharacter(name);
  }

  private async loadCharacter(name: string) {
    const container = await loadContainer(this.world.scene, CHARACTER);
    if (!container || this.disposed) return;

    // Clones, not instances: every player needs their own skeleton to animate.
    const model = container.instantiateModelsToScene((source) => `${name}-${source}`, false, {
      doNotInstantiate: true,
    });
    for (const node of model.rootNodes) {
      node.parent = this.body;
      for (const mesh of node.getChildMeshes()) {
        mesh.receiveShadows = true;
        this.world.shadows.addShadowCaster(mesh);
      }
    }
    for (const group of model.animationGroups) {
      group.stop();
      group.enableBlending = true;
      group.blendingSpeed = BLEND_SPEED;
    }
    this.model = model;
    this.capsule.setEnabled(false);
  }

  private clip(name: string): AnimationGroup | undefined {
    return this.model?.animationGroups.find((group) => group.name.endsWith(name));
  }

  private setPose(pose: Pose) {
    if (pose === this.pose || !this.model) return;
    this.pose = pose;
    for (const group of this.model.animationGroups) group.stop();
    if (pose === "walk") this.clip("-walk")?.start(true, WALK_RATE);
    else if (pose === "carry-walk") this.clip("carry-walk")?.start(true, WALK_RATE);
    else if (pose === "carry-stand") this.clip("carry-stop")?.start(false);
    // Looping a sliver of a frame holds the pose; a clip that ends would cut the blend into it short.
    else this.clip("-walk")?.start(true, 1, STAND_FRAME, STAND_FRAME + 0.01);
  }

  /** Once per rendered frame, wherever the player is now, however that was worked out. */
  update(x: number, z: number, carrying: boolean, dt: number) {
    const dx = x - (this.lastX ?? x);
    const dz = z - this.lastZ;
    this.lastX = x;
    this.lastZ = z;
    this.root.position.x = x;
    this.root.position.z = z;
    if (dt <= 0) return;

    const blend = 1 - Math.exp(-SPEED_SMOOTHING * dt);
    this.speed += (Math.hypot(dx, dz) / dt - this.speed) * blend;
    const moving = this.speed > MOVING_SPEED;

    if (moving && (dx !== 0 || dz !== 0)) {
      // The shortest way round, so nobody spins the long way when crossing ±180°.
      const target = Math.atan2(dx, dz);
      const turn = Math.atan2(
        Math.sin(target - this.body.rotation.y),
        Math.cos(target - this.body.rotation.y),
      );
      this.body.rotation.y += turn * (1 - Math.exp(-TURN_SMOOTHING * dt));
    }

    if (carrying) this.setPose(moving ? "carry-walk" : "carry-stand");
    else this.setPose(moving ? "walk" : "stand");
  }

  dispose() {
    this.disposed = true;
    // First, and on its own: the root's dispose below would take the shared materials with it.
    this.model?.dispose();
    this.root.dispose(false, true);
  }
}
