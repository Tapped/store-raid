// An old farm track, 3.2 m across: u runs along it, v across. Two wheel ruts at v 0.25 and 0.75,
// sunk and worn to fine damp grit with stones trodden flat into them; coarser gravel between and
// outside, grass on the crown (v 0.5) and creeping in from the verges (v 0 and 1). Tiled across,
// verge meets verge. A few birch leaves, moss where the grass is.

const CAVITY = vec2f(5.0, 0.9);
const TILE_M = 3.2;
const TILE = 3200.0; // mm
const SAND = hex(0x5b5244);
const SAND_DARK = hex(0x403a31);
const GRIT = hex(0x6a645a);
const GRASS_GREEN = hex(0x46562a);
const GRASS_OLIVE = hex(0x5f6431);
const STRAW = hex(0x8a7a45);

// How far into a rut (1 in the middle, 0 outside), the crown's grass strip and the verges, all
// from v and a slow wander along the track.
struct Lanes {
  rut: f32,
  floor: f32,
  crown: f32,
  verge: f32,
}

fn lanes(u: f32, v: f32) -> Lanes {
  let wander = fbm(u, 0.0, 3.0, 1.0, 3, 301) * 70.0 + fbm(u, 0.0, 11.0, 1.0, 2, 302) * 18.0;
  let width = 190.0 + fbm(u, 0.0, 5.0, 1.0, 2, 303) * 45.0;
  let a = abs((v - 0.25) * TILE - wander);
  let b = abs((v - 0.75) * TILE - wander * 0.9 + 10.0);
  let d = min(a, b);
  let rut = 1.0 - smoothstep(width * 0.55, width * 1.35, d);
  let floor = 1.0 - smoothstep(width * 0.2, width * 0.85, d);
  let c = abs((v - 0.5) * TILE - wander * 0.95);
  let crown = 1.0 - smoothstep(150.0, 420.0, c + fbm(u, v, 7.0, 3.0, 3, 304) * 160.0);
  let e = min(v, 1.0 - v) * TILE;
  let verge = 1.0 - smoothstep(120.0, 520.0, e + fbm(u, v, 6.0, 3.0, 3, 305) * 220.0);
  return Lanes(rut, floor, crown, verge);
}

const POTHOLES = 0u;

fn setup() {
  var r = random(17);
  for (var i = 0; i < 18; i++) {
    // Most in the ruts, stretched along the track; a few anywhere.
    var v = next(&r);
    let inRut = next(&r) < 0.7;
    if (inRut) {
      v = select(0.25, 0.75, next(&r) < 0.5) + (next(&r) - 0.5) * 0.05;
    }
    let size = (90.0 + next(&r) * 260.0) / TILE;
    let stretch = 1.3 + next(&r) * 1.2;
    let depth = 10.0 + next(&r) * 25.0;
    place(POTHOLES, Spot(next(&r), v, size * stretch * 1.4, size, stretch, depth, next(&r) * 900.0, 0.0));
  }
}

// How deep the potholes are here, mm, and how much of one the texel is in (0 to 1).
fn potholes(u: f32, v: f32) -> vec2f {
  var depth = 0.0;
  var inside = 0.0;
  for (var i = 0u; i < spots(POTHOLES); i++) {
    let s = spot(POTHOLES, i);
    if (!near(s, u, v, 16.0)) {
      continue;
    }
    let d = offset(s, u, v);
    let q = vec2f(d.x / s.b, d.y) / s.a;
    let wob = fbm(q.x * 0.25 + 0.5, q.y * 0.25 + 0.5, 4.0, 4.0, 3, i32(s.d)) * 0.35;
    let r = length(q) + wob;
    let bowl = 1.0 - smoothstep(0.0, 1.0, r);
    depth = max(depth, s.c * bowl * bowl * (3.0 - 2.0 * bowl));
    inside = max(inside, 1.0 - smoothstep(0.7, 1.0, r));
  }
  return vec2f(depth, inside);
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let ln = lanes(u, v);
  // Where grass gets in: the crown and verges, and odd patches along the track.
  let patches = smoothstep(0.62, 0.8, fbm01(u, v, 9.0, 9.0, 4, 310));
  let grassy = saturate(max(max(ln.crown, ln.verge), patches * 0.7) * (1.0 - ln.rut * 0.9));

  // The ground: a broad unevenness, the ruts sunk, soft potholes.
  let broad = fbm(u, v, 4.0, 4.0, 4, 311);
  let ph = potholes(u, v);
  let pot = ph.y;
  var ground = broad * 10.0 - ln.rut * 38.0 - ln.floor * 6.0 - ph.x + grassy * 8.0;
  // Fine sand and grit in the matrix.
  let e = earthBed(u, v, TILE_M, 313);
  let sandGrain = value(u, v, per(TILE_M, 900.0), per(TILE_M, 900.0), 314);
  ground += e.x * 0.6 + sandGrain * 0.35;

  // Stones, pressed into the ground: deepest in the ruts, where wheels tread them flat.
  let press = ln.rut * 1.0;
  var big = stoneLayer(48.0, 320);
  big.fill = 0.32;
  big.size = vec2f(0.3, 0.85);
  big.bias = 1.8;
  big.lobes = 0.2;
  big.sharp = 3.0;
  big.height = 0.5;
  big.sink = 0.55;
  let sb = stoneField(u, v, big, TILE);
  var mid = stoneLayer(128.0, 330);
  mid.count = 2;
  mid.fill = 0.7;
  mid.size = vec2f(0.3, 0.8);
  mid.bias = 1.4;
  mid.lobes = 0.25;
  mid.sharp = 3.0;
  mid.height = 0.55;
  mid.sink = 0.5;
  let sm = stoneField(u, v, mid, TILE);
  var fine = stoneLayer(400.0, 340);
  fine.count = 2;
  fine.fill = 0.75;
  fine.size = vec2f(0.35, 0.9);
  fine.lobes = 0.3;
  fine.height = 0.6;
  fine.sink = 0.3;
  let sf = stoneField(u, v, fine, TILE);

  var h = ground;
  var col = blend(SAND, SAND_DARK, saturate(0.35 + broad * 0.4 + ln.rut * 0.25));
  col *= e.y * (0.9 + 0.2 * sandGrain);
  var rough = 0.86;
  var top = 0; // 0 ground, 1..3 stones
  var stoneId = 0.0;
  var stoneId2 = 0.0;
  var stoneRho = 1.0;
  // Fine grit fills more of the ruts; bigger stones keep to the crown and shoulders.
  let hf = sf.h * (1.0 + ln.floor * 0.3) - 0.4;
  if (sf.id >= 0.0 && ground + hf > h) {
    h = ground + hf;
    top = 3;
    stoneId = sf.id;
    stoneId2 = sf.id2;
    stoneRho = sf.rho;
  }
  let hm = min(sm.h, mix(sm.h, 0.8 + sm.r * 0.03, press)) - grassy * 3.0 - pot * 4.0;
  if (sm.id >= 0.0 && ground + hm > h) {
    h = ground + hm;
    top = 2;
    stoneId = sm.id;
    stoneId2 = sm.id2;
    stoneRho = sm.rho;
  }
  let hb = min(sb.h, mix(sb.h, 0.6 + sb.r * 0.03, press)) - grassy * 6.0 - pot * 6.0;
  if (sb.id >= 0.0 && ground + hb > h) {
    h = ground + hb;
    top = 1;
    stoneId = sb.id;
    stoneId2 = sb.id2;
    stoneRho = sb.rho;
  }
  if (top > 0) {
    var sc = rockColour(stoneId, stoneId2);
    if (top == 3) {
      sc = blend(sc, GRIT, 0.4);
    }
    // Weathered skin: grain, a dusting of sand towards the rim, flattened tops polished by wheels.
    let grain = value(u, v, per(TILE_M, 1400.0), per(TILE_M, 1400.0), 350 + top);
    sc *= 0.88 + 0.24 * grain;
    sc = blend(sc, SAND, smoothstep(0.5, 1.0, stoneRho) * 0.5);
    col = sc;
    rough = 0.62 + grain * 0.1 - ln.rut * 0.12;
    // Wheels polish the flattened tops and grind sand round them.
    sc = blend(sc, SAND_DARK, ln.floor * 0.25);
  }

  // Damp: low spots and the rut floors hold water; puddle film in the deepest.
  let low = saturate(-(h + 20.0) / 30.0);
  let damp = saturate(ln.floor * 0.6 + pot * 0.8 + low * 0.5 + fbm01(u, v, 12.0, 12.0, 3, 360) * 0.3);
  col *= 1.0 - damp * 0.3;
  rough = mix(rough, 0.38, damp * 0.7);
  let puddle = smoothstep(0.55, 0.8, ph.x / 25.0 + fbm01(u, v, 18.0, 18.0, 3, 361) * 0.25);
  rough = mix(rough, 0.12, puddle);
  col *= 1.0 - puddle * 0.2;

  // Moss on the ground where grass is, under the blades.
  let mb = mossBed(u, v, TILE_M, 370);
  let mossy = smoothstep(0.35, 0.8, grassy * (0.6 + 0.6 * fbm01(u, v, 14.0, 14.0, 3, 371)));
  if (mossy > 0.0 && top != 1) {
    let mh = ground + mb.x * mossy + mossy * 2.0;
    if (mh > h) {
      h = mh;
      col = blend(col, mossColour(mb.y * 0.9, fbm01(u, v, 20.0, 20.0, 2, 372) * 0.5), mossy);
      rough = mix(rough, 0.92, mossy);
    }
  }

  // Grass: a green turf of short blades radiating from tufts, with dead straw laid over it.
  var g = strandLayer(30.0, 380);
  g.count = 50;
  g.len = vec2f(0.35, 0.9);
  g.width = 0.021;
  g.bend = 0.35;
  g.tuft = 13.0;
  g.radial = 0.8;
  g.swirl = 1.2;
  g.mound = 7.0;
  g.thick = 0.9;
  g.rise = 4.0;
  g.layers = 1.5;
  g.round = 0.3;
  let st = strandField(u, v, g);
  var dead = strandLayer(16.0, 385);
  dead.count = 26;
  dead.len = vec2f(0.5, 1.0);
  dead.width = 0.011;
  dead.bend = 0.25;
  dead.flow = 2.5;
  dead.flowFreq = 5.0;
  dead.angle = 0.3;
  dead.spread = 0.5;
  dead.thick = 0.8;
  dead.rise = 3.0;
  dead.layers = 2.0;
  dead.round = 0.4;
  let sd = strandField(u, v, dead);
  if (st.id >= 0.0) {
    // Only roots where it's grassy grow: gate each blade by its root.
    let rl = lanes(st.at.x, st.at.y);
    let rootGrass = saturate(max(max(rl.crown, rl.verge), patches * 0.7) * (1.0 - rl.rut * 0.9));
    let clump = 1.0 - smoothstep(0.25, 0.7, tuftDistance(st.at, g));
    if (st.id2 < rootGrass * (0.25 + clump) * 1.4 - 0.1) {
      let gh = ground + 3.0 + st.h;
      if (gh > h) {
        h = gh;
        var gc = blend(GRASS_GREEN, GRASS_OLIVE, st.id);
        gc = blend(gc, STRAW, smoothstep(0.6, 1.0, st.t) * smoothstep(0.5, 1.0, st.id2));
        gc *= 0.8 + 0.3 * st.id2 + 0.1 * (1.0 - abs(st.s));
        col = gc;
        rough = 0.68;
        top = 4;
      }
    }
  }
  if (sd.id >= 0.0) {
    let rl = lanes(sd.at.x, sd.at.y);
    let rootGrass = saturate(max(max(rl.crown, rl.verge), patches * 0.6) * (1.0 - rl.rut));
    if (sd.id2 < rootGrass * 0.75 - 0.25) {
      let gh = ground + 4.0 + sd.h;
      if (gh > h) {
        h = gh;
        var gc = blend(STRAW, DEAD_GRASS_DARK, sd.id);
        gc = blend(gc, hex(0x9c8c58), smoothstep(0.6, 1.0, sd.t) * 0.5);
        gc *= 0.75 + 0.3 * sd.id2 + 0.1 * (1.0 - abs(sd.s));
        col = gc;
        rough = 0.75;
        top = 4;
      }
    }
  }

  // Fallen birch leaves, a few, flattened and wet.
  var lv = Leaves(48.0, 1, 0.05, vec2f(0.6, 0.9), 0.62, 0.8, 0.8, 390);
  let lf = leafLitter(u, v, lv, TILE);
  if (lf.id >= 0.0) {
    let lh = ground + 1.2 + lf.h + 6.0 * grassy;
    if (lh > h) {
      h = lh;
      col = birchLeafColour(lf, u, v);
      rough = 0.42;
    }
  }

  setColour(o, col, 1.0);
  o.h = h;
  o.rough = clamp(rough, 0.05, 1.0);
  o.metal = 0.0;
}
