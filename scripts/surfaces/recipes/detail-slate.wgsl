// Detail: slate, laminae along u. The cleavage face is fine parallel layers; some have flaked off in
// terraces with small steps at their edges, chipped; a faint sheen on the fresh layers.

const CAVITY = vec2f(1.0, 0.6);
const T = 500.0;

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // Laminae: very fine lines across v, wavering.
  let warp = fbm(u, v, 3.0, 4.0, 3, 7401) * 0.03;
  let lam = (v + warp) * 400.0;
  let line = abs(fract(lam) - 0.5) * 2.0;
  let laminae = smoothstep(0.7, 1.0, line) * (0.4 + 0.6 * value(u, v, 30.0, 400.0, 7402));
  // Terraces: the height quantised into steps where layers flaked off.
  let field = fbm01(u, v, 5.0, 8.0, 4, 7403) * 4.0;
  let level = floor(field);
  let rise = smoothstep(0.0, 0.08, field - level);
  let terrace = (level + rise) * 0.6;
  let edge = 1.0 - smoothstep(0.0, 0.08, field - level);
  let chip = value(u, v, 180.0, 180.0, 7404);
  let h = terrace + laminae * 0.2 - edge * chip * 0.4 + (value(u, v, 300.0, 300.0, 7405) - 0.5) * 0.08;
  let fresh = hash(i32(level), 0, 7406);
  let shade = (0.9 + 0.2 * fresh) * (1.0 - 0.35 * edge * chip) * (1.0 - 0.1 * laminae);
  let rough = -0.1 * fresh + edge * 0.1;
  dtTexel(o, h, shade, rough);
}
