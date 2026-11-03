/**
 * Turns Blender's untextured glTF into a finished game model: Unity's textures on each material,
 * as WebP, and the fixes Unity assets and Blender's exporter need.
 */
import { type Document, NodeIO, type Primitive } from "@gltf-transform/core";
import { EXTTextureWebP, KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, unpartition } from "@gltf-transform/functions";
import sharp from "sharp";
import type { Material } from "./unity";
import type { UnityPackage } from "./unitypackage";

export interface Finish {
  pkg: UnityPackage;
  /** Unity's materials, in the renderer's slot order. */
  materials: Material[];
  /** Blender's material names, in slot order. */
  slots: (string | null)[];
  /** Texture width and height in pixels. */
  size: number;
}

const io = new NodeIO().registerExtensions([...KHRONOS_EXTENSIONS, EXTTextureWebP]);

/** Material names as FBX and Unity spell them, for matching: no prefix, case or Blender's `.001`. */
const plain = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.\d{3}$/, "")
    .replace(/^(mi|m|mat|mtl)_/, "");

/** Unity's normal maps often hold only X and Y, as its shader rebuilds Z, so rebuild it here. */
function rebuildNormalZ(data: Buffer, channels: number) {
  let blue = 0;
  for (let i = 2; i < data.length; i += channels) blue += data[i];
  if (blue / (data.length / channels) > 150) return;
  for (let i = 0; i < data.length; i += channels) {
    const x = data[i] / 127.5 - 1;
    const y = data[i + 1] / 127.5 - 1;
    data[i + 2] = Math.round((Math.sqrt(Math.max(0, 1 - x * x - y * y)) + 1) * 127.5);
  }
}

/** Blender leaves a zero tangent on vertices with degenerate UVs, so give those any valid one. */
function fixTangents(doc: Document): number {
  let fixed = 0;
  const tangents = new Set(
    doc
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .map((p) => p.getAttribute("TANGENT"))
      .filter((a) => a !== null),
  );
  for (const accessor of tangents) {
    const a = accessor.getArray();
    if (!a) continue;
    for (let i = 0; i < a.length; i += 4) {
      const len = Math.hypot(a[i], a[i + 1], a[i + 2]);
      if (len < 0.5 || !Number.isFinite(len)) {
        a.set([1, 0, 0, 1], i);
        fixed++;
      } else {
        a[i] /= len;
        a[i + 1] /= len;
        a[i + 2] /= len;
        a[i + 3] = a[i + 3] < 0 ? -1 : 1;
      }
    }
  }
  return fixed;
}

/** Adds textures to the model at `input` and writes it to `output`. Returns what to warn about. */
export async function finish(input: string, output: string, opts: Finish): Promise<string[]> {
  const { pkg, materials, slots, size } = opts;
  const warnings: string[] = [];
  const doc = await io.read(input);

  const textures = new Map<string, ReturnType<Document["createTexture"]>>();
  async function texture(guid: string, kind: "colour" | "normal" | "data", alpha?: string | null) {
    const key = `${guid}|${kind}|${alpha ?? ""}`;
    const cached = textures.get(key);
    if (cached) return cached;
    const read = (g: string) =>
      sharp(pkg.assetFile(g), { limitInputPixels: false }).resize(size, size, { fit: "fill" });
    let image = read(guid).removeAlpha();
    if (kind === "normal") {
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      rebuildNormalZ(data, info.channels);
      image = sharp(data, { raw: info });
    }
    if (alpha) image = image.joinChannel(await read(alpha).extractChannel(0).toBuffer());
    const name = (pkg.name(guid) ?? guid).replace(/\.\w+$/, "");
    const t = doc
      .createTexture(name)
      .setMimeType("image/webp")
      .setImage(await image.webp({ quality: kind === "normal" ? 85 : 80 }).toBuffer());
    textures.set(key, t);
    return t;
  }

  const made = new Map<Material, ReturnType<Document["createMaterial"]>>();
  async function material(m: Material) {
    const cached = made.get(m);
    if (cached) return cached;
    const out = doc
      .createMaterial(m.name)
      .setMetallicFactor(m.orm ? 1 : 0)
      .setRoughnessFactor(m.orm ? 1 : 0.8);
    if (m.base) out.setBaseColorTexture(await texture(m.base, "colour", m.opacity));
    else if (m.opacity) out.setBaseColorTexture(await texture(m.opacity, "colour", m.opacity));
    if (m.opacity) out.setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true);
    if (m.normal) out.setNormalTexture(await texture(m.normal, "normal"));
    if (m.orm) {
      const orm = await texture(m.orm, "data");
      out.setMetallicRoughnessTexture(orm).setOcclusionTexture(orm);
    }
    if (m.tint) out.setBaseColorFactor([...m.tint, 1]);
    if (!m.base && !m.opacity) warnings.push(`material ${m.name} has no colour texture`);
    if (!m.orm) warnings.push(`material ${m.name} has no ORM texture, so it's plain and rough`);
    made.set(m, out);
    return out;
  }

  /** Unity's material for a primitive: by name, else by slot, else the first. */
  function unityMaterial(p: Primitive): Material | undefined {
    const name = p.getMaterial()?.getName() ?? "";
    return (
      materials.find((m) => plain(m.name) === plain(name)) ??
      materials[slots.indexOf(name)] ??
      materials[0]
    );
  }

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const m = unityMaterial(p);
      if (m) p.setMaterial(await material(m));
      else warnings.push("no Unity material, so it's untextured");
      for (const s of p.listSemantics()) {
        if (/^(TEXCOORD_[1-9]|COLOR_)/.test(s)) p.setAttribute(s, null);
      }
    }
  }

  const tangents = fixTangents(doc);
  if (tangents) warnings.push(`fixed ${tangents} zero tangents`);
  await doc.transform(unpartition(), prune({ keepAttributes: true, keepLeaves: true }));
  doc.createExtension(EXTTextureWebP).setRequired(true);
  await io.write(output, doc);
  return warnings;
}
