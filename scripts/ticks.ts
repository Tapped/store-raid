/**
 * Checks the ticks with a bot, in a raid on the store: a flashlight's beam makes a perched tick
 * wary, walking under it brings it down onto the bot, it drains health, a grab with a free hand
 * pulls it off, and left alone it drains the bot to death. Exits non-zero if any of that doesn't
 * happen. Needs a game server with nobody else in the store's game (SERVER_PORT, else 2567):
 *
 *   SERVER_PORT=2601 pnpm exec tsx server/src/index.ts
 *   SERVER_PORT=2601 pnpm exec tsx scripts/ticks.ts
 */
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../server/src/app";
import type { MoveInput } from "../server/src/rooms/schema";
import { MOVE_SCALE, TICK_RATE, YAW_SCALE } from "../shared/constants";
import { MAX_HEALTH, PITCH_SCALE, TICK } from "../shared/ticks";

const port = process.env.SERVER_PORT ?? "2567";
const client = new ColyseusSDK<typeof server>(`ws://127.0.0.1:${port}`);
const room = await client.joinOrCreate("game", { name: "tick-bait", level: "store", mode: "game" });
const input = room.input<MoveInput>({ mode: "reliable" });
await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));

const tick = () => new Promise((resolve) => setTimeout(resolve, 1000 / TICK_RATE));
const self = () => {
  const player = room.state.players.get(room.sessionId);
  if (!player) throw new Error("The bot is missing from the room");
  return player;
};
let failed = false;
function check(what: string, ok: boolean) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
}
/** Sends inputs standing still until `done` says so; false if it never does within `seconds`. */
async function until(done: () => boolean, seconds: number): Promise<boolean> {
  for (let t = 0; t < seconds * TICK_RATE; t++) {
    if (done()) return true;
    input.data.moveX = 0;
    input.data.moveZ = 0;
    input.send();
    await tick();
  }
  return done();
}
async function walkTo(x: number, z: number) {
  for (let t = 0; t < TICK_RATE * 30; t++) {
    const dx = x - self().x;
    const dz = z - self().z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.15) return;
    input.data.moveX = Math.round((dx / distance) * MOVE_SCALE);
    input.data.moveZ = Math.round((dz / distance) * MOVE_SCALE);
    input.data.yaw = Math.round(Math.atan2(dx, dz) * YAW_SCALE);
    input.data.pitch = 0;
    input.send();
    await tick();
  }
  throw new Error(`The bot never reached ${x}, ${z}`);
}
/** Looks at a point, from the height a held flashlight shines from. */
function lookAt(x: number, y: number, z: number) {
  const dx = x - self().x;
  const dz = z - self().z;
  input.data.yaw = Math.round(Math.atan2(dx, dz) * YAW_SCALE);
  input.data.pitch = Math.round(
    Math.atan2(y - (self().y + 1.45), Math.hypot(dx, dz)) * PITCH_SCALE,
  );
}

room.send("ready");
check("the raid starts", await until(() => room.state.phase === "raid", 10));
const ticks = [...room.state.ticks.entries()];
check(`ticks wait on the shelves (${ticks.length})`, ticks.length > 0);
check(
  "all of them perched",
  ticks.every(([, t]) => t.state === "perched"),
);

// A flashlight from the front of the store, then the perch nearest to it.
await walkTo(-0.5, 12);
lookAt(-0.5, 0, 11);
await until(() => false, 0.2);
room.send("grab");
check("it picks up a flashlight", await until(() => self().right !== "", 2));
room.send("light");
const [id, perch] = ticks.reduce((a, b) =>
  Math.hypot(a[1].x + 0.5, a[1].z - 12) < Math.hypot(b[1].x + 0.5, b[1].z - 12) ? a : b,
);
// Into the aisle beside its shelf, a few meters along from it.
const aisle = perch.x + 1.5;
await walkTo(aisle, 12.5);
await walkTo(aisle, perch.z + 4.5);
const there = () => room.state.ticks.get(id) ?? perch;
check("it still waits, out of reach", there().state === "perched");
lookAt(perch.x, perch.y + 0.2, perch.z);
check("a beam on it makes it wary", await until(() => there().state === "wary", 2));
room.send("light");
check(
  "and it settles once the light is off",
  await until(() => there().state === "perched", TICK.afraid + 2),
);

// Under it.
input.data.pitch = 0;
await walkTo(aisle - 0.3, perch.z);
check(
  "it drops on the bot and latches on",
  await until(() => there().state === "latched" && there().victim === room.sessionId, 4),
);
await until(() => false, 1);
check("it drains health", self().health < MAX_HEALTH - 3);
room.send("grab");
check("a grab with a free hand pulls it off", await until(() => there().victim === "", 1));
const after = self().health;
await until(() => false, 0.5);
check("and the draining stops", self().health === after);

// Left alone, something latches on again and finishes the job.
check(
  "a tick comes back and latches on",
  await until(() => [...room.state.ticks.values()].some((t) => t.victim === room.sessionId), 15),
);
check("and drains the bot to death", await until(() => self().role === "dead", 25));

await room.leave();
process.exit(failed ? 1 : 0);
