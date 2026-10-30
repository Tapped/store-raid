import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import HavokPhysics, {
  type HP_BodyId,
  type HP_ShapeId,
  type MotionType,
  type QTransform,
} from "@babylonjs/havok";
import { CRATE_SIZE, PLAYER_RADIUS, TICK_RATE } from "../../shared/constants";
import { LEVEL_BOXES } from "../../shared/level";

const GRAVITY = -9.81;
const CRATE_DENSITY = 25; // kg per cubic meter
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
  private readonly crateShape: HP_ShapeId;
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

    this.crateShape = this.shape(
      ok(havok.HP_Shape_CreateBox([0, 0, 0], IDENTITY, [CRATE_SIZE, CRATE_SIZE, CRATE_SIZE])),
    );
    havok.HP_Shape_SetDensity(this.crateShape, CRATE_DENSITY);
    this.playerShape = this.shape(
      ok(
        havok.HP_Shape_CreateCapsule(
          [0, PLAYER_RADIUS, 0],
          [0, PLAYER_HEIGHT - PLAYER_RADIUS, 0],
          PLAYER_RADIUS,
        ),
      ),
    );
  }

  addCrate(x: number, y: number, z: number): HP_BodyId {
    const body = this.addBody(this.crateShape, havok.MotionType.DYNAMIC, [[x, y, z], IDENTITY]);
    havok.HP_Body_SetMassProperties(body, ok(havok.HP_Shape_BuildMassProperties(this.crateShape)));
    return body;
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

  private shape(shape: HP_ShapeId): HP_ShapeId {
    this.shapes.push(shape);
    return shape;
  }

  private addStatic(center: [number, number, number], size: [number, number, number]): void {
    const shape = this.shape(ok(havok.HP_Shape_CreateBox([0, 0, 0], IDENTITY, size)));
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
