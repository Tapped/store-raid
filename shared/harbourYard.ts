import { random } from "./generate";
import HARBOUR_TERRAIN from "./harbour.json";
import { HARBOUR_LOT_Y } from "./harbourSite";
import type { Floor, LevelBox, PropSpawn } from "./level";
import { PROPS, type PropName } from "./props";
import type { TruckPlace } from "./truck";

/**
 * What stands between the truck and the warehouse in the harbour: the way in, made in code on the
 * harbour's baked ground, so it can change with the seed and be checked (scripts/harbourCheck.ts).
 *
 * The truck has backed into the alley south of the quay. From its ramp the crew comes out onto the
 * quay, a container yard: blocks of stacked containers across it, each with a gap at one end, so the
 * way through zigzags and the warehouse is out of sight until the last row. A ramp leads down from
 * the quay to the lot, half a meter lower, so loot can be carried back up without a jump; one
 * more row on the lot hides the loading door. About 75 m of walking each way.
 *
 * The blocks are fixed, so there's always a way through 2.5 m wide. The seed chooses each
 * container's paint, how high each stack is, and the clutter standing about.
 */
export interface Yard {
  truck: TruckPlace;
  /** Containers and clutter, drawn from the props' models. */
  props: PropSpawn[];
  /** What they block. */
  boxes: LevelBox[];
  /** Ramps laid on the harbour's ground, which the client draws as concrete wedges. */
  ramps: Floor[];
  /** Street lamps, as the harbour's own: where each stands. */
  lamps: { x: number; y: number; z: number }[];
  /** A spot over the yard for the lobby camera to circle. */
  overview: { x: number; y: number; z: number };
}

/** The truck in the alley, backed in: its cab faces south and its ramp comes down towards the quay. */
const TRUCK: TruckPlace = { x: 8.5, y: 0.5, z: -71, turns: 2 };

const CONTAINER = PROPS["container-a"].size;
const CONTAINERS: PropName[] = ["container-a", "container-b", "container-c"];

/** How high the harbour's ground is at a point: its highest floor there, or the lot's. */
function groundAt(x: number, z: number): number {
  let best: number | undefined;
  for (const [minX, minZ, maxX, maxZ, y] of HARBOUR_TERRAIN.floors) {
    if (x >= minX && x < maxX && z >= minZ && z < maxZ && (best === undefined || y > best))
      best = y;
  }
  return best ?? HARBOUR_LOT_Y;
}

/**
 * Blocks of containers: rows end to end, `deep` rows side by side (towards the north or east of
 * the first), from where the first row starts. The blocks across the quay alternate the end they
 * leave open.
 */
const BLOCKS: { x: number; z: number; along: "x" | "z"; count: number; deep?: number }[] = [
  // The quay, from the alley north: open at the east end, the west, the east.
  { x: -15.4, z: -54, along: "x", count: 2, deep: 2 },
  { x: -6.9, z: -44.5, along: "x", count: 2, deep: 2 },
  { x: -15.4, z: -34.5, along: "x", count: 2, deep: 2 },
  // Along the quay's east arm, a dead end to look into.
  { x: 12, z: -36.8, along: "x", count: 3 },
  { x: 24, z: -29, along: "x", count: 2 },
  { x: 38.5, z: -38, along: "z", count: 2, deep: 2 },
  // The lot below the quay to the west: stacks standing in lanes, a way round for those who
  // jump down.
  { x: -24, z: -58, along: "z", count: 3 },
  { x: -32, z: -52, along: "z", count: 3, deep: 2 },
  { x: -44, z: -58, along: "z", count: 4 },
  { x: -52, z: -40, along: "z", count: 2 },
  { x: -42, z: -30, along: "x", count: 2, deep: 2 },
  // The lot in front of the warehouse: across the way to the loading door, and round about.
  { x: -13.5, z: -13, along: "x", count: 2 },
  { x: -30, z: -19.5, along: "z", count: 2, deep: 2 },
  { x: -48, z: -16, along: "x", count: 2 },
  { x: 9, z: -17, along: "z", count: 2 },
  { x: 19, z: -12, along: "z", count: 1, deep: 2 },
];

/** Clutter: what could stand at each spot, of which the seed picks one, or nothing. */
const CLUTTER: { x: number; z: number; of: PropName[] }[] = [
  // Round the truck, against the alley's walls.
  { x: 4.3, z: -66, of: ["pallet-stack-a", "drum-group", "crate-stack"] },
  { x: 12.4, z: -69, of: ["pallet-stack-b", "barrel", "crate-large"] },
  { x: 12.3, z: -74.5, of: ["drum-group", "pallet-stack-a"] },
  { x: 4.4, z: -78, of: ["crate-stack", "ibc-tank"] },
  // On the quay, at the ends of the rows.
  { x: -1.6, z: -55.5, of: ["drum-group", "pallet-stack-a", "barrel"] },
  { x: -11, z: -46.5, of: ["crate-large", "pallet-stack-b", "ibc-tank"] },
  { x: 4.2, z: -47, of: ["barrel", "drum-group"] },
  { x: -2, z: -30.8, of: ["pallet-stack-a", "crate-stack"] },
  { x: -14.6, z: -38, of: ["ibc-tank", "crate-large"] },
  { x: 22, z: -28.5, of: ["pallet-stack-b", "drum-group", "crate-long"] },
  { x: 31, z: -33, of: ["crate-stack", "barrel"] },
  // On the lot.
  { x: 5.6, z: -22.5, of: ["barrel", "pallet-stack-b"] },
  { x: -16.5, z: -15.5, of: ["drum-group", "crate-large"] },
  { x: -4, z: -9, of: ["pallet-stack-a", "crate-long"] },
  { x: -22, z: -7, of: ["crate-stack", "ibc-tank", "pallet-stack-a"] },
  { x: 2, z: -6.5, of: ["drum-group", "barrel"] },
];

/** The yard for a seed. */
export function harbourYard(seed: number): Yard {
  const next = random(seed * 7919 + 13);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length) % list.length];
  const props: PropSpawn[] = [];
  const boxes: LevelBox[] = [];
  const [width, height, length] = CONTAINER;

  const rows = BLOCKS.flatMap((block) =>
    Array.from({ length: block.deep ?? 1 }, (_, k) => {
      const aside = k * (width + 0.2);
      return block.along === "x"
        ? { ...block, z: block.z + aside }
        : { ...block, x: block.x + aside };
    }),
  );
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      // A hand's width between them.
      const along = (i + 0.5) * (length + 0.12);
      const x = row.along === "x" ? row.x + along : row.x;
      const z = row.along === "z" ? row.z + along : row.z;
      const ground = groundAt(x, z);
      // Mostly two high, some three, a few left alone.
      const roll = next();
      const tiers = roll < 0.2 ? 1 : roll < 0.8 ? 2 : 3;
      for (let tier = 0; tier < tiers; tier++) {
        props.push({
          model: pick(CONTAINERS),
          x,
          y: ground + tier * height,
          z,
          // Its length is its depth: turned a quarter to lie along x.
          turn: (row.along === "x" ? Math.PI / 2 : 0) + (next() < 0.5 ? Math.PI : 0),
          room: -1,
        });
      }
      const [halfX, halfZ] = row.along === "x" ? [length / 2, width / 2] : [width / 2, length / 2];
      boxes.push({
        minX: x - halfX,
        maxX: x + halfX,
        minZ: z - halfZ,
        maxZ: z + halfZ,
        y: ground,
        height: tiers * height,
        kind: "scenery",
      });
    }
  }

  for (const spot of CLUTTER) {
    // One spot in four stays bare.
    const model = next() < 0.25 ? undefined : pick(spot.of);
    const quarter = Math.floor(next() * 4);
    if (!model) continue;
    const [w, h, d] = PROPS[model].size;
    const ground = groundAt(spot.x, spot.z);
    props.push({ model, x: spot.x, y: ground, z: spot.z, turn: (quarter * Math.PI) / 2, room: -1 });
    const [halfX, halfZ] = quarter % 2 === 0 ? [w / 2, d / 2] : [d / 2, w / 2];
    boxes.push({
      minX: spot.x - halfX,
      maxX: spot.x + halfX,
      minZ: spot.z - halfZ,
      maxZ: spot.z + halfZ,
      y: ground,
      height: h,
      kind: "scenery",
    });
  }

  // The ramp from the lot up to the quay, rising south. Under its high end it's solid, in slices
  // each as high as the ramp at its low end, so nobody walks in under it from the side.
  const ramp: Floor = {
    minX: -3,
    maxX: 3,
    minZ: -25,
    maxZ: -21,
    y: HARBOUR_LOT_Y,
    thickness: 0.1,
    kind: "ground",
    rise: { toward: "s", height: 0.5 - HARBOUR_LOT_Y },
  };
  const SLICES = 4;
  const run = ramp.maxZ - ramp.minZ;
  for (let i = 1; i < SLICES; i++) {
    boxes.push({
      minX: ramp.minX,
      maxX: ramp.maxX,
      minZ: ramp.maxZ - ((i + 1) * run) / SLICES,
      maxZ: ramp.maxZ - (i * run) / SLICES,
      y: HARBOUR_LOT_Y,
      height: ((ramp.rise?.height ?? 0) * i) / SLICES,
      kind: "scenery",
    });
  }

  return {
    truck: TRUCK,
    props,
    boxes,
    ramps: [ramp],
    // One lamp, at the head of the ramp: far enough from the warehouse not to shine into it.
    lamps: [{ x: 5.2, y: 0.5, z: -27.5 }],
    overview: { x: -4, y: 6, z: -41 },
  };
}
