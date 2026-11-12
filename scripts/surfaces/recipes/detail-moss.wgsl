// Detail: moss cushions and turf. Tiny sprigs packed in tufts on soft cushions, with dead fibre and
// grass stalks lying through it.

const CAVITY = vec2f(2.0, 0.9);
const T = 400.0;

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let tile = T / 1000.0;
  let m = mossBed(u, v, tile, 7501);
  // Dead stalks and fibre, lying any way, a little raised.
  let s1 = scratches(u, v, 16.0, 3, 7502, 0.04, 0.0012, 0.0, PI);
  let s2 = scratches(u, v, 24.0, 2, 7503, 0.025, 0.0009, 1.0, PI);
  let stalk = max(s1, s2);
  let h = m.x * 0.8 + stalk * 0.6;
  let shade = m.y * (1.0 + stalk * 0.35);
  let rough = (1.0 - m.y) * 0.1 - stalk * 0.05;
  dtTexel(o, h, shade, rough);
}
