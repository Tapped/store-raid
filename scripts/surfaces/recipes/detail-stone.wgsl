// Detail: granite and gneiss. Salt-and-pepper crystals a few mm across, pale feldspar, glassy
// quartz standing proud where the rest has weathered back, dark mica sunk in; finer grains between,
// pits where crystals fell out, and hairline cracks.

const CAVITY = vec2f(1.5, 0.8);
const T = 600.0;

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  // Crystals, slightly drawn out along u as in gneiss.
  let c = voronoi(u + fbm(u, v, 20.0, 20.0, 2, 7301) * 0.004, v, 180.0, 240.0, 7302, 0.95);
  let small = voronoi(u, v, 520.0, 520.0, 7303, 1.0);
  var shade = 1.0;
  var h = 0.0;
  var rough = 0.0;
  if (c.id < 0.5) {
    // Feldspar: pale, a little cloudy.
    shade = 1.12 + 0.1 * c.id2;
    h = 0.1;
  } else if (c.id < 0.82) {
    // Quartz: grey, glassy, hard.
    shade = 0.92;
    h = 0.22;
    rough = -0.18;
  } else {
    // Mica and hornblende: black, soft, weathered back.
    shade = 0.42;
    h = -0.12;
    rough = -0.05;
  }
  // Each crystal a dome, faceted a little by the finer grains.
  h += (1.0 - smoothstep(0.1, 0.75, c.f1)) * 0.12 - (1.0 - smoothstep(0.0, 0.06, c.edge)) * 0.12;
  h += (small.id - 0.5) * 0.08;
  shade *= 0.92 + 0.16 * small.id;
  // Pits: crystals plucked out.
  let pit = voronoi(u, v, 60.0, 60.0, 7304, 1.0);
  let pr = 0.06 + 0.14 * step(0.85, pit.id) * pit.id;
  let inPit = 1.0 - smoothstep(pr * 0.6, pr, pit.f1);
  h -= inPit * 0.9;
  shade *= 1.0 - 0.35 * inPit;
  rough += inPit * 0.1;
  // Hairline cracks.
  let crack = voronoiEdges(u, v, 4.0, 4.0, 7305, 1.0);
  let hair = (1.0 - smoothstep(0.0, 0.004, crack.edge)) * step(0.4, crack.id);
  h -= hair * 0.6;
  shade *= 1.0 - 0.45 * hair;
  // Broad weathering of the face.
  h += fbm(u, v, 12.0, 12.0, 4, 7306) * 0.4;
  dtTexel(o, h, shade, rough);
}
