// Line paint on a warehouse slab, worn through where the wheels go: the tint is the paint, over
// concrete that shows where it's gone. For lane lines, bay marks and walkways: cut it to strips.

const CAVITY = vec2f(4.0, 0.4);
const TILE = 2.0;
const RUBBER = hex(0x1d1c1a);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  concrete(o, u, v, TILE, 900, hex(0x86847e));
  let substrate = o.col;
  // The paint, thick enough to fill the pores, a little uneven from the roller.
  let roller = fbm(u, v, 8.0, 30.0, 3, 901);
  o.a = 0.92 + roller * 0.05;
  o.col = vec3f(0.0);
  o.h = o.h * 0.4 + 0.25;
  o.rough = 0.5 + roller * 0.05;
  // Worn through: broad thin patches, then bare where the wear is worst.
  let wear = fbm01(u, v, 3.0, 3.0, 5, 902) * 0.7 + fbm01(u, v, 24.0, 24.0, 3, 903) * 0.3;
  let thin = smoothstep(0.5, 0.65, wear);
  let bare = smoothstep(0.62, 0.68, wear + fbm(u, v, 120.0, 120.0, 2, 904) * 0.04);
  cover(o, substrate, thin * 0.35 + bare * 0.65);
  o.h -= bare * 0.25;
  o.rough = mix(o.rough, 0.85, max(bare, thin * 0.4));
  // Flaked edges: chips lifted out of the paint film.
  let flake = smoothstep(0.7, 0.72, fbm01(u, v, 60.0, 60.0, 4, 905)) * smoothstep(0.4, 0.6, wear);
  cover(o, substrate, flake);
  o.h -= flake * 0.25;
  // Tyre marks and grime over all of it.
  let marks = max(
    scratches(u, v, 3.0, 2, 906, 0.6, 0.03, 0.0, 0.25),
    scratches(u, v, 6.0, 1, 907, 0.3, 0.008, PI / 2.0, 0.4),
  );
  cover(o, RUBBER, marks * 0.35 * (0.5 + 0.5 * fbm01(u, v, 40.0, 40.0, 2, 908)));
  let grime = smoothstep(0.35, 0.8, fbm01(u, v, 6.0, 6.0, 5, 909));
  cover(o, DIRT, saturate(grime * 0.3));
  o.rough = mix(o.rough, 0.75, grime * 0.4);
}
