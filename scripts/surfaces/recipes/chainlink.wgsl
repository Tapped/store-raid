// Galvanised chain-link: 3 mm wires on the diagonals, about 53 mm apart, crossing over and under.
// Alpha is the wire's coverage; the client cuts the holes out.

const TILE = 300.0; // mm
const N = 4.0; // diagonals each way across the repeat
const RADIUS = 1.6; // mm

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // Distance from each set of diagonals, in mm.
  let a = wrapDelta((u + v) * N, 0.0);
  let b = wrapDelta((u - v) * N, 0.0);
  let spacing = TILE / (N * SQRT2);
  let da = abs(a) * spacing;
  let db = abs(b) * spacing;
  // Which wire is on top at a crossing alternates.
  let ia = i32(roundUp((u + v) * N));
  let ib = i32(roundUp((u - v) * N));
  let aOnTop = (ia + ib) % 2 == 0;
  var ha = -9.0;
  if (da < RADIUS) {
    ha = sqrt(RADIUS * RADIUS - da * da) + select(0.0, 1.2, aOnTop);
  }
  var hb = -9.0;
  if (db < RADIUS) {
    hb = sqrt(RADIUS * RADIUS - db * db) + select(1.2, 0.0, aOnTop);
  }
  let h = max(ha, hb);
  galvanised(o, u, v, TILE / 1000.0, 2000, 0.4);
  o.a = 1.0 - smoothstep(RADIUS - 0.3, RADIUS + 0.2, min(da, db));
  o.h = max(h, 0.0);
  rust(o, u, v, TILE / 1000.0, smoothstep(0.7, 0.85, fbm01(u, v, 3.0, 3.0, 4, 2001)) * 0.8, 2002);
  // The wire is round: its sides face away and catch less light.
  o.ao *= select(1.0, 0.6 + 0.4 * (min(h, RADIUS) / RADIUS), h > 0.0);
}
