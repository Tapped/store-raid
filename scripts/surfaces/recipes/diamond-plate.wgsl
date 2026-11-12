// Steel tread plate: raised lugs in alternating diagonals, 16 cells to the half meter. Worn bright
// and smooth on top, dirt and rust packed between, scuffed where boots and wheels go.

const CAVITY = vec2f(4.0, 0.7);
const CELLS = 16.0;
const MILL = hex(0x6e7072);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let gx = u * CELLS;
  let gy = v * CELLS;
  let ix = i32(floor(gx));
  let iy = i32(floor(gy));
  var lug = 0.0;
  // A lug centred in every cell, its diagonal alternating like a checkerboard; neighbours may reach.
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cy = iy + j;
      let dir = select(-1.0, 1.0, wrap(cx + cy, 2) == 0);
      let dx = gx - (f32(cx) + 0.5);
      let dy = gy - (f32(cy) + 0.5);
      let along = (dx + dir * dy) * SQRT1_2;
      let across = (dx * -dir + dy) * SQRT1_2;
      // A capsule 0.9 cells long, 0.2 wide.
      let t = max(0.0, abs(along) - 0.3);
      let d = length(vec2f(t, across)) / 0.16;
      if (d < 1.0) {
        lug = max(lug, sqrt(1.0 - d * d));
      }
    }
  }
  let fine = value(u, v, 700.0, 700.0, 601);
  setColour(o, MILL, 0.9 + fine * 0.15);
  o.metal = 1.0;
  o.rough = 0.55 + fine * 0.1;
  o.h = lug * 1.6 + fine * 0.01;
  // Lug tops polished bright by feet.
  let top = smoothstep(0.6, 0.95, lug);
  let worn = top * (0.5 + 0.5 * fbm01(u, v, 6.0, 6.0, 4, 602));
  setColour(o, MILL, (0.9 + fine * 0.15) * (1.0 - worn));
  o.col += STEEL * 1.1 * worn;
  o.rough = mix(o.rough, 0.3, worn);
  // Dirt packed between the lugs, rust where water stood.
  let low = 1.0 - smoothstep(0.0, 0.3, lug);
  let dirt = low *
    smoothstep(0.35, 0.75, fbm01(u, v, 16.0, 16.0, 4, 603) * 0.7 + fbm01(u, v, 3.0, 3.0, 3, 607) * 0.3);
  cover(o, DIRT, dirt * 0.75);
  o.rough = mix(o.rough, 0.9, dirt);
  o.metal = mix(o.metal, 0.0, dirt * 0.8);
  rust(o, u, v, 0.5, saturate(low * smoothstep(0.6, 0.85, fbm01(u, v, 5.0, 5.0, 5, 604)) * 1.2), 605);
  let s = scratches(u, v, 4.0, 3, 606, 0.3, 0.001, 0.0, PI);
  cover(o, STEEL, s * 0.4);
}
