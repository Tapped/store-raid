/**
 * Checks the truck's hatch with a bot, in a game in the harbour: it's up in the lobby, where its
 * buttons do nothing and nobody gets out; it comes down as the raid starts; the control boxes
 * outside and inside put it up and down; shut, it keeps the bot in; and it stays where it is while
 * the bot stands on it. Exits non-zero if any of that doesn't happen. Needs a game server with no
 * one else in the harbour, best one of its own:
 *
 *   SERVER_PORT=2611 pnpm exec tsx server/src/index.ts
 *   SERVER_PORT=2611 pnpm exec tsx scripts/hatch.ts
 */
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../server/src/app";
import type { MoveInput } from "../server/src/rooms/schema";
import { MOVE_SCALE, TICK_RATE, YAW_SCALE } from "../shared/constants";
import { levelNamed } from "../shared/level";
import { inside } from "../shared/modes";
import { HATCH_TIME, placed } from "../shared/truck";

const port = process.env.SERVER_PORT ?? "2567";
const level = levelNamed("harbour");
const truck = level.truck;
if (!truck) throw new Error("The harbour has no truck");
/** A point in the truck's own space (x across, z towards the cab), in the level. */
const at = (x: number, z: number): [number, number] => {
  const point = placed(truck.place, x, z);
  return [point.x, point.z];
};

const client = new ColyseusSDK<typeof server>(`ws://127.0.0.1:${port}`);
const room = await client.joinOrCreate("game", {
  name: "hatch-bot",
  level: "harbour",
  mode: "game",
});
const input = room.input<MoveInput>({ mode: "reliable" });
await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
const self = () => {
  const player = room.state.players.get(room.sessionId);
  if (!player) throw new Error("The bot is missing from the room");
  return player;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 1000 / TICK_RATE));
const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

/** Walks towards a point for up to `seconds`; true if it got there. */
async function walk([x, z]: [number, number], seconds = 12): Promise<boolean> {
  for (let t = 0; t < seconds * TICK_RATE; t++) {
    const dx = x - self().x;
    const dz = z - self().z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.15) break;
    input.data.moveX = Math.round((dx / distance) * MOVE_SCALE);
    input.data.moveZ = Math.round((dz / distance) * MOVE_SCALE);
    input.data.yaw = Math.round(Math.atan2(dx, dz) * YAW_SCALE);
    input.send();
    await tick();
  }
  await stand();
  const short = Math.hypot(x - self().x, z - self().z);
  if (short > 0.45) {
    const { x: px, y: py, z: pz } = self();
    console.log(
      `  stopped ${short.toFixed(2)} m short, at ${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}`,
    );
  }
  return short <= 0.45;
}

/** Stands still, looking towards a point if one is given, for long enough that the server has seen it. */
async function stand(towards?: { x: number; z: number }) {
  for (let t = 0; t < 4; t++) {
    input.data.moveX = 0;
    input.data.moveZ = 0;
    if (towards) {
      input.data.yaw = Math.round(
        Math.atan2(towards.x - self().x, towards.z - self().z) * YAW_SCALE,
      );
    }
    input.send();
    await tick();
  }
}

/** Reaches for a control box and waits for the hatch to finish what it does, if anything. */
async function press(panel: { x: number; z: number }) {
  await stand(panel);
  room.send("grab");
  await new Promise((resolve) => setTimeout(resolve, (HATCH_TIME + 0.7) * 1000));
}

async function until(done: () => boolean, seconds: number): Promise<boolean> {
  for (let t = 0; t < seconds * TICK_RATE && !done(); t++) {
    input.send();
    await tick();
  }
  return done();
}

const [inner, outer] = truck.hatch.panels;
const byInner = at(-0.5, -2.6);
const byOuter = at(-1.98, -2.7);
const behind = at(0, -6.4);
const inTruck = () => inside(truck.dock, self().x, self().z);

// The lobby: shut in.
check(room.state.phase === "lobby" && room.state.hatch === 0, "the hatch is up in the lobby");
await walk(byInner);
await press(inner);
check(room.state.hatch === 0, "its buttons do nothing in the lobby");
await walk(behind, 3);
check(inTruck(), "nobody gets out of the truck in the lobby");

// The raid: it comes down, and the way out is the ramp.
room.send("ready");
check(await until(() => room.state.phase === "raid", 8), "the raid starts");
check(await until(() => room.state.hatch === 1, HATCH_TIME + 1), "the hatch comes down as it does");
check(await walk(behind), "the bot walks down the ramp");
check(Math.abs(self().y - truck.place.y) < 0.05, "and stands on the ground behind it");

// The control box outside.
await walk(at(-2.3, -5));
check(await walk(byOuter), "the bot reaches the control box outside");
await press(outer);
check(room.state.hatch === 0, "a button outside puts the hatch up");
await walk(at(-2.3, -5));
await walk(at(0, -4.5), 3);
check(!inTruck() && self().y < truck.place.y + 0.3, "shut, there's no way up into the truck");
await walk(at(-2.3, -5));
await walk(byOuter);
await press(outer);
check(room.state.hatch === 1, "and a button outside puts it down again");

// Standing on it: it stays put.
await walk(at(-2.3, -5));
await walk(behind);
check(await walk(at(-0.85, -3.7)), "the bot walks up onto the ramp");
await press(outer);
check(room.state.hatch === 1, "the hatch doesn't move with someone standing on it");

// The control box inside: shut in again.
check(await walk(at(-0.5, -2.2)), "the bot walks up into the truck");
await walk(byInner);
await press(inner);
check(room.state.hatch === 0, "a button inside puts the hatch up");
await walk(behind, 3);
check(inTruck(), "shut, it keeps the bot in");
await walk(byInner);
await press(inner);
check(room.state.hatch === 1, "and a button inside puts it down");

await room.leave();
if (problems.length) {
  console.error(`${problems.length} problems`);
  process.exit(1);
}
console.log("The hatch works");
process.exit(0);
