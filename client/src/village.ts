import {
  type AbstractMesh,
  Color3,
  type DirectionalLight,
  DynamicTexture,
  Geometry,
  Light,
  type Material,
  type MaterialDefines,
  MaterialPluginBase,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  ShaderLanguage,
  SpotLight,
  StandardMaterial,
  Texture,
  type TransformNode,
  type UniformBuffer,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import {
  channel,
  fbm,
  outside,
  RIVER_BANK,
  RIVER_DEPTH,
  ROAD_HALF,
  roadX,
  VILLAGE_MODELS,
  VILLAGE_SEED,
  type VillageModel,
  type VillagePlacement,
  valleyFloor,
  village,
  villageGround,
  waterLevel,
} from "../../shared/village";
import { Loop } from "./audio";
import { addDetail } from "./detailMap";
import { overrideGrade, regrade, surfaceMaterial } from "./graphics";
import { GroundCover, type GroundCoverLook } from "./groundCover";
import { addHeightFog, type HeightFogLook } from "./heightFog";
import { loadModel } from "./propAtlas";
import { LIGHT_PRIORITY, type World } from "./scene";
import { SURFACES, type SurfaceName, surface } from "./surfaces";
import { worldBox } from "./terrain";
import { TerrainBlend, type TerrainLook } from "./terrainBlend";
import { tunables } from "./tuning";

/**
 * The village's valley (shared/village.ts), drawn: the ground, floor and sides in one grid, with the
 * track and the river laid on it; the footbridge; every model, thin-instanced in chunks that are
 * culled by the frustum and by distance; and mountains beyond the valley's ends.
 *
 * The ground's height comes from `villageGround`, the same function the floors are built to, so
 * what players stand on is what they see. Its grid is a meter apart over the walkable valley, with
 * two lines close either side of every whole meter north and south, where the river's channel can
 * shift a meter from one strip of floor to the next, and wider apart further out.
 *
 * Models load from `models/village/<name>.glb`; one that isn't there yet is drawn as a rough shape
 * of its size built here, until a later page load finds it.
 */

/**
 * The ground cover: grass, heather and fern, toned to the ground they stand in (GroundCover), and the
 * dense cover of small tufts laid here over the walkable valley and its edges, close round the
 * camera, so the ground reads as one field rather than a lawn dotted with tufts.
 */
const COVER = tunables(
  "Rendering/Village ground cover",
  {
    grass: { value: 0.8, min: 0, max: 2, hint: "Grass tufts' brightness against the ground" },
    heather: { value: 0.8, min: 0, max: 2 },
    fern: { value: 0.7, min: 0, max: 2 },
    saturation: { value: 0.6, min: 0, max: 1.5, hint: "1 keeps the cards' own colour" },
    base: { value: 0.35, min: 0, max: 1, hint: "How dark the plants are at their foot" },
    up: { value: 0.75, min: 0, max: 1, hint: "How far the cards are lit as the ground is" },
    reach: { value: 36, min: 8, max: 80, step: 1, hint: "Meters the dense cover reaches" },
    density: {
      value: 1.6,
      min: 0,
      max: 4,
      step: 0.1,
      hint: "Dense cover's tufts per square meter at most (on reload)",
    },
  },
  () => {
    for (const update of coverLooks) update();
  },
);
const coverLooks: (() => void)[] = [];

/** Turns the models' shadows on or off, once they've loaded. */
let setShadows: ((on: boolean) => void) | undefined;
/** How far away each kind of thing is still drawn, in meters: the fog has taken it by then. */
const REACH = tunables(
  "Rendering/Village",
  {
    plants: { value: 70, min: 10, max: 300, step: 5, hint: "Grass, heather and ferns" },
    props: { value: 200, min: 20, max: 600, step: 10, hint: "Fences, walls, carts, poles" },
    rocks: { value: 300, min: 20, max: 800, step: 10, hint: "Boulders and outcrops" },
    trees: { value: 380, min: 50, max: 1000, step: 10 },
    shadows: { value: true, hint: "Buildings, props, rocks and trees cast the moon's shadows" },
    treeDetail: {
      value: 160,
      min: 0,
      max: 1000,
      step: 10,
      hint: "Trees further off than this are drawn as rough stand-ins",
    },
  },
  ({ shadows }, key) => {
    if (key === "shadows") setShadows?.(shadows);
  },
);

/** "cover" is the dense ground cover laid round the walkable valley here, not in the layout. */
type ModelClass = "building" | "prop" | "tree" | "rock" | "plant" | "cover";

const CLASS: Record<VillageModel, ModelClass> = {
  "log-farmhouse": "building",
  stabbur: "building",
  boathouse: "building",
  outhouse: "building",
  woodshed: "building",
  "clad-house": "building",
  barn: "building",
  "stave-church": "building",
  "roundpole-fence": "prop",
  "stone-wall": "prop",
  "stone-wall-end": "prop",
  "field-gate": "prop",
  "hay-rack": "prop",
  well: "prop",
  rowboat: "prop",
  "hay-cart": "prop",
  woodpile: "prop",
  "milk-ramp": "prop",
  "power-pole": "prop",
  "grave-cross": "prop",
  grindstone: "prop",
  sledge: "prop",
  "spruce-a": "tree",
  "spruce-b": "tree",
  "birch-a": "tree",
  "birch-b": "tree",
  "birch-dead": "tree",
  "boulder-a": "rock",
  "boulder-b": "rock",
  "boulder-c": "rock",
  "rock-outcrop": "rock",
  stump: "prop",
  "fallen-log": "prop",
  "grass-tuft": "plant",
  heather: "plant",
  fern: "plant",
};

/** Meters on a side of the squares a class's copies are chunked in, to cull each on its own. */
const CHUNK: Record<ModelClass, number> = {
  building: 4000,
  prop: 48,
  tree: 96,
  rock: 96,
  plant: 32,
  cover: 32,
};

const reachOf = (kind: ModelClass) =>
  kind === "plant"
    ? REACH.plants
    : kind === "cover"
      ? COVER.reach
      : kind === "prop"
        ? REACH.props
        : kind === "rock"
          ? REACH.rocks
          : kind === "tree"
            ? REACH.trees
            : Number.POSITIVE_INFINITY;

// --- The ground's surfaces. ---

type GroundKind = "meadow" | "forest" | "rock" | "riverbed" | "track";

interface GroundSurface {
  material: PBRMaterial;
  /** Meters one repeat of its texture covers. */
  tile: number;
}

/**
 * The village's ground, one material each, by the surface library's name for it. Until the village
 * set is in the library (client/src/surfaceTable.ts) each is a plain colour; once a name is in the
 * table it's drawn from the library instead, with no change here. The ground's vertex colours vary
 * it either way.
 */
const GROUND: Record<
  GroundKind,
  { name: string; color: [number, number, number]; roughness: number }
> = {
  meadow: { name: "meadow-grass", color: [0.52, 0.49, 0.32], roughness: 0.95 },
  forest: { name: "forest-floor", color: [0.33, 0.3, 0.23], roughness: 0.95 },
  rock: { name: "granite-rock", color: [0.47, 0.47, 0.48], roughness: 0.8 },
  riverbed: { name: "river-stones", color: [0.38, 0.36, 0.32], roughness: 0.55 },
  track: { name: "gravel-track", color: [0.58, 0.54, 0.44], roughness: 0.9 },
};

function groundSurface(scene: Scene, kind: GroundKind): GroundSurface {
  const { name, color, roughness } = GROUND[kind];
  if (name in SURFACES) {
    return {
      material: surface(scene, name as SurfaceName),
      tile: SURFACES[name as SurfaceName].tile,
    };
  }
  const material = surfaceMaterial(`village-${name}`, scene, new Color3(...color), { roughness });
  material.albedoTexture = grain(scene);
  return { material, tile: kind === "track" ? 1.5 : 3 };
}

let grainTexture: DynamicTexture | undefined;

/**
 * A tiling grain of light and dark specks and blotches, for the plain colours while there are no
 * baked surfaces, so the ground doesn't look like flat paint.
 */
function grain(scene: Scene): DynamicTexture {
  if (grainTexture) return grainTexture;
  const size = 256;
  const texture = new DynamicTexture("village-grain", { width: size, height: size }, scene, true);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(size, size);
  const lattice = (cells: number, salt: number) => {
    const values = Array.from({ length: cells * cells }, (_, i) => dice(i, cells, salt)[0]);
    return (x: number, y: number) => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const at = (i: number, j: number) =>
        values[((j % cells) * cells + (i % cells)) % values.length];
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
      return top + (bottom - top) * ty;
    };
  };
  const coarse = lattice(6, 1);
  const middle = lattice(24, 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const speck = dice(x, y, 3)[0];
      const v = 0.55 + 0.35 * coarse(x, y) + 0.3 * middle(x, y) + 0.35 * (speck - 0.5);
      const byte = Math.round(Math.min(1, Math.max(0, v * 0.85)) * 255);
      const i = (y * size + x) * 4;
      image.data.set([byte, byte, byte, 255], i);
    }
  }
  context.putImageData(image, 0, 0);
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  grainTexture = texture;
  return texture;
}

/** A small hash of a place to three numbers from 0 to 1: the same on every screen. */
function dice(x: number, z: number, salt = 0): [number, number, number] {
  let h = 2166136261 ^ salt;
  for (const v of [x, z]) {
    h ^= Math.round(v * 100) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    out.push((h >>> 0) / 2 ** 32);
  }
  return out as [number, number, number];
}

/**
 * Grid lines along an axis: every meter from `from` to `to` (or two close either side of each whole
 * meter, where `split`), with `extra` lines, then further and further apart out to `extent`.
 */
function axis(
  from: number,
  to: number,
  extent: number,
  split: boolean,
  extra: number[] = [],
): number[] {
  const inner: number[] = [];
  for (let v = from; v <= to; v++) {
    if (split) inner.push(v - 0.04, v + 0.04);
    else inner.push(v);
  }
  inner.push(...extra.filter((v) => v > from && v < to));
  inner.sort((a, b) => a - b);
  const outward = (start: number, direction: number) => {
    const list: number[] = [];
    let step = 1;
    let v = start;
    while (Math.abs(v) < extent) {
      // No coarser than 12 m, so the ridges against the sky don't run in straight lines.
      step = Math.min(step * 1.22, 12);
      v += direction * step;
      list.push(v);
    }
    return list;
  };
  return [...outward(inner[0], -1).reverse(), ...inner, ...outward(inner[inner.length - 1], 1)];
}

/** Whether a point is in the river's channel, in the valley. */
function inChannel(x: number, z: number): boolean {
  const { a, b } = channel(Math.floor(z));
  return x > a - RIVER_BANK && x < b + RIVER_BANK && outside(x, z) < 1;
}

/** The ground's large-scale variation and the valley sides' rock (terrainBlend.ts). */
const TERRAIN = tunables(
  "Rendering/Village terrain",
  {
    rock: { value: 1, min: 0, max: 1, hint: "Bare rock on the valley sides where they're steep" },
    steep: { value: 0.72, min: 0.3, max: 1, hint: "How upright ground keeps its forest floor" },
    rockBrightness: { value: 0.45, min: 0, max: 2 },
    macro: { value: 0.55, min: 0, max: 1, hint: "Large patches of lighter and darker ground" },
    wet: {
      value: 0.8,
      min: 0,
      max: 1,
      hint: "Damp patches on the flat: darker, glossy by flashlight",
    },
  },
  (values) => setTerrain(values),
);
const sideLook: TerrainLook = {
  rock: 0,
  steep: 0,
  macro: 0,
  rockTile: 1,
  rockBrightness: 1,
  wet: 0,
};
const flatLook: TerrainLook = { ...sideLook };
function setTerrain(values: typeof TERRAIN) {
  const tile = SURFACES["granite-rock"].tile * 2;
  Object.assign(sideLook, { ...values, rockTile: tile });
  Object.assign(flatLook, { ...values, rock: 0, rockTile: tile, macro: values.macro * 0.6 });
}
setTerrain(TERRAIN);

/** The ground: the valley floor and its sides, split by surface into one mesh each. */
function addGround(scene: Scene) {
  const xs = axis(-66, 92, 650, false, [-2.5, 2.5]);
  const zs = axis(-146, 146, 650, true);
  const nx = xs.length;
  const nz = zs.length;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) heights[j * nx + i] = villageGround(xs[i], zs[j]);
  }
  // Normals from the neighbours, skipping the close pairs of lines, whose difference is the
  // river's channel stepping, not the slope.
  const normals = new Float32Array(nx * nz * 3);
  const neighbour = (list: number[], index: number, direction: number) => {
    let k = index + direction;
    if (k >= 0 && k < list.length && Math.abs(list[k] - list[index]) < 0.2) k += direction;
    return Math.min(list.length - 1, Math.max(0, k));
  };
  for (let j = 0; j < nz; j++) {
    const j0 = neighbour(zs, j, -1);
    const j1 = neighbour(zs, j, 1);
    for (let i = 0; i < nx; i++) {
      const i0 = neighbour(xs, i, -1);
      const i1 = neighbour(xs, i, 1);
      const dx = (heights[j * nx + i1] - heights[j * nx + i0]) / (xs[i1] - xs[i0] || 1);
      const dz = (heights[j1 * nx + i] - heights[j0 * nx + i]) / (zs[j1] - zs[j0] || 1);
      const length = Math.hypot(dx, 1, dz);
      normals.set([-dx / length, 1 / length, -dz / length], (j * nx + i) * 3);
    }
  }

  // Each cell's two triangles go to the surface its middle is on.
  const cells: Record<Exclude<GroundKind, "track">, number[]> = {
    meadow: [],
    forest: [],
    rock: [],
    riverbed: [],
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      const up = (normals[a * 3 + 1] + normals[(a + nx + 1) * 3 + 1]) / 2;
      const out = outside(cx, cz);
      // The valley sides are one surface, rock or forest floor by vertex colour, so their coarse
      // cells far out don't show as blotches; the knoll's steep sides are rock.
      const kind = inChannel(cx, cz)
        ? "riverbed"
        : out > 2.5 + 3 * fbm(cx / 20, cz / 20, 2, 3)
          ? "forest"
          : up < 0.74
            ? "rock"
            : "meadow";
      cells[kind].push(a);
    }
  }

  const meshes: Mesh[] = [];
  for (const [kind, list] of Object.entries(cells) as [Exclude<GroundKind, "track">, number[]][]) {
    if (list.length === 0) continue;
    const { material, tile } = groundSurface(scene, kind);
    const rock = surface(scene, "granite-rock").albedoTexture;
    if (rock && !material.pluginManager?.getPlugin("TerrainBlend")) {
      // Only the valley sides turn to rock where they're steep; the knoll's are rock already.
      new TerrainBlend(material, kind === "forest" ? sideLook : flatLook, rock);
    }
    const remap = new Map<number, number>();
    const positions: number[] = [];
    const normalData: number[] = [];
    const uvs: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    const vertex = (v: number) => {
      let index = remap.get(v);
      if (index !== undefined) return index;
      index = remap.size;
      remap.set(v, index);
      const i = v % nx;
      const j = Math.floor(v / nx);
      const x = xs[i];
      const z = zs[j];
      const y = heights[v];
      positions.push(x, y, z);
      normalData.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
      if (kind === "rock") {
        // granite-rock's streaks run down v: v up the slope, u along it, the way it faces.
        const across = Math.abs(normals[v * 3]) > Math.abs(normals[v * 3 + 2]) ? z : x;
        uvs.push(across / tile, y / tile);
      } else uvs.push(x / tile, z / tile);
      const open = occlusion(x, z);
      const [r, g, b] = groundColour(kind, x, y, z);
      colours.push(r * open, g * open, b * open, 1);
      return index;
    };
    for (const a of list) {
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices.push(vertex(a), vertex(b), vertex(c), vertex(b), vertex(d), vertex(c));
    }
    const data = new VertexData();
    data.positions = positions;
    data.normals = normalData;
    data.uvs = uvs;
    data.colors = colours;
    data.indices = positions.length / 3 > 65535 ? Uint32Array.from(indices) : indices;
    const mesh = new Mesh(`village-${kind}`, scene);
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    meshes.push(mesh);
  }
  return meshes;
}

/** How upright the ground's normal is at a point: 1 flat, 0 a cliff. */
function normalAt(x: number, z: number): number {
  const d = 2;
  const dx = (villageGround(x + d, z) - villageGround(x - d, z)) / (2 * d);
  const dz = (villageGround(x, z + d) - villageGround(x, z - d)) / (2 * d);
  return 1 / Math.hypot(dx, 1, dz);
}

/** A ground vertex's colour, which multiplies its surface's: patches, wet by the water, dark under trees. */
function groundColour(kind: GroundKind, x: number, y: number, z: number): [number, number, number] {
  const patch = fbm(x / 13, z / 13, 3, 7);
  const fine = fbm(x / 2.5, z / 2.5, 2, 9);
  if (kind === "meadow") {
    // Dry, yellowed grass and lusher, darker patches; darker towards the trees.
    const dry = patch;
    const edge = Math.min(1, Math.max(0, (outside(x, z) + 6) / 8));
    const light = (0.82 + 0.3 * fine) * (1 - 0.25 * edge);
    return [light * (0.86 + 0.24 * dry), light * (0.95 + 0.08 * dry), light * (0.9 - 0.1 * dry)];
  }
  if (kind === "forest") {
    // Grey bare rock where it's steep, needles and moss where it isn't.
    const n = normalAt(x, z);
    const rock = Math.min(1, Math.max(0, (0.82 - n) / 0.2));
    const light = (0.78 + 0.35 * fine) * (1 + 0.25 * rock);
    return [
      light * (1 - 0.12 * rock),
      light * (0.95 + 0.1 * patch - 0.05 * rock),
      light * (0.95 + 0.08 * rock),
    ];
  }
  if (kind === "rock") {
    // Moss and lichen in hollows.
    const moss = Math.max(0, patch - 0.55) * 1.6;
    const light = 0.75 + 0.4 * fine;
    return [light * (1 - 0.25 * moss), light * (1 - 0.05 * moss), light * (1 - 0.35 * moss)];
  }
  // The river's bed: darker where it's deeper.
  const depth = Math.min(1, Math.max(0, (valleyFloor(z) - y) / RIVER_DEPTH));
  const light = (0.95 - 0.35 * depth) * (0.8 + 0.35 * fine);
  return [light, light, light * 1.02];
}

/** What surface the ground at a point is drawn with, as addGround splits it. */
function groundKindAt(x: number, z: number): Exclude<GroundKind, "track"> {
  if (inChannel(x, z)) return "riverbed";
  if (outside(x, z) > 2.5 + 3 * fbm(x / 20, z / 20, 2, 3)) return "forest";
  return normalAt(x, z) < 0.74 ? "rock" : "meadow";
}

/**
 * How things standing on the ground shade it, as the sky above sees it: dark round the foot of a
 * building, under a spruce's skirt, beside a boulder or a wall. Overcast and moonless, the sky is
 * the only light, so this is what grounds them: 1 open, less where shaded, multiplying the ground's
 * colour and the colour of the plants growing there.
 */
let occluders: ((x: number, z: number) => number) | undefined;

/** How much a model shades the ground round it: how dark at its foot, and over how many meters it fades. */
function shadeOf(model: VillageModel): { dark: number; reach: number; round: boolean } | undefined {
  const kind = CLASS[model];
  if (kind === "building") return { dark: 0.55, reach: 1.6, round: false };
  if (model === "spruce-a" || model === "spruce-b") return { dark: 0.5, reach: 0, round: true };
  if (kind === "tree") return { dark: 0.25, reach: 0, round: true };
  if (kind === "rock") return { dark: 0.5, reach: 0.7, round: false };
  if (model === "stone-wall" || model === "stone-wall-end" || model === "woodpile")
    return { dark: 0.4, reach: 0.5, round: false };
  if (model === "well" || model === "hay-cart" || model === "milk-ramp")
    return { dark: 0.35, reach: 0.6, round: false };
  return undefined;
}

function occlusion(x: number, z: number): number {
  if (!occluders) {
    const CELL = 16;
    const cells = new Map<string, ((x: number, z: number) => number)[]>();
    for (const p of village(VILLAGE_SEED).placements) {
      const shade = shadeOf(p.model);
      if (!shade) continue;
      const [w, d] = VILLAGE_MODELS[p.model];
      const c = Math.abs(Math.cos(p.turn));
      const s = Math.abs(Math.sin(p.turn));
      const scale = scaleOf(p, CLASS[p.model]);
      const hx = ((w * c + d * s) / 2) * scale;
      const hz = ((w * s + d * c) / 2) * scale;
      // A tree shades the ground under its crown, most at the trunk; anything else round its foot.
      const radius = shade.round ? Math.max(hx, hz) * 0.9 : 0;
      const fade = shade.round ? radius : shade.reach;
      const of = shade.round
        ? (px: number, pz: number) => {
            const t = 1 - Math.hypot(px - p.x, pz - p.z) / radius;
            return t <= 0 ? 1 : 1 - shade.dark * t * t * (3 - 2 * t);
          }
        : (px: number, pz: number) => {
            const ox = Math.max(Math.abs(px - p.x) - hx, 0);
            const oz = Math.max(Math.abs(pz - p.z) - hz, 0);
            const away = Math.hypot(ox, oz);
            return away > fade * 3 ? 1 : 1 - shade.dark * Math.exp(-away / fade);
          };
      const reach = Math.max(hx, hz) + fade * 3;
      for (let i = Math.floor((p.x - reach) / CELL); i <= Math.floor((p.x + reach) / CELL); i++) {
        for (let j = Math.floor((p.z - reach) / CELL); j <= Math.floor((p.z + reach) / CELL); j++) {
          const key = `${i}:${j}`;
          const list = cells.get(key);
          if (list) list.push(of);
          else cells.set(key, [of]);
        }
      }
    }
    occluders = (px, pz) => {
      let open = 1;
      for (const of of cells.get(`${Math.floor(px / CELL)}:${Math.floor(pz / CELL)}`) ?? [])
        open *= of(px, pz);
      return open;
    };
  }
  return occluders(x, z);
}

/** The track: a strip of gravel laid on the ground, from beyond the valley's south end up to the church. */
function addTrack(scene: Scene, churchFront: number) {
  const { material, tile } = groundSurface(scene, "track");
  material.zOffset = -2;
  const rock = surface(scene, "granite-rock").albedoTexture;
  if (rock && !material.pluginManager?.getPlugin("TerrainBlend"))
    new TerrainBlend(material, flatLook, rock);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const across = [-1, -0.5, 0, 0.5, 1];
  let rows = 0;
  let along = 0;
  let last: { x: number; z: number } | undefined;
  for (let z = -650; z <= churchFront; z += z < -150 ? 4 : 1) {
    // The track, then the ramp up the knoll, narrower between its walls, then the path to the door.
    const x = z < 94 ? roadX(z) : 0;
    // A little wider than the surface's verges (3.2 m apart), so grass creeps over its edges.
    const half =
      (z < 94 ? ROAD_HALF - 0.2 : z < 110 ? 1.7 : 1.4) + (fbm(z / 7, 3, 2, 51) - 0.5) * 0.4;
    if (last) along += Math.hypot(x - last.x, z - last.z);
    last = { x, z };
    for (const t of across) {
      const px = x + t * half;
      const y = villageGround(px, z) + 0.025;
      positions.push(px, y, z);
      // gravel-track runs along u, its ruts and grass crown across v, centred on the middle.
      uvs.push(along / tile, 0.5 + (t * half) / tile);
      // Darker along the edges, where grass creeps in, and down the middle.
      const fine = fbm(px / 1.5, z / 1.5, 2, 61);
      const light =
        (Math.abs(t) > 0.9 ? 0.72 : t === 0 ? 0.8 : 1) * (0.85 + 0.3 * fine) * occlusion(px, z);
      colours.push(light, light, light * 0.97, 1);
    }
    if (rows > 0) {
      const base = (rows - 1) * across.length;
      for (let k = 0; k < across.length - 1; k++) {
        const a = base + k;
        const b = a + 1;
        const c = a + across.length;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    rows++;
  }
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.colors = colours;
  data.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  const mesh = new Mesh("village-track", scene);
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
}

/**
 * The river's water: one strip down its channel, a little wider than the water so its edges hide
 * under the banks. Where it runs down the headwall at the valley's north end it's white.
 */
function addWater(scene: Scene) {
  const material = surfaceMaterial("village-water", scene, new Color3(1, 1, 1), {
    roughness: 0.18,
  });
  material.metallic = 0;
  // The environment's image is a sunny day: still water would mirror it.
  material.environmentIntensity = 0.35;
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  let rows = 0;
  for (let z = -650; z <= 330; z += z < -150 || z > 150 ? 2 : 1) {
    const here = channel(Math.floor(z));
    const before = channel(Math.floor(z) - 1);
    const left = Math.min(here.a, before.a) - RIVER_BANK + 0.2;
    const right = Math.max(here.b, before.b) + RIVER_BANK - 0.2;
    const y = waterLevel(z);
    const slope = Math.abs(valleyFloor(z + 1) - valleyFloor(z - 1)) / 2;
    const foam = Math.min(1, Math.max(0, (slope - 0.04) / 0.25));
    for (const x of [left, (left + right) / 2, right]) {
      positions.push(x, y, z);
      const ripple = 0.8 + 0.4 * fbm(x / 3, z / 6, 2, 71);
      colours.push(
        (0.035 + 0.55 * foam) * ripple,
        (0.05 + 0.56 * foam) * ripple,
        (0.06 + 0.58 * foam) * ripple,
        1,
      );
    }
    if (rows > 0) {
      const base = (rows - 1) * 3;
      for (let k = 0; k < 2; k++) {
        const a = base + k;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
    rows++;
  }
  const data = new VertexData();
  data.positions = positions;
  data.colors = colours;
  data.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  const mesh = new Mesh("village-water", scene);
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
}

/** The footbridges: a plank deck on two beams, and a rail each side on posts over the water. */
function addBridges(scene: Scene) {
  const tile = SURFACES["wood-plank"].tile;
  const parts: Mesh[] = [];
  for (const deck of village(VILLAGE_SEED).bridges) {
    const { minX, maxX, minZ, maxZ, y } = deck;
    parts.push(
      worldBox(
        "bridge-deck",
        new Vector3(minX, y - 0.08, minZ),
        new Vector3(maxX, y, maxZ),
        scene,
        tile,
      ),
    );
    for (const z of [minZ + 0.12, maxZ - 0.12]) {
      parts.push(
        worldBox(
          "bridge-beam",
          new Vector3(minX + 0.4, y - 0.32, z - 0.1),
          new Vector3(maxX - 0.4, y - 0.08, z + 0.1),
          scene,
          tile,
        ),
      );
    }
    // The rails, over the channel only, so the ends are open.
    const from = minX + 1;
    const to = maxX - 1;
    for (const z of [minZ + 0.05, maxZ - 0.05]) {
      parts.push(
        worldBox(
          "bridge-rail",
          new Vector3(from, y + 0.92, z - 0.05),
          new Vector3(to, y + 1, z + 0.05),
          scene,
          tile,
        ),
      );
      parts.push(
        worldBox(
          "bridge-rail",
          new Vector3(from, y + 0.5, z - 0.03),
          new Vector3(to, y + 0.56, z + 0.03),
          scene,
          tile,
        ),
      );
      const count = Math.ceil((to - from) / 1.6);
      for (let k = 0; k <= count; k++) {
        const x = from + ((to - from) * k) / count;
        parts.push(
          worldBox(
            "bridge-post",
            new Vector3(x - 0.05, y - 0.3, z - 0.05),
            new Vector3(x + 0.05, y + 1, z + 0.05),
            scene,
            tile,
          ),
        );
      }
    }
  }
  if (parts.length === 0) return;
  const bridge = Mesh.MergeMeshes(parts, true, true);
  if (!bridge) return;
  bridge.name = "village-bridges";
  bridge.material = surface(scene, "wood-plank");
  bridge.receiveShadows = true;
  bridge.isPickable = false;
}

// --- The models. ---

/** Vertex colours are linear; the colours here are written as they look, in sRGB. */
const linear = (c: number) => c ** 2.2;

/** A rough stand-in for a model that isn't there yet, of its size, its base on y = 0, coloured by vertex. */
function placeholder(scene: Scene, model: VillageModel): Mesh {
  const [w, d, h] = VILLAGE_MODELS[model];
  const parts: Mesh[] = [];
  const paint = (mesh: Mesh, colour: [number, number, number], shade = 0) => {
    const count = mesh.getTotalVertices();
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const data: number[] = [];
    for (let i = 0; i < count; i++) {
      // Darker towards the bottom, by `shade`.
      const t =
        shade > 0 ? 1 - shade * (1 - Math.min(1, Math.max(0, positions[i * 3 + 1] / h))) : 1;
      data.push(linear(colour[0] * t), linear(colour[1] * t), linear(colour[2] * t), 1);
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, data);
    parts.push(mesh);
    return mesh;
  };
  const box = (
    bw: number,
    bh: number,
    bd: number,
    x: number,
    y: number,
    z: number,
    colour: [number, number, number],
  ) => {
    const mesh = MeshBuilder.CreateBox("part", { width: bw, height: bh, depth: bd }, scene);
    mesh.position.set(x, y + bh / 2, z);
    mesh.bakeCurrentTransformIntoVertices();
    return paint(mesh, colour);
  };
  const cylinder = (
    top: number,
    bottom: number,
    ch: number,
    x: number,
    y: number,
    z: number,
    colour: [number, number, number],
    tessellation = 8,
  ) => {
    const mesh = MeshBuilder.CreateCylinder(
      "part",
      { diameterTop: top, diameterBottom: bottom, height: ch, tessellation },
      scene,
    );
    mesh.position.set(x, y + ch / 2, z);
    mesh.bakeCurrentTransformIntoVertices();
    return paint(mesh, colour);
  };
  /** A pitched roof, its ridge along x (or z), from `y` up `rise`, `width` across. */
  const roof = (
    length: number,
    width: number,
    rise: number,
    y: number,
    colour: [number, number, number],
    alongZ = false,
  ) => {
    const mesh = MeshBuilder.CreateCylinder(
      "roof",
      { diameter: 1, height: length, tessellation: 3 },
      scene,
    );
    // A three-sided cylinder lying down with an edge up is a gable roof: scale it to size.
    mesh.rotation.z = Math.PI / 2;
    mesh.rotation.y = alongZ ? Math.PI / 2 : 0;
    mesh.bakeCurrentTransformIntoVertices();
    mesh.rotation.set(0, 0, 0);
    const scaleAcross = width / Math.sqrt(3) / 0.5;
    mesh.scaling.set(alongZ ? scaleAcross : 1, rise / 0.75, alongZ ? 1 : scaleAcross);
    mesh.position.y = y + rise * (0.25 / 0.75);
    mesh.bakeCurrentTransformIntoVertices();
    return paint(mesh, colour);
  };
  /** Cards crossing at their middles, for plants: tip colour at the top. */
  const tuft = (count: number, base: [number, number, number], tip: [number, number, number]) => {
    const positions: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    for (let k = 0; k < count; k++) {
      const angle = (k / count) * Math.PI;
      const cx = (Math.cos(angle) * w) / 2;
      const cz = (Math.sin(angle) * d) / 2;
      const top = 0.25;
      const n = positions.length / 3;
      positions.push(-cx, 0, -cz, cx, 0, cz, cx * top, h, cz * top, -cx * top, h, -cz * top);
      const [b, t] = [base.map(linear), tip.map(linear)];
      colours.push(...b, 1, ...b, 1, ...t, 1, ...t, 1);
      indices.push(n, n + 2, n + 1, n, n + 3, n + 2);
    }
    const data = new VertexData();
    data.positions = positions;
    data.colors = colours;
    data.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    // Lit as if they faced up, as grass seen from anywhere should be.
    for (let i = 0; i < normals.length; i += 3) {
      normals[i] *= 0.3;
      normals[i + 1] = 1;
      normals[i + 2] *= 0.3;
    }
    data.normals = normals;
    const mesh = new Mesh("tuft", scene);
    data.applyToMesh(mesh);
    parts.push(mesh);
  };

  const timber: [number, number, number] = [0.3, 0.21, 0.14];
  const tarred: [number, number, number] = [0.17, 0.12, 0.09];
  const turf: [number, number, number] = [0.24, 0.24, 0.15];
  const slate: [number, number, number] = [0.22, 0.23, 0.25];
  const stone: [number, number, number] = [0.42, 0.42, 0.42];
  const bark: [number, number, number] = [0.25, 0.2, 0.16];
  switch (model) {
    case "log-farmhouse":
      box(w, h * 0.55, d, 0, 0, 0, tarred);
      roof(w + 0.6, d + 0.8, h * 0.45, h * 0.55, turf);
      break;
    case "clad-house":
      box(w, h * 0.6, d, 0, 0, 0, [0.62, 0.6, 0.55]);
      roof(w + 0.5, d + 0.6, h * 0.4, h * 0.6, slate);
      break;
    case "barn":
      box(w, h * 0.55, d, 0, 0, 0, [0.45, 0.17, 0.12]);
      roof(w + 0.6, d + 0.8, h * 0.45, h * 0.55, slate);
      break;
    case "boathouse":
      box(w, h * 0.55, d, 0, 0, 0, [0.33, 0.3, 0.27]);
      roof(d + 0.4, w + 0.6, h * 0.45, h * 0.55, slate, true);
      break;
    case "stabbur":
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) box(0.5, 1, 0.5, (sx * w) / 2.6, 0, (sz * d) / 2.6, stone);
      box(w * 0.85, h * 0.45, d * 0.85, 0, 1, 0, timber);
      roof(w + 0.4, d + 0.4, h * 0.38, 1 + h * 0.45, turf);
      break;
    case "outhouse":
    case "woodshed":
      box(w, h * 0.7, d, 0, 0, 0, timber);
      roof(w + 0.3, d + 0.3, h * 0.3, h * 0.7, turf);
      break;
    case "stave-church":
      box(w, 6, d * 0.8, 0, 0, -d * 0.05, tarred);
      roof(d * 0.8, w + 0.6, 4, 6, tarred, true);
      box(w * 0.6, 4.5, 3, 0, 0, d * 0.42, tarred);
      box(3, 4, 3, 0, 8.5, -d * 0.05, tarred);
      cylinder(0, 3.4, h - 12.5, 0, 12.5, -d * 0.05, tarred, 4);
      break;
    case "spruce-a":
    case "spruce-b": {
      const green: [number, number, number] = [0.1, 0.15, 0.11];
      cylinder(0.2, 0.35, 2, 0, 0, 0, bark);
      cylinder(0, w, h * 0.55, 0, h * 0.08, 0, green, 9);
      cylinder(0, w * 0.75, h * 0.45, 0, h * 0.35, 0, green, 9);
      cylinder(0, w * 0.45, h * 0.35, 0, h * 0.65, 0, green, 8);
      break;
    }
    case "birch-a":
    case "birch-b": {
      cylinder(0.12, 0.3, h * 0.7, 0, 0, 0, [0.72, 0.7, 0.66]);
      const canopy = MeshBuilder.CreateSphere("crown", { diameter: 1, segments: 6 }, scene);
      canopy.scaling.set(w, h * 0.55, d);
      canopy.position.y = h * 0.62;
      canopy.bakeCurrentTransformIntoVertices();
      paint(canopy, [0.3, 0.26, 0.13]);
      break;
    }
    case "birch-dead":
      cylinder(0.08, 0.3, h, 0, 0, 0, [0.55, 0.53, 0.5]);
      break;
    case "boulder-a":
    case "boulder-b":
    case "boulder-c":
    case "rock-outcrop": {
      const rock = MeshBuilder.CreateIcoSphere(
        "rock",
        { radius: 0.5, subdivisions: 2, flat: false },
        scene,
      );
      rock.scaling.set(w, h * 1.4, d);
      rock.position.y = h * 0.3;
      rock.bakeCurrentTransformIntoVertices();
      paint(rock, [0.38, 0.38, 0.37], 0.3);
      break;
    }
    case "stump":
      cylinder(w * 0.8, w, h, 0, 0, 0, bark);
      break;
    case "fallen-log": {
      const log = cylinder(w, w, d, 0, 0, 0, bark);
      log.rotation.x = Math.PI / 2;
      log.position.y = w / 2 - d / 2;
      log.bakeCurrentTransformIntoVertices();
      break;
    }
    case "roundpole-fence":
      for (const x of [-w / 2 + 0.1, 0, w / 2 - 0.1]) box(0.1, h, 0.1, x, 0, 0, [0.38, 0.33, 0.27]);
      for (const y of [0.45, 0.85]) box(w, 0.08, 0.08, 0, y, 0, [0.42, 0.37, 0.3]);
      break;
    case "hay-rack":
      for (let x = -w / 2 + 0.1; x <= w / 2; x += 1.5)
        box(0.1, h, 0.1, x, 0, 0, [0.38, 0.33, 0.27]);
      for (const y of [0.5, 0.9, 1.3, 1.7]) box(w, 0.05, 0.05, 0, y, 0, [0.42, 0.37, 0.3]);
      break;
    case "stone-wall":
    case "stone-wall-end":
      box(w, h * 0.9, d, 0, 0, 0, stone);
      box(w * 0.92, h * 0.12, d * 0.7, 0, h * 0.88, 0, [0.36, 0.38, 0.33]);
      break;
    case "power-pole":
      cylinder(0.2, 0.28, h, 0, 0, 0, [0.28, 0.24, 0.2]);
      box(d, 0.1, 0.1, 0, h - 0.6, 0, [0.28, 0.24, 0.2]);
      break;
    case "grave-cross":
      box(0.09, h, 0.06, 0, 0, 0, [0.35, 0.34, 0.33]);
      box(w * 0.7, 0.08, 0.06, 0, h * 0.68, 0, [0.35, 0.34, 0.33]);
      break;
    case "grass-tuft":
      tuft(6, [0.12, 0.12, 0.06], [0.36, 0.34, 0.19]);
      break;
    case "heather":
      tuft(6, [0.16, 0.12, 0.11], [0.34, 0.24, 0.29]);
      break;
    case "fern":
      tuft(5, [0.16, 0.15, 0.07], [0.4, 0.3, 0.11]);
      break;
    default:
      box(w, h, d, 0, 0, 0, model === "well" ? stone : timber);
  }
  const merged = parts.length === 1 ? parts[0] : (Mesh.MergeMeshes(parts, true, true) as Mesh);
  merged.name = `village-${model}`;
  return merged;
}

/**
 * Keeps alpha-tested foliage (needles, twigs, grass blades) from thinning away with distance: as
 * mipmaps blur a card's alpha below the cut-off, the cut-off drops with the mip level, so a far
 * birch keeps its crown. The engine's own test is set low so its other passes see the cards too.
 */
class FoliageCutout extends MaterialPluginBase {
  constructor(
    material: PBRMaterial,
    private readonly size: number,
  ) {
    // A define of its own, so its code isn't left out of an effect another material compiled.
    super(material, "FoliageCutout", 195, { FOLIAGECUTOUT: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "FoliageCutout";
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.FOLIAGECUTOUT = true;
  }

  override isCompatible(): boolean {
    return true;
  }

  // The size is a uniform: the base constructor asks for the code before this one has run.
  override getUniforms() {
    return {
      ubo: [{ name: "foliageSize", size: 1, type: "float" }],
      fragment: "uniform float foliageSize;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat("foliageSize", this.size);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_UPDATE_ALPHA: `
          #ifdef ALBEDO
          {
            let foliageFw = fwidth(fragmentInputs.vAlbedoUV) * uniforms.foliageSize;
            let foliageLod = log2(max(max(foliageFw.x, foliageFw.y), 1e-4));
            if (albedoTexture.a < 0.5 * exp2(-clamp(foliageLod - 1.0, 0.0, 2.3))) { discard; }
          }
          #endif
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef ALBEDO
        {
          vec2 foliageFw = fwidth(vAlbedoUV) * foliageSize;
          float foliageLod = log2(max(max(foliageFw.x, foliageFw.y), 1e-4));
          if (albedoTexture.a < 0.5 * exp2(-clamp(foliageLod - 1.0, 0.0, 2.3))) discard;
        }
        #endif
      `,
    };
  }
}

/** Gives a loaded model's cut-out materials the distance-aware cut-off. */
function keepFoliage(materials: readonly Material[]) {
  for (const material of materials) {
    if (!(material instanceof PBRMaterial) || !material.needAlphaTesting()) continue;
    const texture = material.albedoTexture;
    if (!texture || material.pluginManager?.getPlugin("FoliageCutout")) continue;
    material.alphaCutOff = 0.08;
    material.twoSidedLighting = false;
    new FoliageCutout(material, texture.getSize().width || 1024);
  }
}

/** A copy's matrix: turned and stood at its place, scaled by `scale`, under a glTF root that flips x or not. */
function matrixOf(p: VillagePlacement, scale: number, gltf: boolean): number[] {
  const c = Math.cos(p.turn) * scale;
  const s = Math.sin(p.turn) * scale;
  if (gltf) return [c, 0, s, 0, 0, scale, 0, 0, -s, 0, c, 0, -p.x, p.y, p.z, 1];
  return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, p.x, p.y, p.z, 1];
}

/** How much a copy is scaled: trees and plants vary, rocks out of reach too; what players bump into doesn't. */
function scaleOf(p: VillagePlacement, kind: ModelClass): number {
  const [roll] = dice(p.x, p.z, 5);
  if (kind === "tree") return 0.82 + 0.4 * roll;
  if (kind === "plant") return 0.7 + 0.6 * roll;
  // The cover: mostly small tufts, the odd big one.
  if (kind === "cover") return 0.45 + 0.5 * roll * roll;
  if (kind === "rock") return outside(p.x, p.z) > 0 ? 0.8 + 0.6 * roll : 0.85 + 0.15 * roll;
  return 1;
}

/**
 * The colour of the ground at a point, relative to the meadow's, as a plant growing there takes it:
 * its surface, its patches and wear, and what shades it.
 */
function groundTone(x: number, z: number): [number, number, number] {
  const kind = groundKindAt(x, z);
  const surface = SURFACES[GROUND[kind].name as SurfaceName]?.color ?? GROUND[kind].color;
  const meadow = SURFACES["meadow-grass"].color;
  const own = groundColour(kind, x, villageGround(x, z), z);
  const open = occlusion(x, z);
  return [0, 1, 2].map((i) => (surface[i] / meadow[i]) ** 1.5 * own[i] * open) as [
    number,
    number,
    number,
  ];
}

/** A copy's colour: a little lighter or darker, warmer or cooler; a plant's, the ground's it stands on. */
function colourOf(p: VillagePlacement, kind: ModelClass): [number, number, number, number] {
  const [, a, b] = dice(p.x, p.z, 9);
  if (kind === "plant" || kind === "cover") {
    // The ground's brightness, not its hue: the plant keeps its own, greyed by GroundCover.
    const [r, g, bl] = groundTone(p.x, p.z);
    const light = (0.2126 * r + 0.7152 * g + 0.0722 * bl) * (0.8 + 0.4 * a);
    const warm = 0.08 * (b * 2 - 1);
    // The cover's alpha is a hair under 1, which tells GroundCover how far it reaches.
    return [light * (1 + warm), light, light * (1 - warm), kind === "cover" ? 0.99 : 1];
  }
  const k = kind === "building" ? 0.4 : kind === "prop" ? 0.6 : 1;
  const light = 1 + k * 0.18 * (a * 2 - 1);
  const warm = k * 0.06 * (b * 2 - 1);
  return [light * (1 + warm), light, light * (1 - warm * 1.3), 1];
}

/**
 * The dense ground cover: small tufts on a jittered grid over the walkable valley and a little way up
 * its sides, thick in patches and along edges, thin in worn yards, none on the track (but its crown),
 * in the river or under anything solid. Seeded by place, so every screen lays the same.
 */
function coverPlacements(): VillagePlacement[] {
  const layout = village(VILLAGE_SEED);
  const CELL = 8;
  const solids = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }[]>();
  for (const box of layout.boxes) {
    // The long boxes round the valley's edges keep players in; the cover runs on under them.
    if ((box.maxX - box.minX) * (box.maxZ - box.minZ) > 400) continue;
    for (let i = Math.floor(box.minX / CELL); i <= Math.floor(box.maxX / CELL); i++) {
      for (let j = Math.floor(box.minZ / CELL); j <= Math.floor(box.maxZ / CELL); j++) {
        const key = `${i}:${j}`;
        const list = solids.get(key);
        if (list) list.push(box);
        else solids.set(key, [box]);
      }
    }
  }
  const blocked = (x: number, z: number) =>
    (solids.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`) ?? []).some(
      (b) => x > b.minX - 0.1 && x < b.maxX + 0.1 && z > b.minZ - 0.1 && z < b.maxZ + 0.1,
    ) ||
    layout.bridges.some((b) => x > b.minX && x < b.maxX && z > b.minZ - 0.3 && z < b.maxZ + 0.3);
  const worn = (x: number, z: number) =>
    layout.yards.some((y) => x > y.minX && x < y.maxX && z > y.minZ && z < y.maxZ);
  const step = 1 / Math.sqrt(Math.max(COVER.density, 0.01));
  const placements: VillagePlacement[] = [];
  for (let z = -142; z < 136; z += step) {
    for (let x = -80; x < 100; x += step) {
      const [jx, jz, roll] = dice(x, z, 77);
      const px = x + (jx - 0.5) * step;
      const pz = z + (jz - 0.5) * step;
      const out = outside(px, pz);
      if (out > 14) continue;
      if (inChannel(px, pz) && !(roll < 0.15)) continue;
      const fromRoad = Math.abs(px - roadX(pz));
      const onTrack = pz < 94 ? fromRoad < ROAD_HALF - 0.1 : Math.abs(px) < 2.6 && pz < 112;
      // The track's crown keeps a line of grass.
      if (onTrack && !(pz < 94 && fromRoad < 0.3 && roll < 0.5)) continue;
      const patch = fbm(px / 7, pz / 7, 3, 81);
      const edge = fromRoad < ROAD_HALF + 1.5 || out > -3 ? 0.35 : 0;
      let density = Math.min(1, 0.25 + 1.1 * Math.max(0, patch - 0.35) + edge);
      if (worn(px, pz)) density *= 0.25;
      if (out > 0) density *= 1 - out / 14;
      if (roll > density) continue;
      if (blocked(px, pz)) continue;
      const [kindRoll, turn] = dice(px, pz, 79);
      const model: VillageModel =
        out > -5 && kindRoll < 0.35 ? (kindRoll < 0.2 ? "heather" : "fern") : "grass-tuft";
      placements.push({
        model,
        x: px,
        y: villageGround(px, pz) - 0.04,
        z: pz,
        turn: turn * Math.PI * 2,
      });
    }
  }
  return placements;
}

/** A new mesh drawing what `source` draws, with its own thin instances, over the same vertex buffers. */
function sharing(source: Mesh, name: string, scene: Scene): Mesh {
  const mesh = new Mesh(name, scene);
  const from = source.geometry as Geometry;
  const geometry = new Geometry(Geometry.RandomId(), scene);
  const vertices = from.getTotalVertices();
  for (const kind of from.getVerticesDataKinds()) {
    const buffer = from.getVertexBuffer(kind);
    if (buffer && !buffer.getIsInstanced()) geometry.setVerticesBuffer(buffer, vertices, false);
  }
  const indices = from.getIndices(false);
  if (indices) geometry.setIndices(indices, vertices);
  geometry.applyToMesh(mesh);
  mesh.material = source.material;
  mesh.parent = source.parent;
  return mesh;
}

interface Chunk {
  meshes: Mesh[];
  /** Its stand-ins, drawn instead further off than `REACH.treeDetail`, for models that have them. */
  far: Mesh[];
  kind: ModelClass;
  /** The chunk's extent on the ground, for its distance from the camera. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  state: "near" | "far" | "hidden";
}

/** What the console can ask of the village. */
export interface VillageView {
  stats(): { model: string; copies: number; chunks: number; missing: boolean }[];
  /**
   * A flashlight on the active camera, shaped as a held one's beam, to see the village by without
   * walking there: for the lobby camera, which can be put anywhere.
   */
  torch(on: boolean): void;
}

let torchBeam: SpotLight | undefined;

function torch(scene: Scene, on: boolean) {
  const camera = scene.activeCamera;
  if (!camera) return;
  if (!torchBeam) {
    torchBeam = new SpotLight(
      "village-torch",
      new Vector3(0.25, -0.2, 0.3),
      Vector3.Forward(),
      1.07,
      2,
      scene,
    );
    torchBeam.falloffType = Light.FALLOFF_GLTF;
    torchBeam.innerAngle = 0.25;
    torchBeam.range = 45;
    torchBeam.diffuse = new Color3(1, 0.92, 0.78);
    torchBeam.specular = torchBeam.diffuse;
    torchBeam.renderPriority = LIGHT_PRIORITY.own;
  }
  torchBeam.parent = camera;
  torchBeam.intensity = on ? 220 : 0;
}

let view: VillageView | undefined;

/** Draws every model in the village, chunk by chunk, from its file or its stand-in. */
async function addModels(world: World): Promise<void> {
  const { scene } = world;
  const byModel = new Map<VillageModel, VillagePlacement[]>();
  for (const p of village(VILLAGE_SEED).placements) {
    let list = byModel.get(p.model);
    if (!list) {
      list = [];
      byModel.set(p.model, list);
    }
    list.push(p);
  }
  const chunks: Chunk[] = [];
  const casters: Mesh[] = [];
  const stats: ReturnType<VillageView["stats"]> = [];
  view = { stats: () => stats, torch: (on) => torch(scene, on) };
  const material = surfaceMaterial("village-placeholder", scene, new Color3(1, 1, 1), {
    roughness: 0.9,
  });
  material.backFaceCulling = false;

  const draw = (
    model: VillageModel,
    copies: VillagePlacement[],
    sources: Mesh[],
    gltf: boolean,
    root?: TransformNode,
    farSource?: Mesh,
    kind = CLASS[model],
  ): Mesh[] => {
    const made: Mesh[] = [];
    const size = CHUNK[kind];
    const groups = new Map<string, VillagePlacement[]>();
    for (const p of copies) {
      const key = `${Math.floor(p.x / size)}:${Math.floor(p.z / size)}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(p);
    }
    const [w, d, h] = VILLAGE_MODELS[model];
    const radius = Math.max(w, d, h) * 0.75;
    for (const source of sources) {
      // Parts are drawn under the root, so a node transform of their own would come after the
      // instance's: bake it in.
      if (root) {
        const local = source
          .computeWorldMatrix(true)
          .multiply(Matrix.Invert(root.getWorldMatrix()));
        if (!local.isIdentity()) {
          source.parent = null;
          source.bakeTransformIntoVertices(local);
          source.parent = root;
          source.position.setAll(0);
          source.rotationQuaternion = null;
          source.rotation.setAll(0);
          source.scaling.setAll(1);
        }
      }
    }
    let first = true;
    for (const [key, group] of groups) {
      const chunk: Chunk = {
        meshes: [],
        far: [],
        kind,
        minX: Math.min(...group.map((p) => p.x)) - radius,
        maxX: Math.max(...group.map((p) => p.x)) + radius,
        minZ: Math.min(...group.map((p) => p.z)) - radius,
        maxZ: Math.max(...group.map((p) => p.z)) + radius,
        state: "near",
      };
      const matrices = new Float32Array(group.length * 16);
      const colours = new Float32Array(group.length * 4);
      for (const [i, p] of group.entries()) {
        matrices.set(matrixOf(p, scaleOf(p, kind), gltf), i * 16);
        colours.set(colourOf(p, kind), i * 4);
      }
      for (const source of sources) {
        // The cover draws what the plants already do: it never takes over their sources.
        const mesh =
          first && kind !== "cover"
            ? source
            : sharing(source, `${source.name}-${kind}-${key}`, scene);
        made.push(mesh);
        mesh.isPickable = false;
        mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
        mesh.thinInstanceSetBuffer("previousMatrix", matrices, 16, true);
        mesh.thinInstanceSetBuffer("color", colours, 4, true);
        // Under the glTF root, which flips x: its world matrix must be in place before the
        // bounds are worked out, or culling looks for the chunk on the other side of the valley.
        mesh.computeWorldMatrix(true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.freezeWorldMatrix();
        chunk.meshes.push(mesh);
        // Everything but the plants casts the moon's soft shadows (scene.ts). Only the ground takes
        // them: the shadow's varyings would take a two-sided, detail-mapped material past the 16
        // WebGPU allows, and on the models their baked occlusion does the work.
        if (kind !== "plant" && kind !== "cover") casters.push(mesh);
      }
      if (farSource) {
        const far = sharing(farSource, `${farSource.name}-${key}`, scene);
        const plain = new Float32Array(group.length * 16);
        for (const [i, p] of group.entries())
          plain.set(matrixOf(p, scaleOf(p, kind), false), i * 16);
        far.isPickable = false;
        far.thinInstanceSetBuffer("matrix", plain, 16, true);
        far.thinInstanceSetBuffer("previousMatrix", plain, 16, true);
        far.thinInstanceSetBuffer("color", colours, 4, true);
        far.computeWorldMatrix(true);
        far.thinInstanceRefreshBoundingInfo(false);
        far.freezeWorldMatrix();
        far.isVisible = false;
        chunk.far.push(far);
      }
      first = false;
      chunks.push(chunk);
    }
    stats.push({
      model: kind === "cover" ? `${model} (cover)` : model,
      copies: copies.length,
      chunks: groups.size,
      missing: !gltf,
    });
    return made;
  };

  const cover = new Map<VillageModel, VillagePlacement[]>();
  for (const p of coverPlacements()) {
    const list = cover.get(p.model);
    if (list) list.push(p);
    else cover.set(p.model, [p]);
  }
  /** A plant's look, the same for the layout's and the cover's, which differ only in reach. */
  const lookOf = (model: VillageModel): GroundCoverLook => {
    const look: GroundCoverLook = {
      tint: [1, 1, 1],
      saturation: 1,
      base: 1,
      up: 0,
      reach: 0,
      coverReach: 0,
    };
    const update = () => {
      const bright =
        model === "heather" ? COVER.heather : model === "fern" ? COVER.fern : COVER.grass;
      // Towards the meadow's olive: dead grass by night reads as the ground it grows from.
      const hue =
        model === "heather" ? [1, 0.88, 0.92] : model === "fern" ? [1, 0.92, 0.7] : [0.88, 1, 0.7];
      look.tint = [bright * hue[0], bright * hue[1], bright * hue[2]];
      look.saturation = COVER.saturation;
      look.base = COVER.base;
      look.up = COVER.up;
      look.reach = REACH.plants;
      look.coverReach = COVER.reach;
    };
    update();
    coverLooks.push(update);
    return look;
  };

  await Promise.all(
    [...byModel].map(async ([model, copies]) => {
      // Not shrunk into an atlas: the bakes are seen up close.
      const path = `models/village/${model}.glb`;
      const container = await loadModel(scene, path, { shrink: false }).catch((err) => {
        console.warn(`Could not load models/village/${model}.glb`, err);
        return undefined;
      });
      if (container) {
        container.addAllToScene();
        keepFoliage(container.materials);
        addDetail(scene, container.meshes, model);
        const root = container.rootNodes[0] as TransformNode | undefined;
        root?.computeWorldMatrix(true);
        const sources = container.meshes.filter(
          (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0,
        );
        // Trees far off are drawn as their stand-ins: the fog has most of them by then.
        let far: Mesh | undefined;
        if (CLASS[model] === "tree") {
          far = placeholder(scene, model);
          far.material = material;
          far.isVisible = false;
        }
        draw(model, copies, sources, true, root, far);
        if (CLASS[model] === "plant") {
          const look = lookOf(model);
          for (const m of container.materials) {
            if (!(m instanceof PBRMaterial)) continue;
            new GroundCover(m, VILLAGE_MODELS[model][2], look);
            // Dry blades scatter light, they don't mirror it: at a glance along the cards the sky's
            // reflection otherwise lights them up pale against the ground.
            m.metallicF0Factor = 0.2;
          }
          draw(model, cover.get(model) ?? [], sources, true, root, undefined, "cover");
        }
      } else {
        const mesh = placeholder(scene, model);
        mesh.material = material;
        draw(model, copies, [mesh], false);
      }
    }),
  );

  const castShadows = (on: boolean) => {
    for (const mesh of casters) {
      if (on) world.shadows.addShadowCaster(mesh, false);
      else world.shadows.removeShadowCaster(mesh, false);
    }
  };
  castShadows(REACH.shadows);
  setShadows = castShadows;
  // The shadow map only reaches so far round the camera (scene.ts): models beyond it aren't drawn
  // into it, which would cost a draw each for nothing.
  const ours = new Set<AbstractMesh>(casters);
  const sun = world.shadows.getLight();
  const near: AbstractMesh[] = [];
  const map = world.shadows.getShadowMap();
  if (map)
    map.getCustomRenderList = (_layer, list, length) => {
      near.length = 0;
      const camera = scene.activeCamera;
      if (!list || !camera) return null;
      const { x, z } = camera.globalPosition;
      const reach = (sun as DirectionalLight).shadowFrustumSize * 0.7 || Number.POSITIVE_INFINITY;
      for (let i = 0; i < length; i++) {
        const mesh = list[i];
        if (ours.has(mesh)) {
          if (!mesh.isVisible) continue;
          const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
          const dx = Math.max(min.x - x, 0, x - max.x);
          const dz = Math.max(min.z - z, 0, z - max.z);
          if (dx * dx + dz * dz > reach * reach) continue;
        }
        near.push(mesh);
      }
      return near;
    };

  // Chunks too far away to see through the fog aren't drawn.
  scene.onBeforeRenderObservable.add(() => {
    const camera = scene.activeCamera;
    if (!camera) return;
    const { x, z } = camera.globalPosition;
    for (const chunk of chunks) {
      const reach = reachOf(chunk.kind);
      const dx = Math.max(chunk.minX - x, 0, x - chunk.maxX);
      const dz = Math.max(chunk.minZ - z, 0, z - chunk.maxZ);
      const distance = Math.hypot(dx, dz);
      const state =
        distance >= reach
          ? "hidden"
          : chunk.far.length > 0 && distance >= REACH.treeDetail
            ? "far"
            : "near";
      if (state === chunk.state) continue;
      chunk.state = state;
      for (const mesh of chunk.meshes) mesh.isVisible = state === "near";
      for (const mesh of chunk.far) mesh.isVisible = state === "far";
    }
  });
}

/**
 * Mountains beyond the valley, seen down it: ridges in rings far out, unlit and unfogged, a shade
 * darker than the haze, the nearer darker still.
 */
function addMountains(scene: Scene, haze: Color3) {
  const rings = [
    { radius: 2350, low: 350, high: 950, shade: 0.9, salt: 3 },
    { radius: 1900, low: 250, high: 700, shade: 0.78, salt: 5 },
  ];
  for (const { radius, low, high, shade, salt } of rings) {
    const segments = 256;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const ridge = fbm(Math.cos(angle) * 4 + 10, Math.sin(angle) * 4 + 10, 5, salt);
      const peak = low + (high - low) * Math.min(1, Math.max(0, (ridge - 0.3) / 0.45)) ** 1.5;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      positions.push(x, -300, z, x, peak, z);
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    const mesh = new Mesh("village-mountains", scene);
    data.applyToMesh(mesh);
    const material = new StandardMaterial("village-mountains", scene);
    material.disableLighting = true;
    material.emissiveColor = haze.scale(shade);
    material.backFaceCulling = false;
    material.freeze();
    mesh.material = material;
    mesh.applyFog = false;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
  }
}

/**
 * Mist lying in the valley (heightFog.ts): thick over the river and meadows, thinning up the sides,
 * so buildings stand out against the slopes behind them and the ridges stand clear of the sky.
 */
const MIST_COLOUR = new Color3(52 / 255, 58 / 255, 70 / 255);
const mist: HeightFogLook = {
  color: MIST_COLOUR.clone(),
  density: 0,
  falloff: 1,
  floor: 0,
  most: 0,
};
const MIST = tunables(
  "Rendering/Village mist",
  {
    density: {
      value: 0.022,
      min: 0,
      max: 0.15,
      step: 0.001,
      hint: "How thick it is at the valley floor, per meter",
    },
    falloff: { value: 7, min: 1, max: 60, hint: "Meters up over which it thins to a third" },
    floor: { value: 0.5, min: -10, max: 20, hint: "The height it's thickest at" },
    most: { value: 0.9, min: 0, max: 1, hint: "The most of anything it can hide" },
    brightness: { value: 1, min: 0, max: 3, hint: "Its colour's brightness" },
  },
  (values) => setMist(values),
);
function setMist(values: typeof MIST) {
  mist.color = MIST_COLOUR.scale(values.brightness);
  mist.density = values.density;
  mist.falloff = values.falloff;
  mist.floor = values.floor;
  mist.most = values.most;
}
setMist(MIST);

/**
 * The village's own grade over the game's (graphics.ts): night takes the colour out of things, so
 * painted walls and autumn leaves read by value, not as flat colour.
 */
const PICTURE = tunables(
  "Rendering/Village picture",
  {
    exposure: { value: 1, min: 0.1, max: 3 },
    contrast: { value: 1.15, min: 0.5, max: 2.5 },
    saturation: { value: -35, min: -100, max: 100, step: 1, hint: "Over the whole picture" },
    shadowsSaturation: { value: -35, min: -100, max: 100, step: 1 },
    shadowsDensity: { value: 60, min: 0, max: 100, step: 1, hint: "How blue-grey the dark is" },
  },
  () => regrade(),
);

/** The village's valley round the level: everything in it that's drawn. Settles once its models have loaded. */
export async function addVillage(world: World): Promise<void> {
  const { scene } = world;
  addGround(scene);
  const layout = village(VILLAGE_SEED);
  const church = layout.placements.find((p) => p.model === "stave-church");
  addTrack(scene, church ? church.z - VILLAGE_MODELS["stave-church"][1] / 2 : 110);
  addWater(scene);
  addBridges(scene);
  addMountains(scene, scene.fogColor);
  addHeightFog(scene, mist);
  overrideGrade(() => ({
    exposure: PICTURE.exposure,
    contrast: PICTURE.contrast,
    globalSaturation: PICTURE.saturation,
    shadowsSaturation: PICTURE.shadowsSaturation,
    shadowsDensity: PICTURE.shadowsDensity,
  }));
  await addModels(world);
  if (import.meta.env.DEV) Object.assign(window, { __village: view });
}

/** The ambience: wind across the valley, heard everywhere, and the river where it runs. */
const AMBIENCE = tunables(
  "Sound/Village",
  {
    wind: { value: 0.7, min: 0, max: 2, hint: "Wind, heard everywhere" },
    river: { value: 0.6, min: 0, max: 3, hint: "The river, from along its banks" },
  },
  ({ wind, river }) => {
    if (sounds.wind) sounds.wind.volume = wind;
    for (const loop of sounds.river) loop.volume = river;
  },
);
const sounds: { wind?: Loop; river: Loop[] } = { river: [] };

export async function addVillageAmbience(world: World): Promise<void> {
  const { scene } = world;
  const wind = await Loop.play(scene, "audio/sfx/valley-wind.ogg", { volume: AMBIENCE.wind });
  sounds.wind = wind;
  // The river, every so often along it, each starting at a different point in the loop.
  const loops = await Promise.all(
    [-110, -60, -10, 40, 90].map((z, i) => {
      const x = (channel(z).a + channel(z).b) / 2;
      return Loop.play(scene, "audio/sfx/river-flow.ogg", {
        at: new Vector3(x, waterLevel(z), z),
        volume: AMBIENCE.river,
        falloff: { near: 6, far: 45, rolloff: 1.2 },
        phase: i * 0.37,
      });
    }),
  );
  sounds.river = loops.filter((loop): loop is Loop => loop !== undefined);
}
