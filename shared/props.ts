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

  // The shop floor.
  /** Low double-sided shop shelving, stocked on both sides: three ways of stocking the same frame. Three fill a cell end to end. */
  "gondola-a": floor(1.33, 1.6, 0.9),
  "gondola-b": floor(1.33, 1.6, 0.9),
  "gondola-c": floor(1.33, 1.6, 0.9),
  /** Tall single-sided shelving for along a wall, stocked: two ways. Origin on the floor, in the middle of its footprint. */
  "wall-shelf-a": floor(1.33, 2.2, 0.5),
  "wall-shelf-b": floor(1.33, 2.2, 0.5),
  /** A till: counter, belt, screen and card reader. */
  checkout: floor(2.2, 1.1, 0.9),
  "shopping-cart": floor(0.6, 1, 1),
  /** A table piled with goods on offer. */
  "display-table": floor(1.6, 0.9, 1),
  /** A rail of clothes on hangers. */
  "clothes-rack": floor(1.5, 1.6, 0.6),
  /** An upright cooler with glass doors, stocked with drinks. Its inside glows cold white. */
  "fridge-cabinet": floor(1.33, 2.1, 0.75),
  /** A chest freezer with sliding glass lids. */
  "freezer-chest": floor(1.8, 0.9, 0.9),
  /** A sign hanging over an aisle on two wires, with a number on it. */
  "aisle-sign": ceiling(1.2, 0.5, 0.05),
  mannequin: floor(0.5, 1.85, 0.35),
  /** A cardboard promotional stand with products. */
  "promo-stand": floor(0.6, 1.5, 0.4),

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
} as const satisfies Record<string, PropKind>;

export type PropName = keyof typeof PROPS;
