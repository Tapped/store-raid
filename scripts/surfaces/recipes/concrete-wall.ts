import { clamp, fbm, fbm01, hash, mix, smoothstep, value, wrapDelta } from "../noise";
import type { Recipe } from "../recipe";
import { blend, hex } from "../recipe";
import { concrete, cover, DIRT, RUST, SALT } from "./common";

/**
 * Board-formed concrete cast in place, a storey to the repeat: 20 boards of 150 mm, each leaving
 * its grain and its own tone, with grout fins at the joints; form-tie holes on a 750 × 600 mm grid,
 * some patched; water stains and salt running down, and damp rising from the floor.
 */
const TILE = 3; // m
const BOARDS = 20;
const TIES_X = 4;
const TIES_Y = 5;
const PATCH = hex(0xa3a097);

export const concreteWall: Recipe = {
  cavity: { radius: 6, strength: 0.6 },
  sample(u, v, o) {
    concrete(o, u, v, TILE, 700, hex(0x85837d));
    const row = Math.floor(v * BOARDS);
    const inBoard = v * BOARDS - row;
    const rh = hash(row, 0, 701);
    // Each board left its own tone and grain: long streaks along it.
    const tone = 1 + (rh - 0.5) * 0.2;
    const grain =
      fbm(u + rh, v, 6, BOARDS * 12, 3, 702 + row) * 0.5 + fbm(u, v, 40, BOARDS * 30, 2, 703);
    const k = tone * (1 + grain * 0.09);
    o.r *= k;
    o.g *= k;
    o.b *= k;
    o.h += grain * 0.5 + (rh - 0.5) * 2.5;
    // Board joints: a thin fin of grout squeezed out.
    const jd = (Math.min(inBoard, 1 - inBoard) * (TILE * 1000)) / BOARDS; // mm to the joint
    const fin = 1 - smoothstep(0.5, 2.5, jd + fbm01(u, v, 60, 3, 2, 704) * 1.5);
    o.h += fin * 0.8;
    cover(o, PATCH, fin * 0.4);
    // Tie holes: cones 25 mm across, about half patched flush in paler mortar.
    const tu = wrapDelta(u * TIES_X, 0.5) / TIES_X;
    const tv = wrapDelta(v * TIES_Y, 0.5) / TIES_Y;
    const ti = Math.floor(u * TIES_X);
    const tj = Math.floor(v * TIES_Y);
    const td = Math.hypot(tu, tv) * TILE * 1000;
    const patched = hash(ti, tj, 705) < 0.45;
    if (td < 28) {
      if (patched) {
        const p = 1 - smoothstep(18, 24, td + fbm(u, v, 400, 400, 2, 706) * 3);
        cover(o, PATCH, p * 0.8);
        o.h += p * 0.3;
        o.rough = mix(o.rough, 0.92, p);
      } else {
        const hole = 1 - smoothstep(10, 13, td);
        o.h -= hole * Math.max(0, 12 - td) * 1.5;
        o.ao *= 1 - hole * 0.6;
        // A rusty tie end deep in it.
        cover(o, RUST, (1 - smoothstep(3, 5, td)) * 0.8);
      }
    }
    // Rust bleeding down from the open ties.
    if (!patched && tv < 0 && Math.abs(tu) * TILE * 1000 < 14) {
      const run =
        (1 - smoothstep(0, 0.12, -tv)) * smoothstep(0.4, 0.8, fbm01(u, v, 200, 6, 3, 707));
      cover(o, blend(RUST, DIRT, 0.4), run * 0.5);
    }
    // Water stains: dark streaks running down from above, with salt dried at their edges.
    const streak = fbm01(u, v, 30, 1, 4, 708) * 0.6 + fbm01(u, v, 8, 2, 3, 709) * 0.4;
    const wetRun = smoothstep(0.6, 0.8, streak) * (0.4 + 0.6 * v);
    cover(o, DIRT, wetRun * 0.4);
    o.rough = mix(o.rough, 0.75, wetRun * 0.5);
    const saltEdge = smoothstep(0.5, 0.55, streak) * (1 - smoothstep(0.55, 0.6, streak));
    cover(o, SALT, saltEdge * wetRun * 0.15);
    // Damp rising from the floor, with a tide line of salt.
    const top = 0.12 + fbm(u, v, 12, 2, 4, 710) * 0.05;
    const damp = 1 - smoothstep(top - 0.03, top, v);
    o.r *= 1 - damp * 0.25;
    o.g *= 1 - damp * 0.25;
    o.b *= 1 - damp * 0.22;
    o.rough = mix(o.rough, 0.6, damp);
    const tide =
      (1 - smoothstep(0, 0.012, Math.abs(v - top))) * (0.5 + 0.5 * value(u, v, 300, 300, 711));
    cover(o, SALT, clamp(tide) * 0.5);
  },
};
