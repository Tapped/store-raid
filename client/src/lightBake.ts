/**
 * The bake behind interior lighting (client/src/interiorLight.ts): light from every fitting carried
 * through a grid of voxels over the building, blocked by its walls, floors and furniture.
 *
 * The grid's samples sit at voxel centres. Between each pair of neighbouring centres is an edge,
 * open unless something solid lies across it: a wall only 20 cm thick still closes the edges through
 * it, so light can't pass, and the shader reads these edges too, so it never blends light from one
 * side of a wall into the other. Walls of tiled levels lie on voxel boundaries, between two centres.
 *
 * - Direct light: every fitting lights each voxel it can see, by a walk along the grid from its own
 *   voxel to that one, through open edges only (a 3D DDA), within its reach.
 * - Bounce: the direct light, blurred over the open edges many times, so light spills through
 *   doorways, round corners and up stairwells and fades a few meters into the dark.
 * - Flicker: one fitting that changes, the strongest at each voxel, is kept apart from the steady
 *   light, by its index, so the shader can scale it by that fitting's brightness this frame.
 *
 * Pure and self-contained, so it runs in a worker (lightBake.worker.ts), or on the page if it must.
 */

/** A fitting, as the bake sees it. */
export interface BakeSource {
  x: number;
  y: number;
  z: number;
  /** How it spreads its light: a tube or bulb's shade, a TV's screen, an emergency lamp's cone. */
  shape: "tube" | "bulb" | "spot" | "screen" | "sign";
  /** For a tube, the way its length runs; for a screen or sign, the way it faces. Unit, in xz. */
  dx: number;
  dz: number;
  /** Its light, linear RGB: colour times power times the strength of its kind. */
  r: number;
  g: number;
  b: number;
  /** Meters until its light has faded out. */
  reach: number;
  /** Its index among the lights the shader can scale (the lights texture), or -1 if steady. */
  dynamic: number;
}

export interface BakeInput {
  /** The corner of the grid, and the size of a voxel. */
  origin: [number, number, number];
  size: number;
  dims: [number, number, number];
  /** What blocks light, 6 numbers each: minX, minY, minZ, maxX, maxY, maxZ. */
  blockers: Float32Array;
  sources: BakeSource[];
  /** How much bounce light there is next to the direct light it comes from. */
  bounce: number;
  /** Meters bounce light carries, roughly, before it has faded to a third. */
  spread: number;
}

export interface BakeOutput {
  /**
   * Four floats a voxel: steady light (rgb), then -1 for a solid voxel, else its open edges (bit 0
   * towards +x, 1 towards +y, 2 towards +z) plus 8 times one more than the index of the fitting
   * whose light changes, or 0 for none.
   */
  a: Float32Array;
  /**
   * Four floats a voxel: where the light comes from, as a vector whose length says how much of it
   * comes from one way (1) or all round (0); then the changing fitting's light, to be multiplied by
   * its colour and brightness.
   */
  b: Float32Array;
  /** Milliseconds it took, in all and by stage. */
  ms: number;
  stages: { grid: number; direct: number; bounce: number };
}

/** How far boxes reach beyond themselves, so a centre on a box's face counts as inside it. */
const EPS = 0.02;
/** A light this close is as bright as it gets, so a voxel right by a tube doesn't blaze. */
const NEAR = 0.35;
/** About how bright a flickering light is on average, for its light where it isn't the one kept apart. */
const AVERAGE = 0.6;
/** How much of a changing light's bounce a voxel must see to count as lit by it. */
const ADOPT = 0.002;

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function bakeLight(input: BakeInput): BakeOutput {
  const start = performance.now();
  const [ox, oy, oz] = input.origin;
  const s = input.size;
  const [nx, ny, nz] = input.dims;
  const sy = nx;
  const sz = nx * ny;
  const count = nx * ny * nz;

  // Open edges, as bits, and which voxels are solid.
  const open = new Uint8Array(count).fill(7);
  const solid = new Uint8Array(count);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      open[nx - 1 + j * sy + k * sz] &= ~1;
      if (j === ny - 1) for (let i = 0; i < nx; i++) open[i + j * sy + k * sz] &= ~2;
      if (k === nz - 1) for (let i = 0; i < nx; i++) open[i + j * sy + k * sz] &= ~4;
    }
  // The first voxel whose centre is above `min`, and the last whose centre is below `max`.
  const first = (min: number, o: number) => Math.max(0, Math.floor((min - o) / s - 0.5) + 1);
  const last = (max: number, o: number, n: number) =>
    Math.min(n - 1, Math.ceil((max - o) / s - 0.5) - 1);
  const { blockers } = input;
  for (let b = 0; b < blockers.length; b += 6) {
    const [x0, x1] = [first(blockers[b] - EPS, ox), last(blockers[b + 3] + EPS, ox, nx)];
    const [y0, y1] = [first(blockers[b + 1] - EPS, oy), last(blockers[b + 4] + EPS, oy, ny)];
    const [z0, z1] = [first(blockers[b + 2] - EPS, oz), last(blockers[b + 5] + EPS, oz, nz)];
    // Centres inside it are solid.
    for (let k = z0; k <= z1; k++)
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) solid[i + j * sy + k * sz] = 1;
    // An edge is closed where its segment crosses the box: along x, from the centre before the box
    // to the last centre in it.
    for (let k = z0; k <= z1; k++)
      for (let j = y0; j <= y1; j++)
        for (let i = Math.max(0, x0 - 1); i <= Math.min(x1, nx - 2); i++)
          open[i + j * sy + k * sz] &= ~1;
    for (let k = z0; k <= z1; k++)
      for (let j = Math.max(0, y0 - 1); j <= Math.min(y1, ny - 2); j++)
        for (let i = x0; i <= x1; i++) open[i + j * sy + k * sz] &= ~2;
    for (let k = Math.max(0, z0 - 1); k <= Math.min(z1, nz - 2); k++)
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) open[i + j * sy + k * sz] &= ~4;
  }

  // Each voxel's six neighbours through open edges, or -1.
  const neighbours = new Int32Array(count * 6).fill(-1);
  for (let v = 0; v < count; v++) {
    if (solid[v]) continue;
    const m = open[v];
    const j = Math.floor(v / sy) % ny;
    const k = Math.floor(v / sz);
    if (m & 1 && !solid[v + 1]) {
      neighbours[v * 6] = v + 1;
      neighbours[(v + 1) * 6 + 1] = v;
    }
    if (m & 2 && j < ny - 1 && !solid[v + sy]) {
      neighbours[v * 6 + 2] = v + sy;
      neighbours[(v + sy) * 6 + 3] = v;
    }
    if (m & 4 && k < nz - 1 && !solid[v + sz]) {
      neighbours[v * 6 + 4] = v + sz;
      neighbours[(v + sz) * 6 + 5] = v;
    }
  }

  const gridDone = performance.now();
  const steady = new Float32Array(count * 3);
  const direction = new Float32Array(count * 3);
  const changing = new Float32Array(count);
  const changingIndex = new Int32Array(count).fill(-1);
  /** The changing light's luminance at each voxel, to tell which of two is the stronger. */
  const changingLit = new Float32Array(count);
  /** The sources whose light changes, by their index in the lights texture. */
  const dynamicSources: BakeSource[] = [];
  for (const source of input.sources)
    if (source.dynamic >= 0) dynamicSources[source.dynamic] = source;
  /** The steady and changing light's luminance, for the direction's length. */
  const weight = new Float32Array(count);

  const stamp = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);

  /** Whether the walk from voxel a to voxel b along the grid crosses only open edges. */
  const sees = (ai: number, aj: number, ak: number, bi: number, bj: number, bk: number) => {
    const dx = bi - ai;
    const dy = bj - aj;
    const dz = bk - ak;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const stepZ = Math.sign(dz);
    const deltaX = dx ? 1 / Math.abs(dx) : Infinity;
    const deltaY = dy ? 1 / Math.abs(dy) : Infinity;
    const deltaZ = dz ? 1 / Math.abs(dz) : Infinity;
    let tx = deltaX / 2;
    let ty = deltaY / 2;
    let tz = deltaZ / 2;
    let i = ai;
    let j = aj;
    let k = ak;
    let v = i + j * sy + k * sz;
    let steps = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    while (steps-- > 0) {
      if (tx <= ty && tx <= tz) {
        const lower = stepX > 0 ? v : v - 1;
        if (!(open[lower] & 1)) return false;
        i += stepX;
        v += stepX;
        tx += deltaX;
      } else if (ty <= tz) {
        const lower = stepY > 0 ? v : v - sy;
        if (!(open[lower] & 2)) return false;
        j += stepY;
        v += stepY * sy;
        ty += deltaY;
      } else {
        const lower = stepZ > 0 ? v : v - sz;
        if (!(open[lower] & 4)) return false;
        k += stepZ;
        v += stepZ * sz;
        tz += deltaZ;
      }
      if (solid[v]) return false;
    }
    return true;
  };

  for (const [index, source] of input.sources.entries()) {
    // The voxel it shines from: its own, or the nearest open one round it, below first.
    let si = Math.floor((source.x - ox) / s);
    let sj = Math.floor((source.y - oy) / s);
    let sk = Math.floor((source.z - oz) / s);
    if (si < 0 || sj < 0 || sk < 0 || si >= nx || sj >= ny || sk >= nz) continue;
    if (solid[si + sj * sy + sk * sz]) {
      let found = false;
      search: for (let r = 1; r <= 2; r++)
        for (const dj of [-r, 0, r])
          for (const di of [0, -r, r])
            for (const dk of [0, -r, r]) {
              const [i, j, k] = [si + di, sj + dj, sk + dk];
              if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
              if (solid[i + j * sy + k * sz]) continue;
              [si, sj, sk] = [i, j, k];
              found = true;
              break search;
            }
      if (!found) continue;
    }
    const along = source.shape === "tube" ? 0.45 : 0;
    const reach2 = source.reach * source.reach;
    const strength = luma(source.r, source.g, source.b);
    // Every voxel the light can get to by the open edges, within its reach, breadth first.
    const from = si + sj * sy + sk * sz;
    let head = 0;
    let tail = 0;
    queue[tail++] = from;
    stamp[from] = index;
    while (head < tail) {
      const v = queue[head++];
      const i = v % nx;
      const j = Math.floor(v / sy) % ny;
      const k = Math.floor(v / sz);
      const px = ox + (i + 0.5) * s;
      const py = oy + (j + 0.5) * s;
      const pz = oz + (k + 0.5) * s;
      for (let n = 0; n < 6; n++) {
        const next = neighbours[v * 6 + n];
        if (next < 0 || stamp[next] === index) continue;
        const qi = next % nx;
        const qj = Math.floor(next / sy) % ny;
        const qk = Math.floor(next / sz);
        const ex = ox + (qi + 0.5) * s - source.x;
        const ey = oy + (qj + 0.5) * s - source.y;
        const ez = oz + (qk + 0.5) * s - source.z;
        if (ex * ex + ey * ey + ez * ez > reach2) continue;
        stamp[next] = index;
        queue[tail++] = next;
      }
      if (v !== from && !sees(si, sj, sk, i, j, k)) continue;

      // How much reaches this voxel's centre: from three points along a tube, one otherwise.
      let amount = 0;
      for (let t = -1; t <= 1; t++) {
        if (!along && t !== 0) continue;
        const lx = source.x + source.dx * along * t - px;
        const ly = source.y - py;
        const lz = source.z + source.dz * along * t - pz;
        const d2 = lx * lx + ly * ly + lz * lz;
        const d = Math.sqrt(d2) || 1;
        // From the light towards the voxel, and how much the fitting sends that way.
        const [ux, uy, uz] = [-lx / d, -ly / d, -lz / d];
        let spread = 1;
        switch (source.shape) {
          case "tube":
            spread = 0.3 + 0.7 * Math.max(0, -uy);
            break;
          case "bulb":
            // A high-bay dome or a shade: most of it downwards.
            spread = 0.3 + 0.7 * Math.max(0, -uy);
            break;
          case "spot":
            spread = 0.15 + 0.85 * Math.max(0, -uy) ** 2;
            break;
          case "screen":
          case "sign":
            spread = Math.max(0, ux * source.dx + uz * source.dz) ** 0.7;
            break;
        }
        const fade = Math.max(0, 1 - (d2 / reach2) ** 2) ** 2;
        amount += (spread * fade) / (d2 + NEAR * NEAR);
      }
      if (along) amount /= 3;
      if (amount <= 0) continue;
      const lx = source.x - px;
      const ly = source.y - py;
      const lz = source.z - pz;
      const d = Math.hypot(lx, ly, lz) || 1;
      const lit = amount * strength;
      direction[v * 3] += (lit * lx) / d;
      direction[v * 3 + 1] += (lit * ly) / d;
      direction[v * 3 + 2] += (lit * lz) / d;
      weight[v] += lit;
      const add = (from: BakeSource, k: number) => {
        steady[v * 3] += from.r * k;
        steady[v * 3 + 1] += from.g * k;
        steady[v * 3 + 2] += from.b * k;
      };
      if (source.dynamic < 0) {
        add(source, amount);
      } else if (lit > changingLit[v]) {
        // The strongest changing light here keeps its place; one it displaces joins the steady
        // light at about its average brightness.
        const was = changingIndex[v];
        if (was >= 0) add(dynamicSources[was], changing[v] * AVERAGE);
        changing[v] = amount;
        changingLit[v] = lit;
        changingIndex[v] = source.dynamic;
      } else {
        add(source, amount * AVERAGE);
      }
    }
  }

  const directDone = performance.now();
  // Bounce: each pass, a voxel takes a little of its own direct light and the rest from the
  // average of its open neighbours. Light that can't get out of a room stays in it, and through
  // a doorway it fades over about `spread` meters.
  const reachVoxels = Math.max(1, input.spread / s);
  const keep = 1 / (1 + reachVoxels * reachVoxels);
  // Updated in place, sweeping one way and then back (Gauss-Seidel), which settles in about half
  // the passes of updating from a copy.
  const passes = Math.min(80, Math.ceil(reachVoxels * reachVoxels * 0.8));
  const free: number[] = [];
  for (let v = 0; v < count; v++)
    if (
      !solid[v] &&
      neighbours[v * 6] +
        neighbours[v * 6 + 1] +
        neighbours[v * 6 + 2] +
        neighbours[v * 6 + 3] +
        neighbours[v * 6 + 4] +
        neighbours[v * 6 + 5] >
        -6
    )
      free.push(v);
  const cells = Int32Array.from(free);
  const bounce = Float32Array.from(steady);
  // The changing light bounces too, as far as the voxels that are its own.
  const bounceChanging = Float32Array.from(changing);
  const owner = Int32Array.from(changingIndex);
  for (let pass = 0; pass < passes; pass++) {
    const forward = pass % 2 === 0;
    for (let c = 0; c < cells.length; c++) {
      const v = cells[forward ? c : cells.length - 1 - c];
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      let dyn = 0;
      let best = -1;
      let bestLight = 0;
      const mine = owner[v];
      for (let e = 0; e < 6; e++) {
        const u = neighbours[v * 6 + e];
        if (u < 0) continue;
        r += bounce[u * 3];
        g += bounce[u * 3 + 1];
        b += bounce[u * 3 + 2];
        n++;
        const theirs = owner[u];
        if (theirs < 0) continue;
        if (mine < 0 && bounceChanging[u] > Math.max(bestLight, ADOPT)) {
          bestLight = bounceChanging[u];
          best = theirs;
        }
        if (theirs === mine) dyn += bounceChanging[u];
      }
      const take = (1 - keep) / n;
      bounce[v * 3] = keep * steady[v * 3] + take * r;
      bounce[v * 3 + 1] = keep * steady[v * 3 + 1] + take * g;
      bounce[v * 3 + 2] = keep * steady[v * 3 + 2] + take * b;
      if (mine < 0 && best >= 0) {
        // Not lit by a changing light itself: it takes on its brightest neighbour's.
        owner[v] = best;
        bounceChanging[v] = take * bestLight;
      } else if (mine >= 0) {
        bounceChanging[v] = keep * changing[v] + take * dyn;
      }
    }
  }

  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 4);
  const gain = input.bounce;
  for (let v = 0; v < count; v++) {
    if (solid[v]) {
      a[v * 4 + 3] = -1;
      continue;
    }
    const r = steady[v * 3] + gain * bounce[v * 3];
    const g = steady[v * 3 + 1] + gain * bounce[v * 3 + 1];
    const bl = steady[v * 3 + 2] + gain * bounce[v * 3 + 2];
    const index = owner[v];
    const dyn = (index === changingIndex[v] ? changing[v] : 0) + gain * bounceChanging[v];
    const bounced = gain * luma(bounce[v * 3], bounce[v * 3 + 1], bounce[v * 3 + 2]);
    // Bounce comes mostly up off the floor: it leans the direction down a little, so ceilings
    // facing the lit floor take some of it.
    const total = weight[v] + bounced + 1e-6;
    a[v * 4] = r;
    a[v * 4 + 1] = g;
    a[v * 4 + 2] = bl;
    a[v * 4 + 3] = (open[v] & 7) + 8 * (index + 1);
    b[v * 4] = direction[v * 3] / total;
    b[v * 4 + 1] = (direction[v * 3 + 1] - 0.4 * bounced) / total;
    b[v * 4 + 2] = direction[v * 3 + 2] / total;
    b[v * 4 + 3] = dyn;
  }
  const end = performance.now();
  return {
    a,
    b,
    ms: end - start,
    stages: { grid: gridDone - start, direct: directDone - gridDone, bounce: end - directDone },
  };
}
