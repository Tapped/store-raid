// Rough-sawn softwood boards along u, eight of 150 mm in a 1.2 m repeat (the client cuts them into
// random lengths): growth rings, knots, a gap between boards, greyed and dirty with use, nail heads.

const CAVITY = vec2f(4.0, 0.6);
const TILE = 1200.0; // mm
const BOARDS = 8.0;
const PALE = hex(0xb08d63);
const DARK = hex(0x7a5a3a);
const GREY = hex(0x857c70);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let row = floor(v * BOARDS);
  let inBoard = v * BOARDS - row;
  let r = i32(row);
  let id = hash(r, 0, 1100);
  let id2 = hash(r, 1, 1100);
  // Rings: the board cut through a warped trunk, so lines run along it and drift across.
  let warp = fbm(u, v, 2.0, BOARDS, 4, 1101 + r) * 0.22 + fbm(u, v, 9.0, BOARDS * 2.0, 2, 1102) * 0.04;
  let ringPos = (inBoard + warp + id * 3.0) * (5.0 + id2 * 4.0);
  var ring = ringPos - floor(ringPos);
  ring = smoothstep(0.0, 0.25, ring) * (1.0 - smoothstep(0.55, 1.0, ring));
  // Knots: a few per board, rings swirling round them.
  var knot = 0.0;
  for (var k = 0; k < 2; k++) {
    let ku = hash(r, k + 10, 1103);
    if (hash(r, k + 20, 1103) > 0.6) {
      continue;
    }
    let du = wrapDelta(u, ku) * TILE;
    let dv = (inBoard - 0.3 - 0.4 * hash(r, k + 30, 1103)) * (TILE / BOARDS);
    let d = length(vec2f(du * 0.5, dv));
    knot = max(knot, 1.0 - smoothstep(4.0, 14.0, d));
  }
  let fibre = value(u, v, 400.0, 300.0, 1104) * 0.5 + value(u, v, 60.0, 900.0, 1108) * 0.5;
  let tone = blend(PALE, DARK, saturate(ring * 0.55 + id * 0.35 + knot * 0.8));
  o.col = tone * (0.9 + fibre * 0.2);
  o.h = (fibre - 0.5) * 0.3 + ring * 0.15 - knot * 0.1 + fbm(u, v, 6.0, BOARDS * 4.0, 3, 1105) * 0.4;
  o.rough = 0.8 + fibre * 0.1;
  o.metal = 0.0;
  // Weathered grey and dirt, worn smooth where feet go.
  let grey = smoothstep(0.35, 0.75, fbm01(u, v, 4.0, 4.0, 4, 1106)) * (0.4 + 0.4 * id2);
  cover(o, GREY, grey * 0.6);
  cover(o, DIRT, smoothstep(0.5, 0.85, fbm01(u, v, 8.0, 8.0, 5, 1107)) * 0.4);
  // The gap between boards: dark, with the edges rounded over.
  let toEdge = min(inBoard, 1.0 - inBoard) * (TILE / BOARDS); // mm
  let gap = 1.0 - smoothstep(1.5, 2.5, toEdge);
  o.h -= (1.0 - smoothstep(0.0, 6.0, toEdge)) * 1.2 + gap * 6.0;
  cover(o, hex(0x1e1914), gap);
  o.ao *= 1.0 - gap * 0.6;
  // Nail heads along each board, rusted.
  let nu = wrapDelta(u * 3.0, 0.5) / 3.0;
  let nd = length(vec2f(nu * TILE, (inBoard - 0.5) * (TILE / BOARDS) + (id - 0.5) * 30.0));
  let nail = 1.0 - smoothstep(3.0, 4.5, nd);
  if (nail > 0.0) {
    cover(o, RUST_DARK, nail);
    o.h += nail * 0.3;
    o.rough = mix(o.rough, 0.7, nail);
  }
}
