// Detail maps: tiling micro-detail that client/src/detailMap.ts blends over the village models'
// unique bakes, close up (the `detail-*` surfaces). They're neutral, so they only add to the bake:
//
//   normal  from the height, as every surface: the fine relief (grain, checks, crystals, sprigs)
//   base    a multiplier on the bake's colour, written as grey: 0.5 is ×1 (dtTexel writes it so the
//           byte reads 0.5 × multiplier, linear; the client loads it as data, not as sRGB)
//   orm     ambient occlusion from the cavity, folded into the multiplier by the client;
//           roughness as 0.5 + an offset to the bake's
//
// The client evens each out, so the average multiplier is 1 and the average offset 0: a detail
// map can't make a model lighter, darker, shinier or duller as a whole, only finer.
// Wood, bark and paint run along u, which the client turns along each member's grain.

// Writes a detail texel: height in mm, colour multiplier around 1, roughness offset around 0.
fn dtTexel(o: ptr<function, Texel>, h: f32, shade: f32, rough: f32) {
  o.h = h;
  o.col = vec3f(linear(clamp(0.5 * shade, 0.0, 1.0)));
  o.rough = clamp(0.5 + rough, 0.03, 1.0);
  o.metal = 0.0;
}

// Long thin cracks along u, `rows` rows across one repeat, one crack in a `chance` share of them,
// each `len` (min, max, in repeats) long and up to `width` mm wide, tapering at both ends; `tile`
// in mm. Returns how much of the crack (0 to 1) the texel is in, soft over its width.
fn dtChecks(u: f32, v: f32, rows: f32, chance: f32, len: vec2f, width: f32, tile: f32, seed: i32) -> f32 {
  let row = floor(v * rows);
  let r = wrap(i32(row), i32(rows));
  if (hash(r, 0, seed) > chance) {
    return 0.0;
  }
  let along = wrapDelta(u, hash(r, 1, seed));
  let half = mix(len.x, len.y, hash(r, 2, seed)) * 0.5;
  let t = abs(along) / half;
  if (t >= 1.0) {
    return 0.0;
  }
  // It wanders a little across the grain.
  let wobble = fbm(u, v, 5.0, rows, 2, seed + 3) * 0.1 + fbm(u, v, 40.0, rows, 1, seed + 5) * 0.01;
  let centre = (row + 0.3 + 0.4 * hash(r, 3, seed) + wobble) / rows;
  let across = abs(v - centre) * tile;
  let w = width * (0.35 + 0.65 * hash(r, 4, seed)) * sqrt(1.0 - t * t);
  return 1.0 - smoothstep(w * 0.25, w * 0.5 + 0.25, across);
}
