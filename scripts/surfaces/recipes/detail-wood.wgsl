// Detail: weathered softwood, grain along u. Sun and rain have worn the soft earlywood down between
// the harder latewood rings, which stand up as fine ridges; the fibres between are raised and
// furred; drying has opened checks along the grain, a few long and wide, many short and fine.

const CAVITY = vec2f(1.2, 0.8);
const T = 500.0; // mm, as the table's tile

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // Rings cut lengthwise: lines along u, a few mm apart, wandering slowly across.
  let warp = fbm(u, v, 2.0, 3.0, 3, 7001) * 0.05 + fbm(u, v, 9.0, 14.0, 2, 7002) * 0.006;
  let rings = (v + warp) * 150.0;
  let ring = rings - floor(rings);
  // Each ring its own strength: some latewood bands barely show.
  let band = hash(wrap(i32(floor(rings)), 150), 0, 7003);
  let late = smoothstep(0.55, 0.72, ring) * (1.0 - smoothstep(0.8, 0.97, ring)) * (0.4 + 0.6 * band);
  // Fibres: streaks a couple of cm long and well under a mm across, and finer fuzz.
  let fibre = value(u, v, 20.0, 700.0, 7004) * 0.6 + value(u, v, 50.0, 1400.0, 7005) * 0.4;
  let fuzz = value(u, v, 400.0, 400.0, 7006);
  // Earlywood eroded, and eroded more where the fibres are soft.
  let erosion = fbm01(u, v, 6.0, 40.0, 3, 7007);
  var h = late * 0.45 + (fibre - 0.5) * 0.35 + (fuzz - 0.5) * 0.05 - erosion * 0.3;
  // Checks: many short and fine, some long and wide.
  let fine = dtChecks(u, v, 36.0, 0.35, vec2f(0.05, 0.25), 0.7, T, 7010);
  let wide = dtChecks(u, v, 11.0, 0.45, vec2f(0.3, 0.9), 1.8, T, 7020);
  let crack = max(fine * 0.7, wide);
  h -= fine * 1.2 + wide * 3.0;
  // The check's lips are rounded over and stand up a hair.
  let lip = dtChecks(u, v, 11.0, 0.45, vec2f(0.3, 0.9), 4.0, T, 7020) - wide;
  h += lip * 0.15;
  let shade = (1.0 + (fibre - 0.5) * 0.22 + late * 0.08 - erosion * 0.06) * (1.0 - 0.6 * crack);
  let rough = crack * 0.12 - late * 0.05 + (fuzz - 0.5) * 0.06;
  dtTexel(o, h, shade, rough);
}
