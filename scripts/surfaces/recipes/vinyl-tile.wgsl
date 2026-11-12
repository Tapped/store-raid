// Vinyl composition tiles, 300 mm, eight by eight: the tint mottled with streaky chips, waxed to a
// low gloss and dull in worn lanes, dirt packed in the joints, heel marks, and the odd replaced or
// cracked tile.

const CAVITY = vec2f(2.0, 0.5);
const TILE = 2400.0; // mm
const N = 8.0;
const HEEL = hex(0x1d1c1b);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let gx = u * N;
  let gy = v * N;
  let fx = gx - floor(gx);
  let fy = gy - floor(gy);
  let toEdge = min(min(fx, 1.0 - fx), min(fy, 1.0 - fy)) * (TILE / N);
  let id = hash(i32(floor(gx)), i32(floor(gy)), 1900);
  // VCT mottle: streaky chips of lighter and darker vinyl, running one way across each tile.
  let streak = fbm(u + id, v, 160.0, 40.0, 3, 1901);
  let chipsDark = smoothstep(0.25, 0.45, streak);
  let chipsLight = smoothstep(-0.3, -0.45, streak);
  o.a = 0.9 - chipsDark * 0.25 + (id - 0.5) * 0.06;
  o.col = vec3f(chipsLight * 0.08);
  // A replaced tile, from another batch: a different shade.
  if (id > 0.95) {
    o.a *= 0.82;
  }
  o.h = value(u, v, 800.0, 800.0, 1902) * 0.03;
  o.rough = 0.35;
  o.metal = 0.0;
  // Wax worn off in lanes: dull and greyer.
  let lane = smoothstep(0.45, 0.8, fbm01(u, v, 3.0, 3.0, 4, 1903));
  o.rough = mix(o.rough, 0.7, lane);
  cover(o, DIRT, lane * 0.18);
  // Heel and trolley marks.
  let marks = scratches(u, v, 10.0, 1, 1904, 0.03, 0.0012, 0.0, PI);
  cover(o, HEEL, marks * 0.6);
  // A cracked tile.
  if (id < 0.04) {
    let line = abs(fy - 0.4 - fx * 0.3 - fbm(u, v, 40.0, 40.0, 3, 1905) * 0.06);
    let crack = 1.0 - smoothstep(0.002, 0.006, line);
    cover(o, DIRT, crack * 0.9);
    o.h -= crack * 0.4;
  }
  // Joints with dirt packed in, and wax built up dirty along them.
  let joint = 1.0 - smoothstep(0.3, 0.9, toEdge);
  cover(o, DIRT, joint * 0.85);
  o.h -= joint * 0.5;
  cover(o, DIRT, (1.0 - smoothstep(1.0, 15.0, toEdge)) * 0.2);
}
