/**
 * Checks the game's sounds by recording what a client hears (sr.record), one kind of sound at a time
 * (the engine's debug solo), in the playground: the ambience louder by the vent over the entrance,
 * our own footsteps as we walk and someone else's quieter, the flashlight's click, the hatch's motor
 * and latch, and a tick's taps as it walks and hiss as it quests. Exits non-zero if any are missing.
 *
 * Off-screen clients render sound with no device (Tools/ue.ts), so nothing is heard aloud, and
 * placed sounds aren't panned there: this checks when sounds play and how loud, not where from.
 *
 * Needs a server, a client and a bot running (`pnpm run ue dev 1 1`) in the playground:
 * `pnpm run ue check sounds [client] [bot]`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec, truckPoint, wait, walk, where } from "./dev";

const ears = process.argv[2] ?? "client";
const other = process.argv[3] ?? "bot";
const SAVED = resolve(dirname(fileURLToPath(import.meta.url)), "../../Saved/Audio");
/** The window the loudness is measured over, in seconds. */
const WINDOW = 0.025;

let problems = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems++;
}

/**
 * A recording: its loudest moment and its median loudness in dBFS (for something that goes on, like
 * an ambience), the moments sounds start, and its loudness each window.
 */
interface Heard {
  peak: number;
  median: number;
  onsets: number[];
  levels: number[];
}

/** The loudness of a 16-bit WAV, window by window, in dBFS; -120 for silence. */
function measure(file: string): Heard {
  const data = readFileSync(file);
  // The chunks after the RIFF header: fmt, then data.
  let at = 12;
  let channels = 2;
  let rate = 48000;
  let samples: Int16Array | undefined;
  while (at + 8 <= data.length) {
    const id = data.toString("ascii", at, at + 4);
    const size = data.readUInt32LE(at + 4);
    if (id === "fmt ") {
      channels = data.readUInt16LE(at + 10);
      rate = data.readUInt32LE(at + 12);
    } else if (id === "data") {
      const body = data.subarray(at + 8, at + 8 + size);
      samples = new Int16Array(body.buffer, body.byteOffset, Math.floor(body.length / 2));
    }
    at += 8 + size + (size % 2);
  }
  if (!samples) throw new Error(`${file} has no samples`);
  const per = Math.round(rate * WINDOW) * channels;
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += per) {
    let most = 0;
    for (let i = start; i < Math.min(samples.length, start + per); i++)
      most = Math.max(most, Math.abs(samples[i]));
    levels.push(most ? 20 * Math.log10(most / 32768) : -120);
  }
  // A sound starts where a window is 12 dB louder than the quietest of the four before it.
  const onsets: number[] = [];
  for (let i = 4; i < levels.length; i++) {
    const before = Math.min(...levels.slice(i - 4, i));
    if (levels[i] > -80 && levels[i] > before + 12 && !onsets.some((t) => i * WINDOW - t < 0.08))
      onsets.push(i * WINDOW);
  }
  const sorted = [...levels].sort((a, b) => a - b);
  return {
    peak: Math.max(...levels),
    median: sorted[Math.floor(sorted.length / 2)],
    onsets,
    levels,
  };
}

/** Records what the client hears of sounds whose names contain `solo` while `act` runs, plus `after` seconds. */
async function record(
  name: string,
  solo: string,
  act: () => Promise<void>,
  after = 0.5,
): Promise<Heard> {
  await exec(ears, "au.ClearMutesAndSolos");
  await exec(ears, `au.Debug.AudioSoloSoundWave ${solo}`);
  await exec(ears, "sr.record start");
  await act();
  await wait(after * 1000);
  await exec(ears, `sr.record stop ${name}`);
  await exec(ears, "au.ClearMutesAndSolos");
  // Written a moment later, off the game thread.
  const file = join(SAVED, `${name}.wav`);
  const started = Date.now();
  let size = -1;
  for (;;) {
    await wait(200);
    const now =
      existsSync(file) && statSync(file).mtimeMs >= started - 1000 ? statSync(file).size : -1;
    if (now > 0 && now === size) break;
    size = now;
    if (Date.now() - started > 10000) throw new Error(`${file} wasn't written`);
  }
  const heard = measure(file);
  console.log(
    `     ${name}: peak ${heard.peak.toFixed(1)} dB, median ${heard.median.toFixed(1)} dB, starts at ${heard.onsets.map((t) => t.toFixed(2)).join(" ") || "none"}`,
  );
  return heard;
}

/** Stands still for some seconds. */
const still = (seconds: number) => async () => {
  await wait(seconds * 1000);
};

// Everyone stopped where they came in, every item back; the bot well out of the way at first.
for (const who of [ears, other]) {
  await exec(who, "sr.goal");
  await exec(who, "sr.respawn");
}
await exec(ears, "sr.reset");
await exec(ears, "sr.tickdemo");
await wait(1500);

// The ambience: the vent over the entrance (0, 2.6, -12) is loud by it, quieter across the hall.
// Routes keep to the ground floor's cells clear of the ladder, the stairwells and the items along the
// west wall (Playground.as).
{
  await walk(ears, [0, -10]);
  const near = await record("ambience-near", "vent-hum", still(1.5));
  await walk(ears, [-10, -10]);
  await walk(ears, [-10, 8]);
  const far = await record("ambience-far", "vent-hum", still(1.5));
  check(near.median > -45, `the ambience plays (${near.median.toFixed(1)} dB by the vent)`);
  check(
    near.median > far.median + 4,
    `and it's louder by the vent than across the hall (${far.median.toFixed(1)} dB)`,
  );
}

// Our own footsteps, walking 8 m: steps at about 2.9 a second, heard straight.
let own = -120;
{
  const heard = await record("footsteps-own", "footstep", async () => {
    await walk(ears, [-10, 0]);
  });
  own = heard.peak;
  check(heard.onsets.length >= 3, `our own footsteps as we walk (${heard.onsets.length})`);
  const stood = await record("footsteps-still", "footstep", still(1));
  check(stood.onsets.length === 0, "and none standing still");
}

// Someone else's, walking past 5.5 m off at the closest: quieter than our own.
{
  await walk(ears, [-10, 6]);
  await walk(ears, [-6, 6]);
  await walk(other, [-10, -10]);
  await walk(other, [-11.5, -4]);
  const heard = await record("footsteps-theirs", "footstep", async () => {
    await walk(other, [-11.5, 6]);
  });
  check(heard.onsets.length >= 3, `someone else's footsteps (${heard.onsets.length})`);
  check(
    heard.peak < own - 3,
    `quieter than our own (${heard.peak.toFixed(1)} dB against ${own.toFixed(1)})`,
  );
  await walk(other, [-10, -10]);
  await walk(other, [5, -9]);
  await walk(other, [6, -6]);
}

// The flashlight's click, on and off, from the flashlights by the west wall at x -14, z -10.
{
  await walk(ears, [-10, 6]);
  await walk(ears, [-10, -10]);
  await walk(ears, [-12.9, -10]);
  await exec(ears, "sr.face 270");
  await wait(300);
  await exec(ears, "sr.grab");
  await wait(500);
  check((await where(ears)).right === "flashlight", "the client takes a flashlight");
  const heard = await record("flashlight", "flashlight-click", async () => {
    await exec(ears, "sr.light");
    await wait(700);
    await exec(ears, "sr.light");
  });
  check(heard.onsets.length === 2, `it clicks on and off (${heard.onsets.length})`);
  await exec(ears, "sr.drop");
}

// The hatch, down in the playground: the box outside puts it up, a motor as it starts and the latch
// as it comes to rest HATCH_TIME (3 s) later; then down again.
{
  const outer = truckPoint(-1.33, -2.7, 1.4);
  const byOuter = truckPoint(-1.98, -2.7);
  await walk(ears, [-10, -9]);
  await walk(ears, [-1, -8.6]);
  await walk(ears, [byOuter[0], byOuter[2]]);
  const p = await where(ears);
  await exec(
    ears,
    `sr.face ${((Math.atan2(outer[0] - p.x, outer[2] - p.z) * 180) / Math.PI).toFixed(1)}`,
  );
  await wait(500);
  const heard = await record(
    "hatch",
    "hatch",
    async () => {
      await exec(ears, "sr.grab");
      await exec(ears, "sr.release");
    },
    4,
  );
  // Each has a few transients of its own: sounds more than a second apart are separate.
  const starts = heard.onsets.filter((t, i) => i === 0 || t - heard.onsets[i - 1] > 1);
  const [motor, latch] = starts;
  check(starts.length === 2, `the hatch's motor and latch (${starts.length} sounds)`);
  check(
    latch !== undefined && Math.abs(latch - motor - 3) < 0.4,
    `the latch as it comes to rest, 3 s after the motor (${latch !== undefined ? (latch - motor).toFixed(2) : "-"} s)`,
  );
  await exec(ears, "sr.grab");
  await exec(ears, "sr.release");
  await wait(3500);
  await walk(ears, [-1, -8.6]);
}

// A tick, on this client only (sr.tickdemo): walking a circle 2 m ahead it taps, standing it hisses.
{
  await walk(ears, [-1, -6]);
  const at = await where(ears);
  await exec(ears, `sr.tickdemo ${at.x} ${at.y} ${at.z + 2.5} 1 0.4`);
  await wait(500);
  const taps = await record("tick-taps", "tick-tap", still(3));
  check(taps.onsets.length >= 4, `a walking tick taps (${taps.onsets.length})`);
  await exec(ears, `sr.tickdemo ${at.x} ${at.y} ${at.z + 2.5}`);
  const hiss = await record("tick-hiss", "tick-hiss", still(4));
  check(hiss.peak > -60, `a tick standing still hisses as it quests (${hiss.onsets.length})`);
  await exec(ears, "sr.tickdemo");
}

console.log(problems ? `${problems} problems` : "every sound plays");
process.exit(problems ? 1 : 0);
