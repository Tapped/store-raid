import { fbm, fbm01, mix, smoothstep, voronoi } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { cover, rust as oxide, SALT } from "./common";

const SCALE = hex(0x4c4a48);

/** Steel rusted right through the paint years ago: flaking layers, pits, mill scale, salt. */
export const rust: Recipe = {
  cavity: { radius: 4, strength: 0.6 },
  sample(u, v, o) {
    o.r = o.g = o.b = 0;
    oxide(o, u, v, 1, 1, 300);
    // Second, coarser layer of flakes lifting off.
    const flake = voronoi(u + fbm(u, v, 8, 8, 3, 301) * 0.03, v, 14, 14, 302, 1);
    const lift = smoothstep(0.7, 0.95, flake.id) * smoothstep(0.02, 0.06, flake.edge);
    o.h += lift * 0.6;
    o.r *= 1 + lift * 0.15;
    o.g *= 1 + lift * 0.1;
    const rim = lift > 0 ? 1 - smoothstep(0.02, 0.05, flake.edge) : 0;
    o.r *= 1 - rim * 0.5;
    o.g *= 1 - rim * 0.5;
    o.b *= 1 - rim * 0.5;
    // Mill scale: grey-black islands that held on.
    const scale = smoothstep(0.68, 0.74, fbm01(u, v, 5, 5, 5, 303));
    cover(o, SCALE, scale);
    o.rough = mix(o.rough, 0.55, scale);
    o.metal = mix(o.metal, 0.35, scale);
    o.h += scale * 0.2;
    const salt = smoothstep(0.72, 0.9, fbm01(u, v, 20, 20, 4, 304)) * 0.4;
    cover(o, SALT, salt * 0.35);
  },
};
