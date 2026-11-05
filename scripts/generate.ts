/**
 * Generates levels from seeds and prints them, to see what the generator makes.
 *
 *   pnpm exec tsx scripts/generate.ts [seed]      one level, drawn storey by storey
 *   pnpm exec tsx scripts/generate.ts --many 200  how seeds 1..200 go: tries, floors, ways up
 */
import { generate } from "../shared/generate";
import { GENERATED_SIZE } from "../shared/level";

const args = process.argv.slice(2);
if (args[0] === "--many") {
  const count = Number(args[1] ?? 100);
  let attempts = 0;
  let floors = 0;
  let climbs = 0;
  const started = performance.now();
  for (let seed = 1; seed <= count; seed++) {
    const level = generate({ ...GENERATED_SIZE, seed });
    attempts += level.attempts;
    floors += level.floors.length;
    climbs += level.grid.storeys.join("").replace(/[^<>^vnesw]/g, "").length;
  }
  const ms = (performance.now() - started) / count;
  console.log(
    `${count} seeds: ${(attempts / count).toFixed(1)} tries, ${(floors / count).toFixed(1)} floors reached, ` +
      `${(climbs / count).toFixed(1)} stairs and ladders, ${ms.toFixed(1)} ms each`,
  );
} else {
  const seed = Number(args[0] ?? 1);
  const level = generate({ ...GENERATED_SIZE, seed });
  console.log(`seed ${seed}: ${level.attempts} tries, ${level.floors.length} floors reached`);
  level.grid.storeys.forEach((lines, i) => {
    console.log(`\nstorey ${i - (level.grid.basements ?? 0)}`);
    for (const line of lines) console.log(`  ${line}`);
  });
}
