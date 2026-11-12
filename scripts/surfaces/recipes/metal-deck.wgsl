// Trapezoidal roof deck from below, 152.4 mm pitch (12 ribs to the repeat, ribs along v), 38 mm
// deep: the narrow flange nearest is the rib's underside, the wide one beyond lies against the
// roof. Galvanised, with a sheet lap every six ribs, condensation stains and rust weeping at laps.

const CAVITY = vec2f(8.0, 0.25);
const TILE = 1828.8; // mm
const RIBS = 12.0;
const PITCH = TILE / RIBS;
const NEAR = 44.0; // near flange width, mm
const WEB = 11.0; // web run, mm
const DEPTH = 38.0;

fn stiffener(a: f32) -> f32 {
  return max(0.0, 1.0 - (a * a) / 30.0);
}

// Height towards the viewer, mm, across one pitch: x in mm from the middle of a near flange.
fn profile(x: f32) -> f32 {
  let a = abs(x);
  if (a < NEAR / 2.0) {
    return DEPTH - stiffener(a);
  }
  if (a < NEAR / 2.0 + WEB) {
    return DEPTH * (1.0 - (a - NEAR / 2.0) / WEB);
  }
  // The wide flange has a stiffening groove down its middle.
  let mid = PITCH / 2.0 - a;
  return max(0.0, 1.5 - (mid * mid) / 40.0);
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  galvanised(o, u, v, TILE / 1000.0, 500, 0.08);
  let x = wrapDelta(u * RIBS, 0.0) * PITCH;
  let h = profile(x);
  o.h += h;
  // The webs face sideways, so they catch less light and more dirt.
  let web = smoothstep(NEAR / 2.0 - 1.0, NEAR / 2.0 + 1.0, abs(x)) *
    (1.0 - smoothstep(NEAR / 2.0 + WEB - 1.0, NEAR / 2.0 + WEB + 1.0, abs(x)));
  o.ao *= 1.0 - web * 0.15;
  // The far flange lies in shadow against the roof.
  o.ao *= 0.8 + 0.2 * (h / DEPTH);
  // Sheet lap every six ribs: the edge of the next sheet over a near flange, and rust weeping.
  let lapX = wrapDelta((u * RIBS) / 6.0, 0.0) * 6.0 * PITCH; // mm from the lap
  let lapEdge = 1.0 - smoothstep(0.0, 1.5, abs(lapX - NEAR / 2.0 + 4.0));
  if (lapX > -NEAR / 2.0 && lapX < NEAR / 2.0 - 4.0) {
    o.h += 1.0;
  }
  cover(o, DIRT, lapEdge * 0.7);
  let weep = (1.0 - smoothstep(0.0, 60.0, abs(lapX))) * smoothstep(0.55, 0.85, fbm01(u, v, 30.0, 4.0, 4, 501));
  rust(o, u, v, TILE / 1000.0, weep * 0.8, 502);
  // Condensation drip lines along the ribs' undersides, and tide marks where it pooled.
  let drip = smoothstep(0.65, 0.85, fbm01(u, v, RIBS * 2.0, 2.0, 3, 503)) * (h / DEPTH) * 0.5;
  cover(o, DIRT, drip * 0.3);
  let tide = smoothstep(0.7, 0.8, fbm01(u, v, 3.0, 3.0, 5, 504) + fbm(u, v, 40.0, 40.0, 2, 505) * 0.05);
  let tideLine = tide * (1.0 - smoothstep(0.8, 0.95, fbm01(u, v, 3.0, 3.0, 5, 504)));
  cover(o, RUST, tideLine * 0.12);
  o.rough = mix(o.rough, 0.7, drip);
}
