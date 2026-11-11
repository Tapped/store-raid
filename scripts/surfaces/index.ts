/**
 * Bakes the surface library: tiling PBR textures made in code, one recipe per surface in
 * recipes/, at the size and tile in client/src/surfaceTable.ts.
 *
 *   pnpm run surface                    list the surfaces
 *   pnpm run surface vinyl-tile rust    bake these
 *   pnpm run surface all                bake every one
 *
 * Options:
 *   --draft <px>   bake at this size and write only the preview, to iterate quickly
 *
 * Each surface becomes assets/textures/surfaces/<name>-base.webp (sRGB colour; alpha, on tintable
 * surfaces, how much of the tint shows), <name>-normal.webp (from the height, at its real depth
 * against the tile's real size) and <name>-orm.webp (ambient occlusion, roughness, metalness), and
 * a contact sheet in node_modules/.cache/surfaces/<name>/preview.png: colour, normal, roughness and
 * occlusion; a lit render tiled 2×2, to see seams and repeats; and a lit crop at full size.
 *
 * Every pattern is periodic noise (noise.ts), so the bakes tile, and seeded, so they're the same
 * every time. Rows are shared out between worker threads.
 */

import { mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import sharp from "sharp";
import { SURFACE_NAMES, SURFACES, type SurfaceName } from "../../client/src/surfaceTable";
import { sharedAssets } from "../sharedAssets";
import { clamp, linear, srgb } from "./noise";
import { RECIPES } from "./recipes";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { draft: { type: "string" } },
});

const here = import.meta.dirname;
const outDir = resolve(sharedAssets(), "textures/surfaces");
const cacheDir = resolve(here, "../../node_modules/.cache/surfaces");

if (positionals.length === 0) {
  console.log("Surfaces (pnpm run surface <name…|all>):");
  for (const name of SURFACE_NAMES) {
    const spec = SURFACES[name];
    const tint = spec.tint ? ", tintable" : "";
    console.log(`  ${name.padEnd(16)} ${spec.tile} m, ${spec.size}px${tint}: ${spec.about}`);
  }
  process.exit(0);
}

const names = positionals.includes("all") ? SURFACE_NAMES : (positionals as SurfaceName[]);
for (const name of names) {
  if (!SURFACES[name] || !RECIPES[name]) {
    console.error(`No surface called ${name}`);
    process.exit(1);
  }
}

const draft = values.draft ? Number(values.draft) : undefined;
mkdirSync(outDir, { recursive: true });
for (const name of names) await bake(name);

/** The texels of one surface, 8 floats each: r, g, b, tint, height (mm), ao, rough, metal. */
async function run(name: SurfaceName, size: number): Promise<Float32Array> {
  const buffer = new SharedArrayBuffer(size * size * 8 * 4);
  const threads = Math.min(availableParallelism(), 16);
  const rows = Math.ceil(size / threads);
  const jobs: Promise<void>[] = [];
  for (let t = 0; t < threads; t++) {
    const start = t * rows;
    const end = Math.min(size, start + rows);
    if (start >= end) break;
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      workerData: { name, size, start, end, buffer },
      execArgv: ["--import", "tsx"],
    });
    jobs.push(
      new Promise((done, fail) => {
        worker.on("error", fail);
        worker.on("exit", (code) => (code === 0 ? done() : fail(new Error(`worker ${code}`))));
      }),
    );
  }
  await Promise.all(jobs);
  return new Float32Array(buffer);
}

/** A channel blurred with a box `radius` texels wide, twice, wrapping at the edges. */
function blur(src: Float32Array, size: number, radius: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  const n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (const horizontal of [true, false]) {
      for (let line = 0; line < size; line++) {
        let sum = 0;
        const at = (k: number) => {
          const w = ((k % size) + size) % size;
          return horizontal ? a[line * size + w] : a[w * size + line];
        };
        for (let k = -r; k <= r; k++) sum += at(k);
        for (let k = 0; k < size; k++) {
          const i = horizontal ? line * size + k : k * size + line;
          b[i] = sum / n;
          sum += at(k + r + 1) - at(k - r);
        }
      }
      [a, b] = [b, a];
    }
  }
  return a;
}

async function bake(name: SurfaceName) {
  const spec = SURFACES[name];
  const recipe = RECIPES[name];
  const size = draft ?? spec.size;
  const started = performance.now();
  const texels = await run(name, size);
  const count = size * size;
  const mm = (spec.tile * 1000) / size; // millimetres per texel

  const height = new Float32Array(count);
  for (let i = 0; i < count; i++) height[i] = texels[i * 8 + 4];

  // Hollows darken: how far a texel lies below the blurred height around it.
  if (recipe.cavity) {
    const { radius, strength } = recipe.cavity;
    const around = blur(height, size, radius / mm / 2);
    for (let i = 0; i < count; i++) {
      const depth = Math.max(0, around[i] - height[i]);
      texels[i * 8 + 5] *= 1 - clamp((depth / radius) * strength * 4, 0, 0.85);
    }
  }

  // Normals by a 3×3 Sobel of the height, in millimetres per millimetre: real depth over real size.
  const normal = new Uint8Array(count * 3);
  const nx = new Float32Array(count);
  const ny = new Float32Array(count);
  const nz = new Float32Array(count);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        h(x + 1, y - 1) +
        2 * h(x + 1, y) +
        h(x + 1, y + 1) -
        h(x - 1, y - 1) -
        2 * h(x - 1, y) -
        h(x - 1, y + 1);
      // Rows run down the image, v up it.
      const dy =
        h(x - 1, y - 1) +
        2 * h(x, y - 1) +
        h(x + 1, y - 1) -
        h(x - 1, y + 1) -
        2 * h(x, y + 1) -
        h(x + 1, y + 1);
      const sx = -dx / (8 * mm);
      const sy = -dy / (8 * mm);
      const len = Math.hypot(sx, sy, 1);
      const i = y * size + x;
      nx[i] = sx / len;
      ny[i] = sy / len;
      nz[i] = 1 / len;
      normal[i * 3] = Math.round((nx[i] * 0.5 + 0.5) * 255);
      normal[i * 3 + 1] = Math.round((ny[i] * 0.5 + 0.5) * 255);
      normal[i * 3 + 2] = Math.round((nz[i] * 0.5 + 0.5) * 255);
    }
  }

  // Tintable surfaces keep the tint amount in alpha; cut-out ones their coverage.
  const tintable = !!spec.tint || !!spec.cutout;
  const base = new Uint8Array(count * (tintable ? 4 : 3));
  const orm = new Uint8Array(count * 3);
  const channels = tintable ? 4 : 3;
  let sum = [0, 0, 0];
  const tint = spec.tint ? spec.tint.map(linear) : [0, 0, 0];
  // The colour as it will look, with the tint in: for the preview, and the average for the table.
  const albedo = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = texels.subarray(i * 8, i * 8 + 8);
    for (let c = 0; c < 3; c++) {
      base[i * channels + c] = Math.round(srgb(t[c]) * 255);
      // Cut-out surfaces show their holes dark.
      albedo[i * 3 + c] = spec.cutout ? (t[3] > 0.5 ? t[c] : 0.01) : clamp(t[c] + tint[c] * t[3]);
    }
    if (tintable) base[i * 4 + 3] = Math.round(clamp(t[3]) * 255);
    orm[i * 3] = Math.round(clamp(t[5]) * 255);
    orm[i * 3 + 1] = Math.round(clamp(t[6], 0.03, 1) * 255);
    orm[i * 3 + 2] = Math.round(clamp(t[7]) * 255);
    sum = sum.map((s, c) => s + albedo[i * 3 + c]);
  }

  if (!draft) {
    const file = (kind: string) => resolve(outDir, `${name}-${kind}.webp`);
    // `exact` keeps the colour under clear alpha: there the tint is hidden and the colour is all.
    await sharp(base, { raw: { width: size, height: size, channels } })
      .webp({ quality: 92, alphaQuality: 100, exact: true, effort: 6 })
      .toFile(file("base"));
    await sharp(normal, { raw: { width: size, height: size, channels: 3 } })
      .webp({ quality: 96, effort: 6 })
      .toFile(file("normal"));
    await sharp(orm, { raw: { width: size, height: size, channels: 3 } })
      .webp({ quality: 94, effort: 6 })
      .toFile(file("orm"));
  }

  await preview(name, size, texels, albedo, nx, ny, nz);
  const mean = sum.map((s) => srgb(s / count).toFixed(2)).join(", ");
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `${name}: ${size}px in ${seconds}s, average colour [${mean}]${draft ? " (draft)" : ""}`,
  );
}

/**
 * The contact sheet: colour, normal, roughness and occlusion along the top; below, the surface lit
 * by a warm light low from the left, tiled 2×2, and a crop of it at full size.
 */
async function preview(
  name: SurfaceName,
  size: number,
  texels: Float32Array,
  albedo: Float32Array,
  nx: Float32Array,
  ny: Float32Array,
  nz: Float32Array,
) {
  const W = 2048;
  const H = 1536;
  const sheet = new Uint8Array(W * H * 3);
  const count = size * size;

  // The lit surface, at full size, in sRGB bytes.
  const lit = new Uint8Array(count * 3);
  const L = normalise([-0.62, 0.42, 0.42]);
  const light = [1.0, 0.82, 0.62].map((c) => c * 2.4);
  for (let i = 0; i < count; i++) {
    const n = [nx[i], ny[i], nz[i]];
    const ao = texels[i * 8 + 5];
    const rough = clamp(texels[i * 8 + 6], 0.03, 1);
    const metal = texels[i * 8 + 7];
    const ndl = Math.max(0, dot(n, L));
    const half = normalise([L[0], L[1], L[2] + 1]);
    const ndh = Math.max(0, dot(n, half));
    const alpha = rough * rough;
    const a2 = alpha * alpha;
    const d = ndh * ndh * (a2 - 1) + 1;
    const ggx = a2 / (Math.PI * d * d);
    const spec = Math.min(ggx * 0.25, 40) * ndl;
    for (let c = 0; c < 3; c++) {
      const al = albedo[i * 3 + c];
      const f0 = 0.04 * (1 - metal) + al * metal;
      const diffuse = al * (1 - metal) * (ndl * light[c] + 0.05 * ao);
      const v = diffuse * ao + spec * f0 * light[c] * ao;
      lit[i * 3 + c] = Math.round(srgb(v / (1 + v)) * 255);
    }
  }

  const put = (img: Uint8Array, imgSize: number, x0: number, y0: number, out: number, from = 0) => {
    // Box-filtered down (or cropped when `out` is a crop of a bigger image).
    const step = from ? 1 : imgSize / out;
    for (let y = 0; y < out; y++) {
      for (let x = 0; x < out; x++) {
        const acc = [0, 0, 0];
        const k = Math.max(1, Math.floor(step));
        for (let j = 0; j < k; j++) {
          for (let i = 0; i < k; i++) {
            const sx = Math.floor(x * step) + i;
            const sy = Math.floor(y * step) + j;
            const p = ((sy % imgSize) * imgSize + (sx % imgSize)) * 3;
            acc[0] += img[p];
            acc[1] += img[p + 1];
            acc[2] += img[p + 2];
          }
        }
        const q = ((y0 + y) * W + x0 + x) * 3;
        for (let c = 0; c < 3; c++) sheet[q + c] = acc[c] / (k * k);
      }
    }
  };
  const bytes = (f: (i: number) => [number, number, number]) => {
    const img = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) img.set(f(i), i * 3);
    return img;
  };
  const albedoImg = bytes(
    (i) => [0, 1, 2].map((c) => srgb(albedo[i * 3 + c]) * 255) as [number, number, number],
  );
  const normalImg = bytes(
    (i) => [nx[i], ny[i], nz[i]].map((c) => (c * 0.5 + 0.5) * 255) as [number, number, number],
  );
  const roughImg = bytes((i) => {
    const r = texels[i * 8 + 6] * 255;
    const m = texels[i * 8 + 7];
    return [r, r, r * (1 - m) + 255 * m * 0.6] as [number, number, number];
  });
  const aoImg = bytes((i) => {
    const a = texels[i * 8 + 5] * 255;
    return [a, a, a];
  });
  put(albedoImg, size, 0, 0, 512);
  put(normalImg, size, 512, 0, 512);
  put(roughImg, size, 1024, 0, 512);
  put(aoImg, size, 1536, 0, 512);
  // Tiled 2×2: each repeat at 512.
  for (const [tx, ty] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ])
    put(lit, size, tx * 512, 512 + ty * 512, 512);
  // A crop at full size, from the middle, so it shows texels as they are.
  const crop = Math.min(1024, size);
  const cropped = new Uint8Array(crop * crop * 3);
  const off = Math.floor((size - crop) / 2);
  for (let y = 0; y < crop; y++)
    cropped.set(
      lit.subarray(((off + y) * size + off) * 3, ((off + y) * size + off + crop) * 3),
      y * crop * 3,
    );
  put(cropped, crop, 1024, 512, crop, 1);

  const dir = resolve(cacheDir, name);
  mkdirSync(dir, { recursive: true });
  await sharp(sheet, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toFile(resolve(dir, "preview.png"));
}

function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalise(a: number[]) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
}
