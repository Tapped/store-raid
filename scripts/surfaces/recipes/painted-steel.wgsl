// Gloss paint on steel by the sea: chipped in clusters, primer, rust, runs, salt. Paint is the tint.

const CAVITY = vec2f(3.0, 0.4);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  var p = paint(1.0, 100, 0.25, 0.8);
  p.runs = 0.8;
  p.wash = 0.5;
  paintedMetal(o, u, v, p);
  // Scratches through the paint, bright where fresh.
  let s = scratches(u, v, 5.0, 2, 110, 0.18, 0.0012, 0.3, 0.6);
  if (s > 0.0) {
    cover(o, STEEL, s * 0.7);
    o.metal = mix(o.metal, 1.0, s * 0.7);
    o.rough = mix(o.rough, 0.4, s * 0.7);
    o.h -= s * 0.05;
  }
  // Salt dried white at the bottom of runs.
  let salt = smoothstep(0.75, 0.92, fbm01(u, v, 50.0, 50.0, 3, 120)) * 0.25;
  cover(o, SALT, salt * 0.3);
  o.rough = mix(o.rough, 0.85, salt);
  // Hand grime.
  cover(o, DIRT, smoothstep(0.55, 0.85, fbm01(u, v, 6.0, 6.0, 4, 130)) * 0.15);
}
