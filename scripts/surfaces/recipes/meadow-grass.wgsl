// An overgrown hay meadow in late autumn, 3 m square: nobody has cut it for years, so the dead
// grass has fallen over in clumps, each tussock's blades lying outward and curling one way, in
// swirls. Green still low down, moss and damp earth in the gaps between tussocks, fallen birch
// leaves on top and caught among the blades.

const CAVITY = vec2f(8.0, 0.65);
const TILE_M = 3.0;
const TILE = 3000.0; // mm
const STRAW_PALE = hex(0x958a68);
const STRAW_GREY = hex(0x7a7262);
const STRAW = hex(0x8a7a45);
const STRAW_DARK = hex(0x7a6f3f);
const ROTTEN = hex(0x5c4c2c);
const GREEN_LOW = hex(0x4a5526);
const GREEN_DARK = hex(0x313a1a);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // The ground: lumpy damp earth, moss over most of it.
  let e = earthBed(u, v, TILE_M, 401);
  let broad = fbm(u, v, 3.0, 3.0, 4, 402);
  let ground = broad * 15.0 + e.x;
  var h = ground;
  var col = blend(EARTH, ROTTEN, 0.4) * e.y;
  var rough = 0.7;
  let mb = mossBed(u, v, TILE_M, 403);
  let mossy = smoothstep(0.35, 0.65, fbm01(u, v, 8.0, 8.0, 4, 404));
  if (mossy > 0.0) {
    h += mb.x * mossy;
    col = blend(col, mossColour(mb.y, fbm01(u, v, 30.0, 30.0, 2, 405) * 0.6), mossy);
    rough = mix(rough, 0.9, mossy);
  }

  // A low mat of short blades, greener, everywhere under the clumps.
  var mat = strandLayer(30.0, 410);
  mat.count = 40;
  mat.len = vec2f(0.4, 1.0);
  mat.width = 0.022;
  mat.bend = 0.3;
  mat.flow = 3.0;
  mat.flowFreq = 4.0;
  mat.thick = 0.6;
  mat.layers = 2.0;
  mat.rise = 1.5;
  let sm = strandField(u, v, mat);
  let matGate = 0.55 + 0.45 * smoothstep(0.3, 0.6, fbm01(u, v, 6.0, 6.0, 3, 411));
  if (sm.id >= 0.0 && sm.id2 < matGate) {
    let mh = ground + 2.0 + sm.h;
    if (mh > h) {
      h = mh;
      var mc = blend(GREEN_LOW, STRAW_DARK, sm.id * 0.8);
      mc *= 0.85 + 0.3 * sm.id2 + 0.1 * (1.0 - abs(sm.s));
      col = mc;
      rough = 0.65;
    }
  }

  // The tussocks: two sizes of clump, the bigger ones laid over furthest.
  var big = Tussocks(8.0, 1800, 0.85, vec2f(0.3, 0.95), 0.0085, 0.25, 0.92, 2.0, 0.3, 40.0, 0.7, 10.0, 0.6, 420);
  let tb = tussocks(u, v, big);
  var small = Tussocks(14.0, 600, 0.8, vec2f(0.3, 0.9), 0.012, 0.25, 0.85, 2.0, 0.35, 22.0, 0.6, 7.0, 0.5, 430);
  let ts = tussocks(u, v, small);
  var bl = tb;
  var bh = ground + tb.h;
  var bigOne = true;
  if (ts.id >= 0.0 && ground + ts.h > bh) {
    bl = ts;
    bh = ground + ts.h;
    bigOne = false;
  }
  if (bl.id >= 0.0 && bh > h) {
    h = bh;
    // Dead straw on top, olive and green lower down, paler bleached tips, the odd rotting blade.
    var c = blend(STRAW_DARK, STRAW, bl.id);
    c = blend(c, STRAW_GREY, smoothstep(0.2, 0.8, fract(bl.id * 3.7 + bl.clump)) * 0.75);
    c = blend(c, STRAW_PALE, smoothstep(0.55, 1.0, bl.t) * smoothstep(0.4, 1.0, bl.id2) * 0.8);
    c = blend(c, ROTTEN, smoothstep(0.8, 0.95, bl.id2) * 0.8);
    let low = 1.0 - smoothstep(0.1, 0.55, bl.up);
    c = blend(c, blend(GREEN_LOW, GREEN_DARK, 1.0 - bl.up), low * (0.4 + 0.5 * bl.clump));
    // Each clump its own shade, each blade lighter along its fold.
    c *= 0.78 + 0.3 * bl.clump;
    c *= 0.72 + 0.5 * fract(bl.id * 7.31);
    c *= 0.82 + 0.22 * (1.0 - abs(bl.s)) + 0.08 * bl.id2;
    col = c;
    rough = 0.72 - low * 0.1;
  }

  // Fallen birch leaves, some on top, some down among the blades.
  var lv = Leaves(40.0, 1, 0.2, vec2f(0.7, 1.0), 0.7, 1.8, 40.0, 440);
  let lf = leafLitter(u, v, lv, TILE);
  // Leaves drift into patches: keep each by where it lies.
  let drift = fbm01(lf.at.x, lf.at.y, 4.0, 4.0, 3, 441);
  if (lf.id >= 0.0 && lf.id2 < smoothstep(0.35, 0.75, drift) * 1.3) {
    let lh = ground + lf.h;
    if (lh > h) {
      h = lh;
      col = birchLeafColour(lf, u, v);
      rough = 0.45;
    }
  }

  // Damp: the hollows and the ground hold water.
  let damp = smoothstep(0.55, 0.8, fbm01(u, v, 5.0, 5.0, 3, 450)) * (1.0 - smoothstep(0.0, 25.0, h - ground));
  col *= 1.0 - damp * 0.2;
  rough = mix(rough, 0.45, damp * 0.6);

  setColour(o, col, 1.0);
  o.h = h;
  o.rough = clamp(rough, 0.05, 1.0);
  o.metal = 0.0;
}
