// Black rubber: moulded stipple, dust settled in it, polished where it's walked or driven on.

const CAVITY = vec2f(2.0, 0.8);
const RUBBER = hex(0x1c1c1c);
const DUST = hex(0x6c6862);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let stipple = value(u, v, 500.0, 500.0, 1201);
  let broad = fbm(u, v, 4.0, 4.0, 4, 1202);
  setColour(o, RUBBER, 0.9 + stipple * 0.15 + broad * 0.08);
  o.h = stipple * 0.12 + broad * 0.2;
  o.rough = 0.75 + stipple * 0.1;
  // Polished wear: smooth, slightly darker and glossier.
  let worn = smoothstep(0.45, 0.75, fbm01(u, v, 3.0, 3.0, 5, 1203));
  o.h *= 1.0 - worn * 0.7;
  o.rough = mix(o.rough, 0.45, worn);
  // Dust settled in the stipple where it isn't worn.
  let dust = (1.0 - stipple) * (1.0 - worn) * smoothstep(0.4, 0.8, fbm01(u, v, 20.0, 20.0, 4, 1204));
  cover(o, DUST, dust * 0.25);
  o.rough = mix(o.rough, 0.95, dust);
  cover(o, DIRT, smoothstep(0.5, 0.85, fbm01(u, v, 10.0, 10.0, 4, 1205)) * 0.2);
  // Cuts and scuffs, grey.
  let s = scratches(u, v, 5.0, 1, 1206, 0.06, 0.001, 0.0, PI);
  cover(o, DUST, s * 0.4);
  o.h -= s * 0.2;
}
