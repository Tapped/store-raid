/**
 * Checks the truck's hatch with a bot, in a game in the playground, as scripts/hatch.ts did in the
 * harbour: it's up in the lobby, where its buttons do nothing and nobody gets out; it comes down as the
 * raid starts; the control boxes outside and inside put it up and down; shut, it keeps the bot in; and
 * it stays where it is while the bot stands on it. Exits non-zero if any of that doesn't happen.
 *
 * Needs a server and a bot running (`pnpm run ue dev 1 1`; any client is readied too, so the raid can
 * start): `pnpm run ue check hatch [bot] [others…]`. It makes the room a game (`sr.mode game`) and the
 * playground again at the end.
 */
import { exec, inTruck as inTruckAt, room, truckPoint, wait, walk, where } from "./dev";

const bot = process.argv[2] ?? "bot";
const others = process.argv.length > 3 ? process.argv.slice(3) : ["client"];
const HATCH_TIME = 3;

let problems = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems++;
}

/** Turns the bot towards a point and presses grab, then waits for the hatch to do what it does. */
async function press(at: [number, number, number]) {
  const p = await where(bot);
  const yaw = (Math.atan2(at[0] - p.x, at[2] - p.z) * 180) / Math.PI;
  await exec(bot, `sr.face ${yaw.toFixed(1)}`);
  // The server turns the character with the moves that follow.
  await wait(500);
  await exec(bot, "sr.grab");
  await exec(bot, "sr.release");
  await wait((HATCH_TIME + 0.7) * 1000);
}

async function until(done: () => Promise<boolean>, seconds: number): Promise<boolean> {
  for (let t = 0; t < seconds * 10; t++) {
    if (await done()) return true;
    await wait(100);
  }
  return done();
}

/** The truck's control boxes, inside and outside, in the level (x, y, z). */
const inner = truckPoint(-1.11, -2.6, 2.2);
const outer = truckPoint(-1.33, -2.7, 1.4);
const byInner = truckPoint(-0.5, -2.6);
const byOuter = truckPoint(-1.98, -2.7);
const behind = truckPoint(0, -6.4);
/** Round the side of the hatch, to the outer box: clear of the wall north of the truck. */
const aside = truckPoint(-1.95, -5);
const xz = (p: [number, number, number]): [number, number] => [p[0], p[2]];
const inTruck = async () => inTruckAt(await where(bot));

// Stops the bot wandering, which would get it up from its seat.
for (const who of [bot, ...others]) await exec(who, "sr.goal");
await exec("server", "sr.mode game");
await wait(1500);

// The lobby: seated, shut in.
check(
  (await room(bot)).phase === "lobby" && (await room(bot)).hatch === 0,
  "the hatch is up in the lobby",
);
check((await where(bot)).seat >= 0, "the bot sits on a seat in the lobby");
check(await walk(bot, xz(byInner)), "moving gets the bot up and to the control box inside");
check((await where(bot)).seat === -1, "and it's standing");
await press(inner);
check((await room(bot)).hatch === 0, "its buttons do nothing in the lobby");
await walk(bot, xz(behind), 3);
check(await inTruck(), "nobody gets out of the truck in the lobby");

// The raid: it comes down, and the way out is the ramp.
for (const who of [bot, ...others]) await exec(who, "sr.ready");
check(await until(async () => (await room(bot)).phase === "raid", 8), "the raid starts");
check(
  await until(async () => (await room(bot)).hatch === 1, HATCH_TIME + 1),
  "the hatch comes down as it does",
);
check(await walk(bot, xz(behind)), "the bot walks down the ramp");
check(Math.abs((await where(bot)).y) < 0.06, "and stands on the ground behind it");

// The control box outside.
await walk(bot, xz(aside));
check(await walk(bot, xz(byOuter)), "the bot reaches the control box outside");
await press(outer);
check((await room(bot)).hatch === 0, "a button outside puts the hatch up");
await walk(bot, xz(aside));
await walk(bot, xz(truckPoint(0, -4.5)), 3);
{
  const p = await where(bot);
  check(!(await inTruck()) && p.y < 0.3, "shut, there's no way up into the truck");
}
await walk(bot, xz(aside));
await walk(bot, xz(byOuter));
await press(outer);
check((await room(bot)).hatch === 1, "and a button outside puts it down again");

// Standing on it: it stays put.
await walk(bot, xz(aside));
await walk(bot, xz(behind));
check(await walk(bot, xz(truckPoint(-0.85, -3.7))), "the bot walks up onto the ramp");
await press(outer);
check((await room(bot)).hatch === 1, "the hatch doesn't move with someone standing on it");

// The control box inside: shut in again.
check(await walk(bot, xz(truckPoint(-0.5, -2.2))), "the bot walks up into the truck");
await walk(bot, xz(byInner));
await press(inner);
check((await room(bot)).hatch === 0, "a button inside puts the hatch up");
await walk(bot, xz(behind), 3);
check(await inTruck(), "shut, it keeps the bot in");
await walk(bot, xz(byInner));
await press(inner);
check((await room(bot)).hatch === 1, "and a button inside puts it down");

await exec("server", "sr.mode playground");
if (problems) {
  console.error(`${problems} problems`);
  process.exit(1);
}
console.log("The hatch works");
