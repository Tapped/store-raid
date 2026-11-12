/**
 * Checks the village (shared/village.ts) without a server, and draws a map of it.
 *
 *   pnpm exec tsx scripts/village.ts [--map]
 *
 * - The ground: wherever a player can stand, the drawn ground (`villageGround`) must be the floor's
 *   height, or they'd float or sink. Prints the worst gaps.
 * - The ways through: walks out from the first spawn point as a player would, stepping up no more
 *   than STEP_UP and squeezing past nothing narrower than a player, and says which items, yards and
 *   doors can't be reached.
 * - `--map` prints the walkable valley, 2 m to a character, north up: `.` reachable, `~` in the
 *   river, `=` the track, `#` solid, `*` an item, `T` the truck, blank for floor nobody reaches.
 */
import { resolveCircleBox } from "../shared/collision";
import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_UP } from "../shared/constants";
import { type LevelBox, levelNamed } from "../shared/level";
import { groundUnder } from "../shared/movement";
import { near } from "../shared/spatial";
import { ROAD_HALF, roadX, valleyFloor, village, villageGround } from "../shared/village";

const started = performance.now();
const layout = village(1);
const built = performance.now() - started;
const level = levelNamed("village");
const counts = new Map<string, number>();
for (const p of layout.placements) counts.set(p.model, (counts.get(p.model) ?? 0) + 1);
console.log(
  `village: built in ${built.toFixed(0)} ms: ${level.floors.length} floors, ${level.boxes.length} boxes, ` +
    `${level.items.length} items, ${layout.placements.length} models`,
);
console.log(
  [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([model, n]) => `${model} ${n}`)
    .join(", "),
);

const blocking = (box: LevelBox, y: number, lift: number) =>
  box.y + box.height > y + lift && box.y < y + PLAYER_HEIGHT;
/** Whether a player standing here at this height is pushed by a box. */
function blocked(x: number, z: number, y: number): boolean {
  for (const box of near(level.boxes, x, z)) {
    if (!blocking(box, y, STEP_UP)) continue;
    const { dx, dz } = resolveCircleBox({ x, z, radius: PLAYER_RADIUS - 0.02 }, box);
    if (dx !== 0 || dz !== 0) return true;
    if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) return true;
  }
  return false;
}

// --- The ways through: a flood fill on a half-meter grid, at the height a player would be. ---
const STEP = 0.5;
const key = (x: number, z: number, y: number) =>
  `${Math.round(x / STEP)},${Math.round(z / STEP)},${Math.round(y * 10)}`;
const reached = new Map<string, number>();
const reachedCells = new Set<string>();
const cellKey = (x: number, z: number) => `${Math.round(x / STEP)},${Math.round(z / STEP)}`;
const start = level.spawnPoint(0);
const queue: [number, number, number][] = [[start.x, start.z, start.y ?? 0]];
reached.set(key(start.x, start.z, start.y ?? 0), start.y ?? 0);
while (queue.length > 0) {
  const [x, z, y] = queue.pop() as [number, number, number];
  reachedCells.add(cellKey(x, z));
  for (const [dx, dz] of [
    [STEP, 0],
    [-STEP, 0],
    [0, STEP],
    [0, -STEP],
  ]) {
    const nx = Math.round((x + dx) / STEP) * STEP;
    const nz = Math.round((z + dz) / STEP) * STEP;
    const ny = groundUnder(level, nx, nz, y + STEP_UP);
    if (ny === Number.NEGATIVE_INFINITY || y - ny > 2) continue;
    if (blocked(nx, nz, ny)) continue;
    const k = key(nx, nz, ny);
    if (reached.has(k)) continue;
    reached.set(k, ny);
    queue.push([nx, nz, ny]);
  }
}
// --- The ground: drawn against walked, everywhere a player reached (but on the bridge). ---
const onDeck = (x: number, z: number) =>
  layout.bridges.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
let worst = 0;
let worstAt = "";
let off = 0;
let samples = 0;
for (const [k, y] of reached) {
  const [col, row] = k.split(",").map(Number);
  const x = col * STEP;
  const z = row * STEP;
  if (onDeck(x, z)) continue;
  samples++;
  const gap = villageGround(x, z) - y;
  if (Math.abs(gap) > 0.08) off++;
  if (Math.abs(gap) > Math.abs(worst)) {
    worst = gap;
    worstAt = `(${x}, ${z})`;
  }
}
console.log(
  `ground: ${samples} places to stand, ${off} drawn more than 8 cm off; worst ${worst.toFixed(3)} m at ${worstAt}`,
);

const reachable = (x: number, z: number) => {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (reachedCells.has(cellKey(x + dx * STEP, z + dz * STEP))) return true;
    }
  }
  return false;
};
const lost = level.items.filter((item) => !reachable(item.x, item.z));
console.log(
  `ways: ${reachedCells.size} half-meter cells reachable; ${level.items.length - lost.length}/${level.items.length} items`,
);
for (const item of lost)
  console.log(`  unreachable ${item.kind} at (${item.x.toFixed(1)}, ${item.z.toFixed(1)})`);
for (const yard of layout.yards) {
  const x = (yard.minX + yard.maxX) / 2;
  const z = (yard.minZ + yard.maxZ) / 2;
  if (!reachable(x, z)) console.log(`  unreachable yard at (${x.toFixed(1)}, ${z.toFixed(1)})`);
}
if (!reachable(-1, 114)) console.log("  the churchyard can't be reached");
const top = groundUnder(level, -1, 114, 100);
console.log(`churchyard ground ${top.toFixed(2)} (want 7)`);
const fail = lost.length > 0 || Math.abs(worst) > 0.4;

if (process.argv.includes("--map")) {
  const rows: string[] = [];
  for (let z = 140; z >= -140; z -= 2) {
    let row = "";
    for (let x = -64; x <= 84; x += 2) {
      const cx = x + 1;
      const cz = z - 1;
      const item = level.items.some((i) => Math.abs(i.x - cx) < 1 && Math.abs(i.z - cz) < 1);
      const dock = level.dock;
      if (item) row += "*";
      else if (dock && cx > dock.minX && cx < dock.maxX && cz > dock.minZ && cz < dock.maxZ)
        row += "T";
      else if (reachable(cx, cz)) {
        const y = groundUnder(level, cx, cz, 100);
        row +=
          y < valleyFloor(cz) - 0.3 && cz < 108
            ? "~"
            : Math.abs(cx - roadX(cz)) < ROAD_HALF && cz < 94
              ? "="
              : ".";
      } else if (blocked(cx, cz, groundUnder(level, cx, cz, 100))) row += "#";
      else row += " ";
    }
    rows.push(`${String(z).padStart(4)} ${row}`);
  }
  console.log(rows.join("\n"));
}
process.exit(fail ? 1 : 0);
