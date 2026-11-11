import { clamp, fbm, fbm01, hash, mix, ridged, smoothstep, value, voronoi } from "../noise";
import type { Recipe } from "../recipe";
import { hex, setColour } from "../recipe";
import { cover, DIRT } from "./common";

/**
 * Suspended ceiling from below: 600 mm fissured mineral-fibre tiles, four by four, in a white T-bar
 * grid on their edges. Some tiles yellowed, some water-stained in rings, the odd one sagging; dust
 * along the edges where air leaks past.
 */
const TILE = 2400; // mm
const N = 4;
const FIBRE = hex(0xd9d6cc);
const GRID = hex(0xe6e5e0);
const STAIN = hex(0x8a6d45);
const YELLOW = hex(0xcfc29c);
const HALF_BAR = 12; // mm

export const ceilingTile: Recipe = {
  cavity: { radius: 3, strength: 0.6 },
  sample(u, v, o) {
    const gx = u * N;
    const gy = v * N;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const cell = TILE / N;
    const toEdge = Math.min(fx, 1 - fx, fy, 1 - fy) * cell; // mm
    const id = hash(ix, iy, 1600);
    const id2 = hash(ix, iy, 1601);

    // Mineral fibre: fine porous speckle and worm-like fissures pressed in.
    const speckle = value(u, v, 2400, 2400, 1602);
    const fissure = smoothstep(0.88, 0.97, ridged(u + id, v, 70, 70, 2, 1603));
    const pores = voronoi(u, v, 900, 900, 1604, 1);
    const pore = (1 - smoothstep(0.1, 0.3, pores.f1)) * smoothstep(0.5, 0.9, pores.id);
    setColour(o, FIBRE, (0.94 + speckle * 0.08) * (1 - fissure * 0.25) * (1 - pore * 0.2));
    o.h = speckle * 0.1 - fissure * 0.6 - pore * 0.3;
    o.rough = 0.95;
    o.metal = 0;
    // Some tiles yellowed with age or a different batch.
    if (id < 0.25) cover(o, YELLOW, 0.4 + id);
    // Sag: the middle hangs towards us.
    if (id2 < 0.12) o.h += Math.sin(fx * Math.PI) * Math.sin(fy * Math.PI) * 6;
    // Water stains: rings spreading from a leak.
    if (id2 > 0.82) {
      const cx = 0.3 + 0.4 * hash(ix, iy, 1605);
      const cy = 0.3 + 0.4 * hash(ix, iy, 1606);
      const r = Math.hypot(fx - cx, fy - cy) * (1 + fbm(u, v, 20, 20, 3, 1607) * 0.3);
      const size = 0.2 + 0.25 * hash(ix, iy, 1608);
      const stain = 1 - smoothstep(size * 0.8, size, r);
      const ring = (1 - smoothstep(0, 0.02, Math.abs(r - size * 0.9))) * 0.8;
      const inner = (1 - smoothstep(0, 0.015, Math.abs(r - size * 0.55))) * 0.4;
      cover(o, STAIN, clamp(stain * 0.25 + ring * 0.35 + inner * 0.25));
    }
    // Dust round the edges, where air leaks past the grid.
    const dust =
      (1 - smoothstep(HALF_BAR, HALF_BAR + 40, toEdge)) *
      (0.4 + 0.6 * fbm01(u, v, 30, 30, 3, 1609));
    cover(o, DIRT, dust * 0.3);
    // The tile's edge drops behind the grid: a shadowed reveal.
    const reveal = 1 - smoothstep(HALF_BAR, HALF_BAR + 6, toEdge);
    o.h -= reveal * 2;
    o.ao *= 1 - reveal * 0.4;
    // The T-bar: white painted steel, a touch glossy, nearest to us.
    const bar = 1 - smoothstep(HALF_BAR - 0.8, HALF_BAR, toEdge);
    if (bar > 0) {
      setColour(o, GRID, 0.95 + value(u, v, 1200, 1200, 1610) * 0.05);
      o.h = mix(o.h, 4, bar);
      o.rough = mix(o.rough, 0.45, bar);
      o.ao = mix(o.ao, 1, bar);
      cover(o, DIRT, bar * smoothstep(0.5, 0.9, fbm01(u, v, 12, 12, 3, 1611)) * 0.2);
    }
  },
};
