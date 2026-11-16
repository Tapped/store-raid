/**
 * The models in `../assets/models` as glTF files Unreal's Interchange can read, staged in
 * `unreal/Saved/Import/models/` for `import.py`.
 *
 * Models built by `pnpm run model` carry KTX2 textures (UASTC, `KHR_texture_basisu`, required), and
 * the rest WebP (`EXT_texture_webp`): Interchange reads neither. So every texture is decoded here
 * into a PNG, and the extensions are dropped. A staged file is only written again when its source
 * is newer.
 */

import { readFileSync, statSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { KHR_SUPERCOMPRESSION_ZSTD, read as readKtx } from "ktx-parse";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ASSETS = resolve(HERE, "../../../../assets");
export const STAGED = resolve(HERE, "../../Saved/Import");

const require = (await import("node:module")).createRequire(import.meta.url);
const WASM = join(
  dirname(require.resolve("@babylonjs/ktx2decoder/package.json")),
  "wasm/uastc_rgba8_unorm_v2.wasm",
);

/** Babylon's UASTC → RGBA8 decoder: blocks go in at 64 KiB, pixels come out right after them. */
let decoder: Promise<{ memory: WebAssembly.Memory; decode: (w: number, h: number) => number }>;
function uastc() {
  decoder ??= (async () => {
    const memory = new WebAssembly.Memory({ initial: 16 });
    const { instance } = await WebAssembly.instantiate(readFileSync(WASM), { env: { memory } });
    return { memory, decode: instance.exports.decode as (w: number, h: number) => number };
  })();
  return decoder;
}

/** A KTX2 file's largest level as RGBA pixels. */
async function decodeKtx2(
  file: Uint8Array,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const ktx = readKtx(file);
  const { pixelWidth: width, pixelHeight: height } = ktx;
  let blocks = ktx.levels[0].levelData;
  if (ktx.supercompressionScheme === KHR_SUPERCOMPRESSION_ZSTD) {
    blocks = new Uint8Array(zstdDecompressSync(blocks));
  } else if (ktx.supercompressionScheme !== 0) {
    throw new Error(`supercompression ${ktx.supercompressionScheme} isn't handled`);
  }
  const { memory, decode } = await uastc();
  const out = width * (Math.ceil(height / 4) * 4) * 4;
  const needed = 65536 + blocks.length + out;
  const pages = Math.ceil(needed / 65536) + 1;
  const have = memory.buffer.byteLength / 65536;
  if (pages > have) memory.grow(pages - have);
  new Uint8Array(memory.buffer, 65536, blocks.length).set(blocks);
  if (decode(width, height) !== 0) throw new Error("UASTC decoding failed");
  const data = new Uint8Array(memory.buffer, 65536 + blocks.length, width * height * 4).slice();
  return { data, width, height };
}

/** One model staged with PNG textures, unless the staged copy is already newer. */
async function stage(io: NodeIO, source: string, target: string): Promise<boolean> {
  try {
    if (statSync(target).mtimeMs >= statSync(source).mtimeMs) return false;
  } catch {}
  const doc = await io.read(source);
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const type = texture.getMimeType();
    if (type === "image/png" || type === "image/jpeg") continue;
    let png: Buffer;
    if (type === "image/ktx2") {
      const { data, width, height } = await decodeKtx2(image);
      png = await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
    } else {
      png = await sharp(image).png().toBuffer();
    }
    texture.setImage(new Uint8Array(png)).setMimeType("image/png");
    const uri = texture.getURI();
    if (uri) texture.setURI(uri.replace(/\.\w+$/, ".png"));
  }
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    if (/KHR_texture_basisu|EXT_texture_webp/.test(extension.extensionName)) extension.dispose();
  }
  await mkdir(dirname(target), { recursive: true });
  await io.write(target, doc);
  return true;
}

async function* glbs(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* glbs(path);
    else if (entry.name.endsWith(".glb")) yield path;
  }
}

/**
 * Stages every model whose path under `assets/models` (as `props/tv`) contains one of `filters`, or
 * all of them. Returns those paths, staged now or before.
 */
export async function stageModels(filters: string[]): Promise<string[]> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const root = join(ASSETS, "models");
  const names: string[] = [];
  let written = 0;
  for await (const source of glbs(root)) {
    const name = relative(root, source)
      .replaceAll("\\", "/")
      .replace(/\.glb$/, "");
    if (filters.length && !filters.some((filter) => name.includes(filter))) continue;
    if (await stage(io, source, join(STAGED, "models", `${name}.glb`))) {
      written++;
      console.log(`staged ${name}`);
    }
    names.push(name);
  }
  console.log(`${names.length} models, ${written} staged now, ${names.length - written} already`);
  return names;
}
