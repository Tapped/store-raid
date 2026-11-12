// Board-formed concrete cast in place, a storey to the repeat: 20 boards of 150 mm, each leaving
// its grain and its own tone, with grout fins at the joints; form-tie holes on a 750 × 600 mm grid,
// some patched; water stains and salt running down, and damp rising from the floor.

const CAVITY = vec2f(6.0, 0.6);
const TILE = 3.0; // m
const BOARDS = 20.0;
const TIES_X = 4.0;
const TIES_Y = 5.0;
const PATCH = hex(0xa3a097);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  concrete(o, u, v, TILE, 700, hex(0x85837d));
  let row = floor(v * BOARDS);
  let inBoard = v * BOARDS - row;
  let rh = hash(i32(row), 0, 701);
  // Each board left its own tone and grain: long streaks along it.
  let tone = 1.0 + (rh - 0.5) * 0.2;
  let grain = fbm(u + rh, v, 6.0, BOARDS * 12.0, 3, 702 + i32(row)) * 0.5 +
    fbm(u, v, 40.0, BOARDS * 30.0, 2, 703);
  o.col *= tone * (1.0 + grain * 0.09);
  o.h += grain * 0.5 + (rh - 0.5) * 2.5;
  // Board joints: a thin fin of grout squeezed out.
  let jd = (min(inBoard, 1.0 - inBoard) * (TILE * 1000.0)) / BOARDS; // mm to the joint
  let fin = 1.0 - smoothstep(0.5, 2.5, jd + fbm01(u, v, 60.0, 3.0, 2, 704) * 1.5);
  o.h += fin * 0.8;
  cover(o, PATCH, fin * 0.4);
  // Tie holes: cones 25 mm across, about half patched flush in paler mortar.
  let tu = wrapDelta(u * TIES_X, 0.5) / TIES_X;
  let tv = wrapDelta(v * TIES_Y, 0.5) / TIES_Y;
  let ti = i32(floor(u * TIES_X));
  let tj = i32(floor(v * TIES_Y));
  let td = length(vec2f(tu, tv)) * TILE * 1000.0;
  let patched = hash(ti, tj, 705) < 0.45;
  if (td < 28.0) {
    if (patched) {
      let p = 1.0 - smoothstep(18.0, 24.0, td + fbm(u, v, 400.0, 400.0, 2, 706) * 3.0);
      cover(o, PATCH, p * 0.8);
      o.h += p * 0.3;
      o.rough = mix(o.rough, 0.92, p);
    } else {
      let hole = 1.0 - smoothstep(10.0, 13.0, td);
      o.h -= hole * max(0.0, 12.0 - td) * 1.5;
      o.ao *= 1.0 - hole * 0.6;
      // A rusty tie end deep in it.
      cover(o, RUST, (1.0 - smoothstep(3.0, 5.0, td)) * 0.8);
    }
  }
  // Rust bleeding down from the open ties.
  if (!patched && tv < 0.0 && abs(tu) * TILE * 1000.0 < 14.0) {
    let run = (1.0 - smoothstep(0.0, 0.12, -tv)) * smoothstep(0.4, 0.8, fbm01(u, v, 200.0, 6.0, 3, 707));
    cover(o, blend(RUST, DIRT, 0.4), run * 0.5);
  }
  // Water stains: dark streaks running down from above, with salt dried at their edges.
  let streak = fbm01(u, v, 30.0, 1.0, 4, 708) * 0.6 + fbm01(u, v, 8.0, 2.0, 3, 709) * 0.4;
  let wetRun = smoothstep(0.6, 0.8, streak) * (0.4 + 0.6 * v);
  cover(o, DIRT, wetRun * 0.4);
  o.rough = mix(o.rough, 0.75, wetRun * 0.5);
  let saltEdge = smoothstep(0.5, 0.55, streak) * (1.0 - smoothstep(0.55, 0.6, streak));
  cover(o, SALT, saltEdge * wetRun * 0.15);
  // Damp rising from the floor, with a tide line of salt.
  let top = 0.12 + fbm(u, v, 5.0, 1.0, 3, 710) * 0.035 + fbm(u, v, 30.0, 3.0, 2, 712) * 0.004;
  let damp = 1.0 - smoothstep(top - 0.04, top, v);
  o.col *= vec3f(1.0 - damp * 0.25, 1.0 - damp * 0.25, 1.0 - damp * 0.22);
  o.rough = mix(o.rough, 0.6, damp);
  let tide = (1.0 - smoothstep(0.0, 0.008, abs(v - top + 0.004))) *
    (0.4 + 0.6 * value(u, v, 300.0, 300.0, 711));
  cover(o, SALT, saturate(tide) * 0.18);
}
