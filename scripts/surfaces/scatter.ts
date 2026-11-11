import { wrap, wrapDelta } from "./noise";

/** Something laid out on the texture: where it is, how far it reaches (in repeats), and its own values. */
export interface Spot {
  u: number;
  v: number;
  reach: number;
  /** Seeds and sizes, whatever the recipe wants. */
  a: number;
  b: number;
  c: number;
  d: number;
  e?: number;
}

/**
 * Things scattered over the texture, bucketed in a grid so a texel only looks at those near it.
 * Positions wrap, so a spot near one edge shows on the other side too.
 */
export class Scatter {
  private readonly buckets: Spot[][];

  constructor(private readonly grid = 32) {
    this.buckets = Array.from({ length: grid * grid }, () => []);
  }

  add(spot: Spot): void {
    const g = this.grid;
    const r = Math.ceil(spot.reach * g) + 1;
    const cx = Math.floor(spot.u * g);
    const cy = Math.floor(spot.v * g);
    const seen = new Set<number>();
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const k = wrap(cy + j, g) * g + wrap(cx + i, g);
        if (seen.has(k)) continue;
        seen.add(k);
        this.buckets[k].push(spot);
      }
    }
  }

  /** The spots that may reach (u, v). */
  near(u: number, v: number): Spot[] {
    const g = this.grid;
    return this.buckets[wrap(Math.floor(v * g), g) * g + wrap(Math.floor(u * g), g)];
  }
}

/** The offset from a spot to (u, v), the short way round the texture. */
export function offset(spot: Spot, u: number, v: number): [number, number] {
  return [wrapDelta(u, spot.u), wrapDelta(v, spot.v)];
}
