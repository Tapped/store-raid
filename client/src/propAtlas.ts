import "@babylonjs/loaders/glTF";
import {
  type AssetContainer,
  type BaseTexture,
  DynamicTexture,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  PBRMaterial,
  type Scene,
  Texture,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { assetUrl } from "./assets";

/**
 * Models with fewer materials, for props drawn by the hundred: each draw call costs about the same
 * however little it draws, and a prop of eleven materials is eleven of them, in every room it's in.
 *
 * `loadModel` loads a .glb and merges every part it can into one mesh of one material, whose
 * textures are atlases of the parts' own: base colour, roughness and metalness, and normals, each
 * part's image packed into one of each, and its texture coordinates moved onto it. A plain coloured
 * part gets a small square of its colour. The shared ambient occlusion bake stays as it is, on the
 * second set of coordinates. Glowing parts, see-through parts and parts whose textures repeat keep
 * their own materials, as do models with nothing to merge.
 */

/** The largest an atlas may be on a side; models with more texture than fits are packed smaller. */
const ATLAS = 2048;
/** Pixels round each image, filled from its edge, so mipmaps don't bleed in from its neighbours. */
const GUTTER = 8;
/** Pixels on a side of a plain colour's square. */
const PLAIN = 8;

interface GltfJson {
  materials?: {
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
      metallicFactor?: number;
      roughnessFactor?: number;
      metallicRoughnessTexture?: { index: number };
    };
    normalTexture?: { index: number };
    alphaMode?: string;
  }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
  images?: { bufferView?: number; mimeType?: string }[];
  bufferViews?: { byteOffset?: number; byteLength: number }[];
}

/** The JSON and binary chunks of a .glb. */
function readGlb(buffer: ArrayBuffer): { json: GltfJson; bin: Uint8Array } | undefined {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) return undefined;
  let offset = 12;
  let json: GltfJson | undefined;
  let bin: Uint8Array | undefined;
  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = new Uint8Array(buffer, offset + 8, length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === 0x004e4942) bin = data;
    offset += 8 + length;
  }
  return json && bin ? { json, bin } : undefined;
}

/** A texture's image, decoded as it is, with no colour conversion. */
async function imageOf(
  gltf: { json: GltfJson; bin: Uint8Array },
  index: number | undefined,
): Promise<ImageBitmap | undefined> {
  if (index === undefined) return undefined;
  const texture = gltf.json.textures?.[index];
  const source =
    texture?.source ??
    Object.values(texture?.extensions ?? {}).find((e) => e.source !== undefined)?.source;
  const image = source === undefined ? undefined : gltf.json.images?.[source];
  const view =
    image?.bufferView === undefined ? undefined : gltf.json.bufferViews?.[image.bufferView];
  if (!view) return undefined;
  const start = view.byteOffset ?? 0;
  const bytes = gltf.bin.slice(start, start + view.byteLength);
  const blob = new Blob([bytes], { type: image?.mimeType ?? "image/png" });
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

/** One part's images in the atlas, or its plain colour. */
interface Tile {
  material: string;
  width: number;
  height: number;
  base?: ImageBitmap;
  roughness?: ImageBitmap;
  normal?: ImageBitmap;
  /** For a plain part: sRGB base colour, roughness and metalness, 0 to 1. */
  colour?: [number, number, number];
  rough: number;
  metal: number;
  /** Where it went, in pixels, inside its gutter. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shelf-packs tiles into a square atlas, shrinking textured ones until they fit. */
function pack(tiles: Tile[]): { width: number; height: number } | undefined {
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
      if (x + w > ATLAS) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      if (w > ATLAS || y + h > ATLAS) {
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
    return { width: pow(width), height: pow(y + shelf) };
  }
  return undefined;
}

/** Draws an image into its tile, with its edges smeared out into the gutter. */
function drawTile(
  context: CanvasRenderingContext2D,
  tile: Tile,
  image: ImageBitmap | undefined,
  fill: string,
) {
  const { x, y, w, h } = tile;
  if (!image) {
    context.fillStyle = fill;
    context.fillRect(x - GUTTER, y - GUTTER, w + 2 * GUTTER, h + 2 * GUTTER);
    return;
  }
  const g = GUTTER;
  const iw = image.width;
  const ih = image.height;
  // Edges, then corners, then the image.
  context.drawImage(image, 0, 0, iw, 1, x, y - g, w, g);
  context.drawImage(image, 0, ih - 1, iw, 1, x, y + h, w, g);
  context.drawImage(image, 0, 0, 1, ih, x - g, y, g, h);
  context.drawImage(image, iw - 1, 0, 1, ih, x + w, y, g, h);
  context.drawImage(image, 0, 0, 1, 1, x - g, y - g, g, g);
  context.drawImage(image, iw - 1, 0, 1, 1, x + w, y - g, g, g);
  context.drawImage(image, 0, ih - 1, 1, 1, x - g, y + h, g, g);
  context.drawImage(image, iw - 1, ih - 1, 1, 1, x + w, y + h, g, g);
  context.drawImage(image, 0, 0, iw, ih, x, y, w, h);
}

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

function atlasTexture(
  name: string,
  scene: Scene,
  size: { width: number; height: number },
  draw: (context: CanvasRenderingContext2D) => void,
  sRGB: boolean,
): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  draw(context);
  texture.update(false, false, true);
  texture.gammaSpace = sRGB;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

/** Whether a part can go in the merged mesh: opaque, not glowing, its textures not repeating. */
function mergeable(mesh: Mesh, textured: boolean): boolean {
  const material = mesh.material;
  if (!(material instanceof PBRMaterial)) return false;
  if (material.name.startsWith("glow")) return false;
  if (material.needAlphaBlending() || material.needAlphaTesting()) return false;
  if (mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) return false;
  if (!mesh.isVerticesDataPresent(VertexBuffer.NormalKind)) return false;
  if (!textured) return true;
  const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!uvs) return false;
  for (const v of uvs) if (v < -0.002 || v > 1.002) return false;
  return true;
}

/**
 * Loads a model with its parts merged where they can be (see the module's comment), or undefined
 * if the file isn't there. Parts are left under the glTF root, as the loader made them.
 */
export async function loadModel(scene: Scene, path: string): Promise<AssetContainer | undefined> {
  let buffer: ArrayBuffer;
  try {
    const response = await fetch(assetUrl(path));
    // Vite answers a missing file with its HTML page.
    if (!response.ok || (response.headers.get("content-type") ?? "").includes("html")) {
      return undefined;
    }
    buffer = await response.arrayBuffer();
  } catch {
    return undefined;
  }
  const container = await LoadAssetContainerAsync(new Uint8Array(buffer), scene, {
    pluginExtension: ".glb",
    name: path,
  });
  try {
    await merge(scene, container, buffer, path);
  } catch (err) {
    console.warn(`Could not merge ${path}; drawing it as it is`, err);
  }
  return container;
}

async function merge(scene: Scene, container: AssetContainer, buffer: ArrayBuffer, path: string) {
  const gltf = readGlb(buffer);
  if (!gltf) return;
  const materials = new Map((gltf.json.materials ?? []).map((m) => [m.name ?? "", m]));
  const root = container.rootNodes[0];
  const rootMatrix = root?.computeWorldMatrix(true) ?? Matrix.Identity();
  const parts = container.meshes.filter((mesh): mesh is Mesh => {
    if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0 || !mesh.material) return false;
    const source = materials.get(mesh.material.name);
    if (!source || (source.alphaMode ?? "OPAQUE") !== "OPAQUE") return false;
    // Only parts that sit straight under the root.
    if (mesh.parent !== root && mesh.parent?.parent !== root) return false;
    const local = mesh.computeWorldMatrix(true).multiply(Matrix.Invert(rootMatrix));
    if (!local.isIdentity()) return false;
    return mergeable(mesh, source.pbrMetallicRoughness?.baseColorTexture !== undefined);
  });
  if (parts.length < 2) return;

  // One tile per material.
  const tiles = new Map<string, Tile>();
  for (const part of parts) {
    const name = part.material?.name ?? "";
    if (tiles.has(name)) continue;
    const source = materials.get(name);
    const pbr = source?.pbrMetallicRoughness ?? {};
    const [base, roughness, normal] = await Promise.all([
      imageOf(gltf, pbr.baseColorTexture?.index),
      imageOf(gltf, pbr.metallicRoughnessTexture?.index),
      imageOf(gltf, source?.normalTexture?.index),
    ]);
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const linearToSrgb = (v: number) =>
      v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    tiles.set(name, {
      material: name,
      width: base?.width ?? PLAIN,
      height: base?.height ?? PLAIN,
      base,
      roughness,
      normal,
      colour: base
        ? undefined
        : [linearToSrgb(factor[0]), linearToSrgb(factor[1]), linearToSrgb(factor[2])],
      rough: pbr.roughnessFactor ?? 1,
      metal: pbr.metallicFactor ?? 1,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  }
  // A textured part whose colour is tinted by a factor would need it baked in: leave those out.
  for (const [name, tile] of tiles) {
    const factor = materials.get(name)?.pbrMetallicRoughness?.baseColorFactor;
    if (tile.base && factor?.slice(0, 3).some((v) => Math.abs(v - 1) > 0.001)) {
      tiles.delete(name);
    }
  }
  const merging = parts.filter((part) => tiles.has(part.material?.name ?? ""));
  if (merging.length < 2) return;
  const all = [...tiles.values()];
  const size = pack(all);
  if (!size) return;

  const name = path.replace(/^.*\//, "").replace(/\.glb$/, "");
  const albedo = atlasTexture(
    `${name}-atlas-base`,
    scene,
    size,
    (context) => {
      for (const tile of all) {
        const [r, g, b] = tile.colour ?? [1, 1, 1];
        drawTile(context, tile, tile.base, `rgb(${byte(r)},${byte(g)},${byte(b)})`);
      }
    },
    true,
  );
  const surface = atlasTexture(
    `${name}-atlas-rough`,
    scene,
    size,
    (context) => {
      for (const tile of all) {
        // Green is roughness, blue metalness, each times its factor.
        drawTile(context, tile, tile.roughness, `rgb(0,${byte(tile.rough)},${byte(tile.metal)})`);
        if (tile.roughness) {
          context.globalCompositeOperation = "multiply";
          context.fillStyle = `rgb(255,${byte(tile.rough)},${byte(tile.metal)})`;
          context.fillRect(
            tile.x - GUTTER,
            tile.y - GUTTER,
            tile.w + 2 * GUTTER,
            tile.h + 2 * GUTTER,
          );
          context.globalCompositeOperation = "source-over";
        }
      }
    },
    false,
  );
  const hasNormals = all.some((tile) => tile.normal);
  const normals = hasNormals
    ? atlasTexture(
        `${name}-atlas-normal`,
        scene,
        size,
        (context) => {
          for (const tile of all) drawTile(context, tile, tile.normal, "rgb(128,128,255)");
        },
        false,
      )
    : undefined;
  for (const tile of all) {
    tile.base?.close();
    tile.roughness?.close();
    tile.normal?.close();
  }

  // The parts' geometry, end to end, with coordinates onto the atlas.
  const positions: number[] = [];
  const normalData: number[] = [];
  const uvs: number[] = [];
  const uv2s: number[] = [];
  const indices: number[] = [];
  for (const part of merging) {
    const tile = tiles.get(part.material?.name ?? "") as Tile;
    const p = part.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const n = part.getVerticesData(VertexBuffer.NormalKind) ?? [];
    const uv = part.getVerticesData(VertexBuffer.UVKind);
    const uv2 = part.getVerticesData(VertexBuffer.UV2Kind);
    const base = positions.length / 3;
    const count = p.length / 3;
    for (let i = 0; i < count; i++) {
      positions.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      normalData.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
      if (tile.colour || !uv) {
        uvs.push((tile.x + tile.w / 2) / size.width, (tile.y + tile.h / 2) / size.height);
      } else {
        uvs.push(
          (tile.x + uv[i * 2] * tile.w) / size.width,
          (tile.y + uv[i * 2 + 1] * tile.h) / size.height,
        );
      }
      // The occlusion bake: on the second set, or the only one for a plain part.
      const ao = uv2 ?? uv;
      uv2s.push(ao ? ao[i * 2] : 0, ao ? ao[i * 2 + 1] : 0);
    }
    const partIndices = part.getIndices() ?? [];
    for (const index of partIndices) indices.push(index + base);
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normalData;
  data.uvs = uvs;
  data.uvs2 = uv2s;
  data.indices = positions.length / 3 > 65535 ? Uint32Array.from(indices) : indices;
  const merged = new Mesh(`${name}-merged`, scene);
  data.applyToMesh(merged);
  merged.parent = root ?? null;

  // Its material: a copy of a textured part's, for everything the loader set, with the atlases.
  const template = (merging.find((part) => tiles.get(part.material?.name ?? "")?.base)?.material ??
    merging[0].material) as PBRMaterial;
  const material = template.clone(`${name}-merged`) as PBRMaterial;
  material.albedoColor.set(1, 1, 1);
  material.albedoTexture = albedo;
  material.metallicTexture = surface;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.useRoughnessFromMetallicTextureAlpha = false;
  material.useAmbientOcclusionFromMetallicTextureRed = false;
  material.metallic = 1;
  material.roughness = 1;
  material.bumpTexture = normals ?? null;
  const ao = merging
    .map((part) => (part.material as PBRMaterial).ambientTexture)
    .find((texture): texture is BaseTexture => texture !== null);
  if (ao) {
    const texture = ao.clone() as BaseTexture;
    texture.coordinatesIndex = 1;
    material.ambientTexture = texture;
  }
  merged.material = material;

  // Out with the parts, and whatever only they used. What's made here goes in the container,
  // not the scene, as the loader's own things do.
  const kept = container.meshes.filter((m) => !merging.includes(m as Mesh));
  const keptMaterials = new Set(kept.map((m) => m.material));
  const keptTextures = new Set(kept.flatMap((m) => m.material?.getActiveTextures() ?? []));
  const gone = new Set(merging.map((part) => part.material).filter((m) => !keptMaterials.has(m)));
  const goneTextures = new Set(
    [...gone].flatMap((m) => m?.getActiveTextures() ?? []).filter((t) => !keptTextures.has(t)),
  );
  for (const part of merging) part.dispose(false, false);
  for (const old of gone) old?.dispose(false, false);
  for (const texture of goneTextures) texture.dispose();
  const made = [albedo, surface, normals, material.ambientTexture].filter(
    (t): t is BaseTexture => t !== null && t !== undefined,
  );
  scene.removeMesh(merged);
  scene.removeMaterial(material);
  for (const texture of made) scene.removeTexture(texture);
  container.meshes = [...kept, merged];
  container.materials = [...container.materials.filter((m) => !gone.has(m)), material];
  container.textures = [...container.textures.filter((t) => !goneTextures.has(t)), ...made];
}
