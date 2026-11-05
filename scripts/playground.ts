/**
 * Checks the playground with a bot: the dimmer fades the lights while held, the stairs go up to the
 * mezzanine and on to the platform, the railing stops it at the edge, stairs go down to the
 * basement, ladders go up and down, the plank crosses the pit, and stepping off it falls to a
 * respawn. Exits non-zero if any of that doesn't happen. Needs your game
 * server running (SERVER_PORT, else 2567).
 *
 *   pnpm exec tsx scripts/playground.ts
 */
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../server/src/app";
import type { MoveInput } from "../server/src/rooms/schema";
import { MOVE_SCALE, TICK_RATE, YAW_SCALE } from "../shared/constants";

const port = process.env.SERVER_PORT ?? "2567";
const client = new ColyseusSDK<typeof server>(`ws://127.0.0.1:${port}`);
const room = await client.joinOrCreate("game", { name: "playground-bot", level: "playground" });
const input = room.input<MoveInput>({ mode: "reliable" });
await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));

const self = () => {
  const player = room.state.players.get(room.sessionId);
  if (!player) throw new Error("The bot is missing from the room");
  return player;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 1000 / TICK_RATE));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

/** One tick of walking towards a point; true once there. */
function step(x: number, z: number): boolean {
  const dx = x - self().x;
  const dz = z - self().z;
  const distance = Math.hypot(dx, dz);
  // Slowing down over the last meter: it steers by positions a few ticks old, and the plank is narrow.
  const scale = distance > 0.15 ? MOVE_SCALE / Math.max(distance, 1) : 0;
  input.data.moveX = Math.round(dx * scale);
  input.data.moveZ = Math.round(dz * scale);
  if (distance > 0.15) input.data.yaw = Math.round(Math.atan2(dx, dz) * YAW_SCALE);
  input.send();
  return distance <= 0.15;
}

/** Walks a route of waypoints, and returns the lowest the bot's feet got on the way. */
async function walk(route: [number, number][]): Promise<number> {
  let lowest = self().y;
  for (const [x, z] of route) {
    for (let t = 0; !step(x, z); t++) {
      if (t > TICK_RATE * 20) throw new Error(`Never reached ${x}, ${z} (at ${where()})`);
      await tick();
      lowest = Math.min(lowest, self().y);
    }
  }
  await wait(300);
  return lowest;
}

/** Walks towards a point for a while, whether it gets there or not. */
async function push(x: number, z: number, seconds: number) {
  for (let t = 0; t < TICK_RATE * seconds; t++) {
    step(x, z);
    await tick();
  }
  await wait(300);
}

const where = () => `${self().x.toFixed(1)}, ${self().y.toFixed(2)}, ${self().z.toFixed(1)}`;
const near = (value: number, target: number) => Math.abs(value - target) < 0.05;

// The dimmer, on the south wall at x = -6.
await walk([[-6, -10.9]]);
for (let t = 0; t < 3; t++) {
  input.data.moveX = 0;
  input.data.moveZ = 0;
  input.data.yaw = Math.round(Math.PI * YAW_SCALE);
  input.send();
  await tick();
}
const before = room.state.light;
room.send("grab");
await wait(1000);
const during = room.state.light;
room.send("release");
await wait(500);
const after = room.state.light;
await wait(500);
check(
  during < before - 0.2,
  `holding the dimmer fades the lights (${before} to ${during.toFixed(2)})`,
);
check(room.state.light === after, "letting go leaves them there");

// Up the stairs at x -4..0, z 0..4, to the mezzanine.
await walk([
  [-2, -1],
  [-2, 6],
]);
check(near(self().y, 3), `the stairs lead up to the mezzanine (${where()})`);

// The railing along its south edge, at z = 4 west of the stairs.
await walk([[-6, 6]]);
await push(-6, 1, 1.5);
check(near(self().y, 3) && self().z > 4, `the railing stops the bot at the edge (${where()})`);

// On up the second flight, x -8..-4 at the back, rising west to the platform.
await walk([
  [-6, 6],
  [-2, 6],
  [-2, 10],
  [-10, 10],
]);
check(near(self().y, 6), `the second flight leads up to the platform (${where()})`);

// Back down both.
await walk([
  [-2, 10],
  [-2, 6],
  [-2, -1],
]);
check(near(self().y, 0), `and back down to the ground (${where()})`);

// Down the stairs to the basement, x -8..-4 under the hole at z -4..0, round the railings.
await walk([
  [-2, -10],
  [-10, -10],
  [-10, 2],
  [-6, 2],
  [-6, -6],
]);
check(near(self().y, -3), `the stairs lead down to the basement (${where()})`);

// Up the basement's ladder, on its east wall at x = 4, and back down it, and up again.
await walk([[1, -6]]);
await push(6, -6, 3);
check(near(self().y, 0) && self().x > 4, `the ladder leads up out of the basement (${where()})`);
await push(1, -6, 3);
check(near(self().y, -3), `backing off the top climbs back down it (${where()})`);
await push(6, -6, 3);
check(near(self().y, 0) && self().x > 4, `and up again (${where()})`);

// Up the ladder to the mezzanine, on the north wall at z = 4, and back down.
await walk([
  [6, -10],
  [-2, -10],
  [-2, -2],
  [2, -2],
]);
await push(2, 6, 4);
check(near(self().y, 3) && self().z > 4, `a ladder leads up to the mezzanine (${where()})`);
await push(2, 0, 3);
check(near(self().y, 0), `and back down (${where()})`);

// Across the pit on the plank at x = 10, from z -4 to 8.
const lowest = await walk([
  [2, -2],
  [-2, -2],
  [-2, -10],
  [10, -10],
  [10, -4.5],
  [10, 10],
]);
check(lowest > -0.01 && self().z > 9, `the plank crosses the pit (lowest ${lowest.toFixed(2)})`);

// Off the side of it.
await walk([[10, 2]]);
await push(14, 2, 0.5);
for (let t = 0; t < TICK_RATE * 2; t++) {
  input.data.moveX = 0;
  input.data.moveZ = 0;
  input.send();
  await tick();
}
check(self().z < -9 && near(self().y, 0), `falling in respawns the bot at the start (${where()})`);

await room.leave();
process.exit(process.exitCode ?? 0);
