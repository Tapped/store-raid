// Suspended ceiling from below: 600 mm fissured mineral-fibre tiles, four by four, in a white T-bar
// grid on their edges. Some tiles yellowed, some water-stained in rings, the odd one sagging; dust
// along the edges where air leaks past.

const CAVITY = vec2f(3.0, 0.6);
const TILE = 2400.0; // mm
const N = 4.0;
const FIBRE = hex(0xd9d6cc);
const GRID = hex(0xe6e5e0);
const STAIN = hex(0x8a6d45);
const YELLOW = hex(0xcfc29c);
const HALF_BAR = 12.0; // mm

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let gx = u * N;
  let gy = v * N;
  let ix = i32(floor(gx));
  let iy = i32(floor(gy));
  let fx = gx - floor(gx);
  let fy = gy - floor(gy);
  let cellMm = TILE / N;
  let toEdge = min(min(fx, 1.0 - fx), min(fy, 1.0 - fy)) * cellMm; // mm
  let id = hash(ix, iy, 1600);
  let id2 = hash(ix, iy, 1601);

  // Mineral fibre: fine porous speckle and worm-like fissures pressed in.
  let speckle = value(u, v, 2400.0, 2400.0, 1602);
  let fissure = smoothstep(0.88, 0.97, ridged(u + id, v, 70.0, 70.0, 2, 1603));
  let pores = voronoi(u, v, 900.0, 900.0, 1604, 1.0);
  let pore = (1.0 - smoothstep(0.1, 0.3, pores.f1)) * smoothstep(0.5, 0.9, pores.id);
  setColour(o, FIBRE, (0.94 + speckle * 0.08) * (1.0 - fissure * 0.25) * (1.0 - pore * 0.2));
  o.h = speckle * 0.1 - fissure * 0.6 - pore * 0.3;
  o.rough = 0.95;
  o.metal = 0.0;
  // Some tiles yellowed with age or a different batch.
  if (id < 0.25) {
    cover(o, YELLOW, 0.4 + id);
  }
  // Sag: the middle hangs towards us.
  if (id2 < 0.12) {
    o.h += sin(fx * PI) * sin(fy * PI) * 6.0;
  }
  // Water stains: rings spreading from a leak.
  if (id2 > 0.82) {
    let cx = 0.3 + 0.4 * hash(ix, iy, 1605);
    let cy = 0.3 + 0.4 * hash(ix, iy, 1606);
    let r = length(vec2f(fx - cx, fy - cy)) * (1.0 + fbm(u, v, 20.0, 20.0, 3, 1607) * 0.3);
    let size = 0.2 + 0.25 * hash(ix, iy, 1608);
    let stain = 1.0 - smoothstep(size * 0.8, size, r);
    let ring = (1.0 - smoothstep(0.0, 0.02, abs(r - size * 0.9))) * 0.8;
    let inner = (1.0 - smoothstep(0.0, 0.015, abs(r - size * 0.55))) * 0.4;
    cover(o, STAIN, saturate(stain * 0.25 + ring * 0.35 + inner * 0.25));
  }
  // Dust round the edges, where air leaks past the grid.
  let dust = (1.0 - smoothstep(HALF_BAR, HALF_BAR + 40.0, toEdge)) *
    (0.4 + 0.6 * fbm01(u, v, 30.0, 30.0, 3, 1609));
  cover(o, DIRT, dust * 0.3);
  // The tile's edge drops behind the grid: a shadowed reveal.
  let reveal = 1.0 - smoothstep(HALF_BAR, HALF_BAR + 6.0, toEdge);
  o.h -= reveal * 2.0;
  o.ao *= 1.0 - reveal * 0.4;
  // The T-bar: white painted steel, a touch glossy, nearest to us.
  let bar = 1.0 - smoothstep(HALF_BAR - 0.8, HALF_BAR, toEdge);
  if (bar > 0.0) {
    setColour(o, GRID, 0.95 + value(u, v, 1200.0, 1200.0, 1610) * 0.05);
    o.h = mix(o.h, 4.0, bar);
    o.rough = mix(o.rough, 0.45, bar);
    o.ao = mix(o.ao, 1.0, bar);
    cover(o, DIRT, bar * smoothstep(0.5, 0.9, fbm01(u, v, 12.0, 12.0, 3, 1611)) * 0.2);
  }
}
