// Woven polyethylene tarpaulin, the tint: 3 mm tapes woven over and under under a thin coating,
// creased from being folded, faded and grimy.

const CAVITY = vec2f(3.0, 0.4);
const TAPES = 330.0; // per meter
const FADED = hex(0xb9bcbf);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let x = u * TAPES;
  let y = v * TAPES;
  let ix = floor(x);
  let iy = floor(y);
  // Over and under: which tape is on top alternates like a checkerboard.
  let warpOnTop = (i32(ix) + i32(iy)) % 2 == 0;
  let fx = x - ix;
  let fy = y - iy;
  let along = select(sin(fx * PI), sin(fy * PI), warpOnTop);
  let gap = min(min(fx, 1.0 - fx), min(fy, 1.0 - fy));
  let weave = along * 0.04 - (1.0 - smoothstep(0.0, 0.12, gap)) * 0.03;
  o.a = 0.82 + along * 0.16;
  o.col = vec3f(0.0);
  o.rough = 0.55 + select(0.0, 0.04, warpOnTop);
  // Creases from folding: sharp ridges in a grid-ish pattern, and soft wrinkles.
  let crease = ridged(u, v, 3.0, 3.0, 3, 1401);
  let fold = smoothstep(0.85, 0.98, crease);
  let wrinkle = fbm(u, v, 6.0, 6.0, 4, 1402);
  o.h = weave + wrinkle * 1.5 + fold * 1.2;
  // Faded where the sun got it, whitened along the folds.
  let fade = smoothstep(0.4, 0.85, fbm01(u, v, 2.0, 2.0, 4, 1403)) * 0.2 + fold * 0.25;
  cover(o, FADED, saturate(fade) * 0.35);
  o.rough = mix(o.rough, 0.8, fade);
  let dirt = smoothstep(0.45, 0.85, fbm01(u, v, 5.0, 5.0, 5, 1404));
  cover(o, DIRT, dirt * 0.25);
}
