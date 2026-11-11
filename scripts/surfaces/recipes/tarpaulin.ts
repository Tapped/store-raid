import { clamp, fbm, fbm01, mix, ridged, smoothstep } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { cover, DIRT } from "./common";

/**
 * Woven polyethylene tarpaulin, the tint: 3 mm tapes woven over and under under a thin coating,
 * creased from being folded, faded and grimy.
 */
const TAPES = 330; // per meter
const FADED = hex(0xb9bcbf);

export const tarpaulin: Recipe = {
  cavity: { radius: 3, strength: 0.4 },
  sample(u, v, o) {
    const x = u * TAPES;
    const y = v * TAPES;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    // Over and under: which tape is on top alternates like a checkerboard.
    const warpOnTop = (ix + iy) % 2 === 0;
    const fx = x - ix;
    const fy = y - iy;
    const along = warpOnTop ? Math.sin(fy * Math.PI) : Math.sin(fx * Math.PI);
    const gap = Math.min(fx, 1 - fx, fy, 1 - fy);
    const weave = along * 0.04 - (1 - smoothstep(0, 0.12, gap)) * 0.03;
    o.a = 0.82 + along * 0.16;
    o.r = o.g = o.b = 0;
    o.rough = 0.55 + (warpOnTop ? 0.04 : 0);
    // Creases from folding: sharp ridges in a grid-ish pattern, and soft wrinkles.
    const crease = ridged(u, v, 3, 3, 3, 1401);
    const fold = smoothstep(0.85, 0.98, crease);
    const wrinkle = fbm(u, v, 6, 6, 4, 1402);
    o.h = weave + wrinkle * 1.5 + fold * 1.2;
    // Faded where the sun got it, whitened along the folds.
    const fade = smoothstep(0.4, 0.85, fbm01(u, v, 2, 2, 4, 1403)) * 0.2 + fold * 0.25;
    cover(o, FADED, clamp(fade) * 0.35);
    o.rough = mix(o.rough, 0.8, fade);
    const dirt = smoothstep(0.45, 0.85, fbm01(u, v, 5, 5, 5, 1404));
    cover(o, DIRT, dirt * 0.25);
  },
};
