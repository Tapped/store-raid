import { linear, mix } from "./noise";

/**
 * One texel of a surface, as a recipe writes it (after Saltline's `emit`): colour in linear 0 to
 * 1, `a` how much of the material's tint shows through (see `cover`), height in millimetres,
 * ambient occlusion, roughness and metalness.
 */
export interface Texel {
  r: number;
  g: number;
  b: number;
  a: number;
  h: number;
  ao: number;
  rough: number;
  metal: number;
}

export interface Recipe {
  /** Lays out whatever the recipe places ahead of sampling; runs once in each worker. */
  setup?(): void;
  /** Fills `o` for the point (u, v) on the texture: one repeat is 0 to 1, v up. */
  sample(u: number, v: number, o: Texel): void;
  /** Darkens hollows from the height: blur radius in mm, and how much. */
  cavity?: { radius: number; strength: number };
}

export type Colour = readonly [number, number, number];

/** A colour written as sRGB hex, as linear. */
export function hex(code: number): Colour {
  return [linear(((code >> 16) & 255) / 255), linear(((code >> 8) & 255) / 255), linear((code & 255) / 255)];
}

/** Sets the texel's own colour, leaving the tint amount. */
export function setColour(o: Texel, c: Colour, k = 1): void {
  o.r = c[0] * k;
  o.g = c[1] * k;
  o.b = c[2] * k;
}

/**
 * Covers the texel with colour `c` by `k`, which hides the tint by as much: dirt, rust or bare
 * substrate over paint. (Saltline's `OV`.)
 */
export function cover(o: Texel, c: Colour, k: number): void {
  if (k <= 0) return;
  if (k > 1) k = 1;
  o.r = mix(o.r, c[0], k);
  o.g = mix(o.g, c[1], k);
  o.b = mix(o.b, c[2], k);
  o.a = mix(o.a, 0, k);
}

/** Multiplies the colour and the tint amount alike: shade that darkens paint and substrate. */
export function shade(o: Texel, k: number): void {
  o.r *= k;
  o.g *= k;
  o.b *= k;
  o.a *= k;
}

/** Mixes two colours. */
export function blend(a: Colour, b: Colour, t: number): Colour {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}
