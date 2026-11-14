import { type FreeCamera, Quaternion, Vector3 } from "@babylonjs/core";
import { CloseCode } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import type { MoveInput } from "../../server/src/rooms/schema";
import {
  CARRY_GAIN,
  CARRY_HEIGHT,
  canClimb,
  carryDistance,
  EYE_HEIGHT,
  grabbingHand,
  HANDS,
  type Hand,
  ITEM_KINDS,
  type ItemKind,
  MOVE_SCALE,
  PITCH_SCALE,
  TICK_RATE,
  YAW_SCALE,
} from "../../shared/constants";
import { MECHANICS, MECHANICS_KEYS, MECHANICS_RANGE, type Mechanics } from "../../shared/mechanics";
import type { Mode } from "../../shared/modes";
import { stepMover } from "../../shared/movement";
import { terrainOf } from "../../shared/truck";
import { Gait, playOwnFootstep } from "./footsteps";
import { addCameraEffects } from "./graphics";
import { FirstPersonHands, type Held } from "./hands";
import type { Device } from "./input";
import type { ItemView } from "./items";
import { type GameConnection, joinGame, waitForServer } from "./net";
import { SITTING } from "./players";
import { createPlayerCamera, type World } from "./scene";
import { TiredEffect } from "./tired";
import { addSetting, tunables } from "./tuning";

const LOOK = tunables("Controls/Looking", {
  lookSpeed: { value: 2.5, min: 0.5, max: 8, hint: "Radians per second at full stick" },
  dragSpeed: {
    value: 0.005,
    min: 0.0005,
    max: 0.02,
    step: 0.0001,
    hint: "Mouse: radians per pixel",
  },
  maxPitch: {
    value: 1.45,
    min: 0.5,
    max: 1.57,
    hint: "How far up or down the player can look, in radians from level",
  },
});
const HEAVE = tunables("Feel/Tired", {
  breathHeave: {
    value: 0.015,
    min: 0,
    max: 0.1,
    step: 0.001,
    hint: "Meters the camera rises and sinks with each breath when winded",
  },
});

/** What each mechanic does, for the tuning panel. */
const MECHANICS_HINTS: Record<keyof Mechanics, string> = {
  walkSpeed: "Meters per second at full input",
  runSpeed: "Meters per second at full input while running",
  runTime: "Seconds of running from full stamina to none",
  restTime: "Seconds of not running from no stamina to full",
  runAgain: "Stamina a winded player needs back before running again",
  uphill: "How much harder stairs are, per meter of rise per meter across",
  stepUp: "Meters a player steps up without noticing",
  stepDown: "Meters down a player follows the floor before falling",
  climbSpeed: "Meters per second up or down a ladder",
  gravity: "Meters per second per second",
  jumpSpeed: "Meters per second up as a jump leaves the ground",
};
/** Two patches behind, with a little spring: a carried item stays ahead of its carrier. */
const ITEM_SMOOTHING = { mode: "lerp", delay: 67, smoothMs: 40 } as const;
/**
 * How far a big thing carried alone trails where the server pulls it, per meter per second its
 * carrier moves. Each tick they move, then its pull closes CARRY_GAIN / TICK_RATE of the gap, which
 * settles at v (1 / CARRY_GAIN - 1 / TICK_RATE) behind.
 */
const CARRY_TRAIL = 1 / CARRY_GAIN - 1 / TICK_RATE;
/**
 * How far it can be from where it should be on the server, beyond that trail, before we see it
 * held back on our screen too: caught on a shelf, say, or against a wall. In meters.
 */
const CARRY_SLACK = 0.3;
/** How quickly being held back shows, per second. */
const CARRY_FOLLOW = 12;
/** How quickly a spectator's view turns with whoever they watch, per second: yaw syncs at 30 Hz. */
const WATCH_TURN = 15;

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
  private readonly gait = new Gait();
  /** What we carry alone in both arms, drawn in them: how far the server's is held back. */
  private carrying: { id: string; held: Vector3; turned: boolean } | undefined;
  /** The mechanics this player tuned, sent again on every join: a restarted server forgets them. */
  private readonly tuned: Partial<Mechanics> = {};
  /** Out of the building, the session of whoever we watch through the eyes of. */
  private watching: string | undefined;
  /** The seat we sat on last frame, or -1, and the way the last one faced. */
  private lastSeat = -1;
  private seatYaw = 0;
  /** Seconds left of getting up, during which we stay put. */
  private rising = 0;
  /** How far down into a seat the camera is, from 0 standing to 1 seated. */
  private seatedness = 0;

  constructor(
    private readonly world: World,
    readonly device: Device,
    readonly name: string,
    readonly mode: Mode,
  ) {
    this.camera = createPlayerCamera(world.scene, `camera-${name}`);
    this.removeCameraEffects = addCameraEffects(world.scene, this.camera);
    this.hands = new FirstPersonHands(world, this.camera);
    this.tired = new TiredEffect(world.scene.imageProcessingConfiguration);
    this.addMechanicsSettings();
    void this.connect();
  }

  /**
   * The room's mechanics in the tuning panel. They're the room's, so changing one changes it for
   * everyone in the room, and what the panel shows is what the server says.
   */
  private addMechanicsSettings(): void {
    for (const key of MECHANICS_KEYS) {
      addSetting({
        group: "Mechanics/The room's, for everyone in it",
        key,
        hint: MECHANICS_HINTS[key],
        initial: MECHANICS[key],
        ...MECHANICS_RANGE[key],
        get: () => this.session?.room.state.mechanics[key] ?? this.tuned[key] ?? MECHANICS[key],
        set: (value) => {
          this.tuned[key] = value as number;
          this.session?.room.send("tune", { [key]: value });
        },
      });
    }
  }

  /** Joins, and keeps trying until it works: the server restarts on every save in dev. */
  private async connect(): Promise<void> {
    while (!this.left) {
      try {
        const room = await joinGame(this.name, this.world.level.name, this.mode);
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
    predict.attachAll("ticks", { mode: "lerp", fields: ["x", "y", "z"], smoothMs: 65 });
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
      // Seated, we stay put, as the server keeps us.
      step: (ctx, predicted, command) => {
        if (self.seat >= 0) return;
        stepMover(
          predicted,
          command,
          ctx.dt,
          terrainOf(this.world.level, room.state.hatch >= 1),
          room.state.mechanics,
          canClimb(self),
        );
      },
    });

    this.session = { room, predict, input, sessionId: room.sessionId, self };
    if (Object.keys(this.tuned).length) room.send("tune", this.tuned);
    this.status = "";
  }

  /** Whether we're out of the building this round, dead, lost or waiting, and watch others. */
  get spectating(): boolean {
    const role = this.session?.self.role;
    return role !== undefined && role !== "playing";
  }

  /** Everyone still in the building, in a steady order to step through. */
  private crew(): string[] {
    const players = this.session?.room.state.players;
    if (!players) return [];
    return [...players]
      .filter(([id, player]) => player.role === "playing" && id !== this.session?.sessionId)
      .map(([id]) => id)
      .sort();
  }

  /** Who we watch, while we're out of the building and anyone is still in it. */
  watched(): string | undefined {
    if (!this.spectating) return undefined;
    const crew = this.crew();
    if (!this.watching || !crew.includes(this.watching)) this.watching = crew[0];
    return this.watching;
  }

  /** Watch the next one in the building, or the one before. */
  private watchNext(step: number) {
    const crew = this.crew();
    if (crew.length === 0) return;
    const at = this.watching ? crew.indexOf(this.watching) : -1;
    this.watching = crew[(at + step + crew.length) % crew.length];
  }

  /** In a game's lobby, ready (or not); in the truck in a raid, wanting to leave (or not). */
  ready(): void {
    this.session?.room.send("ready");
  }

  /** Grab what's in front, with the right hand if it's free, else the left. Watching, the next player. */
  grab(): void {
    const self = this.session?.self;
    if (!self) return;
    if (this.spectating) {
      this.watchNext(1);
      return;
    }
    // Sent even with both hands full: it may be a dimmer or the hatch's buttons they reach for.
    const hand = grabbingHand(self);
    if (hand) this.hands.reach(hand);
    this.session?.room.send("grab");
  }

  /** The grab button is up again, which stops turning a dimmer. */
  release(): void {
    this.session?.room.send("release");
  }

  /** Switch the flashlights in our hands on or off; the server says which way. */
  toggleLight(): void {
    this.session?.room.send("light");
  }

  /** Let go of the last thing grabbed. Watching, the player before. */
  drop(): void {
    if (this.spectating) this.watchNext(-1);
    else this.session?.room.send("drop");
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
    this.carryInArms(dt, items);
    // Our footsteps, only on the ground: not falling, nor climbing, which goes nowhere across.
    const session = this.session;
    const speed = session
      ? Math.hypot(
          session.predict.value(session.self, "vx"),
          session.predict.value(session.self, "vz"),
        )
      : 0;
    const grounded = session ? session.predict.value(session.self, "vy") === 0 : false;
    if (this.gait.update(dt, speed, grounded)) playOwnFootstep(this.world.scene, this.gait.volume);
    this.hands.setVisible(!this.spectating);
    this.hands.update(dt, held, this.gait);
  }

  /**
   * A big thing we carry alone is drawn in front of us, where we hold it, rather than where the
   * server says: that's in the past, and trails us as the physics pulls it along, so walking
   * backwards would leave it, and our hands on it, a metre away. Only where the server's is held
   * back further than it trails, against a wall say, do we see it held back.
   */
  private carryInArms(dt: number, items: Map<string, ItemView>) {
    const session = this.session;
    const self = session?.self;
    const id = self && self.left !== "" && self.left === self.right ? self.left : undefined;
    const item = id ? session?.room.state.items.get(id) : undefined;
    const kind = item && ITEM_KINDS[item.kind as ItemKind];
    if (this.carrying && this.carrying.id !== id) {
      items.get(this.carrying.id)?.carryAt(undefined);
      this.carrying = undefined;
    }
    if (!session || !self || !id || !item || !kind || kind.carriers > 1) return;
    const view = items.get(id);
    if (!view) return;
    const distance = carryDistance(kind.size[2]);

    // The latest from the server, where it is and where it was pulled to in the same patch.
    const bodyYaw = 2 * Math.atan2(item.qy, item.qw);
    if (!this.carrying) {
      // It's held by whichever end is nearer, which doesn't change while we carry it.
      const turned = Math.cos(bodyYaw - self.yaw) < 0;
      this.carrying = { id, held: new Vector3(), turned };
    }
    const carrying = this.carrying;
    const trail = new Vector3(self.vx, self.vy, self.vz).scale(CARRY_TRAIL);
    const off = new Vector3(
      item.x - (self.x + Math.sin(self.yaw) * distance - trail.x),
      item.y - (self.y + CARRY_HEIGHT - trail.y),
      item.z - (self.z + Math.cos(self.yaw) * distance - trail.z),
    );
    const beyond = off.length();
    const heldBack = beyond > CARRY_SLACK ? off.scale(1 - CARRY_SLACK / beyond) : Vector3.Zero();
    Vector3.LerpToRef(carrying.held, heldBack, 1 - Math.exp(-CARRY_FOLLOW * dt), carrying.held);

    const yaw = this.camera.rotation.y;
    const position = new Vector3(
      session.predict.value(self, "x") + Math.sin(yaw) * distance,
      session.predict.value(self, "y") + CARRY_HEIGHT,
      session.predict.value(self, "z") + Math.cos(yaw) * distance,
    ).addInPlace(carrying.held);
    view.carryAt(
      position,
      Quaternion.RotationAxis(Vector3.Up(), yaw + (carrying.turned ? Math.PI : 0)),
    );
  }

  /** One rendered frame: look around, send due inputs, put the camera in our player's eyes. */
  update(dt: number): void {
    const controls = this.device.read();
    const { rotation } = this.camera;
    const session = this.session;
    const watched = this.watched();
    const target = watched ? session?.room.state.players.get(watched) : undefined;
    if (session && this.spectating) {
      this.tired.update(1, false, MECHANICS.runAgain, dt);
      // Still one input per step, standing still, so the server's input count keeps up.
      const steps = session.predict.tick(performance.now());
      for (let i = 0; i < steps; i++) {
        session.input.data.moveX = 0;
        session.input.data.moveZ = 0;
        session.input.data.run = false;
        session.input.data.jump = false;
        session.input.send();
      }
      if (target) {
        // Through their eyes: where they stand, looking where they look, level.
        const follow = 1 - Math.exp(-WATCH_TURN * dt);
        const turn = Math.atan2(
          Math.sin(target.yaw - rotation.y),
          Math.cos(target.yaw - rotation.y),
        );
        rotation.y += turn * follow;
        rotation.x += (0 - rotation.x) * follow;
        // Lower, and over the seat, if they sit.
        const seat = target.seat >= 0 ? this.world.level.truck?.seats[target.seat] : undefined;
        const back = seat ? SITTING.eyeBack : 0;
        this.camera.position.set(
          session.predict.value(target, "x") - Math.sin(seat?.yaw ?? 0) * back,
          session.predict.value(target, "y") + (seat ? SITTING.eyeHeight : EYE_HEIGHT),
          session.predict.value(target, "z") - Math.cos(seat?.yaw ?? 0) * back,
        );
        return;
      }
      // Nobody left to watch: look around from where we are.
    }
    // Babylon's yaw turns right as it grows, and its pitch looks down as it grows.
    rotation.y += controls.lookX * LOOK.lookSpeed * dt + controls.dragX * LOOK.dragSpeed;
    rotation.y = Math.atan2(Math.sin(rotation.y), Math.cos(rotation.y));
    rotation.x -= controls.lookY * LOOK.lookSpeed * dt - controls.dragY * LOOK.dragSpeed;
    rotation.x = Math.max(-LOOK.maxPitch, Math.min(LOOK.maxPitch, rotation.x));
    if (this.spectating) return;

    this.tired.update(
      session ? session.predict.value(session.self, "stamina") : 1,
      session?.self.winded ?? false,
      session?.room.state.mechanics.runAgain ?? MECHANICS.runAgain,
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
    const still = this.sit(dt, controls.moveX !== 0 || controls.moveY !== 0 || jump);

    // One input per simulation step, independent of frame rate. On a seat, or getting up, no moving.
    const steps = session.predict.tick(performance.now());
    for (let i = 0; i < steps; i++) {
      session.input.data.moveX = still ? 0 : Math.round(worldX * MOVE_SCALE);
      session.input.data.moveZ = still ? 0 : Math.round(worldZ * MOVE_SCALE);
      session.input.data.yaw = Math.round(rotation.y * YAW_SCALE);
      // Babylon's pitch grows looking down; ours grows looking up.
      session.input.data.pitch = Math.round(-rotation.x * PITCH_SCALE);
      session.input.data.run = !still && running;
      session.input.data.jump = !still && jump;
      session.input.send();
    }

    // Seated, the eyes are lower and back over the seat.
    const sunk = this.seatedness * this.seatedness * (3 - 2 * this.seatedness);
    const back = sunk * SITTING.eyeBack;
    const eye = EYE_HEIGHT + (SITTING.eyeHeight - EYE_HEIGHT) * sunk;
    this.camera.position.set(
      session.predict.value(session.self, "x") - Math.sin(this.seatYaw) * back,
      session.predict.value(session.self, "y") + eye + this.tired.heave * HEAVE.breathHeave,
      session.predict.value(session.self, "z") - Math.cos(this.seatYaw) * back,
    );
  }

  /**
   * Sitting on a seat in the truck: put there, we look across the truck; trying to move gets us
   * up, which takes a moment. Whether we must stay put.
   */
  private sit(dt: number, wantsToMove: boolean): boolean {
    const session = this.session;
    if (!session) return false;
    const seatIndex = session.self.seat;
    const seat = seatIndex >= 0 ? this.world.level.truck?.seats[seatIndex] : undefined;
    if (seat && this.lastSeat < 0) {
      // Just sat down: face the other bench.
      this.camera.rotation.y = seat.yaw;
      this.camera.rotation.x = 0;
      this.rising = 0;
    }
    if (seat) this.seatYaw = seat.yaw;
    // Stood up by the server, as the raid starts, or by us.
    if (!seat && this.lastSeat >= 0 && this.rising <= 0) this.rising = SITTING.standUpTime;
    this.lastSeat = seat ? seatIndex : -1;
    if (seat && wantsToMove && this.rising <= 0) {
      session.room.send("stand");
      this.rising = SITTING.standUpTime;
    }
    this.rising = Math.max(0, this.rising - dt);

    if (seat && this.rising <= 0) {
      this.seatedness = Math.min(1, this.seatedness + dt / SITTING.sitDownTime);
    } else if (this.rising > 0) {
      this.seatedness = Math.min(this.seatedness, this.rising / SITTING.standUpTime);
    } else this.seatedness = 0;
    return seat !== undefined || this.rising > 0;
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
