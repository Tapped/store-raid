import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import HavokPhysics, {
  type HP_BodyId,
  type HP_ShapeId,
  type MotionType,
  type QTransform,
} from "@babylonjs/havok";
import { ITEM_KINDS, type ItemKind, PLAYER_RADIUS, TICK_RATE } from "../../shared/constants";
import { LEVEL_BOXES } from "../../shared/level";

const GRAVITY = -9.81;
const ITEM_DENSITY = 25; // kg per cubic meter
/** How hard a carried item is pulled towards where it should be, per second of error. */
const CARRY_GAIN = 12;
const CARRY_MAX_SPEED = 14;
const DROP_SPIN = 5; // radians per second, at most
// What collides with what. Carried items miss players, or their carriers would knock them about.
const LAYER_STATIC = 1;
const LAYER_PLAYER = 2;
const LAYER_ITEM = 4;
const LAYER_CARRIED = 8;
const PLAYER_HEIGHT = 1.8;
const GROUND_SIZE = 200;
const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];

const wasm = readFileSync(
  fileURLToPath(import.meta.resolve("@babylonjs/havok/lib/esm/HavokPhysics.wasm")),
);
const havok = await HavokPhysics({
  wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
});

/** Havok calls return [result, value]; a failure here is a bug, not something to play through. */
function ok<T>([result, value]: [unknown, T]): T {
  if (result !== havok.Result.RESULT_OK) throw new Error(`Havok call failed: ${String(result)}`);
  return value;
}

/** The pose of a physics body: where it is and how it is turned. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/**
 * The physical objects of one room, server only: clients just interpolate what comes out, so this
 * needn't be deterministic and stays out of `stepMover`. The level is static; players are kinematic,
 * moved by the movement code, so they shove things around but are never pushed back.
 */
export class PhysicsWorld {
  private readonly world = ok(havok.HP_World_Create());
  private readonly itemShapes = new Map<ItemKind, { loose: HP_ShapeId; carried: HP_ShapeId }>();
  private readonly playerShape: HP_ShapeId;
  private readonly shapes: HP_ShapeId[] = [];
  private readonly bodies = new Set<HP_BodyId>();

  constructor() {
    havok.HP_World_SetGravity(this.world, [0, GRAVITY, 0]);
    havok.HP_World_SetIdealStepTime(this.world, 1 / TICK_RATE);

    this.addStatic([0, -0.5, 0], [GROUND_SIZE, 1, GROUND_SIZE]);
    for (const box of LEVEL_BOXES) {
      this.addStatic(
        [(box.minX + box.maxX) / 2, box.height / 2, (box.minZ + box.maxZ) / 2],
        [box.maxX - box.minX, box.height, box.maxZ - box.minZ],
      );
    }

    for (const [kind, { size }] of Object.entries(ITEM_KINDS)) {
      const box = (membership: number, collides: number) => {
        const shape = this.shape(ok(havok.HP_Shape_CreateBox([0, 0, 0], IDENTITY, [...size])));
        havok.HP_Shape_SetDensity(shape, ITEM_DENSITY);
        havok.HP_Shape_SetFilterInfo(shape, [membership, collides]);
        return shape;
      };
      this.itemShapes.set(kind as ItemKind, {
        loose: box(LAYER_ITEM, LAYER_STATIC | LAYER_PLAYER | LAYER_ITEM | LAYER_CARRIED),
        carried: box(LAYER_CARRIED, LAYER_STATIC | LAYER_ITEM | LAYER_CARRIED),
      });
    }
    this.playerShape = this.shape(
      ok(
        havok.HP_Shape_CreateCapsule(
          [0, PLAYER_RADIUS, 0],
          [0, PLAYER_HEIGHT - PLAYER_RADIUS, 0],
          PLAYER_RADIUS,
        ),
      ),
    );
    havok.HP_Shape_SetFilterInfo(this.playerShape, [LAYER_PLAYER, LAYER_ITEM]);
  }

  addItem(kind: ItemKind, x: number, y: number, z: number): HP_BodyId {
    const shape = this.itemShape(kind).loose;
    const body = this.addBody(shape, havok.MotionType.DYNAMIC, [[x, y, z], IDENTITY]);
    havok.HP_Body_SetMassProperties(body, ok(havok.HP_Shape_BuildMassProperties(shape)));
    return body;
  }

  /** Picked up: gravity stops applying and `carry` steers it. It still hits shelves on the way. */
  lift(body: HP_BodyId, kind: ItemKind): void {
    havok.HP_Body_SetShape(body, this.itemShape(kind).carried);
    havok.HP_Body_SetGravityFactor(body, 0);
    havok.HP_Body_SetActivationControl(body, havok.ActivationControl.ALWAYS_ACTIVE);
  }

  /**
   * Let go: it falls again, with a bit of spin so it tumbles. It still misses players, who are standing
   * right against it and would catch it, until `settle` makes it an ordinary object again.
   */
  letGo(body: HP_BodyId): void {
    havok.HP_Body_SetGravityFactor(body, 1);
    havok.HP_Body_SetActivationControl(body, havok.ActivationControl.SIMULATION_CONTROLLED);
    const spin = () => (Math.random() * 2 - 1) * DROP_SPIN;
    havok.HP_Body_SetAngularVelocity(body, [spin(), spin(), spin()]);
  }

  settle(body: HP_BodyId, kind: ItemKind): void {
    havok.HP_Body_SetShape(body, this.itemShape(kind).loose);
  }

  /**
   * Pull a lifted item towards a position and a turn around y. Velocities rather than teleports, so
   * it can't pass through walls. Returns how far it still is from there, to notice it getting stuck.
   */
  carry(body: HP_BodyId, x: number, y: number, z: number, yaw: number): number {
    const [[px, py, pz], [qx, qy, qz, qw]] = ok(havok.HP_Body_GetQTransform(body));
    const [dx, dy, dz] = [x - px, y - py, z - pz];
    const distance = Math.hypot(dx, dy, dz);
    const scale = Math.min(CARRY_GAIN, CARRY_MAX_SPEED / Math.max(distance, 1e-6));
    havok.HP_Body_SetLinearVelocity(body, [dx * scale, dy * scale, dz * scale]);

    // Rotation left to do, target * inverse(current), to whichever end of the item is closer.
    let ty = Math.sin(yaw / 2);
    let tw = Math.cos(yaw / 2);
    if (Math.abs(ty * qy + tw * qw) < Math.SQRT1_2) [ty, tw] = [tw, -ty];
    const sign = ty * qy + tw * qw < 0 ? -1 : 1;
    const turn = 2 * CARRY_GAIN * sign;
    havok.HP_Body_SetAngularVelocity(body, [
      (ty * qz - tw * qx) * turn,
      (ty * -qw + tw * qy) * -turn,
      (-ty * qx - tw * qz) * turn,
    ]);
    return distance;
  }

  addPlayer(x: number, z: number): HP_BodyId {
    return this.addBody(this.playerShape, havok.MotionType.KINEMATIC, [[x, 0, z], IDENTITY]);
  }

  /** Where a kinematic body must be by the end of the next step; Havok works out its velocity. */
  movePlayer(body: HP_BodyId, x: number, z: number): void {
    havok.HP_Body_SetTargetQTransform(body, [[x, 0, z], IDENTITY]);
  }

  removeBody(body: HP_BodyId): void {
    havok.HP_World_RemoveBody(this.world, body);
    havok.HP_Body_Release(body);
    this.bodies.delete(body);
  }

  step(dt: number): void {
    havok.HP_World_Step(this.world, dt);
  }

  /** Copy a body's pose into `pose`, which only changes while the body is awake. */
  readPose(body: HP_BodyId, pose: Pose): void {
    const [[x, y, z], [qx, qy, qz, qw]] = ok(havok.HP_Body_GetQTransform(body));
    // q and -q are the same turn, but lerping from one to the other swings through nothing:
    // stay on the side of the last pose so clients interpolate the short way round.
    const sign = qx * pose.qx + qy * pose.qy + qz * pose.qz + qw * pose.qw < 0 ? -1 : 1;
    pose.x = x;
    pose.y = y;
    pose.z = z;
    pose.qx = sign * qx;
    pose.qy = sign * qy;
    pose.qz = sign * qz;
    pose.qw = sign * qw;
  }

  dispose(): void {
    for (const body of [...this.bodies]) this.removeBody(body);
    for (const shape of this.shapes) havok.HP_Shape_Release(shape);
    havok.HP_World_Release(this.world);
  }

  private itemShape(kind: ItemKind) {
    const shapes = this.itemShapes.get(kind);
    if (!shapes) throw new Error(`Unknown item kind: ${kind}`);
    return shapes;
  }

  private shape(shape: HP_ShapeId): HP_ShapeId {
    this.shapes.push(shape);
    return shape;
  }

  private addStatic(center: [number, number, number], size: [number, number, number]): void {
    const shape = this.shape(ok(havok.HP_Shape_CreateBox([0, 0, 0], IDENTITY, size)));
    havok.HP_Shape_SetFilterInfo(shape, [LAYER_STATIC, LAYER_ITEM | LAYER_CARRIED]);
    this.addBody(shape, havok.MotionType.STATIC, [center, IDENTITY]);
  }

  private addBody(shape: HP_ShapeId, motion: MotionType, transform: QTransform): HP_BodyId {
    const body = ok(havok.HP_Body_Create());
    havok.HP_Body_SetShape(body, shape);
    havok.HP_Body_SetMotionType(body, motion);
    havok.HP_Body_SetQTransform(body, transform);
    havok.HP_World_AddBody(this.world, body, false);
    this.bodies.add(body);
    return body;
  }
}
