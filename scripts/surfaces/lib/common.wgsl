// Layers several surfaces share: painted metal with its damage, rust, concrete and galvanising.
// Sizes are physical: `tile` is the surface's repeat in meters, and frequencies are rounded to
// whole numbers per repeat so everything still tiles.

// Cells across one repeat for features `perMeter` to the meter.
fn per(tile: f32, perMeter: f32) -> f32 {
  return max(1.0, roundUp(tile * perMeter));
}

const RUST_DARK = hex(0x3a2216);
const RUST = hex(0x6b3a1e);
const RUST_BRIGHT = hex(0xa8592a);
const STEEL = hex(0x9a9c9e);
const PRIMER_RED = hex(0x7d3a2a);
const PRIMER_GREY = hex(0x8a8a84);
const DIRT = hex(0x4a4238);
const SALT = hex(0xd2d0c8);

// Rust on a texel by `k`: flaky, terraced layers from dark to orange, pitted, a little raised.
fn rust(o: ptr<function, Texel>, u: f32, v: f32, tile: f32, k: f32, seed: i32) {
  if (k <= 0.0) {
    return;
  }
  let f = per(tile, 6.0);
  let wu = u + (fbm(u, v, f, f, 3, seed + 1) * 0.3) / f;
  let wv = v + (fbm(u, v, f, f, 3, seed + 2) * 0.3) / f;
  let n = fbm01Gain(wu, wv, f, f, 6, seed + 3, 0.55);
  // Flaking layers: the noise in four terraces.
  let terrace = floor(n * 4.0) / 4.0;
  let edge = smoothstep(0.85, 1.0, (n * 4.0) % 1.0);
  var col = blend(RUST_DARK, RUST, smoothstep(0.2, 0.7, terrace));
  col = blend(
    col,
    RUST_BRIGHT,
    smoothstep(0.65, 0.9, fbm01(u, v, per(tile, 18.0), per(tile, 18.0), 3, seed + 4)) * 0.4,
  );
  let fine = value(u, v, per(tile, 900.0), per(tile, 900.0), seed + 5);
  let pit = voronoi(u, v, per(tile, 160.0), per(tile, 160.0), seed + 6, 1.0);
  let pitted = (1.0 - smoothstep(0.1, 0.3, pit.f1)) * smoothstep(0.55, 0.9, pit.id);
  let shadeK = (0.8 + 0.35 * fine) * (1.0 - edge * 0.35) * (1.0 - pitted * 0.4);
  cover(o, col * shadeK, k);
  o.h += k * (terrace * 0.25 + fine * 0.04 - pitted * 0.15);
  o.rough = mix(o.rough, 0.9 + fine * 0.08, k);
  o.metal = mix(o.metal, 0.0, k);
}

// A chipped flake field, 0 to 1: how far into a chip the texel is (0 is sound paint).
fn chips(u: f32, v: f32, fx: f32, fy: f32, seed: i32, amount: f32) -> f32 {
  if (amount <= 0.0) {
    return 0.0;
  }
  let wu = u + (fbm(u, v, fx * 2.0, fy * 2.0, 3, seed + 1) * 0.35) / fx;
  let wv = v + (fbm(u, v, fx * 2.0, fy * 2.0, 3, seed + 2) * 0.35) / fy;
  let c = voronoi(wu, wv, fx, fy, seed, 1.0);
  if (c.id > amount) {
    return 0.0;
  }
  let r = 0.2 + 0.35 * (1.0 - c.id / amount);
  return smoothstep(r, r * 0.4, c.f1);
}

// How paintedMetal paints: start from paint(tile, seed, damage, age) and change what differs.
struct Paint {
  tile: f32,
  seed: i32,
  // How much of the surface is in damaged zones, 0 to 1.
  damage: f32,
  // How old the damage is: 0 bright bare steel, 1 all rust.
  age: f32,
  // Gloss paint roughness.
  gloss: f32,
  primer: vec3f,
  // Rust runs down from chips.
  runs: f32,
  // Vertical dirt streaks washed down.
  wash: f32,
  // Extra damage here, 0 to 1, e.g. near a lap or screw.
  extra: f32,
}

fn paint(tile: f32, seed: i32, damage: f32, age: f32) -> Paint {
  return Paint(tile, seed, damage, age, 0.35, PRIMER_RED, 0.6, 0.5, 0.0);
}

// The chip value at a point, for painted metal; shared with the run test above it.
fn paintChip(u: f32, v: f32, p: Paint, zone: f32) -> f32 {
  let a = chips(u, v, per(p.tile, 20.0), per(p.tile, 11.0), p.seed + 10, zone * 0.55);
  let b = chips(u, v, per(p.tile, 64.0), per(p.tile, 40.0), p.seed + 20, zone * 0.45);
  return max(a, b * 0.85);
}

// Painted steel: chalking, washed-down dirt, rust runs, then chips through to primer, rust and
// bright steel, in clusters so most of it stays sound. Paint is the tint.
fn paintedMetal(o: ptr<function, Texel>, u: f32, v: f32, p: Paint) {
  let tile = p.tile;
  let seed = p.seed;
  // Sound paint: tint shows, orange peel in the height.
  o.a = 1.0;
  o.col = vec3f(0.0);
  let peel = fbm(u, v, per(tile, 300.0), per(tile, 300.0), 2, seed + 1);
  o.h = peel * 0.008;
  o.rough = p.gloss + peel * 0.03;
  o.metal = 0.0;

  // Where the damage is: low-frequency clusters.
  let extra = p.extra;
  let zoneN = fbm01(u, v, per(tile, 2.0), per(tile, 2.0), 4, seed + 2);
  let zone = saturate(
    smoothstep(0.58 - p.damage * 0.25, 0.82 - p.damage * 0.2, zoneN) + extra,
  );

  // Chalking: old paint goes pale and dull in patches.
  let chalk = smoothstep(0.4, 0.8, fbm01(u, v, per(tile, 4.0), per(tile, 4.0), 4, seed + 3)) * 0.18;
  cover(o, vec3f(0.6, 0.6, 0.58), chalk * 0.25);
  o.rough = mix(o.rough, 0.75, chalk * 1.5);

  // Dirt washed down in vertical streaks.
  if (p.wash > 0.0) {
    let streak = fbm01(u, v, per(tile, 70.0), 1.0, 3, seed + 4) * 0.5 +
      fbm01(u, v, per(tile, 22.0), 1.0, 3, seed + 5) * 0.3 +
      fbm01(u, v, per(tile, 9.0), 2.0, 3, seed + 6) * 0.2;
    let dirt = smoothstep(0.45, 0.8, streak) * p.wash * 0.5;
    cover(o, DIRT, dirt * 0.6);
    o.rough = mix(o.rough, 0.8, dirt);
  }

  // Rust runs: chips a little above, gated by a vertical streak.
  if (p.runs > 0.0) {
    let streak = fbm01(u, v, per(tile, 120.0), 1.0, 3, seed + 30);
    if (streak > 0.5) {
      var rr = 0.0;
      for (var i = 1; i <= 4; i++) {
        let q = v + (f32(i) * 0.034) / tile;
        let src = paintChip(u, q, p, zone);
        rr = max(rr, smoothstep(0.45, 0.7, src) * (1.0 - f32(i) / 5.0));
      }
      let run = rr * smoothstep(0.5, 0.78, streak) * p.runs * p.age;
      cover(o, blend(RUST, RUST_DARK, 0.4), run * 0.8);
      o.rough = mix(o.rough, 0.7, run);
    }
  }

  // Chips: primer at the edge, then rust or bare steel at the heart.
  var bump = 0.0;
  if (extra > 0.5) {
    bump = (extra - 0.5) * 0.6;
  }
  let chip = saturate(paintChip(u, v, p, zone) + bump);
  if (chip > 0.05) {
    let primer = smoothstep(0.05, 0.2, chip);
    cover(o, p.primer, primer);
    o.rough = mix(o.rough, 0.72, primer);
    o.h -= primer * 0.18;
    let core = smoothstep(0.35, 0.6, chip);
    if (core > 0.0) {
      let fresh = 1.0 - p.age;
      cover(o, STEEL, core * fresh);
      o.metal = mix(o.metal, 1.0, core * fresh);
      o.rough = mix(o.rough, 0.38, core * fresh);
      o.h -= core * 0.12;
      rust(o, u, v, tile, core * p.age, seed + 40);
    }
  }
  // Oxide halo round chips, rust creeping under the paint edge.
  let halo = smoothstep(0.0, 0.05, chip) * (1.0 - smoothstep(0.05, 0.15, chip)) * p.age;
  cover(o, RUST, halo * 0.5);
}

// Concrete: cement paste with sand and pores, a broad mottle, its own colour (no tint).
fn concrete(o: ptr<function, Texel>, u: f32, v: f32, tile: f32, seed: i32, colour: vec3f) {
  let broad = fbm(u, v, per(tile, 0.8), per(tile, 0.8), 4, seed + 1);
  let mottle = fbmGain(u, v, per(tile, 6.0), per(tile, 6.0), 4, seed + 2, 0.55);
  let grain = value(u, v, per(tile, 350.0), per(tile, 350.0), seed + 3) - 0.5;
  let pores = voronoi(u, v, per(tile, 150.0), per(tile, 150.0), seed + 4, 1.0);
  let pore = (1.0 - smoothstep(0.08, 0.22, pores.f1)) * smoothstep(0.55, 0.9, pores.id);
  let k = (1.0 + broad * 0.08 + mottle * 0.06 + grain * 0.08) * (1.0 - pore * 0.35);
  setColour(o, colour, k);
  o.h = broad * 0.5 + mottle * 0.15 + grain * 0.06 - pore * 0.5;
  o.rough = 0.85 + grain * 0.08;
  o.metal = 0.0;
}

// Hot-dip galvanising: spangle crystals of slightly different sheen, dull patches, white rust.
fn galvanised(o: ptr<function, Texel>, u: f32, v: f32, tile: f32, seed: i32, wear: f32) {
  let f = per(tile, 70.0);
  let wu = u + (fbm(u, v, f, f, 2, seed + 1) * 0.5) / f;
  let wv = v + (fbm(u, v, f, f, 2, seed + 2) * 0.5) / f;
  let id = voronoi(wu, wv, f, f, seed + 3, 1.0).id;
  let fine = voronoi(u, v, f * 4.0, f * 4.0, seed + 4, 1.0).id;
  let dull = smoothstep(0.4, 0.75, fbm01(u, v, per(tile, 3.0), per(tile, 3.0), 4, seed + 5));
  let k = 0.92 + id * 0.12 + fine * 0.04 - dull * 0.12;
  setColour(o, STEEL, k);
  o.metal = 1.0 - dull * 0.15;
  o.rough = saturate(0.3 + id * 0.25 + fine * 0.05 + dull * 0.25);
  o.h = (id - 0.5) * 0.004 + fine * 0.002;
  // White rust: zinc oxide blooming pale and chalky, worst in damp spots.
  let white = smoothstep(0.62, 0.85, fbm01(u, v, per(tile, 8.0), per(tile, 8.0), 5, seed + 6)) * wear;
  cover(o, SALT, white * 0.7);
  o.metal = mix(o.metal, 0.0, white * 0.8);
  o.rough = mix(o.rough, 0.85, white);
}
