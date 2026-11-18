/**
 * Checks the ticks in a raid on generated-2, as scripts/ticks.ts did in the web game: the raid puts
 * them on the racking, perched. By the loading door the player takes a flashlight: a tick perched
 * over dark floor waits, a beam on it makes it wary, it settles when the light goes out, and it drops
 * onto the player walking under it. Someone else's beam held on it makes it let go and flee (with a
 * second player), and a beam on one hunting across the floor sends it fleeing. Then one set on the
 * player hunts and leaps onto them, latched, and drains health at TICK.bite a second; a grab with a
 * free hand pulls it off, onto its back, stunned, and the draining stops; left on, it drains the
 * player to death, and the raid ends. Exits non-zero if any of that doesn't happen.
 *
 * Needs a server on generated-2, a client and a bot (`UE_LEVEL=generated-2 pnpm run ue dev 1 1`):
 * `pnpm run ue check ticks [client] [bot]`. Without the bot it leaves out the other player's beam.
 * It starts the room over as a game, and leaves it in its lobby.
 */
import { exec, items, room, wait, walk, where } from "./dev";

const who = process.argv[2] ?? "client";
const helper = process.argv[3] ?? "bot";
/** Dark floor by generated-2's loading door, out of every fitting's light. */
const DARK: [number, number] = [10.5, -21.5];
const INSIDE: [number, number] = [2.4, -21];
/** In the truck, between the benches. */
const TRUCK: [number, number] = [2.4, -31.5];
/** Where a tick is perched over the dark floor, as if on racking, and where the player shines from. */
const PERCH: [number, number, number] = [DARK[0], 2.6, DARK[1]];
const WATCH: [number, number] = [5.5, -21.5];
const BITE = 7;
/** Seconds a tick stays afraid after the light leaves it (TickRules::AFRAID). */
const AFRAID = 2.5;
/** How high a held flashlight shines from, above the feet, and how high a tick's middle is. */
const LENS = 1.45;
const MIDDLE = 0.15;

let problems = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems++;
}

async function until(done: () => Promise<boolean>, seconds: number): Promise<boolean> {
  for (let t = 0; t < seconds * 10; t++) {
    if (await done()) return true;
    await wait(100);
  }
  return done();
}

interface TickState {
  state: string;
  x: number;
  y: number;
  z: number;
  on: string;
}

/** The ticks and everyone's health, as the server has them. */
async function ticks(): Promise<{
  ticks: TickState[];
  health: Record<string, number>;
  role: Record<string, string>;
}> {
  const text = (await exec("server", "sr.ticks")).split("\n");
  const found: TickState[] = [];
  const health: Record<string, number> = {};
  const role: Record<string, string> = {};
  for (const line of text) {
    const tick = line.match(
      /StoreRaid tick: \S+ ETickState::(\w+) \(\d+\) (\S+) (\S+) (\S+) ?(\S*)/,
    );
    if (tick) {
      found.push({
        state: tick[1],
        x: Number(tick[2]),
        y: Number(tick[3]),
        z: Number(tick[4]),
        on: tick[5],
      });
    }
    const one = line.match(/StoreRaid health: (\S+) (\S+) ERole::(\w+)/);
    if (one) {
      health[one[1]] = Number(one[2]);
      role[one[1]] = one[3];
    }
  }
  return { ticks: found, health, role };
}

const on = async () => (await ticks()).ticks.find((tick) => tick.on === who);
const health = async () => (await ticks()).health[who] ?? Number.NaN;

/** Turns a player to look at a point (game meters) from where a held flashlight shines. */
async function aim(player: string, [x, y, z]: [number, number, number]) {
  const p = await where(player);
  const yaw = (Math.atan2(x - p.x, z - p.z) * 180) / Math.PI;
  const pitch = (Math.atan2(y - (p.y + LENS), Math.hypot(x - p.x, z - p.z)) * 180) / Math.PI;
  await exec(player, `sr.face ${yaw.toFixed(1)} ${pitch.toFixed(1)}`);
}

/** Takes the flashlight nearest the player, from just south of it. */
async function takeFlashlight(player: string): Promise<boolean> {
  const p = await where(player);
  const free = (await items("server")).filter(
    (i) => i.kind === "flashlight" && i.held.length === 0,
  );
  if (free.length === 0) return false;
  const near = free.reduce((a, b) =>
    Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b,
  );
  await walk(player, [near.x, near.z - 0.6]);
  await exec(player, "sr.face 0 -40");
  await wait(300);
  await exec(player, "sr.grab");
  return until(async () => (await where(player)).right === "flashlight", 2);
}

/** Whether a second player is in the room to help. */
async function present(player: string): Promise<boolean> {
  try {
    await where(player);
    return true;
  } catch {
    return false;
  }
}

/** The tick sr.perch put down: its state, where it is, and whom it's on. */
async function tickNamed(name: string) {
  const text = await exec("server", "sr.ticks");
  const line = text.split("\n").find((l) => l.includes(`StoreRaid tick: ${name} `));
  const m = line?.match(/ETickState::(\w+) \(\d+\) (\S+) (\S+) (\S+) ?(\S*)/);
  return m
    ? { state: m[1], x: Number(m[2]), y: Number(m[3]), z: Number(m[4]), on: m[5] }
    : { state: "", x: Number.NaN, y: Number.NaN, z: Number.NaN, on: "" };
}

// A raid: everyone in the truck, ready.
await exec("server", "sr.mode game");
await wait(1500);
const helped = await present(helper);
const players = helped ? [who, helper] : [who];
for (const player of players) await exec(player, "sr.goal");
for (const player of players) await exec(player, "sr.ready");
check(await until(async () => (await room("server")).phase === "raid", 15), "the raid starts");
const start = await ticks();
const perched = start.ticks.filter((tick) => tick.state === "Perched");
check(
  perched.length > 0 && perched.length === start.ticks.length,
  `ticks wait on the racking (${perched.length})`,
);
check(start.health[who] === 100, `the player comes in with full health (${start.health[who]})`);

// A flashlight by the loading door, and a tick perched over the dark floor beyond it.
check(await walk(who, INSIDE), "the player walks out of the truck");
check(await takeFlashlight(who), "and picks up a flashlight");
await walk(who, WATCH);
const put = (await exec("server", `sr.perch ${PERCH.join(" ")}`)).match(/StoreRaid perch: (\S+)/);
const it = () => tickNamed(put?.[1] ?? "");
await wait(1000);
check((await it()).state === "Perched", "a tick perched over dark floor waits, out of reach");

// The beam on it, and off again.
await aim(who, [PERCH[0], PERCH[1] + MIDDLE, PERCH[2]]);
await exec(who, "sr.light");
check(await until(async () => (await it()).state === "Wary", 2), "a beam on it makes it wary");
await exec(who, "sr.light");
check(
  await until(async () => (await it()).state === "Perched", AFRAID + 2),
  "and it settles once the light is off",
);

// Under it.
await exec(who, "sr.face 90 0");
await exec(who, `sr.goal ${DARK[0] - 0.2} ${DARK[1]}`);
check(
  await until(async () => {
    const t = await it();
    return t.state === "Latched" && t.on === who;
  }, 4),
  "it drops on the player walking under it and latches on",
);
await exec("server", `sr.health 100 ${who}`);
await exec(who, "sr.goal");

if (helped) {
  // Someone else's beam held on it makes it let go, and it flees.
  await walk(helper, [INSIDE[0], INSIDE[1] - 1.5]);
  check(await takeFlashlight(helper), "the other player picks up a flashlight");
  await exec("server", `sr.health 100 ${who}`);
  await walk(helper, [DARK[0] - 4, DARK[1]]);
  await exec("server", `sr.health 100 ${who}`);
  const t = await it();
  await aim(helper, [t.x, t.y + MIDDLE, t.z]);
  await exec(helper, "sr.light");
  check(
    await until(async () => (await it()).on === "", 2),
    "the other player's beam held on it makes it let go",
  );
  check(await until(async () => (await it()).state === "Fleeing", 3), "and it flees");
  await exec(helper, "sr.light");
  // Back into the truck, wanting to leave, so the raid ends with the player's death below.
  await walk(helper, [INSIDE[0], INSIDE[1] - 1.5]);
  check(await walk(helper, TRUCK), "the other player goes back into the truck");
  await exec(helper, "sr.ready");
} else {
  await exec(who, "sr.grab");
  await exec(who, "sr.release");
  await until(async () => (await it()).on === "", 2);
}

// A beam on one hunting across the floor sends it fleeing.
await exec("server", `sr.health 100 ${who}`);
await walk(who, WATCH);
await exec(who, "sr.face 90 -12");
await exec(who, "sr.light");
await wait(300);
await exec("server", `sr.sic 6 ${who}`);
check(
  await until(async () => (await it()).state === "Fleeing", 2),
  "a beam on a tick hunting across the floor sends it fleeing",
);
await exec(who, "sr.light");
await exec("server", `sr.health 100 ${who}`);

// Out of the truck onto dark floor, and a tick set on them.
check(await walk(who, DARK), "the player walks out onto dark floor");
await exec("server", `sr.sic 4 ${who}`);
check(
  await until(async () => (await on()) !== undefined, 6),
  "a tick set on the player hunts, leaps and latches on",
);

// It drains them.
const before = await health();
const from = Date.now();
await wait(2000);
const after = await health();
const rate = (before - after) / ((Date.now() - from) / 1000);
check(Math.abs(rate - BITE) < 2.5, `it drains ${rate.toFixed(1)} health a second (${BITE})`);

// A grab pulls it off, onto its back, and the draining stops.
await exec(who, "sr.grab");
await exec(who, "sr.release");
check(
  await until(async () => (await on()) === undefined, 2),
  "a grab with a free hand pulls it off",
);
check(
  await until(async () => (await ticks()).ticks.some((tick) => tick.state === "Stunned"), 3),
  "it lands on its back, stunned",
);
const pulled = await health();
await wait(500);
check((await health()) === pulled, "and the draining stops");

// Left alone, it comes back and drains them to death, which ends the raid.
await exec("server", "sr.health 20");
check(
  await until(async () => (await on()) !== undefined, 15),
  "it comes back and latches on again",
);
check(
  await until(async () => (await ticks()).role[who] === "Dead", 10),
  "and drains the player to death",
);
check(await until(async () => (await room("server")).phase !== "raid", 5), "which ends the raid");

await exec("server", "sr.mode game");
if (problems > 0) {
  console.log(`${problems} problem${problems === 1 ? "" : "s"}`);
  process.exitCode = 1;
}
