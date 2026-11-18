/**
 * Checks the ticks in a raid on generated-2, as scripts/ticks.ts did in the web game: the raid puts
 * them on the racking, perched; out on dark floor by the loading door, one set on the player hunts
 * and leaps onto them, latched, and drains health at TICK.bite a second; a grab with a free hand
 * pulls it off, onto its back, stunned, and the draining stops; left on, it drains the player to
 * death, and the raid ends. Beams aren't checked here. Exits non-zero if any of that doesn't happen.
 *
 * Needs a server on generated-2 and a client (`UE_LEVEL=generated-2 pnpm run ue dev 1 0`):
 * `pnpm run ue check ticks [client]`. It starts the room over as a game, and leaves it in its lobby.
 */
import { exec, room, wait, walk } from "./dev";

const who = process.argv[2] ?? "client";
/** Dark floor by generated-2's loading door, out of every fitting's light. */
const DARK: [number, number] = [10.5, -21.5];
const INSIDE: [number, number] = [2.4, -21];
const BITE = 7;

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

// A raid: everyone in the truck, ready.
await exec("server", "sr.mode game");
await wait(1500);
await exec(who, "sr.goal");
await exec(who, "sr.ready");
check(await until(async () => (await room("server")).phase === "raid", 15), "the raid starts");
const start = await ticks();
const perched = start.ticks.filter((tick) => tick.state === "Perched");
check(
  perched.length > 0 && perched.length === start.ticks.length,
  `ticks wait on the racking (${perched.length})`,
);
check(start.health[who] === 100, `the player comes in with full health (${start.health[who]})`);

// Out of the truck onto dark floor, and a tick set on them.
check((await walk(who, INSIDE)) && (await walk(who, DARK)), "the player walks out onto dark floor");
await exec("server", "sr.sic 4");
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
