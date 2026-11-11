import { fbm, fbm01, mix, smoothstep, wrapDelta } from "../noise";
import type { Recipe } from "../recipe";
import { cover, DIRT, galvanised, RUST, rust } from "./common";

/**
 * Trapezoidal roof deck from below, 152.4 mm pitch (12 ribs to the repeat, ribs along v), 38 mm
 * deep: the narrow flange nearest is the rib's underside, the wide one beyond lies against the
 * roof. Galvanised, with a sheet lap every six ribs, condensation stains and rust weeping at laps.
 */
const TILE = 1828.8; // mm
const RIBS = 12;
const PITCH = TILE / RIBS;
const NEAR = 44; // near flange width, mm
const WEB = 11; // web run, mm
const DEPTH = 38;

/** Height towards the viewer, mm, across one pitch: x in mm from the middle of a near flange. */
function profile(x: number): number {
  const a = Math.abs(x);
  if (a < NEAR / 2) return DEPTH - stiffener(a);
  if (a < NEAR / 2 + WEB) return DEPTH * (1 - (a - NEAR / 2) / WEB);
  // The wide flange has a stiffening groove down its middle.
  const mid = PITCH / 2 - a;
  return Math.max(0, 1.5 - (mid * mid) / 40);
}

function stiffener(a: number): number {
  return Math.max(0, 1 - (a * a) / 30);
}

export const metalDeck: Recipe = {
  cavity: { radius: 8, strength: 0.25 },
  sample(u, v, o) {
    galvanised(o, u, v, TILE / 1000, 500, 0.2);
    const x = wrapDelta(u * RIBS, 0) * PITCH;
    const h = profile(x);
    o.h += h;
    // The webs face sideways, so they catch less light and more dirt.
    const web =
      smoothstep(NEAR / 2 - 1, NEAR / 2 + 1, Math.abs(x)) *
      (1 - smoothstep(NEAR / 2 + WEB - 1, NEAR / 2 + WEB + 1, Math.abs(x)));
    o.ao *= 1 - web * 0.15;
    // The far flange lies in shadow against the roof.
    o.ao *= 0.8 + 0.2 * (h / DEPTH);
    // Sheet lap every six ribs: the edge of the next sheet over a near flange, and rust weeping.
    const lapX = wrapDelta((u * RIBS) / 6, 0) * 6 * PITCH; // mm from the lap
    const lapEdge = 1 - smoothstep(0, 1.5, Math.abs(lapX - NEAR / 2 + 4));
    o.h += lapX > -NEAR / 2 && lapX < NEAR / 2 - 4 ? 1 : 0;
    cover(o, DIRT, lapEdge * 0.7);
    const weep =
      (1 - smoothstep(0, 60, Math.abs(lapX))) * smoothstep(0.55, 0.85, fbm01(u, v, 30, 4, 4, 501));
    rust(o, u, v, TILE / 1000, weep * 0.8, 502);
    // Condensation drip lines along the ribs' undersides, and tide marks where it pooled.
    const drip = smoothstep(0.6, 0.85, fbm01(u, v, RIBS * 8, 3, 3, 503)) * (h / DEPTH);
    cover(o, DIRT, drip * 0.3);
    const tide = smoothstep(0.7, 0.8, fbm01(u, v, 3, 3, 5, 504) + fbm(u, v, 40, 40, 2, 505) * 0.05);
    const tideLine = tide * (1 - smoothstep(0.8, 0.95, fbm01(u, v, 3, 3, 5, 504)));
    cover(o, RUST, tideLine * 0.25);
    o.rough = mix(o.rough, 0.7, drip);
  },
};
