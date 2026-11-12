// A power-trowelled slab, 4 m square, with half a saw cut along each side so that slabs side by
// side meet at a cut. Years of a shop on it: trowel burnish, hairline cracks, black wheel marks,
// damp patches and the odd spall down to the aggregate.

const CAVITY = vec2f(6.0, 0.6);
const TILE = 4000.0; // mm
const CONCRETE = hex(0x8c8a85);
const WARM = hex(0x8f877c);
const COOL = hex(0x7f8285);
const RUBBER = hex(0x1c1b1a);
const OIL = hex(0x2a2621);
const FLOOR_SALT = hex(0xc9c6bd);
const PATCH = hex(0x7a7975);

// Spot groups.
const SPALLS = 0u;
const STAINS = 1u;
const ARCS = 2u;
const PATCHES = 3u;

// Distance from (u, v) to the nearest saw cut, in mm: the cuts lie on the tile's edges.
fn toCut(u: f32, v: f32) -> f32 {
  return min(min(u, 1.0 - u), min(v, 1.0 - v)) * TILE;
}

fn setup() {
  var rng = random(11);
  for (var i = 0; i < 70; i++) {
    // Spalls cluster along the cuts, where forklift wheels knock the edges.
    let alongCut = next(&rng) < 0.55;
    var u = next(&rng);
    var v = next(&rng);
    if (alongCut) {
      if (next(&rng) < 0.5) {
        u = (next(&rng) - 0.5) * 0.006;
      } else {
        v = (next(&rng) - 0.5) * 0.006;
      }
    }
    var r: f32;
    if (alongCut) {
      r = (6.0 + next(&rng) * 22.0) / TILE;
    } else {
      r = (4.0 + next(&rng) * 14.0) / TILE;
    }
    let seed = next(&rng) * 1000.0;
    place(SPALLS, Spot((u + 1.0) % 1.0, (v + 1.0) % 1.0, r * 1.6, r, seed, 0.0, 0.0, 0.0));
  }
  for (var i = 0; i < 26; i++) {
    // Mostly drips and small spills, a few big ones where a machine stood.
    let big = next(&rng) < 0.15;
    var r: f32;
    if (big) {
      r = (200.0 + next(&rng) * 250.0) / TILE;
    } else {
      r = (15.0 + next(&rng) * 90.0) / TILE;
    }
    let u = next(&rng);
    let v = next(&rng);
    let seed = next(&rng) * 1000.0;
    let c = next(&rng);
    place(STAINS, Spot(u, v, r * 1.5, r, seed, c, 0.0, 0.0));
  }
  // Curved tyre marks where forklifts turned, in pairs a wheel track apart, and thin ones from
  // pallet trucks.
  for (var i = 0; i < 22; i++) {
    let forklift = next(&rng) < 0.6;
    var radius: f32;
    var width: f32;
    if (forklift) {
      radius = (1500.0 + next(&rng) * 4000.0) / TILE;
      width = (90.0 + next(&rng) * 90.0) / TILE;
    } else {
      radius = (600.0 + next(&rng) * 2000.0) / TILE;
      width = (8.0 + next(&rng) * 25.0) / TILE;
    }
    let u = next(&rng);
    let v = next(&rng);
    let c = next(&rng) * TAU;
    let d = 0.25 + next(&rng) * 0.8;
    var strength: f32;
    if (forklift) {
      strength = 0.4 + next(&rng) * 0.5;
    } else {
      strength = 0.5 + next(&rng) * 0.5;
    }
    place(ARCS, Spot(u, v, radius + width, radius, width, c, d, strength));
    if (forklift) {
      let r = radius + 950.0 / TILE;
      place(ARCS, Spot(u, v, r + width, r, width, c, d, strength));
    }
  }
  // Repairs: squares cut out and filled with a newer mix.
  for (var i = 0; i < 4; i++) {
    let w = (300.0 + next(&rng) * 900.0) / TILE;
    let h = (300.0 + next(&rng) * 900.0) / TILE;
    let u = next(&rng);
    let v = next(&rng);
    let c = next(&rng);
    let seed = next(&rng) * 1000.0;
    place(PATCHES, Spot(u, v, length(vec2f(w, h)) / 2.0 + 0.002, w / 2.0, h / 2.0, c, seed, 0.0));
  }
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // Broad mottling: a pour is never one colour.
  let broad = fbm(u, v, 3.0, 3.0, 4, 1);
  let tone = fbm(u, v, 7.0, 7.0, 3, 2);
  var col = blend(CONCRETE, select(COOL, WARM, broad > 0.0), min(1.0, abs(broad)) * 0.7);
  let speckle = fbm(u, v, 48.0, 48.0, 3, 27);
  var k = 1.0 + broad * 0.07 + tone * 0.05 + speckle * 0.035;

  // Trowel swirls: arcs round many centres, showing in patches as burnish.
  let sw = voronoi(u, v, 9.0, 9.0, 3, 1.0);
  // Only part of each circle shows, as the blades sweep past: arcs, not targets.
  let ax = (sw.u - u) * 9.0;
  let ay = (sw.v - v) * 9.0;
  let facing = cos(atan2(ay, ax) - sw.id * 6.283);
  let rings = sin(sw.f1 * 30.0 + sw.id * 40.0 + fbm(u, v, 20.0, 20.0, 2, 28) * 4.0) * 0.5 + 0.5;
  let swirlMask = smoothstep(0.3, 0.7, fbm01(u, v, 5.0, 5.0, 3, 4)) * smoothstep(0.1, 0.7, facing);
  let burnish = swirlMask * smoothstep(0.5, 1.0, rings) * 0.5;
  k *= 1.0 - burnish * 0.03;

  // Fine grain: sand and cement, with pin pores.
  let grain = value(u, v, 1400.0, 1400.0, 5) - 0.5;
  let fine = value(u, v, 520.0, 520.0, 6) - 0.5;
  k *= 1.0 + grain * 0.07 + fine * 0.05;
  var h = fbm(u, v, 6.0, 6.0, 4, 7) * 0.6 + grain * 0.08 + fine * 0.08;
  // Mid-scale mottling, the most of what makes it read as concrete from standing height.
  let mottle = fbmGain(u, v, 24.0, 24.0, 4, 32, 0.55);
  k *= 1.0 + mottle * 0.06;
  // Dark specks: grit trodden in.
  let grit = voronoi(u, v, 300.0, 300.0, 33, 1.0);
  k *= 1.0 - (1.0 - smoothstep(0.05, 0.14, grit.f1)) * smoothstep(0.75, 0.95, grit.id) * 0.4;
  let pores = voronoi(u, v, 700.0, 700.0, 8, 1.0);
  let pore = (1.0 - smoothstep(0.08, 0.2, pores.f1)) * smoothstep(0.6, 0.9, pores.id);
  h -= pore * 0.35;
  k *= 1.0 - pore * 0.25;

  var rough = 0.62 - burnish * 0.08 + grain * 0.05 + tone * 0.04;
  var ao = 1.0;

  // Damp patches, darker and duller-sheened, round leaks and mopped spills.
  let dampN = fbm01(u, v, 4.0, 4.0, 5, 9) + 0.15 * fbm(u, v, 24.0, 24.0, 2, 10);
  let damp = smoothstep(0.7, 0.92, dampN);
  k *= 1.0 - damp * 0.12;
  rough = mix(rough, 0.42, damp * 0.8);

  // Ground-in grime in low spots, and dust in the pores.
  let grime = smoothstep(0.45, 0.75, fbm01(u, v, 12.0, 12.0, 4, 12)) * 0.08;
  k *= 1.0 - grime;

  // Hairline shrinkage cracks: borders of warped cells, kept only in stretches.
  let wu = u + fbm(u, v, 6.0, 6.0, 3, 13) * 0.025;
  let wv = v + fbm(u, v, 6.0, 6.0, 3, 14) * 0.025;
  let big = voronoiEdges(wu, wv, 3.0, 3.0, 15, 1.0);
  let crackKeep = smoothstep(0.55, 0.7, fbm01(u, v, 4.0, 4.0, 3, 16));
  let crackW = (0.35 + 0.6 * fbm01(u, v, 40.0, 40.0, 2, 17)) / (TILE / 3.0); // in cells
  let crack = crackKeep * (1.0 - smoothstep(crackW * 0.4, crackW, big.edge));
  // Finer branches off them.
  let small = voronoiEdges(wu, wv, 11.0, 11.0, 18, 1.0);
  let branchKeep = smoothstep(0.62, 0.75, fbm01(u, v, 9.0, 9.0, 3, 19)) * crackKeep;
  let branch = branchKeep * (1.0 - smoothstep(0.0001, 0.0011, small.edge / 11.0));
  let cracks = max(crack, branch * 0.7);
  k *= 1.0 - cracks * 0.55;
  h -= cracks * 0.6;
  ao *= 1.0 - cracks * 0.4;

  // Wheel marks: straight scuffs, and arcs where something turned.
  let scuffs = scratches(u, v, 6.0, 1, 20, 0.12, 0.003, 0.0, PI) * 0.3;
  let scuffs2 = scratches(u, v, 14.0, 1, 21, 0.04, 0.0016, 0.0, PI) * 0.25;
  var rubber = max(scuffs, scuffs2);
  for (var i = 0u; i < spots(ARCS); i++) {
    let s = spot(ARCS, i);
    if (!near(s, u, v, 16.0)) {
      continue;
    }
    let du = wrapDelta(u, s.u);
    let dv = wrapDelta(v, s.v);
    let r = length(vec2f(du, dv));
    let across = abs(r - s.a);
    if (across > s.b) {
      continue;
    }
    var ang = atan2(dv, du) - s.c;
    ang -= roundUp(ang / TAU) * TAU;
    let span = s.d;
    if (abs(ang) > span) {
      continue;
    }
    let ends = smoothstep(span, span * 0.3, abs(ang));
    // Tread and skid: streaks along the mark, broken up across it.
    let along = ang * s.a * TILE;
    let streaky = 0.35 + 0.65 * valueAt(along / 400.0, (across / s.b) * 6.0, 22) *
      valueAt(along / 60.0, (across / s.b) * 3.0, 29);
    let mark = (1.0 - smoothstep(s.b * 0.4, s.b, across)) * ends * streaky * s.e * 0.9;
    rubber = max(rubber, mark);
  }
  rubber *= 0.6 + 0.4 * fbm01(u, v, 30.0, 30.0, 2, 23);
  col = blend(col, RUBBER, rubber * 0.6);
  rough = mix(rough, 0.5, rubber * 0.5);

  // Repairs, a shade off the slab and smoother, with a dark seam round them.
  for (var i = 0u; i < spots(PATCHES); i++) {
    let s = spot(PATCHES, i);
    if (!near(s, u, v, 16.0)) {
      continue;
    }
    let du = abs(wrapDelta(u, s.u));
    let dv = abs(wrapDelta(v, s.v));
    let out = max(du - s.a, dv - s.b) * TILE; // mm outside the edge
    if (out > 3.0) {
      continue;
    }
    let inside = 1.0 - smoothstep(-1.0, 0.0, out);
    col = blend(col, PATCH, inside * (0.6 + 0.3 * s.c));
    let patchGrain = value(u, v, 800.0, 800.0, 34) - 0.5;
    k = mix(k, 1.0 + fbm(u, v, 30.0, 30.0, 3, i32(s.d)) * 0.05 + patchGrain * 0.12, inside);
    rough = mix(rough, 0.55 + 0.2 * s.c, inside);
    h = mix(h, 0.3, inside);
    let seam = 1.0 - smoothstep(0.5, 2.5, abs(out));
    k *= 1.0 - seam * 0.45;
    h -= seam * 1.2;
  }

  // Oil and drink stains, dark and slightly glossy.
  for (var i = 0u; i < spots(STAINS); i++) {
    let s = spot(STAINS, i);
    if (!near(s, u, v, 16.0)) {
      continue;
    }
    let du = wrapDelta(u, s.u);
    let dv = wrapDelta(v, s.v);
    let wob = 1.0 + 0.5 * fbmGain(du / s.a / 4.0 + 0.5, dv / s.a / 4.0 + 0.5, 4.0, 4.0, 5, i32(s.b), 0.6);
    let d = length(vec2f(du, dv)) / (s.a * wob);
    let stain = 1.0 - smoothstep(0.75, 1.0, d);
    if (stain <= 0.0) {
      continue;
    }
    // Soaked in unevenly: a darker core, and a rim where it dried.
    let core = (1.0 - smoothstep(0.1, 0.7, d)) * (0.5 + 0.5 * fbm01(u, v, 200.0, 200.0, 3, 31));
    let ring = smoothstep(0.8, 0.97, d) * stain;
    let amount = (0.2 + 0.25 * s.c) * stain + core * 0.25 + ring * 0.12;
    col = blend(col, OIL, amount);
    rough = mix(rough, 0.35, stain * 0.6);
  }

  // Saw cuts, 4 mm wide, with ragged arrises where they've been knocked.
  let d = toCut(u, v);
  let ragged = fbm01(u, v, 160.0, 160.0, 3, 24);
  let cutW = 2.0 + ragged * 0.6;
  let arris = 1.0 - smoothstep(cutW, cutW + 1.5 + ragged * 3.0 * smoothstep(0.6, 0.9, ragged), d);
  var spall = 0.0;
  var spallDepth = 0.0;
  for (var i = 0u; i < spots(SPALLS); i++) {
    let s = spot(SPALLS, i);
    if (!near(s, u, v, 32.0)) {
      continue;
    }
    let du = wrapDelta(u, s.u);
    let dv = wrapDelta(v, s.v);
    let n = fbm(du / s.a / 3.0 + 0.5, dv / s.a / 3.0 + 0.5, 5.0, 5.0, 3, i32(s.b));
    let r = length(vec2f(du, dv)) / s.a + n * 0.6;
    let inside = 1.0 - smoothstep(0.85, 1.0, r);
    if (inside > spall) {
      spall = inside;
      spallDepth = (1.0 - r) * 3.0;
    }
  }
  let chipped = max(spall, arris * 0.9);
  if (chipped > 0.0) {
    // Aggregate: stones in a darker matrix.
    let st = voronoi(u, v, 180.0, 180.0, 25, 0.9);
    let stoneSize = 0.35 + 0.15 * st.id2;
    let stone = 1.0 - smoothstep(stoneSize, stoneSize + 0.12, st.f1);
    var stones = array(hex(0x9a958d), hex(0x6f6a64), hex(0xa89f92), hex(0x5c5955), hex(0x857a6e));
    let pick = stones[u32(floor(st.id * 5.0))];
    let inner = blend(hex(0x6c6862), pick, stone);
    col = blend(col, inner, chipped);
    k = mix(k, 0.9 + 0.2 * value(u, v, 900.0, 900.0, 26), chipped);
    h = mix(h, -0.8 - min(2.5, spallDepth) + stone * 0.5, chipped);
    rough = mix(rough, 0.88, chipped);
  }
  // Salt bloom: harbour damp drawing salts out along cracks and cuts.
  let bloomNear = max(cracks * 0.6, 1.0 - smoothstep(cutW, cutW + 30.0, d));
  let bloom = bloomNear * smoothstep(0.55, 0.8, fbm01(u, v, 40.0, 40.0, 4, 30)) * 0.5;
  col = blend(col, FLOOR_SALT, bloom * 0.5);
  rough = mix(rough, 0.9, bloom);

  // The cut itself: an open dark groove with dust in it.
  let groove = 1.0 - smoothstep(cutW - 0.6, cutW + 0.4, d);
  if (groove > 0.0) {
    col = blend(col, hex(0x3a3835), groove);
    h = mix(h, -6.0, groove);
    ao *= 1.0 - groove * 0.7;
    rough = mix(rough, 0.95, groove);
  }

  setColour(o, col, clamp(k, 0.0, 1.4));
  o.h = h;
  o.ao = ao;
  o.rough = clamp(rough, 0.05, 1.0);
  o.metal = 0.0;
}
