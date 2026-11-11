import { clamp, fbm, fbm01, hash, mix, smoothstep, value, wrapDelta } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { cover, DIRT } from "./common";

/**
 * Office carpet tiles, 500 mm, four by four (the client quarter-turns them): loop pile in rows,
 * heathered yarn in the tint with darker flecks, matted lanes, stains, and dark seams.
 */
const TILE = 2000; // mm
const N = 4;
const LOOPS = 600; // rows per meter-ish
const COFFEE = hex(0x3a2a1c);

export const carpetTile: Recipe = {
  cavity: { radius: 2, strength: 0.7 },
  sample(u, v, o) {
    const gx = u * N;
    const gy = v * N;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const toEdge = Math.min(fx, 1 - fx, fy, 1 - fy) * (TILE / N);
    // Loop pile: a grid of tufts about 2.5 mm apart, each its own height and yarn.
    const rows = Math.round((LOOPS * TILE) / 1000);
    const lx = u * rows;
    const ly = v * rows;
    const cx = Math.floor(lx);
    const cy = Math.floor(ly);
    const tuft = hash(cx % rows, cy % rows, 1700);
    const shape = Math.sin((lx - cx) * Math.PI) * Math.sin((ly - cy) * Math.PI);
    const loop = shape * (0.6 + 0.4 * tuft);
    // Heathered: each tuft's yarn a shade of the tint, some darker, a few paler flecks.
    const yarn = hash(cx % rows, cy % rows, 1701);
    const dark = yarn < 0.18 ? 0.35 : 0;
    const pale = yarn > 0.94 ? 0.05 : 0;
    const fade = value(u, v, 40, 40, 1708);
    o.a = (0.78 + 0.18 * tuft - dark) * (0.85 + 0.15 * shape) * (0.95 + 0.1 * fade);
    o.r = o.g = o.b = pale;
    o.h = loop * 0.8 + fbm(u, v, 20, 20, 3, 1709) * 0.2;
    o.rough = 0.95;
    o.metal = 0;
    // Matted, grubby lanes where people walk.
    const lane = smoothstep(0.4, 0.75, fbm01(u, v, 2, 2, 4, 1702));
    o.h *= 1 - lane * 0.6;
    cover(o, DIRT, lane * 0.45);
    o.rough = mix(o.rough, 0.85, lane);
    // Stains: coffee rings and dark spots.
    const tile = hash(ix, iy, 1703);
    if (tile > 0.7) {
      const cx = 0.2 + 0.6 * hash(ix, iy, 1704);
      const cy = 0.2 + 0.6 * hash(ix, iy, 1705);
      const r = Math.hypot(wrapDelta(fx, cx), fy - cy) * (1 + fbm(u, v, 30, 30, 3, 1706) * 0.4);
      const size = 0.05 + 0.12 * hash(ix, iy, 1707);
      const stain = 1 - smoothstep(size * 0.7, size, r);
      cover(
        o,
        COFFEE,
        clamp(stain * 0.45 + (1 - smoothstep(0, 0.012, Math.abs(r - size * 0.9))) * 0.3),
      );
    }
    // Seams between tiles: the pile parts and shows dark backing.
    const seam = 1 - smoothstep(0.4, 1.4, toEdge);
    cover(o, hex(0x141414), seam * 0.8);
    o.h -= seam * 1.5;
    cover(o, DIRT, (1 - smoothstep(1, 12, toEdge)) * 0.2);
  },
};
