import { clamp, fbm, fbm01, mix, scratches, smoothstep } from "../noise";
import type { Recipe } from "../recipe";
import { type Colour, hex } from "../recipe";
import { concrete, cover, DIRT } from "./common";

/**
 * Diagonal hazard stripes painted on concrete, 25 cm apart along u: the tint and black, brushed on
 * with soft edges, and worn back to the slab by boots and wheels.
 */
const TILE = 1;
const BLACK = hex(0x1a1a19);
const RUBBER = hex(0x151413);

export const hazard: Recipe = {
  cavity: { radius: 3, strength: 0.4 },
  sample(u, v, o) {
    concrete(o, u, v, TILE, 1000, hex(0x86847e));
    const substrate: Colour = [o.r, o.g, o.b];
    // Stripes: four periods across, so they meet at the edges.
    const edgeWobble = fbm(u, v, 40, 40, 3, 1001) * 0.012;
    const f = ((u + v) * 4 + edgeWobble) % 1;
    const black = smoothstep(0.495, 0.505, f) * (1 - smoothstep(0.995, 1, f));
    o.r = BLACK[0] * black;
    o.g = BLACK[1] * black;
    o.b = BLACK[2] * black;
    o.a = (1 - black) * (0.94 + fbm(u, v, 10, 30, 3, 1002) * 0.05);
    o.h = o.h * 0.3 + 0.2;
    o.rough = 0.5;
    // Worn through.
    const wear = fbm01(u, v, 3, 3, 5, 1003) * 0.65 + fbm01(u, v, 30, 30, 3, 1004) * 0.35;
    const thin = smoothstep(0.48, 0.62, wear);
    const bare = smoothstep(0.6, 0.66, wear + fbm(u, v, 150, 150, 2, 1005) * 0.04);
    cover(o, substrate, thin * 0.3 + bare * 0.7);
    o.h -= bare * 0.2;
    o.rough = mix(o.rough, 0.85, Math.max(bare, thin * 0.4));
    const marks = scratches(u, v, 4, 2, 1006, 0.4, 0.02, 0, 0.3);
    cover(o, RUBBER, marks * 0.3);
    const grime = smoothstep(0.4, 0.85, fbm01(u, v, 5, 5, 5, 1007));
    cover(o, DIRT, clamp(grime * 0.18));
  },
};
