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
import { PLAYER_HEIGHT, PLAYER_RADIUS, PLAYER_SPEED } from "../../shared/constants";
import { loadContainer } from "./assets";
import { Gait, playFootstep } from "./footsteps";
import { surfaceMaterial } from "./graphics";
import type { World } from "./scene";
import { tunables } from "./tuning";

const CHARACTER = "models/characters/ch35.glb";

/** Slower than this (m/s) counts as standing still. */
const MOVING_SPEED = 0.5;
/** How quickly the measured speed follows the real one, per second. */
const SPEED_SMOOTHING = 10;
/** How quickly the character turns to face where its player looks, per second. */
const TURN_SMOOTHING = 12;
/**
 * Playback rate of the walk clips per m/s, so the feet keep up with the ground: at 6 m/s they play
 * twice as fast as recorded. WALK_RATE is where they start, at walking speed.
 */
const RATE_PER_SPEED = 1 / 3;
const WALK_RATE = PLAYER_SPEED * RATE_PER_SPEED;
/** The walk clip's frame where the feet are closest together: the standing pose, as there's no idle clip. */
const STAND_FRAME = 2;
const BLEND_SPEED = 0.08;

/**
 * Sitting on a seat in the truck. The seated clips sit behind the player's feet (see
 * scripts/characterClips.ts), so standing up ends where they stand; sitting down is the stand-up
 * played backwards. The eye's height and how far behind the feet it is are the seated clips' own.
 */
export const SITTING = tunables("Feel/Sitting", {
  standUpTime: {
    value: 1.4,
    min: 0.5,
    max: 2.5,
    hint: "Seconds getting up from a seat takes, during which the player can't move",
  },
  sitDownTime: { value: 1.2, min: 0.4, max: 2.5, hint: "Seconds sitting down on a seat takes" },
  eyeHeight: {
    value: 1.22,
    min: 0.9,
    max: 1.5,
    hint: "Meters the eyes are above the floor, seated",
  },
  eyeBack: {
    value: 0.3,
    min: 0,
    max: 0.6,
    hint: "Meters the eyes are behind the feet, seated: over the seat",
  },
});

type Pose = "stand" | "walk" | "carry-stand" | "carry-walk" | "sit" | "sit-down" | "stand-up";

/** The seated idles, one per player, chosen by name. */
const SEATED_IDLES = ["sit-idle", "sit-idle-2"];

/**
 * The visual for one player: the character model, or a coloured capsule until it has loaded or if
 * the asset is missing, with a floating name tag. The tag is a billboard in the scene, not
 * screen-space UI, so it always faces the camera.
 */
export class PlayerView {
  private readonly root: TransformNode;
  /** Turns to face the walking direction; the name tag stays outside it. */
  private readonly body: TransformNode;
  private readonly capsule: Mesh;
  private readonly tag: Mesh;
  private model: InstantiatedEntries | undefined;
  /** The model's animation groups by the clip's own name, without the instance's prefix. */
  private readonly clips = new Map<string, AnimationGroup>();
  private pose: Pose | undefined;
  private lastX: number | undefined;
  private lastZ = 0;
  private speed = 0;
  private readonly gait = new Gait();
  private disposed = false;
  /** Which seated idle this player sits in. */
  private readonly idle: string;
  /** The yaw of the seat they sit on, or last sat on while they get up. */
  private seatYaw = 0;
  /** Whether they sat last frame, and whether there has been a frame yet. */
  private seated: boolean | undefined;
  /** Seconds left of sitting down or getting up. */
  private shifting = 0;

  constructor(
    private readonly world: World,
    name: string,
    color: string,
  ) {
    const scene: Scene = world.scene;
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    this.idle = SEATED_IDLES[Math.abs(hash) % SEATED_IDLES.length];
    this.root = new TransformNode(`player-${name}`, scene);
    this.body = new TransformNode(`player-${name}-facing`, scene);
    this.body.parent = this.root;

    this.capsule = MeshBuilder.CreateCapsule(
      `player-${name}-body`,
      { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT },
      scene,
    );
    this.capsule.parent = this.root;
    this.capsule.position.y = PLAYER_HEIGHT / 2;
    this.capsule.material = surfaceMaterial(
      `player-${name}-mat`,
      scene,
      Color3.FromHexString(color),
      { roughness: 0.35 },
    );
    world.shadows.addShadowCaster(this.capsule);

    this.tag = MeshBuilder.CreatePlane(`player-${name}-tag`, { width: 1, height: 0.25 }, scene);
    this.tag.parent = this.root;
    this.tag.position.y = PLAYER_HEIGHT + 0.3;
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
      this.clips.set(group.name.slice(name.length + 1), group);
    }
    this.model = model;
    this.capsule.setEnabled(false);
  }

  private clip(name: string): AnimationGroup | undefined {
    return this.clips.get(name);
  }

  private setPose(pose: Pose) {
    if (pose === this.pose || !this.model) return;
    this.pose = pose;
    for (const group of this.model.animationGroups) group.stop();
    const up = this.clip("sit-to-stand");
    if (pose === "sit") this.clip(this.idle)?.start(true);
    else if (pose === "sit-down" && up) {
      up.start(false, clipSeconds(up) / SITTING.sitDownTime, up.to, up.from);
    } else if (pose === "stand-up" && up) up.start(false, clipSeconds(up) / SITTING.standUpTime);
    else if (pose === "walk") this.clip("walk")?.start(true, WALK_RATE);
    else if (pose === "carry-walk") this.clip("carry-walk")?.start(true, WALK_RATE);
    else if (pose === "carry-stand") this.clip("carry-stop")?.start(false);
    // Looping a sliver of a frame holds the pose; a clip that ends would cut the blend into it short.
    else this.clip("walk")?.start(true, 1, STAND_FRAME, STAND_FRAME + 0.01);
  }

  /**
   * Once per rendered frame, wherever the player is now and wherever they look, and whether they're
   * on the ground, where their feet make a sound. Sitting on a seat, `seatYaw` is the way it faces.
   */
  update(
    x: number,
    y: number,
    z: number,
    yaw: number,
    carrying: boolean,
    grounded: boolean,
    seatYaw: number | undefined,
    dt: number,
  ) {
    const dx = x - (this.lastX ?? x);
    const dz = z - this.lastZ;
    this.lastX = x;
    this.lastZ = z;
    this.root.position.set(x, y, z);
    if (dt <= 0) return;

    const blend = 1 - Math.exp(-SPEED_SMOOTHING * dt);
    this.speed += (Math.hypot(dx, dz) / dt - this.speed) * blend;
    const moving = this.speed > MOVING_SPEED;

    // Sitting down as they take a seat, but already seated when we first see them; getting up as
    // they leave it.
    const seated = seatYaw !== undefined;
    if (seated) this.seatYaw = seatYaw;
    if (this.seated !== undefined && seated !== this.seated) {
      this.shifting = seated ? SITTING.sitDownTime : SITTING.standUpTime;
    }
    this.seated = seated;
    this.shifting = Math.max(0, this.shifting - dt);
    const onSeat = seated || this.shifting > 0;

    if (!onSeat && this.gait.update(dt, this.speed, grounded)) {
      playFootstep(this.world.scene, this.root.position, this.gait.volume);
    }

    // Facing where they look, the shortest way round, so nobody spins the long way across ±180°;
    // on a seat, across the truck.
    const facing = onSeat ? this.seatYaw : yaw;
    const turn = Math.atan2(
      Math.sin(facing - this.body.rotation.y),
      Math.cos(facing - this.body.rotation.y),
    );
    this.body.rotation.y += turn * (1 - Math.exp(-TURN_SMOOTHING * dt));

    if (seated) this.setPose(this.shifting > 0 ? "sit-down" : "sit");
    else if (this.shifting > 0) this.setPose("stand-up");
    else if (carrying) this.setPose(moving ? "carry-walk" : "carry-stand");
    else this.setPose(moving ? "walk" : "stand");

    // The walk clips keep pace with however fast they go, never slower than half a walk.
    if (moving && (this.pose === "walk" || this.pose === "carry-walk")) {
      const rate = Math.max(WALK_RATE / 2, this.speed * RATE_PER_SPEED);
      for (const group of this.model?.animationGroups ?? [])
        if (group.isPlaying) group.speedRatio = rate;
    }
  }

  /** Whether they're on a seat, sitting down or getting up: the eyes are lower. */
  get sitting(): boolean {
    return this.seated === true || this.shifting > 0;
  }

  /** Hidden while we watch through this player's eyes, so the camera isn't inside their head. */
  setVisible(visible: boolean) {
    if (this.root.isEnabled(false) !== visible) this.root.setEnabled(visible);
  }

  dispose() {
    this.disposed = true;
    // First, and on its own: the root's dispose below would take the shared materials with it.
    this.model?.dispose();
    this.root.dispose(false, true);
  }
}

/** How long a clip lasts as recorded, in seconds. */
function clipSeconds(group: AnimationGroup): number {
  const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
  return (group.to - group.from) / fps;
}
