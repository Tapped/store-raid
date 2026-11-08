import { OFFSET, SIDES, type Side, type TileGrid } from "../../shared/tiles";

/**
 * Every tile on show for the tile viewer (client/src/tileViewer.ts), each in a small grid of its own
 * with the neighbours it needs: stairs and ladders arrive on a floor above, a shaft is the air under a
 * pit, and walls and doorways come drawn. Each is a `TileGrid` like a level's, so it goes through
 * `composeTiles` and is built just as in a game.
 */
export interface Sample {
  name: string;
  /** Where it stands is the viewer's to decide: x and z are left at 0. */
  grid: TileGrid;
}

/** A grid three cells square from rows written south first, as the cells are numbered. */
const square = (cells: string[][]) => cells.map((row) => row.join("")).reverse();

/** Three by three, all floor but the middle. */
function around(middle: string): string[] {
  return square([
    ["F", "F", "F"],
    ["F", middle, "F"],
    ["F", "F", "F"],
  ]);
}

/** Stairs or a ladder in the middle, up to a floor on the storey above, surrounded by open air. */
function climb(char: string, up: Side): TileGrid {
  const upper = [
    [".", ".", "."],
    [".", ".", "."],
    [".", ".", "."],
  ];
  const [dx, dz] = OFFSET[up];
  upper[1 + dz][1 + dx] = "F";
  return { x: 0, z: 0, storeys: [around(char), square(upper)] };
}

const STAIRS: Record<Side, string> = { n: "^", e: ">", s: "v", w: "<" };

export const CATALOGUE: Sample[] = [
  { name: "floor", grid: { x: 0, z: 0, storeys: [around("F")] } },
  { name: "solid", grid: { x: 0, z: 0, storeys: [around("#")] } },
  { name: "tv against rock", grid: { x: 0, z: 0, storeys: [["###", "FTF", "FFF"]] } },
  { name: "tv in the open", grid: { x: 0, z: 0, storeys: [around("T")] } },
  { name: "pit", grid: { x: 0, z: 0, storeys: [around("P")] } },
  {
    name: "pit over a basement",
    grid: { x: 0, z: 0, basements: 1, storeys: [["###", "#.#", "###"], around("P")] },
  },
  { name: "bridge along z", grid: { x: 0, z: 0, storeys: [around("|")] } },
  { name: "bridge along x", grid: { x: 0, z: 0, storeys: [around("=")] } },
  { name: "a long bridge", grid: { x: 0, z: 0, storeys: [["F|F", "P|P", "F|F"]] } },
  ...SIDES.map((up) => ({ name: `stairs up ${up}`, grid: climb(STAIRS[up], up) })),
  ...SIDES.map((up) => ({ name: `ladder up ${up}`, grid: climb(up, up) })),
  {
    name: "open air, railings",
    grid: { x: 0, z: 0, storeys: [around("F"), around(".")] },
  },
  {
    name: "walls and a doorway",
    grid: {
      x: 0,
      z: 0,
      storeys: [["+-+-+-+", "|F F F|", "+-+d+-+", "|F F F|", "+-+-+-+"]],
    },
  },
  {
    name: "rooms upstairs",
    grid: {
      x: 0,
      z: 0,
      storeys: [
        around("F"),
        ["+-+-+-+", "|F F F|", "+-+d+-+", "|F F F|", "+ + + +", "|. F F|", "+-+-+-+"],
      ],
    },
  },
];
