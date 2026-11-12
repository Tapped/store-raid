// Glacier-smoothed gneiss, 4 m square, for the valley sides and bedrock: v runs up the slope.
// Warped banding of pale felsic and dark mica-rich layers, feldspar speckle, broad smooth swells
// the ice left, fracture joints in two sets with a step across them, moss in the cracks and
// hollows, lichen in pale grey-green and mustard rosettes, and dark water streaks running down.

const CAVITY = vec2f(30.0, 0.7);
const TILE_M = 4.0;
const TILE = 4000.0; // mm
const ROCK = hex(0x6f6d68);
const ROCK_DARK = hex(0x4c4a47);
const ROCK_PALE = hex(0x8c8880);
const FELDSPAR = hex(0xa59a8c);
const MICA = hex(0x2a2826);
const LICHEN_GREY = hex(0x9aa07a);
const LICHEN_MUSTARD = hex(0xc2b45a);
const STREAK = hex(0x2b2a26);

const JOINTS = 0u;

fn setup() {
  var r = random(31);
  // Two sets: one steep, one dipping across, each a few long cracks and some short ones.
  for (var i = 0; i < 16; i++) {
    let steep = i < 7;
    var a: f32;
    if (steep) {
      a = 1.45 + (next(&r) - 0.5) * 0.35;
    } else {
      a = 0.28 + (next(&r) - 0.5) * 0.4;
    }
    let len = (0.25 + next(&r) * 0.6);
    let width = (2.0 + next(&r) * 9.0) / TILE;
    let u = next(&r);
    let v = next(&r);
    place(JOINTS, Spot(u, v, len * 0.5 + 0.06, a, len, width, next(&r) * 100.0, next(&r)));
  }
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // The ice-smoothed form: broad swells, polished, with a little fine relief.
  let swell = fbm(u, v, 2.0, 2.0, 4, 701);
  let form = swell * 90.0 + fbm(u, v, 7.0, 7.0, 3, 702) * 12.0;

  // Banding: layers along a gentle dip, folded by warping.
  let wu = u + fbm(u, v, 2.0, 2.0, 4, 703) * 0.12;
  let wv = v + fbm(u, v, 3.0, 3.0, 4, 704) * 0.08;
  let layer = wv * 26.0 + wu * 5.0 + fbm(wu, wv, 6.0, 6.0, 3, 705) * 1.5;
  let band = fract(layer);
  let bandId = hash(i32(floor(layer)), 3, 706);
  let thick = smoothstep(0.2, 0.8, fbm01(u, v, 8.0, 3.0, 3, 707));
  // Dark mica-rich bands, pale felsic ones, most in between.
  var col = ROCK;
  if (bandId < 0.3) {
    col = blend(ROCK, ROCK_DARK, 0.85 * smoothstep(0.0, 0.2, band) * smoothstep(1.0, 0.7 - thick * 0.3, band));
  } else if (bandId > 0.78) {
    col = blend(ROCK, ROCK_PALE, 0.8 * smoothstep(0.0, 0.15, band) * smoothstep(1.0, 0.8, band));
  }
  // Thin streaky laminae inside.
  let lam = sin(layer * TAU * 5.0 + fbm(wu, wv, 30.0, 30.0, 2, 708) * 3.0);
  col *= 1.0 + lam * 0.04;

  // Grains: feldspar and quartz pale, mica dark.
  let gr = voronoi(wu, wv, per(TILE_M, 180.0), per(TILE_M, 220.0), 709, 1.0);
  let grain = 1.0 - smoothstep(0.25, 0.6, gr.f1);
  if (gr.id > 0.82) {
    col = blend(col, FELDSPAR, grain * 0.55);
  } else if (gr.id < 0.12 + (1.0 - bandId) * 0.1) {
    col = blend(col, MICA, grain * 0.6);
  }
  let fine = value(u, v, per(TILE_M, 1200.0), per(TILE_M, 1200.0), 710);
  col *= 0.9 + 0.2 * fine;
  // Weathered skin: the polish dulled and stained in broad patches.
  let weather = fbm01(u, v, 3.0, 3.0, 4, 711);
  col = blend(col, hex(0x5e5a52), smoothstep(0.45, 0.8, weather) * 0.4);
  // Exfoliation sheets: the surface comes away in thin plates, leaving low rounded steps.
  let sw = u + fbm(u, v, 4.0, 4.0, 3, 727) * 0.03;
  let sv2 = v + fbm(u, v, 4.0, 4.0, 3, 728) * 0.03;
  let sheet = voronoiEdges(sw, sv2, 3.0, 4.0, 729, 0.9);
  let sheetStep = (sheet.id - 0.5) * 22.0 * smoothstep(0.0, 0.05, sheet.edge) +
    (sheet.id2 - 0.5) * 22.0 * (1.0 - smoothstep(0.0, 0.05, sheet.edge));
  let lip = 1.0 - smoothstep(0.0, 0.012, sheet.edge);
  col *= 1.0 - lip * 0.05;
  var h = form + sheetStep + fine * 0.3 + grain * 0.15 + lam * 0.03 + fine * smoothstep(0.45, 0.8, weather) * 0.5;
  var rough = 0.62 + fine * 0.1 - smoothstep(0.3, -0.5, swell) * 0.0;

  // Joints: open cracks with rounded lips, the far side stepped down, broken where they wander.
  var crack = 0.0;
  var nearCrack = 0.0;
  for (var i = 0u; i < spots(JOINTS); i++) {
    let s = spot(JOINTS, i);
    if (!near(s, u, v, 8.0)) {
      continue;
    }
    let d = offset(s, u, v);
    let ca = cos(s.a);
    let sa = sin(s.a);
    let along = d.x * ca + d.y * sa;
    let half = s.b * 0.5;
    if (abs(along) > half + 0.02) {
      continue;
    }
    let wig = fbm(along * 3.0 + s.d * 0.1, 0.3 + s.e, 6.0, 2.0, 4, 712) * 0.006;
    let across = -d.x * sa + d.y * ca + wig;
    let ends = smoothstep(half, half * 0.6, abs(along));
    let w = s.c * (0.5 + 0.8 * fbm01(along * 4.0 + s.d, 0.5, 8.0, 2.0, 3, 713)) * ends;
    let x = abs(across) * TILE; // mm
    let wMm = w * TILE;
    let c = (1.0 - smoothstep(wMm * 0.5, wMm, x)) * ends;
    crack = max(crack, c);
    nearCrack = max(nearCrack, (1.0 - smoothstep(wMm, wMm + 18.0, x)) * ends);
    // A step across the joint: one side sits lower, fading away from it.
    let step = select(-1.0, 1.0, across > 0.0) * (s.e - 0.5) * 30.0 * ends *
      (1.0 - smoothstep(0.0, 250.0, x));
    h += step - (1.0 - smoothstep(wMm, wMm + 25.0, x)) * 6.0 * ends;
  }
  if (crack > 0.0) {
    h -= crack * 35.0;
    col = blend(col, hex(0x1e1d1b), crack * 0.85);
    rough = mix(rough, 0.95, crack);
  }

  // Dark water streaks running down from cracks, ledges and nowhere in particular.
  let streakN = fbm01(u, v, per(TILE_M, 10.0), 2.0, 4, 714) * 0.6 +
    fbm01(u, v, per(TILE_M, 30.0), 3.0, 3, 715) * 0.4;
  let streakZone = smoothstep(0.4, 0.75, fbm01(u, v, 3.0, 1.0, 3, 716) + nearCrack * 0.3);
  let streak = smoothstep(0.48, 0.72, streakN) * streakZone;
  col = blend(col, STREAK, streak * 0.65);
  rough = mix(rough, 0.32, streak * 0.8);
  // Wet green-black algae in the wettest.
  col = blend(col, hex(0x262a1c), streak * smoothstep(0.7, 0.9, streakN) * 0.4);

  // Lichen: rosettes, pale grey-green mostly, some mustard, crusted and cracked into plates; not
  // where the water runs.
  let lc = lichenCrust(u, v, TILE_M, 720, 0.32 * (1.0 - streak) * smoothstep(0.2, 0.6, fbm01(u, v, 3.0, 3.0, 3, 726)) + 0.05);
  if (lc.x > 0.0) {
    var lcol = select(LICHEN_GREY, blend(LICHEN_MUSTARD, LICHEN_GREY, 0.3), fract(lc.y * 7.0) > 0.75);
    lcol *= 0.75 + 0.3 * fract(lc.y * 13.0);
    lcol *= 1.0 - lc.z * 0.35;
    let rim = smoothstep(0.6, 1.0, lc.x) ;
    col = blend(col, lcol, lc.x * (0.65 + 0.3 * fract(lc.y * 3.1)));
    h += lc.x * (0.4 - lc.z * 0.3);
    rough = mix(rough, 0.88, lc.x);
    // Small dark crust lichens too, as specks.
    let _r = rim;
  }
  let dots = voronoi(u, v, per(TILE_M, 40.0), per(TILE_M, 40.0), 721, 1.0);
  let dot = (1.0 - smoothstep(0.08, 0.2, dots.f1)) * step(0.7, dots.id);
  col = blend(col, hex(0x34332c), dot * 0.6);

  // Moss in the cracks and down in hollows, spilling out of the joints.
  let hollow = smoothstep(-0.45, -0.8, swell + fbm(u, v, 10.0, 10.0, 3, 722) * 0.2);
  let mossAmt = saturate(max(nearCrack * 1.2, hollow * 0.3) *
    smoothstep(0.45, 0.62, fbm01(u, v, per(TILE_M, 5.0), per(TILE_M, 5.0), 4, 723) + nearCrack * 0.05));
  if (mossAmt > 0.05) {
    let mb = mossBed(u, v, TILE_M, 724);
    let m = smoothstep(0.1, 0.5, mossAmt + (mb.y - 0.85) * 0.5);
    if (m > 0.0) {
      col = blend(col, mossColour(mb.y, fbm01(u, v, 20.0, 20.0, 2, 725) * 0.6), m);
      h = mix(h, max(h, form - 20.0 + mb.x * 2.0 + m * 10.0) , m);
      rough = mix(rough, 0.9, m);
    }
  }

  setColour(o, col, 1.0);
  o.h = h;
  o.rough = clamp(rough, 0.05, 1.0);
  o.metal = 0.0;
}
