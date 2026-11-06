import type { HP_BodyId } from "@babylonjs/havok";
import { type Client, type CloseCode, Room, type StepContext } from "@colyseus/core";
import { resolveCircleCircle } from "../../../shared/collision";
import {
  CARRY_HEIGHT,
  canClimb,
  carryDistance,
  DIM_TIME,
  droppingHand,
  grabbingHand,
  HANDS,
  type Hand,
  ITEM_KINDS,
  type ItemKind,
  MAX_PLAYERS,
  MOVE_SCALE,
  PLAYER_COLORS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  TICK_RATE,
  YAW_SCALE,
} from "../../../shared/constants";
import { type Level, levelNamed } from "../../../shared/level";
import { clampMechanics, MECHANICS, type Mechanics as Rules } from "../../../shared/mechanics";
import {
  GAME_LIGHT,
  inside,
  itemValue,
  modeFor,
  type Phase,
  quotaFor,
  RAID_TIME,
  RESULTS_TIME,
  type Role,
  START_TIME,
} from "../../../shared/modes";
import { stepMover } from "../../../shared/movement";
import { load, save } from "../persist";
import { PhysicsWorld } from "../physics";
import { GameState, Item, Mechanics, MoveInput, Player } from "./schema";

/**
 * How far from the player's centre to an item's nearest point they can reach to grab it, or keep
 * holding it while it's down.
 */
const REACH = 1.2;
/** Only what's within this angle either side of where the player looks can be grabbed. */
const GRAB_CONE = (70 * Math.PI) / 180;
/** How high a thing hanging from one hand is held. */
const HAND_HEIGHT = 0.8;
/** How far out to the side of the player's centre a one-handed thing hangs. */
const HAND_SIDE = PLAYER_RADIUS + 0.15;
/** Carried items fall if they stay this far from where they should be, say caught on a shelf. */
const MAX_CARRY_LAG = 1.5;
/** Seconds that takes; a box swinging round when its carrier turns gets there well within it. */
const CARRY_LAG_TIME = 0.4;
/** Carriers can stand this far beyond the ends of a shared item before it falls. */
const MAX_CARRY_SLACK = 2;
/** Items can be grabbed from this far below a player's feet to this far above them. */
const GRAB_BELOW = 0.6;
const GRAB_ABOVE = 2.2;
/** How far from a dimmer a player can reach it, and how high their hand is. */
const DIMMER_REACH = 1.6;
const DIMMER_HAND = 1.3;
/** Seconds a dropped item falls through players before it can be bumped into again. */
const FALL_TIME = 1;
/** Whether players may tune the room's mechanics: everywhere but a production server. */
const TUNABLE = process.env.NODE_ENV !== "production";
/** Seconds to dawn, which `RAID_TIME` in the environment shortens for testing. */
const RAID_SECONDS = Number(process.env.RAID_TIME) || RAID_TIME;
/** How far apart players stand in the truck at the start of a round. */
const TRUCK_SPACING = 0.8;

export interface JoinOptions {
  name?: string;
  /** Which building, from shared/level.ts: each has rooms of its own. */
  level?: string;
  /** What the room is for, from shared/modes.ts, else the level's own: each has rooms of its own. */
  mode?: string;
}

export class GameRoom extends Room<{ state: GameState; input: MoveInput }> {
  maxClients = MAX_PLAYERS;
  state = new GameState({
    mode: "playground",
    phase: "lobby",
    timeLeft: 0,
    loot: 0,
    quota: 0,
    cleared: false,
    light: 1,
    mechanics: new Mechanics({ ...MECHANICS }),
  });

  /** Per-client input buffer. `sanitize` clamps every field as it's decoded — never trust the wire. */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 64,
    sanitize: {
      moveX: [-MOVE_SCALE, MOVE_SCALE],
      moveZ: [-MOVE_SCALE, MOVE_SCALE],
      yaw: [-Math.round(Math.PI * YAW_SCALE), Math.round(Math.PI * YAW_SCALE)],
    },
  });

  private joinCount = 0;
  /** Players holding the dimmer, and which way it fades: 1 brighter, -1 darker. */
  private readonly dimming = new Set<string>();
  private dimDirection = 1;

  private level!: Level;
  private physics!: PhysicsWorld;
  private readonly playerBodies = new Map<string, HP_BodyId>();
  private readonly itemBodies = new Map<string, HP_BodyId>();
  /** Items off the ground: enough people have hold of them. */
  private readonly lifted = new Set<string>();
  /** Dropped items still falling, and the seconds left until they're solid to players. */
  private readonly falling = new Map<string, number>();
  /** Lifted items out of position, and for how many seconds now. */
  private readonly lagging = new Map<string, number>();

  /** Where each player (by name) last was, so a restart or reload puts them back there. */
  private lastSeen = load("lastSeen", {} as Record<string, { x: number; y?: number; z: number }>);

  messages = {
    // Movement arrives through the input buffer above. Register handlers here only for things
    // that aren't per-tick inputs (chat, emotes, abilities, …).
    /** Grab what's in front, with the right hand if it's free, else the left. */
    /** A dimmer in front of the player gets held instead, until `release`. */
    grab: (client: Client) => {
      const player = this.playing(client.sessionId);
      if (!player) return;
      if (this.atDimmer(player)) {
        // Each push fades the other way from the last.
        this.dimDirection = -this.dimDirection;
        this.dimming.add(client.sessionId);
        return;
      }
      const hand = grabbingHand(player);
      if (hand) this.grab(player, hand);
    },
    /** The grab button is up again: stop turning the dimmer. */
    release: (client: Client) => {
      this.dimming.delete(client.sessionId);
    },
    /** Switch the flashlights in the player's hands on, or off if any is on. */
    light: (client: Client) => {
      const player = this.playing(client.sessionId);
      if (!player) return;
      const held = [...new Set(HANDS.map((hand) => player[hand]))]
        .map((id) => this.state.items.get(id))
        .filter((item) => item?.kind === "flashlight");
      const on = !held.some((item) => item?.on);
      for (const item of held) if (item) item.on = on;
    },
    /** Let go of the last thing grabbed. */
    drop: (client: Client) => {
      const player = this.playing(client.sessionId);
      const hand = player && droppingHand(player);
      if (hand) this.drop(client.sessionId, hand);
    },
    /**
     * In a game's lobby, ready to start, or not any more; in the raid, wanting to leave, which only
     * counts in the truck. The truck leaves once everyone alive in the building wants to.
     */
    ready: (client: Client) => {
      const player = this.playing(client.sessionId);
      if (!player || this.state.mode !== "game") return;
      if (this.state.phase === "lobby") player.ready = !player.ready;
      else if (this.state.phase === "raid" && this.inTruck(player)) player.ready = !player.ready;
    },
    /**
     * Change the room's mechanics, for everyone in it (dev only): any of them, each held to its
     * range in MECHANICS_RANGE. Clients predict with the synced values, so nobody rubber-bands.
     */
    tune: (client: Client, asked: Partial<Rules>) => {
      if (!TUNABLE) return;
      const changed = clampMechanics(asked);
      if (Object.keys(changed).length === 0) return;
      Object.assign(this.state.mechanics, changed);
      const player = this.state.players.get(client.sessionId);
      console.log(`${player?.name ?? client.sessionId} tuned`, changed);
    },
  };

  onCreate(options: JoinOptions) {
    this.level = levelNamed(options?.level);
    this.state.mode = modeFor(this.level.name, options?.mode);
    this.state.quota = quotaFor(this.level);
    // The playground's lights are on the dimmer; a game's are dim.
    if (this.state.mode === "game") this.state.light = GAME_LIGHT;
    this.physics = new PhysicsWorld(this.level);
    for (const [i, { kind, x, y, z }] of this.level.items.entries()) {
      const id = `item${i}`;
      this.state.items.set(
        id,
        new Item({ kind, delivered: false, on: false, x, y, z, qx: 0, qy: 0, qz: 0, qw: 1 }),
      );
      this.itemBodies.set(id, this.physics.addItem(kind, x, y, z));
    }
    // Patch as often as we step: at the default 20 Hz, each patch holds one to three ticks of motion.
    this.patchRate = 1000 / TICK_RATE;
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: JoinOptions) {
    const index = this.joinCount++;
    const name = (options?.name ?? "").trim().slice(0, 16) || `player-${index + 1}`;
    const game = this.state.mode === "game";
    // A game starts everyone in the truck; the playground puts them back where they were.
    const spawn = game
      ? this.truckSpot(index)
      : { y: 0, ...(this.lastSeen[this.seenKey(name)] ?? this.level.spawnPoint(index)) };
    // Once a raid has begun, newcomers watch until the next round.
    const role: Role = game && this.state.phase !== "lobby" ? "waiting" : "playing";
    this.state.players.set(
      client.sessionId,
      new Player({
        name,
        color: PLAYER_COLORS[index % PLAYER_COLORS.length],
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        vx: 0,
        vy: 0,
        vz: 0,
        stamina: 1,
        winded: false,
        yaw: 0,
        left: "",
        right: "",
        role,
        ready: false,
      }),
    );
    if (role === "playing") {
      this.playerBodies.set(client.sessionId, this.physics.addPlayer(spawn.x, spawn.y, spawn.z));
    }
    console.log(`${name} (${client.sessionId}) joined, ${role}`);
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left", code);
    for (const hand of HANDS) this.drop(client.sessionId, hand);
    this.dimming.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player && this.state.mode === "playground") {
      // Not while falling, or they'd come back in mid-air.
      if (player.vy === 0) {
        this.lastSeen[this.seenKey(player.name)] = { x: player.x, y: player.y, z: player.z };
      }
      save("lastSeen", this.lastSeen);
    }
    this.state.players.delete(client.sessionId);
    const body = this.playerBodies.get(client.sessionId);
    if (body) this.physics.removeBody(body);
    this.playerBodies.delete(client.sessionId);
  }

  /** Where players were is kept per building; the store's keys are plain names, from before levels. */
  private seenKey(name: string) {
    return this.level.name === "store" ? name : `${this.level.name}:${name}`;
  }

  onDispose() {
    this.physics.dispose();
  }

  /**
   * Take hold of the nearest item in reach and in front of the player that this hand can take: a
   * one-handed thing needs only this hand free, a two-handed one needs both. Shared items must have
   * room for another carrier.
   */
  /** The player of this session, if they're in the building: not dead, lost or waiting. */
  private playing(sessionId: string): Player | undefined {
    const player = this.state.players.get(sessionId);
    return player?.role === "playing" ? player : undefined;
  }

  /** Whether the player stands in the truck, the level's dock for now. */
  private inTruck(player: Player): boolean {
    return inside(this.level.dock, player.x, player.z);
  }

  /** Where the index-th player stands in the truck at the start of a round: in rows across it. */
  private truckSpot(index: number): { x: number; y: number; z: number } {
    const dock = this.level.dock;
    if (!dock) return { ...this.level.spawnPoint(index), y: 0 };
    const across = (min: number, max: number) =>
      Math.max(1, Math.floor((max - min - TRUCK_SPACING) / TRUCK_SPACING) + 1);
    const cols = across(dock.minX, dock.maxX);
    const rows = across(dock.minZ, dock.maxZ);
    const spot = index % (cols * rows);
    const offset = (min: number, max: number, count: number, i: number) =>
      (min + max) / 2 + (i - (count - 1) / 2) * TRUCK_SPACING;
    return {
      x: offset(dock.minX, dock.maxX, cols, spot % cols),
      y: 0,
      z: offset(dock.minZ, dock.maxZ, rows, Math.floor(spot / cols)),
    };
  }

  /**
   * Make a player one of those in the building, at a point, or take them out of it: they drop what
   * they hold, and leave no body for things to bump into.
   */
  private setRole(sessionId: string, player: Player, role: Role, at?: { x: number; z: number }) {
    for (const hand of HANDS) this.drop(sessionId, hand);
    player.role = role;
    player.ready = false;
    const body = this.playerBodies.get(sessionId);
    if (body) this.physics.removeBody(body);
    this.playerBodies.delete(sessionId);
    if (role !== "playing") return;
    if (at) {
      player.x = at.x;
      player.y = 0;
      player.z = at.z;
    }
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.stamina = 1;
    player.winded = false;
    this.playerBodies.set(sessionId, this.physics.addPlayer(player.x, player.y, player.z));
  }

  /** Every player back in the building, standing in the truck, and every item where it started. */
  private resetRound() {
    let index = 0;
    for (const [sessionId, player] of this.state.players) {
      this.setRole(sessionId, player, "playing", this.truckSpot(index++));
    }
    for (const [id, item] of this.state.items) {
      const body = this.itemBodies.get(id);
      if (body) this.putBack(id, body);
      item.on = false;
    }
    this.state.timeLeft = 0;
  }

  /**
   * A game's round: the lobby starts the raid once everyone is ready, the raid ends once everyone
   * alive in the building is in the truck and wants to leave, or at dawn, and the results show for a
   * while before the next round's lobby.
   */
  private runRound(dt: number) {
    const players = [...this.state.players];
    const crew = players.filter(([, player]) => player.role === "playing");
    const phase = this.state.phase as Phase;
    /** Counts the clock down; true as it runs out. */
    const runsOut = () => {
      this.state.timeLeft = Math.max(0, this.state.timeLeft - dt);
      return this.state.timeLeft === 0;
    };
    if (phase === "lobby") {
      const ready = crew.length > 0 && crew.every(([, player]) => player.ready);
      if (!ready) this.state.timeLeft = 0;
      else if (this.state.timeLeft === 0) this.state.timeLeft = START_TIME;
      else if (runsOut()) {
        this.resetRound();
        this.state.phase = "raid";
        this.state.timeLeft = RAID_SECONDS;
        console.log("The raid begins");
      }
    } else if (phase === "raid") {
      for (const [, player] of crew) if (!this.inTruck(player)) player.ready = false;
      runsOut();
      // Everyone alive wants to go, which is also true once nobody is.
      const leaving = crew.every(([, player]) => player.ready);
      if (this.state.timeLeft === 0) {
        // Dawn: the truck goes, and anyone not in it is left behind.
        for (const [sessionId, player] of crew) {
          if (!this.inTruck(player)) this.setRole(sessionId, player, "lost");
        }
      }
      if (leaving || this.state.timeLeft === 0) {
        this.state.cleared = this.state.loot >= this.state.quota;
        this.state.phase = "results";
        this.state.timeLeft = RESULTS_TIME;
        console.log(
          `The raid ends: ${this.state.loot} of ${this.state.quota}, ${this.state.cleared ? "cleared" : "failed"}`,
        );
      }
    } else if (runsOut()) {
      this.resetRound();
      this.state.phase = "lobby";
      this.state.cleared = false;
    }
  }

  /** Whether the player is in reach of the dimmer and looking at it: only in the playground. */
  private atDimmer(player: Player): boolean {
    const target = this.level.dimmer;
    if (!target || this.state.mode !== "playground") return false;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance > DIMMER_REACH || Math.abs(target.y - player.y - DIMMER_HAND) > 1) return false;
    const ahead = dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw);
    return ahead >= distance * Math.cos(GRAB_CONE);
  }

  /** Fade the lights while someone holds the dimmer, turning round at fully on and off. */
  private dim(dt: number) {
    for (const sessionId of this.dimming) {
      const player = this.state.players.get(sessionId);
      if (!player || !this.atDimmer(player)) this.dimming.delete(sessionId);
    }
    if (this.dimming.size === 0) return;
    const light = this.state.light + (this.dimDirection * dt) / DIM_TIME;
    if (light >= 1 || light <= 0) this.dimDirection = -this.dimDirection;
    this.state.light = Math.min(1, Math.max(0, light));
  }

  private grab(player: Player, hand: Hand) {
    const bothFree = !player.left && !player.right;
    let nearest: string | undefined;
    let nearestGap = REACH;
    for (const [id, item] of this.state.items) {
      const kind = this.kindOf(item);
      if (kind.hands === 2 && !bothFree) continue;
      if (this.carriersOf(id).length >= kind.carriers) continue;
      const { gap, x, y, z } = this.nearestPoint(player, item);
      if (y < player.y - GRAB_BELOW || y > player.y + GRAB_ABOVE) continue;
      // Ahead of where the player looks, unless they're already touching it.
      const ahead = (x - player.x) * Math.sin(player.yaw) + (z - player.z) * Math.cos(player.yaw);
      if (gap > PLAYER_RADIUS && ahead < gap * Math.cos(GRAB_CONE)) continue;
      if (gap < nearestGap) {
        nearest = id;
        nearestGap = gap;
      }
    }
    if (!nearest) return;
    const item = this.state.items.get(nearest);
    if (!item) return;
    if (this.kindOf(item).hands === 2) {
      player.left = nearest;
      player.right = nearest;
    } else player[hand] = nearest;
  }

  /** Let go of what's in a hand. Off the ground, that drops it for everyone: one person can't hold up a sofa. */
  private drop(sessionId: string, hand: Hand) {
    const player = this.state.players.get(sessionId);
    const id = player?.[hand];
    if (!player || !id) return;
    for (const other of HANDS) if (player[other] === id) player[other] = "";
    const item = this.state.items.get(id);
    const body = this.itemBodies.get(id);
    if (item && body && this.lifted.delete(id)) {
      this.physics.letGo(body);
      this.lagging.delete(id);
      this.falling.set(id, FALL_TIME);
      this.dropItem(id);
    }
  }

  private dropItem(id: string) {
    for (const [sessionId, player] of this.state.players) {
      for (const hand of HANDS) if (player[hand] === id) this.drop(sessionId, hand);
    }
  }

  /**
   * Fell to their death. In a raid, that's them out until the next round; anywhere else, back to the
   * start, empty-handed.
   */
  private fell(sessionId: string, player: Player) {
    if (this.state.mode === "game" && this.state.phase === "raid") {
      this.setRole(sessionId, player, "dead");
      console.log(`${player.name} fell to their death`);
      return;
    }
    const spawn =
      this.state.mode === "game"
        ? this.truckSpot(this.joinCount++)
        : this.level.spawnPoint(this.joinCount++);
    this.setRole(sessionId, player, "playing", spawn);
    console.log(`${player.name} fell`);
  }

  /** An item that fell out of the level goes back where it started. */
  private putBack(id: string, body: HP_BodyId) {
    const spawn = this.level.items[Number(id.slice("item".length))];
    const item = this.state.items.get(id);
    if (!spawn || !item) return;
    this.dropItem(id);
    // Dropped just now, or a while ago and still falling: solid to players again.
    if (this.falling.delete(id)) this.physics.settle(body, item.kind as ItemKind);
    this.physics.place(body, spawn.x, spawn.y, spawn.z);
    this.physics.readPose(body, item);
  }

  private kindOf(item: Item) {
    return ITEM_KINDS[item.kind as ItemKind];
  }

  private carriersOf(id: string): [string, Player][] {
    return [...this.state.players].filter(
      ([, player]) => player.left === id || player.right === id,
    );
  }

  /**
   * The point of an item nearest to the player, however it's turned or tipped over, and how far it
   * is from the player's centre on the ground.
   */
  private nearestPoint(
    player: Player,
    item: Item,
  ): { gap: number; x: number; y: number; z: number } {
    const size = this.kindOf(item).size;
    const q = { x: item.qx, y: item.qy, z: item.qz, w: item.qw };
    // Into the item's own frame, clamp to its box, and back out again.
    const waist = player.y + PLAYER_HEIGHT / 2;
    const local = rotate({ ...q, w: -q.w }, player.x - item.x, waist - item.y, player.z - item.z);
    const clamped = local.map((value, axis) =>
      Math.max(-size[axis] / 2, Math.min(size[axis] / 2, value)),
    );
    const [x, y, z] = rotate(q, clamped[0], clamped[1], clamped[2]);
    return {
      gap: Math.hypot(item.x + x - player.x, item.z + z - player.z),
      x: item.x + x,
      y: item.y + y,
      z: item.z + z,
    };
  }

  /** Steer everything being carried, and let go of whatever can't be held any more. */
  private carryItems(dt: number) {
    for (const [id, item] of this.state.items) {
      const carriers = this.carriersOf(id);
      const kind = this.kindOf(item);
      if (carriers.length < kind.carriers) {
        // Not enough people to lift it: they can only stand there holding on.
        if (carriers.some(([, player]) => this.nearestPoint(player, item).gap > REACH)) {
          this.dropItem(id);
        }
        continue;
      }
      if (carriers.length === 0) continue;

      const body = this.itemBodies.get(id);
      if (!body) continue;
      if (!this.lifted.has(id)) {
        this.lifted.add(id);
        this.falling.delete(id);
        this.physics.lift(body, item.kind as ItemKind);
      }

      const target = this.carryTarget(id, carriers, kind);
      if (!target) {
        this.dropItem(id);
        continue;
      }
      const front = "front" in kind && kind.front;
      const lag = this.physics.carry(body, target.x, target.y, target.z, target.yaw, front);
      const lagTime = lag > MAX_CARRY_LAG ? (this.lagging.get(id) ?? 0) + dt : 0;
      this.lagging.set(id, lagTime);
      if (lagTime > CARRY_LAG_TIME) this.dropItem(id);
    }
  }

  /**
   * Between two carriers, in front of one carrying it in both arms, or hanging at their side from one
   * hand; undefined if the carriers are too far apart.
   */
  private carryTarget(
    id: string,
    carriers: [string, Player][],
    kind: (typeof ITEM_KINDS)[ItemKind],
  ) {
    const [length, , depth] = kind.size;
    const [[, first], second] = carriers;
    if (second) {
      const dx = second[1].x - first.x;
      const dz = second[1].z - first.z;
      if (Math.hypot(dx, dz) > length + MAX_CARRY_SLACK) return undefined;
      return {
        x: (first.x + second[1].x) / 2,
        y: (first.y + second[1].y) / 2 + CARRY_HEIGHT,
        z: (first.z + second[1].z) / 2,
        yaw: Math.atan2(-dz, dx),
      };
    }
    // Where the player looks, so what they carry stays in view.
    const facing = { x: Math.sin(first.yaw), z: Math.cos(first.yaw) };
    if (kind.hands === 2) {
      // Crosswise in both arms, its long side along the player's right, like a TV.
      const distance = carryDistance(depth);
      return {
        x: first.x + facing.x * distance,
        y: first.y + CARRY_HEIGHT,
        z: first.z + facing.z * distance,
        yaw: Math.atan2(facing.x, facing.z),
      };
    }
    // Hanging from one hand, its long side pointing the way the player walks.
    const right = { x: facing.z, z: -facing.x };
    const side = (first.right === id ? 1 : -1) * (HAND_SIDE + depth / 2);
    const ahead = 0.15;
    return {
      x: first.x + right.x * side + facing.x * ahead,
      y: first.y + HAND_HEIGHT,
      z: first.z + right.z * side + facing.z * ahead,
      yaw: Math.atan2(-facing.z, facing.x),
    };
  }

  private step(ctx: StepContext) {
    // 1. Apply every buffered input — the same step the client predicts with.
    // Only those in the building move; everyone else's inputs are used up and ignored.
    for (const [sessionId, player] of this.state.players) {
      const channel = this.inputs.get(sessionId);
      if (!channel) continue;
      for (const input of channel) {
        if (player.role !== "playing") continue;
        stepMover(player, input, ctx.dt, this.level, this.state.mechanics, canClimb(player));
        player.yaw = input.yaw / YAW_SCALE;
      }
      if (player.role === "playing" && player.y < this.level.killY) this.fell(sessionId, player);
    }

    this.dim(ctx.dt);

    // 2. Push overlapping players apart (server-only; clients get corrected).
    const players = [...this.state.players.values()].filter((p) => p.role === "playing");
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        if (Math.abs(players[i].y - players[j].y) > PLAYER_HEIGHT) continue;
        const a = { x: players[i].x, z: players[i].z, radius: PLAYER_RADIUS };
        const b = { x: players[j].x, z: players[j].z, radius: PLAYER_RADIUS };
        if (resolveCircleCircle(a, b)) {
          players[i].x = a.x;
          players[i].z = a.z;
          players[j].x = b.x;
          players[j].z = b.z;
        }
      }
    }

    // 3. Physics, with players where they ended up: they shove items, items never stop them.
    for (const [sessionId, player] of this.state.players) {
      const body = this.playerBodies.get(sessionId);
      if (body) this.physics.movePlayer(body, player.x, player.y, player.z);
    }
    this.carryItems(ctx.dt);
    for (const [id, left] of this.falling) {
      const item = this.state.items.get(id);
      const body = this.itemBodies.get(id);
      if (left > ctx.dt) this.falling.set(id, left - ctx.dt);
      else {
        this.falling.delete(id);
        if (item && body) this.physics.settle(body, item.kind as ItemKind);
      }
    }
    this.physics.step(ctx.dt);
    let loot = 0;
    for (const [id, item] of this.state.items) {
      const body = this.itemBodies.get(id);
      if (body) this.physics.readPose(body, item);
      if (body && item.y < this.level.killY) this.putBack(id, body);
      const inDock = inside(this.level.dock, item.x, item.z);
      item.delivered = inDock && !this.lifted.has(id);
      // In the truck, even still in someone's hands.
      if (inDock) loot += itemValue(item.kind as ItemKind);
    }
    this.state.loot = loot;

    if (this.state.mode === "game") this.runRound(ctx.dt);
  }
}

/** A vector turned by a unit quaternion. Negating w gives the opposite turn. */
function rotate(
  q: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  // v + 2w(u × v) + 2u × (u × v), with u the quaternion's vector part.
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [
    x + q.w * tx + (q.y * tz - q.z * ty),
    y + q.w * ty + (q.z * tx - q.x * tz),
    z + q.w * tz + (q.x * ty - q.y * tx),
  ];
}
