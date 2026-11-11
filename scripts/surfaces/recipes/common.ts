import { cell, clamp, fbm, fbm01, mix, smoothstep, value, voronoi } from "../noise";
import { blend, type Colour, cover, hex, setColour, type Texel } from "../recipe";

/**
 * Layers several surfaces share: painted metal with its damage, rust, concrete and galvanising.
 * Sizes are physical: `tile` is the surface's repeat in meters, and frequencies are rounded to
 * whole numbers per repeat so everything still tiles.
 */

/** Cells across one repeat for features `perMeter` to the meter. */
export const per = (tile: number, perMeter: number) => Math.max(1, Math.round(tile * perMeter));

export const RUST_DARK = hex(0x3a2216);
export const RUST = hex(0x6b3a1e);
export const RUST_BRIGHT = hex(0xa8592a);
export const STEEL = hex(0x9a9c9e);
export const PRIMER_RED = hex(0x7d3a2a);
export const PRIMER_GREY = hex(0x8a8a84);
export const DIRT = hex(0x4a4238);
export const SALT = hex(0xd2d0c8);

/**
 * Rust on a texel by `k`: flaky, terraced layers from dark to orange, pitted, a little raised.
 */
export function rust(o: Texel, u: number, v: number, tile: number, k: number, seed = 0): void {
  if (k <= 0) return;
  const f = per(tile, 6);
  const wu = u + (fbm(u, v, f, f, 3, seed + 1) * 0.3) / f;
  const wv = v + (fbm(u, v, f, f, 3, seed + 2) * 0.3) / f;
  const n = fbm01(wu, wv, f, f, 6, seed + 3, 0.55);
  // Flaking layers: the noise in four terraces.
  const terrace = Math.floor(n * 4) / 4;
  const edge = smoothstep(0.85, 1, (n * 4) % 1);
  let col = blend(RUST_DARK, RUST, smoothstep(0.2, 0.7, terrace));
  col = blend(
    col,
    RUST_BRIGHT,
    smoothstep(0.65, 0.9, fbm01(u, v, per(tile, 18), per(tile, 18), 3, seed + 4)) * 0.4,
  );
  const fine = value(u, v, per(tile, 900), per(tile, 900), seed + 5);
  const pit = voronoi(u, v, per(tile, 160), per(tile, 160), seed + 6, 1);
  const pitted = (1 - smoothstep(0.1, 0.3, pit.f1)) * smoothstep(0.55, 0.9, pit.id);
  const shadeK = (0.8 + 0.35 * fine) * (1 - edge * 0.35) * (1 - pitted * 0.4);
  cover(o, [col[0] * shadeK, col[1] * shadeK, col[2] * shadeK], k);
  o.h += k * (terrace * 0.25 + fine * 0.04 - pitted * 0.15);
  o.rough = mix(o.rough, 0.9 + fine * 0.08, k);
  o.metal = mix(o.metal, 0, k);
}

/** A chipped flake field, 0 to 1: how far into a chip the texel is (0 is sound paint). */
export function chips(
  u: number,
  v: number,
  fx: number,
  fy: number,
  seed: number,
  amount: number,
): number {
  if (amount <= 0) return 0;
  const wu = u + (fbm(u, v, fx * 2, fy * 2, 3, seed + 1) * 0.35) / fx;
  const wv = v + (fbm(u, v, fx * 2, fy * 2, 3, seed + 2) * 0.35) / fy;
  voronoi(wu, wv, fx, fy, seed, 1);
  if (cell.id > amount) return 0;
  const r = 0.2 + 0.35 * (1 - cell.id / amount);
  return smoothstep(r, r * 0.4, cell.f1);
}

export interface PaintOptions {
  tile: number;
  seed: number;
  /** How much of the surface is in damaged zones, 0 to 1. */
  damage: number;
  /** How old the damage is: 0 bright bare steel, 1 all rust. */
  age: number;
  /** Gloss paint roughness. */
  gloss?: number;
  primer?: Colour;
  /** Rust runs down from chips. */
  runs?: number;
  /** Vertical dirt streaks washed down. */
  wash?: number;
  /** Extra damage everywhere, 0 to 1, e.g. near a lap or screw. */
  extra?: (u: number, v: number) => number;
}

/** The chip value at a point, for painted metal; shared with the run test above it. */
function paintChip(u: number, v: number, p: PaintOptions, zone: number): number {
  const a = chips(u, v, per(p.tile, 20), per(p.tile, 11), p.seed + 10, zone * 0.55);
  const b = chips(u, v, per(p.tile, 64), per(p.tile, 40), p.seed + 20, zone * 0.45);
  return Math.max(a, b * 0.85);
}

/**
 * Painted steel after Saltline: chalking, washed-down dirt, rust runs, then chips through to
 * primer, rust and bright steel, in clusters so most of it stays sound. Paint is the tint.
 */
export function paintedMetal(o: Texel, u: number, v: number, p: PaintOptions): void {
  const { tile, seed } = p;
  // Sound paint: tint shows, orange peel in the height.
  o.a = 1;
  setColour(o, [0, 0, 0]);
  const peel = fbm(u, v, per(tile, 300), per(tile, 300), 2, seed + 1);
  o.h = peel * 0.008;
  o.rough = (p.gloss ?? 0.35) + peel * 0.03;
  o.metal = 0;

  // Where the damage is: low-frequency clusters.
  const extra = p.extra ? p.extra(u, v) : 0;
  const zoneN = fbm01(u, v, per(tile, 2), per(tile, 2), 4, seed + 2);
  const zone = clamp(smoothstep(0.58 - p.damage * 0.25, 0.82 - p.damage * 0.2, zoneN) + extra);

  // Chalking: old paint goes pale and dull in patches.
  const chalk = smoothstep(0.4, 0.8, fbm01(u, v, per(tile, 4), per(tile, 4), 4, seed + 3)) * 0.18;
  cover(o, [0.6, 0.6, 0.58], chalk * 0.25);
  o.rough = mix(o.rough, 0.75, chalk * 1.5);

  // Dirt washed down in vertical streaks.
  const wash = p.wash ?? 0.5;
  if (wash > 0) {
    const streak =
      fbm01(u, v, per(tile, 70), 1, 3, seed + 4) * 0.5 +
      fbm01(u, v, per(tile, 22), 1, 3, seed + 5) * 0.3 +
      fbm01(u, v, per(tile, 9), 2, 3, seed + 6) * 0.2;
    const dirt = smoothstep(0.45, 0.8, streak) * wash * 0.5;
    cover(o, DIRT, dirt * 0.6);
    o.rough = mix(o.rough, 0.8, dirt);
  }

  // Rust runs: chips a little above, gated by a vertical streak.
  const runs = p.runs ?? 0.6;
  if (runs > 0) {
    const streak = fbm01(u, v, per(tile, 120), 1, 3, seed + 30);
    if (streak > 0.5) {
      let rr = 0;
      for (let i = 1; i <= 4; i++) {
        const q = v + (i * 0.034) / tile;
        const src = paintChip(u, q, p, zone);
        rr = Math.max(rr, smoothstep(0.45, 0.7, src) * (1 - i / 5));
      }
      const run = rr * smoothstep(0.5, 0.78, streak) * runs * p.age;
      cover(o, blend(RUST, RUST_DARK, 0.4), run * 0.8);
      o.rough = mix(o.rough, 0.7, run);
    }
  }

  // Chips: primer at the edge, then rust or bare steel at the heart.
  const chip = clamp(paintChip(u, v, p, zone) + (extra > 0.5 ? (extra - 0.5) * 0.6 : 0));
  if (chip > 0.05) {
    const primer = smoothstep(0.05, 0.2, chip);
    cover(o, p.primer ?? PRIMER_RED, primer);
    o.rough = mix(o.rough, 0.72, primer);
    o.h -= primer * 0.18;
    const core = smoothstep(0.35, 0.6, chip);
    if (core > 0) {
      const fresh = 1 - p.age;
      cover(o, STEEL, core * fresh);
      o.metal = mix(o.metal, 1, core * fresh);
      o.rough = mix(o.rough, 0.38, core * fresh);
      o.h -= core * 0.12;
      rust(o, u, v, tile, core * p.age, seed + 40);
    }
  }
  // Oxide halo round chips, rust creeping under the paint edge.
  const halo = smoothstep(0.0, 0.05, chip) * (1 - smoothstep(0.05, 0.15, chip)) * p.age;
  cover(o, RUST, halo * 0.5);
}

/** Concrete: cement paste with sand and pores, a broad mottle, its own colour (no tint). */
export function concrete(
  o: Texel,
  u: number,
  v: number,
  tile: number,
  seed: number,
  colour: Colour = hex(0x8a8882),
): void {
  const broad = fbm(u, v, per(tile, 0.8), per(tile, 0.8), 4, seed + 1);
  const mottle = fbm(u, v, per(tile, 6), per(tile, 6), 4, seed + 2, 0.55);
  const grain = value(u, v, per(tile, 350), per(tile, 350), seed + 3) - 0.5;
  const pores = voronoi(u, v, per(tile, 150), per(tile, 150), seed + 4, 1);
  const pore = (1 - smoothstep(0.08, 0.22, pores.f1)) * smoothstep(0.55, 0.9, pores.id);
  const k = (1 + broad * 0.08 + mottle * 0.06 + grain * 0.08) * (1 - pore * 0.35);
  setColour(o, colour, k);
  o.h = broad * 0.5 + mottle * 0.15 + grain * 0.06 - pore * 0.5;
  o.rough = 0.85 + grain * 0.08;
  o.metal = 0;
}

/** Hot-dip galvanising: spangle crystals of slightly different sheen, dull patches, white rust. */
export function galvanised(
  o: Texel,
  u: number,
  v: number,
  tile: number,
  seed: number,
  wear = 0.5,
): void {
  const f = per(tile, 70);
  const wu = u + (fbm(u, v, f, f, 2, seed + 1) * 0.5) / f;
  const wv = v + (fbm(u, v, f, f, 2, seed + 2) * 0.5) / f;
  const big = voronoi(wu, wv, f, f, seed + 3, 1);
  const id = big.id;
  const fine = voronoi(u, v, f * 4, f * 4, seed + 4, 1).id;
  const dull = smoothstep(0.4, 0.75, fbm01(u, v, per(tile, 3), per(tile, 3), 4, seed + 5));
  const k = 0.92 + id * 0.12 + fine * 0.04 - dull * 0.12;
  setColour(o, STEEL, k);
  o.metal = 1 - dull * 0.15;
  o.rough = clamp(0.3 + id * 0.25 + fine * 0.05 + dull * 0.25);
  o.h = (id - 0.5) * 0.004 + fine * 0.002;
  // White rust: zinc oxide blooming pale and chalky, worst in damp spots.
  const white = smoothstep(0.62, 0.85, fbm01(u, v, per(tile, 8), per(tile, 8), 5, seed + 6)) * wear;
  cover(o, SALT, white * 0.7);
  o.metal = mix(o.metal, 0, white * 0.8);
  o.rough = mix(o.rough, 0.85, white);
}

export { blend, cover, setColour };
