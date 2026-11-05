import type { HP_BodyId } from "@babylonjs/havok";
import { type Client, type CloseCode, Room, type StepContext } from "@colyseus/core";
import { resolveCircleCircle } from "../../../shared/collision";
import {
  canClimb,
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
import { stepMover } from "../../../shared/movement";
import { load, save } from "../persist";
import { PhysicsWorld } from "../physics";
import { GameState, Item, MoveInput, Player } from "./schema";

/**
 * How far from the player's centre to an item's nearest point they can reach to grab it, or keep
 * holding it while it's down.
 */
const REACH = 1.2;
/** Only what's within this angle either side of where the player looks can be grabbed. */
const GRAB_CONE = (70 * Math.PI) / 180;
/** How high things are held: in both arms, or hanging from one hand. */
const CARRY_HEIGHT = 1;
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

export interface JoinOptions {
  name?: string;
  /** Which building, from shared/level.ts: each has rooms of its own. */
  level?: string;
}

export class GameRoom extends Room<{ state: GameState; input: MoveInput }> {
  maxClients = MAX_PLAYERS;
  state = new GameState();

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
      const player = this.state.players.get(client.sessionId);
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
    /** Let go of the last thing grabbed. */
    drop: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      const hand = player && droppingHand(player);
      if (hand) this.drop(client.sessionId, hand);
    },
  };

  onCreate(options: JoinOptions) {
    this.level = levelNamed(options?.level);
    this.physics = new PhysicsWorld(this.level);
    this.state.light = 1;
    for (const [i, { kind, x, y, z }] of this.level.items.entries()) {
      const id = `item${i}`;
      this.state.items.set(
        id,
        new Item({ kind, delivered: false, x, y, z, qx: 0, qy: 0, qz: 0, qw: 1 }),
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
    const spawn = { y: 0, ...(this.lastSeen[this.seenKey(name)] ?? this.level.spawnPoint(index)) };
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
        yaw: 0,
        left: "",
        right: "",
      }),
    );
    this.playerBodies.set(client.sessionId, this.physics.addPlayer(spawn.x, spawn.y, spawn.z));
    console.log(`${name} (${client.sessionId}) joined`);
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left", code);
    for (const hand of HANDS) this.drop(client.sessionId, hand);
    this.dimming.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) {
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
  /** Whether the player is in reach of the dimmer and looking at it. */
  private atDimmer(player: Player): boolean {
    const target = this.level.dimmer;
    if (!target) return false;
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

  /** Fell to their death: back to the start, empty-handed. */
  private respawn(sessionId: string, player: Player) {
    for (const hand of HANDS) this.drop(sessionId, hand);
    const spawn = this.level.spawnPoint(this.joinCount++);
    player.x = spawn.x;
    player.y = 0;
    player.z = spawn.z;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    console.log(`${player.name} fell`);
  }

  /** An item that fell out of the level goes back where it started. */
  private putBack(id: string, body: HP_BodyId) {
    const spawn = this.level.items[Number(id.slice("item".length))];
    const item = this.state.items.get(id);
    if (!spawn || !item) return;
    this.dropItem(id);
    this.falling.delete(id);
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
      const lag = this.physics.carry(body, target.x, target.y, target.z, target.yaw);
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
      const distance = PLAYER_RADIUS + depth / 2 + 0.2;
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
    for (const [sessionId, player] of this.state.players) {
      const channel = this.inputs.get(sessionId);
      if (!channel) continue;
      for (const input of channel) {
        stepMover(player, input, ctx.dt, this.level, canClimb(player));
        player.yaw = input.yaw / YAW_SCALE;
      }
      if (player.y < this.level.killY) this.respawn(sessionId, player);
    }

    this.dim(ctx.dt);

    // 2. Push overlapping players apart (server-only; clients get corrected).
    const players = [...this.state.players.values()];
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
    for (const [id, item] of this.state.items) {
      const body = this.itemBodies.get(id);
      if (body) this.physics.readPose(body, item);
      if (body && item.y < this.level.killY) this.putBack(id, body);
      const dock = this.level.dock;
      item.delivered =
        !!dock &&
        !this.lifted.has(id) &&
        item.x > dock.minX &&
        item.x < dock.maxX &&
        item.z > dock.minZ &&
        item.z < dock.maxZ;
    }
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
