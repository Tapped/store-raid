// Detail: rusted iron. Granular oxide, pits eaten in, and scale lifting in flakes.

const CAVITY = vec2f(1.0, 0.8);
const T = 300.0;

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let grain = value(u, v, 500.0, 500.0, 7701) * 0.6 + value(u, v, 1000.0, 1000.0, 7702) * 0.4;
  let pits = voronoi(u, v, 90.0, 90.0, 7703, 1.0);
  let pr = 0.1 + 0.25 * pits.id;
  let pit = (1.0 - smoothstep(pr * 0.5, pr, pits.f1)) * step(0.35, pits.id2);
  let flakes = voronoiEdges(u, v, 20.0, 20.0, 7704, 1.0);
  let lifted = step(0.6, flakes.id) * smoothstep(0.0, 0.05, flakes.edge);
  let h = (grain - 0.5) * 0.15 - pit * 0.5 + lifted * 0.25 + fbm(u, v, 10.0, 10.0, 3, 7705) * 0.2;
  let shade = (0.9 + 0.2 * grain) * (1.0 - 0.4 * pit) * (1.0 + 0.12 * lifted);
  let rough = pit * 0.08 + (grain - 0.5) * 0.1;
  dtTexel(o, h, shade, rough);
}
