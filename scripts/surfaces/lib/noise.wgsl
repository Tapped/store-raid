// Periodic noise for baking tiling textures. Every function takes a point (u, v) on the texture,
// where one repeat is 0 to 1, and whole-number frequencies: cells are hashed by their index modulo
// the frequency, so every pattern wraps at the texture's edges and the bake tiles without seams.
// Seeds are i32. The hash is 32-bit integer math, the same as the CPU baker's was.

const PI = 3.14159265358979;
const TAU = 6.28318530717959;
const SQRT2 = 1.41421356237310;
const SQRT1_2 = 0.70710678118655;

// Hermite step from e0 to e1, which may run downwards (e0 > e1): fades out as x passes them.
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = saturate((x - e0) / (e1 - e0));
  return t * t * (3.0 - 2.0 * t);
}

// Rounds halves up, as JavaScript's Math.round does (WGSL's round() goes to even).
fn roundUp(x: f32) -> f32 {
  return floor(x + 0.5);
}

// Whole-number modulo that stays positive.
fn wrap(a: i32, p: i32) -> i32 {
  return ((a % p) + p) % p;
}

// Distance between two coordinates on a circle of circumference 1.
fn wrapDelta(a: f32, b: f32) -> f32 {
  let d = a - b;
  return d - roundUp(d);
}

// 32 random bits from whole numbers.
fn hashBits(x: i32, y: i32, seed: i32) -> u32 {
  var h = (bitcast<u32>(x) * 0x27d4eb2du) ^ ((bitcast<u32>(y) + 0x5bd1e995u) * 0x165667b1u);
  h = (h ^ (bitcast<u32>(seed) * 0x9e3779b1u)) * 0x85ebca6bu;
  h ^= h >> 15u;
  h *= 0xc2b2ae35u;
  h ^= h >> 13u;
  h *= 0x27d4eb2fu;
  h ^= h >> 16u;
  return h;
}

// A number in [0, 1) from whole numbers.
fn hash(x: i32, y: i32, seed: i32) -> f32 {
  return f32(hashBits(x, y, seed) >> 8u) / 16777216.0;
}

// A seeded stream of numbers in [0, 1), for laying things out in setup(): `var r = random(11);`
// then `next(&r)`.
struct Random {
  i: i32,
  seed: i32,
}

fn random(seed: i32) -> Random {
  return Random(0, seed);
}

fn next(r: ptr<function, Random>) -> f32 {
  let x = hash(r.i, 7919, r.seed);
  r.i += 1;
  return x;
}

fn quintic(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Value noise in [0, 1], `fx` × `fy` cells across one repeat.
fn value(u: f32, v: f32, fx: f32, fy: f32, seed: i32) -> f32 {
  let x = u * fx;
  let y = v * fy;
  let fl = floor(vec2f(x, y));
  let tx = quintic(x - fl.x);
  let ty = quintic(y - fl.y);
  let px = i32(fx);
  let py = i32(fy);
  let ix = i32(fl.x);
  let iy = i32(fl.y);
  let x0 = wrap(ix, px);
  let x1 = wrap(ix + 1, px);
  let y0 = wrap(iy, py);
  let y1 = wrap(iy + 1, py);
  let a = hash(x0, y0, seed);
  let b = hash(x1, y0, seed);
  let c = hash(x0, y1, seed);
  let d = hash(x1, y1, seed);
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

// Value noise in [0, 1] over a plane that doesn't repeat, for local shapes.
fn valueAt(x: f32, y: f32, seed: i32) -> f32 {
  let fl = floor(vec2f(x, y));
  let tx = quintic(x - fl.x);
  let ty = quintic(y - fl.y);
  let ix = i32(fl.x);
  let iy = i32(fl.y);
  let a = hash(ix, iy, seed);
  let b = hash(ix + 1, iy, seed);
  let c = hash(ix, iy + 1, seed);
  let d = hash(ix + 1, iy + 1, seed);
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

// One of 256 unit gradients, picked by hash, dotted with (dx, dy).
fn grad(ix: i32, iy: i32, seed: i32, dx: f32, dy: f32) -> f32 {
  let g = f32(hashBits(ix, iy, seed) >> 24u);
  let a = g / 256.0 * TAU + 0.1;
  return cos(a) * dx + sin(a) * dy;
}

// Gradient noise, about -1 to 1 (mostly within ±0.7), `fx` × `fy` cells across one repeat.
fn gradient(u: f32, v: f32, fx: f32, fy: f32, seed: i32) -> f32 {
  let x = u * fx;
  let y = v * fy;
  let fl = floor(vec2f(x, y));
  let dx = x - fl.x;
  let dy = y - fl.y;
  let px = i32(fx);
  let py = i32(fy);
  let ix = i32(fl.x);
  let iy = i32(fl.y);
  let x0 = wrap(ix, px);
  let x1 = wrap(ix + 1, px);
  let y0 = wrap(iy, py);
  let y1 = wrap(iy + 1, py);
  let tx = quintic(dx);
  let ty = quintic(dy);
  let a = grad(x0, y0, seed, dx, dy);
  let b = grad(x1, y0, seed, dx - 1.0, dy);
  let c = grad(x0, y1, seed, dx, dy - 1.0);
  let d = grad(x1, y1, seed, dx - 1.0, dy - 1.0);
  return mix(mix(a, b, tx), mix(c, d, tx), ty) * 1.41;
}

// Fractal gradient noise, about -1 to 1, centred on 0: `octaves` layers, each at twice the
// frequency (so still whole numbers) and `gain` times the amplitude of the one before.
fn fbmGain(u: f32, v: f32, fx0: f32, fy0: f32, octaves: i32, seed: i32, gain: f32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var total = 0.0;
  var fx = fx0;
  var fy = fy0;
  for (var i = 0; i < octaves; i++) {
    sum += amp * gradient(u, v, fx, fy, seed + i * 131);
    total += amp;
    amp *= gain;
    fx *= 2.0;
    fy *= 2.0;
  }
  return (sum / total) * 1.6;
}

// fbm with each octave half the one before.
fn fbm(u: f32, v: f32, fx: f32, fy: f32, octaves: i32, seed: i32) -> f32 {
  return fbmGain(u, v, fx, fy, octaves, seed, 0.5);
}

// fbm squashed into 0 to 1 around 0.5.
fn fbm01(u: f32, v: f32, fx: f32, fy: f32, octaves: i32, seed: i32) -> f32 {
  return saturate(0.5 + 0.5 * fbm(u, v, fx, fy, octaves, seed));
}

fn fbm01Gain(u: f32, v: f32, fx: f32, fy: f32, octaves: i32, seed: i32, gain: f32) -> f32 {
  return saturate(0.5 + 0.5 * fbmGain(u, v, fx, fy, octaves, seed, gain));
}

// Ridged fbm in 0 to 1: sharp crests where the noise crosses zero, for veins and creases.
fn ridged(u: f32, v: f32, fx0: f32, fy0: f32, octaves: i32, seed: i32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var total = 0.0;
  var fx = fx0;
  var fy = fy0;
  for (var i = 0; i < octaves; i++) {
    let n = 1.0 - abs(gradient(u, v, fx, fy, seed + i * 131));
    sum += amp * n * n;
    total += amp;
    amp *= 0.5;
    fx *= 2.0;
    fy *= 2.0;
  }
  return sum / total;
}

// What voronoi found: distances in cells to the nearest and second feature points, the distance
// to the border between their cells, the nearest and second cells' ids in [0, 1), and where the
// nearest point is on the texture (u, v, unwrapped next to the point asked about).
struct Cell {
  f1: f32,
  f2: f32,
  edge: f32,
  id: f32,
  id2: f32,
  u: f32,
  v: f32,
}

fn voronoiCell(u: f32, v: f32, fx: f32, fy: f32, seed: i32, jitter: f32, edges: bool) -> Cell {
  let x = u * fx;
  let y = v * fy;
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let px = i32(fx);
  let py = i32(fy);
  var f1 = 1e9;
  var f2 = 1e9;
  var mx = 0.0;
  var my = 0.0;
  var mcx = 0;
  var mcy = 0;
  var id = 0.0;
  var id2 = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cy = iy + j;
      let wx = wrap(cx, px);
      let wy = wrap(cy, py);
      let ox = f32(cx) + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter;
      let oy = f32(cy) + 0.5 + (hash(wx, wy, seed + 1) - 0.5) * jitter;
      let dx = ox - x;
      let dy = oy - y;
      let d = dx * dx + dy * dy;
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
  var c: Cell;
  c.f1 = sqrt(f1);
  c.f2 = sqrt(f2);
  c.id = id;
  c.id2 = id2;
  c.u = (x + mx) / fx;
  c.v = (y + my) / fy;
  if (edges) {
    var edge = 1e9;
    for (var j = -2; j <= 2; j++) {
      for (var i = -2; i <= 2; i++) {
        let cx = mcx + i;
        let cy = mcy + j;
        if (cx == mcx && cy == mcy) {
          continue;
        }
        let wx = wrap(cx, px);
        let wy = wrap(cy, py);
        let dx = f32(cx) + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter - x;
        let dy = f32(cy) + 0.5 + (hash(wx, wy, seed + 1) - 0.5) * jitter - y;
        let ex = dx - mx;
        let ey = dy - my;
        let len = sqrt(ex * ex + ey * ey);
        if (len < 1e-6) {
          continue;
        }
        let e = ((mx + dx) * 0.5 * ex + (my + dy) * 0.5 * ey) / len;
        if (e < edge) {
          edge = e;
        }
      }
    }
    c.edge = edge;
  } else {
    c.edge = c.f2 - c.f1;
  }
  return c;
}

// Voronoi (cellular) noise, `fx` × `fy` cells across one repeat, points jittered by `jitter` (0 is
// a grid, 1 fully random). `edge` is f2 - f1.
fn voronoi(u: f32, v: f32, fx: f32, fy: f32, seed: i32, jitter: f32) -> Cell {
  return voronoiCell(u, v, fx, fy, seed, jitter, false);
}

// Voronoi with `edge` the true distance to the nearest border, which keeps cracks and grout an
// even width. Dearer: it looks at 5 × 5 cells more.
fn voronoiEdges(u: f32, v: f32, fx: f32, fy: f32, seed: i32, jitter: f32) -> Cell {
  return voronoiCell(u, v, fx, fy, seed, jitter, true);
}

// Straight scratches, `cells` × `cells` across one repeat with up to `count` in each, as 0 to 1.
// Each is `len` long and `width` wide in repeats, turned by `angle` ± `spread` radians (PI for any
// way).
fn scratches(
  u: f32,
  v: f32,
  cells: f32,
  count: i32,
  seed: i32,
  len: f32,
  width: f32,
  angle: f32,
  spread: f32,
) -> f32 {
  let x = u * cells;
  let y = v * cells;
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let n = i32(cells);
  let reach = i32(ceil(len * cells * 0.5)) + 1;
  var best = 0.0;
  for (var j = -reach; j <= reach; j++) {
    for (var i = -reach; i <= reach; i++) {
      let cx = ix + i;
      let cy = iy + j;
      let wx = wrap(cx, n);
      let wy = wrap(cy, n);
      for (var k = 0; k < count; k++) {
        let s = seed + k * 17;
        let strength = hash(wx, wy, s + 3);
        if (strength < 0.15) {
          continue;
        }
        let ox = (f32(cx) + hash(wx, wy, s)) / cells;
        let oy = (f32(cy) + hash(wx, wy, s + 1)) / cells;
        let a = angle + (hash(wx, wy, s + 2) - 0.5) * 2.0 * spread;
        let l = len * (0.4 + 0.6 * hash(wx, wy, s + 4));
        let dx = u - ox;
        let dy = v - oy;
        let ca = cos(a);
        let sa = sin(a);
        let along = dx * ca + dy * sa;
        if (abs(along) > l * 0.5) {
          continue;
        }
        let across = abs(-dx * sa + dy * ca);
        if (across > width) {
          continue;
        }
        // Fades towards the ends, as a scratch tapers.
        let taper = 1.0 - (2.0 * abs(along)) / l;
        let w = width * (0.3 + 0.7 * sqrt(taper));
        let line = 1.0 - smoothstep(w * 0.3, w, across);
        let value = line * (0.4 + 0.6 * strength) * min(1.0, taper * 3.0);
        if (value > best) {
          best = value;
        }
      }
    }
  }
  return best;
}

// sRGB colour (0 to 1) as linear.
fn linear(c: f32) -> f32 {
  if (c <= 0.04045) {
    return c / 12.92;
  }
  return pow((c + 0.055) / 1.055, 2.4);
}

// Linear colour as sRGB, 0 to 1.
fn srgb(x: f32) -> f32 {
  let c = saturate(x);
  if (c <= 0.0031308) {
    return c * 12.92;
  }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn srgb3(c: vec3f) -> vec3f {
  return vec3f(srgb(c.x), srgb(c.y), srgb(c.z));
}
