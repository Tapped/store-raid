import { fbm, fbm01, hash, mix, smoothstep, value } from "../noise";
import type { Recipe } from "../recipe";
import { hex, setColour } from "../recipe";
import { cover, DIRT } from "./common";

/**
 * White glazed ceramic wall tiles, 150 mm, ten by ten: cushion edges, a slight ripple in the glaze,
 * grey grout gone dark with grime, the odd cracked or chipped tile, and streaks running down.
 */
const TILE = 1500; // mm
const N = 10;
const GLAZE = hex(0xe9e8e2);
const GROUT = hex(0x8d8a82);
const BISCUIT = hex(0xb9a991);
const HALF_GROUT = 1.2; // mm

export const wallTile: Recipe = {
  cavity: { radius: 2, strength: 0.6 },
  sample(u, v, o) {
    const gx = u * N;
    const gy = v * N;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const cell = TILE / N;
    const toEdge = Math.min(fx, 1 - fx, fy, 1 - fy) * cell;
    const id = hash(ix, iy, 1800);
    // Glaze: near white, each tile a shade off, rippled.
    const ripple = fbm(u, v, 40, 40, 3, 1801);
    setColour(o, GLAZE, 0.97 + (id - 0.5) * 0.04);
    // Cushion edge: rounds down over the last 4 mm.
    const cushion = 1 - smoothstep(HALF_GROUT, HALF_GROUT + 4, toEdge);
    o.h = ripple * 0.04 - cushion * cushion * 1.2;
    o.rough = 0.08 + value(u, v, 400, 400, 1802) * 0.04;
    o.metal = 0;
    // Grime clinging to the glaze, and streaks running down.
    const film = smoothstep(0.4, 0.9, fbm01(u, v, 5, 5, 5, 1803));
    cover(o, DIRT, film * 0.12);
    o.rough = mix(o.rough, 0.35, film);
    const streak = smoothstep(0.6, 0.85, fbm01(u, v, 40, 1, 4, 1804));
    cover(o, DIRT, streak * 0.15);
    o.rough = mix(o.rough, 0.3, streak);
    // A cracked tile here and there: a hairline across it, dirty.
    if (id > 0.93) {
      const line = Math.abs(
        fy - 0.5 - (fx - 0.5) * (hash(ix, iy, 1805) - 0.5) * 2 - fbm(u, v, 60, 60, 3, 1806) * 0.08,
      );
      const crack = 1 - smoothstep(0.002, 0.008, line);
      cover(o, DIRT, crack * 0.8);
      o.h -= crack * 0.3;
    }
    // Chipped corners showing the biscuit.
    if (id < 0.08) {
      const corner = Math.hypot(Math.min(fx, 1 - fx), Math.min(fy, 1 - fy)) * cell;
      const chip = 1 - smoothstep(6, 8, corner + fbm(u, v, 200, 200, 2, 1807) * 3);
      cover(o, BISCUIT, chip);
      o.h -= chip * 0.8;
      o.rough = mix(o.rough, 0.9, chip);
    }
    // Grout: recessed, grey, grimed dark in places.
    const grout = 1 - smoothstep(HALF_GROUT - 0.3, HALF_GROUT + 0.3, toEdge);
    if (grout > 0) {
      const g = GROUT;
      const dirt = 0.6 + 0.4 * fbm01(u, v, 30, 30, 4, 1808);
      setColour(o, [
        mix(o.r, g[0] * dirt, grout),
        mix(o.g, g[1] * dirt, grout),
        mix(o.b, g[2] * dirt, grout),
      ]);
      o.h -= grout * 1.0;
      o.rough = mix(o.rough, 0.92, grout);
    }
  },
};
