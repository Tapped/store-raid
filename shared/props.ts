/**
 * Every model a level can stand somewhere as scenery (`PropSpawn` in shared/level.ts), and how big
 * each is, so the generator can place them, and block what they block, without loading a model.
 * The models are built by scripts/models/<name>.py into assets/models/props/<name>.glb at these
 * sizes.
 *
 * `size` is width, height and depth in meters, as seen from the front: width across, depth front
 * to back. Where a model's origin is depends on its mount:
 *
 * - `floor`: on the floor, in the middle of its footprint.
 * - `wall`: on the wall's face, at the bottom of the model, in the middle of its width. Its back is
 *   flat against the wall and its front faces into the room.
 * - `ceiling`: on the ceiling, at the top of the model, in the middle of it.
 *
 * `solid` props stop players, as a box of their footprint and height. Parts of a model that glow
 * have a material whose name starts with `glow`, which the client dims and flickers.
 */
export interface PropKind {
  size: [number, number, number];
  mount: "floor" | "wall" | "ceiling";
  solid: boolean;
}

const floor = (w: number, h: number, d: number, solid = true): PropKind => ({
  size: [w, h, d],
  mount: "floor",
  solid,
});
const wall = (w: number, h: number, d: number): PropKind => ({
  size: [w, h, d],
  mount: "wall",
  solid: false,
});
const ceiling = (w: number, h: number, d: number): PropKind => ({
  size: [w, h, d],
  mount: "ceiling",
  solid: false,
});

export const PROPS = {
  // Fittings: what a building has before anyone moves in.
  /** A fluorescent batten with one tube. Its tube glows. */
  "ceiling-tube": ceiling(1.25, 0.09, 0.14),
  /** A bulkhead light in a cage. Its lens glows. */
  "emergency-light": wall(0.35, 0.14, 0.1),
  /** A green running-man sign, lit from inside. Its face glows. */
  "exit-sign": wall(0.4, 0.2, 0.06),
  /** A steel frame for a doorway 1.4 m wide and 2.2 m high in a wall 0.2 m thick, which it wraps. Origin on the floor in the middle of the opening. */
  "door-frame": floor(1.6, 2.3, 0.26, false),
  /** A length of rectangular ventilation duct on hangers, one cell long, with flanged joints. */
  duct: ceiling(4, 0.5, 0.6),
  /** A square air diffuser. */
  "duct-vent": ceiling(0.6, 0.1, 0.6),
  /** Three pipes of different sizes on brackets, one cell long: one lagged, one painted red. */
  "pipe-run": ceiling(4, 0.25, 0.35),
  /** A wire cable tray with bundled cables, one cell long. */
  "cable-tray": ceiling(4, 0.1, 0.3),
  /** A grey steel electrical cabinet with warning labels. */
  "electrical-cabinet": floor(0.8, 1.9, 0.4),
  /** A red extinguisher on its bracket, with a sign above. */
  "fire-extinguisher": wall(0.3, 0.75, 0.22),
  /** A dome or bullet security camera. */
  "cctv-camera": ceiling(0.15, 0.2, 0.3),
  /** A louvred grille. */
  "wall-vent": wall(0.6, 0.4, 0.05),
  /** A high-bay lamp for halls: a metal dome on a short chain. Its lens glows. */
  "high-bay": ceiling(0.45, 0.4, 0.45),

  // Cargo: what a harbour warehouse stores.
  /** A 20 ft shipping container, doors shut: three paint colours and states of wear. They stand in rows and against walls. */
  "container-a": floor(2.44, 2.59, 6.06),
  "container-b": floor(2.44, 2.59, 6.06),
  "container-c": floor(2.44, 2.59, 6.06),
  /** A wooden shipping crate with stencilled marks and steel corner straps. */
  "crate-large": floor(1.2, 1.2, 1.2),
  /** A long crate, for pipes or machine parts. */
  "crate-long": floor(2.4, 0.8, 0.8),
  /** Crates of several sizes stacked, one askew. */
  "crate-stack": floor(1.6, 2, 1.2),
  /** Four steel drums on a pallet, strapped, with hazard labels. */
  "drum-group": floor(1.2, 1.05, 1.2),
  /** A wooden cable reel standing on its rim, half wound with black cable. */
  "cable-reel": floor(0.8, 1.4, 1.4),
  /** A white woven bulk bag, full, on a pallet. */
  "big-bag": floor(0.95, 1.2, 0.95),
  /** A panel of chain-link partition between two posts: bonded stores are caged in with these, end to end. */
  "cage-panel": floor(2, 2.4, 0.06),
  /** A forklift, parked, forks down. The front is the forks. */
  forklift: floor(1.2, 2.15, 3.2),
  /** Machinery on a skid under a tied-down tarpaulin. */
  "wrapped-machine": floor(1.8, 1.5, 1.2),
  /** Truck tyres in a stack. */
  "tyre-stack": floor(0.9, 1.2, 0.9),
  /** A coil of thick mooring rope with a fender buoy on it. */
  "rope-coil": floor(1, 0.5, 1),
  /** Gas cylinders chained in a steel cage. */
  "gas-cage": floor(1.2, 1.9, 0.8),
  /** A platform scale with its read-out on a column. */
  "weigh-scale": floor(1.2, 1.2, 1.5),
  /** A sign hanging on two wires, with a bay number on it. */
  "bay-sign": ceiling(1.2, 0.5, 0.05),
  /** Clear PVC strips hanging in a doorway 1.4 m wide and 2.2 m high. Origin on the floor in the middle of the opening. */
  "strip-curtain": floor(1.4, 2.2, 0.05, false),

  // Back of house.
  /** Heavy pallet racking, one bay, loaded with boxes and wrapped pallets: two loads. */
  "pallet-rack-a": floor(2.7, 2.6, 1.1),
  "pallet-rack-b": floor(2.7, 2.6, 1.1),
  /** A pallet of boxes in stretch wrap: two stacks. */
  "pallet-stack-a": floor(1.2, 1.4, 1),
  "pallet-stack-b": floor(1.2, 1.0, 1),
  /** An office desk with a monitor, keyboard and clutter. The height is the desk's with the monitor on it. */
  desk: floor(1.6, 1.2, 0.8),
  "office-chair": floor(0.6, 1, 0.6, false),
  "filing-cabinet": floor(0.47, 1.32, 0.62),
  /** Three steel lockers in a row, one door ajar. */
  "locker-row": floor(1.2, 1.9, 0.5),
  /** A snack machine. Its window and panel glow. */
  "vending-machine": floor(0.95, 1.85, 0.85),
  "water-cooler": floor(0.35, 1.1, 0.35),
  /** A canteen table with two cups on it. */
  "staff-table": floor(1.4, 0.75, 0.8),
  /** A boiler with pipes, a gauge and a small pilot window that glows. */
  boiler: floor(1.2, 2, 1.2),
  /** A row of switchgear cabinets with breakers and indicator lamps that glow. */
  switchgear: floor(1.6, 2, 0.5),
  "hand-truck": floor(0.5, 1.2, 0.5, false),
  "trash-bin": floor(0.45, 0.7, 0.45),
  /** Tall steel shelving for along a wall, with parts bins, boxes and tins: two ways of stocking it. */
  "wall-shelf-a": floor(1.33, 2.2, 0.5),
  "wall-shelf-b": floor(1.33, 2.2, 0.5),
  /** A workbench with a vice, tools on a back board and clutter. */
  workbench: floor(1.8, 1.5, 0.75),
  /** A red tool cabinet on castors, a drawer open. */
  "tool-cabinet": floor(0.7, 1, 0.46),
} as const satisfies Record<string, PropKind>;

export type PropName = keyof typeof PROPS;
