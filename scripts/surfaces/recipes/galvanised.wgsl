// Hot-dip galvanised steel, a few years in sea air: spangle, white rust, dirt, the odd rust spot.

const CAVITY = vec2f(3.0, 0.3);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  galvanised(o, u, v, 1.0, 200, 0.7);
  let dirt = smoothstep(0.45, 0.85, fbm01(u, v, 4.0, 4.0, 5, 210)) * 0.35;
  cover(o, DIRT, dirt * 0.5);
  o.rough = mix(o.rough, 0.8, dirt);
  let s = scratches(u, v, 6.0, 3, 220, 0.12, 0.0008, 0.0, PI);
  cover(o, STEEL, s * 0.5);
  o.rough = mix(o.rough, 0.25, s * 0.6);
  // Where the zinc has gone: red rust breaking through.
  rust(o, u, v, 1.0, smoothstep(0.8, 0.92, fbm01(u, v, 10.0, 10.0, 5, 230)), 240);
}
