import { fbm01, mix, scratches, smoothstep } from "../noise";
import type { Recipe } from "../recipe";
import { cover, DIRT, rust, STEEL, galvanised as zinc } from "./common";

/** Hot-dip galvanised steel, a few years in sea air: spangle, white rust, dirt, the odd rust spot. */
export const galvanised: Recipe = {
  cavity: { radius: 3, strength: 0.3 },
  sample(u, v, o) {
    zinc(o, u, v, 1, 200, 0.7);
    const dirt = smoothstep(0.45, 0.85, fbm01(u, v, 4, 4, 5, 210)) * 0.35;
    cover(o, DIRT, dirt * 0.5);
    o.rough = mix(o.rough, 0.8, dirt);
    const s = scratches(u, v, 6, 3, 220, 0.12, 0.0008, 0, Math.PI);
    cover(o, STEEL, s * 0.5);
    o.rough = mix(o.rough, 0.25, s * 0.6);
    // Where the zinc has gone: red rust breaking through.
    rust(o, u, v, 1, smoothstep(0.8, 0.92, fbm01(u, v, 10, 10, 5, 230)), 240);
  },
};
