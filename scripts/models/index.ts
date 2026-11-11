/**
 * Builds game models from the Python scripts in this folder, with Blender in the background.
 *
 *   pnpm run model            list the models
 *   pnpm run model tv sofa    build these
 *   pnpm run model --all      build every model
 *
 * Options:
 *   --no-preview      skip the preview renders
 *   --blender <exe>   Blender to use, default BLENDER, else the newest installed
 *
 * Each script's build() makes the model with the helpers in lib.py (which explains the conventions).
 * Blender joins it into one mesh, bakes its procedural materials and exports it; then its textures
 * become WebP and it's written to assets/ (models/props/<name>.glb unless the script says OUT).
 * Finally Blender renders it from four sides into one preview image, and the size, triangles and
 * textures are printed, with a warning when an item doesn't match ITEM_KINDS or a model is over
 * its triangle budget.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getBounds, NodeIO } from "@gltf-transform/core";
import { EXTTextureWebP, KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import { ITEM_KINDS } from "../../shared/constants";
import { PROPS } from "../../shared/props";
import { sharedAssets } from "../sharedAssets";
import { findBlender } from "../unity-import/blender";
import { fixTangents } from "../unity-import/gltf";

interface Built {
  error?: boolean;
  out: string;
  item: keyof typeof ITEM_KINDS | null;
  tris: number;
  budget: number | null;
  /** Blender axes: x, y (depth), z (up). */
  dims: [number, number, number];
  materials: string[];
  baked: { material: string; size: number }[];
  ao: boolean;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean", default: false },
    "no-preview": { type: "boolean", default: false },
    blender: { type: "string" },
  },
});

const here = import.meta.dirname;
const HELPERS = new Set(["lib", "build", "preview"]);
// A script without build() is a module that model scripts share, not a model.
const models = readdirSync(here)
  .filter((f) => f.endsWith(".py") && !HELPERS.has(basename(f, ".py")))
  .filter((f) => /^def build\(/m.test(readFileSync(`${here}/${f}`, "utf8")))
  .map((f) => basename(f, ".py"))
  .sort();

if (!values.all && !positionals.length) {
  for (const name of models) {
    const doc = readFileSync(`${here}/${name}.py`, "utf8").match(/^"""\s*\n?(.+)/);
    console.log(`${name.padEnd(20)} ${doc?.[1].trim() ?? ""}`);
  }
  console.log(`${models.length} models. Build some with: pnpm run model <name> ...`);
  process.exit(0);
}

const wanted = values.all ? models : positionals;
const unknown = wanted.filter((n) => !models.includes(n));
if (unknown.length) {
  console.error(`No model script for ${unknown.join(", ")} in scripts/models/`);
  process.exit(1);
}

const root = resolve(here, "../..");
const work = resolve(root, "node_modules/.cache/models");
mkdirSync(work, { recursive: true });
const blender = values.blender ?? findBlender();

/** Runs a Python script in Blender, printing the lines it marks and any Python error. */
function runBlender(script: string, args: string[]) {
  const argv = ["-b", "--factory-startup", "--python-exit-code", "1", "--python", script];
  try {
    const log = execFileSync(blender, [...argv, "--", ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const line of log.split("\n")) {
      if (line.startsWith("MODEL ")) console.error(line.slice(6));
    }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    console.error(`${basename(script)} failed in Blender:`);
    console.error(`${e.stdout ?? ""}${e.stderr ?? ""}`.split("\n").slice(-40).join("\n"));
    process.exit(1);
  }
}

console.log(`Building ${wanted.join(", ")} with ${blender}...`);
const job = {
  models: wanted.map((name) => ({ name, script: `${here}/${name}.py` })),
  items: Object.fromEntries(Object.entries(ITEM_KINDS).map(([k, v]) => [k, v.size])),
  work,
};
writeFileSync(`${work}/job.json`, JSON.stringify(job));
runBlender(`${here}/build.py`, [`${work}/job.json`]);
const built: Record<string, Built> = JSON.parse(readFileSync(`${work}/built.json`, "utf8"));

const io = new NodeIO().registerExtensions([...KHRONOS_EXTENSIONS, EXTTextureWebP]);
const kb = (bytes: number) => `${Math.round(bytes / 1024)} kB`;
let failed = false;

for (const name of wanted) {
  const b = built[name];
  if (!b || b.error) {
    console.log(`\n${name}: failed, see the Python error above`);
    failed = true;
    continue;
  }
  const output = resolve(sharedAssets(), b.out);
  const doc = await io.read(`${work}/${name}/raw.glb`);
  fixTangents(doc);
  if (b.ao) {
    // The baked occlusion is on the second UV layout, TEXCOORD_1, shared by every material.
    const ao = doc
      .createTexture("ao")
      .setMimeType("image/png")
      .setImage(readFileSync(`${work}/${name}/ao.png`));
    for (const m of doc.getRoot().listMaterials()) {
      m.setOcclusionTexture(ao).setOcclusionStrength(1);
      m.getOcclusionTextureInfo()?.setTexCoord(1);
    }
  }
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", quality: 85 }),
  );
  if (doc.getRoot().listTextures().length) doc.createExtension(EXTTextureWebP).setRequired(true);
  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);

  // The report, from the finished file: glTF axes, so x wide, y high, z deep.
  const warnings: string[] = [];
  const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
  const [w, h, d] = [0, 1, 2].map((i) => max[i] - min[i]);
  const size = `${w.toFixed(3)} × ${h.toFixed(3)} × ${d.toFixed(3)} m (w × h × d)`;
  let sizeNote = "";
  if (b.item) {
    const want = ITEM_KINDS[b.item].size;
    const off = [w, h, d].some((v, i) => Math.abs(v - want[i]) > 0.01);
    sizeNote = off ? "" : `, matches ITEM_KINDS.${b.item}`;
    if (off) warnings.push(`ITEM_KINDS.${b.item} is ${want.join(" × ")}: the model doesn't fit it`);
  }
  if (name in PROPS) {
    // Scenery is placed by its catalogue size and mount without loading it, so both must hold.
    const prop = PROPS[name as keyof typeof PROPS];
    const off = [w, h, d].some(
      (v, i) => Math.abs(v - prop.size[i]) > Math.max(0.01, prop.size[i] * 0.03),
    );
    if (off) warnings.push(`PROPS.${name} is ${prop.size.join(" × ")}: the model doesn't fit it`);
    else sizeNote = `, matches PROPS.${name}`;
    const near = (v: number, want: number) => Math.abs(v - want) < 0.005;
    const centred = (i: number) => near(min[i] + max[i], 0);
    const origin = {
      floor: near(min[1], 0) && centred(0) && centred(2),
      wall: near(min[1], 0) && centred(0) && near(min[2], 0),
      ceiling: near(max[1], 0) && centred(0) && centred(2),
    }[prop.mount];
    if (!origin)
      warnings.push(`the origin isn't where a ${prop.mount} prop's goes (see shared/props.ts)`);
  }
  if (b.budget && b.tris > b.budget) {
    warnings.push(`${b.tris} triangles is over the budget of ${b.budget}`);
  }
  const textures = doc
    .getRoot()
    .listTextures()
    .map((t) => {
      const [tw, th] = t.getSize() ?? [0, 0];
      return `${t.getName() || "texture"} ${tw}×${th} ${kb(t.getImage()?.byteLength ?? 0)}`;
    });

  console.log(`\n${name} → ${b.out} (${kb(statSync(output).size)})`);
  console.log(`  ${size}${sizeNote}`);
  console.log(`  ${b.tris} triangles${b.budget ? ` of ${b.budget}` : ""}`);
  console.log(`  materials: ${b.materials.join(", ")}`);
  if (textures.length) console.log(`  textures: ${textures.join(", ")}`);

  if (!values["no-preview"]) {
    const views = `${work}/${name}/views`;
    mkdirSync(views, { recursive: true });
    runBlender(`${here}/preview.py`, [output, views]);
    const preview = `${work}/${name}/preview.png`;
    await contactSheet(views, preview, `${name}   ${size}   ${b.tris} triangles`);
    console.log(`  preview: ${preview}`);
  }
  for (const warning of warnings) console.log(`  WARNING: ${warning}`);
  if (warnings.length) failed = true;
}
process.exit(failed ? 1 : 0);

/** The four views on a grey background in a 2 × 2 grid, labelled, under a title. */
async function contactSheet(views: string, output: string, title: string) {
  const TILE = 640;
  const TOP = 48;
  const names = ["front", "side", "three-quarter", "back"];
  const label = (text: string, size: number, width = TILE) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size * 1.6}">` +
        `<text x="12" y="${size * 1.2}" font-family="sans-serif" font-size="${size}" fill="#fff">` +
        `${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`,
    );
  await sharp({
    create: { width: TILE * 2, height: TILE * 2 + TOP, channels: 3, background: "#7a7a7a" },
  })
    .composite([
      { input: label(title, 24, TILE * 2), left: 0, top: 4 },
      ...names.flatMap((n, i) => {
        const left = (i % 2) * TILE;
        const top = TOP + Math.floor(i / 2) * TILE;
        return [
          { input: `${views}/${n}.png`, left, top },
          { input: label(n, 18), left, top },
        ];
      }),
    ])
    .png()
    .toFile(output);
}
