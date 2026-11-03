/**
 * Imports models from a Unity asset pack (`.unitypackage`) as finished game models.
 *
 *   pnpm exec tsx scripts/unity-import <pack.unitypackage>                     list the pack's prefabs
 *   pnpm exec tsx scripts/unity-import <pack.unitypackage> SM_Crate SM_TV=tv   import these prefabs
 *
 * Options:
 *   --out <folder>    under assets/, default models/props
 *   --lod <n>         level of detail to keep when a model has several, default 0
 *   --size <px>       texture width and height, default 512
 *   --blender <exe>   Blender to use, default BLENDER, else the newest installed
 *
 * Each prefab becomes `assets/<out>/<name>.glb`, named `SM_WoodCrate_01` → `wood-crate-01` unless
 * given as `Prefab=name`. Blender converts the prefab's FBX, then its materials' textures are added
 * as WebP. Textures are read from URP, HDRP and built-in slot names, with ORM packed as glTF wants
 * it (occlusion, roughness, metalness); other layouts come out untextured there, with a warning.
 *
 * The package is unpacked once into node_modules/.cache/unity-import/<pack>/, and kept for reruns.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { convert, findBlender, type Job } from "./blender";
import { finish } from "./gltf";
import { type Material, type Prefab, readMaterial, readPrefab, textureGuids } from "./unity";
import { UnityPackage } from "./unitypackage";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "models/props" },
    lod: { type: "string", default: "0" },
    size: { type: "string", default: "512" },
    blender: { type: "string" },
  },
});
const [packFile, ...wanted] = positionals;
if (!packFile) {
  console.error(
    "Usage: pnpm exec tsx scripts/unity-import <pack.unitypackage> [Prefab[=name] ...]",
  );
  process.exit(1);
}
const lod = Number(values.lod);
const size = Number(values.size);

const root = resolve(import.meta.dirname, "../..");
const cache = resolve(
  root,
  "node_modules/.cache/unity-import",
  basename(packFile).replace(/\.\w+$/, ""),
);
mkdirSync(cache, { recursive: true });
const pkg = await UnityPackage.open(resolve(packFile), cache);
const prefabs = pkg.find((e) => e.path.endsWith(".prefab"));

if (!wanted.length) {
  for (const e of prefabs.sort((a, b) => a.path.localeCompare(b.path))) console.log(e.path);
  console.log(`${prefabs.length} prefabs. Import some by naming them after the package.`);
  process.exit(0);
}

/** `SM_WoodCrate_01` → `wood-crate-01`. */
const kebab = (s: string) =>
  s
    .replace(/^(SM|SK|P|PF|Prefab)_/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

/** Assets are shared by every checkout, in `assets/` next to `main/` (see client/vite.config.ts). */
const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const outDir = resolve(dirname(dirname(gitDir)), "assets", values.out);

// Prefabs, then the models and textures they need.
const picked: { prefab: Prefab; out: string; materials: Material[] }[] = [];
for (const arg of wanted) {
  const [want, rename] = arg.split("=");
  const entry = prefabs.find((e) => basename(e.path, ".prefab") === want);
  if (!entry) {
    console.warn(`${want}: no such prefab in the package`);
    continue;
  }
  const prefab = readPrefab(pkg, entry.guid, lod);
  if (typeof prefab === "string") {
    console.warn(prefab);
    continue;
  }
  const model = pkg.name(prefab.mesh) ?? "";
  if (!/\.fbx$/i.test(model)) {
    console.warn(`${want}: its mesh is in ${model || "a missing file"}, and only FBX is supported`);
    continue;
  }
  picked.push({ prefab, out: kebab(rename || want), materials: [] });
}
if (!picked.length) process.exit(1);

await pkg.extract(picked.map((p) => p.prefab.mesh));
for (const p of picked) p.materials = p.prefab.materials.map((g) => readMaterial(pkg, g));
await pkg.extract(picked.flatMap((p) => p.materials.flatMap(textureGuids)));

// Blender wants the file extension, which Unity's `asset` files lack.
const work = resolve(cache, "work");
mkdirSync(work, { recursive: true });
const jobs: Job[] = picked.map((p) => {
  const file = `${work}/${p.out}.fbx`;
  copyFileSync(pkg.assetFile(p.prefab.mesh), file);
  return { name: p.out, file, lod };
});
const blender = values.blender ?? findBlender();
console.log(`Converting ${jobs.length} models with ${blender}...`);
const converted = convert(blender, jobs, work);

mkdirSync(outDir, { recursive: true });
for (const p of picked) {
  const c = converted[p.out];
  if (!c) continue;
  const output = `${outDir}/${p.out}.glb`;
  const warnings = await finish(`${work}/${p.out}.glb`, output, {
    pkg,
    materials: p.materials,
    slots: c.slots,
    size,
  });
  // Blender's dims are x, y, z up; the game's are x, y up, z.
  const [x, y, z] = c.dims;
  console.log(
    `${p.prefab.name} → ${values.out}/${p.out}.glb: ${c.polys} polys, LOD${c.lod}, ${x} × ${z} × ${y} m (w × h × d)`,
  );
  for (const w of warnings) console.log(`  ${w}`);
}
