/**
 * Reads Unity's YAML: which mesh and materials a prefab uses, and which textures a material uses.
 * Only what the import needs is parsed, with regular expressions, not a YAML parser.
 */
import type { UnityPackage } from "./unitypackage";

export interface Prefab {
  name: string;
  /** The guid of the model file (`.fbx`) the prefab's mesh comes from. */
  mesh: string;
  /** Material guids, in the renderer's slot order. */
  materials: string[];
}

export interface Material {
  name: string;
  base: string | null;
  normal: string | null;
  /** Occlusion, roughness and metalness in R, G and B: the same layout as glTF. */
  orm: string | null;
  /** A separate cut-out mask, its red channel becoming base colour alpha. */
  opacity: string | null;
  tint: [number, number, number] | null;
}

const fileId = (body: string, key: string) =>
  new RegExp(`${key}: \\{fileID: (-?\\d+)`).exec(body)?.[1];

/**
 * The mesh and materials of a prefab, picking the renderer for the given level of detail when the
 * prefab has several. A prefab with no mesh of its own (a variant or a wrapper) is followed to the
 * prefab it's made from.
 */
export function readPrefab(
  pkg: UnityPackage,
  guid: string,
  lod: number,
  depth = 0,
): Prefab | string {
  const name = pkg.name(guid)?.replace(/\.prefab$/, "") ?? guid;
  if (!pkg.has(guid)) return `${name}: not in the package`;
  const docs = pkg.text(guid).split(/^--- /m).slice(1);
  const goName = new Map<string, string>();
  for (const d of docs.filter((d) => d.startsWith("!u!1 "))) {
    const id = /^!u!1 &(-?\d+)/.exec(d)?.[1];
    if (id) goName.set(id, /m_Name: ([^\n]*)/.exec(d)?.[1] ?? "");
  }
  const owner = (d: string) => goName.get(fileId(d, "m_GameObject") ?? "") ?? "";

  const filters = docs
    .filter((d) => d.startsWith("!u!33 "))
    .map((d) => ({
      go: owner(d),
      mesh: /m_Mesh: \{fileID: -?\d+, guid: ([0-9a-f]{32})/.exec(d)?.[1],
    }))
    .filter((f): f is { go: string; mesh: string } => !!f.mesh);
  const renderers = docs
    .filter((d) => d.startsWith("!u!23 ") || d.startsWith("!u!137 "))
    .map((d) => {
      const block = /m_Materials:\n((?:\s+- \{[^\n]*\n)+)/.exec(d)?.[1] ?? "";
      return {
        go: owner(d),
        materials: [...block.matchAll(/guid: ([0-9a-f]{32})/g)].map((m) => m[1]),
      };
    });

  if (!filters.length) {
    const source = /m_SourcePrefab: \{fileID: -?\d+, guid: ([0-9a-f]{32})/.exec(
      pkg.text(guid),
    )?.[1];
    if (source && depth < 4) {
      const inner = readPrefab(pkg, source, lod, depth + 1);
      return typeof inner === "string" ? inner : { ...inner, name };
    }
    return `${name}: has no mesh`;
  }

  const atLod = (go: string) => new RegExp(`_LOD${lod}$`).test(go);
  const filter = filters.find((f) => atLod(f.go)) ?? filters[0];
  const renderer =
    renderers.find((r) => r.go === filter.go) ?? renderers.find((r) => atLod(r.go)) ?? renderers[0];
  if (new Set(filters.map((f) => f.mesh)).size > 1) {
    console.warn(
      `${name}: uses meshes from several model files, only importing ${pkg.name(filter.mesh)}`,
    );
  }
  return { name, mesh: filter.mesh, materials: renderer?.materials ?? [] };
}

/** The guids of every asset a prefab's materials need, so they can be extracted. */
export function textureGuids(m: Material): string[] {
  return [m.base, m.normal, m.orm, m.opacity].filter((g): g is string => !!g);
}

/**
 * The textures of a material. Packs name their texture slots differently (URP, HDRP, built-in,
 * custom shaders), so several names are tried for each.
 */
export function readMaterial(pkg: UnityPackage, guid: string): Material {
  const name = pkg.name(guid)?.replace(/\.mat$/, "") ?? guid;
  const empty: Material = { name, base: null, normal: null, orm: null, opacity: null, tint: null };
  if (!pkg.has(guid)) return empty;
  const text = pkg.text(guid);
  const slots = new Map<string, string>();
  for (const m of text.matchAll(
    /- (_\w+):\s*\n\s+m_Texture: \{fileID: \d+(?:, guid: ([0-9a-f]{32}))?/g,
  )) {
    if (m[2]) slots.set(m[1], m[2]);
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const g = slots.get(k);
      // Placeholder textures some shaders default to, which carry nothing.
      if (g && pkg.path(g) && !/DefaultTexture|T_Grayscale/.test(pkg.name(g) ?? "")) return g;
    }
    return null;
  };
  const colour = (key: string): [number, number, number] | null => {
    const m = new RegExp(`- ${key}: \\{r: ([^,]+), g: ([^,]+), b: ([^,]+)`).exec(text);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  return {
    name,
    base: pick("_BaseMap", "_MainTex", "_BaseColorMap", "_BaseMap1", "_Albedo"),
    normal: pick("_BaseNormalMap", "_NormalMap", "_BumpMap", "_NormalMap1"),
    orm: pick("_BaseORM", "_ORMMap", "_OrmMap1", "_ORM"),
    opacity: pick("_OpacityMap"),
    tint:
      colour("_Base_Color_Tint") ??
      colour("_BaseColorTint") ??
      colour("_BaseColor") ??
      colour("_Color"),
  };
}
