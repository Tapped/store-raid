import type { Camera } from "@babylonjs/core";
import type { Level } from "../../shared/level";
import {
  CELL,
  openingOf,
  parseTiles,
  SIDES,
  type Side,
  STOREY,
  type Tile,
} from "../../shared/tiles";

/**
 * Which rooms of a tiled level could be in view from a camera: everything else is behind walls,
 * floors or ceilings, or out of the frustum.
 *
 * From the camera's cell it floods to neighbouring cells across any side that isn't a wall, and up
 * or down through open air, carrying a rectangle of the screen: the part of the view that can see
 * that far. Crossing into a cell narrows it to where the opening crossed falls on the screen. Any
 * line of sight lands on one point of the screen and crosses every opening between the camera and
 * what it sees there, so that point is in every opening's rectangle, and a room that can be seen is
 * never left out; while rooms behind a wall, or seen only past the edge of a doorway, are.
 */
export interface RoomVisibility {
  /**
   * The rooms (indices into `Level.rooms`) that could be seen from the camera, or undefined if it
   * isn't in the building, when anything could be.
   */
  visible(camera: Camera): ReadonlySet<number> | undefined;
}

/** Tiles that are air, which can be seen through from above or below. */
const AIR = new Set<Tile["kind"]>(["open", "well", "shaft", "pit", "bridge"]);

const STEP: Record<Side, [number, number]> = { n: [0, 1], e: [1, 0], s: [0, -1], w: [-1, 0] };

/** Floods that go on this long give up and draw everything. */
const MAX_STEPS = 50_000;

/** Room visibility for a tiled level, or undefined for one that isn't tiled. */
export function roomVisibility(level: Level): RoomVisibility | undefined {
  const grid = level.grid;
  if (!grid) return undefined;
  const parsed = parseTiles(grid);
  const { cols, rows, basements } = parsed;
  const storeys = parsed.tiles.length;
  const index = (storey: number, col: number, row: number) =>
    ((storey + basements) * rows + row) * cols + col;
  const count = storeys * rows * cols;
  const layer = rows * cols;

  const roomOf = new Int32Array(count).fill(-1);
  for (const room of level.rooms) {
    for (const { col, row } of room.cells) roomOf[index(room.storey, col, row)] = room.id;
  }
  const solid = new Uint8Array(count);
  const air = new Uint8Array(count);
  for (let s = -basements; s < storeys - basements; s++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const kind = parsed.tile(s, col, row)?.kind ?? "open";
        solid[index(s, col, row)] = kind === "solid" ? 1 : 0;
        air[index(s, col, row)] = AIR.has(kind) ? 1 : 0;
      }
    }
  }

  // The opening on the north and east sides of every cell, and in its ceiling, if there is one,
  // as the four corners of a rectangle (south and west are a neighbour's north and east).
  const openings = (n: number) => new Array<Float32Array | undefined>(n);
  const north = openings(count);
  const east = openings(count);
  const up = openings(count);
  for (let s = -basements; s < storeys - basements; s++) {
    const y0 = s * STOREY;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = index(s, col, row);
        if (solid[i]) continue;
        const x0 = grid.x + col * CELL;
        const z0 = grid.z + row * CELL;
        // A doorway is only so high; open sides go up to the ceiling.
        const top = (side: Side) => {
          const edge = parsed.edge(s, col, row, side);
          if (edge === "wall") return undefined;
          return y0 + (openingOf(edge)?.height ?? STOREY);
        };
        if (row + 1 < rows && !solid[i + cols]) {
          const y1 = top("n");
          const z = z0 + CELL;
          if (y1 !== undefined) {
            north[i] = Float32Array.of(x0, y0, z, x0 + CELL, y0, z, x0, y1, z, x0 + CELL, y1, z);
          }
        }
        if (col + 1 < cols && !solid[i + 1]) {
          const y1 = top("e");
          const x = x0 + CELL;
          if (y1 !== undefined) {
            east[i] = Float32Array.of(x, y0, z0, x, y0, z0 + CELL, x, y1, z0, x, y1, z0 + CELL);
          }
        }
        if (i + layer < count && air[i + layer]) {
          const y = y0 + STOREY;
          up[i] = Float32Array.of(
            x0,
            y,
            z0,
            x0 + CELL,
            y,
            z0,
            x0,
            y,
            z0 + CELL,
            x0 + CELL,
            y,
            z0 + CELL,
          );
        }
      }
    }
  }

  /** Each cell's rectangle of the screen, as min x, min y, max x, max y; empty if not reached. */
  const rects = new Float32Array(count * 4);
  const reached = new Uint8Array(count);
  const queued = new Uint8Array(count);
  const queue: number[] = [];
  const rooms = new Set<number>();
  const lastView = new Float32Array(16);
  let lastResult: ReadonlySet<number> | undefined;
  let m: ArrayLike<number> = lastView;
  const rect = new Float32Array(4);

  /**
   * The screen rectangle of an opening's corners into `rect`; false if it's all behind the camera.
   * Partly behind, it could be anywhere on the screen.
   */
  const project = (corners: Float32Array): boolean => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let behind = 0;
    for (let k = 0; k < 12; k += 3) {
      const x = corners[k];
      const y = corners[k + 1];
      const z = corners[k + 2];
      const w = x * m[3] + y * m[7] + z * m[11] + m[15];
      if (w < 0.05) {
        behind++;
        continue;
      }
      const sx = (x * m[0] + y * m[4] + z * m[8] + m[12]) / w;
      const sy = (x * m[1] + y * m[5] + z * m[9] + m[13]) / w;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    if (behind === 4) return false;
    if (behind > 0) {
      rect.set([-1, -1, 1, 1]);
      return true;
    }
    rect.set([minX, minY, maxX, maxY]);
    return true;
  };

  return {
    visible(camera) {
      const matrix = camera.getTransformationMatrix();
      const view = matrix.asArray();
      let same = lastResult !== undefined;
      for (let k = 0; k < 16 && same; k++) same = view[k] === lastView[k];
      if (same) return lastResult;
      lastView.set(view);
      m = view;

      const p = camera.globalPosition;
      const col = Math.floor((p.x - grid.x) / CELL);
      const row = Math.floor((p.z - grid.z) / CELL);
      const storey = Math.floor(p.y / STOREY);
      if (
        col < 0 ||
        row < 0 ||
        col >= cols ||
        row >= rows ||
        storey < -basements ||
        storey >= storeys - basements ||
        solid[index(storey, col, row)]
      ) {
        lastResult = undefined;
        return undefined;
      }
      reached.fill(0);
      queued.fill(0);
      rooms.clear();
      queue.length = 0;
      const start = index(storey, col, row);
      rects.set([-1, -1, 1, 1], start * 4);
      reached[start] = 1;
      queued[start] = 1;
      queue.push(start);
      let steps = 0;
      // Into cell j through an opening, from cell i: with i's rectangle narrowed to the opening's.
      const cross = (i: number, j: number, opening: Float32Array | undefined) => {
        if (!opening || solid[j] || !project(opening)) return;
        const a = i * 4;
        const minX = Math.max(rects[a], rect[0]);
        const minY = Math.max(rects[a + 1], rect[1]);
        const maxX = Math.min(rects[a + 2], rect[2]);
        const maxY = Math.min(rects[a + 3], rect[3]);
        if (minX >= maxX || minY >= maxY) return;
        const b = j * 4;
        if (reached[j]) {
          // Only on if it widens what this cell can see.
          if (
            minX >= rects[b] &&
            minY >= rects[b + 1] &&
            maxX <= rects[b + 2] &&
            maxY <= rects[b + 3]
          ) {
            return;
          }
          rects[b] = Math.min(rects[b], minX);
          rects[b + 1] = Math.min(rects[b + 1], minY);
          rects[b + 2] = Math.max(rects[b + 2], maxX);
          rects[b + 3] = Math.max(rects[b + 3], maxY);
        } else {
          reached[j] = 1;
          rects[b] = minX;
          rects[b + 1] = minY;
          rects[b + 2] = maxX;
          rects[b + 3] = maxY;
        }
        if (!queued[j]) {
          queued[j] = 1;
          queue.push(j);
        }
      };
      for (let head = 0; head < queue.length; head++) {
        if (++steps > MAX_STEPS) {
          lastResult = undefined;
          return undefined;
        }
        const i = queue[head];
        queued[i] = 0;
        const c = i % cols;
        const r = Math.floor(i / cols) % rows;
        for (const side of SIDES) {
          const [dc, dr] = STEP[side];
          if (c + dc < 0 || r + dr < 0 || c + dc >= cols || r + dr >= rows) continue;
          const j = i + dc + dr * cols;
          cross(
            i,
            j,
            side === "n" ? north[i] : side === "e" ? east[i] : side === "s" ? north[j] : east[j],
          );
        }
        if (i + layer < count) cross(i, i + layer, up[i]);
        if (i - layer >= 0) cross(i, i - layer, up[i - layer]);
      }
      for (let i = 0; i < count; i++) {
        if (reached[i] && roomOf[i] >= 0) rooms.add(roomOf[i]);
      }
      lastResult = new Set(rooms);
      return lastResult;
    },
  };
}
