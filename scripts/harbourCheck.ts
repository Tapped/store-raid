/**
 * Checks the harbour level without a server: the warehouse where it stands, its loading door open,
 * against the rules in shared/levelCheck.ts, and that there's a way between the truck and the
 * loading door that needs no jump, either way: for one on foot, and wide enough for two carrying a
 * sofa. Prints how long the way is.
 *
 *   pnpm exec tsx scripts/harbourCheck.ts [seed…]        (default: the harbour's own seed)
 *   pnpm exec tsx scripts/harbourCheck.ts --map [seed]   also draws the yard, a meter a character
 */
import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP } from "../shared/constants";
import { HARBOUR_SITE } from "../shared/harbourSite";
import { floorHeight, generatedLevel, HARBOUR_SEED, harbourLevel } from "../shared/level";
import { checkLevel } from "../shared/levelCheck";

const args = process.argv.slice(2);
const map = args[0] === "--map";
const seeds = args.filter((arg) => arg !== "--map").map(Number);
let failed = false;

/** The part of the harbour the way lies in, and the grid it's searched on. */
const AREA = { minX: -60, maxX: 60, minZ: -100, maxZ: HARBOUR_SITE.z };
const CELL = 0.25;
const W = Math.round((AREA.maxX - AREA.minX) / CELL);
const H = Math.round((AREA.maxZ - AREA.minZ) / CELL);
/** Two carrying a sofa between them need about this much room round their middle. */
const WIDE = 0.8;
const FAR = Number.POSITIVE_INFINITY;

for (const seed of seeds.length > 0 ? seeds : [HARBOUR_SEED]) {
  const level = harbourLevel(seed);
  // The rules are the building's own, from where players start inside it: without the truck and
  // the harbour round it, which they know nothing of.
  const problems = checkLevel(generatedLevel(seed, { ...HARBOUR_SITE, gate: true }));
  const truck = level.truck;
  if (!truck) throw new Error("The harbour has no truck");

  // The ground: the highest floor over each cell, outside the building.
  const ground = new Float32Array(W * H).fill(Number.NaN);
  for (const floor of level.floors) {
    const i0 = Math.max(0, Math.ceil((floor.minX - AREA.minX) / CELL - 0.5));
    const i1 = Math.min(W - 1, Math.floor((floor.maxX - AREA.minX) / CELL - 0.5));
    const j0 = Math.max(0, Math.ceil((floor.minZ - AREA.minZ) / CELL - 0.5));
    const j1 = Math.min(H - 1, Math.floor((floor.maxZ - AREA.minZ) / CELL - 0.5));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const y = floorHeight(floor, AREA.minX + (i + 0.5) * CELL, AREA.minZ + (j + 0.5) * CELL);
        const k = j * W + i;
        if (Number.isNaN(ground[k]) || y > ground[k]) ground[k] = y;
      }
    }
  }
  const cellAt = (x: number, z: number) =>
    Math.floor((z - AREA.minZ) / CELL) * W + Math.floor((x - AREA.minX) / CELL);

  /**
   * How far every cell is from `start` for a mover of this radius, and the loading door: without
   * a jump either way.
   */
  const way = (
    radius: number,
    start: { x: number; z: number },
  ): { length: number; dist: Float32Array } | undefined => {
    const blocked = new Uint8Array(W * H);
    for (const box of level.boxes) {
      const i0 = Math.max(0, Math.ceil((box.minX - radius - AREA.minX) / CELL - 0.5));
      const i1 = Math.min(W - 1, Math.floor((box.maxX + radius - AREA.minX) / CELL - 0.5));
      const j0 = Math.max(0, Math.ceil((box.minZ - radius - AREA.minZ) / CELL - 0.5));
      const j1 = Math.min(H - 1, Math.floor((box.maxZ + radius - AREA.minZ) / CELL - 0.5));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const y = ground[j * W + i];
          if (box.y < y + PLAYER_HEIGHT && box.y + box.height > y + STEP_UP) blocked[j * W + i] = 1;
        }
      }
    }
    const from = cellAt(start.x, start.z);
    const to = cellAt(level.entrance.x, HARBOUR_SITE.z - 0.6);
    const dist = new Float32Array(W * H).fill(FAR);
    dist[from] = 0;
    let frontier = [from];
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const k of frontier) {
        const i = k % W;
        const j = (k - i) / W;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const [ni, nj] = [i + di, j + dj];
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          if (blocked[n] || Number.isNaN(ground[n]) || dist[n] !== FAR) continue;
          // No jump either way: a step up going, and the same step coming back.
          if (Math.abs(ground[n] - ground[k]) > STEP_UP) continue;
          dist[n] = dist[k] + CELL;
          next.push(n);
        }
      }
      frontier = next;
    }
    return dist[to] === FAR ? undefined : { length: dist[to], dist };
  };

  // On foot from where players start, between the benches. Two with a sofa turn it lengthwise to
  // get it up the ramp, so their way is measured from a step beyond the ramp's foot.
  const onFoot = way(PLAYER_RADIUS, truck.spawn(0));
  const { rampFoot, place } = truck;
  const out = Math.hypot(rampFoot.x - place.x, rampFoot.z - place.z);
  const carrying = way(WIDE, {
    x: rampFoot.x + ((rampFoot.x - place.x) / out) * 1.2,
    z: rampFoot.z + ((rampFoot.z - place.z) / out) * 1.2,
  });
  if (!onFoot) problems.push("there's no way on foot between the truck and the loading door");
  if (!carrying)
    problems.push("the way from the truck to the loading door is too narrow for a sofa");

  console.log(
    `${level.name} (seed ${seed}): ${level.items.length} items, ${level.props.length} props, ` +
      `the way in ${onFoot ? `about ${Math.round(onFoot.length)} m` : "missing"}` +
      `${carrying ? `, ${Math.round(carrying.length)} m with a sofa` : ""}: ` +
      `${problems.length === 0 ? "ok" : `${problems.length} problems`}`,
  );
  for (const problem of problems) console.log(`  ${problem}`);
  failed ||= problems.length > 0;

  if (map) {
    // North up: `#` in the way, digits the tens of meters walked from the truck, `~` no ground,
    // `,` the lot and `.` the quay where the way doesn't reach.
    const inTheWay = (x: number, z: number) =>
      level.boxes.some(
        (b) =>
          x > b.minX &&
          x < b.maxX &&
          z > b.minZ &&
          z < b.maxZ &&
          b.y + b.height > ground[cellAt(x, z)] + STEP_UP,
      );
    for (let z = AREA.maxZ - 0.5; z > -85; z -= 1) {
      let line = "";
      for (let x = -40.5; x < 50; x += 1) {
        const k = cellAt(x, z);
        const d = (carrying ?? onFoot)?.dist[k] ?? FAR;
        line += inTheWay(x, z)
          ? "#"
          : Number.isNaN(ground[k])
            ? "~"
            : d === FAR
              ? ground[k] < 0.2
                ? ","
                : "."
              : String(Math.floor(d / 10) % 10);
      }
      console.log(`${String(Math.round(z)).padStart(4)} ${line}`);
    }
  }
}
process.exit(failed ? 1 : 0);
