// A river bed and bank, 2.5 m square: rounded cobbles of mixed rock packed tight, pebbles and
// gravel between them, wet sand in the lowest gaps. Everything wet: dark, saturated and glossy on
// the tops, silt and a film of algae down in the crevices.

const CAVITY = vec2f(14.0, 0.9);
const TILE_M = 2.5;
const TILE = 2500.0; // mm
const WET_SAND = hex(0x4a4236);
const SILT = hex(0x3a3628);
const ALGAE = hex(0x3c4224);
const QUARTZ = hex(0xb8b2a4);

// A stone's own skin: speckled grain, sometimes banded like gneiss, sometimes a quartz vein.
fn stoneSkin(st: Stone, u: f32, v: f32, seed: i32) -> vec4f {
  var c = rockColour(st.id, st.id2);
  let fine = value(u, v, per(TILE_M, 1600.0), per(TILE_M, 1600.0), seed);
  let speck = value(u, v, per(TILE_M, 600.0), per(TILE_M, 600.0), seed + 1);
  let rough_ = 0.06 + 0.3 * fract(st.id * 17.3);
  c *= 1.0 - rough_ * 0.5 + rough_ * fine;
  c *= 0.92 + 0.16 * value(u, v, per(TILE_M, 90.0), per(TILE_M, 90.0), seed + 2);
  // Granite-like ones: dark and pale grains.
  let granite = step(0.55, fract(st.id * 5.3));
  c *= 1.0 - granite * smoothstep(0.7, 0.85, speck) * 0.45;
  c = blend(c, QUARTZ, granite * smoothstep(0.78, 0.9, 1.0 - speck) * 0.4);
  // Banded ones: stripes across in their own frame, warped.
  let banded = step(0.85, fract(st.id * 9.1));
  let b = sin(st.local.y * (6.0 + 8.0 * st.id2) + sin(st.local.x * 2.0 + st.id * 20.0) * 1.5);
  c *= 1.0 - banded * smoothstep(0.3, 0.9, b) * 0.3;
  // The odd quartz vein right through.
  var vein = 0.0;
  if (fract(st.id * 13.7) > 0.9) {
    let a = st.id2 * TAU;
    let along = st.local.x * cos(a) - st.local.y * sin(a);
    let across = abs(st.local.x * sin(a) + st.local.y * cos(a) - (st.id - 0.5) * 0.6 +
      sin(along * 5.0 + st.id * 30.0) * 0.08);
    let wide = 0.03 + 0.06 * fract(st.id * 31.0);
    vein = 1.0 - smoothstep(wide, wide + 0.04, across);
    c = blend(c, QUARTZ, vein * 0.8);
  }
  return vec4f(c, fine);
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // The bed: wet sand with fine grit, a little ripple and unevenness.
  let broad = fbm(u, v, 3.0, 3.0, 4, 501);
  let grain = value(u, v, per(TILE_M, 1300.0), per(TILE_M, 1300.0), 502);
  let ground = broad * 25.0 + grain * 0.4 + fbm(u, v, 20.0, 20.0, 2, 503) * 2.0;
  var h = ground;
  var col = WET_SAND * (0.85 + 0.25 * grain);
  var rough = 0.42 + grain * 0.1;
  var cavityTint = 0.0;

  // Gravel, pebbles and cobbles; the cobbles fewer where the bed is high (the bank).
  var gr = stoneLayer(180.0, 510);
  gr.count = 2;
  gr.fill = 0.8;
  gr.size = vec2f(0.35, 0.9);
  gr.elong = 0.35;
  gr.lobes = 0.12;
  gr.height = 0.55;
  gr.sink = 0.3;
  gr.stack = 0.3;
  let sg = stoneField(u, v, gr, TILE);
  var pb = stoneLayer(56.0, 520);
  pb.count = 2;
  pb.fill = 0.75;
  pb.size = vec2f(0.35, 0.9);
  pb.bias = 1.3;
  pb.elong = 0.45;
  pb.lobes = 0.08;
  pb.sharp = 2.2;
  pb.height = 0.5;
  pb.sink = 0.3;
  pb.stack = 0.3;
  pb.sharp = 3.0;
  let sp = stoneField(u, v, pb, TILE);
  var cb = stoneLayer(17.0, 530);
  cb.count = 2;
  cb.fill = 0.85;
  cb.size = vec2f(0.4, 0.95);
  cb.bias = 1.2;
  cb.elong = 0.45;
  cb.lobes = 0.07;
  cb.sharp = 2.3;
  cb.height = 0.45;
  cb.sink = 0.35;
  cb.stack = 0.18;
  cb.sharp = 3.0;
  let sc = stoneField(u, v, cb, TILE);

  var top = Stone(0.0, -1.0, 0.0, 1.0, 0.0, vec2f(0.0), vec2f(0.0));
  var layer = 0;
  if (sg.id >= 0.0 && ground + sg.h > h) {
    h = ground + sg.h;
    top = sg;
    layer = 1;
  }
  if (sp.id >= 0.0 && ground + sp.h > h) {
    h = ground + sp.h;
    top = sp;
    layer = 2;
  }
  let bank = smoothstep(-0.2, 0.6, broad);
  if (sc.id >= 0.0 && sc.id2 > bank * 0.5 && ground + sc.h > h) {
    h = ground + sc.h;
    top = sc;
    layer = 3;
  }
  if (layer > 0) {
    let skin = stoneSkin(top, u, v, 540 + layer * 7);
    col = skin.rgb;
    // Wet: glossy on top, a little rougher towards the rim where silt clings.
    rough = 0.22 + 0.12 * skin.w + smoothstep(0.6, 1.0, top.rho) * 0.25;
    // Small surface pits and wear.
    let pit = voronoi(u, v, per(TILE_M, 300.0), per(TILE_M, 300.0), 545, 1.0);
    let pits = (1.0 - smoothstep(0.05, 0.25, pit.f1)) * smoothstep(0.7, 0.95, pit.id);
    h -= pits * 0.4;
    col *= 1.0 - pits * 0.3;
    h += (skin.w - 0.5) * 0.15;
    cavityTint = smoothstep(0.75, 1.0, top.rho);
  }

  // Silt and a film of algae low in the gaps and round the stones' feet.
  let low = 1.0 - smoothstep(ground + 1.0, ground + 12.0, h);
  let film = saturate(max(low * 0.7, cavityTint * 0.5)) * (0.5 + 0.5 * fbm01(u, v, 10.0, 10.0, 3, 550));
  col = blend(col, blend(SILT, ALGAE, fbm01(u, v, 6.0, 6.0, 3, 551)), film * 0.6);
  // Drier patches up the bank: paler, rougher, a dry rim on stones.
  let dry = smoothstep(0.5, 0.9, broad * 0.6 + fbm01(u, v, 4.0, 4.0, 3, 552) * 0.6);
  col *= 1.0 + dry * 0.35;
  rough = mix(rough, 0.75, dry * 0.8);
  // Standing water in the lowest hollows: a mirror.
  let pool = smoothstep(0.0, 6.0, -(h - ground) - broad * 0.0) * smoothstep(-0.2, -0.5, broad);
  rough = mix(rough, 0.06, pool);
  col *= 1.0 - pool * 0.25;

  setColour(o, col * 0.92, 1.0);
  o.h = h;
  o.rough = clamp(rough, 0.05, 1.0);
  o.metal = 0.0;
}
