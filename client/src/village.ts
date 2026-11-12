import {
  Color3,
  DynamicTexture,
  Geometry,
  type Material,
  MaterialPluginBase,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  ShaderLanguage,
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
import { surfaceMaterial } from "./graphics";
import { loadModel } from "./propAtlas";
import type { World } from "./scene";
import { SURFACES, type SurfaceName, surface } from "./surfaces";
import { worldBox } from "./terrain";
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

/** How far away each kind of thing is still drawn, in meters: the fog has taken it by then. */
const REACH = tunables("Rendering/Village", {
  plants: { value: 70, min: 10, max: 300, step: 5, hint: "Grass, heather and ferns" },
  props: { value: 200, min: 20, max: 600, step: 10, hint: "Fences, walls, carts, poles" },
  rocks: { value: 300, min: 20, max: 800, step: 10, hint: "Boulders and outcrops" },
  trees: { value: 380, min: 50, max: 1000, step: 10 },
  treeDetail: {
    value: 160,
    min: 0,
    max: 1000,
    step: 10,
    hint: "Trees further off than this are drawn as rough stand-ins",
  },
});

type ModelClass = "building" | "prop" | "tree" | "rock" | "plant";

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
};

const reachOf = (kind: ModelClass) =>
  kind === "plant"
    ? REACH.plants
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
      step = Math.min(step * 1.22, 30);
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
      colours.push(...groundColour(kind, x, y, z), 1);
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

/** The track: a strip of gravel laid on the ground, from beyond the valley's south end up to the church. */
function addTrack(scene: Scene, churchFront: number) {
  const { material, tile } = groundSurface(scene, "track");
  material.zOffset = -2;
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
      const light = (Math.abs(t) > 0.9 ? 0.72 : t === 0 ? 0.8 : 1) * (0.85 + 0.3 * fine);
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
    super(material, "FoliageCutout", 195);
    this._enable(true);
  }

  override getClassName(): string {
    return "FoliageCutout";
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
  if (kind === "rock") return outside(p.x, p.z) > 0 ? 0.8 + 0.6 * roll : 0.85 + 0.15 * roll;
  return 1;
}

/** A copy's colour: a little lighter or darker, warmer or cooler. */
function colourOf(p: VillagePlacement, kind: ModelClass): [number, number, number, number] {
  const [, a, b] = dice(p.x, p.z, 9);
  const k = kind === "building" ? 0.4 : kind === "prop" ? 0.6 : 1;
  const light = 1 + k * 0.18 * (a * 2 - 1);
  const warm = k * 0.06 * (b * 2 - 1);
  return [light * (1 + warm), light, light * (1 - warm * 1.3), 1];
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
}

let view: VillageView | undefined;

/** Draws every model in the village, chunk by chunk, from its file or its stand-in. */
async function addModels(scene: Scene): Promise<void> {
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
  const stats: ReturnType<VillageView["stats"]> = [];
  view = { stats: () => stats };
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
  ) => {
    const kind = CLASS[model];
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
        const mesh = first ? source : sharing(source, `${source.name}-${key}`, scene);
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
    stats.push({ model, copies: copies.length, chunks: groups.size, missing: !gltf });
  };

  await Promise.all(
    [...byModel].map(async ([model, copies]) => {
      const container = await loadModel(scene, `models/village/${model}.glb`).catch((err) => {
        console.warn(`Could not load models/village/${model}.glb`, err);
        return undefined;
      });
      if (container) {
        container.addAllToScene();
        keepFoliage(container.materials);
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
      } else {
        const mesh = placeholder(scene, model);
        mesh.material = material;
        draw(model, copies, [mesh], false);
      }
    }),
  );

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
  await addModels(scene);
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
