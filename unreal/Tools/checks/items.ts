/**
 * Checks hands and items in the playground with two players, as scripts/hands.ts did in the web
 * game: phones in either hand and dropping the last one grabbed, the flashlight switching on and
 * staying on when dropped, no two-handed TV with a hand full, and the sofa that one player can't lift
 * and two carry between them. Exits non-zero if any of that doesn't happen.
 *
 * Needs a server, a client and a bot running (`pnpm run ue dev 1 1`):
 * `pnpm run ue check items [first] [second]`, `bot` and `client` by default.
 */
import { exec, items, where } from "./dev";

const first = process.argv[2] ?? "bot";
const second = process.argv[3] ?? "client";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

/** Walks a player along waypoints, each within 20 seconds. */
async function walk(who: string, route: [number, number][]) {
  for (const [x, z] of route) {
    await exec(who, `sr.goal ${x} ${z}`);
    for (let t = 0; ; t++) {
      if (t > 400) throw new Error(`${who} never reached ${x}, ${z}`);
      await wait(50);
      if (!(await where(who)).goal) break;
    }
  }
  await wait(300);
}

/** What the server says of the item of a kind nearest a point. */
async function item(kind: string, x: number, z: number) {
  const all = (await items("server")).filter((i) => i.kind === kind);
  all.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  return all[0];
}

for (const who of [first, second]) {
  await exec(who, "sr.goal");
  await exec(who, "sr.respawn");
}
await exec(first, "sr.reset");
await wait(1500);

// Phones along the west wall at x -14, z -9 and -8: one in each hand, the right first. North of
// each, clear of the flashlights at z -10.
await walk(first, [
  [-10, -10],
  [-12.9, -8.8],
]);
await exec(first, "sr.face 270");
await wait(200);
await exec(first, "sr.grab");
await wait(300);
await walk(first, [[-12.9, -7.8]]);
await exec(first, "sr.face 270");
await wait(200);
await exec(first, "sr.grab");
await wait(500);
{
  const p = await where(first);
  check(p.right === "phone" && p.left === "phone", `a phone in each hand (${p.left}, ${p.right})`);
}

// Nothing two-handed with both full, nor with one.
await walk(first, [[-12.5, -3.6]]);
await exec(first, "sr.face 270");
await wait(200);
await exec(first, "sr.grab");
await wait(300);
check((await where(first)).left === "phone", "no TV with both hands full");
await exec(first, "sr.drop");
await wait(300);
{
  const p = await where(first);
  check(
    p.left === "-" && p.right === "phone",
    `drop lets go of the last thing grabbed (${p.left}, ${p.right})`,
  );
}
await exec(first, "sr.grab");
await wait(300);
check((await where(first)).left !== "tv", "no TV with one hand full");
// That grab may have picked the dropped phone up again: empty both hands.
await exec(first, "sr.drop");
await exec(first, "sr.drop");
await wait(1500);
{
  const phones = (await items("server")).filter((i) => i.kind === "phone");
  check(
    phones.every((phone) => phone.held.length === 0 && phone.y < 0.2),
    `dropped phones fall to the floor (y ${phones.map((phone) => phone.y).join(", ")})`,
  );
}

// The flashlight: on, off, on, and still on once dropped.
await walk(first, [
  [-12.5, -8],
  [-12.9, -10],
]);
await exec(first, "sr.face 270");
await wait(200);
await exec(first, "sr.grab");
await wait(300);
check((await where(first)).right === "flashlight", "the bot takes a flashlight");
await exec(first, "sr.light");
await wait(300);
check((await item("flashlight", -12.9, -10)).on, "F switches it on");
await exec(first, "sr.light");
await wait(300);
check(!(await item("flashlight", -12.9, -10)).on, "and off");
await exec(first, "sr.light");
await exec(first, "sr.drop");
await wait(1500);
{
  const light = await item("flashlight", -12.9, -10);
  check(light.on && light.held.length === 0 && light.y < 0.2, "a dropped flashlight stays on");
}

// The sofa at x -13.5, z 1, 2.4 m long east to west: one can hold on but not lift it.
await walk(first, [
  [-12, -6],
  [-14, -0.1],
]);
await exec(first, "sr.face 0");
await wait(200);
await exec(first, "sr.grab");
await wait(1000);
{
  const sofa = await item("sofa", -13.5, 1);
  const p = await where(first);
  check(
    p.left === "sofa" && sofa.y < 0.6,
    `one player holds the sofa but can't lift it (y ${sofa.y})`,
  );
}

// A second takes the other end, and it lifts between them.
await walk(second, [
  [-10, -10],
  [-10, -2],
  [-12.6, -0.1],
]);
await exec(second, "sr.face 0");
await wait(200);
await exec(second, "sr.grab");
await wait(1500);
{
  const sofa = await item("sofa", -13.5, 1);
  check(
    sofa.held.length === 2 && sofa.y > 0.8,
    `two lift it between them (y ${sofa.y.toFixed(2)})`,
  );
}

// Both walk south with it.
await exec(first, "sr.goal -14 -4");
await exec(second, "sr.goal -12.6 -4");
await wait(3000);
{
  const sofa = await item("sofa", -13.5, -3);
  check(sofa.z < -2 && sofa.held.length === 2, `and carry it together (z ${sofa.z.toFixed(1)})`);
}
await exec(second, "sr.drop");
await wait(1500);
{
  const sofa = await item("sofa", -13.5, -3);
  const p = await where(first);
  check(
    sofa.y < 0.6 && p.left === "-",
    `one letting go drops it for both (y ${sofa.y.toFixed(2)})`,
  );
}
