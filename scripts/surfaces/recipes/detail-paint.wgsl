// Detail: old paint (falu red, ochre, white) on boards, grain along u. The film follows the wood:
// latewood ridges and checks telegraph through it; it has crazed into plates long along the grain,
// their edges lifting and curling; brush marks run along the board.

const CAVITY = vec2f(1.0, 0.7);
const T = 500.0;

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // The wood under it, softened by the film.
  let warp = fbm(u, v, 2.0, 3.0, 3, 7201) * 0.05;
  let rings = (v + warp) * 150.0;
  let ring = rings - floor(rings);
  let late = smoothstep(0.55, 0.72, ring) * (1.0 - smoothstep(0.8, 0.97, ring));
  let brush = value(u, v, 12.0, 260.0, 7202);
  // Crazing: plates long along the grain, cracks round them.
  let c = voronoiEdges(u, v, 14.0, 90.0, 7203, 0.9);
  let craze = 1.0 - smoothstep(0.02, 0.07, c.edge);
  // Plate edges curl up a little before they crack open.
  let curl = smoothstep(0.25, 0.04, c.edge) * (0.5 + 0.5 * c.id);
  let check = dtChecks(u, v, 11.0, 0.4, vec2f(0.3, 0.9), 1.2, T, 7210);
  // A few plates have flaked right off to the grey wood, a step down.
  let gone = step(0.93, c.id) * (1.0 - craze);
  let h = late * 0.18 + (brush - 0.5) * 0.12 + curl * 0.12 - craze * 0.45 - check * 1.5 - gone * 0.25;
  let shade = (1.0 + (brush - 0.5) * 0.08) * (1.0 - 0.45 * craze) * (1.0 - 0.5 * check) * (1.0 - 0.25 * gone);
  let rough = craze * 0.15 + gone * 0.2 - (brush - 0.5) * 0.06 + check * 0.1;
  dtTexel(o, h, shade, rough);
}
