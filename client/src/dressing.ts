import {
  type AssetContainer,
  Color3,
  Geometry,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";
import type { Level, LightSpawn, PropSpawn } from "../../shared/level";
import { PROPS, type PropKind, type PropName } from "../../shared/props";
import { STOREY } from "../../shared/tiles";
import { surfaceMaterial } from "./graphics";
import type { InteriorLighting } from "./interiorLight";
import { loadModel } from "./propAtlas";
import type { World } from "./scene";
import { tunables } from "./tuning";
import { roomVisibility } from "./visibility";

/**
 * The dressing: every prop a level stands about (`Level.props`), drawn from its model as thin
 * instances, with the fittings' glow wired to the light they give.
 *
 * Copies of a model are split into chunks, one per room, so that each can be culled on its own: one
 * buffer for all of a model's copies has one bounding box the size of the building and is always
 * drawn. Each chunk's mesh shares its model's vertex buffers. Besides the camera's frustum, rooms
 * out of sight behind walls and floors aren't drawn (visibility.ts): with a few dozen models of a
 * few materials each, every room in view costs a draw call per material of every model in it.
 * Small models (fittings, vents, extinguishers) are chunked by storey instead, where another draw
 * call costs more than drawing a few more of them. Props in no room are chunked by storey and a
 * square of `CHUNK` meters.
 *
 * A model that doesn't exist yet is drawn as a plain box of its catalogue size, standing on its
 * mount, until the next page load finds it.
 */

/** Meters on a side of a chunk, for props in no room. */
const CHUNK = 16;
/** Models of fewer triangles than this are chunked by storey rather than room. */
const SMALL_TRIANGLES = 1500;

/** Copies of a model differ in brightness and hue by this much, at a strength of 1. */
const LOOK = tunables(
  "Look/Dressing",
  {
    variation: {
      value: 1,
      min: 0,
      max: 3,
      hint: "How much copies of a model differ in brightness and hue",
    },
    standby: {
      value: 0.35,
      min: 0,
      max: 1,
      hint: "How brightly glowing things on their own power (a snack machine's window) glow with the lights off",
    },
    cullRooms: {
      value: true,
      hint: "Leave out rooms that can't be seen from the camera, behind walls and floors",
    },
    steadyGlow: {
      value: 2.5,
      min: 0,
      max: 10,
      hint: "How brightly glowing things that aren't light fittings glow",
    },
  },
  (_, key) => {
    if (key === "variation") recolour?.();
  },
);

let recolour: (() => void) | undefined;

/**
 * How much each model's copies vary: paint and timber more, steel less, fittings not at all. The
 * rest vary by `DEFAULT_VARIATION`.
 */
const VARIATION: Partial<Record<PropName, number>> = {
  "container-a": 1.4,
  "container-b": 1.4,
  "container-c": 1.4,
  "crate-large": 1.1,
  "crate-long": 1.1,
  "crate-stack": 0.9,
  "wood-crate": 1.1,
  "wood-box": 1.1,
  cardboard: 1,
  pallet: 1,
  "pallet-stack-a": 0.8,
  "pallet-stack-b": 0.8,
  "big-bag": 0.7,
  "drum-group": 0.9,
  barrel: 0.9,
  "plastic-barrel": 0.6,
  "ceiling-tube": 0,
  "high-bay": 0,
  "emergency-light": 0,
  "exit-sign": 0,
  "duct-vent": 0.2,
  "door-frame": 0.3,
  "cage-panel": 0.2,
};
const DEFAULT_VARIATION = 0.5;

/**
 * Models that look right turned half round, and that nothing needs to face a certain way: their
 * copies are, at random, so that a row of them isn't one copy over and over.
 */
const TURNS_ROUND = new Set<PropName>([
  "crate-large",
  "crate-long",
  "crate-stack",
  "drum-group",
  "big-bag",
  "tyre-stack",
  "cable-reel",
  "barrel",
  "plastic-barrel",
  "wood-crate",
  "wood-box",
  "cardboard",
  "pallet",
  "pallet-stack-a",
  "pallet-stack-b",
  "gas-cylinder",
  "rope-coil",
  "cement-bag",
  "ibc-tank",
]);

/** The fitting each kind of lamp is, and which kind of light it gives. */
const FITTINGS: Partial<Record<PropName, LightSpawn["kind"]>> = {
  "ceiling-tube": "tube",
  "high-bay": "bulb",
  "emergency-light": "emergency",
  "exit-sign": "exit",
};
/** How far from a fitting's origin its light may be, at most: furnish.ts puts it within 0.4 m. */
const FITTING_REACH = 0.6;

/** What the rest of the page can ask of the dressing. */
export interface Dressing {
  /** Settles when every model has loaded, or been found missing. */
  readonly ready: Promise<void>;
  /** For the console: what's drawn, by model. */
  stats(): { model: string; copies: number; chunks: number; meshes: number; missing: boolean }[];
  /** For the console: the rooms in view as of the last frame, or undefined for all of them. */
  visibleRooms(): number[] | undefined;
}

/** A copy of a prop, as drawn. */
interface Copy {
  spawn: PropSpawn;
  /** Its turn, with any half turn for variety. */
  turn: number;
  /** The fitting it is, for lamps: an index into `Level.lights`, or -1. */
  light: number;
  /** 0 to 1, from where it stands: the same on every screen and every load. */
  dice: [number, number, number];
}

/** A small hash of a few numbers to three numbers from 0 to 1. */
function dice(...values: number[]): [number, number, number] {
  let h = 2166136261;
  for (const v of values) {
    h ^= Math.round(v * 1000) | 0;
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

/** Which storey a prop is on: ceiling props hang from the top of theirs. */
function storeyOf(level: Level, spawn: PropSpawn, kind: PropKind): number {
  const room = level.rooms[spawn.room];
  if (room) return room.storey;
  return Math.floor((kind.mount === "ceiling" ? spawn.y - 0.3 : spawn.y + 0.3) / STOREY);
}

/**
 * A matrix for a mesh under a glTF root, which flips x: the model's front (+z) turned `turn` round
 * y, clockwise from above, as `PropSpawn.turn` says, and stood at a point.
 */
function placed(x: number, y: number, z: number, turn: number): number[] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, -x, y, z, 1];
}

/** A copy's colour: a little lighter or darker, warmer or cooler, by its model's variation. */
function colourOf(copy: Copy, strength: number): [number, number, number, number] {
  const k = strength * LOOK.variation;
  const [a, b] = copy.dice;
  const light = 1 + k * 0.16 * (a * 2 - 1);
  const warm = k * 0.05 * (b * 2 - 1);
  return [light * (1 + warm), light, light * (1 - warm * 1.3), 1];
}

/** A new mesh drawing what `source` draws, with its own geometry (thin instances live there) over the same vertex buffers. */
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

/**
 * Draws every prop in the level. Levels without props get nothing. `lighting`, where the level has
 * fittings, drives the lamps' glow; without it they glow steadily.
 */
export function addDressing(world: World, lighting: InteriorLighting | undefined): Dressing {
  const { scene, level } = world;
  const byModel = new Map<PropName, Copy[]>();
  const lightsTaken = new Set<number>();

  for (const spawn of level.props) {
    if (!(spawn.model in PROPS)) continue;
    const model = spawn.model as PropName;
    const roll = dice(spawn.x, spawn.y, spawn.z, model.length);
    const turn = spawn.turn + (TURNS_ROUND.has(model) && roll[2] < 0.5 ? Math.PI : 0);
    let copies = byModel.get(model);
    if (!copies) {
      copies = [];
      byModel.set(model, copies);
    }
    copies.push({ spawn, turn, light: -1, dice: roll });
  }

  // Each lamp's light: the nearest of its kind, which furnish.ts puts within a few centimetres
  // to 0.4 m of the fitting's origin.
  for (const [model, kind] of Object.entries(FITTINGS) as [PropName, LightSpawn["kind"]][]) {
    for (const copy of byModel.get(model) ?? []) {
      let best = -1;
      let bestDistance = FITTING_REACH;
      for (const [i, light] of level.lights.entries()) {
        if (light.kind !== kind || lightsTaken.has(i)) continue;
        const d = Math.hypot(
          light.x - copy.spawn.x,
          light.y - copy.spawn.y,
          light.z - copy.spawn.z,
        );
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      copy.light = best;
      if (best >= 0) lightsTaken.add(best);
    }
  }

  /**
   * Which chunk a copy goes in: its room's, or for a small model its storey's, where a draw call
   * costs more than drawing a few more of it would; for a copy in no room, a square of a storey.
   */
  const chunkOf = (copy: Copy, kind: PropKind, small = false) => {
    const { x, z, room } = copy.spawn;
    if (room >= 0 && level.rooms[room]) {
      return small ? `storey${level.rooms[room].storey}` : `room${room}`;
    }
    return `${storeyOf(level, copy.spawn, kind)}:${Math.floor(x / CHUNK)}:${Math.floor(z / CHUNK)}`;
  };

  /** Every chunk's meshes, by chunk, with whether it was shown last. */
  const chunks = new Map<string, { meshes: Mesh[]; shown: boolean }>();
  const inChunk = (key: string, mesh: Mesh) => {
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { meshes: [], shown: true };
      chunks.set(key, chunk);
    }
    chunk.meshes.push(mesh);
    mesh.isVisible = chunk.shown;
  };

  /** Every mesh with a colour buffer, to colour again when the variation changes. */
  const coloured: { mesh: Mesh; copies: Copy[]; strength: number }[] = [];
  const colour = (mesh: Mesh, copies: Copy[], strength: number) => {
    const data = new Float32Array(copies.length * 4);
    for (const [i, copy] of copies.entries()) data.set(colourOf(copy, strength), i * 4);
    mesh.thinInstanceSetBuffer("color", data, 4, true);
  };
  recolour = () => {
    for (const { mesh, copies, strength } of coloured) colour(mesh, copies, strength);
  };

  const stats: ReturnType<Dressing["stats"]> = [];
  /** Glowing materials that aren't fittings, and the emissive strength each was made with. */
  const steady = new Map<PBRMaterial, number>();

  /** Draws a model's copies, chunk by chunk, from its loaded file. */
  const drawModel = (model: PropName, copies: Copy[], container: AssetContainer) => {
    const kind = PROPS[model];
    container.addAllToScene();
    const root = container.rootNodes[0] as TransformNode | undefined;
    root?.computeWorldMatrix(true);
    const strength = VARIATION[model] ?? DEFAULT_VARIATION;
    const fitting = FITTINGS[model];
    const sources = container.meshes.filter(
      (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0,
    );
    const triangles = sources.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
    const small = triangles < SMALL_TRIANGLES;
    // A lamp's copies with no light of their own are drawn apart, glowing steadily.
    const groups = new Map<string, Copy[]>();
    for (const copy of copies) {
      const key = `${chunkOf(copy, kind, small)}${fitting && copy.light < 0 ? ":unlit" : ""}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(copy);
    }
    let meshes = 0;
    for (const source of sources) {
      // Meshes are drawn under the root, so a node transform of their own would come after the
      // instance's: bake it in. Models made for the game have none.
      const local = source
        .computeWorldMatrix(true)
        .multiply(Matrix.Invert(root?.getWorldMatrix() ?? Matrix.Identity()));
      if (!local.isIdentity()) {
        source.parent = null;
        source.bakeTransformIntoVertices(local);
        source.parent = root ?? null;
        source.position.setAll(0);
        source.rotationQuaternion = null;
        source.rotation.setAll(0);
        source.scaling.setAll(1);
      }
      const material = source.material;
      const glows = material instanceof PBRMaterial && material.name.startsWith("glow");
      // An LED on a lamp is a pilot light, not the lamp.
      const lamp = glows && fitting !== undefined && !material.name.includes("led");
      if (glows && !lamp) steady.set(material, steady.get(material) ?? material.emissiveIntensity);
      let first = true;
      for (const [key, group] of groups) {
        const mesh = first ? source : sharing(source, `${source.name}-${key}`, scene);
        first = false;
        meshes++;
        mesh.isPickable = false;
        const matrices = new Float32Array(group.length * 16);
        for (const [i, copy] of group.entries()) {
          const { x, y, z } = copy.spawn;
          matrices.set(placed(x, y, z, copy.turn), i * 16);
        }
        mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
        mesh.thinInstanceSetBuffer("previousMatrix", matrices, 16, true);
        if (strength > 0) {
          colour(mesh, group, strength);
          coloured.push({ mesh, copies: group, strength });
        }
        // Copies with no light of their own glow as the model was made.
        if (lamp && lighting && group.every((copy) => copy.light >= 0)) {
          lighting.glow(
            mesh,
            group.map((copy) => copy.light),
            { tint: model !== "exit-sign" },
          );
        }
        // Under the glTF root, which flips x: its world matrix must be in place before the bounds
        // are worked out, or culling looks for the chunk mirrored across the building.
        mesh.computeWorldMatrix(true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.freezeWorldMatrix();
        inChunk(key.replace(":unlit", ""), mesh);
      }
    }
    const covered = copies.filter((copy) => copy.light >= 0).map((copy) => copy.light);
    if (covered.length > 0) lighting?.covered(covered);
    stats.push({ model, copies: copies.length, chunks: groups.size, meshes, missing: false });
  };

  /** Plain boxes for every model that isn't there yet: one mesh a chunk, for all of them. */
  const drawMissing = (missing: PropName[]) => {
    if (missing.length === 0) return;
    // Dull and mid-grey, so a box stands in without drawing the eye.
    const material = surfaceMaterial("dressing-placeholder", scene, new Color3(0.22, 0.22, 0.23), {
      roughness: 0.85,
    });
    material.metallic = 0;
    const box = MeshBuilder.CreateBox("dressing-placeholder", { size: 1 }, scene);
    box.material = material;
    box.isPickable = false;
    const boxes = new Map<string, { matrices: number[]; copies: Copy[] }>();
    for (const model of missing) {
      const kind = PROPS[model];
      const [w, h, d] = kind.size;
      // Where the box's middle is from the model's origin, before it's turned.
      const up = kind.mount === "ceiling" ? -h / 2 : h / 2;
      const out = kind.mount === "wall" ? d / 2 : 0;
      for (const copy of byModel.get(model) ?? []) {
        const key = chunkOf(copy, kind);
        let chunk = boxes.get(key);
        if (!chunk) {
          chunk = { matrices: [], copies: [] };
          boxes.set(key, chunk);
        }
        const { x, y, z } = copy.spawn;
        const matrix = Matrix.Scaling(w, h, d)
          .multiply(Matrix.Translation(0, up, out))
          .multiply(Matrix.RotationY(copy.turn))
          .multiply(Matrix.Translation(x, y, z));
        chunk.matrices.push(...matrix.asArray());
        chunk.copies.push(copy);
      }
      stats.push({
        model,
        copies: byModel.get(model)?.length ?? 0,
        chunks: 0,
        meshes: 0,
        missing: true,
      });
    }
    let first = true;
    for (const [key, chunk] of boxes) {
      const mesh = first ? box : sharing(box, `dressing-placeholder-${key}`, scene);
      first = false;
      const matrices = Float32Array.from(chunk.matrices);
      mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
      mesh.thinInstanceSetBuffer("previousMatrix", matrices, 16, true);
      colour(mesh, chunk.copies, 1.5);
      coloured.push({ mesh, copies: chunk.copies, strength: 1.5 });
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.doNotSyncBoundingInfo = true;
      mesh.freezeWorldMatrix();
      inChunk(key, mesh);
    }
  };

  // Rooms out of sight aren't drawn.
  const visibility = roomVisibility(level);
  let lastVisible: ReadonlySet<number> | undefined;
  scene.onBeforeRenderObservable.add(() => {
    const camera = scene.activeCamera;
    if (!camera) return;
    const visible = LOOK.cullRooms ? visibility?.visible(camera) : undefined;
    lastVisible = visible;
    const storeys = new Set(visible ? [...visible].map((room) => level.rooms[room]?.storey) : []);
    for (const [key, chunk] of chunks) {
      const show =
        !visible ||
        (key.startsWith("room")
          ? visible.has(Number(key.slice(4)))
          : key.startsWith("storey")
            ? storeys.has(Number(key.slice(6)))
            : true);
      if (chunk.shown === show) continue;
      chunk.shown = show;
      for (const mesh of chunk.meshes) mesh.isVisible = show;
    }
  });

  // Steady glows follow the room's light a little: on their own power, but dimmer with the
  // lights out, as the eye sees them.
  let steadyScale = Number.NaN;
  scene.onBeforeRenderObservable.add(() => {
    const level = lighting?.level() ?? 1;
    const scale = LOOK.steadyGlow * (LOOK.standby + (1 - LOOK.standby) * level);
    // Only on a change: setting it marks the material's meshes dirty.
    if (scale === steadyScale) return;
    steadyScale = scale;
    for (const [material, base] of steady) material.emissiveIntensity = base * scale;
  });

  const load = async (model: PropName) => {
    const path = `models/props/${model}.glb`;
    try {
      const container = await loadModel(scene, path);
      if (!container) return false;
      drawModel(model, byModel.get(model) ?? [], container);
      return true;
    } catch (err) {
      console.warn(`Could not load ${path}`, err);
      return false;
    }
  };

  /**
   * Bulbs with no fitting of their own, as staff rooms and plant rooms have: a shade on a flex
   * from the ceiling, round the lighting's glowing bulb.
   */
  const drawPendants = () => {
    const bulbs = level.lights.filter((light, i) => light.kind === "bulb" && !lightsTaken.has(i));
    if (bulbs.length === 0) return;
    const flex = MeshBuilder.CreateCylinder(
      "pendant-flex",
      { diameter: 0.012, height: 0.26, tessellation: 6 },
      scene,
    );
    flex.position.y = 0.17;
    const shade = MeshBuilder.CreateCylinder(
      "pendant-shade",
      {
        diameterTop: 0.07,
        diameterBottom: 0.34,
        height: 0.15,
        tessellation: 20,
        cap: Mesh.CAP_START,
      },
      scene,
    );
    shade.position.y = 0.03;
    const pendant = Mesh.MergeMeshes([flex, shade], true) as Mesh;
    pendant.name = "dressing-pendant";
    pendant.material = surfaceMaterial("dressing-pendant", scene, new Color3(0.16, 0.22, 0.19), {
      roughness: 0.45,
      metallic: 0.4,
    });
    pendant.material.backFaceCulling = false;
    pendant.isPickable = false;
    const matrices = new Float32Array(bulbs.length * 16);
    for (const [i, light] of bulbs.entries()) {
      Matrix.Translation(light.x, light.y, light.z).copyToArray(matrices, i * 16);
    }
    pendant.thinInstanceSetBuffer("matrix", matrices, 16, true);
    pendant.thinInstanceSetBuffer("previousMatrix", matrices, 16, true);
    pendant.thinInstanceRefreshBoundingInfo(false);
    pendant.freezeWorldMatrix();
  };
  drawPendants();

  const ready = (async () => {
    const models = [...byModel.keys()];
    const found = await Promise.all(models.map(load));
    drawMissing(models.filter((_, i) => !found[i]));
    // The plain boxes the scene stands in for racking and shelving with: every one of them is a
    // prop's, drawn now by its model or its placeholder.
    for (const mesh of world.plainShelves) mesh.dispose();
    world.plainShelves.length = 0;
  })();

  return {
    ready,
    stats: () => stats,
    visibleRooms: () => (lastVisible ? [...lastVisible].sort((a, b) => a - b) : undefined),
  };
}
