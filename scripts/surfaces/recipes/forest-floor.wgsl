// The floor under spruce and birch, 3 m square: a deep litter of brown spruce needles on dark
// humus, fallen birch leaves rotting into it, twigs, spruce cones, cushions of moss, and roots
// snaking out of the ground and back under it.

const CAVITY = vec2f(10.0, 0.85);
const TILE_M = 3.0;
const TILE = 3000.0; // mm
const HUMUS = hex(0x2a2119);
const NEEDLE = hex(0x6b4a28);
const NEEDLE_RUST = hex(0x7d5430);
const NEEDLE_OLD = hex(0x4e3e2e);
const NEEDLE_GREEN = hex(0x4f5228);
const BARK = hex(0x4a3e33);
const BARK_PALE = hex(0x6e6152);
const ROOT = hex(0x4f3a28);
const CONE = hex(0x6a4526);
const CONE_DARK = hex(0x3e2817);

const ROOTS = 0u;
const sprigLayer = Tussocks(150.0, 22, 0.95, vec2f(0.45, 0.95), 0.05, 0.12, 0.25, 30.0, 0.35, 2.0, 0.5, 0.8, 0.4, 644);
const CONES = 1u;

fn setup() {
  var r = random(23);
  // Roots: random walks from off one side, wandering, thinning as they go, a few branching.
  for (var k = 0; k < 9; k++) {
    var p = vec2f(next(&r), next(&r));
    var a = next(&r) * TAU;
    var w = (14.0 + next(&r) * 26.0) / TILE;
    let steps = 26 + i32(next(&r) * 20.0);
    for (var i = 0; i < steps; i++) {
      a += (next(&r) - 0.5) * 0.7;
      let len = (50.0 + next(&r) * 40.0) / TILE;
      let q = p + vec2f(cos(a), sin(a)) * len;
      let w1 = w * 0.975;
      place(ROOTS, Spot(p.x - floor(p.x), p.y - floor(p.y), len + w * 2.0, q.x - p.x, q.y - p.y, w, w1, f32(k * 1000 + i)));
      p = q;
      w = w1;
    }
  }
  // Cones, lying any way, some in twos and threes under a tree.
  for (var k = 0; k < 22; k++) {
    let len = (90.0 + next(&r) * 50.0) / TILE;
    let u = next(&r);
    let v = next(&r);
    place(CONES, Spot(u, v, len * 0.6, len, next(&r) * TAU, next(&r), next(&r), 0.0));
  }
}

// How far (u, v) is from a root segment, along it (0 to 1) and across it (in repeats).
fn segment(s: Spot, u: f32, v: f32) -> vec2f {
  let d = offset(s, u, v);
  let ab = vec2f(s.a, s.b);
  let t = clamp(dot(d, ab) / dot(ab, ab), 0.0, 1.0);
  return vec2f(t, length(d - ab * t));
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // Humus and the slow rise and fall of the ground.
  let e = earthBed(u, v, TILE_M, 601);
  let broad = fbm(u, v, 3.0, 3.0, 4, 602);
  let soil = broad * 30.0 + e.x;
  // Roots: half-buried, coming up out of the humus and diving back; the litter lies over them.
  var rootH = -1e9;
  var rootX = 1.0;
  var rootStrands = 0.0;
  for (var i = 0u; i < spots(ROOTS); i++) {
    let s = spot(ROOTS, i);
    if (!near(s, u, v, 32.0)) {
      continue;
    }
    let g = segment(s, u, v);
    let w = mix(s.c, s.d, g.x);
    if (g.y >= w) {
      continue;
    }
    let x = g.y / w;
    let root = floor(s.e / 1000.0);
    let along = (s.e - root * 1000.0 + g.x) * 0.05 + root * 0.37;
    let rise = valueAt(along * 3.0, root * 5.0, 660) * 0.65 + valueAt(along * 9.0, root * 5.0, 662) * 0.35;
    let emerge = smoothstep(0.35, 0.6, rise);
    let rh = -3.0 + pow(1.0 - x * x, 0.6) * w * TILE * 0.45 * emerge;
    if (rh > rootH) {
      rootH = rh;
      rootX = x;
      rootStrands = valueAt(along * 400.0, x * 4.0, 661);
    }
  }
  let onRoot = smoothstep(0.0, 3.0, rootH);
  let ground = max(soil, soil + rootH + rootStrands * 0.4);
  var h = ground;
  var col = HUMUS * e.y;
  var rough = 0.6;
  if (onRoot > 0.0) {
    let rc = blend(ROOT, BARK_PALE, 0.1 + 0.2 * rootStrands) * (0.65 + 0.35 * (1.0 - rootX * rootX));
    col = blend(col, rc, onRoot);
    rough = mix(rough, 0.7, onRoot);
  }

  // Needle litter: two layers, the older darker and matted, the fresh on top.
  var old = strandLayer(160.0, 610);
  old.count = 7;
  old.len = vec2f(0.6, 1.0);
  old.width = 0.05;
  old.taper = 0.2;
  old.bend = 0.2;
  old.round = 1.0;
  old.thick = 0.6;
  old.layers = 1.2;
  let so = strandField(u, v, old);
  if (so.id >= 0.0 && so.id2 > onRoot * 0.85 && ground + 0.5 + so.h > h) {
    h = ground + 0.5 + so.h;
    col = blend(NEEDLE_OLD, NEEDLE, so.id * 0.6) * (0.65 + 0.35 * so.id2);
    rough = 0.65;
  }
  var fresh = strandLayer(150.0, 620);
  fresh.count = 5;
  fresh.fill = 0.8;
  fresh.len = vec2f(0.6, 1.0);
  fresh.width = 0.055;
  fresh.taper = 0.25;
  fresh.bend = 0.15;
  fresh.round = 1.0;
  fresh.thick = 0.7;
  fresh.layers = 1.5;
  let sf = strandField(u, v, fresh);
  let freshGate = fbm01(u, v, 9.0, 9.0, 3, 621);
  if (sf.id >= 0.0 && sf.id2 < freshGate * 1.3 * (1.0 - onRoot * 0.7) && ground + 1.2 + sf.h > h) {
    h = ground + 1.2 + sf.h;
    var c = blend(NEEDLE, NEEDLE_RUST, sf.id);
    c = blend(c, NEEDLE_GREEN, smoothstep(0.9, 1.0, sf.id2) * 0.6);
    col = c * (0.8 + 0.3 * sf.id2) * (0.85 + 0.15 * (1.0 - abs(sf.s)));
    rough = 0.6;
  }

  // Birch leaves rotting into the litter: browner than in the meadow, flatter.
  var lv = Leaves(44.0, 1, 0.22, vec2f(0.65, 0.95), 0.7, 0.6, 2.0, 630);
  let lf = leafLitter(u, v, lv, TILE);
  if (lf.id >= 0.0 && lf.id2 < fbm01(lf.at.x, lf.at.y, 5.0, 5.0, 3, 631) * 1.4) {
    let lh = ground + 1.0 + lf.h;
    if (lh > h) {
      h = lh;
      col = blend(birchLeafColour(lf, u, v), hex(0x4a3420), 0.25 + 0.35 * lf.id2);
      rough = 0.45;
    }
  }

  // Moss cushions: lobed domes, fuzzy on top, swallowing the needles at their feet.
  var cu = stoneLayer(9.0, 640);
  cu.fill = 0.28;
  cu.size = vec2f(0.25, 0.85);
  cu.elong = 0.4;
  cu.lobes = 0.3;
  cu.sharp = 1.6;
  cu.height = 0.18;
  cu.sink = 0.1;
  let sc = stoneField(u, v, cu, TILE);
  let mb = mossBed(u, v, TILE_M, 641);
  let edgeFray = fbm01(u, v, per(TILE_M, 60.0), per(TILE_M, 60.0), 3, 642);
  let cushion = sc.h * smoothstep(0.0, 0.3, 1.0 - sc.rho);
  // At the edge the moss thins into sprigs among the needles rather than stopping.
  let sprigs = smoothstep(0.55, 0.85, mb.y + edgeFray * 0.3 - smoothstep(0.75, 1.05, sc.rho) * 0.6);
  if (sc.id >= 0.0 && sprigs > 0.0) {
    let mh = ground + cushion + mb.x * 0.9 * sprigs + 1.5 * sprigs;
    if (mh > h) {
      h = mh;
      let tone = fbm01(u, v, per(TILE_M, 25.0), per(TILE_M, 25.0), 3, 643);
      col = mossColour(mb.y * (0.7 + 0.4 * sc.id) * (0.8 + 0.4 * tone), sc.id2 * 0.5 + tone * 0.4);
      rough = 0.9;
      // Sprigs: tiny shoots in starry tufts over the cushion.
      let sp = tussocks(u, v, sprigLayer);
      if (sp.id >= 0.0 && sp.h > 0.6) {
        h += sp.h;
        let sprigCol = blend(hex(0x3a4a1f), hex(0x77782f), sp.id * (0.4 + 0.6 * tone)) * (0.6 + 0.6 * sp.up);
        col = blend(col, sprigCol, 0.8 * sprigs);
      } else {
        col *= 0.6;
      }
    }
  }

  // Twigs: thin round sticks lying across everything.
  var tw = strandLayer(8.0, 650);
  tw.count = 3;
  tw.fill = 0.55;
  tw.len = vec2f(0.35, 1.0);
  tw.width = 0.012;
  tw.taper = 0.5;
  tw.bend = 0.12;
  tw.round = 1.0;
  tw.thick = 4.0;
  tw.layers = 4.0;
  let st = strandField(u, v, tw);
  if (st.id >= 0.0 && ground + 3.0 + st.h > h) {
    h = ground + 3.0 + st.h;
    let bark = value(u, v, per(TILE_M, 800.0), per(TILE_M, 200.0), 651);
    col = blend(BARK, BARK_PALE, st.id * 0.4) * (0.75 + 0.35 * bark) * (0.7 + 0.3 * (1.0 - st.s * st.s));
    // A few lichen-pale birch twigs.
    col = blend(col, hex(0x8a877a), step(0.88, st.id2) * 0.35);
    rough = 0.8;
  }

  // Spruce cones: scales in a spiral, a dark gap under each.
  for (var i = 0u; i < spots(CONES); i++) {
    let s = spot(CONES, i);
    if (!near(s, u, v, 32.0)) {
      continue;
    }
    let d = toFrame(offset(s, u, v), s.b) / s.a;
    let t = d.x + 0.5;
    let w = 0.17 * pow(saturate(4.0 * t * (1.0 - t)), 0.45) * (1.1 - 0.25 * t);
    if (t < 0.0 || t > 1.0 || abs(d.y) >= w) {
      continue;
    }
    let y = d.y / w;
    let body = sqrt(1.0 - y * y);
    // Scales: a diamond grid wrapped round it.
    let su = t * 14.0 + y * 2.0;
    let sv = t * 14.0 - y * 2.0 + asin(clamp(y, -1.0, 1.0)) * 1.2;
    let cell = abs(fract(vec2f(su, sv)) - 0.5);
    let scale = 1.0 - smoothstep(0.25, 0.5, max(cell.x, cell.y));
    let lip = fract(su);
    let ch = ground + 2.0 + body * s.a * TILE * 0.15 + (scale * 0.6 + lip * 0.4) * 3.5 * body;
    if (ch > h) {
      h = ch;
      col = blend(CONE_DARK, CONE, scale * (0.4 + 0.6 * lip)) * (0.8 + 0.3 * s.c) * (0.6 + 0.4 * body);
      rough = 0.75;
    }
  }

  // Broad tone: drier, paler litter in drifts, darker humus showing in others.
  let drift = fbm(u, v, 4.0, 4.0, 4, 671);
  col *= 1.0 + drift * 0.18;

  // Damp: the hollows wetter and darker.
  let damp = smoothstep(0.0, -25.0, h - ground - 5.0 + broad * 10.0) * 0.5 +
    smoothstep(0.6, 0.85, fbm01(u, v, 5.0, 5.0, 3, 670)) * 0.4;
  col *= 1.0 - damp * 0.2;
  rough = mix(rough, 0.4, damp * 0.5);

  setColour(o, col, 1.0);
  o.h = h;
  o.rough = clamp(rough, 0.05, 1.0);
  o.metal = 0.0;
}
