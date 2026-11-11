import { fbm01, mix, scratches, smoothstep } from "../noise";
import type { Recipe } from "../recipe";
import { cover, DIRT, paintedMetal, SALT, STEEL } from "./common";

/** Gloss paint on steel by the sea: chipped in clusters, primer, rust, runs, salt. Paint is the tint. */
export const paintedSteel: Recipe = {
  cavity: { radius: 3, strength: 0.4 },
  sample(u, v, o) {
    paintedMetal(o, u, v, { tile: 1, seed: 100, damage: 0.55, age: 0.8, runs: 0.8, wash: 0.6 });
    // Scratches through the paint, bright where fresh.
    const s = scratches(u, v, 5, 2, 110, 0.18, 0.0012, 0.3, 0.6);
    if (s > 0) {
      cover(o, STEEL, s * 0.7);
      o.metal = mix(o.metal, 1, s * 0.7);
      o.rough = mix(o.rough, 0.4, s * 0.7);
      o.h -= s * 0.05;
    }
    // Salt dried white at the bottom of runs.
    const salt = smoothstep(0.7, 0.9, fbm01(u, v, 30, 6, 4, 120)) * 0.35;
    cover(o, SALT, salt * 0.4);
    o.rough = mix(o.rough, 0.85, salt);
    // Hand grime.
    cover(o, DIRT, smoothstep(0.55, 0.85, fbm01(u, v, 6, 6, 4, 130)) * 0.15);
  },
};
