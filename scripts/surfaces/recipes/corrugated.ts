import { clamp, fbm, fbm01, mix, smoothstep, wrapDelta } from "../noise";
import type { Recipe } from "../recipe";
import { blend } from "../recipe";
import { cover, DIRT, paintedMetal, RUST, RUST_DARK, SALT } from "./common";

/**
 * Corrugated steel cladding seen from inside: 76.2 mm pitch up v (40 to the repeat), 18 mm deep,
 * four sheets across with a side lap every ten corrugations and an end lap at the floor of every
 * storey. Painted (the tint); rust where water sits, at the laps and round the screws, running down.
 */
const TILE = 3.048;
const PITCH = 40; // corrugations per repeat
const DEPTH = 18; // mm
const SHEET = 10; // corrugations per sheet
const LAP = 0.15 / TILE; // end lap height
const RAILS = [LAP * 0.5, 0.5]; // screw lines, at the girts

/** How near to a lap or screw: 0 far, 1 on it. */
function wet(u: number, v: number): number {
  const across = u * PITCH;
  const toSide = Math.abs(wrapDelta(across / SHEET, 0)) * SHEET; // corrugations from the side lap
  const side = 1 - smoothstep(0, 0.8, toSide);
  const end = 1 - smoothstep(0, 0.03, Math.abs(v - LAP) * 1);
  let screw = 0;
  for (const r of RAILS) {
    const dv = Math.abs(wrapDelta(v, r)) * TILE * 1000;
    // Every second valley.
    const du = (Math.abs(wrapDelta(across / 2 - 0.25, 0)) * 2 * (TILE * 1000)) / PITCH;
    screw = Math.max(screw, 1 - smoothstep(10, 45, Math.hypot(du, dv)));
  }
  const noise = fbm01(u, v, 120, 40, 3, 401);
  return clamp(Math.max(side * 0.8, end, screw) * (0.5 + noise));
}

export const corrugated: Recipe = {
  cavity: { radius: 3, strength: 0.4 },
  sample(u, v, o) {
    paintedMetal(o, u, v, {
      tile: TILE,
      seed: 400,
      damage: 0.3,
      age: 0.95,
      runs: 1,
      wash: 0.7,
      gloss: 0.45,
      extra: (uu, vv) => wet(uu, vv) * 0.9,
    });
    const phase = u * PITCH * Math.PI * 2;
    let h = Math.cos(phase) * DEPTH * 0.5;
    // Side lap: the next sheet's edge sits on top, a step and a dark line.
    const across = (u * PITCH) / SHEET;
    const lapD = wrapDelta(across, 0) * SHEET; // corrugations
    if (lapD > -0.55 && lapD < 0) h += 1.2;
    const lapEdge = 1 - smoothstep(0, 0.012, Math.abs(lapD + 0.55));
    // End lap: the sheet below overlaps behind, a step at its edge.
    if (v < LAP) h += 1.2;
    const endEdge = 1 - smoothstep(0, 0.002, Math.abs(v - LAP));
    const edge = Math.max(lapEdge, endEdge);
    cover(o, blend(RUST_DARK, RUST, 0.5), edge * 0.8);
    o.h += h;
    // Screws: washer and tip, rusty.
    for (const r of RAILS) {
      const dv = wrapDelta(v, r) * TILE * 1000;
      const du = (wrapDelta((u * PITCH) / 2 - 0.25, 0) * 2 * (TILE * 1000)) / PITCH;
      const d = Math.hypot(du, dv);
      if (d < 9) {
        const washer = 1 - smoothstep(7, 9, d);
        cover(o, blend(RUST, RUST_DARK, 0.3 + 0.4 * fbm01(u, v, 300, 300, 2, 402)), washer);
        o.h += washer * (2 + Math.sqrt(Math.max(0, 1 - (d / 9) ** 2)) * 2);
        o.rough = mix(o.rough, 0.8, washer);
        o.metal = mix(o.metal, 0, washer);
      }
    }
    // Condensation runs down the valleys, dirt in the troughs.
    const valley = smoothstep(0.3, 1, -Math.cos(phase));
    const cond = smoothstep(0.55, 0.85, fbm01(u, v, PITCH * 2, 3, 3, 403)) * valley;
    cover(o, DIRT, cond * 0.25);
    o.rough = mix(o.rough, 0.6, cond * 0.5);
    // Salt and grime rising from the floor.
    const foot = 1 - smoothstep(0, 0.12, v + fbm(u, v, 20, 4, 3, 404) * 0.03);
    cover(o, blend(DIRT, SALT, 0.3), foot * 0.5);
  },
};
