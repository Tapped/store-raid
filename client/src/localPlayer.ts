import { type ArcRotateCamera, Vector3 } from "@babylonjs/core";
import { CloseCode } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import type { MoveInput } from "../../server/src/rooms/schema";
import { MOVE_SCALE } from "../../shared/constants";
import { stepMover } from "../../shared/movement";
import { addCameraEffects } from "./graphics";
import type { Device } from "./input";
import { type GameConnection, joinGame, waitForServer } from "./net";
import { createPlayerCamera, type World } from "./scene";

const LOOK_SPEED = 2.5; // radians per second at full stick
const DRAG_SPEED = 0.005; // radians per pixel
const CAMERA_FOLLOW_TIME = 0.1; // seconds to close about 63% of the gap to our player
/** Two patches behind, with a little spring: a carried item stays ahead of its carrier. */
const ITEM_SMOOTHING = { mode: "lerp", delay: 67, smoothMs: 40 } as const;

function openInput(room: GameConnection) {
  return room.input<MoveInput>({ mode: "reliable" });
}

/** What this player's connection is doing right now; set up by connect(). */
interface Session {
  room: GameConnection;
  predict: ReturnType<typeof Predict.get>;
  input: ReturnType<typeof openInput>;
  sessionId: string;
  self: GameConnection["state"]["players"] extends Map<string, infer P> ? P : never;
}

/**
 * One person on this screen: a device, a camera and their own connection to the room. To the
 * server they are an ordinary player, so sharing a screen and playing online work the same way.
 */
export class LocalPlayer {
  readonly camera: ArcRotateCamera;
  session: Session | undefined;
  status = "Connecting…";
  private left = false;
  private readonly cameraTarget = new Vector3();
  private readonly removeCameraEffects: () => void;

  constructor(
    world: World,
    readonly device: Device,
    readonly name: string,
  ) {
    this.camera = createPlayerCamera(world.scene, `camera-${name}`);
    this.removeCameraEffects = addCameraEffects(world.scene, this.camera);
    void this.connect();
  }

  /** Joins, and keeps trying until it works: the server restarts on every save in dev. */
  private async connect(): Promise<void> {
    while (!this.left) {
      try {
        const room = await joinGame(this.name);
        if (this.left) {
          await room.leave();
          return;
        }
        await this.start(room);
        return;
      } catch (err) {
        console.warn(`${this.name}: could not join`, err);
        this.status = "Waiting for the game server…";
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await waitForServer();
      }
    }
  }

  private async start(room: GameConnection): Promise<void> {
    const predict = Predict.get(room);

    // Other players: interpolate towards the latest snapshot (small spring for smooth motion).
    predict.attachAll("players", { mode: "lerp", fields: ["x", "z"], smoothMs: 65 });
    predict.attachAll("items", {
      x: ITEM_SMOOTHING,
      y: ITEM_SMOOTHING,
      z: ITEM_SMOOTHING,
      qx: ITEM_SMOOTHING,
      qy: ITEM_SMOOTHING,
      qz: ITEM_SMOOTHING,
      qw: ITEM_SMOOTHING,
    });

    const input = openInput(room);

    room.onLeave(async (code) => {
      this.session = undefined;
      if (code === CloseCode.CONSENTED) return;
      this.status = "Server restarting — reconnecting…";
      await waitForServer();
      await this.connect();
    });

    // The first patch is what creates our own Player.
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
    const self = room.state.players.get(room.sessionId);
    if (!self) throw new Error("Own player missing from first state patch");

    // Predict locally with the exact step the server runs, reconcile on correction.
    predict.reconciler(self, {
      input,
      fields: ["x", "z", "vx", "vz"],
      step: (ctx, predicted, command) => stepMover(predicted, command, ctx.dt),
    });

    this.session = { room, predict, input, sessionId: room.sessionId, self };
    this.status = "";
  }

  /** Pick up what's in reach, or let go of what's in hand. The server decides what happens. */
  grabOrDrop(): void {
    const session = this.session;
    if (session) session.room.send(session.self.carrying ? "drop" : "grab");
  }

  /** One rendered frame: turn the camera, send due inputs, follow our player. */
  update(dt: number): void {
    const controls = this.device.read();
    this.camera.alpha -= controls.lookX * LOOK_SPEED * dt + controls.dragX * DRAG_SPEED;
    this.camera.beta -= controls.lookY * LOOK_SPEED * dt + controls.dragY * DRAG_SPEED;

    const session = this.session;
    if (!session) return;

    // Stick directions are relative to the camera; the simulation wants world directions.
    const forwardX = -Math.cos(this.camera.alpha);
    const forwardZ = -Math.sin(this.camera.alpha);
    const worldX = controls.moveX * forwardZ + controls.moveY * forwardX;
    const worldZ = -controls.moveX * forwardX + controls.moveY * forwardZ;

    // One input per simulation step, independent of frame rate.
    const steps = session.predict.tick(performance.now());
    for (let i = 0; i < steps; i++) {
      session.input.data.moveX = Math.round(worldX * MOVE_SCALE);
      session.input.data.moveZ = Math.round(worldZ * MOVE_SCALE);
      session.input.send();
    }

    this.cameraTarget.set(
      session.predict.value(session.self, "x"),
      1,
      session.predict.value(session.self, "z"),
    );
    // In place: assigning `camera.target` would keep the camera where it is and change its angles.
    const follow = 1 - Math.exp(-dt / CAMERA_FOLLOW_TIME);
    Vector3.LerpToRef(this.camera.target, this.cameraTarget, follow, this.camera.target);
  }

  leave(): void {
    this.left = true;
    void this.session?.room.leave();
    this.removeCameraEffects();
    this.camera.dispose();
  }
}
