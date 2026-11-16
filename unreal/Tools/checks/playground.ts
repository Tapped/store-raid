/**
 * Checks the playground with a bot, as scripts/playground.ts did in the web game: stairs up to the
 * mezzanine and on to the platform, the railing at its edge, stairs down to the basement, ladders up
 * and down, the plank across the pit, falling in respawns; and running until winded, and jumping.
 * Exits non-zero if any of that doesn't happen. Grabbing and the dimmer come with hands and items.
 *
 * Needs a server and a bot running (`pnpm run ue dev 0 1`, or `pnpm run ue server` and
 * `pnpm run ue bot`): `pnpm run ue check playground [who]`, `bot` by default.
 */
import { exec, where } from "./dev";

const who = process.argv[2] ?? "bot";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

const self = () => where(who);
const at = async () => {
  const p = await self();
  return `${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}`;
};
const near = (value: number, target: number) => Math.abs(value - target) < 0.05;

/** Walks a route of waypoints, and returns the lowest the bot's feet got on the way. */
async function walk(route: [number, number][]): Promise<number> {
  let lowest = (await self()).y;
  for (const [x, z] of route) {
    await exec(who, `sr.goal ${x} ${z}`);
    for (let t = 0; ; t++) {
      if (t > 20 * 20) throw new Error(`Never reached ${x}, ${z} (at ${await at()})`);
      await wait(50);
      const p = await self();
      lowest = Math.min(lowest, p.y);
      if (!p.goal) break;
    }
  }
  await wait(300);
  return lowest;
}

/** Walks towards a point for a while, whether it gets there or not. */
async function push(x: number, z: number, seconds: number) {
  await exec(who, `sr.goal ${x} ${z}`);
  await wait(seconds * 1000);
  await exec(who, "sr.goal");
  await wait(300);
}

await exec(who, "sr.goal");
await exec(who, "sr.run 0");
await exec(who, "sr.jump 0");
await exec(who, "sr.respawn");
await wait(1000);
const start = await self();
check(
  near(start.y, 0) && start.z < -9,
  `the bot comes in on the ground in the south (${await at()})`,
);

// Jumping: up and back down.
await exec(who, "sr.jump 1");
let highest = start.y;
for (let t = 0; t < 12; t++) {
  await wait(50);
  highest = Math.max(highest, (await self()).y);
}
await exec(who, "sr.jump 0");
await wait(800);
check(
  highest > 0.5 && near((await self()).y, 0),
  `a jump goes up ${highest.toFixed(2)} m and lands`,
);

// Running along the south side until winded, then resting.
await walk([[-12, -10]]);
await exec(who, "sr.run 1");
await exec(who, "sr.goal 12 -10");
let fastest = 0;
let winded = false;
for (let t = 0; t < 140 && !winded; t++) {
  await wait(50);
  const p = await self();
  if (p.running) fastest = Math.max(fastest, p.speed);
  winded = p.winded;
  if (!p.goal) await exec(who, `sr.goal ${p.x > 0 ? -12 : 12} -10`);
}
await exec(who, "sr.run 0");
await exec(who, "sr.goal");
check(fastest > 7, `running is faster than walking (${fastest.toFixed(2)} m/s)`);
check(winded, "running out of stamina leaves the bot winded");
await wait(500);

// Up the stairs at x -4..0, z 0..4, to the mezzanine, from the south side, round the basement's
// ladder well at x 0..4, z -8..-4.
await walk([
  [-2, -10],
  [-2, -1],
  [-2, 6],
]);
check(near((await self()).y, 3), `the stairs lead up to the mezzanine (${await at()})`);

// The railing along its south edge, at z = 4 west of the stairs.
await walk([[-6, 6]]);
await push(-6, 1, 1.5);
{
  const p = await self();
  check(near(p.y, 3) && p.z > 4, `the railing stops the bot at the edge (${await at()})`);
}

// On up the second flight, x -8..-4 at the back, rising west to the platform.
await walk([
  [-6, 6],
  [-2, 6],
  [-2, 10],
  [-10, 10],
]);
check(near((await self()).y, 6), `the second flight leads up to the platform (${await at()})`);

// Back down both.
await walk([
  [-2, 10],
  [-2, 6],
  [-2, -1],
]);
check(near((await self()).y, 0), `and back down to the ground (${await at()})`);

// Down the stairs to the basement, x -8..-4 under the hole at z -4..0, round the railings.
await walk([
  [-2, -10],
  [-10, -10],
  [-10, 2],
  [-6, 2],
  [-6, -6],
]);
check(near((await self()).y, -3), `the stairs lead down to the basement (${await at()})`);

// Up the basement's ladder, on its east wall at x = 4, and back down it, and up again.
await walk([[1, -6]]);
await push(6, -6, 3);
{
  const p = await self();
  check(near(p.y, 0) && p.x > 4, `the ladder leads up out of the basement (${await at()})`);
}
await push(1, -6, 3);
check(near((await self()).y, -3), `backing off the top climbs back down it (${await at()})`);
await push(6, -6, 3);
{
  const p = await self();
  check(near(p.y, 0) && p.x > 4, `and up again (${await at()})`);
}

// Up the ladder to the mezzanine, on the north wall at z = 4, and back down.
await walk([
  [6, -10],
  [-2, -10],
  [-2, -2],
  [2, -2],
]);
await push(2, 6, 4);
{
  const p = await self();
  check(near(p.y, 3) && p.z > 4, `a ladder leads up to the mezzanine (${await at()})`);
}
await push(2, 0, 3);
check(near((await self()).y, 0), `and back down (${await at()})`);

// Across the pit on the plank at x = 10, from z -4 to 8.
const lowest = await walk([
  [2, -2],
  [-2, -2],
  [-2, -10],
  [10, -10],
  [10, -4.5],
  [10, 10],
]);
check(
  lowest > -0.01 && (await self()).z > 9,
  `the plank crosses the pit (lowest ${lowest.toFixed(2)})`,
);

// Off the side of it.
await walk([[10, 2]]);
await push(14, 2, 0.5);
await wait(2500);
{
  const p = await self();
  check(p.z < -9 && near(p.y, 0), `falling in respawns the bot at the start (${await at()})`);
}
