/**
 * Writes what the web game makes of seeds 1..N, as text, to check the Angelscript port against:
 *
 * - unreal/Tools/fixtures/generated.txt: what `generate()` (shared/generate.ts) makes at the size of
 *   generated levels (`GENERATED_SIZE`), for Generate.as. Per seed: the attempts it took, the
 *   entrance, each storey as drawn, the rooms with their cells, and each cell's distance from the
 *   entrance (`.` unreached) and room.
 * - unreal/Tools/fixtures/furnished.txt: what `generatedLevel(seed)` (shared/level.ts) furnishes it
 *   with (shared/furnish.ts), for Furnish.as and Warehouse.as: rooms, props, the props' boxes,
 *   lights and items, in order. Numbers are in micrometres, rounded, so the last bits of sines and
 *   arctangents, which differ between V8 and C++, don't count.
 *
 * `Generate_Test.as` and `Furnish_Test.as` read them and write their own in the same form to
 * unreal/Saved/, to diff.
 *
 *   pnpm exec tsx unreal/Tools/dumpGenerated.ts [count, default 100] [furnished count, default count]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../../shared/generate";
import { GENERATED_SIZE, generatedLevel } from "../../shared/level";
import { composeTiles } from "../../shared/tiles";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "fixtures", "generated.txt");
const count = Number(process.argv[2] ?? 100);
const furnishedCount = Number(process.argv[3] ?? count);

const { cols, rows, storeys, basements } = GENERATED_SIZE;
const lines: string[] = [];
for (let seed = 1; seed <= count; seed++) {
  const generated = generate({ ...GENERATED_SIZE, seed });
  lines.push(`seed ${seed} attempts ${generated.attempts}`);
  const { storey, col, row } = generated.entrance;
  lines.push(`entrance ${storey} ${col} ${row}`);
  for (const [index, drawn] of generated.grid.storeys.entries()) {
    lines.push(`storey ${index - basements}`);
    lines.push(...drawn);
  }
  for (const [id, room] of generated.rooms.entries()) {
    const cells = room.cells.map((cell) => `${cell.col},${cell.row}`).join(" ");
    lines.push(`room ${id} ${room.kind} ${room.storey} ${cells}`);
  }
  for (let storey = -basements; storey < storeys - basements; storey++) {
    for (let row = rows - 1; row >= 0; row--) {
      const cells: string[] = [];
      for (let col = 0; col < cols; col++) {
        const distance = generated.distance({ storey, col, row });
        const room = generated.roomAt({ storey, col, row });
        cells.push(`${distance ?? "."}/${room}`);
      }
      lines.push(`distance ${storey} ${row} ${cells.join(" ")}`);
    }
  }
  lines.push(
    `floors ${generated.floors.map((cell) => `${cell.storey},${cell.col},${cell.row}`).join(" ")}`,
  );
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`Wrote ${out}: ${count} seeds, ${lines.length} lines`);

/** A length in whole micrometres, as the port writes it too. */
const um = (value: number) => `${Math.round(value * 1e6) || 0}`;
const bareOf = (level: ReturnType<typeof generatedLevel>) =>
  level.grid ? composeTiles(level.grid).boxes.length : 0;
const furnished: string[] = [];
for (let seed = 1; seed <= furnishedCount; seed++) {
  const level = generatedLevel(seed);
  furnished.push(`seed ${seed} tiles ${bareOf(level)} dropped ${level.dropped}`);
  for (const room of level.rooms) {
    const { minX, maxX, minZ, maxZ } = room.bounds;
    furnished.push(
      `room ${room.id} ${room.kind} ${room.storey} ${um(room.y)} ${[minX, maxX, minZ, maxZ].map(um).join(" ")} ${um(room.depth)} ${room.cells.length}`,
    );
  }
  for (const prop of level.props) {
    furnished.push(
      `prop ${prop.model} ${[prop.x, prop.y, prop.z, prop.turn].map(um).join(" ")} ${prop.room}`,
    );
  }
  const bare = bareOf(level);
  for (const box of level.boxes.slice(bare)) {
    furnished.push(
      `box ${box.kind} ${[box.minX, box.maxX, box.minZ, box.maxZ, box.y, box.height].map(um).join(" ")}`,
    );
  }
  for (const light of level.lights) {
    furnished.push(
      `light ${light.kind} ${[light.x, light.y, light.z, light.turn, ...light.color, light.power].map(um).join(" ")} ${light.state} ${light.room}`,
    );
  }
  for (const item of level.items) {
    furnished.push(`item ${item.kind} ${[item.x, item.y, item.z].map(um).join(" ")}`);
  }
}
const furnishedOut = join(here, "fixtures", "furnished.txt");
writeFileSync(furnishedOut, `${furnished.join("\n")}\n`);
console.log(`Wrote ${furnishedOut}: ${furnishedCount} seeds, ${furnished.length} lines`);
