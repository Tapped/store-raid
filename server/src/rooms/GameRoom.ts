import type { HP_BodyId } from "@babylonjs/havok";
import { type Client, type CloseCode, Room, type StepContext } from "@colyseus/core";
import { resolveCircleCircle } from "../../../shared/collision";
import {
  MAX_PLAYERS,
  MOVE_SCALE,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  TICK_RATE,
} from "../../../shared/constants";
import { CRATE_SPAWNS, spawnPoint } from "../../../shared/level";
import { stepMover } from "../../../shared/movement";
import { load, save } from "../persist";
import { PhysicsWorld } from "../physics";
import { Crate, GameState, MoveInput, Player } from "./schema";

export interface JoinOptions {
  name?: string;
}

export class GameRoom extends Room<{ state: GameState; input: MoveInput }> {
  maxClients = MAX_PLAYERS;
  state = new GameState();

  /** Per-client input buffer. `sanitize` clamps every field as it's decoded — never trust the wire. */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 64,
    sanitize: { moveX: [-MOVE_SCALE, MOVE_SCALE], moveZ: [-MOVE_SCALE, MOVE_SCALE] },
  });

  private joinCount = 0;

  private readonly physics = new PhysicsWorld();
  private readonly playerBodies = new Map<string, HP_BodyId>();
  private readonly crateBodies = new Map<string, HP_BodyId>();

  /** Where each player (by name) last was, so a restart or reload puts them back there. */
  private lastSeen = load("lastSeen", {} as Record<string, { x: number; z: number }>);

  messages = {
    // Movement arrives through the input buffer above. Register handlers here only for things
    // that aren't per-tick inputs (chat, emotes, abilities, …).
  };

  onCreate() {
    for (const [i, { x, y, z }] of CRATE_SPAWNS.entries()) {
      const id = `crate${i}`;
      this.state.crates.set(id, new Crate({ x, y, z, qx: 0, qy: 0, qz: 0, qw: 1 }));
      this.crateBodies.set(id, this.physics.addCrate(x, y, z));
    }
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: JoinOptions) {
    const index = this.joinCount++;
    const name = (options?.name ?? "").trim().slice(0, 16) || `player-${index + 1}`;
    const spawn = this.lastSeen[name] ?? spawnPoint(index);
    this.state.players.set(
      client.sessionId,
      new Player({
        name,
        color: PLAYER_COLORS[index % PLAYER_COLORS.length],
        x: spawn.x,
        z: spawn.z,
        vx: 0,
        vz: 0,
      }),
    );
    this.playerBodies.set(client.sessionId, this.physics.addPlayer(spawn.x, spawn.z));
    console.log(`${name} (${client.sessionId}) joined`);
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left", code);
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.lastSeen[player.name] = { x: player.x, z: player.z };
      save("lastSeen", this.lastSeen);
    }
    this.state.players.delete(client.sessionId);
    const body = this.playerBodies.get(client.sessionId);
    if (body) this.physics.removeBody(body);
    this.playerBodies.delete(client.sessionId);
  }

  onDispose() {
    this.physics.dispose();
  }

  private step(ctx: StepContext) {
    // 1. Apply every buffered input — the same step the client predicts with.
    for (const [sessionId, player] of this.state.players) {
      const channel = this.inputs.get(sessionId);
      if (!channel) continue;
      for (const input of channel) {
        stepMover(player, input, ctx.dt);
      }
    }

    // 2. Push overlapping players apart (server-only; clients get corrected).
    const players = [...this.state.players.values()];
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
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

    // 3. Physics, with players where they ended up: they shove crates, crates never stop them.
    for (const [sessionId, player] of this.state.players) {
      const body = this.playerBodies.get(sessionId);
      if (body) this.physics.movePlayer(body, player.x, player.z);
    }
    this.physics.step(ctx.dt);
    for (const [id, crate] of this.state.crates) {
      const body = this.crateBodies.get(id);
      if (body) this.physics.readPose(body, crate);
    }
  }
}
