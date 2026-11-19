/**
 * Builds the zombie from its two Meshy models: `pnpm run zombie`. The headless body and the head in
 * `assets/raw/characters/zombie/` are scaled to each other and joined by `scripts/zombie.py` in Blender,
 * into `assets/models/characters/zombie.glb`, a static model about 1.75 m tall facing +z.
 *
 * `--preview` writes nothing but renders it from the front, the side and at the neck into
 * `node_modules/.cache/zombie/`, to look at.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { findBlender } from "./unity-import/blender";

const ROOT = resolve(import.meta.dirname, "../..");
const RAW = `${ROOT}/assets/raw/characters/zombie`;
const MODEL = `${ROOT}/assets/models/characters/zombie.glb`;
const CACHE = resolve(import.meta.dirname, "../node_modules/.cache/zombie");

const preview = process.argv.includes("--preview");
mkdirSync(CACHE, { recursive: true });
const out = preview ? `${CACHE}/zombie` : MODEL;
const args = [
  "-b",
  "--factory-startup",
  "-P",
  resolve(import.meta.dirname, "zombie.py"),
  "--",
  RAW,
  out,
];
if (preview) args.push("--preview");
const log = execFileSync(findBlender(), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
for (const line of log.split("\n")) if (line.startsWith("zombie:")) console.log(line);
if (preview) console.log(`zombie: ${CACHE}/zombie-{front,side,neck}.png`);
