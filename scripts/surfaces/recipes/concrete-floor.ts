import {
  cell,
  clamp,
  fbm,
  fbm01,
  mix,
  random,
  scratches,
  smoothstep,
  value,
  valueAt,
  voronoi,
  wrapDelta,
} from "../noise";
import { blend, hex, type Recipe, setColour } from "../recipe";
import { Scatter } from "../scatter";

/**
 * A power-trowelled slab, 4 m square, with half a saw cut along each side so that slabs side by
 * side meet at a cut. Years of a shop on it: trowel burnish, hairline cracks, black wheel marks,
 * damp patches and the odd spall down to the aggregate.
 */

const TILE = 4000; // mm
const CONCRETE = hex(0x8c8a85);
const WARM = hex(0x8f877c);
const COOL = hex(0x7f8285);
const RUBBER = hex(0x1c1b1a);
const OIL = hex(0x2a2621);
const STONES = [hex(0x9a958d), hex(0x6f6a64), hex(0xa89f92), hex(0x5c5955), hex(0x857a6e)];

const spalls = new Scatter(32);
const stains = new Scatter(16);
const arcs = new Scatter(16);

/** Distance from (u, v) to the nearest saw cut, in mm: the cuts lie on the tile's edges. */
function toCut(u: number, v: number): number {
  return Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)) * TILE;
}

export const concreteFloor: Recipe = {
  cavity: { radius: 6, strength: 0.6 },

  setup() {
    const next = random(11);
    for (let i = 0; i < 70; i++) {
      // Spalls cluster along the cuts, where forklift wheels knock the edges.
      const alongCut = next() < 0.55;
      let u = next();
      let v = next();
      if (alongCut) {
        if (next() < 0.5) u = (next() - 0.5) * 0.006;
        else v = (next() - 0.5) * 0.006;
      }
      const r = (alongCut ? 6 + next() * 22 : 4 + next() * 14) / TILE;
      spalls.add({ u: (u + 1) % 1, v: (v + 1) % 1, reach: r * 1.6, a: r, b: next() * 1000, c: 0, d: 0 });
    }
    for (let i = 0; i < 9; i++) {
      const r = (40 + next() * 260) / TILE;
      stains.add({ u: next(), v: next(), reach: r * 1.5, a: r, b: next() * 1000, c: next(), d: 0 });
    }
    // Curved wheel marks: where a pallet truck or forklift turned.
    for (let i = 0; i < 26; i++) {
      const radius = (600 + next() * 2600) / TILE;
      const width = (6 + next() * 30) / TILE;
      arcs.add({
        u: next(),
        v: next(),
        reach: radius + width,
        a: radius,
        b: width,
        c: next() * Math.PI * 2,
        d: 0.4 + next() * 1.2,
      });
    }
  },

  sample(u, v, o) {
    // Broad mottling: a pour is never one colour.
    const broad = fbm(u, v, 3, 3, 4, 1);
    const tone = fbm(u, v, 7, 7, 3, 2);
    let col = blend(CONCRETE, broad > 0 ? WARM : COOL, Math.min(1, Math.abs(broad)) * 0.7);
    const speckle = fbm(u, v, 48, 48, 3, 27);
    let k = 1 + broad * 0.07 + tone * 0.05 + speckle * 0.035;

    // Trowel swirls: arcs round many centres, showing in patches as burnish.
    const sw = voronoi(u, v, 9, 9, 3, 1);
    // Only part of each circle shows, as the blades sweep past: arcs, not targets.
    const ax = (sw.u - u) * 9;
    const ay = (sw.v - v) * 9;
    const facing = Math.cos(Math.atan2(ay, ax) - sw.id * 6.283);
    const rings = Math.sin(sw.f1 * 30 + sw.id * 40 + fbm(u, v, 20, 20, 2, 28) * 4) * 0.5 + 0.5;
    const swirlMask = smoothstep(0.3, 0.7, fbm01(u, v, 5, 5, 3, 4)) * smoothstep(0.1, 0.7, facing);
    const burnish = swirlMask * smoothstep(0.5, 1, rings) * 0.5;
    k *= 1 - burnish * 0.03;

    // Fine grain: sand and cement, with pin pores.
    const grain = value(u, v, 1400, 1400, 5) - 0.5;
    const fine = value(u, v, 520, 520, 6) - 0.5;
    k *= 1 + grain * 0.07 + fine * 0.05;
    let h = fbm(u, v, 6, 6, 4, 7) * 0.4 + grain * 0.03 + fine * 0.05;
    const pores = voronoi(u, v, 700, 700, 8, 1);
    const pore = (1 - smoothstep(0.08, 0.2, pores.f1)) * smoothstep(0.6, 0.9, pores.id);
    h -= pore * 0.35;
    k *= 1 - pore * 0.25;

    let rough = 0.62 - burnish * 0.08 + grain * 0.05 + tone * 0.04;
    let ao = 1;

    // Damp patches, darker and duller-sheened, round leaks and mopped spills.
    const dampN = fbm01(u, v, 4, 4, 5, 9) + 0.15 * fbm(u, v, 24, 24, 2, 10);
    const damp = smoothstep(0.66, 0.9, dampN);
    k *= 1 - damp * 0.16;
    rough = mix(rough, 0.42, damp * 0.8);

    // Ground-in grime in low spots, and dust in the pores.
    const grime = smoothstep(0.45, 0.75, fbm01(u, v, 12, 12, 4, 12)) * 0.08;
    k *= 1 - grime;

    // Hairline shrinkage cracks: borders of warped cells, kept only in stretches.
    const wu = u + fbm(u, v, 6, 6, 3, 13) * 0.025;
    const wv = v + fbm(u, v, 6, 6, 3, 14) * 0.025;
    voronoi(wu, wv, 3, 3, 15, 1, true);
    const crackKeep = smoothstep(0.55, 0.7, fbm01(u, v, 4, 4, 3, 16));
    const crackW = (0.35 + 0.6 * fbm01(u, v, 40, 40, 2, 17)) / (TILE / 3); // in cells
    const crack = crackKeep * (1 - smoothstep(crackW * 0.4, crackW, cell.edge));
    // Finer branches off them.
    voronoi(wu * 1.0, wv, 11, 11, 18, 1, true);
    const branchKeep = smoothstep(0.62, 0.75, fbm01(u, v, 9, 9, 3, 19)) * crackKeep;
    const branch = branchKeep * (1 - smoothstep(0.0001, 0.0011, cell.edge / 11));
    const cracks = Math.max(crack, branch * 0.7);
    k *= 1 - cracks * 0.55;
    h -= cracks * 0.6;
    ao *= 1 - cracks * 0.4;

    // Wheel marks: straight scuffs, and arcs where something turned.
    const scuffs = scratches(u, v, 6, 3, 20, 0.22, 0.0035, 0, Math.PI) * 0.35;
    const scuffs2 = scratches(u, v, 14, 2, 21, 0.06, 0.0018, 0, Math.PI) * 0.3;
    let rubber = Math.max(scuffs, scuffs2);
    for (const s of arcs.near(u, v)) {
      const du = wrapDelta(u, s.u);
      const dv = wrapDelta(v, s.v);
      const r = Math.hypot(du, dv);
      const across = Math.abs(r - s.a);
      if (across > s.b) continue;
      let ang = Math.atan2(dv, du) - s.c;
      ang -= Math.round(ang / (Math.PI * 2)) * Math.PI * 2;
      if (Math.abs(ang) > s.d) continue;
      const ends = smoothstep(s.d, s.d * 0.4, Math.abs(ang));
      const streaky = 0.5 + 0.5 * valueAt(ang * 30, (across / s.b) * 2, 22);
      const mark = (1 - smoothstep(s.b * 0.3, s.b, across)) * ends * streaky * 0.35;
      rubber = Math.max(rubber, mark);
    }
    rubber *= 0.6 + 0.4 * fbm01(u, v, 30, 30, 2, 23);
    col = blend(col, RUBBER, rubber * 0.55);
    rough = mix(rough, 0.5, rubber * 0.5);

    // Oil and drink stains, dark and slightly glossy.
    for (const s of stains.near(u, v)) {
      const du = wrapDelta(u, s.u);
      const dv = wrapDelta(v, s.v);
      const wob = 1 + 0.35 * fbm(du / s.a / 4 + 0.5, dv / s.a / 4 + 0.5, 4, 4, 3, s.b | 0);
      const d = Math.hypot(du, dv) / (s.a * wob);
      const stain = 1 - smoothstep(0.6, 1, d);
      if (stain <= 0) continue;
      const ring = smoothstep(0.75, 0.95, d) * stain;
      const amount = (0.25 + 0.3 * s.c) * stain + ring * 0.15;
      col = blend(col, OIL, amount);
      rough = mix(rough, 0.35, stain * 0.6);
    }

    // Saw cuts, 4 mm wide, with ragged arrises where they've been knocked.
    const d = toCut(u, v);
    const ragged = fbm01(u * 1, v * 1, 160, 160, 3, 24);
    const cutW = 2 + ragged * 0.6;
    const arris = (1 - smoothstep(cutW, cutW + 1.5 + ragged * 3 * smoothstep(0.6, 0.9, ragged), d));
    let spall = 0;
    let spallDepth = 0;
    for (const s of spalls.near(u, v)) {
      const du = wrapDelta(u, s.u);
      const dv = wrapDelta(v, s.v);
      const n = fbm(du / s.a / 3 + 0.5, dv / s.a / 3 + 0.5, 5, 5, 3, s.b | 0);
      const r = Math.hypot(du, dv) / s.a + n * 0.6;
      const inside = 1 - smoothstep(0.85, 1, r);
      if (inside > spall) {
        spall = inside;
        spallDepth = (1 - r) * 3;
      }
    }
    const chipped = Math.max(spall, arris * 0.9);
    if (chipped > 0) {
      // Aggregate: stones in a darker matrix.
      const st = voronoi(u, v, 180, 180, 25, 0.9);
      const stoneSize = 0.35 + 0.15 * st.id2;
      const stone = 1 - smoothstep(stoneSize, stoneSize + 0.12, st.f1);
      const pick = STONES[Math.floor(st.id * STONES.length)];
      const matrix = hex(0x6c6862);
      const inner = blend(matrix, pick, stone);
      col = blend(col, inner, chipped);
      k = mix(k, 0.9 + 0.2 * value(u, v, 900, 900, 26), chipped);
      h = mix(h, -0.8 - Math.min(2.5, spallDepth) + stone * 0.5, chipped);
      rough = mix(rough, 0.88, chipped);
    }
    // The cut itself: an open dark groove with dust in it.
    const groove = 1 - smoothstep(cutW - 0.6, cutW + 0.4, d);
    if (groove > 0) {
      col = blend(col, hex(0x3a3835), groove);
      h = mix(h, -6, groove);
      ao *= 1 - groove * 0.7;
      rough = mix(rough, 0.95, groove);
    }

    setColour(o, col, clamp(k, 0, 1.4));
    o.h = h;
    o.ao = ao;
    o.rough = clamp(rough, 0.05, 1);
    o.metal = 0;
  },
};
