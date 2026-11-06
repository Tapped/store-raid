import type { FreeCamera } from "@babylonjs/core";
import { CloseCode } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import type { MoveInput } from "../../server/src/rooms/schema";
import {
  canClimb,
  EYE_HEIGHT,
  grabbingHand,
  HANDS,
  type Hand,
  MOVE_SCALE,
  YAW_SCALE,
} from "../../shared/constants";
import { stepMover } from "../../shared/movement";
import { addCameraEffects } from "./graphics";
import { FirstPersonHands, type Held } from "./hands";
import type { Device } from "./input";
import type { ItemView } from "./items";
import { type GameConnection, joinGame, waitForServer } from "./net";
import { createPlayerCamera, type World } from "./scene";
import { TiredEffect } from "./tired";

const LOOK_SPEED = 2.5; // radians per second at full stick
const DRAG_SPEED = 0.005; // radians per pixel
/** How far up or down the player can look, in radians from level. */
const MAX_PITCH = 1.45;
/** Meters the camera rises and sinks with each breath when winded. */
const BREATH_HEAVE = 0.015;
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

/** The person at this screen: their device, their camera and their connection to the room. */
export class LocalPlayer {
  readonly camera: FreeCamera;
  readonly hands: FirstPersonHands;
  session: Session | undefined;
  status = "Connecting…";
  private left = false;
  private readonly removeCameraEffects: () => void;
  private readonly tired: TiredEffect;

  constructor(
    private readonly world: World,
    readonly device: Device,
    readonly name: string,
  ) {
    this.camera = createPlayerCamera(world.scene, `camera-${name}`);
    this.removeCameraEffects = addCameraEffects(world.scene, this.camera);
    this.hands = new FirstPersonHands(world, this.camera);
    this.tired = new TiredEffect(world.scene.imageProcessingConfiguration);
    void this.connect();
  }

  /** Joins, and keeps trying until it works: the server restarts on every save in dev. */
  private async connect(): Promise<void> {
    while (!this.left) {
      try {
        const room = await joinGame(this.name, this.world.level.name);
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
    predict.attachAll("players", { mode: "lerp", fields: ["x", "y", "z"], smoothMs: 65 });
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
      fields: ["x", "y", "z", "vx", "vy", "vz", "stamina", "winded"],
      // With what our hands hold now: a replay after picking something up may differ for a tick.
      step: (ctx, predicted, command) =>
        stepMover(predicted, command, ctx.dt, this.world.level, canClimb(self)),
    });

    this.session = { room, predict, input, sessionId: room.sessionId, self };
    this.status = "";
  }

  /** Grab what's in front, with the right hand if it's free, else the left. */
  grab(): void {
    const self = this.session?.self;
    if (!self) return;
    // Sent even with both hands full: it may be a dimmer they reach for.
    const hand = grabbingHand(self);
    if (hand) this.hands.reach(hand);
    this.session?.room.send("grab");
  }

  /** The grab button is up again, which stops turning a dimmer. */
  release(): void {
    this.session?.room.send("release");
  }

  /** Let go of the last thing grabbed. */
  drop(): void {
    this.session?.room.send("drop");
  }

  /**
   * After the items have moved: our hands hold what the server says they hold, one-handed things
   * drawn in them and big things gripped where they are.
   */
  updateHands(dt: number, items: Map<string, ItemView>): void {
    const self = this.session?.self;
    const held = {} as Record<Hand, Held | undefined>;
    for (const hand of HANDS) {
      const view = self?.[hand] ? items.get(self[hand]) : undefined;
      held[hand] = view && { id: self?.[hand] ?? "", kind: view.kind, node: view.node };
    }
    for (const view of items.values()) {
      const hand = HANDS.find((h) => self?.[h] && items.get(self[h]) === view);
      view.hold(hand && this.hands.anchorFor(hand, held[hand]));
    }
    const session = this.session;
    const speed = session
      ? Math.hypot(
          session.predict.value(session.self, "vx"),
          session.predict.value(session.self, "vz"),
        )
      : 0;
    this.hands.update(dt, held, speed);
  }

  /** One rendered frame: look around, send due inputs, put the camera in our player's eyes. */
  update(dt: number): void {
    const controls = this.device.read();
    const { rotation } = this.camera;
    // Babylon's yaw turns right as it grows, and its pitch looks down as it grows.
    rotation.y += controls.lookX * LOOK_SPEED * dt + controls.dragX * DRAG_SPEED;
    rotation.y = Math.atan2(Math.sin(rotation.y), Math.cos(rotation.y));
    rotation.x -= controls.lookY * LOOK_SPEED * dt - controls.dragY * DRAG_SPEED;
    rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, rotation.x));

    const session = this.session;
    this.tired.update(
      session ? session.predict.value(session.self, "stamina") : 1,
      session?.self.winded ?? false,
      dt,
    );
    if (!session) return;

    // Stick directions are relative to where we look; the simulation wants world directions.
    const forwardX = Math.sin(rotation.y);
    const forwardZ = Math.cos(rotation.y);
    const worldX = controls.moveX * forwardZ + controls.moveY * forwardX;
    const worldZ = -controls.moveX * forwardX + controls.moveY * forwardZ;
    const running = this.device.runHeld();
    const jump = this.device.jumpHeld();

    // One input per simulation step, independent of frame rate.
    const steps = session.predict.tick(performance.now());
    for (let i = 0; i < steps; i++) {
      session.input.data.moveX = Math.round(worldX * MOVE_SCALE);
      session.input.data.moveZ = Math.round(worldZ * MOVE_SCALE);
      session.input.data.yaw = Math.round(rotation.y * YAW_SCALE);
      session.input.data.run = running;
      session.input.data.jump = jump;
      session.input.send();
    }

    this.camera.position.set(
      session.predict.value(session.self, "x"),
      session.predict.value(session.self, "y") + EYE_HEIGHT + this.tired.heave * BREATH_HEAVE,
      session.predict.value(session.self, "z"),
    );
  }

  leave(): void {
    this.left = true;
    void this.session?.room.leave();
    this.removeCameraEffects();
    this.tired.dispose();
    this.hands.dispose();
    this.camera.dispose();
  }
}
