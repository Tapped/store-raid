// Office carpet tiles, 500 mm, four by four (the client quarter-turns them): loop pile in rows,
// heathered yarn in the tint with darker flecks, matted lanes, stains, and dark seams.

const CAVITY = vec2f(2.0, 0.7);
const TILE = 2000.0; // mm
const N = 4.0;
const LOOPS = 600.0; // rows per meter-ish
const COFFEE = hex(0x3a2a1c);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let gx = u * N;
  let gy = v * N;
  let ix = i32(floor(gx));
  let iy = i32(floor(gy));
  let fx = gx - floor(gx);
  let fy = gy - floor(gy);
  let toEdge = min(min(fx, 1.0 - fx), min(fy, 1.0 - fy)) * (TILE / N);
  // Loop pile: a grid of tufts about 2.5 mm apart, each its own height and yarn.
  let rows = roundUp((LOOPS * TILE) / 1000.0);
  let lx = u * rows;
  let ly = v * rows;
  let cx = floor(lx);
  let cy = floor(ly);
  let n = i32(rows);
  let tuft = hash(i32(cx) % n, i32(cy) % n, 1700);
  let shape = sin((lx - cx) * PI) * sin((ly - cy) * PI);
  let pile = shape * (0.6 + 0.4 * tuft);
  // Heathered: each tuft's yarn a shade of the tint, some darker, a few paler flecks.
  let yarn = hash(i32(cx) % n, i32(cy) % n, 1701);
  let dark = select(0.0, 0.35, yarn < 0.18);
  let pale = select(0.0, 0.05, yarn > 0.94);
  let fade = value(u, v, 40.0, 40.0, 1708);
  o.a = (0.78 + 0.18 * tuft - dark) * (0.85 + 0.15 * shape) * (0.95 + 0.1 * fade);
  o.col = vec3f(pale);
  o.h = pile * 0.8 + fbm(u, v, 20.0, 20.0, 3, 1709) * 0.2;
  o.rough = 0.95;
  o.metal = 0.0;
  // Matted, grubby lanes where people walk.
  let lane = smoothstep(0.4, 0.75, fbm01(u, v, 2.0, 2.0, 4, 1702));
  o.h *= 1.0 - lane * 0.6;
  cover(o, DIRT, lane * 0.45);
  o.rough = mix(o.rough, 0.85, lane);
  // Stains: coffee rings and dark spots.
  let tile = hash(ix, iy, 1703);
  if (tile > 0.7) {
    let sx = 0.2 + 0.6 * hash(ix, iy, 1704);
    let sy = 0.2 + 0.6 * hash(ix, iy, 1705);
    let r = length(vec2f(wrapDelta(fx, sx), fy - sy)) * (1.0 + fbm(u, v, 30.0, 30.0, 3, 1706) * 0.4);
    let size = 0.05 + 0.12 * hash(ix, iy, 1707);
    let stain = 1.0 - smoothstep(size * 0.7, size, r);
    cover(o, COFFEE, saturate(stain * 0.45 + (1.0 - smoothstep(0.0, 0.012, abs(r - size * 0.9))) * 0.3));
  }
  // Seams between tiles: the pile parts and shows dark backing.
  let seam = 1.0 - smoothstep(0.4, 1.4, toEdge);
  cover(o, hex(0x141414), seam * 0.8);
  o.h -= seam * 1.5;
  cover(o, DIRT, (1.0 - smoothstep(1.0, 12.0, toEdge)) * 0.2);
}
