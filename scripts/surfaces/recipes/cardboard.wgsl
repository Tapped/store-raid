// Brown corrugated board: kraft liner over 6 mm flutes along v, fibre flecks, scuffs, creases where
// it's been crushed, and tide marks where it got wet.

const CAVITY = vec2f(3.0, 0.4);
const KRAFT = hex(0x9c7a52);
const FLUTES = 160.0; // per meter

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let fleck = value(u, v, 900.0, 300.0, 1301);
  let broad = fbm(u, v, 3.0, 3.0, 4, 1302);
  setColour(o, KRAFT, 0.92 + fleck * 0.12 + broad * 0.08);
  // Dark and light fibres.
  let fibres = voronoi(u, v, 400.0, 400.0, 1303, 1.0);
  let fibre = (1.0 - smoothstep(0.03, 0.08, fibres.edge)) * smoothstep(0.85, 0.95, fibres.id);
  o.col *= 1.0 - fibre * 0.3;
  o.h = cos(fract(u * FLUTES) * TAU) * 0.08 + fleck * 0.03 + broad * 0.2;
  o.rough = 0.88 + fleck * 0.06;
  // Creases: straight folds where it was crushed, a few per repeat.
  let fold = scratches(u, v, 2.0, 2, 1304, 0.7, 0.004, 0.0, PI) * 0.8;
  o.h -= fold * 0.6;
  o.col *= 1.0 - fold * 0.15;
  // Water marks: darker, with a tide line.
  let wet = fbm01(u, v, 2.0, 2.0, 5, 1306);
  let damp = smoothstep(0.62, 0.66, wet);
  let tide = smoothstep(0.6, 0.62, wet) * (1.0 - smoothstep(0.62, 0.65, wet));
  o.col *= vec3f(1.0 - damp * 0.25 - tide * 0.2, 1.0 - damp * 0.27 - tide * 0.22, 1.0 - damp * 0.3 - tide * 0.25);
  o.h += damp * fbm(u, v, 20.0, 20.0, 3, 1307) * 0.3;
  // Scuffs: the liner rubbed through to paler fibre.
  let s = scratches(u, v, 4.0, 1, 1308, 0.08, 0.006, 0.0, PI);
  cover(o, hex(0xc4a77f), s * 0.35);
  o.rough = mix(o.rough, 0.95, s);
  cover(o, DIRT, saturate(smoothstep(0.5, 0.85, fbm01(u, v, 6.0, 6.0, 4, 1309)) * 0.3));
}
