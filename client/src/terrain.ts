import {
  Color3,
  Mesh,
  MeshBuilder,
  type PBRMaterial,
  type Scene,
  type ShadowGenerator,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import {
  type Floor,
  floorHeight,
  type Ladder,
  type Level,
  type LevelBox,
} from "../../shared/level";
import { LADDER_WALL, LADDER_WIDTH, OFFSET } from "../../shared/tiles";
import { surfaceMaterial } from "./graphics";

/** Meters that one repeat of a surface texture covers, on floors and walls. */
export const SURFACE_TILE = 6;
/** Stairs are drawn with this many steps, each going up STOREY / STEPS. */
const STEPS = 16;
const HANDRAIL_RADIUS = 0.025;
const POST = 0.04;
const POST_SPACING = 1.2;

/**
 * A box from `min` to `max` with texture coordinates in world space, in `tile`s: boxes side by side
 * carry on the same pattern, so a floor made of cells shows no seams.
 */
export function worldBox(
  name: string,
  min: Vector3,
  max: Vector3,
  scene: Scene,
  tile = SURFACE_TILE,
): Mesh {
  const size = max.subtract(min);
  const box = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene);
  const centre = min.add(max).scale(0.5);
  box.position.copyFrom(centre);
  const positions = box.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const normals = box.getVerticesData(VertexBuffer.NormalKind) ?? [];
  const uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [
      positions[i] + centre.x,
      positions[i + 1] + centre.y,
      positions[i + 2] + centre.z,
    ];
    const [nx, ny] = [Math.abs(normals[i]), Math.abs(normals[i + 1])];
    const [u, v] = ny > 0.5 ? [x, z] : nx > 0.5 ? [z, y] : [x, y];
    uvs.push(u / tile, v / tile);
  }
  box.setVerticesData(VertexBuffer.UVKind, uvs);
  return box;
}

/**
 * The level's floors, planks, stairs, ladders, railings and pits, from shared/level.ts. Walls, shelves
 * and solid tiles are drawn by createWorld.
 */
export function addTerrain(
  scene: Scene,
  level: Level,
  shadows: ShadowGenerator,
  floorMaterial: PBRMaterial,
): void {
  const wood = surfaceMaterial("plank", scene, new Color3(0.42, 0.3, 0.19), { roughness: 0.85 });
  const steel = surfaceMaterial("railing", scene, new Color3(0.55, 0.42, 0.1), {
    roughness: 0.45,
    metallic: 0.6,
  });
  const pitWall = surfaceMaterial("pit", scene, new Color3(0.13, 0.13, 0.14), { roughness: 0.95 });

  const floors: Mesh[] = [];
  const planks: Mesh[] = [];
  const railings: Mesh[] = [];
  for (const [i, floor] of level.floors.entries()) {
    // Ground is drawn by its own model, like the harbour's paving.
    if (floor.kind === "ground") continue;
    if (floor.kind === "stairs") {
      floors.push(...steps(scene, floor, i));
      railings.push(...stairRailings(scene, floor, i));
      continue;
    }
    const box = worldBox(
      `${floor.kind}${i}`,
      new Vector3(floor.minX, floor.y - floor.thickness, floor.minZ),
      new Vector3(floor.maxX, floor.y, floor.maxZ),
      scene,
    );
    (floor.kind === "plank" ? planks : floors).push(box);
  }

  for (const [i, ladder] of level.ladders.entries())
    railings.push(...ladderMeshes(scene, ladder, i));

  const pits: Mesh[] = [];
  for (const [i, box] of level.boxes.entries()) {
    if (box.kind === "rail") railings.push(...railing(scene, box, i));
    // Pit walls stop a hair below the floor on top of them, and stand a little proud of any
    // basement wall in the same place.
    if (box.kind === "pit") {
      pits.push(
        worldBox(
          `pit${i}`,
          new Vector3(box.minX - 0.02, box.y, box.minZ - 0.02),
          new Vector3(box.maxX + 0.02, box.y + box.height - 0.01, box.maxZ + 0.02),
          scene,
        ),
      );
    }
  }

  // One draw each: none of it ever moves.
  for (const [meshes, material, castsShadows] of [
    [floors, floorMaterial, true],
    [planks, wood, true],
    [railings, steel, true],
    [pits, pitWall, false],
  ] as const) {
    if (meshes.length === 0) continue;
    const merged = Mesh.MergeMeshes(meshes as Mesh[], true, true);
    if (!merged) continue;
    merged.material = material;
    merged.receiveShadows = true;
    if (castsShadows) shadows.addShadowCaster(merged);
  }

  // The bottom of the pits: too deep to see, so plain black.
  const bottoms = level.boxes.filter((box) => box.kind === "pit");
  if (bottoms.length > 0) {
    const deepest = Math.min(...bottoms.map((box) => box.y));
    const bottom = MeshBuilder.CreateGround(
      "pit-bottom",
      { width: level.size, height: level.size },
      scene,
    );
    bottom.position.y = deepest;
    const black = new StandardMaterial("pit-bottom", scene);
    black.disableLighting = true;
    black.emissiveColor = Color3.Black();
    bottom.material = black;
  }
}

/** Solid steps up a ramp floor, each from its foot to its tread. */
function steps(scene: Scene, floor: Floor, index: number): Mesh[] {
  const rise = floor.rise;
  if (!rise) return [];
  const meshes: Mesh[] = [];
  for (let i = 0; i < STEPS; i++) {
    const [from, to] = [i / STEPS, (i + 1) / STEPS];
    const part = slice(floor, rise.toward, from, to);
    const top = floor.y + rise.height * to;
    meshes.push(
      worldBox(
        `stairs${index}-${i}`,
        new Vector3(part.minX, floor.y, part.minZ),
        new Vector3(part.maxX, top, part.maxZ),
        scene,
      ),
    );
  }
  return meshes;
}

/** Handrails up both sides of a staircase, on posts, where its "stairs" boxes block. */
function stairRailings(scene: Scene, floor: Floor, index: number): Mesh[] {
  const rise = floor.rise;
  if (!rise) return [];
  const alongZ = rise.toward === "n" || rise.toward === "s";
  const meshes: Mesh[] = [];
  const inset = 0.03;
  const sides = alongZ
    ? [floor.minX + inset, floor.maxX - inset]
    : [floor.minZ + inset, floor.maxZ - inset];
  for (const across of sides) {
    // Foot and top of the rail, at the low and high ends.
    const ends = (alongZ ? [floor.minZ, floor.maxZ] : [floor.minX, floor.maxX]).map((along) => {
      const [x, z] = alongZ ? [across, along] : [along, across];
      return new Vector3(x, floorHeight(floor, x, z) + 1, z);
    });
    meshes.push(
      MeshBuilder.CreateTube(`stair-rail${index}`, { path: ends, radius: HANDRAIL_RADIUS }, scene),
    );
    const count = Math.ceil(Vector3.Distance(ends[0], ends[1]) / POST_SPACING);
    for (let i = 0; i <= count; i++) {
      const top = Vector3.Lerp(ends[0], ends[1], i / count);
      const foot = floorHeight(floor, top.x, top.z);
      meshes.push(post(scene, top.x, foot, top.y, top.z));
    }
  }
  return meshes;
}

/** A handrail along the top of a "rail" box, on posts. */
function railing(scene: Scene, box: LevelBox, index: number): Mesh[] {
  const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
  const top = box.y + box.height;
  const mid = alongX ? (box.minZ + box.maxZ) / 2 : (box.minX + box.maxX) / 2;
  const [start, end] = alongX ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
  const at = (along: number, y: number) =>
    alongX ? new Vector3(along, y, mid) : new Vector3(mid, y, along);
  const meshes = [
    MeshBuilder.CreateTube(
      `rail${index}`,
      { path: [at(start, top), at(end, top)], radius: HANDRAIL_RADIUS },
      scene,
    ),
  ];
  const count = Math.ceil((end - start) / POST_SPACING);
  for (let i = 0; i <= count; i++) {
    const p = at(start + ((end - start) * i) / count, top);
    meshes.push(post(scene, p.x, box.y, top, p.z));
  }
  return meshes;
}

/** A ladder against its wall: two rails, reaching a meter above the top to hold on to, and rungs. */
function ladderMeshes(scene: Scene, ladder: Ladder, index: number): Mesh[] {
  const [dx, dz] = OFFSET[ladder.toward];
  const middle = { x: (ladder.minX + ladder.maxX) / 2, z: (ladder.minZ + ladder.maxZ) / 2 };
  // Out from the wall's face by a hand's width.
  const out = LADDER_WALL + 0.12;
  const along = dx
    ? { x: dx > 0 ? ladder.maxX - out : ladder.minX + out, z: middle.z }
    : { x: middle.x, z: dz > 0 ? ladder.maxZ - out : ladder.minZ + out };
  // Across the ladder, the way its rungs run.
  const [ax, az] = [Math.abs(dz), Math.abs(dx)];
  const meshes: Mesh[] = [];
  const top = ladder.top + 1;
  for (const side of [-1, 1]) {
    const rail = MeshBuilder.CreateBox(
      `ladder${index}-rail`,
      { width: 0.05, depth: 0.05, height: top - ladder.y },
      scene,
    );
    const offset = (side * LADDER_WIDTH) / 2;
    rail.position.set(along.x + ax * offset, (ladder.y + top) / 2, along.z + az * offset);
    meshes.push(rail);
  }
  for (let y = ladder.y + 0.3; y < ladder.top; y += 0.3) {
    const rung = MeshBuilder.CreateBox(
      `ladder${index}-rung`,
      { width: ax * LADDER_WIDTH + 0.03, depth: az * LADDER_WIDTH + 0.03, height: 0.03 },
      scene,
    );
    rung.position.set(along.x, y, along.z);
    meshes.push(rung);
  }
  return meshes;
}

function post(scene: Scene, x: number, foot: number, top: number, z: number): Mesh {
  const mesh = MeshBuilder.CreateBox(
    "post",
    { width: POST, depth: POST, height: top - foot },
    scene,
  );
  mesh.position.set(x, (foot + top) / 2, z);
  return mesh;
}

/** The part of a floor between two fractions of the way towards a side. */
function slice(floor: Floor, toward: string, from: number, to: number) {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const { minX, maxX, minZ, maxZ } = floor;
  switch (toward) {
    case "n":
      return { minX, maxX, minZ: lerp(minZ, maxZ, from), maxZ: lerp(minZ, maxZ, to) };
    case "s":
      return { minX, maxX, minZ: lerp(maxZ, minZ, to), maxZ: lerp(maxZ, minZ, from) };
    case "e":
      return { minZ, maxZ, minX: lerp(minX, maxX, from), maxX: lerp(minX, maxX, to) };
    default:
      return { minZ, maxZ, minX: lerp(maxX, minX, to), maxX: lerp(maxX, minX, from) };
  }
}
