import { clamp, fbm, fbm01, hash, mix, smoothstep, value, wrapDelta } from "../noise";
import type { Recipe } from "../recipe";
import { blend, hex } from "../recipe";
import { cover, DIRT, RUST_DARK } from "./common";

/**
 * Rough-sawn softwood boards along u, eight of 150 mm in a 1.2 m repeat (the client cuts them into
 * random lengths): growth rings, knots, a gap between boards, greyed and dirty with use, nail heads.
 */
const TILE = 1200; // mm
const BOARDS = 8;
const PALE = hex(0xb08d63);
const DARK = hex(0x7a5a3a);
const GREY = hex(0x857c70);

export const woodPlank: Recipe = {
  cavity: { radius: 4, strength: 0.6 },
  sample(u, v, o) {
    const row = Math.floor(v * BOARDS);
    const inBoard = v * BOARDS - row;
    const id = hash(row, 0, 1100);
    const id2 = hash(row, 1, 1100);
    // Rings: the board cut through a warped trunk, so lines run along it and drift across.
    const warp =
      fbm(u, v, 3, BOARDS, 4, 1101 + row) * 0.6 + fbm(u, v, 12, BOARDS * 2, 2, 1102) * 0.1;
    const ringPos = (inBoard + warp + id * 3) * (5 + id2 * 4);
    let ring = ringPos - Math.floor(ringPos);
    ring = smoothstep(0.0, 0.25, ring) * (1 - smoothstep(0.55, 1, ring));
    // Knots: a few per board, rings swirling round them.
    let knot = 0;
    for (let k = 0; k < 2; k++) {
      const ku = hash(row, k + 10, 1103);
      if (hash(row, k + 20, 1103) > 0.6) continue;
      const du = wrapDelta(u, ku) * TILE;
      const dv = (inBoard - 0.3 - 0.4 * hash(row, k + 30, 1103)) * (TILE / BOARDS);
      const d = Math.hypot(du * 0.5, dv);
      knot = Math.max(knot, 1 - smoothstep(4, 14, d));
    }
    const fibre = value(u, v, 1500, 60, 1104);
    const tone = blend(PALE, DARK, clamp(ring * 0.55 + id * 0.35 + knot * 0.8));
    const k = 0.9 + fibre * 0.2;
    o.r = tone[0] * k;
    o.g = tone[1] * k;
    o.b = tone[2] * k;
    o.h = (fibre - 0.5) * 0.3 + ring * 0.15 - knot * 0.1 + fbm(u, v, 6, BOARDS * 4, 3, 1105) * 0.4;
    o.rough = 0.8 + fibre * 0.1;
    o.metal = 0;
    // Weathered grey and dirt, worn smooth where feet go.
    const grey = smoothstep(0.35, 0.75, fbm01(u, v, 4, 4, 4, 1106)) * (0.4 + 0.4 * id2);
    cover(o, GREY, grey * 0.6);
    cover(o, DIRT, smoothstep(0.5, 0.85, fbm01(u, v, 8, 8, 5, 1107)) * 0.4);
    // The gap between boards: dark, with the edges rounded over.
    const toEdge = Math.min(inBoard, 1 - inBoard) * (TILE / BOARDS); // mm
    const gap = 1 - smoothstep(1.5, 2.5, toEdge);
    o.h -= (1 - smoothstep(0, 6, toEdge)) * 1.2 + gap * 6;
    cover(o, hex(0x1e1914), gap);
    o.ao *= 1 - gap * 0.6;
    // Nail heads along each board, rusted.
    const nu = wrapDelta(u * 3, 0.5) / 3;
    const nd = Math.hypot(nu * TILE, (inBoard - 0.5) * (TILE / BOARDS) + (id - 0.5) * 30);
    const nail = 1 - smoothstep(3, 4.5, nd);
    if (nail > 0) {
      cover(o, RUST_DARK, nail);
      o.h += nail * 0.3;
      o.rough = mix(o.rough, 0.7, nail);
    }
  },
};
