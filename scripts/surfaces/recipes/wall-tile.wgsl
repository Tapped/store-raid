// White glazed ceramic wall tiles, 150 mm, ten by ten: cushion edges, a slight ripple in the glaze,
// grey grout gone dark with grime, the odd cracked or chipped tile, and streaks running down.

const CAVITY = vec2f(2.0, 0.6);
const TILE = 1500.0; // mm
const N = 10.0;
const GLAZE = hex(0xe9e8e2);
const GROUT = hex(0x8d8a82);
const BISCUIT = hex(0xb9a991);
const HALF_GROUT = 1.2; // mm

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let gx = u * N;
  let gy = v * N;
  let ix = i32(floor(gx));
  let iy = i32(floor(gy));
  let fx = gx - floor(gx);
  let fy = gy - floor(gy);
  let cellMm = TILE / N;
  let toEdge = min(min(fx, 1.0 - fx), min(fy, 1.0 - fy)) * cellMm;
  let id = hash(ix, iy, 1800);
  // Glaze: near white, each tile a shade off, rippled.
  let ripple = fbm(u, v, 40.0, 40.0, 3, 1801);
  setColour(o, GLAZE, 0.97 + (id - 0.5) * 0.04);
  // Cushion edge: rounds down over the last 4 mm.
  let cushion = 1.0 - smoothstep(HALF_GROUT, HALF_GROUT + 4.0, toEdge);
  o.h = ripple * 0.04 - cushion * cushion * 1.2;
  o.rough = 0.08 + value(u, v, 400.0, 400.0, 1802) * 0.04;
  o.metal = 0.0;
  // Grime clinging to the glaze, and streaks running down.
  let film = smoothstep(0.4, 0.9, fbm01(u, v, 5.0, 5.0, 5, 1803));
  cover(o, DIRT, film * 0.12);
  o.rough = mix(o.rough, 0.35, film);
  let streak = smoothstep(0.6, 0.85, fbm01(u, v, 40.0, 1.0, 4, 1804));
  cover(o, DIRT, streak * 0.15);
  o.rough = mix(o.rough, 0.3, streak);
  // A cracked tile here and there: a hairline across it, dirty.
  if (id > 0.93) {
    let line = abs(fy - 0.5 - (fx - 0.5) * (hash(ix, iy, 1805) - 0.5) * 2.0 - fbm(u, v, 60.0, 60.0, 3, 1806) * 0.08);
    let crack = 1.0 - smoothstep(0.002, 0.008, line);
    cover(o, DIRT, crack * 0.8);
    o.h -= crack * 0.3;
  }
  // Chipped corners showing the biscuit.
  if (id < 0.08) {
    let corner = length(vec2f(min(fx, 1.0 - fx), min(fy, 1.0 - fy))) * cellMm;
    let chip = 1.0 - smoothstep(6.0, 8.0, corner + fbm(u, v, 200.0, 200.0, 2, 1807) * 3.0);
    cover(o, BISCUIT, chip);
    o.h -= chip * 0.8;
    o.rough = mix(o.rough, 0.9, chip);
  }
  // Grout: recessed, grey, grimed dark in places.
  let grout = 1.0 - smoothstep(HALF_GROUT - 0.3, HALF_GROUT + 0.3, toEdge);
  if (grout > 0.0) {
    let dirt = 0.6 + 0.4 * fbm01(u, v, 30.0, 30.0, 4, 1808);
    o.col = mix(o.col, GROUT * dirt, vec3f(grout));
    o.h -= grout * 1.0;
    o.rough = mix(o.rough, 0.92, grout);
  }
}
