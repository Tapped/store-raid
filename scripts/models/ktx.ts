/**
 * Images as KTX2 textures the GPU keeps compressed: UASTC, which the game turns into BC7 as it
 * loads, a quarter of the video memory of the same picture as RGBA, mipmaps included.
 *
 * The encoder (Basis Universal, as WebAssembly) takes 12 megapixels at most, less than one 4096
 * texture. UASTC is 4 × 4 pixel blocks of 16 bytes that don't depend on their neighbours, so a
 * level is encoded as tiles of 2048 and the tiles' rows of blocks are laid side by side. Mipmaps are
 * made here, each level half the one above, and the file is put together with ktx-parse, its levels
 * compressed with Zstandard.
 */

import { constants, zstdCompressSync } from "node:zlib";
import { KHR_SUPERCOMPRESSION_ZSTD, type KTX2Container, read, write } from "ktx-parse";
import { encodeToKTX2 } from "ktx2-encoder";
import sharp from "sharp";

/** What a texture holds: colour is sRGB, data (roughness, occlusion) and normals are linear. */
export type TextureKind = "colour" | "data" | "normal";

interface Pixels {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The most pixels on a side the encoder is given at once. */
const TILE = 2048;
/** UASTC's channels in a KTX2 file's format descriptor: without and with alpha. */
const UASTC_RGB = 0;
const UASTC_RGBA = 3;

/** One level as UASTC blocks, row by row, and the file the encoder wrote for its first tile. */
async function encodeLevel(
  level: Pixels,
  kind: TextureKind,
  effort: number,
): Promise<{ blocks: Uint8Array; first: KTX2Container }> {
  const across = Math.ceil(level.width / 4);
  const down = Math.ceil(level.height / 4);
  const blocks = new Uint8Array(across * down * 16);
  let first: KTX2Container | undefined;
  for (let top = 0; top < level.height; top += TILE) {
    for (let left = 0; left < level.width; left += TILE) {
      const width = Math.min(TILE, level.width - left);
      const height = Math.min(TILE, level.height - top);
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        const from = ((top + y) * level.width + left) * 4;
        data.set(level.data.subarray(from, from + width * 4), y * width * 4);
      }
      const file = await encodeToKTX2(data, {
        isUASTC: true,
        isKTX2File: true,
        generateMipmap: false,
        needSupercompression: false,
        uastcLDRQualityLevel: effort,
        isPerceptual: kind === "colour",
        isSetKTX2SRGBTransferFunc: kind === "colour",
        isNormalMap: kind === "normal",
        // The pixels are handed over as they are: there's nothing to decode.
        imageDecoder: async () => ({ width, height, data }),
      });
      const container = read(file);
      first ??= container;
      const tile = container.levels[0].levelData;
      const tileAcross = Math.ceil(width / 4);
      const tileDown = Math.ceil(height / 4);
      for (let row = 0; row < tileDown; row++) {
        blocks.set(
          tile.subarray(row * tileAcross * 16, (row + 1) * tileAcross * 16),
          ((top / 4 + row) * across + left / 4) * 16,
        );
      }
    }
  }
  return { blocks, first: first as KTX2Container };
}

/** The level below: half the size, normals made unit length again. */
async function half(level: Pixels, kind: TextureKind): Promise<Pixels> {
  const width = Math.max(1, level.width >> 1);
  const height = Math.max(1, level.height >> 1);
  const buffer = await sharp(level.data, {
    raw: { width: level.width, height: level.height, channels: 4 },
  })
    .resize(width, height, { fit: "fill", kernel: "cubic" })
    .raw()
    .toBuffer();
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (kind === "normal") {
    for (let i = 0; i < data.length; i += 4) {
      const x = data[i] / 127.5 - 1;
      const y = data[i + 1] / 127.5 - 1;
      const z = data[i + 2] / 127.5 - 1;
      const length = Math.hypot(x, y, z) || 1;
      data[i] = Math.round((x / length + 1) * 127.5);
      data[i + 1] = Math.round((y / length + 1) * 127.5);
      data[i + 2] = Math.round((z / length + 1) * 127.5);
    }
  }
  return { data, width, height };
}

/**
 * An image file (PNG, WebP, JPEG) as a KTX2 file with all its mipmaps. `effort` is the encoder's,
 * 0 to 4: 2 for builds to keep, 0 for quick builds, several times faster and a little blockier.
 */
export async function toKtx2(
  image: Uint8Array,
  kind: TextureKind,
  effort = 2,
): Promise<Uint8Array> {
  const { data, info } = await sharp(image)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let level: Pixels = {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
  let alpha = false;
  for (let i = 3; i < level.data.length && !alpha; i += 4) alpha = level.data[i] < 255;

  const levels: Uint8Array[] = [];
  let container: KTX2Container | undefined;
  for (;;) {
    const { blocks, first } = await encodeLevel(level, kind, effort);
    container ??= first;
    levels.push(blocks);
    if (level.width === 1 && level.height === 1) break;
    level = await half(level, kind);
  }
  const file = container as KTX2Container;
  file.pixelWidth = info.width;
  file.pixelHeight = info.height;
  file.supercompressionScheme = KHR_SUPERCOMPRESSION_ZSTD;
  file.dataFormatDescriptor[0].samples[0].channelType = alpha ? UASTC_RGBA : UASTC_RGB;
  file.levelCount = levels.length;
  file.levels = levels.map((blocks) => ({
    levelData: zstdCompressSync(blocks, { params: { [constants.ZSTD_c_compressionLevel]: 15 } }),
    uncompressedByteLength: blocks.byteLength,
  }));
  return write(file);
}
