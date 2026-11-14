/**
 * Scenery with fewer materials, for models drawn by the hundred: each draw call costs about the same
 * however little it draws, and a model of eleven materials is eleven of them, wherever it stands.
 *
 * `packAtlas` merges every part of a model it can into one mesh of one material, whose textures
 * are atlases of the parts' own: base colour, roughness and metalness, and normals, each part's
 * image packed into one of each, and its texture coordinates moved onto it. A plain coloured part
 * gets a small square of its colour. The shared ambient occlusion bake stays as it is, on the second
 * set of coordinates. Glowing parts, see-through parts and parts whose textures repeat keep their
 * own materials, as do models with nothing to merge.
 *
 * The merged mesh is a node named `<model>-merged`, whose extras list its parts' vertices
 * (`parts`: material, start, count), for the client's detail maps. The client does the same merge
 * as it loads a model that wasn't packed here (client/src/propAtlas.ts), at four times the video
 * memory: packed here, the atlases can be compressed.
 */

import {
  type Document,
  type Material,
  type Node,
  type Primitive,
  type Texture,
  TextureInfo,
} from "@gltf-transform/core";
import sharp, { type OverlayOptions, type Sharp } from "sharp";

/** Pixels round each image, filled from its edge, so mipmaps don't bleed in from its neighbours. */
const GUTTER = 8;
/** Pixels on a side of a plain colour's square. */
const PLAIN = 8;
const TRIANGLES = 4;

/** One material's images in the atlas, or its plain colour. */
interface Tile {
  material: Material;
  width: number;
  height: number;
  base?: Uint8Array;
  roughness?: Uint8Array;
  normal?: Uint8Array;
  /** For a plain part: sRGB base colour, 0 to 255. */
  colour?: [number, number, number];
  rough: number;
  metal: number;
  /** Where it went, in pixels, inside its gutter. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shelf-packs tiles into an atlas, shrinking textured ones until they fit, by `scale`. */
function pack(
  tiles: Tile[],
  limit: number,
): { width: number; height: number; scale: number } | undefined {
  for (let scale = 1; scale >= 1 / 16; scale /= 2) {
    const sized = tiles
      .map((tile) => {
        const plain = tile.colour !== undefined;
        tile.w = plain ? PLAIN : Math.max(PLAIN, Math.round(tile.width * scale));
        tile.h = plain ? PLAIN : Math.max(PLAIN, Math.round(tile.height * scale));
        return tile;
      })
      .sort((a, b) => b.h - a.h);
    let x = 0;
    let y = 0;
    let shelf = 0;
    let width = 0;
    let fits = true;
    for (const tile of sized) {
      const w = tile.w + 2 * GUTTER;
      const h = tile.h + 2 * GUTTER;
      if (x + w > limit) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      if (w > limit || y + h > limit) {
        fits = false;
        break;
      }
      tile.x = x + GUTTER;
      tile.y = y + GUTTER;
      x += w;
      shelf = Math.max(shelf, h);
      width = Math.max(width, x);
    }
    if (!fits) continue;
    const pow = (v: number) => 2 ** Math.ceil(Math.log2(Math.max(v, 16)));
    return { width: pow(width), height: pow(y + shelf), scale };
  }
  return undefined;
}

type Rgb = [number, number, number];

/**
 * One atlas as a PNG: each tile's image, its edges smeared out into the gutter, or its fill where
 * it has none. `times` multiplies an image's channels.
 */
async function compose(
  size: { width: number; height: number },
  tiles: Tile[],
  background: Rgb,
  pick: (tile: Tile) => { image?: Uint8Array; fill: Rgb; times?: Rgb },
): Promise<Uint8Array> {
  const colour = ([r, g, b]: Rgb) => ({ r, g, b });
  const layers: OverlayOptions[] = [];
  for (const tile of tiles) {
    const { image, fill, times } = pick(tile);
    const width = tile.w + 2 * GUTTER;
    const height = tile.h + 2 * GUTTER;
    let layer: Sharp;
    if (image) {
      layer = sharp(image)
        .toColourspace("srgb")
        .removeAlpha()
        .resize(tile.w, tile.h, { fit: "fill" })
        .extend({ top: GUTTER, bottom: GUTTER, left: GUTTER, right: GUTTER, extendWith: "copy" });
      if (times) layer = layer.linear(times, [0, 0, 0]);
    } else {
      layer = sharp({ create: { width, height, channels: 3, background: colour(fill) } });
    }
    layers.push({
      input: await layer.png({ compressionLevel: 1 }).toBuffer(),
      left: tile.x - GUTTER,
      top: tile.y - GUTTER,
    });
  }
  return sharp({ create: { ...size, channels: 3, background: colour(background) } })
    .composite(layers)
    .png({ compressionLevel: 3 })
    .toBuffer();
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Whether a part can go in the merged mesh: opaque, not glowing, its textures not repeating. */
function mergeable(part: Primitive, material: Material): boolean {
  if (part.getMode() !== TRIANGLES || part.listTargets().length) return false;
  if (material.getAlphaMode() !== "OPAQUE" || material.getBaseColorFactor()[3] < 1) return false;
  if (material.getName().startsWith("glow")) return false;
  if (part.getAttribute("COLOR_0") || !part.getAttribute("NORMAL")) return false;
  if (!material.getBaseColorTexture()) return true;
  // A textured part whose colour is tinted by a factor would need it baked in: those stay out.
  if (material.getBaseColorFactor().some((v) => Math.abs(v - 1) > 0.001)) return false;
  const uv = part.getAttribute("TEXCOORD_0");
  if (!uv) return false;
  const at = [0, 0];
  for (let i = 0; i < uv.getCount(); i++) {
    uv.getElement(i, at);
    if (at[0] < -0.002 || at[0] > 1.002 || at[1] < -0.002 || at[1] > 1.002) return false;
  }
  return true;
}

const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/**
 * Merges what can be merged of the model in `doc` (see the top of this file) over atlases of at
 * most `limit` pixels on a side. Returns the atlas' size and how many parts went in, or undefined
 * if there was nothing to merge. Textures left without a use stay in the document: prune it after.
 */
export async function packAtlas(
  doc: Document,
  name: string,
  limit: number,
): Promise<{ width: number; height: number; parts: number; scale: number } | undefined> {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return undefined;

  const merging: { node: Node; part: Primitive; material: Material }[] = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh || node.getSkin()) return;
    if (node.getWorldMatrix().some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-6)) return;
    for (const part of mesh.listPrimitives()) {
      const material = part.getMaterial();
      if (material && mergeable(part, material)) merging.push({ node, part, material });
    }
  });
  if (merging.length < 2) return undefined;

  // One tile per material.
  const tiles = new Map<Material, Tile>();
  for (const { material } of merging) {
    if (tiles.has(material)) continue;
    const base = material.getBaseColorTexture()?.getImage() ?? undefined;
    const size = base ? await sharp(base).metadata() : undefined;
    const factor = material.getBaseColorFactor();
    tiles.set(material, {
      material,
      width: size?.width ?? PLAIN,
      height: size?.height ?? PLAIN,
      base,
      roughness: material.getMetallicRoughnessTexture()?.getImage() ?? undefined,
      normal: material.getNormalTexture()?.getImage() ?? undefined,
      colour: base
        ? undefined
        : [
            byte(linearToSrgb(factor[0])),
            byte(linearToSrgb(factor[1])),
            byte(linearToSrgb(factor[2])),
          ],
      rough: material.getRoughnessFactor(),
      metal: material.getMetallicFactor(),
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  }
  const all = [...tiles.values()];
  const size = pack(all, limit);
  if (!size) return undefined;

  const texture = (suffix: string, image: Uint8Array): Texture =>
    doc.createTexture(`${name}-atlas-${suffix}`).setMimeType("image/png").setImage(image);
  const albedo = texture(
    "base",
    await compose(size, all, [0, 0, 0], (tile) => ({
      image: tile.base,
      fill: tile.colour ?? [255, 255, 255],
    })),
  );
  // Green is roughness, blue metalness, each times its factor.
  const surface = texture(
    "rough",
    await compose(size, all, [0, 255, 0], (tile) => ({
      image: tile.roughness,
      fill: [0, byte(tile.rough), byte(tile.metal)],
      times: [1, tile.rough, tile.metal],
    })),
  );
  const normals = all.some((tile) => tile.normal)
    ? texture(
        "normal",
        await compose(size, all, [128, 128, 255], (tile) => ({
          image: tile.normal,
          fill: [128, 128, 255],
        })),
      )
    : undefined;

  // The parts' geometry, end to end, with coordinates onto the atlas. Tangents only if every part
  // has them: without, the game works them out per pixel.
  const tangents = merging.every(({ part }) => part.getAttribute("TANGENT"));
  const positions: number[] = [];
  const normalData: number[] = [];
  const tangentData: number[] = [];
  const uvs: number[] = [];
  const uv2s: number[] = [];
  const indices: number[] = [];
  const ranges: { material: string; start: number; count: number }[] = [];
  const at: number[] = [];
  for (const { part, material } of merging) {
    const tile = tiles.get(material) as Tile;
    const position = part.getAttribute("POSITION");
    if (!position) continue;
    const normal = part.getAttribute("NORMAL");
    const tangent = part.getAttribute("TANGENT");
    const uv = part.getAttribute("TEXCOORD_0");
    // The occlusion bake: on the second set, or the only one for a plain part.
    const ao = part.getAttribute("TEXCOORD_1") ?? uv;
    const base = positions.length / 3;
    const count = position.getCount();
    ranges.push({ material: material.getName(), start: base, count });
    for (let i = 0; i < count; i++) {
      positions.push(...position.getElement(i, at).slice(0, 3));
      normalData.push(...(normal?.getElement(i, at).slice(0, 3) ?? [0, 1, 0]));
      if (tangents) tangentData.push(...(tangent?.getElement(i, at).slice(0, 4) ?? [1, 0, 0, 1]));
      if (tile.colour || !uv) {
        uvs.push((tile.x + tile.w / 2) / size.width, (tile.y + tile.h / 2) / size.height);
      } else {
        uv.getElement(i, at);
        uvs.push((tile.x + at[0] * tile.w) / size.width, (tile.y + at[1] * tile.h) / size.height);
      }
      if (ao) uv2s.push(...ao.getElement(i, at).slice(0, 2));
      else uv2s.push(0, 0);
    }
    const partIndices = part.getIndices();
    if (partIndices) {
      for (let i = 0; i < partIndices.getCount(); i++)
        indices.push(partIndices.getScalar(i) + base);
    } else {
      for (let i = 0; i < count; i++) indices.push(i + base);
    }
  }

  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const accessor = (
    type: "SCALAR" | "VEC2" | "VEC3" | "VEC4",
    array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const merged = doc
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", new Float32Array(positions)))
    .setAttribute("NORMAL", accessor("VEC3", new Float32Array(normalData)))
    .setAttribute("TEXCOORD_0", accessor("VEC2", new Float32Array(uvs)))
    .setAttribute("TEXCOORD_1", accessor("VEC2", new Float32Array(uv2s)))
    .setIndices(accessor("SCALAR", new Uint32Array(indices)));
  if (tangents) merged.setAttribute("TANGENT", accessor("VEC4", new Float32Array(tangentData)));

  // Its material: a copy of a textured part's, for everything else it says, with the atlases.
  const template = (all.find((tile) => tile.base) ?? all[0]).material;
  const material = template
    .clone()
    .setName(`${name}-merged`)
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(albedo)
    .setMetallicRoughnessTexture(surface)
    .setRoughnessFactor(1)
    .setMetallicFactor(1)
    .setNormalTexture(normals ?? null)
    .setEmissiveTexture(null);
  const occluded = all.find((tile) => tile.material.getOcclusionTexture())?.material;
  material.setOcclusionTexture(occluded?.getOcclusionTexture() ?? null);
  if (occluded) material.setOcclusionStrength(occluded.getOcclusionStrength());
  material.getOcclusionTextureInfo()?.setTexCoord(1);
  for (const info of [
    material.getBaseColorTextureInfo(),
    material.getMetallicRoughnessTextureInfo(),
    material.getNormalTextureInfo(),
  ]) {
    info?.setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);
  }
  merged.setMaterial(material);
  scene.addChild(
    doc
      .createNode(`${name}-merged`)
      .setMesh(doc.createMesh(`${name}-merged`).addPrimitive(merged))
      .setExtras({ parts: ranges }),
  );

  // Out with the parts; a mesh left with none goes too.
  for (const { node, part } of merging) {
    const mesh = node.getMesh();
    mesh?.removePrimitive(part);
    part.dispose();
    if (mesh && !mesh.listPrimitives().length) {
      node.setMesh(null);
      mesh.dispose();
    }
  }
  return { width: size.width, height: size.height, parts: merging.length, scale: size.scale };
}
