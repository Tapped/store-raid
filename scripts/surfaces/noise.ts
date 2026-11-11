/**
 * Periodic noise for baking tiling textures. Every function takes a point (u, v) on the texture,
 * where one repeat is 0 to 1, and whole-number frequencies: cells are hashed by their index modulo
 * the frequency, so every pattern wraps at the texture's edges and the bake tiles without seams.
 *
 * Results go through plain numbers and module-level outputs (see `cell`), not objects, because a
 * 2048² bake calls them hundreds of millions of times.
 */

export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Whole-number modulo that stays positive. */
export const wrap = (a: number, p: number) => ((a % p) + p) % p;
/** Distance between two coordinates on a circle of circumference 1. */
export function wrapDelta(a: number, b: number): number {
  let d = a - b;
  d -= Math.round(d);
  return d;
}

/** A number in [0, 1) from whole numbers. */
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x5bd1e995, 0x165667b1);
  h = Math.imul(h ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A seeded stream of numbers in [0, 1), for laying things out ahead of the bake. */
export function random(seed: number): () => number {
  let i = 0;
  return () => hash(i++, 7919, seed);
}

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [0, 1], `fx` × `fy` cells across one repeat. */
export function value(u: number, v: number, fx: number, fy: number, seed: number): number {
  const x = u * fx;
  const y = v * fy;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = quintic(x - ix);
  const ty = quintic(y - iy);
  const x0 = wrap(ix, fx);
  const x1 = wrap(ix + 1, fx);
  const y0 = wrap(iy, fy);
  const y1 = wrap(iy + 1, fy);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

/** Value noise in [0, 1] over a plane that doesn't repeat, for local shapes. */
export function valueAt(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = quintic(x - ix);
  const ty = quintic(y - iy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

// 256 unit gradients, picked by hash.
const GX = new Float64Array(256);
const GY = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const a = (i / 256) * Math.PI * 2 + 0.1;
  GX[i] = Math.cos(a);
  GY[i] = Math.sin(a);
}

function grad(ix: number, iy: number, seed: number, dx: number, dy: number): number {
  const g = (hash(ix, iy, seed) * 256) | 0;
  return GX[g] * dx + GY[g] * dy;
}

/** Gradient noise, about -1 to 1 (mostly within ±0.7), `fx` × `fy` cells across one repeat. */
export function gradient(u: number, v: number, fx: number, fy: number, seed: number): number {
  const x = u * fx;
  const y = v * fy;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const dx = x - ix;
  const dy = y - iy;
  const x0 = wrap(ix, fx);
  const x1 = wrap(ix + 1, fx);
  const y0 = wrap(iy, fy);
  const y1 = wrap(iy + 1, fy);
  const tx = quintic(dx);
  const ty = quintic(dy);
  const a = grad(x0, y0, seed, dx, dy);
  const b = grad(x1, y0, seed, dx - 1, dy);
  const c = grad(x0, y1, seed, dx, dy - 1);
  const d = grad(x1, y1, seed, dx - 1, dy - 1);
  return mix(mix(a, b, tx), mix(c, d, tx), ty) * 1.41;
}

/**
 * Fractal gradient noise, about -1 to 1, centred on 0: `octaves` layers, each at twice the
 * frequency (so still whole numbers) and `gain` times the amplitude of the one before.
 */
export function fbm(
  u: number,
  v: number,
  fx: number,
  fy: number,
  octaves: number,
  seed: number,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradient(u, v, fx, fy, seed + i * 131);
    total += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return (sum / total) * 1.6;
}

/** fbm squashed into 0 to 1 around 0.5. */
export const fbm01 = (
  u: number,
  v: number,
  fx: number,
  fy: number,
  octaves: number,
  seed: number,
  gain = 0.5,
) => clamp(0.5 + 0.5 * fbm(u, v, fx, fy, octaves, seed, gain));

/** Ridged fbm in 0 to 1: sharp crests where the noise crosses zero, for veins and creases. */
export function ridged(
  u: number,
  v: number,
  fx: number,
  fy: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(gradient(u, v, fx, fy, seed + i * 131));
    sum += amp * n * n;
    total += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / total;
}

/**
 * What `voronoi` found: distances in cells to the nearest and second feature points, the distance
 * to the border between their cells, the nearest cell's id in [0, 1), and where its point is on
 * the texture (u, v, unwrapped next to the point asked about).
 */
export const cell = { f1: 0, f2: 0, edge: 0, id: 0, id2: 0, u: 0, v: 0 };

/**
 * Voronoi (cellular) noise, `fx` × `fy` cells across one repeat, points jittered by `jitter` (0 is
 * a grid, 1 fully random). Fills `cell`. With `edges`, also the true distance to the nearest
 * border, which keeps cracks and grout an even width.
 */
export function voronoi(
  u: number,
  v: number,
  fx: number,
  fy: number,
  seed: number,
  jitter = 1,
  edges = false,
): typeof cell {
  const x = u * fx;
  const y = v * fy;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  let mx = 0;
  let my = 0;
  let mcx = 0;
  let mcy = 0;
  let id = 0;
  let id2 = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = wrap(cx, fx);
      const wy = wrap(cy, fy);
      const px = cx + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter;
      const py = cy + 0.5 + (hash(wx, wy, seed + 1) - 0.5) * jitter;
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < f1) {
        f2 = f1;
        id2 = id;
        f1 = d;
        mx = dx;
        my = dy;
        mcx = cx;
        mcy = cy;
        id = hash(wx, wy, seed + 2);
      } else if (d < f2) {
        f2 = d;
        id2 = hash(wx, wy, seed + 2);
      }
    }
  }
  cell.f1 = Math.sqrt(f1);
  cell.f2 = Math.sqrt(f2);
  cell.id = id;
  cell.id2 = id2;
  cell.u = (x + mx) / fx;
  cell.v = (y + my) / fy;
  if (edges) {
    let edge = 1e9;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const cx = mcx + i;
        const cy = mcy + j;
        if (cx === mcx && cy === mcy) continue;
        const wx = wrap(cx, fx);
        const wy = wrap(cy, fy);
        const dx = cx + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter - x;
        const dy = cy + 0.5 + (hash(wx, wy, seed + 1) - 0.5) * jitter - y;
        const ex = dx - mx;
        const ey = dy - my;
        const len = Math.hypot(ex, ey);
        if (len < 1e-6) continue;
        const e = ((mx + dx) * 0.5 * ex + (my + dy) * 0.5 * ey) / len;
        if (e < edge) edge = e;
      }
    }
    cell.edge = edge;
  } else {
    cell.edge = cell.f2 - cell.f1;
  }
  return cell;
}

/**
 * Straight scratches, `cells` × `cells` across one repeat with up to `count` in each, as 0 to 1.
 * Each is `length` long and `width` wide in repeats, turned by `angle` ± `spread` radians.
 */
export function scratches(
  u: number,
  v: number,
  cells: number,
  count: number,
  seed: number,
  length: number,
  width: number,
  angle = 0,
  spread = Math.PI,
): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const reach = Math.ceil(length * cells * 0.5) + 1;
  let best = 0;
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = wrap(cx, cells);
      const wy = wrap(cy, cells);
      for (let k = 0; k < count; k++) {
        const s = seed + k * 17;
        const strength = hash(wx, wy, s + 3);
        if (strength < 0.15) continue;
        const ox = (cx + hash(wx, wy, s)) / cells;
        const oy = (cy + hash(wx, wy, s + 1)) / cells;
        const a = angle + (hash(wx, wy, s + 2) - 0.5) * 2 * spread;
        const len = length * (0.4 + 0.6 * hash(wx, wy, s + 4));
        const dx = u - ox;
        const dy = v - oy;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const along = dx * ca + dy * sa;
        if (Math.abs(along) > len * 0.5) continue;
        const across = Math.abs(-dx * sa + dy * ca);
        if (across > width) continue;
        // Fades towards the ends, as a scratch tapers.
        const taper = 1 - (2 * Math.abs(along)) / len;
        const w = width * (0.3 + 0.7 * Math.sqrt(taper));
        const line = 1 - smoothstep(w * 0.3, w, across);
        const value = line * (0.4 + 0.6 * strength) * Math.min(1, taper * 3);
        if (value > best) best = value;
      }
    }
  }
  return best;
}

/** sRGB colour (0 to 1) as linear. */
export function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear colour as sRGB, 0 to 1. */
export function srgb(c: number): number {
  c = clamp(c);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}
