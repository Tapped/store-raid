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
const patches = new Scatter(16);
const SALT = hex(0xc9c6bd);
const PATCH = hex(0x7a7975);

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
      spalls.add({
        u: (u + 1) % 1,
        v: (v + 1) % 1,
        reach: r * 1.6,
        a: r,
        b: next() * 1000,
        c: 0,
        d: 0,
      });
    }
    for (let i = 0; i < 26; i++) {
      // Mostly drips and small spills, a few big ones where a machine stood.
      const big = next() < 0.15;
      const r = (big ? 200 + next() * 250 : 15 + next() * 90) / TILE;
      stains.add({ u: next(), v: next(), reach: r * 1.5, a: r, b: next() * 1000, c: next(), d: 0 });
    }
    // Curved tyre marks where forklifts turned, in pairs a wheel track apart, and thin ones from
    // pallet trucks.
    for (let i = 0; i < 22; i++) {
      const forklift = next() < 0.6;
      const radius = (forklift ? 1500 + next() * 4000 : 600 + next() * 2000) / TILE;
      const width = (forklift ? 90 + next() * 90 : 8 + next() * 25) / TILE;
      const u = next();
      const v = next();
      const c = next() * Math.PI * 2;
      const d = 0.25 + next() * 0.8;
      const strength = forklift ? 0.4 + next() * 0.5 : 0.5 + next() * 0.5;
      for (const r of forklift ? [radius, radius + 950 / TILE] : [radius]) {
        arcs.add({ u, v, reach: r + width, a: r, b: width, c, d, e: strength });
      }
    }
    // Repairs: squares cut out and filled with a newer mix.
    for (let i = 0; i < 4; i++) {
      const w = (300 + next() * 900) / TILE;
      const h = (300 + next() * 900) / TILE;
      patches.add({
        u: next(),
        v: next(),
        reach: Math.hypot(w, h) / 2 + 0.002,
        a: w / 2,
        b: h / 2,
        c: next(),
        d: next() * 1000,
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
    let h = fbm(u, v, 6, 6, 4, 7) * 0.6 + grain * 0.08 + fine * 0.08;
    // Mid-scale mottling, the most of what makes it read as concrete from standing height.
    const mottle = fbm(u, v, 24, 24, 4, 32, 0.55);
    k *= 1 + mottle * 0.06;
    // Dark specks: grit trodden in.
    const grit = voronoi(u, v, 300, 300, 33, 1);
    k *= 1 - (1 - smoothstep(0.05, 0.14, grit.f1)) * smoothstep(0.75, 0.95, grit.id) * 0.4;
    const pores = voronoi(u, v, 700, 700, 8, 1);
    const pore = (1 - smoothstep(0.08, 0.2, pores.f1)) * smoothstep(0.6, 0.9, pores.id);
    h -= pore * 0.35;
    k *= 1 - pore * 0.25;

    let rough = 0.62 - burnish * 0.08 + grain * 0.05 + tone * 0.04;
    let ao = 1;

    // Damp patches, darker and duller-sheened, round leaks and mopped spills.
    const dampN = fbm01(u, v, 4, 4, 5, 9) + 0.15 * fbm(u, v, 24, 24, 2, 10);
    const damp = smoothstep(0.7, 0.92, dampN);
    k *= 1 - damp * 0.12;
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
    const scuffs = scratches(u, v, 6, 1, 20, 0.12, 0.003, 0, Math.PI) * 0.3;
    const scuffs2 = scratches(u, v, 14, 1, 21, 0.04, 0.0016, 0, Math.PI) * 0.25;
    let rubber = Math.max(scuffs, scuffs2);
    for (const s of arcs.near(u, v)) {
      const du = wrapDelta(u, s.u);
      const dv = wrapDelta(v, s.v);
      const r = Math.hypot(du, dv);
      const across = Math.abs(r - s.a);
      if (across > s.b) continue;
      let ang = Math.atan2(dv, du) - s.c;
      ang -= Math.round(ang / (Math.PI * 2)) * Math.PI * 2;
      const span = s.d;
      const strength = s.e ?? 1;
      if (Math.abs(ang) > span) continue;
      const ends = smoothstep(span, span * 0.3, Math.abs(ang));
      // Tread and skid: streaks along the mark, broken up across it.
      const along = ang * s.a * TILE;
      const streaky =
        0.35 +
        0.65 *
          valueAt(along / 400, (across / s.b) * 6, 22) *
          valueAt(along / 60, (across / s.b) * 3, 29);
      const mark = (1 - smoothstep(s.b * 0.4, s.b, across)) * ends * streaky * strength * 0.9;
      rubber = Math.max(rubber, mark);
    }
    rubber *= 0.6 + 0.4 * fbm01(u, v, 30, 30, 2, 23);
    col = blend(col, RUBBER, rubber * 0.6);
    rough = mix(rough, 0.5, rubber * 0.5);

    // Oil and drink stains, dark and slightly glossy.
    // Repairs, a shade off the slab and smoother, with a dark seam round them.
    for (const s of patches.near(u, v)) {
      const du = Math.abs(wrapDelta(u, s.u));
      const dv = Math.abs(wrapDelta(v, s.v));
      const out = Math.max(du - s.a, dv - s.b) * TILE; // mm outside the edge
      if (out > 3) continue;
      const inside = 1 - smoothstep(-1, 0, out);
      col = blend(col, PATCH, inside * (0.6 + 0.3 * s.c));
      const patchGrain = value(u, v, 800, 800, 34) - 0.5;
      k = mix(k, 1 + fbm(u, v, 30, 30, 3, s.d | 0) * 0.05 + patchGrain * 0.12, inside);
      rough = mix(rough, 0.55 + 0.2 * s.c, inside);
      h = mix(h, 0.3, inside);
      const seam = 1 - smoothstep(0.5, 2.5, Math.abs(out));
      k *= 1 - seam * 0.45;
      h -= seam * 1.2;
    }

    for (const s of stains.near(u, v)) {
      const du = wrapDelta(u, s.u);
      const dv = wrapDelta(v, s.v);
      const wob = 1 + 0.5 * fbm(du / s.a / 4 + 0.5, dv / s.a / 4 + 0.5, 4, 4, 5, s.b | 0, 0.6);
      const d = Math.hypot(du, dv) / (s.a * wob);
      const stain = 1 - smoothstep(0.75, 1, d);
      if (stain <= 0) continue;
      // Soaked in unevenly: a darker core, and a rim where it dried.
      const core = (1 - smoothstep(0.1, 0.7, d)) * (0.5 + 0.5 * fbm01(u, v, 200, 200, 3, 31));
      const ring = smoothstep(0.8, 0.97, d) * stain;
      const amount = (0.2 + 0.25 * s.c) * stain + core * 0.25 + ring * 0.12;
      col = blend(col, OIL, amount);
      rough = mix(rough, 0.35, stain * 0.6);
    }

    // Saw cuts, 4 mm wide, with ragged arrises where they've been knocked.
    const d = toCut(u, v);
    const ragged = fbm01(u * 1, v * 1, 160, 160, 3, 24);
    const cutW = 2 + ragged * 0.6;
    const arris = 1 - smoothstep(cutW, cutW + 1.5 + ragged * 3 * smoothstep(0.6, 0.9, ragged), d);
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
    // Salt bloom: harbour damp drawing salts out along cracks and cuts.
    const bloomNear = Math.max(cracks * 0.6, 1 - smoothstep(cutW, cutW + 30, d));
    const bloom = bloomNear * smoothstep(0.55, 0.8, fbm01(u, v, 40, 40, 4, 30)) * 0.5;
    col = blend(col, SALT, bloom * 0.5);
    rough = mix(rough, 0.9, bloom);

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
