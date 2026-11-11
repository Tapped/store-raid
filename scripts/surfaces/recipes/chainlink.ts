import { fbm01, smoothstep, wrapDelta } from "../noise";
import type { Recipe } from "../recipe";
import { galvanised, rust } from "./common";

/**
 * Galvanised chain-link: 3 mm wires on the diagonals, about 53 mm apart, crossing over and under.
 * Alpha is the wire's coverage; the client cuts the holes out.
 */
const TILE = 300; // mm
const N = 4; // diagonals each way across the repeat
const RADIUS = 1.6; // mm

export const chainlink: Recipe = {
  sample(u, v, o) {
    // Distance from each set of diagonals, in mm.
    const a = wrapDelta((u + v) * N, 0);
    const b = wrapDelta((u - v) * N, 0);
    const spacing = TILE / (N * Math.SQRT2);
    const da = Math.abs(a) * spacing;
    const db = Math.abs(b) * spacing;
    // Which wire is on top at a crossing alternates.
    const ia = Math.round((u + v) * N);
    const ib = Math.round((u - v) * N);
    const aOnTop = (ia + ib) % 2 === 0;
    const ha = da < RADIUS ? Math.sqrt(RADIUS * RADIUS - da * da) + (aOnTop ? 1.2 : 0) : -9;
    const hb = db < RADIUS ? Math.sqrt(RADIUS * RADIUS - db * db) + (aOnTop ? 0 : 1.2) : -9;
    const h = Math.max(ha, hb);
    galvanised(o, u, v, TILE / 1000, 2000, 0.4);
    const cover = 1 - smoothstep(RADIUS - 0.3, RADIUS + 0.2, Math.min(da, db));
    o.a = cover;
    o.h = h > 0 ? h : 0;
    rust(o, u, v, TILE / 1000, smoothstep(0.7, 0.85, fbm01(u, v, 3, 3, 4, 2001)) * 0.8, 2002);
    // The wire is round: its sides face away and catch less light.
    o.ao *= h > 0 ? 0.6 + 0.4 * (Math.min(h, RADIUS) / RADIUS) : 1;
  },
};
