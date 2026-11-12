// Diagonal hazard stripes painted on concrete, 25 cm apart along u: the tint and black, brushed on
// with soft edges, and worn back to the slab by boots and wheels.

const CAVITY = vec2f(3.0, 0.4);
const TILE = 1.0;
const BLACK = hex(0x1a1a19);
const RUBBER = hex(0x151413);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  concrete(o, u, v, TILE, 1000, hex(0x86847e));
  let substrate = o.col;
  // Stripes: four periods across, so they meet at the edges.
  let edgeWobble = fbm(u, v, 40.0, 40.0, 3, 1001) * 0.012;
  let f = ((u + v) * 4.0 + edgeWobble) % 1.0;
  let black = smoothstep(0.495, 0.505, f) * (1.0 - smoothstep(0.995, 1.0, f));
  o.col = BLACK * black;
  o.a = (1.0 - black) * (0.94 + fbm(u, v, 10.0, 30.0, 3, 1002) * 0.05);
  o.h = o.h * 0.3 + 0.2;
  o.rough = 0.5;
  // Worn through.
  let wear = fbm01(u, v, 3.0, 3.0, 5, 1003) * 0.65 + fbm01(u, v, 30.0, 30.0, 3, 1004) * 0.35;
  let thin = smoothstep(0.48, 0.62, wear);
  let bare = smoothstep(0.6, 0.66, wear + fbm(u, v, 150.0, 150.0, 2, 1005) * 0.04);
  cover(o, substrate, thin * 0.3 + bare * 0.7);
  o.h -= bare * 0.2;
  o.rough = mix(o.rough, 0.85, max(bare, thin * 0.4));
  let marks = scratches(u, v, 4.0, 2, 1006, 0.4, 0.02, 0.0, 0.3);
  cover(o, RUBBER, marks * 0.3);
  let grime = smoothstep(0.4, 0.85, fbm01(u, v, 5.0, 5.0, 5, 1007));
  cover(o, DIRT, saturate(grime * 0.18));
}
