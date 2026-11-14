import { resolveCircleBox } from "../../shared/collision";
import { grabbingHand } from "../../shared/constants";
import type { Level, LevelBox } from "../../shared/level";
import { inside } from "../../shared/modes";
import { groundUnder, paceAt } from "../../shared/movement";
import { near } from "../../shared/spatial";
import {
  type Beam,
  clearLine,
  darkWay,
  findPath,
  fittingOver,
  inBeam,
  LATCH_AHEAD,
  LATCH_HEIGHT,
  litByFittings,
  type Perch,
  perches,
  standing,
  TICK,
  TICK_HEIGHT,
  TICK_RADIUS,
  type TickState,
  tickCount,
} from "../../shared/ticks";
import { type GameState, type Player, Tick } from "./rooms/schema";

/** How many ticks a level starts with, when `TICKS` in the environment says: 0 for none. */
const COUNT = process.env.TICKS === undefined ? undefined : Number(process.env.TICKS);
/** How high on a player a leap or a drop is aimed, above their feet. */
const AIM_HEIGHT = 1.3;
/** How high above a tick's feet its middle is: where light has to reach. */
const MIDDLE = 0.2;
/** Seconds a tick keeps going once it's out of a fitting's light, to get clear of its edge. */
const FITTING_AFRAID = 0.4;
/** Seconds between looking for a new way to its prey, and before trying again when there was none. */
const REPATH = 0.5;
const REPATH_LOST = 2;
/** How fast someone throws a tick off, along the floor and up, in meters a second. */
const THROW = { along: 3.5, up: 2 };

interface Point {
  x: number;
  y: number;
  z: number;
}

/** What the server knows about a tick besides what it syncs. */
interface Mind {
  /** Where it started, to go back to if it falls out of the level. */
  home: Perch;
  vx: number;
  vy: number;
  vz: number;
  /** The racking it dropped off, which it falls past; everything else stops it in the air. */
  off?: LevelBox;
  /** What it does when it lands: hunt, or lie stunned. */
  landAs: "hunting" | "stunned";
  /** Seconds it stays afraid of the light, and where that light was. */
  afraid: number;
  from?: Point;
  /** Seconds until it can leap again. */
  rest: number;
  /** Counts down: lying stunned, or standing before it wanders on. */
  timer: number;
  /** The way to its prey, and seconds until it looks for a new one. */
  path?: Point[];
  repath: number;
  /** Where it's wandering to. */
  goal?: Point;
  /** Which way round something it goes when a light is behind it and a wall ahead. */
  side: number;
  /** Seconds someone else's beam has been on it while it's latched. */
  shone: number;
}

/**
 * The ticks of one room, moved on the server (see shared/ticks.ts for what they do). They're
 * synced as `state.ticks`; clients only draw them.
 */
export class Ticks {
  private readonly minds = new Map<string, Mind>();
  private readonly perches: Perch[];

  constructor(
    private readonly state: GameState,
    private readonly level: Level,
    /** Takes health from a player a tick is on. True if that was the last of it. */
    private readonly hurt: (sessionId: string, player: Player, amount: number) => boolean,
  ) {
    this.perches = perches(level);
  }

  /** Every tick back where a raid starts them: on perches picked at random, waiting. */
  reset() {
    this.state.ticks.clear();
    this.minds.clear();
    const spots = [...this.perches];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const count = Math.min(spots.length, COUNT ?? tickCount(this.level, spots.length));
    for (let i = 0; i < count; i++) {
      const home = spots[i];
      const state: TickState = home.box ? "perched" : "wandering";
      this.state.ticks.set(
        `tick${i}`,
        new Tick({
          x: home.x,
          y: home.y,
          z: home.z,
          yaw: Math.random() * Math.PI * 2,
          state,
          victim: "",
        }),
      );
      this.minds.set(`tick${i}`, {
        home,
        vx: 0,
        vy: 0,
        vz: 0,
        landAs: "hunting",
        afraid: 0,
        rest: 0,
        timer: Math.random() * 3,
        repath: 0,
        side: Math.random() < 0.5 ? 1 : -1,
        shone: 0,
      });
    }
  }

  /**
   * A player grabs at a tick: the one on them, or one on someone in front of them. It takes a free
   * hand. True if they pulled one off, which is then all their grab does.
   */
  pull(sessionId: string, player: Player): boolean {
    if (!grabbingHand(player)) return false;
    for (const [id, tick] of this.state.ticks) {
      if (tick.state !== "latched") continue;
      const mind = this.minds.get(id);
      const victim = this.state.players.get(tick.victim);
      if (!mind || !victim) continue;
      if (tick.victim !== sessionId) {
        const dx = victim.x - player.x;
        const dz = victim.z - player.z;
        const distance = Math.hypot(dx, dz);
        if (distance > TICK.reach || Math.abs(victim.y - player.y) > 1.5) continue;
        const ahead = dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw);
        if (ahead < distance * 0.35) continue;
      }
      // Thrown the way its victim faces, or off to the side of whoever pulled it from someone.
      const yaw = tick.victim === sessionId ? player.yaw : player.yaw + Math.PI / 2;
      this.throwOff(tick, mind, yaw, "stunned");
      return true;
    }
    return false;
  }

  /**
   * One step of every tick. `urgency` runs from 0 as a raid starts to 1 at dawn: they get faster,
   * and past half way those still perched start coming down by themselves.
   */
  step(dt: number, urgency: number) {
    if (this.state.ticks.size === 0) return;
    const players = [...this.state.players].filter(([, player]) => player.role === "playing");
    const beams = this.beams();
    // With a playground's lights up, they only wander.
    const bright = this.state.mode === "playground" && this.state.light > TICK.bright;
    const haste = 1 + (TICK.dawn - 1) * urgency;

    for (const [id, tick] of this.state.ticks) {
      const mind = this.minds.get(id);
      if (!mind) continue;
      const light = this.lightOn(tick, mind, beams);
      // On the floor in the light of a fitting, carried or thrown there: it gets out of it, as
      // from a beam. Left there it would never move again, with nowhere dark near to wander to.
      const walking =
        tick.state === "wandering" || tick.state === "hunting" || tick.state === "fleeing";
      const fitting = walking ? fittingOver(this.level, tick.x, tick.y, tick.z) : undefined;
      if (light) {
        mind.afraid = TICK.afraid;
        mind.from = light;
      } else if (fitting) {
        mind.afraid = Math.max(mind.afraid, FITTING_AFRAID);
        mind.from = fitting;
      } else mind.afraid = Math.max(0, mind.afraid - dt);
      mind.rest = Math.max(0, mind.rest - dt);

      switch (tick.state as TickState) {
        case "perched":
        case "wary":
          this.perch(tick, mind, players, bright, urgency, dt);
          break;
        case "airborne":
          this.fly(tick, mind, players, dt);
          break;
        case "latched":
          this.feed(tick, mind, light !== undefined, dt);
          break;
        case "stunned":
          mind.timer -= dt;
          if (mind.timer <= 0) {
            tick.state = "hunting";
            mind.rest = Math.max(mind.rest, 1);
          }
          break;
        case "wandering":
          if (mind.afraid > 0) tick.state = "fleeing";
          else if (!bright && this.prey(tick, players)) tick.state = "hunting";
          else this.wander(tick, mind, dt);
          break;
        case "hunting":
          if (mind.afraid > 0) tick.state = "fleeing";
          else if (bright) tick.state = "wandering";
          else this.hunt(tick, mind, players, haste, dt);
          break;
        case "fleeing":
          if (mind.afraid <= 0) {
            tick.state = "hunting";
            mind.rest = Math.max(mind.rest, 1);
            mind.path = undefined;
            mind.repath = 0;
          } else this.flee(tick, mind, haste, dt);
          break;
      }
    }
  }

  /** Every flashlight that's on: held ones point where their holder looks, dropped ones as they lie. */
  private beams(): Beam[] {
    const beams: Beam[] = [];
    for (const [id, item] of this.state.items) {
      if (item.kind !== "flashlight" || !item.on) continue;
      const held = [...this.state.players].find(
        ([, player]) => player.role === "playing" && (player.left === id || player.right === id),
      );
      if (held) {
        const [holder, player] = held;
        const level = Math.cos(player.pitch);
        beams.push({
          x: player.x,
          y: player.y + 1.45,
          z: player.z,
          dx: Math.sin(player.yaw) * level,
          dy: Math.sin(player.pitch),
          dz: Math.cos(player.yaw) * level,
          holder,
        });
      } else {
        // Its lens is at +x: that axis, turned as the flashlight lies.
        const { qx, qy, qz, qw } = item;
        beams.push({
          x: item.x,
          y: item.y,
          z: item.z,
          dx: 1 - 2 * (qy * qy + qz * qz),
          dy: 2 * (qx * qy + qz * qw),
          dz: 2 * (qx * qz - qy * qw),
        });
      }
    }
    return beams;
  }

  /** The beam that reaches a tick, if any. Its own victim's doesn't count: they can't aim it at it. */
  private lightOn(tick: Tick, mind: Mind, beams: Beam[]): Beam | undefined {
    const middle = { x: tick.x, y: tick.y + MIDDLE, z: tick.z };
    const under = tick.state === "perched" || tick.state === "wary" ? mind.home.box : undefined;
    return beams.find(
      (beam) =>
        !(tick.victim && beam.holder === tick.victim) &&
        inBeam(beam, middle) &&
        clearLine(this.level, beam, middle, under),
    );
  }

  private hasTick(sessionId: string): boolean {
    for (const tick of this.state.ticks.values()) if (tick.victim === sessionId) return true;
    return false;
  }

  /** The nearest player a tick on the floor can sense: in the dark, out of the truck, tick-free. */
  private prey(tick: Tick, players: [string, Player][]): [string, Player] | undefined {
    let nearest: [string, Player] | undefined;
    let least: number = TICK.sense;
    for (const entry of players) {
      const [sessionId, player] = entry;
      if (Math.abs(player.y - tick.y) > TICK.senseHeight) continue;
      const distance = Math.hypot(player.x - tick.x, player.z - tick.z);
      if (distance >= least || this.hasTick(sessionId)) continue;
      if (inside(this.level.dock, player.x, player.z)) continue;
      if (litByFittings(this.level, player.x, player.y, player.z)) continue;
      nearest = entry;
      least = distance;
    }
    return nearest;
  }

  /** Waiting on its perch: it drops on whoever comes under it, unless a light has found it. */
  private perch(
    tick: Tick,
    mind: Mind,
    players: [string, Player][],
    bright: boolean,
    urgency: number,
    dt: number,
  ) {
    tick.state = mind.afraid > 0 ? "wary" : "perched";
    if (mind.afraid > 0 || bright) return;
    for (const [sessionId, player] of players) {
      const above = tick.y - player.y;
      if (above < 1 || above > 4.5 || this.hasTick(sessionId)) continue;
      if (Math.hypot(player.x - tick.x, player.z - tick.z) > TICK.dropRange) continue;
      // Onto where they'll be when it gets there.
      const time = this.fallTime(above - AIM_HEIGHT);
      this.launch(
        tick,
        mind,
        {
          x: player.x + player.vx * time,
          y: player.y + AIM_HEIGHT,
          z: player.z + player.vz * time,
        },
        time,
        mind.home.box,
      );
      return;
    }
    // As dawn nears, they stop waiting and come down to look.
    if (urgency > 0.5 && Math.random() < dt / 40) {
      const box = mind.home.box;
      for (let i = 0; box && i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + tick.yaw;
        const reach = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 0.8;
        const x = tick.x + Math.sin(angle) * Math.min(reach, 1.6);
        const z = tick.z + Math.cos(angle) * Math.min(reach, 1.6);
        const y = standing(this.level, x, box.y, z, this.state.mechanics);
        if (y === undefined) continue;
        this.launch(tick, mind, { x, y, z }, this.fallTime(tick.y - y), box);
        return;
      }
    }
  }

  /** Seconds to fall `height` meters, after a small hop up. */
  private fallTime(height: number): number {
    const hop = 1.5;
    return (hop + Math.sqrt(hop * hop + 2 * TICK.gravity * Math.max(0, height))) / TICK.gravity;
  }

  /** Into the air, to be at `to` after `time` seconds; `off` is the racking it leaves, if it drops. */
  private launch(tick: Tick, mind: Mind, to: Point, time: number, off?: LevelBox) {
    mind.off = off;
    mind.vx = (to.x - tick.x) / time;
    mind.vz = (to.z - tick.z) / time;
    mind.vy = (to.y - tick.y + 0.5 * TICK.gravity * time * time) / time;
    mind.landAs = "hunting";
    mind.path = undefined;
    mind.repath = 0;
    tick.yaw = Math.atan2(mind.vx, mind.vz);
    tick.state = "airborne";
  }

  /** Off whoever it's on, thrown the way `yaw` points. */
  private throwOff(tick: Tick, mind: Mind, yaw: number, landAs: Mind["landAs"]) {
    tick.victim = "";
    mind.vx = Math.sin(yaw) * THROW.along;
    mind.vz = Math.cos(yaw) * THROW.along;
    mind.vy = THROW.up;
    mind.landAs = landAs;
    mind.shone = 0;
    mind.off = undefined;
    tick.state = "airborne";
  }

  /**
   * In the air: it latches onto a player it passes, stops at whatever is in the way, racking as
   * much as walls, so it never lands inside something, and lands on the floor.
   */
  private fly(tick: Tick, mind: Mind, players: [string, Player][], dt: number) {
    const before = tick.y;
    mind.vy -= TICK.gravity * dt;
    const circle = { x: tick.x + mind.vx * dt, z: tick.z + mind.vz * dt, radius: TICK_RADIUS };
    tick.y += mind.vy * dt;
    for (const box of near(this.level.boxes, circle.x, circle.z)) {
      if (box === mind.off) continue;
      if (box.y + box.height <= tick.y || box.y >= tick.y + TICK_HEIGHT) continue;
      const { dx, dz } = resolveCircleBox(circle, box);
      if (dx !== 0) mind.vx = 0;
      if (dz !== 0) mind.vz = 0;
    }
    tick.x = circle.x;
    tick.z = circle.z;

    if (mind.landAs === "hunting" && mind.afraid <= 0) {
      for (const [sessionId, player] of players) {
        if (tick.y < player.y + 0.4 || tick.y > player.y + 2) continue;
        if (Math.hypot(player.x - tick.x, player.z - tick.z) > TICK.latch) continue;
        if (this.hasTick(sessionId)) continue;
        tick.victim = sessionId;
        tick.state = "latched";
        mind.shone = 0;
        return;
      }
    }
    const ground = groundUnder(this.level, tick.x, tick.z, Math.max(before, tick.y) + 0.3);
    if (mind.vy <= 0 && tick.y <= ground) {
      tick.y = ground;
      mind.vx = 0;
      mind.vz = 0;
      mind.off = undefined;
      this.stepOut(tick);
      if (mind.landAs === "stunned") {
        tick.state = "stunned";
        mind.timer = TICK.stun;
      } else tick.state = mind.afraid > 0 ? "fleeing" : "hunting";
      mind.rest = Math.max(mind.rest, 0.8);
    } else if (tick.y < this.level.killY) {
      // Fell out of the level: back where it started.
      tick.x = mind.home.x;
      tick.y = mind.home.y;
      tick.z = mind.home.z;
      tick.state = mind.home.box ? "perched" : "wandering";
    }
  }

  /**
   * Out of whatever a tick has landed in, to the nearest side: the racking it dropped off, when
   * something stopped it on the way down. Inside a box it could neither walk nor find a way.
   */
  private stepOut(tick: Tick) {
    const m = this.state.mechanics;
    const circle = { x: tick.x, z: tick.z, radius: TICK_RADIUS };
    for (let pass = 0; pass < 2; pass++) {
      for (const box of near(this.level.boxes, circle.x, circle.z)) {
        if (box.y + box.height <= tick.y + m.stepUp || box.y >= tick.y + TICK_HEIGHT) continue;
        resolveCircleBox(circle, box);
      }
    }
    const ground = groundUnder(this.level, circle.x, circle.z, tick.y + m.stepUp);
    if (!Number.isFinite(ground) || Math.abs(ground - tick.y) > m.stepDown + 0.3) return;
    tick.x = circle.x;
    tick.y = ground;
    tick.z = circle.z;
  }

  /** On a player: it rides in front of their face and drains them, until pulled or shone off. */
  private feed(tick: Tick, mind: Mind, shone: boolean, dt: number) {
    const victim = this.state.players.get(tick.victim);
    if (victim?.role !== "playing") {
      this.fall(tick, mind);
      return;
    }
    tick.x = victim.x + Math.sin(victim.yaw) * LATCH_AHEAD;
    tick.y = victim.y + LATCH_HEIGHT;
    tick.z = victim.z + Math.cos(victim.yaw) * LATCH_AHEAD;
    tick.yaw = victim.yaw + Math.PI;
    // Someone else's light on it for a moment, and it lets go, away from the light.
    mind.shone = shone ? mind.shone + dt : 0;
    if (mind.shone > TICK.letGo && mind.from) {
      const yaw = Math.atan2(tick.x - mind.from.x, tick.z - mind.from.z);
      this.throwOff(tick, mind, yaw, "hunting");
      return;
    }
    if (this.hurt(tick.victim, victim, TICK.bite * dt)) this.fall(tick, mind);
  }

  /** Lets go and drops to the floor. */
  private fall(tick: Tick, mind: Mind) {
    tick.victim = "";
    mind.vx = 0;
    mind.vy = 0;
    mind.vz = 0;
    mind.landAs = "hunting";
    mind.rest = TICK.leapRest;
    mind.off = undefined;
    tick.state = "airborne";
  }

  /** Nobody to hunt: a few steps to somewhere near, a pause, and on. */
  private wander(tick: Tick, mind: Mind, dt: number) {
    if (!mind.goal) {
      mind.timer -= dt;
      if (mind.timer > 0) return;
      const angle = Math.random() * Math.PI * 2;
      const far = 1 + Math.random() * 2;
      const goal = {
        x: tick.x + Math.sin(angle) * far,
        y: tick.y,
        z: tick.z + Math.cos(angle) * far,
      };
      const at = { x: tick.x, y: tick.y + MIDDLE, z: tick.z };
      const clear =
        standing(this.level, goal.x, tick.y, goal.z, this.state.mechanics, true) !== undefined &&
        clearLine(this.level, at, { ...goal, y: at.y });
      if (clear) mind.goal = goal;
      else mind.timer = 0.5;
      return;
    }
    const dx = mind.goal.x - tick.x;
    const dz = mind.goal.z - tick.z;
    const speed: number = TICK.wander;
    if (Math.hypot(dx, dz) < 0.15 || this.walk(tick, dx, dz, speed, dt) < speed * dt * 0.3) {
      mind.goal = undefined;
      mind.timer = 1.5 + Math.random() * 3;
    }
  }

  /** After its prey: round what's in the way, and a leap once it's near. */
  private hunt(tick: Tick, mind: Mind, players: [string, Player][], haste: number, dt: number) {
    const prey = this.prey(tick, players);
    if (!prey) {
      tick.state = "wandering";
      mind.goal = undefined;
      mind.path = undefined;
      mind.timer = 1;
      return;
    }
    const [, player] = prey;
    const dx = player.x - tick.x;
    const dz = player.z - tick.z;
    const distance = Math.hypot(dx, dz);
    const middle = { x: tick.x, y: tick.y + MIDDLE, z: tick.z };
    const chest = { x: player.x, y: player.y + AIM_HEIGHT, z: player.z };
    const seen = clearLine(this.level, middle, chest);
    if (distance < TICK.leapRange && mind.rest <= 0 && seen && Math.abs(player.y - tick.y) < 1.5) {
      const time = TICK.leapTime;
      this.launch(
        tick,
        mind,
        { ...chest, x: chest.x + player.vx * time, z: chest.z + player.vz * time },
        time,
      );
      mind.rest = TICK.leapRest;
      return;
    }
    // Resting between leaps, it keeps its distance, facing them.
    if (distance < 1.2 && seen) {
      this.turn(tick, dx, dz, dt);
      return;
    }
    // Not every step when there's no way: a search that fails is the dearest kind.
    mind.repath -= dt;
    if (mind.repath <= 0) {
      const feet = { x: player.x, y: player.y, z: player.z };
      // Straight at them when nothing's between and no fitting lights the way, else the way round.
      const straight =
        seen &&
        distance < 6 &&
        clearLine(this.level, middle, { ...feet, y: middle.y }) &&
        darkWay(this.level, tick, feet);
      mind.path = straight
        ? [feet]
        : findPath(this.level, { x: tick.x, y: tick.y, z: tick.z }, feet, this.state.mechanics);
      mind.repath = mind.path ? REPATH : REPATH_LOST;
    }
    const path = mind.path;
    while (path && path.length > 1 && Math.hypot(path[0].x - tick.x, path[0].z - tick.z) < 0.35) {
      path.shift();
    }
    // No way to them it can find: it looks about where it is, rather than walk into what's between.
    if (!path) {
      this.wander(tick, mind, dt);
      return;
    }
    this.walk(tick, path[0].x - tick.x, path[0].z - tick.z, TICK.hunt * haste, dt);
  }

  /** Away from the light, and sideways along whatever stops it. */
  private flee(tick: Tick, mind: Mind, haste: number, dt: number) {
    const from = mind.from ?? { x: tick.x, z: tick.z + 1 };
    let dx = tick.x - from.x;
    let dz = tick.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const speed = TICK.flee * haste;
    if (this.walk(tick, dx, dz, speed, dt) >= speed * dt * 0.3) return;
    if (this.walk(tick, -dz * mind.side, dx * mind.side, speed, dt) < speed * dt * 0.3) {
      mind.side = -mind.side;
    }
  }

  private turn(tick: Tick, dx: number, dz: number, dt: number) {
    const want = Math.atan2(dx, dz);
    const off = Math.atan2(Math.sin(want - tick.yaw), Math.cos(want - tick.yaw));
    tick.yaw += Math.max(-TICK.turn * dt, Math.min(TICK.turn * dt, off));
  }

  /**
   * A step across the floor towards (dx, dz), at the pace of the ground as players go, stopped by
   * what's in the way and never off an edge. Returns how far it got.
   */
  private walk(tick: Tick, dx: number, dz: number, speed: number, dt: number): number {
    const length = Math.hypot(dx, dz);
    if (length === 0) return 0;
    const m = this.state.mechanics;
    const pace = paceAt(this.level, tick.x, tick.y, tick.z, dx, dz, m);
    const step = Math.min(length, speed * pace.speed * dt);
    const circle = {
      x: tick.x + (dx / length) * step,
      z: tick.z + (dz / length) * step,
      radius: TICK_RADIUS,
    };
    for (const box of near(this.level.boxes, circle.x, circle.z)) {
      if (box.y + box.height <= tick.y + m.stepUp || box.y >= tick.y + TICK_HEIGHT) continue;
      resolveCircleBox(circle, box);
    }
    this.turn(tick, dx, dz, dt);
    const ground = groundUnder(this.level, circle.x, circle.z, tick.y + m.stepUp);
    if (!Number.isFinite(ground) || tick.y - ground > m.stepDown + 0.3) return 0;
    const moved = Math.hypot(circle.x - tick.x, circle.z - tick.z);
    tick.x = circle.x;
    tick.y = ground;
    tick.z = circle.z;
    return moved;
  }
}
