import { clamp, fbm, fbm01, mix, random, scratches, smoothstep, value, wrapDelta } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { Scatter } from "../scatter";
import { cover, DIRT } from "./common";

/**
 * Emulsion over plaster, a storey to the repeat (v 0 is the floor): roller stipple and lap marks,
 * a gently wavy finish, patched repairs a shade off, black scuffs at trolley and chair height, chips
 * to white plaster, and brown water stains running down from the ceiling. The paint is the tint.
 */
const TILE = 3000; // mm
const PLASTER = hex(0xd8d2c4);
const STAIN = hex(0x7a6448);
const SCUFF = hex(0x2a2826);

const repairs = new Scatter(8);
const leaks = new Scatter(8);

export const paintedPlaster: Recipe = {
  cavity: { radius: 3, strength: 0.3 },
  setup() {
    const next = random(1500);
    for (let i = 0; i < 4; i++) {
      const w = (150 + next() * 500) / TILE;
      const h = (150 + next() * 400) / TILE;
      repairs.add({
        u: next(),
        v: 0.1 + next() * 0.6,
        reach: Math.hypot(w, h),
        a: w,
        b: h,
        c: next(),
        d: 0,
      });
    }
    for (let i = 0; i < 3; i++) {
      const w = (60 + next() * 250) / TILE;
      leaks.add({ u: next(), v: 0, reach: 0.5, a: w, b: 0.3 + next() * 0.5, c: next(), d: 0 });
    }
  },
  sample(u, v, o) {
    // Paint: roller stipple, and lap marks a roller's width apart, slightly different sheen.
    const stipple = value(u, v, 1400, 1400, 1501) * 0.6 + value(u, v, 600, 600, 1502) * 0.4;
    const lap = fbm01(u, v, 13, 2, 3, 1503);
    o.a = 0.96 + stipple * 0.04 - (lap - 0.5) * 0.03;
    o.r = o.g = o.b = 0;
    o.h = stipple * 0.06 + fbm(u, v, 4, 4, 4, 1504) * 0.6;
    o.rough = 0.82 + (lap - 0.5) * 0.08 + stipple * 0.04;
    o.metal = 0;
    const height = v * TILE;

    // Patched repairs: filled, sanded smooth, painted again a shade off.
    for (const s of repairs.near(u, v)) {
      const du = Math.abs(wrapDelta(u, s.u)) / s.a;
      const dv = Math.abs(wrapDelta(v, s.v)) / s.b;
      const r = Math.max(du, dv) + fbm(u, v, 30, 30, 3, 1505) * 0.15;
      const inside = 1 - smoothstep(0.9, 1.05, r);
      if (inside <= 0) continue;
      o.h = mix(o.h, 0.15 + stipple * 0.02, inside);
      o.a = mix(o.a, 0.9 + 0.08 * s.c, inside);
      o.rough = mix(o.rough, 0.7, inside);
    }

    // Scuffs: a black band at trolley height, another at chair-back height, and the odd one.
    const band = (centre: number, spread: number) =>
      1 - smoothstep(0, spread, Math.abs(height - centre - fbm(u, v, 3, 1, 3, 1506) * 60));
    const scuffZone = Math.max(band(250, 120), band(850, 90) * 0.6);
    const marks = scratches(u, v, 18, 3, 1507, 0.035, 0.0015, 0, 0.35) * scuffZone;
    cover(o, SCUFF, marks * 0.6);
    const rub = scuffZone * smoothstep(0.55, 0.85, fbm01(u, v, 20, 8, 4, 1508));
    cover(o, DIRT, rub * 0.25);

    // Chips to plaster, mostly low, where things knocked into it.
    const low = 1 - smoothstep(200, 1300, height);
    const knock = fbm01(u, v, 60, 60, 4, 1509) + fbm(u, v, 250, 250, 2, 1510) * 0.1;
    const chip = smoothstep(0.78 - low * 0.08, 0.8 - low * 0.08, knock) * (0.15 + low);
    if (chip > 0) {
      cover(o, PLASTER, clamp(chip));
      o.h -= clamp(chip) * 0.4;
      o.rough = mix(o.rough, 0.95, clamp(chip));
    }

    // Water stains running down from the ceiling, with tide lines.
    for (const s of leaks.near(u, v)) {
      const du = wrapDelta(u, s.u);
      const fromTop = 1 - v;
      const width = s.a * (1 + fromTop * 1.5) * (0.7 + 0.6 * fbm01(u, v, 8, 4, 3, 1511));
      const across = Math.abs(du) / width;
      if (across > 1.2 || fromTop > s.b) continue;
      const fade = 1 - smoothstep(s.b * 0.5, s.b, fromTop);
      const stain = (1 - smoothstep(0.6, 1, across)) * fade;
      const tide = (1 - smoothstep(0, 0.12, Math.abs(across - 0.85))) * fade;
      cover(o, STAIN, stain * 0.25 + tide * 0.25);
    }
    // A little grime everywhere, and hand marks.
    cover(o, DIRT, smoothstep(0.55, 0.9, fbm01(u, v, 6, 6, 5, 1512)) * 0.12);
  },
};
