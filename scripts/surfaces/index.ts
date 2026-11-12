/**
 * Bakes the surface library on the GPU: tiling PBR textures made in code, one WGSL recipe per
 * surface in recipes/<name>.wgsl over the library in lib/, at the size and tile in
 * client/src/surfaceTable.ts.
 *
 *   pnpm run surface                    list the surfaces
 *   pnpm run surface vinyl-tile rust    bake these
 *   pnpm run surface all                bake every one
 *
 * Options:
 *   --draft <px>   bake at this size and write only the preview, to iterate quickly
 *   --watch        bake again whenever a recipe or the library changes
 *   --out <dir>    write the textures here instead of the shared assets folder
 *
 * Each surface becomes assets/textures/surfaces/<name>-base.webp (sRGB colour; alpha, on tintable
 * surfaces, how much of the tint shows), <name>-normal.webp (from the height, at its real depth
 * against the tile's real size) and <name>-orm.webp (ambient occlusion, roughness, metalness), and
 * a contact sheet in node_modules/.cache/surfaces/<name>/preview.png: colour, normal, roughness and
 * occlusion; a lit render tiled 2×2, to see seams and repeats; and a lit crop at full size.
 *
 * Every pattern is periodic noise (lib/noise.wgsl), so the bakes tile, and seeded, so they're the
 * same every time. A recipe runs once per texel in a compute shader; post.wgsl then darkens
 * cavities, makes normals and the bytes of each texture, and draws the contact sheet. Only the
 * WebP and PNG encoding (sharp) runs on the CPU.
 */

import { existsSync, mkdirSync, readFileSync, watch } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { SURFACE_NAMES, SURFACES, type SurfaceName } from "../../client/src/surfaceTable";
import { sharedAssets } from "../sharedAssets";
import {
  closeGpu,
  LIB_DIR,
  libraryFiles,
  linear,
  openGpu,
  pipeline,
  RECIPE_DIR,
  ShaderError,
  Source,
} from "./gpu";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    draft: { type: "string" },
    watch: { type: "boolean" },
    out: { type: "string" },
  },
});

const here = import.meta.dirname;
const outDir = values.out ? resolve(values.out) : resolve(sharedAssets(), "textures/surfaces");
const cacheDir = resolve(here, "../../node_modules/.cache/surfaces");
const recipeFile = (name: string) => resolve(RECIPE_DIR, `${name}.wgsl`);

if (positionals.length === 0) {
  console.log("Surfaces (pnpm run surface <name…|all> [--draft <px>] [--watch]):");
  for (const name of SURFACE_NAMES) {
    const spec = SURFACES[name];
    const tint = spec.tint ? ", tintable" : "";
    const missing = existsSync(recipeFile(name)) ? "" : " (no recipe yet)";
    console.log(
      `  ${name.padEnd(16)} ${spec.tile} m, ${spec.size}px${tint}: ${spec.about}${missing}`,
    );
  }
  process.exit(0);
}

const names = positionals.includes("all") ? SURFACE_NAMES : (positionals as SurfaceName[]);
for (const name of names) {
  if (!SURFACES[name]) {
    console.error(`No surface called ${name} in client/src/surfaceTable.ts`);
    process.exit(1);
  }
  if (!existsSync(recipeFile(name))) {
    console.error(`No recipe for ${name}: write scripts/surfaces/recipes/${name}.wgsl`);
    process.exit(1);
  }
}

const draft = values.draft ? Number(values.draft) : undefined;
if (!draft) mkdirSync(outDir, { recursive: true });

/** Bakes a surface; a compile error is printed rather than thrown. False if it failed. */
async function bakeOrReport(name: SurfaceName): Promise<boolean> {
  try {
    await bake(name);
    return true;
  } catch (e) {
    if (!(e instanceof ShaderError)) throw e;
    console.error(`${name}: didn't compile\n${e.message}`);
    return false;
  }
}

/** Bakes the surfaces again when their recipe changes, or all of them when the library does. */
function watchRecipes() {
  console.log(`Watching ${names.length === 1 ? names[0] : `${names.length} recipes`} and lib/…`);
  const pending = new Set<SurfaceName>();
  let timer: NodeJS.Timeout | undefined;
  let busy = Promise.resolve();
  const queue = (list: readonly SurfaceName[]) => {
    for (const name of list) pending.add(name);
    clearTimeout(timer);
    // Editors write a file in a few steps; wait for the last.
    timer = setTimeout(() => {
      const batch = [...pending];
      pending.clear();
      busy = busy.then(async () => {
        for (const name of batch) await bakeOrReport(name);
      });
    }, 60);
  };
  watch(RECIPE_DIR, (_, file) => {
    const name = file && basename(file, ".wgsl");
    if (file?.endsWith(".wgsl") && names.includes(name as SurfaceName)) {
      queue([name as SurfaceName]);
    }
  });
  watch(LIB_DIR, (_, file) => {
    if (file?.endsWith(".wgsl")) queue(names);
  });
}

/** What a recipe declares besides sample(): `const CAVITY = vec2f(radius mm, strength);`. */
function cavityOf(code: string): { radius: number; strength: number } | undefined {
  const m = /^\s*const\s+CAVITY\s*=\s*vec2f\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/m.exec(code);
  return m ? { radius: Number(m[1]), strength: Number(m[2]) } : undefined;
}

/** Rows baked in one submission, so a slow recipe can't trip the driver's two-second watchdog. */
const BAND = 256;

// The bake pass's bindings, which the library's recipe.wgsl and BAKE_ENTRY share.
const BAKE_HEADER = `
struct Bake {
  size: u32,
  row0: u32,
}
@group(0) @binding(0) var<uniform> bake: Bake;
@group(0) @binding(1) var<storage, read_write> outColour: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outSurface: array<vec4f>;
`;

const BAKE_ENTRY = `
@compute @workgroup_size(8, 8)
fn bakeMain(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let row = id.y + bake.row0;
  if (x >= bake.size || row >= bake.size) {
    return;
  }
  let size = f32(bake.size);
  var o = Texel(vec3f(0.0), 0.0, 0.0, 1.0, 0.5, 0.0);
  // Row 0 is the top of the image, which the engine shows at v = 1.
  sample((f32(x) + 0.5) / size, 1.0 - (f32(row) + 0.5) / size, &o);
  let i = row * bake.size + x;
  outColour[i] = vec4f(o.col, o.a);
  outSurface[i] = vec4f(o.h, o.ao, o.rough, o.metal);
}
`;

const SETUP_ENTRY = `
@compute @workgroup_size(1)
fn setupMain() {
  for (var g = 0u; g < GROUPS; g++) {
    scatter.count[g] = 0u;
  }
  setup();
}
`;

const storage = (binding: number, type: GPUBufferBindingType = "storage") => ({
  binding,
  visibility: GPUShaderStage.COMPUTE,
  buffer: { type },
});

/** The post passes, compiled once. */
async function postPipelines() {
  const source = Source.files([resolve(LIB_DIR, "noise.wgsl"), resolve(here, "post.wgsl")]);
  const module = await source.compile(device, "post");
  const bindings = device.createBindGroupLayout({
    entries: [
      storage(0, "uniform"),
      storage(1, "read-only-storage"),
      storage(2, "read-only-storage"),
      ...[3, 4, 5, 6, 7, 8, 9, 10, 11].map((b) => storage(b)),
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindings] });
  const make = (entry: string) => pipeline(device, module, entry, layout);
  const [blurFirst, blurDown, blurAcross, finish, sumRows, contactSheet] = await Promise.all(
    ["blurFirst", "blurDown", "blurAcross", "finish", "sumRows", "contactSheet"].map(make),
  );
  return { bindings, blurFirst, blurDown, blurAcross, finish, sumRows, contactSheet };
}

const bakeBindings = () =>
  device.createBindGroupLayout({
    entries: [
      { ...storage(0, "uniform"), buffer: { type: "uniform", hasDynamicOffset: true } },
      storage(1),
      storage(2),
      storage(3),
    ],
  });

/** The recipe's pipelines: its setup, if it has one, and the bake. */
async function recipePipelines(name: SurfaceName) {
  const file = recipeFile(name);
  const code = readFileSync(file, "utf8");
  const hasSetup = /\bfn\s+setup\s*\(/.test(code);
  const module = await new Source([
    { file: "<bake header>", text: BAKE_HEADER },
    ...libraryFiles().map((f) => ({ file: f, text: readFileSync(f, "utf8") })),
    { file, text: code },
    { file: "<bake entry>", text: BAKE_ENTRY + (hasSetup ? SETUP_ENTRY : "") },
  ]).compile(device, name);
  const bindings = bakeBindings();
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindings] });
  // Compiled side by side: the bake is most of the wait.
  const [bake, setup] = await Promise.all([
    pipeline(device, module, "bakeMain", layout),
    hasSetup ? pipeline(device, module, "setupMain", layout) : undefined,
  ]);
  return { bindings, cavity: cavityOf(code), setup, bake };
}

function buffer(size: number, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC) {
  return device.createBuffer({ size, usage });
}

async function readBack(source: GPUBuffer, size: number): Promise<ArrayBuffer> {
  const staging = buffer(size, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.destroy();
  return copy;
}

async function bake(name: SurfaceName) {
  const spec = SURFACES[name];
  const size = draft ?? spec.size;
  const count = size * size;
  const started = performance.now();
  const recipe = await recipePipelines(name);
  const compiled = performance.now();

  // The recipe, a band of rows at a time, after its setup.
  const colour = buffer(count * 16);
  const surface = buffer(count * 16);
  const layoutBuffer = buffer(32 + 4096 * 32);
  const uniforms = device.createBuffer({
    size: 256 * Math.ceil(size / BAND),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bands = Math.ceil(size / BAND);
  const words = new Uint32Array(64 * bands);
  for (let b = 0; b < bands; b++) words.set([size, b * BAND], b * 64);
  device.queue.writeBuffer(uniforms, 0, words);
  const bakeGroup = device.createBindGroup({
    layout: recipe.bindings,
    entries: [
      { binding: 0, resource: { buffer: uniforms, size: 8 } },
      { binding: 1, resource: { buffer: colour } },
      { binding: 2, resource: { buffer: surface } },
      { binding: 3, resource: { buffer: layoutBuffer } },
    ],
  });
  if (recipe.setup) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(recipe.setup);
    pass.setBindGroup(0, bakeGroup, [0]);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  for (let b = 0; b < bands; b++) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(recipe.bake);
    pass.setBindGroup(0, bakeGroup, [b * 256]);
    pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(Math.min(BAND, size - b * BAND) / 8));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // Then the post passes.
  const mm = (spec.tile * 1000) / size; // millimetres per texel
  const cavity = recipe.cavity;
  const tint = spec.tint ? spec.tint.map(linear) : [0, 0, 0];
  const crop = Math.min(1024, size);
  const postData = new ArrayBuffer(64);
  const u32 = new Uint32Array(postData);
  const i32 = new Int32Array(postData);
  const f32 = new Float32Array(postData);
  u32[0] = size;
  i32[1] = cavity ? Math.max(1, Math.round(cavity.radius / mm / 2)) : 0;
  u32[2] = cavity ? 1 : 0;
  f32[3] = cavity?.radius ?? 1;
  f32[4] = cavity?.strength ?? 0;
  f32[5] = mm;
  u32[6] = spec.tint || spec.cutout ? 1 : 0;
  u32[7] = spec.cutout ? 1 : 0;
  f32.set(tint, 8);
  u32[11] = crop;
  u32[12] = Math.floor((size - crop) / 2);
  const postUniforms = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(postUniforms, 0, postData);
  const W = 2048;
  const H = 1536;
  const targets = {
    blurA: buffer(count * 4),
    blurB: buffer(count * 4),
    normals: buffer(count * 16),
    albedo: buffer(count * 16),
    base: buffer(count * 4),
    normal: buffer(count * 4),
    orm: buffer(count * 4),
    rowSums: buffer(size * 16),
    sheet: buffer(W * H * 4),
  };
  const postGroup = device.createBindGroup({
    layout: post.bindings,
    entries: [postUniforms, colour, surface, ...Object.values(targets)].map((b, binding) => ({
      binding,
      resource: { buffer: b },
    })),
  });
  const encoder = device.createCommandEncoder();
  const run = (p: GPUComputePipeline, x: number, y = 1) => {
    const pass = encoder.beginComputePass();
    pass.setPipeline(p);
    pass.setBindGroup(0, postGroup);
    pass.dispatchWorkgroups(x, y);
    pass.end();
  };
  const tiles = Math.ceil(size / 8);
  if (cavity) {
    run(post.blurFirst, tiles, tiles);
    run(post.blurDown, tiles, tiles);
    run(post.blurAcross, tiles, tiles);
    run(post.blurDown, tiles, tiles);
  }
  run(post.finish, tiles, tiles);
  run(post.sumRows, Math.ceil(size / 64));
  run(post.contactSheet, W / 8, H / 8);
  device.queue.submit([encoder.finish()]);

  const reads = [readBack(targets.sheet, W * H * 4), readBack(targets.rowSums, size * 16)];
  if (!draft)
    reads.push(...[targets.base, targets.normal, targets.orm].map((b) => readBack(b, count * 4)));
  const [sheetBytes, sums, base, normal, orm] = await Promise.all(reads);
  const baked = performance.now();

  for (const b of [
    colour,
    surface,
    layoutBuffer,
    uniforms,
    postUniforms,
    ...Object.values(targets),
  ])
    b.destroy();

  const rows = new Float32Array(sums);
  const sum = [0, 0, 0];
  for (let r = 0; r < size; r++) for (let c = 0; c < 3; c++) sum[c] += rows[r * 4 + c];
  const mean = sum.map((s) => srgb(s / count).toFixed(2)).join(", ");
  const ms = (a: number, b: number) => `${Math.round(b - a)} ms`;

  // The preview first, so a watched recipe shows as soon as it can.
  const dir = resolve(cacheDir, name);
  mkdirSync(dir, { recursive: true });
  await sharp(rgb(new Uint8Array(sheetBytes)), { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 3 })
    .toFile(resolve(dir, "preview.png"));
  const previewed = performance.now();
  console.log(
    `${name}: ${size}px preview in ${ms(started, previewed)} (compile ${ms(started, compiled)}, ` +
      `GPU ${ms(compiled, baked)}), average colour [${mean}]${draft ? " (draft)" : ""}`,
  );
  if (!base || !normal || !orm) return;

  const file = (kind: string) => resolve(outDir, `${name}-${kind}.webp`);
  // Tintable surfaces keep the tint amount in alpha; cut-out ones their coverage.
  const tintable = !!spec.tint || !!spec.cutout;
  const channels = tintable ? 4 : 3;
  const baseBytes = tintable ? new Uint8Array(base) : rgb(new Uint8Array(base));
  await Promise.all([
    // `exact` keeps the colour under clear alpha: there the tint is hidden and the colour is all.
    // With alpha, effort 6 takes minutes (its alpha is lossless) for files under 1% smaller.
    sharp(baseBytes, { raw: { width: size, height: size, channels } })
      .webp({ quality: 92, alphaQuality: 100, exact: true, effort: tintable ? 4 : 6 })
      .toFile(file("base")),
    sharp(rgb(new Uint8Array(normal)), { raw: { width: size, height: size, channels: 3 } })
      .webp({ quality: 96, effort: 6 })
      .toFile(file("normal")),
    sharp(rgb(new Uint8Array(orm)), { raw: { width: size, height: size, channels: 3 } })
      .webp({ quality: 94, effort: 6 })
      .toFile(file("orm")),
  ]);
  console.log(`${name}: textures in ${ms(started, performance.now())}`);
}

/** RGBA bytes as RGB. */
function rgb(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

/** Linear colour as sRGB, 0 to 1. */
function srgb(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

const device = await openGpu();
const post = await postPipelines();

if (values.watch) {
  for (const name of names) await bakeOrReport(name);
  watchRecipes();
} else {
  let failed = false;
  for (const name of names) failed = !(await bakeOrReport(name)) || failed;
  closeGpu(device);
  process.exit(failed ? 1 : 0);
}
