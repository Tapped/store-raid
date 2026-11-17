/**
 * Writes what the web game's `generate()` (shared/generate.ts) makes for seeds 1..N, at the size of
 * generated levels (`GENERATED_SIZE`), as text to unreal/Tools/fixtures/generated.txt, to check the
 * Angelscript port in unreal/Script/Level/Generate.as against (`Generate_Test.as` reads the file and
 * writes its own in the same form). Per seed: the attempts it took, the entrance, each storey as
 * drawn, the rooms with their cells, and each cell's distance from the entrance (`.` unreached).
 *
 *   pnpm exec tsx unreal/Tools/dumpGenerated.ts [count, default 100]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../../shared/generate";
import { GENERATED_SIZE } from "../../shared/level";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "fixtures", "generated.txt");
const count = Number(process.argv[2] ?? 100);

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
