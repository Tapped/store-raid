import type { SurfaceVariation } from "./variation";

/**
 * The surface library's table: every surface's real size and how it's drawn. Both the client
 * (surfaces.ts) and the baker (scripts/surfaces/) read it, so it imports nothing at run time.
 *
 * A mesh drawn with a surface has texture coordinates in world meters divided by its `tile`, as
 * `worldBox(name, min, max, scene, SURFACES[name].tile)` makes. Surfaces marked `upright` keep
 * height-bound wear (dirt along the foot, scuffs at trolley height) at a height above the floor:
 * their `tile` is a storey, so v = y / tile puts the bottom of the texture on every storey's floor.
 */
export interface SurfaceSpec {
  /** Meters one repeat of the texture covers, across and up. */
  tile: number;
  /** Pixels across the baked textures. */
  size: 1024 | 2048;
  /** The paint colour shown where the bake lets it, in sRGB; only tintable surfaces have one. */
  tint?: readonly [number, number, number];
  /** Roughly the surface's colour from afar, in sRGB, drawn while its textures are missing. */
  color: readonly [number, number, number];
  /**
   * Wire mesh and the like: the colour texture's alpha is coverage, and the material cuts holes
   * where there's none (see SurfaceCutout in surfaces.ts). Draw it on both faces of a thin plane.
   */
  cutout?: boolean;
  /** v runs up a wall from the floor: texture v 0 is a storey's floor. */
  upright?: boolean;
  /** How the client breaks up the repeats; see SurfaceVariation. */
  variation: SurfaceVariation;
  /** One line on what it is and where it goes. */
  about: string;
}

const TABLE = {
  "concrete-floor": {
    tile: 4,
    size: 2048,
    color: [0.47, 0.46, 0.44],
    // One slab per repeat, with half a saw cut along each side: every slab shows the bake turned
    // its own way, and the cuts still meet.
    variation: {
      sampling: { kind: "cells", cells: [1, 1], turn: "any" },
      patch: 11,
      brightness: 0.12,
      roughness: 0.18,
    },
    about: "Industrial slab, saw cuts every 4 m: forklift tyre marks, oil, cracks, patches, damp",
  },
  "floor-paint": {
    tile: 2,
    size: 2048,
    tint: [0.85, 0.66, 0.08],
    color: [0.62, 0.52, 0.2],
    variation: {
      sampling: { kind: "hex", cells: 2, rotate: 0, contrast: 0.3 },
      patch: 6,
      brightness: 0.08,
      roughness: 0.15,
    },
    about: "Worn line paint over concrete, for lane lines and bays: cut it to strips",
  },
  "vinyl-tile": {
    tile: 2.4,
    size: 2048,
    tint: [0.78, 0.76, 0.71],
    color: [0.68, 0.66, 0.62],
    variation: {
      sampling: { kind: "cells", cells: [8, 8], turn: "any" },
      patch: 7,
      brightness: 0.08,
      roughness: 0.25,
    },
    about: "30 cm shop-floor tiles: dirty joints, scuffs, the odd cracked or replaced tile",
  },
  "carpet-tile": {
    tile: 2,
    size: 2048,
    tint: [0.26, 0.29, 0.33],
    color: [0.24, 0.26, 0.29],
    // Carpet tiles are laid quarter-turned anyway.
    variation: {
      sampling: { kind: "cells", cells: [4, 4], turn: "any" },
      patch: 6,
      brightness: 0.1,
      roughness: 0.05,
    },
    about: "50 cm office carpet tiles: loop pile, worn lanes, stains",
  },
  "painted-plaster": {
    tile: 3,
    size: 2048,
    tint: [0.8, 0.79, 0.74],
    color: [0.72, 0.71, 0.66],
    upright: true,
    variation: {
      sampling: { kind: "hex", cells: 2.2, rotate: 0, keepHeight: true, contrast: 0.3 },
      patch: 8,
      brightness: 0.06,
      roughness: 0.12,
      grime: 0.25,
    },
    about:
      "Wall paint over plaster: roller stipple, scuffs at trolley height, chips, patches, runs",
  },
  "concrete-block": {
    tile: 3,
    size: 2048,
    tint: [0.78, 0.77, 0.73],
    color: [0.7, 0.69, 0.65],
    upright: true,
    variation: { patch: 7, brightness: 0.07, roughness: 0.1, grime: 0.3 },
    about: "Painted blockwork, 16 courses a storey: mortar joints, chipped paint, scuffs",
  },
  corrugated: {
    tile: 3.048,
    size: 2048,
    tint: [0.55, 0.6, 0.6],
    color: [0.48, 0.5, 0.49],
    upright: true,
    variation: { patch: 6, brightness: 0.08, roughness: 0.12, grime: 0.2 },
    about:
      "Corrugated steel cladding from inside, 76 mm pitch up v, painted: rust at laps and screws",
  },
  "concrete-wall": {
    tile: 3,
    size: 2048,
    color: [0.5, 0.49, 0.47],
    upright: true,
    variation: { patch: 7, brightness: 0.1, roughness: 0.1, grime: 0.35 },
    about: "Board-formed concrete, cast in place: board marks, tie holes, water stains, salt bloom",
  },
  "ceiling-tile": {
    tile: 2.4,
    size: 2048,
    color: [0.74, 0.73, 0.69],
    variation: {
      sampling: { kind: "cells", cells: [4, 4], turn: "any" },
      patch: 9,
      brightness: 0.06,
      roughness: 0.05,
    },
    about: "60 cm suspended-ceiling tiles in a white T-bar grid: fissures, water stains",
  },
  "metal-deck": {
    tile: 1.8288,
    size: 2048,
    color: [0.52, 0.53, 0.53],
    variation: { patch: 6, brightness: 0.1, roughness: 0.15 },
    about: "Galvanised roof deck from below: ribs 152 mm apart along v, a sheet lap every 6",
  },
  "painted-steel": {
    tile: 1,
    size: 1024,
    tint: [0.3, 0.36, 0.42],
    color: [0.3, 0.33, 0.36],
    variation: {
      sampling: { kind: "hex", cells: 2, rotate: 0, contrast: 0.4 },
      patch: 4,
      brightness: 0.08,
      roughness: 0.12,
    },
    about: "Tintable gloss paint on steel: clustered chips, primer, rust and rust runs",
  },
  galvanised: {
    tile: 1,
    size: 1024,
    color: [0.58, 0.59, 0.6],
    variation: { sampling: { kind: "hex", cells: 2, rotate: 1 }, patch: 3, brightness: 0.1 },
    about: "Hot-dip galvanised steel: spangle, white rust, dull patches",
  },
  rust: {
    tile: 1,
    size: 1024,
    color: [0.33, 0.19, 0.11],
    variation: { sampling: { kind: "hex", cells: 2, rotate: 1 }, patch: 3, brightness: 0.12 },
    about: "Heavily rusted steel: flaking layers, pits, mill scale",
  },
  "diamond-plate": {
    tile: 0.5,
    size: 1024,
    color: [0.55, 0.56, 0.57],
    variation: { patch: 3, brightness: 0.08, roughness: 0.2 },
    about: "Steel tread plate, worn bright on the lugs, dirt between",
  },
  "wood-plank": {
    tile: 1.2,
    size: 1024,
    color: [0.45, 0.33, 0.22],
    variation: {
      sampling: { kind: "courses", rows: 8, run: [0.5, 1.2], joint: 0.003 },
      patch: 4,
      brightness: 0.1,
    },
    about: "Rough-sawn softwood boards along u, 15 cm wide: pallets, stair treads",
  },
  cardboard: {
    tile: 1,
    size: 1024,
    color: [0.55, 0.42, 0.29],
    variation: {
      sampling: { kind: "hex", cells: 1.5, rotate: 0, contrast: 0.2 },
      patch: 2,
      brightness: 0.08,
    },
    about: "Brown corrugated board, flutes along v: scuffs, dents, water marks",
  },
  "wall-tile": {
    tile: 1.5,
    size: 2048,
    color: [0.8, 0.8, 0.77],
    variation: {
      sampling: { kind: "cells", cells: [10, 10], turn: "mirror" },
      patch: 5,
      brightness: 0.05,
      roughness: 0.15,
      grime: 0.3,
    },
    about: "15 cm white glazed ceramic tiles, grimy grout",
  },
  rubber: {
    tile: 1,
    size: 1024,
    color: [0.09, 0.09, 0.09],
    variation: { sampling: { kind: "hex", cells: 2, rotate: 1 }, patch: 3, brightness: 0.15 },
    about: "Black rubber: mats, wheel stops, stair nosings; dust in the grain, polished wear",
  },
  hazard: {
    tile: 1,
    size: 1024,
    tint: [0.86, 0.64, 0.05],
    color: [0.45, 0.36, 0.1],
    variation: { patch: 3, brightness: 0.1, roughness: 0.1 },
    about: "Worn diagonal hazard stripes, tint and black, 25 cm apart along u",
  },
  chainlink: {
    tile: 0.3,
    size: 1024,
    color: [0.5, 0.51, 0.52],
    cutout: true,
    variation: { patch: 3, brightness: 0.1 },
    about: "Galvanised chain-link fence, 50 mm mesh, cut out: draw on a two-sided plane",
  },
  tarpaulin: {
    tile: 1,
    size: 1024,
    tint: [0.16, 0.3, 0.5],
    color: [0.17, 0.27, 0.4],
    variation: {
      sampling: { kind: "hex", cells: 1.5, rotate: 0, contrast: 0.2 },
      patch: 3,
      brightness: 0.1,
    },
    about: "Woven PE tarpaulin, tintable: creases, grime, faded",
  },
} satisfies Record<string, SurfaceSpec>;

export type SurfaceName = keyof typeof TABLE;

export const SURFACES: Record<SurfaceName, SurfaceSpec> = TABLE;

export const SURFACE_NAMES = Object.keys(SURFACES) as SurfaceName[];
