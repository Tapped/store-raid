import type { Box } from "./collision";
import { ITEM_KINDS, PLAYER_RADIUS } from "./constants";
import {
  Building,
  blocksOn,
  footprint,
  linksOf,
  MODES,
  type Mode,
  overlaps,
  type Point,
  Reach,
  TURN,
  targetsOf,
} from "./furnish";
import { floorHeight, type Level, type LightSpawn } from "./level";
import { PROPS, type PropName } from "./props";
import { composeTiles, OFFSET, OPPOSITE, openingOf, SIDES, STOREY } from "./tiles";

/**
 * What's wrong with a furnished generated level (shared/furnish.ts), checked from the level alone,
 * apart from how it was made:
 *
 * - everything reachable in the bare building (doorways, both ends of stairs, ladders and planks,
 *   where players start) still is, the same ways, including 1.4 m wide where it was;
 * - every item can be reached the way it has to be carried, and isn't inside anything;
 * - nothing solid stands in a doorway, on stairs, at a ladder, on the dock or where players start,
 *   nor in a wall or in another prop;
 * - floor props stand on floor, wall props hang on a wall that's there all across and up them, and
 *   ceiling props under a ceiling, over a floor;
 * - every tube, emergency light and exit sign has its fitting.
 *
 * The level's boxes must be its tiles' boxes, in order, then its props'. Returns the problems, or
 * an empty list.
 */
export function checkLevel(level: Level): string[] {
  const problems: string[] = [];
  const grid = level.grid;
  if (!grid) return ["it has no grid"];
  const building = new Building(grid);
  const bare = composeTiles(grid).boxes;
  const propBoxes = level.boxes.slice(bare.length);
  const links = linksOf(building);
  const spawn = level.spawnPoint(1);
  const start = { storey: 0, x: spawn.x, z: spawn.z };
  const where = (p: Point) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) on storey ${p.storey}`;

  // Reachability, before and after.
  const before = new Reach(building, bare, links, start);
  before.update(() => []);
  const after = new Reach(building, level.boxes, links, start);
  after.update(() => []);
  for (const target of targetsOf(building, links, start)) {
    for (const mode of MODES) {
      if (before.reaches(mode, target) && !after.reaches(mode, target)) {
        problems.push(`${target.why} at ${where(target)} can't be reached (${mode}) any more`);
      }
    }
  }
  for (const item of level.items) {
    const storey = Math.floor((item.y + 0.5) / STOREY);
    const point = { storey, x: item.x, z: item.z };
    const kind = ITEM_KINDS[item.kind];
    const mode: Mode = item.kind === "sofa" ? "wide" : kind.hands === 2 ? "carry" : "walk";
    if (!after.reaches(mode, point)) {
      problems.push(`a ${item.kind} at ${where(point)} can't be reached (${mode})`);
    }
    const [width, , depth] = kind.size;
    const box = {
      minX: item.x - width / 2,
      maxX: item.x + width / 2,
      minZ: item.z - depth / 2,
      maxZ: item.z + depth / 2,
    };
    if (level.boxes.some((b) => blocksOn(b, storey) && overlaps(box, b))) {
      problems.push(`a ${item.kind} at ${where(point)} is inside something`);
    }
  }

  // Places nothing solid stands.
  const keepClear: { box: Box; y: number; why: string }[] = [];
  if (level.dock) keepClear.push({ box: level.dock, y: 0, why: "the dock" });
  for (let i = 0; i < 3; i++) {
    const { x, z } = level.spawnPoint(i);
    const r = PLAYER_RADIUS;
    keepClear.push({
      box: { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r },
      y: 0,
      why: "where players start",
    });
  }
  for (const ladder of level.ladders) keepClear.push({ box: ladder, y: ladder.y, why: "a ladder" });
  for (const floor of level.floors) {
    if (floor.kind === "stairs") keepClear.push({ box: floor, y: floor.y, why: "stairs" });
  }
  for (const storey of building.storeys()) {
    for (let row = 0; row < building.rows; row++) {
      for (let col = 0; col < building.cols; col++) {
        for (const side of ["n", "e"] as const) {
          const opening = openingOf(building.parsed.edge(storey, col, row, side));
          if (!opening) continue;
          const [dx, dz] = OFFSET[side];
          for (const box of [
            building.strip(col, row, side, 0.6, opening.width),
            building.strip(col + dx, row + dz, OPPOSITE[side], 0.6, opening.width),
          ]) {
            keepClear.push({ box, y: storey * STOREY, why: "a doorway" });
          }
        }
      }
    }
  }
  for (const box of propBoxes) {
    const storey = Math.round(box.y / STOREY);
    for (const zone of keepClear) {
      if (Math.abs(zone.y - box.y) < STOREY / 2 && overlaps(box, zone.box)) {
        const middle = { storey, x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
        problems.push(`a prop at ${where(middle)} stands on ${zone.why}`);
      }
    }
  }

  // Props where they belong.
  const over = (f: Box, x: number, z: number) =>
    x >= f.minX - 0.001 && x <= f.maxX + 0.001 && z >= f.minZ - 0.001 && z <= f.maxZ + 0.001;
  // Flat floor, or stairs where they're at that height: a doorway can open onto either.
  const floorAt = (x: number, z: number, y: number) =>
    level.floors.some(
      (f) =>
        (f.kind === "floor" || f.kind === "stairs" || f.kind === "plank") &&
        over(f, x, z) &&
        Math.abs(floorHeight(f, x, z) - y) < 0.15,
    );
  const ceilingAt = (x: number, z: number, y: number) =>
    level.floors.some(
      (f) => f.kind === "floor" && Math.abs(f.y - f.thickness - y) < 0.01 && over(f, x, z),
    ) ||
    (level.roof !== undefined && Math.abs(level.roof - y) < 0.01);
  const corners = (b: Box, inset: number) => [
    [b.minX + inset, b.minZ + inset],
    [b.maxX - inset, b.minZ + inset],
    [b.minX + inset, b.maxZ - inset],
    [b.maxX - inset, b.maxZ - inset],
  ];
  const solids: { box: Box; y: number; top: number; fence: boolean }[] = [];
  for (const prop of level.props) {
    const model = prop.model as PropName;
    const kind = PROPS[model];
    if (!kind) {
      problems.push(`${prop.model} isn't in the catalogue`);
      continue;
    }
    const [width, height] = kind.size;
    const base = Math.floor((prop.y - (kind.mount === "ceiling" ? 0.01 : -0.01)) / STOREY);
    const at = `${prop.model} at ${where({ storey: base, x: prop.x, z: prop.z })}`;
    if (kind.mount === "floor") {
      const box = footprint(model, prop.x, prop.z, prop.turn);
      const off = corners(box, 0.02).filter(([x, z]) => !floorAt(x, z, prop.y)).length;
      // What stands in a doorway needs floor on one side: the other may be where a ladder arrives.
      const doorway = model === "door-frame" || model === "strip-curtain";
      if (off > (doorway ? 2 : 0)) problems.push(`${at} isn't on a floor`);
      if (kind.solid) {
        solids.push({ box, y: prop.y, top: prop.y + height, fence: model === "cage-panel" });
      }
    } else if (kind.mount === "ceiling") {
      const box = footprint(model, prop.x, prop.z, prop.turn);
      for (const [x, z] of corners(box, 0.05)) {
        if (!ceilingAt(x, z, prop.y)) problems.push(`${at} isn't under a ceiling`);
        else if (!floorAt(x, z, base * STOREY)) problems.push(`${at} hangs over no floor`);
      }
    } else {
      // Its back against the face of a wall that's there all across it and all the way up it.
      const facing = SIDES.find((side) => {
        const apart = Math.abs(TURN[side] - prop.turn) % (2 * Math.PI);
        return apart < 0.01 || Math.abs(apart - 2 * Math.PI) < 0.01;
      });
      if (!facing) {
        problems.push(`${at} faces no wall`);
        continue;
      }
      const alongX = facing === "n" || facing === "s";
      const middle = alongX ? prop.x : prop.z;
      // The walls behind it, end to end, must cover it.
      const spans = level.boxes
        .filter((b) => {
          if (b.kind !== "wall" && b.kind !== "partition") return false;
          if (b.y > prop.y + 0.01 || b.y + b.height < prop.y + height - 0.01) return false;
          const face = { n: b.maxZ, s: b.minZ, e: b.maxX, w: b.minX }[facing];
          return Math.abs(face - (alongX ? prop.z : prop.x)) <= 0.02;
        })
        .map((b) => (alongX ? [b.minX, b.maxX] : [b.minZ, b.maxZ]))
        .sort((a, b) => a[0] - b[0]);
      let covered = middle - width / 2;
      for (const [lo, hi] of spans) if (lo <= covered + 0.01) covered = Math.max(covered, hi);
      if (covered < middle + width / 2 - 0.01) problems.push(`${at} isn't on a wall`);
    }
  }
  for (const [i, a] of solids.entries()) {
    const at = where({ storey: Math.round(a.y / STOREY), x: a.box.minX, z: a.box.minZ });
    for (const b of solids.slice(i + 1)) {
      if (Math.abs(a.y - b.y) < 0.01 && overlaps(a.box, b.box))
        problems.push(`props overlap at ${at}`);
    }
    for (const wall of bare) {
      if (wall.y >= a.top || wall.y + wall.height <= a.y + 0.01) continue;
      if (overlaps(a.box, wall, a.fence ? -0.12 : 0))
        problems.push(`a prop at ${at} is in a ${wall.kind}`);
    }
  }

  // Fittings for the lights that have them.
  const fitting: Partial<Record<LightSpawn["kind"], PropName>> = {
    tube: "ceiling-tube",
    emergency: "emergency-light",
    exit: "exit-sign",
  };
  for (const light of level.lights) {
    const model = fitting[light.kind];
    if (!model) continue;
    const found = level.props.some(
      (p) =>
        p.model === model &&
        Math.hypot(p.x - light.x, p.z - light.z) < 0.3 &&
        Math.abs(p.y - light.y) < 0.3,
    );
    if (!found) {
      const storey = Math.floor(light.y / STOREY);
      problems.push(
        `a ${light.kind} light at ${where({ storey, x: light.x, z: light.z })} has no fitting`,
      );
    }
  }
  return problems;
}
