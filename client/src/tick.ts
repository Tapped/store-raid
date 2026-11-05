import {
  Matrix,
  Quaternion,
  type Scene,
  type ShadowGenerator,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { loadContainer } from "./assets";

/**
 * A large tick, walked procedurally on the rig scripts/models/tick.py gives it: every frame each
 * leg's foot is placed, and the leg bends to reach it.
 *
 * - Feet stay planted on the ground until the body has moved on too far from them, then step to
 *   where they'll be needed. Legs step in two groups of four, the alternating tetrapod gait of
 *   spiders and ticks: front left, second right, third left and back right, then the other four.
 * - Each leg's joints lie in one upright plane through its hip, so a leg is solved in 2D in that
 *   plane (FABRIK, starting from its rest shape, so knees stay high) and the plane turns about the
 *   hip to face the foot.
 * - Standing still, it raises its front legs and waves them, questing: ticks smell with them.
 *
 * Bone matrices here are in the rig's frame, the glTF armature node under the model's root, and
 * use Babylon's row vectors: a child's matrix is its local matrix times its parent's.
 */
const MODEL = "models/characters/tick.glb";

/** Seconds a step takes when strolling and at full speed. */
const STEP_TIME = { slow: 0.26, fast: 0.13 };
/** Speed, m/s, at which steps are fastest. */
const FAST = 0.6;
/** How high a foot lifts in the middle of a step, meters. */
const STEP_HEIGHT = 0.07;
/** How far a foot may lag behind where it belongs before its group steps, meters. */
const STEP_TRIGGER = 0.1;
/** At rest, a foot this far from where it belongs steps back into place. */
const SETTLE = 0.02;
/** Steps land where the foot will belong this many step times ahead. */
const LEAD = 1.2;
/** Each leg of a group starts this much after the leg in front of it, seconds. */
const STAGGER = 0.025;
/** Seconds standing still before it starts questing, and how fast it raises its legs. */
const QUEST_AFTER = 1.2;
const QUEST_RATE = 2;
const IK_ITERATIONS = 10;

const UP = new Vector3(0, 1, 0);

interface Leg {
  /** The six segment bones, hip to claw. */
  bones: TransformNode[];
  /** Which half of the gait it steps in. */
  group: number;
  /** How many legs from the front: the front legs quest, and later legs start their step later. */
  index: number;
  /** Rest pose, rig frame: joint positions hip to claw tip, and each segment's rotation. */
  joints: Vector3[];
  rotations: Matrix[];
  /** The rest shape in its own plane: along the ground away from the hip, and up. */
  flat: { s: number; z: number }[];
  lengths: number[];
  /** Where the claw tip belongs, relative to the tick's position and heading. */
  home: Vector3;
  /** The claw tip in the world: planted, or moving through a step. */
  foot: Vector3;
  step?: { from: Vector3; t: number; delay: number };
}

export class TickView {
  /** Move and turn this, or call update(): the tick is drawn standing at its origin. */
  readonly root: TransformNode;
  private legs: Leg[] = [];
  private rig?: TransformNode;
  private body?: { node: TransformNode; rest: Matrix; centre: Vector3 };
  private head?: { node: TransformNode; rest: Matrix; pivot: Vector3 };
  /** Bones that only wiggle: their rest local matrix, turned a little about their own axes. */
  private wigglers: { node: TransformNode; rest: Matrix; seed: number; amount: number }[] = [];
  private clock = 0;
  private still = 0;
  private quest = 0;
  private last?: { x: number; z: number; yaw: number };
  private velocity = Vector3.Zero();
  private turnRate = 0;
  private lastGroup = 1;
  private disposed = false;

  constructor(
    private scene: Scene,
    private shadows: ShadowGenerator,
    name: string,
  ) {
    this.root = new TransformNode(name, scene);
    void this.load(name);
  }

  private async load(name: string) {
    const container = await loadContainer(this.scene, MODEL);
    if (!container || this.disposed) return;
    // Its own copy: every tick needs its own bones.
    const model = container.instantiateModelsToScene((source) => `${name}-${source}`, false, {
      doNotInstantiate: true,
    });
    const nodes = new Map<string, TransformNode>();
    for (const root of model.rootNodes) {
      root.parent = this.root;
      for (const node of root.getDescendants(false)) {
        if (node instanceof TransformNode) nodes.set(node.name.slice(name.length + 1), node);
      }
      for (const mesh of root.getChildMeshes()) {
        mesh.receiveShadows = true;
        this.shadows.addShadowCaster(mesh);
      }
    }
    const bone = (n: string) => {
      const node = nodes.get(n);
      if (!node) throw new Error(`tick model has no bone ${n}`);
      node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
      return node;
    };

    const bodyNode = bone("body");
    this.rig = bodyNode.parent as TransformNode;
    const rest = new Map<TransformNode, Matrix>();
    const restOf = (node: TransformNode): Matrix => {
      let m = rest.get(node);
      if (!m) {
        m = localMatrix(node);
        if (node.parent && node.parent !== this.rig)
          m = m.multiply(restOf(node.parent as TransformNode));
        rest.set(node, m);
      }
      return m;
    };

    this.body = {
      node: bodyNode,
      rest: restOf(bodyNode),
      centre: restOf(bodyNode).getTranslation(),
    };
    const headNode = bone("head");
    this.head = {
      node: headNode,
      rest: restOf(headNode),
      pivot: restOf(headNode).getTranslation(),
    };
    for (const side of ["L", "R"]) {
      const hook = bone(`hook.${side}`);
      this.wigglers.push({
        node: hook,
        rest: localMatrix(hook),
        seed: side === "L" ? 0 : 1.7,
        amount: 0.12,
      });
      for (let i = 0; i < 3; i++) {
        const palp = bone(`palp.${side}.${i}`);
        this.wigglers.push({
          node: palp,
          rest: localMatrix(palp),
          seed: i * 2.3 + (side === "L" ? 0 : 5),
          amount: 0.25,
        });
      }
    }

    this.root.computeWorldMatrix(true);
    const toWorld = this.rigWorld();
    const fromRoot = Matrix.Invert(this.root.getWorldMatrix());
    for (const [s, side] of ["L", "R"].entries()) {
      for (let index = 0; index < 4; index++) {
        const prefix = `leg.${side}${index}`;
        const bones = [0, 1, 2, 3, 4, 5].map((i) => bone(`${prefix}.${i}`));
        const ends = [...bones, bone(`${prefix}.tip`)];
        const joints = ends.map((b) => restOf(b).getTranslation());
        const out = joints[6].subtract(joints[0]);
        out.y = 0;
        out.normalize();
        const flat = joints.map((j) => {
          const d = j.subtract(joints[0]);
          return { s: Vector3.Dot(d, out), z: d.y };
        });
        const lengths = joints.slice(1).map((j, i) => Vector3.Distance(j, joints[i]));
        const tipWorld = Vector3.TransformCoordinates(joints[6], toWorld);
        this.legs.push({
          bones,
          group: (s + index) % 2,
          index,
          joints,
          rotations: bones.map((b) => restOf(b).getRotationMatrix()),
          flat,
          lengths,
          home: Vector3.TransformCoordinates(tipWorld, fromRoot),
          foot: tipWorld,
        });
      }
    }
  }

  /** Where the rig's frame is in the world now. */
  private rigWorld(): Matrix {
    const chain: TransformNode[] = [];
    for (let n: TransformNode | null = this.rig ?? null; n; n = n.parent as TransformNode | null) {
      chain.unshift(n);
    }
    for (const n of chain) n.computeWorldMatrix(true);
    return this.rig?.getWorldMatrix() ?? Matrix.Identity();
  }

  /** Where a leg's claw tip belongs if the tick stood at (x, z) facing yaw. */
  private homeAt(leg: Leg, x: number, z: number, yaw: number): Vector3 {
    const at = Vector3.TransformCoordinates(leg.home, Matrix.RotationY(yaw));
    return new Vector3(x + at.x, this.root.position.y, z + at.z);
  }

  /** Once per rendered frame: stand at (x, z), facing yaw, as in LocalPlayer (+z at yaw 0). */
  update(x: number, z: number, yaw: number, dt: number) {
    this.root.position.x = x;
    this.root.position.z = z;
    this.root.rotation.y = yaw;
    if (!this.body || dt <= 0) return;
    this.clock += dt;

    if (this.last) {
      const vx = (x - this.last.x) / dt;
      const vz = (z - this.last.z) / dt;
      const turn = Math.atan2(Math.sin(yaw - this.last.yaw), Math.cos(yaw - this.last.yaw)) / dt;
      // Smoothed a little: positions arrive in uneven steps.
      const k = Math.min(1, dt * 12);
      this.velocity.x += (vx - this.velocity.x) * k;
      this.velocity.z += (vz - this.velocity.z) * k;
      this.turnRate += (turn - this.turnRate) * k;
    }
    this.last = { x, z, yaw };
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = speed > 0.03 || Math.abs(this.turnRate) > 0.15;
    this.still = moving ? 0 : this.still + dt;
    const questing = this.still > QUEST_AFTER;
    this.quest = Math.max(0, Math.min(1, this.quest + (questing ? dt : -2 * dt) * QUEST_RATE));

    const stepTime = lerp(STEP_TIME.slow, STEP_TIME.fast, Math.min(1, speed / FAST));
    this.stepLegs(x, z, yaw, stepTime, moving, dt);

    // The body rides a little lower while legs are in the air, rolls away from lifted legs, and
    // rears back when questing; at rest it breathes.
    let lift = 0;
    let roll = 0;
    for (const leg of this.legs) {
      if (!leg.step || leg.step.delay > 0) continue;
      const up = Math.sin(Math.PI * leg.step.t);
      lift += up;
      roll += up * (leg.home.x > 0 ? 1 : -1);
    }
    const bob = -0.006 * lift + 0.004 * Math.sin(this.clock * 1.6) + 0.03 * this.quest;
    const turn = Matrix.RotationYawPitchRoll(0, -0.12 * this.quest, 0.015 * roll);
    const { centre } = this.body;
    const bodyNow = this.body.rest
      .multiply(Matrix.Translation(-centre.x, -centre.y, -centre.z))
      .multiply(turn)
      .multiply(Matrix.Translation(centre.x, centre.y + bob, centre.z));
    setLocal(this.body.node, bodyNow);

    // The head looks a little into turns and twitches; it stays fixed to the body otherwise.
    if (this.head) {
      const { pivot } = this.head;
      const look = Matrix.RotationYawPitchRoll(
        Math.max(-0.35, Math.min(0.35, this.turnRate * 0.25)) + 0.05 * noise(this.clock * 0.7, 3),
        0.06 * noise(this.clock * 0.9, 7) - 0.1 * this.quest,
        0,
      );
      const bodyMotion = Matrix.Invert(this.body.rest).multiply(bodyNow);
      const headNow = this.head.rest
        .multiply(Matrix.Translation(-pivot.x, -pivot.y, -pivot.z))
        .multiply(look)
        .multiply(Matrix.Translation(pivot.x, pivot.y, pivot.z))
        .multiply(bodyMotion);
      setLocal(this.head.node, headNow.multiply(Matrix.Invert(bodyNow)));
    }
    for (const w of this.wigglers) {
      const a =
        w.amount *
        (noise(this.clock * 1.3, w.seed) + 0.6 * this.quest * Math.sin(this.clock * 9 + w.seed));
      setLocal(w.node, Matrix.RotationYawPitchRoll(0, a, 0.5 * a).multiply(w.rest));
    }

    const rigToWorld = this.rigWorld();
    const worldToRig = Matrix.Invert(rigToWorld);
    const bodyMotion = Matrix.Invert(this.body.rest).multiply(bodyNow);
    for (const leg of this.legs) {
      let foot = leg.foot;
      if (leg.index === 0 && this.quest > 0) {
        // Held out forward and up, well above the hip, waving, each leg out of time with the other.
        const side = leg.home.x > 0 ? 1 : -1;
        const wave = this.clock * 2.6 + side * 1.3;
        const raised = leg.home.add(
          new Vector3(
            -side * 0.12 + 0.06 * Math.sin(wave),
            0.46 + 0.07 * Math.sin(wave * 1.7),
            0.2,
          ),
        );
        const air = Vector3.TransformCoordinates(raised, this.root.getWorldMatrix());
        foot = Vector3.Lerp(leg.foot, air, smooth(this.quest));
      }
      this.solveLeg(leg, Vector3.TransformCoordinates(foot, worldToRig), bodyMotion, bodyNow);
    }
  }

  private stepLegs(
    x: number,
    z: number,
    yaw: number,
    stepTime: number,
    moving: boolean,
    dt: number,
  ) {
    const lead = stepTime * LEAD;
    const ahead = {
      x: x + this.velocity.x * lead,
      z: z + this.velocity.z * lead,
      yaw: yaw + this.turnRate * lead,
    };
    for (const leg of this.legs) {
      const step = leg.step;
      if (!step) continue;
      if (step.delay > 0) {
        step.delay -= dt;
        continue;
      }
      step.t = Math.min(1, step.t + dt / stepTime);
      // Aim at where the foot will belong, which moves on as the tick does.
      const to = this.homeAt(leg, ahead.x, ahead.z, ahead.yaw);
      const e = smooth(step.t);
      leg.foot = Vector3.Lerp(step.from, to, e);
      leg.foot.y = this.root.position.y + STEP_HEIGHT * Math.sin(Math.PI * step.t);
      if (step.t >= 1) leg.step = undefined;
    }

    // A group steps only once the other group is planted, when one of its feet lags too far. The
    // group that didn't step last goes first, so the two take turns.
    for (const group of [1 - this.lastGroup, this.lastGroup]) {
      const others = this.legs.filter((l) => l.group !== group);
      if (others.some((l) => l.step)) continue;
      const mine = this.legs.filter((l) => l.group === group && !(l.index === 0 && this.quest > 0));
      if (mine.some((l) => l.step)) continue;
      const lag = (l: Leg) => Vector3.Distance(l.foot, this.homeAt(l, x, z, yaw));
      const trigger = moving ? STEP_TRIGGER : SETTLE;
      if (!mine.some((l) => lag(l) > trigger)) continue;
      for (const leg of mine) {
        if (lag(leg) > SETTLE)
          leg.step = { from: leg.foot.clone(), t: 0, delay: leg.index * STAGGER };
      }
      this.lastGroup = group;
      break; // one group at a time
    }
  }

  /** Bend a leg so its claw tip reaches `target` (rig frame), with the body moved by bodyMotion. */
  private solveLeg(leg: Leg, target: Vector3, bodyMotion: Matrix, bodyNow: Matrix) {
    const hip = Vector3.TransformCoordinates(leg.joints[0], bodyMotion);
    const out = target.subtract(hip);
    out.y = 0;
    const reach = out.length();
    if (reach < 1e-4) return;
    out.scaleInPlace(1 / reach);

    // FABRIK in the leg's plane, from the rest shape, with the coxa (first segment) fixed.
    const p = leg.flat.map((f) => ({ s: f.s, z: f.z }));
    const goal = { s: reach, z: target.y - hip.y };
    const root = p[1];
    const n = p.length - 1;
    for (let it = 0; it < IK_ITERATIONS; it++) {
      p[n] = { ...goal };
      for (let i = n - 1; i >= 1; i--) p[i] = toward(p[i + 1], p[i], leg.lengths[i]);
      p[1] = { ...root };
      for (let i = 2; i <= n; i++) p[i] = toward(p[i - 1], p[i], leg.lengths[i - 1]);
    }
    const joints = p.map((q) => hip.add(out.scale(q.s)).addInPlace(UP.scale(q.z)));

    let parent = bodyNow;
    for (const [i, node] of leg.bones.entries()) {
      const from = leg.joints[i + 1].subtract(leg.joints[i]).normalize();
      const to = joints[i + 1].subtract(joints[i]).normalize();
      const m = leg.rotations[i].multiply(rotationBetween(from, to));
      m.setTranslation(joints[i]);
      setLocal(node, m.multiply(Matrix.Invert(parent)));
      parent = m;
    }
  }

  dispose() {
    this.disposed = true;
    this.root.dispose();
  }
}

function localMatrix(node: TransformNode): Matrix {
  return Matrix.Compose(
    node.scaling,
    node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation),
    node.position,
  );
}

const scratch = { scale: new Vector3(), rotation: new Quaternion(), position: new Vector3() };
function setLocal(node: TransformNode, m: Matrix) {
  m.decompose(scratch.scale, scratch.rotation, scratch.position);
  node.position.copyFrom(scratch.position);
  node.rotationQuaternion ??= new Quaternion();
  node.rotationQuaternion.copyFrom(scratch.rotation);
}

/** The rotation taking unit vector a to unit vector b by the shortest way, for row vectors. */
function rotationBetween(a: Vector3, b: Vector3): Matrix {
  const v = Vector3.Cross(a, b);
  const c = Vector3.Dot(a, b);
  const k = 1 / (1 + Math.max(c, -0.999));
  // Rodrigues: R = I + [v]x + [v]x² k, for column vectors; row vectors take its transpose.
  const r = [
    [1 - k * (v.y * v.y + v.z * v.z), -v.z + k * v.x * v.y, v.y + k * v.x * v.z],
    [v.z + k * v.x * v.y, 1 - k * (v.x * v.x + v.z * v.z), -v.x + k * v.y * v.z],
    [-v.y + k * v.x * v.z, v.x + k * v.y * v.z, 1 - k * (v.x * v.x + v.y * v.y)],
  ];
  return Matrix.FromValues(
    r[0][0],
    r[1][0],
    r[2][0],
    0,
    r[0][1],
    r[1][1],
    r[2][1],
    0,
    r[0][2],
    r[1][2],
    r[2][2],
    0,
    0,
    0,
    0,
    1,
  );
}

type Flat = { s: number; z: number };
/** The point `length` from `from` in the direction of `to`. */
function toward(from: Flat, to: Flat, length: number): Flat {
  const ds = to.s - from.s;
  const dz = to.z - from.z;
  const d = Math.hypot(ds, dz) || 1;
  return { s: from.s + (ds / d) * length, z: from.z + (dz / d) * length };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

/** Smooth noise in about -1 to 1: a few sines out of step. */
function noise(t: number, seed: number) {
  return (
    (Math.sin(t * 1.7 + seed) +
      Math.sin(t * 2.9 + seed * 2.1) * 0.6 +
      Math.sin(t * 4.3 + seed * 3.7) * 0.3) /
    1.9
  );
}
