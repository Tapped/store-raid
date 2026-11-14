import { Mesh, VertexData } from "@babylonjs/core";
import type { Floor } from "../../shared/level";
import type { World } from "./scene";
import { surface } from "./surfaces";
import { SURFACES } from "./surfaceTable";

/**
 * What a level's yard has that no model draws (`Level.yard`, shared/harbourYard.ts): its ramps, as
 * concrete wedges on the harbour's ground. Its containers and clutter are props, drawn with the
 * rest (dressing.ts); its lamps stand with the harbour's (harbour.ts).
 */
export function addYard(world: World): void {
  for (const [i, ramp] of (world.level.yard?.ramps ?? []).entries()) {
    const mesh = wedge(world, ramp, `yard-ramp${i}`);
    mesh.receiveShadows = true;
    mesh.isPickable = false;
  }
}

/** A ramp floor as a solid wedge: its slope, its high end and its two sides. */
function wedge(world: World, floor: Floor, name: string): Mesh {
  const rise = floor.rise;
  const height = rise?.height ?? 0;
  const tile = SURFACES["concrete-floor"].tile;
  // Corners on the ground, and how high the slope is over each: full at the side it rises toward.
  const high = (x: number, z: number) => {
    switch (rise?.toward) {
      case "n":
        return z === floor.maxZ ? height : 0;
      case "s":
        return z === floor.minZ ? height : 0;
      case "e":
        return x === floor.maxX ? height : 0;
      default:
        return x === floor.minX ? height : 0;
    }
  };
  const corners = [
    [floor.minX, floor.minZ],
    [floor.maxX, floor.minZ],
    [floor.maxX, floor.maxZ],
    [floor.minX, floor.maxZ],
  ].map(([x, z]) => ({ x, z, top: floor.y + high(x, z) }));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // One face of its own corners, so it shades flat; uv in meters over the surface's tile.
  const face = (
    points: [number, number, number][],
    uv: (p: [number, number, number]) => number[],
  ) => {
    const base = positions.length / 3;
    for (const p of points) {
      positions.push(...p);
      uvs.push(...uv(p).map((v) => v / tile));
    }
    for (let k = 1; k + 1 < points.length; k++) indices.push(base, base + k, base + k + 1);
  };
  const bottom = floor.y - 0.3;
  // The slope, seen from above.
  face(
    corners.map((c) => [c.x, c.top, c.z]),
    ([x, , z]) => [x, z],
  );
  // The four sides, each down into the ground: those with no height are slivers nobody sees.
  for (let k = 0; k < 4; k++) {
    const a = corners[(k + 1) % 4];
    const b = corners[k];
    face(
      [
        [a.x, bottom, a.z],
        [b.x, bottom, b.z],
        [b.x, b.top, b.z],
        [a.x, a.top, a.z],
      ],
      ([x, y, z]) => [a.x === b.x ? z : x, y],
    );
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  // Whichever way the corners wind, the slope must face up.
  if (normals[1] < 0) {
    for (let k = 0; k < indices.length; k += 3) {
      [indices[k + 1], indices[k + 2]] = [indices[k + 2], indices[k + 1]];
    }
    VertexData.ComputeNormals(positions, indices, normals);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  const mesh = new Mesh(name, world.scene);
  data.applyToMesh(mesh);
  mesh.material = surface(world.scene, "concrete-floor");
  return mesh;
}
