// Corrugated steel cladding seen from inside: 76.2 mm pitch up v (40 to the repeat), 18 mm deep,
// four sheets across with a side lap every ten corrugations and an end lap at the floor of every
// storey. Painted (the tint); rust where water sits, at the laps and round the screws, running down.

const CAVITY = vec2f(3.0, 0.4);
const TILE = 3.048;
const PITCH = 40.0; // corrugations per repeat
const DEPTH = 18.0; // mm
const SHEET = 10.0; // corrugations per sheet
const LAP = 0.15 / TILE; // end lap height
// Screw lines, at the girts.
const RAIL_LOW = LAP * 0.5;
const RAIL_HIGH = 0.5;

// Distance in mm to the nearest screw on the line at `rail`, a screw in every second valley.
fn toScrew(u: f32, v: f32, rail: f32) -> f32 {
  let dv = wrapDelta(v, rail) * TILE * 1000.0;
  let du = (wrapDelta((u * PITCH) / 2.0 - 0.25, 0.0) * 2.0 * (TILE * 1000.0)) / PITCH;
  return length(vec2f(du, dv));
}

// How near to a lap or screw: 0 far, 1 on it.
fn wet(u: f32, v: f32) -> f32 {
  let across = u * PITCH;
  let toSide = abs(wrapDelta(across / SHEET, 0.0)) * SHEET; // corrugations from the side lap
  let side = 1.0 - smoothstep(0.0, 0.8, toSide);
  let end = 1.0 - smoothstep(0.0, 0.03, abs(v - LAP) * 1.0);
  let screw = max(
    1.0 - smoothstep(10.0, 45.0, toScrew(u, v, RAIL_LOW)),
    1.0 - smoothstep(10.0, 45.0, toScrew(u, v, RAIL_HIGH)),
  );
  let noise = fbm01(u, v, 120.0, 40.0, 3, 401);
  return saturate(max(max(side * 0.8, end), screw) * (0.5 + noise));
}

// A screw's washer and tip, rusty.
fn screwHead(o: ptr<function, Texel>, u: f32, v: f32, rail: f32) {
  let d = toScrew(u, v, rail);
  if (d < 9.0) {
    let washer = 1.0 - smoothstep(7.0, 9.0, d);
    cover(o, blend(RUST, RUST_DARK, 0.3 + 0.4 * fbm01(u, v, 300.0, 300.0, 2, 402)), washer);
    o.h += washer * (2.0 + sqrt(max(0.0, 1.0 - (d / 9.0) * (d / 9.0))) * 2.0);
    o.rough = mix(o.rough, 0.8, washer);
    o.metal = mix(o.metal, 0.0, washer);
  }
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  var p = paint(TILE, 400, 0.3, 0.95);
  p.runs = 1.0;
  p.wash = 0.7;
  p.gloss = 0.45;
  p.extra = wet(u, v) * 0.9;
  paintedMetal(o, u, v, p);
  let phase = fract(u * PITCH) * TAU;
  var h = cos(phase) * DEPTH * 0.5;
  // Side lap: the next sheet's edge sits on top, a step and a dark line.
  let across = (u * PITCH) / SHEET;
  let lapD = wrapDelta(across, 0.0) * SHEET; // corrugations
  if (lapD > -0.55 && lapD < 0.0) {
    h += 1.2;
  }
  let lapEdge = 1.0 - smoothstep(0.0, 0.012, abs(lapD + 0.55));
  // End lap: the sheet below overlaps behind, a step at its edge.
  if (v < LAP) {
    h += 1.2;
  }
  let endEdge = 1.0 - smoothstep(0.0, 0.002, abs(v - LAP));
  let edge = max(lapEdge, endEdge);
  cover(o, blend(RUST_DARK, RUST, 0.5), edge * 0.8);
  o.h += h;
  screwHead(o, u, v, RAIL_LOW);
  screwHead(o, u, v, RAIL_HIGH);
  // Condensation runs down the valleys, dirt in the troughs.
  let valley = smoothstep(0.3, 1.0, -cos(phase));
  let cond = smoothstep(0.55, 0.85, fbm01(u, v, PITCH * 2.0, 3.0, 3, 403)) * valley;
  cover(o, DIRT, cond * 0.25);
  o.rough = mix(o.rough, 0.6, cond * 0.5);
  // Salt and grime rising from the floor.
  let foot = 1.0 - smoothstep(0.0, 0.12, v + fbm(u, v, 20.0, 4.0, 3, 404) * 0.03);
  cover(o, blend(DIRT, SALT, 0.3), foot * 0.5);
}
