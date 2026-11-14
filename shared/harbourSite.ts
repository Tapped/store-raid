/**
 * Where the warehouse stands in the harbour: on the lot in its north-west corner, half a meter
 * below the quay. `x` and `z` are the south-west corner of its grid; its loading door is in the
 * middle of the south side. scripts/harbour.ts leaves the harbour's ground out under it. What
 * stands between it and the truck is the yard (shared/harbourYard.ts).
 */
export const HARBOUR_SITE = { x: -40, z: -4, width: 56, depth: 48 } as const;

/** How high the lot's paving lies. */
export const HARBOUR_LOT_Y = -0.05;
