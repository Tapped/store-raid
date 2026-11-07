/**
 * Works out where players can walk in the harbour, and what stops them, from the harbour's model
 * (assets/models/level/harbour.glb and its layout, harbour.json), and writes it to
 * shared/harbour.json for the harbour level (shared/level.ts).
 *
 *   pnpm run harbour [preview.png]
 *
 * It looks straight down at every copy of every model on a grid of CELL meters. Paving, roads,
 * kerbs and the sea wall are ground: the highest one in a cell is its floor. Anything else that
 * reaches from above a step to below a head is in the way. Cells of the same height are joined
 * into as few rectangles as it can, as floors and boxes. Run it again after the harbour changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { EXTTextureWebP, KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import { PLAYER_HEIGHT, STEP_UP } from "../shared/constants";

const ASSETS = new URL("../../assets/models/level/", import.meta.url);
const OUT = new URL("../shared/harbour.json", import.meta.url);

/** The grid's cell size, in meters. */
const CELL = 0.5;
/** The part of the world it looks at: all of the harbour's ground. */
const AREA = { minX: -60, maxX: 140, minZ: -200, maxZ: 75 };
/** Models that are ground to walk on. */
const GROUND = /^SM_(Ground|Road|SeaWall|ModulFloor|Border|Rails)/;
/** Floors are rounded to this, in meters, so neighbours of nearly one height join up. */
const FLOOR_STEP = 0.05;
/** Box tops are rounded up to this. */
const TOP_STEP = 0.5;
/** Boxes stop this far above the ground at most: higher than anyone jumps or throws. */
const MAX_TOP = 4;
/** The store, its dock and a margin, which the store level's own floor and walls cover. */
const STORE = { minX: -21, maxX: 21, minZ: -21, maxZ: 37 };

const W = Math.round((AREA.maxX - AREA.minX) / CELL);
const H = Math.round((AREA.maxZ - AREA.minZ) / CELL);
const NONE = Number.NEGATIVE_INFINITY;

interface Model {
  name: string;
  /** World positions of each of its copies' triangles' corners, in threes. */
  copies: Float32Array[];
  indices: ArrayLike<number> | undefined;
}

/**
 * Every copy of every model the harbour draws, in the game's world space. The layout holds Unity's
 * matrices, and client/src/harbour.ts draws them under the glTF root's flip of x: in the end a
 * corner (x, y, z) of a mesh lands at the matrix times (-x, y, z).
 */
async function models(): Promise<Model[]> {
  const io = new NodeIO().registerExtensions([...KHRONOS_EXTENSIONS, EXTTextureWebP]);
  const doc = await io.read(fileURLToPath(new URL("harbour.glb", ASSETS)));
  const layout = JSON.parse(readFileSync(new URL("harbour.json", ASSETS), "utf8")) as {
    placements: Record<string, number[]>;
  };
  const found: Model[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName().replace(/_primitive\d+$/, "");
    const matrices = layout.placements[name];
    if (!matrices) continue;
    for (const primitive of mesh.listPrimitives()) {
      const corners = primitive.getAttribute("POSITION")?.getArray();
      if (!corners) continue;
      const copies: Float32Array[] = [];
      for (let k = 0; k < matrices.length; k += 16) {
        const m = matrices.slice(k, k + 16);
        const world = new Float32Array(corners.length);
        for (let v = 0; v < corners.length; v += 3) {
          const [x, y, z] = [-corners[v], corners[v + 1], corners[v + 2]];
          world[v] = m[0] * x + m[4] * y + m[8] * z + m[12];
          world[v + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          world[v + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        copies.push(world);
      }
      found.push({ name, copies, indices: primitive.getIndices()?.getArray() ?? undefined });
    }
  }
  return found;
}

/**
 * Calls `hit` for every cell a triangle covers, with the height it spans there: one height where it
 * lies across the cell's centre, or its whole height where it stands upright over the cell, like a
 * wall seen from above.
 */
function cover(t: number[], hit: (cell: number, low: number, high: number) => void): void {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - AREA.minX) / CELL));
  const i1 = Math.min(W - 1, Math.floor((Math.max(ax, bx, cx) - AREA.minX) / CELL));
  const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - AREA.minZ) / CELL));
  const j1 = Math.min(H - 1, Math.floor((Math.max(az, bz, cz) - AREA.minZ) / CELL));
  const area = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  // Upright, or nearly: seen from above it's a line, so take every cell along it.
  const upright = Math.abs(area) < CELL * CELL * 0.05;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (upright) {
        hit(j * W + i, Math.min(ay, by, cy), Math.max(ay, by, cy));
        continue;
      }
      const px = AREA.minX + (i + 0.5) * CELL;
      const pz = AREA.minZ + (j + 0.5) * CELL;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / area;
      const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / area;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      hit(j * W + i, y, y);
    }
  }
}

function eachTriangle(model: Model, visit: (t: number[]) => void): void {
  for (const world of model.copies) {
    const count = model.indices ? model.indices.length : world.length / 3;
    for (let t = 0; t < count; t += 3) {
      const corners = [0, 1, 2].map((k) => (model.indices ? model.indices[t + k] : t + k) * 3);
      visit(corners.flatMap((c) => [world[c], world[c + 1], world[c + 2]]));
    }
  }
}

/** Joins cells of the same value into rectangles, greedily: as wide as it can, then as deep. */
function rectangles(
  values: Float64Array,
): { i0: number; j0: number; i1: number; j1: number; value: number }[] {
  const used = new Uint8Array(W * H);
  const found = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const value = values[j * W + i];
      if (used[j * W + i] || value === NONE) continue;
      let i1 = i;
      while (i1 + 1 < W && !used[j * W + i1 + 1] && values[j * W + i1 + 1] === value) i1++;
      let j1 = j;
      const rowMatches = (row: number) => {
        for (let k = i; k <= i1; k++)
          if (used[row * W + k] || values[row * W + k] !== value) return false;
        return true;
      };
      while (j1 + 1 < H && rowMatches(j1 + 1)) j1++;
      for (let row = j; row <= j1; row++) for (let k = i; k <= i1; k++) used[row * W + k] = 1;
      found.push({ i0: i, j0: j, i1, j1, value });
    }
  }
  return found;
}

const round = (value: number) => Math.round(value * 100) / 100;
const x = (i: number) => round(AREA.minX + i * CELL);
const z = (j: number) => round(AREA.minZ + j * CELL);
const inStore = (cell: number) => {
  const cx = AREA.minX + ((cell % W) + 0.5) * CELL;
  const cz = AREA.minZ + (Math.floor(cell / W) + 0.5) * CELL;
  return cx > STORE.minX && cx < STORE.maxX && cz > STORE.minZ && cz < STORE.maxZ;
};

const all = await models();

// The ground: the highest piece of paving, road, kerb or sea wall in each cell.
const ground = new Float64Array(W * H).fill(NONE);
for (const model of all.filter((m) => GROUND.test(m.name))) {
  eachTriangle(model, (t) =>
    cover(t, (cell, _low, high) => {
      if (high > ground[cell]) ground[cell] = high;
    }),
  );
}
for (let cell = 0; cell < W * H; cell++) {
  if (ground[cell] !== NONE)
    ground[cell] = round(Math.round(ground[cell] / FLOOR_STEP) * FLOOR_STEP);
  if (inStore(cell)) ground[cell] = NONE;
}

// What's in the way: anything else reaching from above a step to below a head over the ground,
// and how high it goes. Over the water, measured from the harbour's usual ground.
const top = new Float64Array(W * H).fill(NONE);
for (const model of all.filter((m) => !GROUND.test(m.name))) {
  eachTriangle(model, (t) =>
    cover(t, (cell, low, high) => {
      const floor = ground[cell] === NONE ? 0.5 : ground[cell];
      if (high <= floor + STEP_UP || low >= floor + PLAYER_HEIGHT) return;
      top[cell] = Math.max(top[cell], Math.min(high, floor + MAX_TOP));
    }),
  );
}
for (let cell = 0; cell < W * H; cell++) {
  if (top[cell] === NONE) continue;
  const floor = ground[cell] === NONE ? 0.5 : ground[cell];
  top[cell] = inStore(cell)
    ? NONE
    : round(floor + Math.ceil((top[cell] - floor) / TOP_STEP) * TOP_STEP);
}

// Boxes stand on the ground under them, so cells of one top and one ground join up.
const boxKey = new Float64Array(W * H).fill(NONE);
for (let cell = 0; cell < W * H; cell++) {
  if (top[cell] !== NONE)
    boxKey[cell] = top[cell] * 1000 + (ground[cell] === NONE ? 0.5 : ground[cell]);
}
const floors = rectangles(ground).map((r) => [x(r.i0), z(r.j0), x(r.i1 + 1), z(r.j1 + 1), r.value]);
const boxes = rectangles(boxKey).map((r) => {
  const floor = ground[r.j0 * W + r.i0] === NONE ? 0.5 : ground[r.j0 * W + r.i0];
  const high = top[r.j0 * W + r.i0];
  return [x(r.i0), z(r.j0), x(r.i1 + 1), z(r.j1 + 1), floor, round(high - floor)];
});

// One rectangle to a line, as Biome formats it.
const list = (rows: number[][]) => rows.map((row) => `    [${row.join(", ")}]`).join(",\n");
writeFileSync(
  OUT,
  `{\n  "floors": [\n${list(floors)}\n  ],\n  "boxes": [\n${list(boxes)}\n  ]\n}\n`,
);
console.log(`${floors.length} floors and ${boxes.length} boxes in shared/harbour.json`);

// A picture from above, north up: the ground in greys, deeper water blue, what's in the way red.
const preview = process.argv[2];
if (preview) {
  const pixels = Buffer.alloc(W * H * 3);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const cell = j * W + i;
      const out = ((H - 1 - j) * W + i) * 3;
      const g = ground[cell];
      const grey = g === NONE ? 0 : Math.max(0, Math.min(255, 60 + g * 150));
      pixels.set(g === NONE ? [10, 30, 60] : [grey, grey, grey], out);
      if (top[cell] !== NONE) pixels.set([255, Math.min(255, (top[cell] - g) * 60), 0], out);
    }
  }
  await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
    .resize(W * 2, H * 2, { kernel: "nearest" })
    .png()
    .toFile(preview);
  console.log(`Preview in ${preview}`);
}
