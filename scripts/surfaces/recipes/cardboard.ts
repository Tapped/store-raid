import { clamp, fbm, fbm01, mix, scratches, smoothstep, value, voronoi } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { cover, DIRT, setColour } from "./common";

/**
 * Brown corrugated board: kraft liner over 6 mm flutes along v, fibre flecks, scuffs, creases where
 * it's been crushed, and tide marks where it got wet.
 */
const KRAFT = hex(0x9c7a52);
const FLUTES = 160; // per meter

export const cardboard: Recipe = {
  cavity: { radius: 3, strength: 0.4 },
  sample(u, v, o) {
    const fleck = value(u, v, 900, 300, 1301);
    const broad = fbm(u, v, 3, 3, 4, 1302);
    setColour(o, KRAFT, 0.92 + fleck * 0.12 + broad * 0.08);
    // Dark and light fibres.
    const fibres = voronoi(u, v, 400, 400, 1303, 1);
    const fibre = (1 - smoothstep(0.03, 0.08, fibres.edge)) * smoothstep(0.85, 0.95, fibres.id);
    o.r *= 1 - fibre * 0.3;
    o.g *= 1 - fibre * 0.3;
    o.b *= 1 - fibre * 0.3;
    o.h = Math.cos(u * FLUTES * Math.PI * 2) * 0.08 + fleck * 0.03 + broad * 0.2;
    o.rough = 0.88 + fleck * 0.06;
    // Creases: crushed lines, a sharp fold in the height.
    const crease = fbm01(u, v, 3, 3, 3, 1304);
    const fold = 1 - smoothstep(0, 0.012, Math.abs(crease - 0.5));
    o.h -= fold * 0.6 * smoothstep(0.3, 0.7, fbm01(u, v, 5, 5, 2, 1305));
    o.r *= 1 - fold * 0.15;
    o.g *= 1 - fold * 0.15;
    o.b *= 1 - fold * 0.15;
    // Water marks: darker, with a tide line.
    const wet = fbm01(u, v, 2, 2, 5, 1306);
    const damp = smoothstep(0.62, 0.66, wet);
    const tide = smoothstep(0.6, 0.62, wet) * (1 - smoothstep(0.62, 0.65, wet));
    o.r *= 1 - damp * 0.25 - tide * 0.2;
    o.g *= 1 - damp * 0.27 - tide * 0.22;
    o.b *= 1 - damp * 0.3 - tide * 0.25;
    o.h += damp * fbm(u, v, 20, 20, 3, 1307) * 0.3;
    // Scuffs: the liner rubbed through to paler fibre.
    const s = scratches(u, v, 6, 3, 1308, 0.1, 0.004, 0, Math.PI);
    cover(o, hex(0xc4a77f), s * 0.5);
    o.rough = mix(o.rough, 0.95, s);
    cover(o, DIRT, clamp(smoothstep(0.5, 0.85, fbm01(u, v, 6, 6, 4, 1309)) * 0.3));
  },
};
