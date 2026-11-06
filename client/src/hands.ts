import {
  type Camera,
  type InstantiatedEntries,
  Matrix,
  Quaternion,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { HANDS, type Hand, ITEM_KINDS, type ItemKind } from "../../shared/constants";
import { loadContainer } from "./assets";
import type { Gait } from "./footsteps";
import type { World } from "./scene";
import { tunables } from "./tuning";

/** Models built by scripts/models/hand.py: a right hand, mirrored for the left. */
const OPEN = "models/characters/hand.glb";
const GRIP = "models/characters/hand-grip.glb";

/**
 * Hand poses in camera space for the right hand (x right, y up, z ahead, meters from the eye), the
 * left one mirrored: where the wrist is, and its pitch, yaw and roll in radians.
 */
export const POSES = {
  rest: { at: new Vector3(0.21, -0.2, 0.38), turn: new Vector3(-0.12, -0.12, 0.65) },
  hold: { at: new Vector3(0.26, -0.25, 0.42), turn: new Vector3(-0.1, -0.3, -0.25) },
  /** A flashlight, held up and pointed where the player looks: the wrist's roll, as it aims itself. */
  aim: { at: new Vector3(0.2, -0.19, 0.36), roll: -0.1 },
  /** Where the player points a flashlight: this far ahead of their eyes. */
  aimAt: new Vector3(0, 0, 8),
  /** Where the right shoulder is: on a big thing, the forearm points from here to the grip. */
  shoulder: new Vector3(0.2, -0.35, -0.05),
  /** Where a one-handed thing sits beside the gripping hand, from the wrist: palm side is -x. */
  inHand: new Vector3(-0.1, 0.015, 0.07),
  /** Where a flashlight's middle sits in the fist, from the wrist. */
  inFist: new Vector3(-0.035, 0.0, 0.125),
};
const REST = POSES.rest;
const HOLD = POSES.hold;
const SHOULDER = POSES.shoulder;
const IN_HAND = POSES.inHand;
const AIM = POSES.aim;
/** Wrist back from the point it grips, along the item's surface, in meters. */
const GRIP_BACK = 0.07;
/**
 * On a big thing carried alone, how far the wrist sits in front of its near face, in meters, and
 * out from its side. The eye is between its sides, so its near face hides anything along them
 * behind it: the hands go on its front edges, where the player can see them.
 */
const EDGE_BACK = 0.08;
const EDGE_OUT = 0.02;
/** How far the hands on a big thing's front edges turn in to wrap them, in radians. */
const EDGE_WRAP = 0.25;
/**
 * How far a wrist can be from its shoulder, in meters: a little more than an arm, so a grip that's
 * out of reach for a moment, on a thing swinging round, doesn't stretch the sleeve.
 */
const ARM_REACH = 0.8;

/** The rendering group drawn after the world, with the depth cleared. */
const OVER_WORLD = 1;
/** How far a grab's reach goes. */
const REACH = new Vector3(0, 0.06, 0.2);
/** How the hands move with the player. */
const MOTION = tunables("Feel/Hands", {
  follow: {
    value: 16,
    min: 1,
    max: 60,
    hint: "How quickly the hands follow their pose, per second",
  },
  reachTime: { value: 0.28, min: 0.05, max: 1, hint: "Seconds a grab's reach takes" },
  bobAcross: {
    value: 0.012,
    min: 0,
    max: 0.08,
    step: 0.001,
    hint: "Walking bob across, in meters at walking speed; running bobs more",
  },
  bobUp: {
    value: 0.016,
    min: 0,
    max: 0.08,
    step: 0.001,
    hint: "Walking bob up and down, in meters",
  },
  sway: {
    value: 0.012,
    min: 0,
    max: 0.08,
    step: 0.001,
    hint: "How far the hands lag behind turning the head, in meters per radian per second",
  },
  maxSway: { value: 0.05, min: 0, max: 0.2, step: 0.001, hint: "The most they lag, in meters" },
});

/** What a hand holds: the item's id and kind, and the node its view is drawn with. */
export interface Held {
  id: string;
  kind: ItemKind;
  node: TransformNode;
}

interface HandParts {
  /** Follows the pose, in camera space. */
  pose: TransformNode;
  open?: InstantiatedEntries;
  grip?: InstantiatedEntries;
  /** Where a one-handed thing goes: an item's view moves here while it's in this hand. */
  anchor: TransformNode;
  /** Time since this hand's button was pressed, for the reach. */
  reach: number;
}

/**
 * The player's own hands, drawn in front of their camera: resting low at the sides, reaching on a
 * grab, holding a one-handed thing up in view, and gripping both sides of a big one. All of it is
 * look and feel on this screen only: the server decides what's held and where it is.
 */
export class FirstPersonHands {
  private readonly hands: Record<Hand, HandParts>;
  private readonly sway = new Vector3();
  private lastYaw: number | undefined;
  private lastPitch = 0;
  private disposed = false;

  constructor(
    world: World,
    private readonly camera: Camera,
  ) {
    const make = (hand: Hand): HandParts => {
      const pose = new TransformNode(`hand-${hand}`, world.scene);
      pose.parent = camera;
      pose.rotationQuaternion = new Quaternion();
      const anchor = new TransformNode(`hand-${hand}-anchor`, world.scene);
      anchor.parent = pose;
      // Held level by its edge, like a flat box: its long side (x) along the fingers, the rest
      // reaching in beside the palm.
      anchor.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(
        new Vector3(0, 0, 1),
        new Vector3(0, 1, 0),
        new Vector3(-1, 0, 0),
      );
      const parts: HandParts = { pose, anchor, reach: MOTION.reachTime };
      this.place(hand, parts, REST.at, REST.turn, 1);
      return parts;
    };
    this.hands = { left: make("left"), right: make("right") };
    void this.load(world);
  }

  private async load(world: World) {
    const [open, grip] = await Promise.all([
      loadContainer(world.scene, OPEN),
      loadContainer(world.scene, GRIP),
    ]);
    if (this.disposed) return;
    for (const hand of HANDS) {
      const parts = this.hands[hand];
      for (const [key, container] of [
        ["open", open],
        ["grip", grip],
      ] as const) {
        if (!container) continue;
        // Mirrored for the left hand, on a holder: a glTF root carries its own handedness transform.
        const holder = new TransformNode(`hand-${hand}-${key}`, world.scene);
        holder.parent = parts.pose;
        if (hand === "left") holder.scaling.x = -1;
        const entries = container.instantiateModelsToScene((n) => `hand-${hand}-${key}-${n}`);
        for (const node of entries.rootNodes) node.parent = holder;
        for (const mesh of holder.getChildMeshes()) mesh.receiveShadows = true;
        parts[key] = entries;
      }
    }
  }

  /** A hand's button was pressed: it reaches forward, whatever happens on the server. */
  reach(hand: Hand) {
    this.hands[hand].reach = 0;
  }

  /**
   * One frame. `held` is what each hand holds, `gait` how the player's feet go, and
   * `yaw`/`pitch` where they look, for the sway.
   */
  update(dt: number, held: Record<Hand, Held | undefined>, gait: Gait) {
    const { rotation } = this.camera as Camera & { rotation: Vector3 };
    const turnRate = this.lastYaw === undefined ? 0 : angleDelta(rotation.y, this.lastYaw) / dt;
    const pitchRate = (rotation.x - this.lastPitch) / dt;
    this.lastYaw = rotation.y;
    this.lastPitch = rotation.x;
    const swayTarget = new Vector3(
      clamp(-turnRate * MOTION.sway, MOTION.maxSway),
      clamp(pitchRate * MOTION.sway, MOTION.maxSway),
      0,
    );
    Vector3.LerpToRef(this.sway, swayTarget, 1 - Math.exp(-10 * dt), this.sway);

    // Lowest as a foot lands, at every multiple of π.
    const { phase, pace } = gait;
    const bob = new Vector3(
      Math.sin(phase) * MOTION.bobAcross * pace,
      -Math.abs(Math.cos(phase)) * MOTION.bobUp * pace,
      0,
    );

    const both = held.left && held.left.id === held.right?.id ? held.left : undefined;
    const grips = both ? this.gripPoints(both) : undefined;
    const follow = 1 - Math.exp(-MOTION.follow * dt);

    for (const hand of HANDS) {
      const parts = this.hands[hand];
      const thing = held[hand];
      const side = hand === "left" ? -1 : 1;
      let at: Vector3;
      let turn: Vector3;
      if (grips) {
        const shoulder = new Vector3(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
        at = withinReach(grips[hand], shoulder);
        turn = grips.heading
          ? new Vector3(grips.heading.x + 0.15, grips.heading.y * side - EDGE_WRAP, 0)
          : reachTurn(at, shoulder, side);
      } else if (thing?.kind === "flashlight") {
        at = AIM.at.clone();
        turn = reachTurn(POSES.aimAt, at, 1);
        turn.z = AIM.roll;
      } else if (thing) {
        at = HOLD.at.clone();
        turn = HOLD.turn;
      } else {
        at = REST.at.clone();
        turn = REST.turn;
      }
      if (!grips) at.x *= side;

      const inHand = thing?.kind === "flashlight" ? POSES.inFist : IN_HAND;
      parts.anchor.position.set(inHand.x * side, inHand.y, inHand.z);
      parts.reach += dt;
      const t = Math.min(1, parts.reach / MOTION.reachTime);
      at.addInPlace(REACH.scale(Math.sin(Math.PI * t)));
      at.addInPlace(this.sway).addInPlace(new Vector3(bob.x * side, bob.y, 0));
      this.place(hand, parts, at, turn, follow);

      const gripping = !!thing;
      setVisible(parts.open, !gripping || !parts.grip);
      setVisible(parts.grip, gripping);
      // Drawn over the world, so they don't go through a wall or shelf in front of the player,
      // except on a big thing, where they have to sit against it.
      for (const mesh of parts.pose.getChildMeshes())
        mesh.renderingGroupId = grips ? 0 : OVER_WORLD;
    }
  }

  /**
   * The node a one-handed thing in this hand is drawn at, or undefined: the item's view moves there
   * on this screen, while everyone else sees it where the server put it.
   */
  anchorFor(hand: Hand, held: Held | undefined): TransformNode | undefined {
    return held && ITEM_KINDS[held.kind].hands === 1 ? this.hands[hand].anchor : undefined;
  }

  /**
   * Where each wrist goes on a big thing held in both hands, in camera space, and on one carried
   * alone, the way its sides run ahead, as a pitch and yaw in `heading`.
   */
  private gripPoints(held: Held): Record<Hand, Vector3> & { heading?: Vector3 } {
    const [width, height, depth] = ITEM_KINDS[held.kind].size;
    const toCamera = Matrix.Invert(this.camera.computeWorldMatrix());
    const item = held.node.computeWorldMatrix(true).multiply(toCamera);
    const at = (x: number, y: number, z: number) =>
      Vector3.TransformCoordinates(new Vector3(x, y, z), item);
    const centre = at(0, 0, 0);
    const axisX = at(1, 0, 0).subtract(centre);
    const axisZ = at(0, 0, 1).subtract(centre);
    const down = centre.subtract(at(0, 1, 0));

    if (ITEM_KINDS[held.kind].carriers > 1) {
      // Carried with someone else: both hands under our end of its length.
      const end = axisX.scale(
        centre.add(axisX).length() < centre.subtract(axisX).length() ? 1 : -1,
      );
      const base = centre.add(end.scale(width / 2 - 0.15)).add(down.scale(height / 2));
      const points = [-1, 1].map((s) => base.add(axisZ.scale(s * (depth / 2 - GRIP_BACK))));
      // Wrists sit back from where the fingers close.
      for (const p of points) p.z -= GRIP_BACK;
      return byHand(points);
    }
    // Alone: on the front edges of its sides, the near end's, a little below the middle. Which way
    // it's turned doesn't matter.
    const acrossIsX = Math.abs(axisX.x) >= Math.abs(axisZ.x);
    const across = acrossIsX ? axisX : axisZ;
    const halfAcross = (acrossIsX ? width : depth) / 2;
    let ahead = acrossIsX ? axisZ : axisX;
    const halfAhead = (acrossIsX ? depth : width) / 2;
    if (ahead.z < 0) ahead = ahead.negate();
    const near = centre.subtract(ahead.scale(halfAhead + EDGE_BACK)).add(down.scale(height * 0.15));
    const points = [-1, 1].map((s) => near.add(across.scale(s * (halfAcross + EDGE_OUT))));
    return {
      ...byHand(points),
      heading: new Vector3(
        Math.atan2(-ahead.y, Math.hypot(ahead.x, ahead.z)),
        Math.atan2(ahead.x, ahead.z),
        0,
      ),
    };
  }

  private place(hand: Hand, parts: HandParts, at: Vector3, turn: Vector3, follow: number) {
    const side = hand === "left" ? -1 : 1;
    const target = Quaternion.FromEulerAngles(turn.x, turn.y * side, turn.z * side);
    Vector3.LerpToRef(parts.pose.position, at, follow, parts.pose.position);
    const q = parts.pose.rotationQuaternion as Quaternion;
    Quaternion.SlerpToRef(q, target, follow, q);
  }

  dispose() {
    this.disposed = true;
    for (const hand of HANDS) this.hands[hand].pose.dispose(false, true);
  }
}

/**
 * The turn (in the right hand's terms, as place() mirrors it) that points a forearm from the
 * shoulder to the wrist, palm in.
 */
function reachTurn(wrist: Vector3, shoulder: Vector3, side: number): Vector3 {
  const d = wrist.subtract(shoulder);
  return new Vector3(Math.atan2(-d.y, Math.hypot(d.x, d.z)), Math.atan2(d.x, d.z) * side, 0);
}

/** The wrist, brought in towards the shoulder if it's further than an arm reaches. */
function withinReach(wrist: Vector3, shoulder: Vector3): Vector3 {
  const arm = wrist.subtract(shoulder);
  const length = arm.length();
  return length > ARM_REACH ? shoulder.add(arm.scale(ARM_REACH / length)) : wrist;
}

/** Two points, the left one first. */
function byHand([a, b]: Vector3[]): Record<Hand, Vector3> {
  return a.x < b.x ? { left: a, right: b } : { left: b, right: a };
}

function setVisible(entries: InstantiatedEntries | undefined, visible: boolean) {
  for (const node of entries?.rootNodes ?? []) node.setEnabled(visible);
}

function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function clamp(v: number, limit: number) {
  return Math.max(-limit, Math.min(limit, v));
}
