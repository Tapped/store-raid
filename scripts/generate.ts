/**
 * Generates levels from seeds and prints them, to see what the generator makes.
 *
 *   pnpm exec tsx scripts/generate.ts [seed]      one level, drawn storey by storey: its tiles, then
 *                                                 its rooms, props and lights a meter to a character
 *   pnpm exec tsx scripts/generate.ts --many 200  seeds 1..200: each checked against the rules in
 *                                                 shared/levelCheck.ts, with what they hold and how
 *                                                 long they take
 */
import { ITEM_KINDS } from "../shared/constants";
import { generate } from "../shared/generate";
import { GENERATED_SIZE, generatedLevel, type Level, type RoomKind } from "../shared/level";
import { checkLevel } from "../shared/levelCheck";
import { quotaFor } from "../shared/modes";
import { PROPS, type PropName } from "../shared/props";
import { CELL, STOREY } from "../shared/tiles";

/** How each kind of room is written on the map of rooms. */
const ROOM_CHARS: Record<RoomKind, string> = {
  entrance: "E",
  hall: "H",
  stock: "S",
  cage: "C",
  workshop: "W",
  office: "O",
  staff: "R",
  plant: "P",
  corridor: "-",
  atrium: ".",
};

/** How props are written on the map of a storey, by what they are. */
function propChar(model: string): string {
  if (model.startsWith("container")) return "#";
  if (model.startsWith("pallet-rack")) return "=";
  if (model.startsWith("wall-shelf")) return "[";
  if (model === "cage-panel") return "x";
  if (model === "desk" || model === "workbench" || model === "staff-table") return "d";
  if (model === "locker-row" || model === "vending-machine" || model === "filing-cabinet")
    return "l";
  if (model === "boiler" || model === "switchgear" || model === "electrical-cabinet") return "b";
  if (model === "forklift") return "f";
  return "o";
}

const args = process.argv.slice(2);
if (args[0] === "--many") many(Number(args[1] ?? 100));
else one(Number(args[0] ?? 1));

function one(seed: number) {
  const started = performance.now();
  const level = generatedLevel(seed);
  const ms = performance.now() - started;
  const generated = generate({ ...GENERATED_SIZE, seed });
  console.log(
    `seed ${seed}: ${ms.toFixed(0)} ms, ${generated.attempts} tries, ${level.rooms.length} rooms, ` +
      `${level.props.length} props, ${level.lights.length} lights, ${level.items.length} items ` +
      `(quota ${quotaFor(level)}), ${level.dropped} props dropped for blocking the way`,
  );
  console.log(
    "\nRooms: E loading bay, H hall, S storeroom, C cage, W workshop, O office, R staff room, P plant, - corridor, . atrium",
  );
  console.log(
    "Props: # container, = pallet racking, [ shelving, x cage fence, d desk or bench, l lockers or cabinets, b plant, f forklift, o anything else",
  );
  console.log(
    "Lights: * on, ~ flickering, , dead; ! emergency, e exit sign. Items: $ loot, i flashlight",
  );
  const { basements } = GENERATED_SIZE;
  generated.grid.storeys.forEach((lines, i) => {
    const storey = i - basements;
    console.log(`\nstorey ${storey}: tiles, then rooms`);
    const rooms = roomMap(level, storey);
    for (const [j, line] of lines.entries()) {
      // The rooms beside the tiles, on the rows with cells in them.
      const row = (lines.length - 2 - j) / 2;
      const extra = j % 2 === 1 ? `    ${rooms[rooms.length - 1 - Math.floor(row)]}` : "";
      console.log(`  ${line}${extra}`);
    }
    console.log(`\nstorey ${storey}: props, lights and items, a meter to a character`);
    for (const line of detailMap(level, storey)) console.log(`  ${line}`);
  });
  console.log("\nrooms:");
  for (const room of level.rooms) {
    const lights = level.lights.filter((light) => light.room === room.id);
    const on = lights.filter((light) => light.state === "on").length;
    const props = level.props.filter((prop) => prop.room === room.id).length;
    console.log(
      `  ${String(room.id).padStart(2)} ${room.kind.padEnd(8)} storey ${String(room.storey).padStart(2)}, ` +
        `${String(room.cells.length).padStart(3)} cells, depth ${room.depth.toFixed(2)}, ` +
        `${String(props).padStart(3)} props, ${lights.length} lights of which ${on} on`,
    );
  }
  const problems = checkLevel(level);
  console.log(
    problems.length === 0 ? "\nevery rule holds" : `\nproblems:\n  ${problems.join("\n  ")}`,
  );
}

/** Each row of cells of a storey as the kinds of the rooms they're in, the northern row first. */
function roomMap(level: Level, storey: number): string[] {
  const { cols, rows } = GENERATED_SIZE;
  const map = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  for (const room of level.rooms) {
    if (room.storey !== storey) continue;
    for (const { col, row } of room.cells) map[row][col] = ROOM_CHARS[room.kind];
  }
  return map.map((row) => row.join("")).reverse();
}

/** A storey a meter to a character: walls, props, lights and items, the north first. */
function detailMap(level: Level, storey: number): string[] {
  const { cols, rows } = GENERATED_SIZE;
  const grid = level.grid;
  if (!grid) return [];
  const width = cols * CELL;
  const depth = rows * CELL;
  const map = Array.from({ length: depth }, () => new Array<string>(width).fill(" "));
  const base = storey * STOREY;
  const put = (x: number, z: number, char: string) => {
    const i = Math.floor(x - grid.x);
    const j = Math.floor(z - grid.z);
    if (i >= 0 && j >= 0 && i < width && j < depth) map[j][i] = char;
  };
  // What players can't walk through, at waist height.
  for (const box of level.boxes) {
    if (box.y > base + 1 || box.y + box.height < base + 1) continue;
    if (box.kind === "furniture" || box.kind === "shelf" || box.kind === "mesh") continue;
    const char = box.kind === "rail" ? ":" : box.kind === "stairs" ? "/" : "|";
    for (let x = Math.floor(box.minX) + 0.5; x < box.maxX; x++) {
      for (let z = Math.floor(box.minZ) + 0.5; z < box.maxZ; z++) put(x, z, char);
    }
  }
  for (const prop of level.props) {
    const kind = PROPS[prop.model as PropName];
    if (kind.mount !== "floor" || Math.abs(prop.y - base) > 0.01 || !kind.solid) continue;
    const [w, , d] = kind.size;
    const turned = Math.abs(Math.sin(prop.turn)) > 0.5;
    const [hx, hz] = turned ? [d / 2, w / 2] : [w / 2, d / 2];
    for (let x = Math.floor(prop.x - hx) + 0.5; x < prop.x + hx; x++) {
      for (let z = Math.floor(prop.z - hz) + 0.5; z < prop.z + hz; z++)
        put(x, z, propChar(prop.model));
    }
  }
  for (const light of level.lights) {
    if (light.y < base || light.y > base + STOREY) continue;
    const char =
      light.kind === "exit"
        ? "e"
        : light.kind === "emergency"
          ? "!"
          : light.state === "on"
            ? "*"
            : light.state === "flicker"
              ? "~"
              : ",";
    put(light.x, light.z, char);
  }
  for (const item of level.items) {
    if (item.y < base || item.y > base + STOREY) continue;
    put(item.x, item.z, item.kind === "flashlight" ? "i" : "$");
  }
  return map.map((row) => row.join("")).reverse();
}

function many(count: number) {
  let attempts = 0;
  let worst = 0;
  let total = 0;
  let failed = 0;
  const sums = { rooms: 0, props: 0, lights: 0, items: 0, quota: 0, loot: 0, dropped: 0, dark: 0 };
  const kinds: Record<string, number> = {};
  const problems: string[] = [];
  for (let seed = 1; seed <= count; seed++) {
    const started = performance.now();
    let level: ReturnType<typeof generatedLevel>;
    try {
      level = generatedLevel(seed);
    } catch (error) {
      failed++;
      problems.push(`seed ${seed}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const ms = performance.now() - started;
    total += ms;
    worst = Math.max(worst, ms);
    attempts += generate({ ...GENERATED_SIZE, seed }).attempts;
    sums.rooms += level.rooms.length;
    sums.props += level.props.length;
    sums.lights += level.lights.length;
    sums.items += level.items.length;
    sums.quota += quotaFor(level);
    sums.loot += level.items.reduce((sum, item) => sum + ITEM_KINDS[item.kind].value, 0);
    sums.dropped += level.dropped;
    for (const room of level.rooms) {
      kinds[room.kind] = (kinds[room.kind] ?? 0) + 1;
      const lit = level.lights.some(
        (light) => light.room === room.id && light.state !== "dead" && light.kind !== "exit",
      );
      if (!lit && room.kind !== "atrium") sums.dark++;
    }
    for (const problem of checkLevel(level)) {
      failed++;
      problems.push(`seed ${seed}: ${problem}`);
    }
  }
  const each = (n: number) => (n / count).toFixed(1);
  console.log(
    `${count} seeds: ${(total / count).toFixed(0)} ms a level on average, ${worst.toFixed(0)} ms at worst, ` +
      `${each(attempts)} tries for the tiles`,
  );
  console.log(
    `on average ${each(sums.rooms)} rooms (${each(sums.dark)} with no light working), ${each(sums.props)} props ` +
      `(${each(sums.dropped)} dropped for blocking the way), ${each(sums.lights)} lights, ${each(sums.items)} items ` +
      `worth ${each(sums.loot)}, quota ${each(sums.quota)}`,
  );
  console.log(
    `rooms a level: ${Object.entries(kinds)
      .map(([kind, n]) => `${kind} ${each(n)}`)
      .join(", ")}`,
  );
  if (problems.length === 0) console.log("every rule holds on every seed");
  else {
    console.log(`${failed} problems:`);
    for (const problem of problems.slice(0, 40)) console.log(`  ${problem}`);
  }
  if (problems.length > 0) process.exitCode = 1;
}
