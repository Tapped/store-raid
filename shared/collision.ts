/**
 * Simple 2D collision for player movement on the ground plane (x/z): circles for movers,
 * axis-aligned boxes for the level. Pure functions — shared by server and client prediction.
 */

export interface Circle {
  x: number;
  z: number;
  radius: number;
}

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Push a circle out of a box. Returns the correction applied (0,0 if not overlapping),
 * so callers can cancel velocity into the wall.
 */
export function resolveCircleBox(circle: Circle, box: Box): { dx: number; dz: number } {
  const closestX = clamp(circle.x, box.minX, box.maxX);
  const closestZ = clamp(circle.z, box.minZ, box.maxZ);
  let dx = circle.x - closestX;
  let dz = circle.z - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq >= circle.radius * circle.radius) return { dx: 0, dz: 0 };

  if (distSq > 1e-9) {
    // Centre outside the box: push along the closest-point normal.
    const dist = Math.sqrt(distSq);
    const push = circle.radius - dist;
    dx = (dx / dist) * push;
    dz = (dz / dist) * push;
  } else {
    // Centre inside the box: push out through the nearest face.
    const left = circle.x - box.minX;
    const right = box.maxX - circle.x;
    const down = circle.z - box.minZ;
    const up = box.maxZ - circle.z;
    const min = Math.min(left, right, down, up);
    dx = min === left ? -(left + circle.radius) : min === right ? right + circle.radius : 0;
    dz = min === down ? -(down + circle.radius) : min === up ? up + circle.radius : 0;
  }

  circle.x += dx;
  circle.z += dz;
  return { dx, dz };
}

/** Push two overlapping circles apart equally. Returns true if they overlapped. */
export function resolveCircleCircle(a: Circle, b: Circle): boolean {
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  const minDist = a.radius + b.radius;
  const distSq = dx * dx + dz * dz;

  if (distSq >= minDist * minDist) return false;

  let dist = Math.sqrt(distSq);
  const half = (minDist - dist) / 2;
  if (dist < 1e-9) {
    // Exactly on top of each other: pick an arbitrary but deterministic axis.
    dx = 1;
    dz = 0;
    dist = 1;
  }
  const nx = dx / dist;
  const nz = dz / dist;
  a.x -= nx * half;
  a.z -= nz * half;
  b.x += nx * half;
  b.z += nz * half;
  return true;
}
