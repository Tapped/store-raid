// What a recipe writes, and the layers it paints with.
//
// HOW TO WRITE A RECIPE
//
// A surface is a row in client/src/surfaceTable.ts (tile in meters, size, tint, …) and a file
// scripts/surfaces/recipes/<name>.wgsl. The baker puts the library (lib/noise.wgsl, recipe.wgsl,
// common.wgsl, then any other lib/*.wgsl by name) in front of the recipe and runs, once per texel:
//
//   fn sample(u: f32, v: f32, o: ptr<function, Texel>)
//
// (u, v) is the point on the texture, one repeat 0 to 1, v up (v 0 is the floor on `upright`
// surfaces). `o` starts as col 0, a 0, h 0, ao 1, rough 0.5, metal 0; write into it with `o.h = …`,
// `o.col *= …`. Colour is linear; `a` is how much of the table's tint shows (tintable surfaces paint
// col 0 and a 1 where paint is, then `cover` it with dirt), or coverage on cut-out ones; `h` is in
// millimetres, and normals come from it at real depth over the tile's real size.
//
// Optional, in the recipe:
//   const CAVITY = vec2f(radius_mm, strength);  hollows darken: below the height blurred that wide
//   fn setup()  runs once on one thread first, to lay things out: `var r = random(seed);` then
//               `next(&r)`, and `place(group, Spot(u, v, reach, a, b, c, d, e))`. sample() loops
//               `for (var i = 0u; i < spots(G); i++) { let s = spot(G, i); if (!near(s, u, v, 16.0))
//               { continue; } … }`, with `offset(s, u, v)` the short way round to it.
//
// `hex(0xRRGGBB)` is an sRGB colour as linear vec3f, written out before compiling, so it works in
// module-scope consts. Names are shared with the library, so don't reuse its names (SALT, RUST, …).
// Frequencies are whole numbers of cells per repeat, so everything tiles: `per(tile_m, perMeter)`.
//
// The library:
//   noise.wgsl   PI TAU SQRT2 SQRT1_2; smoothstep (either way round), roundUp, wrap, wrapDelta;
//                hash(x, y, seed: i32) in [0, 1); value(u, v, fx, fy, seed) 0..1; valueAt(x, y, seed)
//                unrepeating; gradient ±1; fbm(u, v, fx, fy, octaves, seed) ±1, fbmGain(…, gain),
//                fbm01, fbm01Gain 0..1; ridged 0..1; voronoi(u, v, fx, fy, seed, jitter) -> Cell
//                {f1, f2, edge, id, id2, u, v}, voronoiEdges (true distance to the border);
//                scratches(u, v, cells, count, seed, len, width, angle, spread); linear, srgb, srgb3
//   recipe.wgsl  Texel; setColour(o, c, k), cover(o, c, k), shade(o, k), blend(a, b, t); Spot,
//                place, spots, spot, near, offset; Random, random, next
//   common.wgsl  per; RUST_DARK RUST RUST_BRIGHT STEEL PRIMER_RED PRIMER_GREY DIRT SALT;
//                rust(o, u, v, tile, k, seed), chips(…), paintedMetal(o, u, v, paint(tile, seed,
//                damage, age)) with gloss, primer, runs, wash, extra to change; concrete(o, u, v,
//                tile, seed, colour); galvanised(o, u, v, tile, seed, wear)
//
// Look at it: `pnpm run surface <name> --watch` bakes again on every save (add `--draft 512` to
// write only the preview), prints compile errors as recipes/<name>.wgsl:line:col, and writes the
// contact sheet to node_modules/.cache/surfaces/<name>/preview.png; then see it in the surface
// viewer at /surfaces.html. Layers shared by several new surfaces go in a new lib/<set>.wgsl.

// One texel of a surface: colour in linear 0 to 1, `a` how much of the material's tint shows
// through (see `cover`), height in millimetres, ambient occlusion, roughness and metalness.
// sample() starts from col 0, a 0, h 0, ao 1, rough 0.5, metal 0.
struct Texel {
  col: vec3f,
  a: f32,
  h: f32,
  ao: f32,
  rough: f32,
  metal: f32,
}

// Sets the texel's own colour times `k`, leaving the tint amount.
fn setColour(o: ptr<function, Texel>, c: vec3f, k: f32) {
  o.col = c * k;
}

// Covers the texel with colour `c` by `k`, which hides the tint by as much: dirt, rust or bare
// substrate over paint.
fn cover(o: ptr<function, Texel>, c: vec3f, k: f32) {
  if (k <= 0.0) {
    return;
  }
  let t = min(k, 1.0);
  o.col = mix(o.col, c, t);
  o.a = mix(o.a, 0.0, t);
}

// Multiplies the colour and the tint amount alike: shade that darkens paint and substrate.
fn shade(o: ptr<function, Texel>, k: f32) {
  o.col *= k;
  o.a *= k;
}

// Mixes two colours.
fn blend(a: vec3f, b: vec3f, t: f32) -> vec3f {
  return mix(a, b, vec3f(t));
}

// Something setup() lays out on the texture: where it is, how far it reaches (in repeats), and
// its own numbers, whatever the recipe wants (seeds, sizes).
struct Spot {
  u: f32,
  v: f32,
  reach: f32,
  a: f32,
  b: f32,
  c: f32,
  d: f32,
  e: f32,
}

const GROUPS = 8u;
const GROUP_SIZE = 512u;

struct Layout {
  count: array<u32, 8>,
  spots: array<Spot, 4096>,
}

// Filled by setup(), which runs on one thread before the bake; read by sample().
@group(0) @binding(3) var<storage, read_write> scatter: Layout;

// Adds a spot to `group` (0 to 7, up to 512 in each), after those already there.
fn place(group: u32, s: Spot) {
  let n = scatter.count[group];
  if (n < GROUP_SIZE) {
    scatter.spots[group * GROUP_SIZE + n] = s;
    scatter.count[group] = n + 1u;
  }
}

// How many spots `group` has.
fn spots(group: u32) -> u32 {
  return scatter.count[group];
}

// The `i`th spot of `group`, in the order they were placed.
fn spot(group: u32, i: u32) -> Spot {
  return scatter.spots[group * GROUP_SIZE + i];
}

// Whether a spot may reach (u, v): true within its reach, rounded out to a `grid` × `grid` grid
// of buckets over the texture (wrapping), so it's a quick test to skip far spots with.
fn near(s: Spot, u: f32, v: f32, grid: f32) -> bool {
  let g = i32(grid);
  let r = i32(ceil(s.reach * grid)) + 1;
  if (2 * r + 1 >= g) {
    return true;
  }
  let dx = wrap(i32(floor(u * grid)) - i32(floor(s.u * grid)), g);
  let dy = wrap(i32(floor(v * grid)) - i32(floor(s.v * grid)), g);
  return (dx <= r || dx >= g - r) && (dy <= r || dy >= g - r);
}

// The offset from a spot to (u, v), the short way round the texture.
fn offset(s: Spot, u: f32, v: f32) -> vec2f {
  return vec2f(wrapDelta(u, s.u), wrapDelta(v, s.v));
}
