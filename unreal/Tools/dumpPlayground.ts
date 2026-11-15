/**
 * Writes what the web game's `composeTiles(PLAYGROUND_GRID)` makes (shared/tiles.ts, shared/level.ts)
 * as JSON to unreal/Tools/fixtures/playground.json, to check the Angelscript port in
 * unreal/Script/Level/ against: the floors, boxes, ladders and screens, in order, in game
 * coordinates (meters, x east, y up, z north), with a summary of counts by kind at the top.
 *
 *   pnpm exec tsx unreal/Tools/dumpPlayground.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYGROUND_GRID } from "../../shared/level";
import { composeTiles } from "../../shared/tiles";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "fixtures", "playground.json");

const tiles = composeTiles(PLAYGROUND_GRID);

const countBy = <T>(list: T[], key: (item: T) => string) => {
  const counts: Record<string, number> = {};
  for (const item of list) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
};

const summary = {
  floors: tiles.floors.length,
  boxes: tiles.boxes.length,
  ladders: tiles.ladders.length,
  screens: tiles.screens.length,
  floorsByKind: countBy(tiles.floors, (floor) => floor.kind),
  boxesByKind: countBy(tiles.boxes, (box) => box.kind),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ grid: PLAYGROUND_GRID, summary, ...tiles }, null, 2)}\n`);
console.log(`Wrote ${out}`);
console.log(JSON.stringify(summary, null, 2));
