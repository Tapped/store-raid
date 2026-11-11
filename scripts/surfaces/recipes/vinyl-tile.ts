import { fbm, fbm01, hash, mix, scratches, smoothstep, value } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { cover, DIRT } from "./common";

/**
 * Vinyl composition tiles, 300 mm, eight by eight: the tint mottled with streaky chips, waxed to a
 * low gloss and dull in worn lanes, dirt packed in the joints, heel marks, and the odd replaced or
 * cracked tile.
 */
const TILE = 2400; // mm
const N = 8;
const HEEL = hex(0x1d1c1b);

export const vinylTile: Recipe = {
  cavity: { radius: 2, strength: 0.5 },
  sample(u, v, o) {
    const gx = u * N;
    const gy = v * N;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const toEdge = Math.min(fx, 1 - fx, fy, 1 - fy) * (TILE / N);
    const id = hash(ix, iy, 1900);
    // VCT mottle: streaky chips of lighter and darker vinyl, running one way across each tile.
    const streak = fbm(u + id, v, 160, 40, 3, 1901);
    const chipsDark = smoothstep(0.25, 0.45, streak);
    const chipsLight = smoothstep(-0.3, -0.45, streak);
    o.a = 0.9 - chipsDark * 0.25 + (id - 0.5) * 0.06;
    o.r = o.g = o.b = chipsLight * 0.08;
    // A replaced tile, from another batch: a different shade.
    if (id > 0.95) o.a *= 0.82;
    o.h = value(u, v, 800, 800, 1902) * 0.03;
    o.rough = 0.35;
    o.metal = 0;
    // Wax worn off in lanes: dull and greyer.
    const lane = smoothstep(0.45, 0.8, fbm01(u, v, 3, 3, 4, 1903));
    o.rough = mix(o.rough, 0.7, lane);
    cover(o, DIRT, lane * 0.18);
    // Heel and trolley marks.
    const marks = scratches(u, v, 10, 1, 1904, 0.03, 0.0012, 0, Math.PI);
    cover(o, HEEL, marks * 0.6);
    // A cracked tile.
    if (id < 0.04) {
      const line = Math.abs(fy - 0.4 - fx * 0.3 - fbm(u, v, 40, 40, 3, 1905) * 0.06);
      const crack = 1 - smoothstep(0.002, 0.006, line);
      cover(o, DIRT, crack * 0.9);
      o.h -= crack * 0.4;
    }
    // Joints with dirt packed in, and wax built up dirty along them.
    const joint = 1 - smoothstep(0.3, 0.9, toEdge);
    cover(o, DIRT, joint * 0.85);
    o.h -= joint * 0.5;
    cover(o, DIRT, (1 - smoothstep(1, 15, toEdge)) * 0.2);
  },
};
