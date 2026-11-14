import type { TruckPlace } from "./truck";

/**
 * Where the warehouse stands in the harbour: on the lot in its north-west corner, half a meter
 * below the quay. `x` and `z` are the south-west corner of its grid; its loading door is in the
 * middle of the south side. scripts/harbour.ts leaves the harbour's ground out under it.
 */
export const HARBOUR_SITE = { x: -40, z: -4, width: 56, depth: 48 } as const;

/** How high the lot's paving lies. */
export const HARBOUR_LOT_Y = -0.05;

/** The truck, backed up to the loading door with its ramp down: the cab faces south. */
export const HARBOUR_TRUCK: TruckPlace = { x: -10, y: HARBOUR_LOT_Y, z: -13.9, turns: 2 };
