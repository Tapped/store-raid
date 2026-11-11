import { clamp, fbm, fbm01, mix, scratches, smoothstep } from "../noise";
import type { Recipe } from "../recipe";
import { type Colour, hex } from "../recipe";
import { concrete, cover, DIRT } from "./common";

/**
 * Line paint on a warehouse slab, worn through where the wheels go: the tint is the paint, over
 * concrete that shows where it's gone. For lane lines, bay marks and walkways: cut it to strips.
 */
const TILE = 2;
const RUBBER = hex(0x1d1c1a);

export const floorPaint: Recipe = {
  cavity: { radius: 4, strength: 0.4 },
  sample(u, v, o) {
    concrete(o, u, v, TILE, 900, hex(0x86847e));
    const substrate: Colour = [o.r, o.g, o.b];
    // The paint, thick enough to fill the pores, a little uneven from the roller.
    const roller = fbm(u, v, 8, 30, 3, 901);
    o.a = 0.92 + roller * 0.05;
    o.r = o.g = o.b = 0;
    o.h = o.h * 0.4 + 0.25;
    o.rough = 0.5 + roller * 0.05;
    // Worn through: broad thin patches, then bare where the wear is worst.
    const wear = fbm01(u, v, 3, 3, 5, 902) * 0.7 + fbm01(u, v, 24, 24, 3, 903) * 0.3;
    const thin = smoothstep(0.5, 0.65, wear);
    const bare = smoothstep(0.62, 0.68, wear + fbm(u, v, 120, 120, 2, 904) * 0.04);
    cover(o, substrate, thin * 0.35 + bare * 0.65);
    o.h -= bare * 0.25;
    o.rough = mix(o.rough, 0.85, Math.max(bare, thin * 0.4));
    // Flaked edges: chips lifted out of the paint film.
    const flake = smoothstep(0.7, 0.72, fbm01(u, v, 60, 60, 4, 905)) * smoothstep(0.4, 0.6, wear);
    cover(o, substrate, flake);
    o.h -= flake * 0.25;
    // Tyre marks and grime over all of it.
    const marks = Math.max(
      scratches(u, v, 3, 2, 906, 0.6, 0.03, 0, 0.25),
      scratches(u, v, 6, 1, 907, 0.3, 0.008, Math.PI / 2, 0.4),
    );
    cover(o, RUBBER, marks * 0.35 * (0.5 + 0.5 * fbm01(u, v, 40, 40, 2, 908)));
    const grime = smoothstep(0.35, 0.8, fbm01(u, v, 6, 6, 5, 909));
    cover(o, DIRT, clamp(grime * 0.3));
    o.rough = mix(o.rough, 0.75, grime * 0.4);
  },
};
