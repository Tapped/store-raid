/**
 * The sounds in `../assets/audio/sfx` (OGG and WAV, as the web game plays them) staged for
 * `sounds.py`: each as a 16-bit PCM WAV at its own rate and channels, which Unreal's importer
 * always reads, in `unreal/Saved/Import/sounds/`, and `sounds.json` saying which loop. Converted by
 * ffmpeg, which has to be on the PATH. A staged file is only written again when its source is newer.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ASSETS, STAGED } from "./stage";

/**
 * The sounds that play on a loop (the web game's `Loop.play`): ambience and drones. Their waves are
 * marked looping, and keep playing silently while out of earshot rather than stopping.
 */
const LOOPS = new Set(["vent-hum", "tv-static", "river-flow", "valley-wind"]);

export interface StagedSound {
  name: string;
  loop: boolean;
}

/** Stages the sounds whose name contains one of `filters`, or all of them; returns them. */
export async function stageSounds(filters: string[]): Promise<StagedSound[]> {
  const from = join(ASSETS, "audio/sfx");
  const out = join(STAGED, "sounds");
  await mkdir(out, { recursive: true });
  const staged: StagedSound[] = [];
  let written = 0;
  for (const file of (await readdir(from)).sort()) {
    if (![".ogg", ".wav"].includes(extname(file))) continue;
    const name = basename(file, extname(file));
    if (filters.length && !filters.some((filter) => name.includes(filter))) continue;
    const source = join(from, file);
    const target = join(out, `${name}.wav`);
    if (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs) {
      const result = spawnSync(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-i", source, "-c:a", "pcm_s16le", target],
        { encoding: "utf8" },
      );
      if (result.error || result.status !== 0) {
        console.error(`${name}: ffmpeg failed: ${result.error?.message ?? result.stderr.trim()}`);
        continue;
      }
      written++;
    }
    staged.push({ name, loop: LOOPS.has(name) });
  }
  writeFileSync(join(out, "sounds.json"), `${JSON.stringify(staged, null, 2)}\n`);
  console.log(`${staged.length} sounds, ${written} staged now`);
  return staged;
}
