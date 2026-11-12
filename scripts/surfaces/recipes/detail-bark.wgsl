// Detail: bark along u. Plates long along the trunk with deep fissures between, each plate flaking
// into thin scales; fine fibrous streaks.

const CAVITY = vec2f(3.0, 0.9);
const T = 500.0;

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let w = fbm(u, v, 4.0, 6.0, 3, 7601) * 0.02;
  let plates = voronoiEdges(u + w, v, 8.0, 40.0, 7602, 0.9);
  let fissure = 1.0 - smoothstep(0.0, 0.18, plates.edge);
  let scales = voronoi(u, v, 40.0, 140.0, 7603, 1.0);
  let scale = smoothstep(0.0, 0.5, scales.edge) * (0.5 + 0.5 * scales.id);
  let fibre = value(u, v, 30.0, 500.0, 7604);
  let h = (1.0 - fissure) * (2.0 + plates.id * 1.0) + scale * 0.5 + (fibre - 0.5) * 0.3 - fissure * 1.5;
  let shade = (0.85 + 0.25 * plates.id) * (1.0 - 0.55 * fissure) * (0.9 + 0.2 * scale) * (0.95 + 0.1 * fibre);
  let rough = fissure * 0.1 - scale * 0.04;
  dtTexel(o, h, shade, rough);
}
