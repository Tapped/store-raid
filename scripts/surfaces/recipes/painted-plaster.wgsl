// Emulsion over plaster, a storey to the repeat (v 0 is the floor): roller stipple and lap marks,
// a gently wavy finish, patched repairs a shade off, black scuffs at trolley and chair height, chips
// to white plaster, and brown water stains running down from the ceiling. The paint is the tint.

const CAVITY = vec2f(3.0, 0.3);
const TILE = 3000.0; // mm
const PLASTER = hex(0xd8d2c4);
const STAIN = hex(0x7a6448);
const SCUFF = hex(0x2a2826);

// Spot groups.
const REPAIRS = 0u;
const LEAKS = 1u;

fn setup() {
  var rng = random(1500);
  for (var i = 0; i < 4; i++) {
    let w = (150.0 + next(&rng) * 500.0) / TILE;
    let h = (150.0 + next(&rng) * 400.0) / TILE;
    let u = next(&rng);
    let v = 0.1 + next(&rng) * 0.6;
    let c = next(&rng);
    place(REPAIRS, Spot(u, v, length(vec2f(w, h)), w, h, c, 0.0, 0.0));
  }
  for (var i = 0; i < 3; i++) {
    let w = (40.0 + next(&rng) * 120.0) / TILE;
    let u = next(&rng);
    let b = 0.08 + next(&rng) * 0.25;
    let c = next(&rng);
    place(LEAKS, Spot(u, 0.0, 0.3, w, b, c, 0.0, 0.0));
  }
}

// A band of scuffs `spread` either side of `centre` mm up the wall, wandering by `wobble`.
fn band(height: f32, wobble: f32, centre: f32, spread: f32) -> f32 {
  return 1.0 - smoothstep(0.0, spread, abs(height - centre - wobble));
}

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // Paint: roller stipple, and lap marks a roller's width apart, slightly different sheen.
  let stipple = value(u, v, 1400.0, 1400.0, 1501) * 0.6 + value(u, v, 600.0, 600.0, 1502) * 0.4;
  let lap = fbm01(u, v, 13.0, 2.0, 3, 1503);
  o.a = 0.96 + stipple * 0.04 - (lap - 0.5) * 0.03;
  o.col = vec3f(0.0);
  o.h = stipple * 0.14 + fbm(u, v, 4.0, 4.0, 4, 1504) * 0.6;
  o.rough = 0.82 + (lap - 0.5) * 0.08 + stipple * 0.04;
  o.metal = 0.0;
  let height = v * TILE;

  // Patched repairs: filled, sanded smooth, painted again a shade off.
  for (var i = 0u; i < spots(REPAIRS); i++) {
    let s = spot(REPAIRS, i);
    if (!near(s, u, v, 8.0)) {
      continue;
    }
    let du = abs(wrapDelta(u, s.u)) / s.a;
    let dv = abs(wrapDelta(v, s.v)) / s.b;
    let r = max(du, dv) + fbm(u, v, 30.0, 30.0, 3, 1505) * 0.15;
    let inside = 1.0 - smoothstep(0.9, 1.05, r);
    if (inside <= 0.0) {
      continue;
    }
    o.h = mix(o.h, 0.15 + stipple * 0.02, inside);
    o.a = mix(o.a, 0.9 + 0.08 * s.c, inside);
    o.rough = mix(o.rough, 0.78, inside);
  }

  // Scuffs: a black band at trolley height, another at chair-back height, and the odd one.
  let wobble = fbm(u, v, 3.0, 1.0, 3, 1506) * 60.0;
  let scuffZone = max(band(height, wobble, 250.0, 120.0), band(height, wobble, 850.0, 90.0) * 0.6);
  let marks = scratches(u, v, 18.0, 3, 1507, 0.035, 0.0015, 0.0, 0.35) * scuffZone;
  cover(o, SCUFF, marks * 0.6);
  let rub = scuffZone * smoothstep(0.55, 0.85, fbm01(u, v, 20.0, 8.0, 4, 1508));
  cover(o, DIRT, rub * 0.25);

  // Chips to plaster, mostly low, where things knocked into it.
  let low = 1.0 - smoothstep(200.0, 1300.0, height);
  let cluster = smoothstep(0.6, 0.8, fbm01(u, v, 6.0, 3.0, 3, 1513));
  let knock = fbm01(u, v, 30.0, 30.0, 4, 1509) + fbm(u, v, 250.0, 250.0, 2, 1510) * 0.08;
  let chip = saturate(smoothstep(0.72, 0.74, knock) * cluster * low);
  if (chip > 0.0) {
    cover(o, PLASTER, chip);
    o.h -= chip * 0.4;
    o.rough = mix(o.rough, 0.95, chip);
  }

  // Water stains running down from the ceiling, with tide lines.
  for (var i = 0u; i < spots(LEAKS); i++) {
    let s = spot(LEAKS, i);
    if (!near(s, u, v, 8.0)) {
      continue;
    }
    let du = wrapDelta(u, s.u);
    let fromTop = 1.0 - v;
    let width = s.a * (1.0 + fromTop * 1.5) * (0.7 + 0.6 * fbm01(u, v, 8.0, 4.0, 3, 1511));
    let across = abs(du) / width;
    if (across > 1.2 || fromTop > s.b) {
      continue;
    }
    let fade = 1.0 - smoothstep(s.b * 0.5, s.b, fromTop);
    let stain = (1.0 - smoothstep(0.6, 1.0, across)) * fade;
    let tide = (1.0 - smoothstep(0.0, 0.12, abs(across - 0.85))) * fade;
    cover(o, STAIN, stain * 0.25 + tide * 0.25);
  }
  // A little grime everywhere, and hand marks.
  cover(o, DIRT, smoothstep(0.55, 0.9, fbm01(u, v, 6.0, 6.0, 5, 1512)) * 0.12);
}
