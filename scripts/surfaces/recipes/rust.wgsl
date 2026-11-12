// Steel rusted right through the paint years ago: flaking layers, pits, mill scale, salt.

const CAVITY = vec2f(4.0, 0.6);
const SCALE = hex(0x4c4a48);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  o.col = vec3f(0.0);
  rust(o, u, v, 1.0, 1.0, 300);
  // Second, coarser layer of flakes lifting off.
  let flake = voronoi(u + fbm(u, v, 8.0, 8.0, 3, 301) * 0.03, v, 14.0, 14.0, 302, 1.0);
  let lift = smoothstep(0.7, 0.95, flake.id) * smoothstep(0.02, 0.06, flake.edge);
  o.h += lift * 0.6;
  o.col *= vec3f(1.0 + lift * 0.15, 1.0 + lift * 0.1, 1.0);
  var rim = 0.0;
  if (lift > 0.0) {
    rim = 1.0 - smoothstep(0.02, 0.05, flake.edge);
  }
  o.col *= 1.0 - rim * 0.5;
  // Mill scale: grey-black islands that held on.
  let scale = smoothstep(0.68, 0.74, fbm01(u, v, 5.0, 5.0, 5, 303));
  cover(o, SCALE, scale);
  o.rough = mix(o.rough, 0.55, scale);
  o.metal = mix(o.metal, 0.35, scale);
  o.h += scale * 0.2;
  let salt = smoothstep(0.72, 0.9, fbm01(u, v, 20.0, 20.0, 4, 304)) * 0.4;
  cover(o, SALT, salt * 0.35);
}
