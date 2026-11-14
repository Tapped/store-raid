/**
 * Builds game models from the Python scripts in this folder, with Blender in the background.
 *
 *   pnpm run model                  list the models
 *   pnpm run model tv sofa          build these
 *   pnpm run model --all            build every model
 *   pnpm run model barn --draft     only the preview, in seconds: nothing baked or written
 *   pnpm run model barn --draft --watch   again on every save of a script in this folder
 *
 * Options:
 *   --draft           render the preview from the live scene, its procedural materials unbaked, and
 *                     stop: no bake, export or file in assets/. For shape, proportion and how
 *                     materials read; a full build is needed for seams, texture resolution and
 *                     baked occlusion, which a draft hasn't (the studio's own shadows stand in)
 *   --quick           a full build with textures at a quarter of the size (occlusion at half) and
 *                     fewer samples, written to assets/ to look at in the game. Build it again
 *                     without --quick before backing up
 *   --watch           build again whenever a .py in scripts/models/ changes; Ctrl+C stops
 *   --views <list>    the views to render, comma separated, default front,side,three-quarter,back;
 *                     also left, rear, top, below
 *   --focus <spec>    frame a close-up instead of the whole model: a material's name (as in the
 *                     script; a build merged over atlases has lost them, so use a draft), or a point
 *                     "x,y,z" or box "x,y,z,r" in meters, in the script's own axes (write
 *                     --focus=-1,2,3 when it starts with a minus)
 *   --ref <image>     put this image beside the views on the sheet, labelled reference: a path, or
 *                     one under assets/ like concept/tick.png
 *   --no-preview      skip the preview renders
 *   --repack          skip Blender: finish these again from what their last build left in the cache
 *   --no-server       run Blender just for this build instead of through the one kept running
 *   --stop            stop the Blender kept running (see runner.ts)
 *   --blender <exe>   Blender to use, default BLENDER, else the newest installed
 *
 * Each script's build() makes the model with the helpers in lib.py (which explains the conventions).
 * Blender joins it into one mesh, bakes its procedural materials and exports it (pipeline.py).
 * Scenery (a prop of shared/props.ts or a village model) then has its parts merged over texture
 * atlases (atlas.ts), of at most 2048 pixels on a side unless the script says `ATLAS = 4096`, or
 * `ATLAS = 0` for none. Its textures become KTX2, which the GPU keeps compressed (ktx.ts), and it's
 * written to assets/ (models/props/<name>.glb unless the script says OUT). Finally Blender renders it
 * from four sides into one preview image (studio.py), from a copy with WebP textures, which it can
 * read, and the size, triangles and textures are printed, with a warning when an item doesn't match
 * ITEM_KINDS or a model is over its triangle budget.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getBounds, NodeIO, type Texture } from "@gltf-transform/core";
import { EXTTextureWebP, KHRONOS_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import { cloneDocument, dedup, prune, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import { ITEM_KINDS } from "../../shared/constants";
import { PROPS } from "../../shared/props";
import { sharedAssets } from "../sharedAssets";
import { findBlender } from "../unity-import/blender";
import { fixTangents } from "../unity-import/gltf";
import { packAtlas } from "./atlas";
import { type TextureKind, toKtx2 } from "./ktx";
import { Blender, type JobResult } from "./runner";

interface Built {
  error?: boolean;
  out: string;
  item: keyof typeof ITEM_KINDS | null;
  tris: number;
  budget: number | null;
  /** Blender axes: x, y (depth), z (up). */
  dims: [number, number, number];
  /** How far the mesh moved to put its origin in place, in Blender axes. */
  offset?: [number, number, number];
  /** The mesh's bounds in glTF axes, [min, max]. */
  bounds?: [number[], number[]];
  materials: string[];
  baked: { material: string; size: number }[];
  ao: boolean;
  draft?: boolean;
  quick?: boolean;
}

/** The views studio.py knows. */
const VIEWS = ["front", "side", "three-quarter", "back", "left", "rear", "top", "below"];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean", default: false },
    draft: { type: "boolean", default: false },
    quick: { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
    views: { type: "string" },
    focus: { type: "string" },
    ref: { type: "string" },
    "no-preview": { type: "boolean", default: false },
    repack: { type: "boolean", default: false },
    "no-server": { type: "boolean", default: false },
    stop: { type: "boolean", default: false },
    blender: { type: "string" },
  },
});

const here = import.meta.dirname;
const root = resolve(here, "../..");
const work = resolve(root, "node_modules/.cache/models");
mkdirSync(work, { recursive: true });

if (values.stop) {
  const blender = new Blender("", work, true);
  console.log(blender.stop() ? "Stopped the Blender kept running" : "No Blender was running");
  process.exit(0);
}

const HELPERS = new Set(["lib", "build", "pipeline", "studio"]);
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const wanted = values.all ? models : positionals;
const unknown = wanted.filter((n) => !models.includes(n));
if (unknown.length) fail(`No model script for ${unknown.join(", ")} in scripts/models/`);
if (values.draft && (values.quick || values.repack || values["no-preview"])) {
  fail("--draft is only a preview: it doesn't go with --quick, --repack or --no-preview");
}
const views = values.views?.split(",").map((v) => v.trim());
const badViews = views?.filter((v) => !VIEWS.includes(v)) ?? [];
if (badViews.length) fail(`No view ${badViews.join(", ")}: the views are ${VIEWS.join(", ")}`);
let reference: string | undefined;
if (values.ref) {
  reference = [resolve(values.ref), resolve(sharedAssets(), values.ref)].find(
    (p) => existsSync(p) && statSync(p).isFile(),
  );
  if (!reference) fail(`No image ${values.ref}, nor under assets/`);
}

const needsBlender = !(values.repack && values["no-preview"]);
const blender = new Blender(
  needsBlender ? (values.blender ?? findBlender()) : "",
  work,
  !values["no-server"],
);

/** Runs a job in Blender, printing what it said. */
async function inBlender<T>(job: object): Promise<JobResult<T>> {
  const result = await blender.run<T>(job);
  for (const line of result.log) console.error(line);
  return result;
}

/** A constant a model script sets at its top, like `ATLAS = 4096` or `OUT = "models/…"`. */
function constant(name: string, key: string): string | undefined {
  const source = readFileSync(`${here}/${name}.py`, "utf8");
  return source.match(new RegExp(`^${key}\\s*=\\s*["']?([^"'#\\s]+)`, "m"))?.[1];
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} kB`;

/**
 * Checks a model's size and origin against ITEM_KINDS, PROPS and its triangle budget, from its
 * bounds in glTF axes (x wide, y high, z deep). Returns the size line and the warnings.
 */
function check(name: string, b: Built, min: number[], max: number[]) {
  const warnings: string[] = [];
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
  return { size: `${size}${sizeNote}`, plainSize: size, warnings };
}

/** Renders the views of finished models in Blender, then lays out each one's sheet. */
async function previews(list: { name: string; b: Built; size: string }[], label: string) {
  if (!list.length) return;
  const job = {
    kind: "preview",
    models: list.map(({ name, b }) => ({
      name,
      glb: `${work}/${name}/preview.glb`,
      offset: b.offset,
    })),
    views,
    focus: values.focus,
  };
  const result = await inBlender<{ error?: boolean }>(job);
  for (const { name, b, size } of list) {
    if (result.models[name]?.error) {
      console.log(`\n${name}: the preview failed, see the Python error above`);
      continue;
    }
    console.log(
      `\n${name} preview: ${await sheetFor(name, `${name}   ${size}   ${b.tris} triangles${label}`)}`,
    );
  }
}

async function sheetFor(name: string, title: string) {
  const sheet = `${work}/${name}/preview.png`;
  const focus = values.focus ? `   close-up on ${values.focus}` : "";
  await contactSheet(
    `${work}/${name}/views`,
    views ?? VIEWS.slice(0, 4),
    sheet,
    `${title}${focus}`,
  );
  return sheet;
}

/** A draft: Blender renders the live scene, and nothing is written but the preview. */
async function draft(): Promise<boolean> {
  const started = Date.now();
  const job = {
    kind: "build",
    draft: true,
    models: wanted.map((name) => ({ name, script: `${here}/${name}.py` })),
    items: Object.fromEntries(Object.entries(ITEM_KINDS).map(([k, v]) => [k, v.size])),
    work,
    views,
    focus: values.focus,
  };
  const { models: built } = await inBlender<Built>(job);
  let failed = false;
  for (const name of wanted) {
    const b = built[name];
    if (!b || b.error || !b.bounds) {
      console.log(`\n${name}: failed, see the Python error above`);
      failed = true;
      continue;
    }
    const { size, plainSize, warnings } = check(name, b, b.bounds[0], b.bounds[1]);
    const title = `${name}   ${plainSize}   ${b.tris} triangles   DRAFT, unbaked`;
    console.log(`\n${name} (draft: nothing baked or written)`);
    console.log(`  ${size}`);
    console.log(`  ${b.tris} triangles${b.budget ? ` of ${b.budget}` : ""}`);
    console.log(`  materials: ${b.materials.join(", ")}`);
    console.log(`  preview: ${await sheetFor(name, title)}`);
    for (const warning of warnings) console.log(`  WARNING: ${warning}`);
    if (warnings.length) failed = true;
  }
  console.log(`\nDraft took ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return failed;
}

/** A full build (or a quick one): bake, export, pack, KTX2, into assets/, then the previews. */
async function full(): Promise<boolean> {
  const started = Date.now();
  let built: Record<string, Built>;
  if (values.repack) {
    // What Blender said of each model at its last build; of one built before that was kept, what
    // can be told without it.
    console.log(`Finishing ${wanted.join(", ")} again from the cache...`);
    built = {};
    for (const name of wanted) {
      if (!existsSync(`${work}/${name}/raw.glb`)) {
        fail(`${name} has no build in the cache: build it without --repack`);
      }
      const kept = `${work}/${name}/built.json`;
      built[name] = existsSync(kept)
        ? JSON.parse(readFileSync(kept, "utf8"))
        : {
            out: constant(name, "OUT") ?? `models/props/${name}.glb`,
            item: null,
            tris: 0,
            budget: null,
            dims: [0, 0, 0],
            materials: [],
            baked: [],
            ao: existsSync(`${work}/${name}/ao.png`),
          };
    }
  } else {
    console.log(`Building ${wanted.join(", ")}${values.quick ? " (quick)" : ""}...`);
    const job = {
      kind: "build",
      quick: values.quick,
      models: wanted.map((name) => ({ name, script: `${here}/${name}.py` })),
      items: Object.fromEntries(Object.entries(ITEM_KINDS).map(([k, v]) => [k, v.size])),
      work,
    };
    built = (await inBlender<Built>(job)).models;
    for (const [name, b] of Object.entries(built)) {
      if (!b.error) writeFileSync(`${work}/${name}/built.json`, JSON.stringify(b));
    }
  }

  const io = new NodeIO().registerExtensions([...KHRONOS_EXTENSIONS, EXTTextureWebP]);
  let failed = false;
  const toPreview: { name: string; b: Built; size: string }[] = [];
  const allWarnings: [string, string][] = [];

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
    // Scenery is drawn by the hundred, so its parts merge over atlases; items keep theirs, which
    // the game finds by name.
    const scenery = name in PROPS || b.out.startsWith("models/village/");
    const atlas = Number(constant(name, "ATLAS") ?? (scenery ? 2048 : 0));
    const packed = atlas ? await packAtlas(doc, name, atlas) : undefined;
    await doc.transform(dedup(), prune());

    // A copy with WebP textures for the preview: Blender can't read KTX2.
    const preview = cloneDocument(doc);
    await preview.transform(textureCompress({ encoder: sharp, targetFormat: "webp", quality: 85 }));
    if (preview.getRoot().listTextures().length) {
      preview.createExtension(EXTTextureWebP).setRequired(true);
    }
    await io.write(`${work}/${name}/preview.glb`, preview);

    // Colour is sRGB and normals are encoded as such; the rest is plain data.
    const kinds = new Map<Texture, TextureKind>();
    for (const m of doc.getRoot().listMaterials()) {
      for (const t of [m.getBaseColorTexture(), m.getEmissiveTexture()]) {
        if (t) kinds.set(t, "colour");
      }
      const normal = m.getNormalTexture();
      if (normal && !kinds.has(normal)) kinds.set(normal, "normal");
    }
    for (const t of doc.getRoot().listTextures()) {
      const image = t.getImage();
      if (!image) continue;
      t.setImage(await toKtx2(image, kinds.get(t) ?? "data", b.quick ? 0 : 2)).setMimeType(
        "image/ktx2",
      );
    }
    if (doc.getRoot().listTextures().length)
      doc.createExtension(KHRTextureBasisu).setRequired(true);
    mkdirSync(dirname(output), { recursive: true });
    await io.write(output, doc);

    // The report, from the finished file.
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    const { size, plainSize, warnings } = check(name, b, min, max);
    if (b.quick) {
      warnings.push(
        "a quick build, its textures at a quarter of the size: build it again without --quick",
      );
    }
    const textures = doc
      .getRoot()
      .listTextures()
      .map((t) => {
        const [tw, th] = t.getSize() ?? [0, 0];
        return `${t.getName() || "texture"} ${tw}×${th} ${kb(t.getImage()?.byteLength ?? 0)}`;
      });

    console.log(`\n${name} → ${b.out} (${kb(statSync(output).size)})`);
    console.log(`  ${size}`);
    if (b.tris) console.log(`  ${b.tris} triangles${b.budget ? ` of ${b.budget}` : ""}`);
    if (b.materials.length) console.log(`  materials: ${b.materials.join(", ")}`);
    if (packed) {
      const shrunk = packed.scale < 1 ? `, its images at 1/${1 / packed.scale} size` : "";
      console.log(`  atlas: ${packed.parts} parts over ${packed.width}×${packed.height}${shrunk}`);
      if (packed.scale < 1 && !b.quick && b.baked.length) {
        // Baking costs by the texel: what the atlas throws away was baked for nothing.
        const kept = Math.round(packed.scale * packed.scale * 100);
        console.log(
          `  NOTE: the atlas keeps ${kept}% of the baked texels: bake sizes ${1 / packed.scale}× smaller` +
            " in the script would look the same and bake that much faster",
        );
      }
    }
    if (textures.length) console.log(`  textures: ${textures.join(", ")}`);
    for (const warning of warnings) allWarnings.push([name, warning]);
    if (warnings.length) failed = true;
    toPreview.push({ name, b, size: plainSize });
  }

  if (!values["no-preview"])
    await previews(toPreview, values.quick ? "   QUICK: textures at 1/4" : "");
  for (const [name, warning] of allWarnings) console.log(`${name} WARNING: ${warning}`);
  console.log(`\nBuild took ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return failed;
}

async function once(): Promise<boolean> {
  try {
    return await (values.draft ? draft() : full());
  } catch (err) {
    console.error((err as Error).message);
    return true;
  }
}

if (!values.watch) {
  process.exit((await once()) ? 1 : 0);
}

// Watching: build again on every save of a script here, one build at a time.
await once();
console.log(`\nWatching scripts/models/ for changes to ${wanted.join(", ")} (Ctrl+C stops)`);
let building = false;
let again = false;
let timer: NodeJS.Timeout | undefined;
async function rebuild() {
  if (building) {
    again = true;
    return;
  }
  building = true;
  do {
    again = false;
    console.log(`\n--- ${new Date().toLocaleTimeString()}: building again`);
    await once();
  } while (again);
  building = false;
  console.log(`\nWatching (Ctrl+C stops)`);
}
watch(here, { recursive: true }, (_event, file) => {
  if (!file?.endsWith(".py")) return;
  clearTimeout(timer);
  // Editors save in bursts; wait for the last.
  timer = setTimeout(rebuild, 200);
});

/** The views on a grey background, two across, labelled, under a title; the reference beside. */
async function contactSheet(folder: string, names: string[], output: string, title: string) {
  const TILE = 640;
  const TOP = 48;
  const label = (text: string, size: number, width = TILE) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size * 1.6}">` +
        `<text x="12" y="${size * 1.2}" font-family="sans-serif" font-size="${size}" fill="#fff">` +
        `${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`,
    );
  const tiles: { input: string | Buffer; name: string }[] = names.map((n) => ({
    input: `${folder}/${n}.png`,
    name: n,
  }));
  if (reference) {
    const input = await sharp(reference)
      .resize(TILE, TILE, { fit: "contain", background: "#7a7a7a" })
      .png()
      .toBuffer();
    tiles.push({ input, name: "reference" });
  }
  const across = tiles.length === 1 ? 1 : 2;
  const down = Math.ceil(tiles.length / across);
  const width = TILE * across;
  await sharp({
    create: { width, height: TILE * down + TOP, channels: 3, background: "#7a7a7a" },
  })
    .composite([
      { input: label(title, across === 1 ? 14 : 24, width), left: 0, top: 4 },
      ...tiles.flatMap((t, i) => {
        const left = (i % across) * TILE;
        const top = TOP + Math.floor(i / across) * TILE;
        return [
          { input: t.input, left, top },
          { input: label(t.name, 18), left, top },
        ];
      }),
    ])
    .png()
    .toFile(output);
}
