import {
  type AbstractMesh,
  Buffer,
  Constants,
  MaterialPluginBase,
  Mesh,
  PBRMaterial,
  RawTexture2DArray,
  type Scene,
  ShaderLanguage,
  Texture,
  type UniformBuffer,
  VertexBuffer,
} from "@babylonjs/core";
import { assetUrl } from "./assets";
import type { MergedPart } from "./propAtlas";
import { SURFACES } from "./surfaceTable";
import { tunables } from "./tuning";

/**
 * Detail maps for the village's models: tiling micro-detail (wood grain and checks, stone crystals,
 * slate laminae, moss sprigs, bark, rust) blended over their unique bakes close up, so they hold up
 * at arm's length without baking them at many times the resolution. The bake carries form, colour
 * and wear; the detail adds a normal, a little colour and roughness at 1 to 3 mm, and fades out
 * with distance and with how many texels a pixel covers, so it never shimmers or shows its repeat.
 *
 * The maps are the surface library's `detail-*` surfaces (lib/detail.wgsl says how they're
 * stored), packed here into one texture array: normal x and y, a colour multiplier, a roughness
 * offset, one layer each.
 *
 * Projection: triplanar, but in a frame of each piece's own, so no new texture coordinates are
 * needed and wood grain follows every member. Every vertex carries the frame, worked out here at
 * load: `vdmGrain` (the grain axis, and the layer and strength) and `vdmFace` (an axis across it,
 * and a random offset for the piece), interleaved in one buffer. The grain axis is a material's
 * own (village_logs bakes grain along a fixed axis per material), or the long axis of each piece
 * (vertices welded by place, then the principal axis of its faces), or down the slope; layers with
 * no direction use the model's axes. The frame reaches the fragment in the world as one varying,
 * and the place along it comes from the world position (the copies never move). Its three planes
 * are blended by the face's normal, end grain faint, and the detail normal goes onto the
 * material's own by a whiteout blend in each plane.
 *
 * Merged models (propAtlas.ts) list their parts' vertices in `metadata.parts`, so each part gets
 * its own kind in the one material. `?detail=off` leaves the village as it was, to compare.
 */

const ENABLED = new URLSearchParams(location.search).get("detail") !== "off";

/** The detail layers, in the texture array's order. */
const LAYERS = ["wood", "paint", "stone", "slate", "moss", "bark", "iron"] as const;
type Layer = (typeof LAYERS)[number];

/**
 * Which way a layer's u runs: a fixed axis of the model (glTF axes, y up); "along" each piece's
 * long axis (or level along its face if it has none); "down" its slope (upright on walls); or
 * "model", the model's axes, for layers with no direction.
 */
type Grain = "x" | "y" | "z" | "along" | "down" | "model";

interface Kind {
  layer: Layer;
  grain: Grain;
  /** Times the layer's strength; up to 1.99. */
  strength?: number;
}

const wood = (grain: Grain = "along", strength = 1): Kind => ({ layer: "wood", grain, strength });
const paint = (grain: Grain = "along"): Kind => ({ layer: "paint", grain });
const stone = (strength = 1): Kind => ({ layer: "stone", grain: "model", strength });

/**
 * Material name to detail kind, for every material in models/village/*.glb; "model/material"
 * keys win over a bare name. Materials not here (glass, water, rope, the dark insides, foliage
 * cards) get none. Axes are the bakes' own, from scripts/models (Blender x, y, z is glTF x, -z, y).
 */
const KINDS: Record<string, Kind> = {
  // village_logs.timber(): grain along a fixed axis.
  "logs-front": wood("x"),
  "logs-back": wood("x"),
  "logs-gable": wood("z"),
  boards: wood("z"),
  "log-farmhouse/porch": { layer: "paint", grain: "y" },
  "log-farmhouse/door": wood("y"),
  "log-farmhouse/trim": { layer: "paint", grain: "y" },
  "stabbur/cladding": wood("y"),
  "stabbur/posts": wood("y"),
  "boathouse/cladding": wood("y"),
  "boathouse/frame": wood("z"),
  "boathouse/doors": wood("y"),
  "boathouse/roof-boards": wood("x"),
  "outhouse/walls": wood("y"),
  "outhouse/frame": wood("z"),
  "woodshed/boards": wood(),
  "woodshed/roof-boards": wood(),
  // Boards, beams and timbers made piece by piece: grain along each.
  timber: wood(),
  frame: wood(),
  posts: wood(),
  rails: wood(),
  gate: wood(),
  cart: wood(),
  sledge: wood(),
  ramp: wood(),
  hull: wood("along", 0.8),
  pole: wood(),
  deadwood: wood("along", 1.2),
  walls: wood(),
  doors: wood(),
  door: wood(),
  porch: wood(),
  "roof-boards": wood(),
  "birch-wood": wood(),
  "grey-wood": wood(),
  "grey-edge": wood(),
  carving: wood("along", 0.8),
  // The stave church's tarred wood: the tar fills the grain.
  wood: wood("along", 0.7),
  "tar-edge": wood("along", 0.7),
  shingles: wood("down", 0.8),
  step: wood("along", 0.7),
  under: wood("along", 0.6),
  "inside-wood": wood("along", 0.6),
  inside: wood("along", 0.4),
  // Painted boards.
  red: paint("down"),
  "red-edge": paint(),
  trim: paint(),
  "white-edge": paint(),
  cladding: paint(),
  "ochre-edge": paint(),
  // Stone.
  stone: stone(),
  stones: stone(),
  granite: stone(),
  bedrock: stone(),
  sandstone: stone(0.7),
  brick: stone(0.5),
  joint: stone(0.5),
  core: stone(0.5),
  slate: { layer: "slate", grain: "down" },
  "slate-edge": { layer: "slate", grain: "down" },
  // Turf, moss, hay.
  turf: { layer: "moss", grain: "model" },
  "barn/ramp": { layer: "moss", grain: "model" },
  hay: { layer: "moss", grain: "model", strength: 0.6 },
  // Bark.
  bark: { layer: "bark", grain: "along" },
  "spruce-bark": { layer: "bark", grain: "along" },
  "birch-bark": { layer: "bark", grain: "along", strength: 0.5 },
  withies: { layer: "bark", grain: "along", strength: 0.7 },
  // Iron.
  iron: { layer: "iron", grain: "model" },
  wire: { layer: "iron", grain: "model", strength: 0.7 },
  churns: { layer: "iron", grain: "model", strength: 0.4 },
};

const kindOf = (model: string, material: string): Kind | undefined =>
  KINDS[`${model}/${material}`] ?? KINDS[material];

export const DETAIL = tunables("Rendering/Village detail", {
  strength: { value: 1, min: 0, max: 3, hint: "The detail's normals, overall" },
  albedo: { value: 0.6, min: 0, max: 1.5, hint: "How much it varies the colour" },
  roughness: { value: 0.6, min: 0, max: 1.5, hint: "How much it varies the roughness" },
  tileScale: { value: 1, min: 0.25, max: 4, hint: "Times each map's tile size" },
  fadeStart: { value: 5, min: 0, max: 50, step: 0.5, hint: "Meters away it starts to fade" },
  fadeEnd: { value: 16, min: 1, max: 100, step: 0.5, hint: "Meters away it's gone" },
  sharpness: { value: 6, min: 1, max: 16, hint: "How narrow the triplanar blend zones are" },
  wood: { value: 1, min: 0, max: 3 },
  paint: { value: 0.8, min: 0, max: 3 },
  stone: { value: 1, min: 0, max: 3 },
  slate: { value: 0.9, min: 0, max: 3 },
  moss: { value: 1, min: 0, max: 3 },
  bark: { value: 1, min: 0, max: 3 },
  iron: { value: 0.8, min: 0, max: 3 },
});

// In dev, `__detail` in the console is the live settings, as the tuning panel changes them.
if (import.meta.env.DEV) Object.assign(window, { __detail: DETAIL });

// --- The texture array. ---

const SIZE = 1024;
let maps: RawTexture2DArray | undefined;
let loading = false;

async function pixels(url: string): Promise<Uint8ClampedArray> {
  const response = await fetch(assetUrl(url));
  if (!response.ok || (response.headers.get("content-type") ?? "").includes("html")) {
    throw new Error(`missing ${url}`);
  }
  const image = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(image, 0, 0, SIZE, SIZE);
  image.close();
  return context.getImageData(0, 0, SIZE, SIZE).data;
}

/** Packs every layer's normal, colour and ORM into one RGBA layer each, evened out (see the module). */
async function loadMaps(scene: Scene): Promise<RawTexture2DArray | undefined> {
  const texels = SIZE * SIZE;
  const data = new Uint8Array(texels * 4 * LAYERS.length);
  try {
    await Promise.all(
      LAYERS.map(async (layer, index) => {
        const name = `textures/surfaces/detail-${layer}`;
        const [normal, base, orm] = await Promise.all(
          ["normal", "base", "orm"].map((kind) => pixels(`${name}-${kind}.webp`)),
        );
        // The multiplier with the cavity in, and the roughness offset; then each evened out.
        const shade = new Float32Array(texels);
        const rough = new Float32Array(texels);
        let shadeSum = 0;
        let roughSum = 0;
        for (let i = 0; i < texels; i++) {
          shade[i] = ((base[i * 4] / 255) * 2 * orm[i * 4]) / 255;
          rough[i] = orm[i * 4 + 1] / 255 - 0.5;
          shadeSum += shade[i];
          roughSum += rough[i];
        }
        const shadeMean = shadeSum / texels || 1;
        const roughMean = roughSum / texels;
        const out = index * texels * 4;
        for (let i = 0; i < texels; i++) {
          const o = out + i * 4;
          data[o] = normal[i * 4];
          data[o + 1] = normal[i * 4 + 1];
          data[o + 2] = Math.round(Math.min(1, (shade[i] / shadeMean) * 0.5) * 255);
          data[o + 3] = Math.round(Math.min(1, Math.max(0, rough[i] - roughMean + 0.5)) * 255);
        }
      }),
    );
  } catch (err) {
    console.warn("Village detail maps missing, drawn without (pnpm run surface detail-…)", err);
    return undefined;
  }
  const texture = new RawTexture2DArray(
    data,
    SIZE,
    SIZE,
    LAYERS.length,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.name = "village-detail";
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

// --- The frames. ---

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec): Vec => scale(a, 1 / (length(a) || 1));
const UP: Vec = [0, 1, 0];
const AXES: Record<"x" | "y" | "z", Vec> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** The largest and second eigenvalues of a symmetric 3×3 matrix, with the first's vector. */
function principal(m: number[]): { axis: Vec; first: number; second: number } {
  const apply = (v: Vec): Vec => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[1] * v[0] + m[3] * v[1] + m[4] * v[2],
    m[2] * v[0] + m[4] * v[1] + m[5] * v[2],
  ];
  const power = (start: Vec, deflate?: { axis: Vec; value: number }) => {
    let v = unit(start);
    let value = 0;
    for (let k = 0; k < 40; k++) {
      let w = apply(v);
      if (deflate) w = sub(w, scale(deflate.axis, deflate.value * dot(deflate.axis, v)));
      value = length(w);
      if (value < 1e-12) return { axis: v, value: 0 };
      v = scale(w, 1 / value);
    }
    return { axis: v, value };
  };
  const first = power([0.577, 0.577, 0.577]);
  const second = power(cross(first.axis, [0.3, 0.9, 0.1]), first);
  return { axis: first.axis, first: first.value, second: second.value };
}

/** Any unit vector square to `a`. */
const across = (a: Vec): Vec => unit(cross(a, Math.abs(a[1]) < 0.9 ? UP : AXES.x));

/**
 * Writes the frame attributes for one range of a mesh's vertices: each piece in it (vertices
 * welded by place) gets a grain axis, an axis across it and an offset of its own.
 */
function frames(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  indices: ArrayLike<number>,
  start: number,
  count: number,
  kind: Kind | undefined,
  grain: Float32Array,
  face: Float32Array,
) {
  const end = start + count;
  if (!kind) {
    for (let v = start; v < end; v++) grain[v * 4 + 3] = -1;
    return;
  }
  const code = LAYERS.indexOf(kind.layer) + 0.5 * Math.min(1.99, kind.strength ?? 1);
  if (kind.grain === "model") {
    for (let v = start; v < end; v++) {
      grain.set([1, 0, 0, code], v * 4);
      face.set([0, 1, 0, 0], v * 4);
    }
    return;
  }
  // Weld by place, then join the corners of every face in the range.
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const byPlace = new Map<string, number>();
  for (let v = start; v < end; v++) {
    const key = `${Math.round(positions[v * 3] * 1e4)},${Math.round(positions[v * 3 + 1] * 1e4)},${Math.round(positions[v * 3 + 2] * 1e4)}`;
    const other = byPlace.get(key);
    if (other === undefined) byPlace.set(key, v - start);
    else join(v - start, other);
  }
  const faces: number[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t];
    if (a < start || a >= end) continue;
    join(a - start, indices[t + 1] - start);
    join(a - start, indices[t + 2] - start);
    faces.push(t);
  }
  // Each piece's area-weighted spread and normal.
  interface Piece {
    area: number;
    sum: Vec;
    outer: number[];
    normal: Vec;
  }
  const pieces = new Map<number, Piece>();
  const at = (i: number): Vec => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (const t of faces) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const pa = at(a);
    const pb = at(b);
    const pc = at(c);
    const n = cross(sub(pb, pa), sub(pc, pa));
    const area = length(n) / 2;
    if (area <= 0) continue;
    const root = find(a - start);
    let piece = pieces.get(root);
    if (!piece) {
      piece = { area: 0, sum: [0, 0, 0], outer: [0, 0, 0, 0, 0, 0], normal: [0, 0, 0] };
      pieces.set(root, piece);
    }
    // Normals by the vertices', which face the way the model means (the glTF root mirrors).
    for (const i of [a, b, c]) {
      const p = at(i);
      const w = area / 3;
      piece.area += w;
      piece.sum = [piece.sum[0] + p[0] * w, piece.sum[1] + p[1] * w, piece.sum[2] + p[2] * w];
      const o = piece.outer;
      o[0] += p[0] * p[0] * w;
      o[1] += p[0] * p[1] * w;
      o[2] += p[0] * p[2] * w;
      o[3] += p[1] * p[1] * w;
      o[4] += p[1] * p[2] * w;
      o[5] += p[2] * p[2] * w;
      piece.normal = [
        piece.normal[0] + normals[i * 3] * w,
        piece.normal[1] + normals[i * 3 + 1] * w,
        piece.normal[2] + normals[i * 3 + 2] * w,
      ];
    }
  }
  const frameOf = new Map<number, { g: Vec; a: Vec; seed: number }>();
  for (const [root, piece] of pieces) {
    const m = scale(piece.sum, 1 / piece.area);
    const o = piece.outer.map((x) => x / piece.area);
    const cov = [
      o[0] - m[0] * m[0],
      o[1] - m[0] * m[1],
      o[2] - m[0] * m[2],
      o[3] - m[1] * m[1],
      o[4] - m[1] * m[2],
      o[5] - m[2] * m[2],
    ];
    const { axis, first, second } = principal(cov);
    const n = length(piece.normal) > 1e-6 ? unit(piece.normal) : UP;
    let g: Vec;
    if (kind.grain === "x" || kind.grain === "y" || kind.grain === "z") {
      g = AXES[kind.grain];
    } else if (kind.grain === "down") {
      const down = sub(UP, scale(n, dot(n, UP)));
      g = length(down) > 0.3 ? unit(down) : axis;
    } else if (first > 2.5 * second) {
      g = axis;
    } else {
      const level = cross(UP, n);
      g = length(level) > 0.3 ? unit(level) : axis;
    }
    const flat = sub(n, scale(g, dot(n, g)));
    const a = length(flat) > 0.2 ? unit(flat) : across(g);
    // A random offset per piece, so neighbouring boards show different parts of the map.
    const seed = (Math.sin(m[0] * 12.9898 + m[1] * 78.233 + m[2] * 37.719) * 43758.5453) % 1;
    frameOf.set(root, { g, a, seed: Math.abs(seed) });
  }
  for (let v = start; v < end; v++) {
    const f = frameOf.get(find(v - start));
    if (!f) {
      grain[v * 4 + 3] = -1;
      continue;
    }
    grain.set([...f.g, code], v * 4);
    face.set([...f.a, f.seed], v * 4);
  }
}

// --- The plugin. ---

const LAYER_STRENGTHS = () => LAYERS.map((layer) => DETAIL[layer]);
const LAYER_TILES = () =>
  LAYERS.map((layer) => SURFACES[`detail-${layer}`].tile * DETAIL.tileScale);

// The fragment stage takes 16 varyings and PBR with cascaded shadows uses nearly all, so the
// detail gets one: the frame in the world as a quaternion's x, y, z (w >= 0 is implied), and in w
// the code (layer and strength) and the piece's offset, packed: 0 for no detail, else
// 1 + code × 64 × 64 + offset × 64. The place along the frame is taken in the fragment from the
// world position: the copies never move, so it doesn't swim.
const GLSL_VERTEX_DEFINITIONS = `
  attribute vec4 vdmGrain;
  attribute vec4 vdmFace;
  varying vec4 vdmQ;
`;
const GLSL_VERTEX_END = `
  {
    mat3 vdmWorld = mat3(finalWorld);
    vec3 G = normalize(vdmWorld * vdmGrain.xyz);
    vec3 A = vdmWorld * vdmFace.xyz;
    A = normalize(A - G * dot(A, G));
    vec3 B = cross(G, A);
    float trace = G.x + A.y + B.z;
    vec4 q;
    if (trace > 0.0) {
      float k = 0.5 / sqrt(trace + 1.0);
      q = vec4((A.z - B.y) * k, (B.x - G.z) * k, (G.y - A.x) * k, 0.25 / k);
    } else if (G.x > A.y && G.x > B.z) {
      float k = 2.0 * sqrt(1.0 + G.x - A.y - B.z);
      q = vec4(0.25 * k, (A.x + G.y) / k, (B.x + G.z) / k, (A.z - B.y) / k);
    } else if (A.y > B.z) {
      float k = 2.0 * sqrt(1.0 + A.y - G.x - B.z);
      q = vec4((A.x + G.y) / k, 0.25 * k, (B.y + A.z) / k, (B.x - G.z) / k);
    } else {
      float k = 2.0 * sqrt(1.0 + B.z - G.x - A.y);
      q = vec4((B.x + G.z) / k, (B.y + A.z) / k, 0.25 * k, (G.y - A.x) / k);
    }
    q *= q.w < 0.0 ? -1.0 : 1.0;
    float packed = vdmGrain.w < 0.0 ? 0.0
      : 1.0 + floor(vdmGrain.w * 64.0 + 0.5) * 64.0 + floor(clamp(vdmFace.w, 0.0, 0.999) * 64.0);
    vdmQ = vec4(q.xyz, packed);
  }
`;
const WGSL_VERTEX_DEFINITIONS = `
  attribute vdmGrain: vec4f;
  attribute vdmFace: vec4f;
  varying vdmQ: vec4f;
`;
const WGSL_VERTEX_END = `
  {
    let vdmWorld = mat3x3f(finalWorld[0].xyz, finalWorld[1].xyz, finalWorld[2].xyz);
    let G = normalize(vdmWorld * vertexInputs.vdmGrain.xyz);
    let A0 = vdmWorld * vertexInputs.vdmFace.xyz;
    let A = normalize(A0 - G * dot(A0, G));
    let B = cross(G, A);
    let trace = G.x + A.y + B.z;
    var q: vec4f;
    if (trace > 0.0) {
      let k = 0.5 / sqrt(trace + 1.0);
      q = vec4f((A.z - B.y) * k, (B.x - G.z) * k, (G.y - A.x) * k, 0.25 / k);
    } else if (G.x > A.y && G.x > B.z) {
      let k = 2.0 * sqrt(1.0 + G.x - A.y - B.z);
      q = vec4f(0.25 * k, (A.x + G.y) / k, (B.x + G.z) / k, (A.z - B.y) / k);
    } else if (A.y > B.z) {
      let k = 2.0 * sqrt(1.0 + A.y - G.x - B.z);
      q = vec4f((A.x + G.y) / k, 0.25 * k, (B.y + A.z) / k, (B.x - G.z) / k);
    } else {
      let k = 2.0 * sqrt(1.0 + B.z - G.x - A.y);
      q = vec4f((B.x + G.z) / k, (B.y + A.z) / k, 0.25 * k, (G.y - A.x) / k);
    }
    q *= select(1.0, -1.0, q.w < 0.0);
    let packed = select(
      1.0 + floor(vertexInputs.vdmGrain.w * 64.0 + 0.5) * 64.0 + floor(clamp(vertexInputs.vdmFace.w, 0.0, 0.999) * 64.0),
      0.0, vertexInputs.vdmGrain.w < 0.0);
    vertexOutputs.vdmQ = vec4f(q.xyz, packed);
  }
`;

/*
 * The fragment: a, b and g are the frame's axes in the world; c the place along them in meters.
 * Plane across a shows (g, b), across b (g, a), across g (a, b): g is always u on the long faces.
 * The map's v runs down the image, so v is negated to keep its normals' y along +v.
 */
const GLSL_FRAGMENT_DEFINITIONS = `
  varying vec4 vdmQ;
  uniform highp sampler2DArray vdmMaps;
  float vdmRough = 0.0;

  float vdmPick(vec4 lo, vec4 hi, float i) {
    return i < 4.0 ? lo[int(i)] : hi[int(i) - 4];
  }
  // One plane: the map at uv, its normal whiteout-blended onto n in the plane's frame (u, v, w).
  void vdmPlane(float weight, vec2 uv, vec2 dx, vec2 dy, float layer, vec3 u, vec3 v, vec3 w,
                vec3 n, float k, inout vec3 sumN, inout float sumShade, inout float sumRough) {
    if (weight <= 0.001) return;
    vec4 t = textureGrad(vdmMaps, vec3(uv, layer), dx, dy);
    vec2 tn = (t.rg * 2.0 - 1.0) * k;
    vec3 nb = vec3(dot(n, u), dot(n, v), dot(n, w));
    vec3 r = vec3(tn + nb.xy, abs(nb.z));
    sumN += weight * normalize(r.x * u + r.y * v + (nb.z < 0.0 ? -r.z : r.z) * w);
    sumShade += weight * t.b * 2.0;
    sumRough += weight * (t.a - 0.5);
  }
`;
const GLSL_BEFORE_LIGHTS = `
  {
    float packed = floor(vdmQ.w + 0.5) - 1.0;
    float codeStep = floor(packed / 64.0);
    float code = packed < 0.0 ? -1.0 : codeStep / 64.0;
    float seed = (packed - codeStep * 64.0) / 64.0;
    float layer = floor(max(code, 0.0));
    float own = fract(max(code, 0.0)) * 2.0 * step(0.0, code);
    vec4 q = vec4(vdmQ.xyz, sqrt(max(0.0, 1.0 - dot(vdmQ.xyz, vdmQ.xyz))));
    vec3 vdmG = vec3(1.0 - 2.0 * (q.y * q.y + q.z * q.z), 2.0 * (q.x * q.y + q.w * q.z), 2.0 * (q.x * q.z - q.w * q.y));
    vec3 vdmA = vec3(2.0 * (q.x * q.y - q.w * q.z), 1.0 - 2.0 * (q.x * q.x + q.z * q.z), 2.0 * (q.y * q.z + q.w * q.x));
    vec3 vdmB = cross(vdmG, vdmA);
    vec3 vdmC = vec3(dot(vPositionW, vdmG), dot(vPositionW, vdmA), dot(vPositionW, vdmB)) + seed * vec3(13.7, 7.31, 5.93);
    float tile = vdmPick(vdmTileLo, vdmTileHi, layer);
    vec3 s = vdmC / tile;
    vec3 sx = dFdx(s);
    vec3 sy = dFdy(s);
    float texels = max(length(sx), length(sy)) * ${SIZE.toFixed(1)};
    float lod = log2(max(texels, 1e-4));
    float dist = length(vPositionW - vEyePosition.xyz);
    float fade = own * vdmPick(vdmLayerLo, vdmLayerHi, layer)
      * (1.0 - smoothstep(vdmFade.x, vdmFade.y, dist)) * (1.0 - smoothstep(1.0, 3.5, lod));
    if (fade > 0.001) {
      vec3 g0 = normalize(vNormalW);
      vec3 w = pow(abs(vec3(dot(g0, vdmA), dot(g0, vdmB), dot(g0, vdmG))), vec3(vdmFade.w));
      w /= max(w.x + w.y + w.z, 1e-5);
      float k = fade * vdmFade.z;
      // End grain (the plane across g) shows the map turned on end: keep it faint.
      float kEnd = k * (code < 2.0 ? 0.35 : 1.0);
      vec3 sumN = vec3(0.0);
      float sumShade = 0.0;
      float sumRough = 0.0;
      vdmPlane(w.x, vec2(s.x, -s.z), vec2(sx.x, -sx.z), vec2(sy.x, -sy.z), layer, vdmG, vdmB, vdmA, normalW, k, sumN, sumShade, sumRough);
      vdmPlane(w.y, vec2(s.x, -s.y), vec2(sx.x, -sx.y), vec2(sy.x, -sy.y), layer, vdmG, vdmA, vdmB, normalW, k, sumN, sumShade, sumRough);
      vdmPlane(w.z, vec2(s.y, -s.z), vec2(sx.y, -sx.z), vec2(sy.y, -sy.z), layer, vdmA, vdmB, vdmG, normalW, kEnd, sumN, sumShade, sumRough);
      normalW = normalize(sumN);
      surfaceAlbedo *= mix(1.0, sumShade, fade * vdmAmount.x);
      vdmRough = sumRough * fade * vdmAmount.y;
    }
  }
`;

const WGSL_FRAGMENT_DEFINITIONS = `
  varying vdmQ: vec4f;
  var vdmMaps: texture_2d_array<f32>;
  var vdmMapsSampler: sampler;
  var<private> vdmRough: f32 = 0.0;

  fn vdmPick(lo: vec4f, hi: vec4f, i: f32) -> f32 {
    if (i < 4.0) { return lo[i32(i)]; }
    return hi[i32(i) - 4];
  }
  struct VdmSum { n: vec3f, shade: f32, rough: f32, }
  fn vdmPlane(sum: VdmSum, weight: f32, uv: vec2f, dx: vec2f, dy: vec2f, layer: i32,
              u: vec3f, v: vec3f, w: vec3f, n: vec3f, k: f32) -> VdmSum {
    if (weight <= 0.001) { return sum; }
    let t = textureSampleGrad(vdmMaps, vdmMapsSampler, uv, layer, dx, dy);
    let tn = (t.rg * 2.0 - 1.0) * k;
    let nb = vec3f(dot(n, u), dot(n, v), dot(n, w));
    let r = vec3f(tn + nb.xy, abs(nb.z));
    let rz = select(r.z, -r.z, nb.z < 0.0);
    var out = sum;
    out.n += weight * normalize(r.x * u + r.y * v + rz * w);
    out.shade += weight * t.b * 2.0;
    out.rough += weight * (t.a - 0.5);
    return out;
  }
`;
const WGSL_BEFORE_LIGHTS = `
  {
    let vq = fragmentInputs.vdmQ;
    let packed = floor(vq.w + 0.5) - 1.0;
    let codeStep = floor(packed / 64.0);
    let code = select(codeStep / 64.0, -1.0, packed < 0.0);
    let seed = (packed - codeStep * 64.0) / 64.0;
    let layer = floor(max(code, 0.0));
    let own = fract(max(code, 0.0)) * 2.0 * step(0.0, code);
    let q = vec4f(vq.xyz, sqrt(max(0.0, 1.0 - dot(vq.xyz, vq.xyz))));
    let G = vec3f(1.0 - 2.0 * (q.y * q.y + q.z * q.z), 2.0 * (q.x * q.y + q.w * q.z), 2.0 * (q.x * q.z - q.w * q.y));
    let A = vec3f(2.0 * (q.x * q.y - q.w * q.z), 1.0 - 2.0 * (q.x * q.x + q.z * q.z), 2.0 * (q.y * q.z + q.w * q.x));
    let B = cross(G, A);
    let pw = fragmentInputs.vPositionW;
    let vdmC = vec3f(dot(pw, G), dot(pw, A), dot(pw, B)) + seed * vec3f(13.7, 7.31, 5.93);
    let tile = vdmPick(uniforms.vdmTileLo, uniforms.vdmTileHi, layer);
    let s = vdmC / tile;
    let sx = dpdx(s);
    let sy = dpdy(s);
    let texels = max(length(sx), length(sy)) * ${SIZE.toFixed(1)};
    let lod = log2(max(texels, 1e-4));
    let dist = length(fragmentInputs.vPositionW - scene.vEyePosition.xyz);
    let fade = own * vdmPick(uniforms.vdmLayerLo, uniforms.vdmLayerHi, layer)
      * (1.0 - smoothstep(uniforms.vdmFade.x, uniforms.vdmFade.y, dist)) * (1.0 - smoothstep(1.0, 3.5, lod));
    if (fade > 0.001) {
      let g0 = normalize(fragmentInputs.vNormalW);
      var w = pow(abs(vec3f(dot(g0, A), dot(g0, B), dot(g0, G))), vec3f(uniforms.vdmFade.w));
      w /= max(w.x + w.y + w.z, 1e-5);
      let k = fade * uniforms.vdmFade.z;
      // End grain (the plane across g) shows the map turned on end: keep it faint.
      let kEnd = k * select(1.0, 0.35, code < 2.0);
      let li = i32(layer);
      var sum = VdmSum(vec3f(0.0), 0.0, 0.0);
      sum = vdmPlane(sum, w.x, vec2f(s.x, -s.z), vec2f(sx.x, -sx.z), vec2f(sy.x, -sy.z), li, G, B, A, normalW, k);
      sum = vdmPlane(sum, w.y, vec2f(s.x, -s.y), vec2f(sx.x, -sx.y), vec2f(sy.x, -sy.y), li, G, A, B, normalW, k);
      sum = vdmPlane(sum, w.z, vec2f(s.y, -s.z), vec2f(sx.y, -sx.z), vec2f(sy.y, -sy.z), li, A, B, G, normalW, kEnd);
      normalW = normalize(sum.n);
      surfaceAlbedo *= mix(1.0, sum.shade, fade * uniforms.vdmAmount.x);
      vdmRough = sum.rough * fade * uniforms.vdmAmount.y;
    }
  }
`;

class DetailPlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "VillageDetail", 210);
    this._enable(true);
  }

  override getClassName(): string {
    return "VillageDetail";
  }

  override isCompatible(): boolean {
    return true;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push("vdmGrain", "vdmFace");
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("vdmMaps");
  }

  override getActiveTextures(textures: import("@babylonjs/core").BaseTexture[]): void {
    if (maps) textures.push(maps);
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "vdmLayerLo", size: 4, type: "vec4" },
        { name: "vdmLayerHi", size: 4, type: "vec4" },
        { name: "vdmTileLo", size: 4, type: "vec4" },
        { name: "vdmTileHi", size: 4, type: "vec4" },
        { name: "vdmFade", size: 4, type: "vec4" },
        { name: "vdmAmount", size: 4, type: "vec4" },
      ],
      fragment: `uniform vec4 vdmLayerLo;
uniform vec4 vdmLayerHi;
uniform vec4 vdmTileLo;
uniform vec4 vdmTileHi;
uniform vec4 vdmFade;
uniform vec4 vdmAmount;`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const layers = [...LAYER_STRENGTHS(), 0];
    const tiles = [...LAYER_TILES(), 1];
    ubo.updateFloat4("vdmLayerLo", layers[0], layers[1], layers[2], layers[3]);
    ubo.updateFloat4("vdmLayerHi", layers[4], layers[5], layers[6], layers[7]);
    ubo.updateFloat4("vdmTileLo", tiles[0], tiles[1], tiles[2], tiles[3]);
    ubo.updateFloat4("vdmTileHi", tiles[4], tiles[5], tiles[6], tiles[7]);
    ubo.updateFloat4(
      "vdmFade",
      DETAIL.fadeStart,
      Math.max(DETAIL.fadeEnd, DETAIL.fadeStart + 0.1),
      DETAIL.strength,
      DETAIL.sharpness,
    );
    ubo.updateFloat4("vdmAmount", DETAIL.albedo, DETAIL.roughness, 0, 0);
    if (maps) ubo.setTexture("vdmMaps", maps);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    if (shaderType === "vertex") {
      return wgsl
        ? {
            CUSTOM_VERTEX_DEFINITIONS: WGSL_VERTEX_DEFINITIONS,
            CUSTOM_VERTEX_MAIN_END: WGSL_VERTEX_END,
          }
        : {
            CUSTOM_VERTEX_DEFINITIONS: GLSL_VERTEX_DEFINITIONS,
            CUSTOM_VERTEX_MAIN_END: GLSL_VERTEX_END,
          };
    }
    if (wgsl) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: WGSL_FRAGMENT_DEFINITIONS,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: WGSL_BEFORE_LIGHTS,
        "!var microSurface: f32=reflectivityOut\\.microSurface;var roughness: f32=reflectivityOut\\.roughness;":
          "var roughness: f32=clamp(reflectivityOut.roughness+vdmRough,0.0,1.0);var microSurface: f32=1.0-roughness;",
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: GLSL_FRAGMENT_DEFINITIONS,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: GLSL_BEFORE_LIGHTS,
      "!float microSurface=reflectivityOut\\.microSurface;float roughness=reflectivityOut\\.roughness;":
        "float roughness=clamp(reflectivityOut.roughness+vdmRough,0.0,1.0);float microSurface=1.0-roughness;",
    };
  }
}

/**
 * Gives a loaded village model's meshes the detail of their materials' kinds (see KINDS): the frame
 * attributes on every mesh, the plugin on every material with some detail. Call it before the
 * meshes are copied or drawn. `model` is its name, for the table's "model/material" keys.
 */
export function addDetail(scene: Scene, meshes: readonly AbstractMesh[], model: string): void {
  if (!ENABLED) return;
  if (!loading) {
    loading = true;
    // Flat, neutral maps until the real ones are in (or for good, if they're missing), so the
    // materials always have something bound and never wait.
    const flat = new Uint8Array(4 * 4 * 4 * LAYERS.length).fill(128);
    maps = new RawTexture2DArray(
      flat,
      4,
      4,
      LAYERS.length,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      false,
    );
    const placeholder = maps;
    void loadMaps(scene).then((texture) => {
      if (!texture) return;
      maps = texture;
      placeholder.dispose();
    });
  }
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !(mesh.material instanceof PBRMaterial)) continue;
    if (mesh.material.needAlphaTesting() || mesh.material.needAlphaBlending()) continue;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    const indices = mesh.getIndices();
    if (!positions || !normals || !indices) continue;
    const count = positions.length / 3;
    const parts: MergedPart[] = mesh.metadata?.parts ?? [
      { material: mesh.material.name, start: 0, count },
    ];
    const kinds = parts.map((part) => kindOf(model, part.material));
    if (!kinds.some(Boolean)) continue;
    const grain = new Float32Array(count * 4);
    const face = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) grain[v * 4 + 3] = -1;
    parts.forEach((part, i) => {
      frames(positions, normals, indices, part.start, part.count, kinds[i], grain, face);
    });
    // One buffer for both, interleaved: WebGPU allows 8 vertex buffers, and thin instances with
    // colour already take 7, but attributes read from one buffer count once.
    const both = new Float32Array(count * 8);
    for (let v = 0; v < count; v++) {
      both.set(grain.subarray(v * 4, v * 4 + 4), v * 8);
      both.set(face.subarray(v * 4, v * 4 + 4), v * 8 + 4);
    }
    const buffer = new Buffer(scene.getEngine(), both, false, 8);
    mesh.setVerticesBuffer(buffer.createVertexBuffer("vdmGrain", 0, 4));
    mesh.setVerticesBuffer(buffer.createVertexBuffer("vdmFace", 4, 4));
    const material = mesh.material;
    if (!material.pluginManager?.getPlugin("VillageDetail")) new DetailPlugin(material);
  }
}
