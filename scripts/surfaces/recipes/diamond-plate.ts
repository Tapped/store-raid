import { clamp, fbm01, mix, scratches, smoothstep, value, wrap } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { cover, DIRT, rust, STEEL, setColour } from "./common";

/**
 * Steel tread plate: raised lugs in alternating diagonals, 16 cells to the half meter. Worn bright
 * and smooth on top, dirt and rust packed between, scuffed where boots and wheels go.
 */
const CELLS = 16;
const MILL = hex(0x6e7072);

export const diamondPlate: Recipe = {
  cavity: { radius: 4, strength: 0.7 },
  sample(u, v, o) {
    const gx = u * CELLS;
    const gy = v * CELLS;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    let lug = 0;
    // A lug centred in every cell, its diagonal alternating like a checkerboard; neighbours may reach.
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const dir = wrap(cx + cy, 2) === 0 ? 1 : -1;
        const dx = gx - (cx + 0.5);
        const dy = gy - (cy + 0.5);
        const along = (dx + dir * dy) * Math.SQRT1_2;
        const across = (dx * -dir + dy) * Math.SQRT1_2;
        // A capsule 0.9 cells long, 0.2 wide.
        const t = Math.max(0, Math.abs(along) - 0.3);
        const d = Math.hypot(t, across) / 0.16;
        if (d < 1) lug = Math.max(lug, Math.sqrt(1 - d * d));
      }
    }
    const fine = value(u, v, 700, 700, 601);
    setColour(o, MILL, 0.9 + fine * 0.15);
    o.metal = 1;
    o.rough = 0.55 + fine * 0.1;
    o.h = lug * 1.6 + fine * 0.01;
    // Lug tops polished bright by feet.
    const top = smoothstep(0.6, 0.95, lug);
    const worn = top * (0.5 + 0.5 * fbm01(u, v, 6, 6, 4, 602));
    setColour(o, MILL, (0.9 + fine * 0.15) * (1 - worn));
    o.r += STEEL[0] * 1.1 * worn;
    o.g += STEEL[1] * 1.1 * worn;
    o.b += STEEL[2] * 1.1 * worn;
    o.rough = mix(o.rough, 0.3, worn);
    // Dirt packed between the lugs, rust where water stood.
    const low = 1 - smoothstep(0, 0.3, lug);
    const dirt =
      low *
      smoothstep(0.35, 0.75, fbm01(u, v, 16, 16, 4, 603) * 0.7 + fbm01(u, v, 3, 3, 3, 607) * 0.3);
    cover(o, DIRT, dirt * 0.75);
    o.rough = mix(o.rough, 0.9, dirt);
    o.metal = mix(o.metal, 0, dirt * 0.8);
    rust(o, u, v, 0.5, clamp(low * smoothstep(0.6, 0.85, fbm01(u, v, 5, 5, 5, 604)) * 1.2), 605);
    const s = scratches(u, v, 4, 3, 606, 0.3, 0.001, 0, Math.PI);
    cover(o, STEEL, s * 0.4);
  },
};
