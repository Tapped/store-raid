import {
  type AbstractMesh,
  Color3,
  MaterialDefines,
  MaterialPluginBase,
  Mesh,
  type PBRMaterial,
  type Scene,
  ShaderLanguage,
  VertexData,
} from "@babylonjs/core";
import { SURFACES, type SurfaceName, type SurfaceOptions, surface } from "./surfaces";

/**
 * A part builder, after Saltline's (see F:\Dev\Libraries\Saltline\METHOD.md): geometry made in code
 * from small primitives, with texture coordinates in world meters ÷ the surface's tile, sorted into
 * buckets by surface and merged into one mesh per bucket. Wear is baked into vertex colour: a
 * function of world position and normal, so seams between parts get the same value on both sides.
 *
 * Painted (tintable) surfaces take their paint colour from the vertex colour too, so one material
 * serves every colour: rgb is the paint, alpha the wear. Other surfaces take rgb as wear.
 */

export type Vec3 = [number, number, number];

/** How dark or light a point is: 1 is as the surface is, less is dirtier. */
export type WearFn = (
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
) => number;

interface Bucket {
  surface: SurfaceName;
  options: SurfaceOptions | undefined;
  painted: boolean;
  tile: number;
  upright: boolean;
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

/** Grime's colour on surfaces that aren't painted, where wear darkens them: a little warm. */
const GRIME = [0.86, 0.8, 0.72];

export class PartBuilder {
  private readonly buckets = new Map<string, Bucket>();
  /** The paint, linear, for painted surfaces; the table's tint when unset. */
  paint: Color3 | undefined;
  /** The wear of whatever is added next. */
  wear: WearFn = () => 1;
  /** The chunk whatever is added next goes in: meshes are per surface and chunk, for culling. */
  chunk = "";
  /** Texture coordinates in meters for whatever is added next, instead of box projection. */
  uvs: ((x: number, y: number, z: number) => [number, number]) | undefined;

  private bucket(name: SurfaceName, options?: SurfaceOptions): Bucket {
    const key = `${name}|${options ? JSON.stringify(options) : ""}|${this.chunk}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      const spec = SURFACES[name];
      bucket = {
        surface: name,
        options,
        painted: !!spec.tint,
        tile: spec.tile,
        upright: !!spec.upright,
        positions: [],
        normals: [],
        uvs: [],
        colors: [],
        indices: [],
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private vertex(b: Bucket, p: Vec3, n: Vec3, uv?: [number, number]): void {
    b.positions.push(p[0], p[1], p[2]);
    b.normals.push(n[0], n[1], n[2]);
    let u: number;
    let v: number;
    if (uv) {
      [u, v] = uv;
    } else if (this.uvs) {
      [u, v] = this.uvs(p[0], p[1], p[2]);
    } else {
      // Box projection in world meters: floors and ceilings by x and z, walls along and up.
      const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
      if (ay >= ax && ay >= az) [u, v] = [p[0], p[2]];
      else if (ax >= az) [u, v] = [n[0] > 0 ? p[2] : -p[2], p[1]];
      else [u, v] = [n[2] > 0 ? -p[0] : p[0], p[1]];
    }
    b.uvs.push(u / b.tile, v / b.tile);
    const w = this.wear(p[0], p[1], p[2], n[0], n[1], n[2]);
    if (b.painted) {
      const paint =
        this.paint ?? new Color3(...(SURFACES[b.surface].tint ?? [1, 1, 1])).toLinearSpace();
      b.colors.push(paint.r, paint.g, paint.b, w);
    } else {
      const k = Math.min(1, w);
      b.colors.push(
        w * (GRIME[0] + (1 - GRIME[0]) * k),
        w * (GRIME[1] + (1 - GRIME[1]) * k),
        w * (GRIME[2] + (1 - GRIME[2]) * k),
        1,
      );
    }
  }

  /**
   * A flat quad from `origin` along `u` and `v` (vectors with length), facing `normal`, cut into a
   * grid at the given fractions of u and v (each from 0 to 1), so wear has vertices to vary on.
   */
  quad(
    name: SurfaceName,
    origin: Vec3,
    u: Vec3,
    v: Vec3,
    normal: Vec3,
    us: readonly number[] = [0, 1],
    vs: readonly number[] = [0, 1],
    options?: SurfaceOptions,
  ): void {
    const b = this.bucket(name, options);
    const start = b.positions.length / 3;
    for (const fv of vs) {
      for (const fu of us) {
        this.vertex(
          b,
          [
            origin[0] + u[0] * fu + v[0] * fv,
            origin[1] + u[1] * fu + v[1] * fv,
            origin[2] + u[2] * fu + v[2] * fv,
          ],
          normal,
        );
      }
    }
    // Wound so the face shows on the side `normal` points to: Babylon culls clockwise faces as
    // seen in its left-handed space.
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const flip = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0;
    const row = us.length;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < us.length - 1; i++) {
        const a = start + j * row + i;
        const bb = a + 1;
        const c = a + row + 1;
        const d = a + row;
        if (flip) b.indices.push(a, c, bb, a, d, c);
        else b.indices.push(a, bb, c, a, c, d);
      }
    }
  }

  /**
   * A curved sheet: a grid of points `at(u, v)` gives, each with its own normal, for profiled
   * cladding and deck. Each cell is wound to face its first corner's normal.
   */
  sheet(
    name: SurfaceName,
    us: readonly number[],
    vs: readonly number[],
    at: (u: number, v: number) => [Vec3, Vec3],
    options?: SurfaceOptions,
  ): void {
    const b = this.bucket(name, options);
    const start = b.positions.length / 3;
    const points: Vec3[] = [];
    const normals: Vec3[] = [];
    for (const v of vs) {
      for (const u of us) {
        const [p, n] = at(u, v);
        points.push(p);
        normals.push(n);
        this.vertex(b, p, n);
      }
    }
    const row = us.length;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < us.length - 1; i++) {
        const a = j * row + i;
        const c = crossV(sub(points[a + 1], points[a]), sub(points[a + row], points[a]));
        const n = normals[a];
        const flip = c[0] * n[0] + c[1] * n[1] + c[2] * n[2] > 0;
        const [i0, i1, i2, i3] = [a, a + 1, a + row + 1, a + row].map((k) => start + k);
        if (flip) b.indices.push(i0, i2, i1, i0, i3, i2);
        else b.indices.push(i0, i1, i2, i0, i2, i3);
      }
    }
  }

  /** A triangle, wound to face `normal`. */
  triangle(name: SurfaceName, a: Vec3, b: Vec3, c: Vec3, normal: Vec3, options?: SurfaceOptions) {
    const bucket = this.bucket(name, options);
    const start = bucket.positions.length / 3;
    for (const p of [a, b, c]) this.vertex(bucket, p, normal);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const flip = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0;
    if (flip) bucket.indices.push(start, start + 2, start + 1);
    else bucket.indices.push(start, start + 1, start + 2);
  }

  /**
   * An axis-aligned box from min to max, its edges chamfered by `r` so they catch the light. Faces
   * listed in `skip` (by "-x", "+y" and so on) are left out where they'd never be seen.
   */
  box(
    name: SurfaceName,
    min: Vec3,
    max: Vec3,
    r = 0.008,
    skip: readonly string[] = [],
    options?: SurfaceOptions,
  ): void {
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    r = Math.min(r, ...size.map((s) => s * 0.3));
    const lo = [min[0] + r, min[1] + r, min[2] + r];
    const hi = [max[0] - r, max[1] - r, max[2] - r];
    // The six faces, inset by r.
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [-1, 1]) {
        if (skip.includes(`${sign < 0 ? "-" : "+"}${"xyz"[axis]}`)) continue;
        const a1 = (axis + 1) % 3;
        const a2 = (axis + 2) % 3;
        const origin: Vec3 = [0, 0, 0];
        origin[axis] = sign < 0 ? min[axis] : max[axis];
        origin[a1] = lo[a1];
        origin[a2] = lo[a2];
        const u: Vec3 = [0, 0, 0];
        u[a1] = hi[a1] - lo[a1];
        const v: Vec3 = [0, 0, 0];
        v[a2] = hi[a2] - lo[a2];
        const n: Vec3 = [0, 0, 0];
        n[axis] = sign;
        this.quad(name, origin, u, v, n, [0, 1], [0, 1], options);
      }
    }
    if (r <= 0) return;
    // The twelve bevels along the edges.
    const k = Math.SQRT1_2;
    for (let axis = 0; axis < 3; axis++) {
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      for (const s1 of [-1, 1]) {
        for (const s2 of [-1, 1]) {
          const p: Vec3 = [0, 0, 0];
          p[axis] = lo[axis];
          p[a1] = s1 < 0 ? min[a1] : max[a1];
          p[a2] = s2 < 0 ? lo[a2] : hi[a2];
          const q: Vec3 = [...p];
          q[a1] = s1 < 0 ? lo[a1] : hi[a1];
          q[a2] = s2 < 0 ? min[a2] : max[a2];
          const along: Vec3 = [0, 0, 0];
          along[axis] = hi[axis] - lo[axis];
          const n: Vec3 = [0, 0, 0];
          n[a1] = s1 * k;
          n[a2] = s2 * k;
          this.quad(
            name,
            p,
            along,
            [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
            n,
            [0, 1],
            [0, 1],
            options,
          );
        }
      }
    }
    // The eight corners.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = sx < 0 ? [min[0], lo[0]] : [max[0], hi[0]];
          const y = sy < 0 ? [min[1], lo[1]] : [max[1], hi[1]];
          const z = sz < 0 ? [min[2], lo[2]] : [max[2], hi[2]];
          const s = 1 / Math.sqrt(3);
          this.triangle(
            name,
            [x[0], y[1], z[1]],
            [x[1], y[0], z[1]],
            [x[1], y[1], z[0]],
            [sx * s, sy * s, sz * s],
            options,
          );
        }
      }
    }
  }

  /**
   * A bar of a 2D section (points in order round it, in meters across and up) swept straight from
   * `a` to `b`. `up` says which way the section's second coordinate points. Flat-shaded, with caps
   * if asked. For rails, beams, angles and stringers at any slope.
   */
  bar(
    name: SurfaceName,
    a: Vec3,
    b: Vec3,
    section: readonly (readonly [number, number])[],
    up: Vec3 = [0, 1, 0],
    caps = true,
    options?: SurfaceOptions,
  ): void {
    const d = norm(sub(b, a));
    let side = norm(crossV(up, d));
    if (!Number.isFinite(side[0])) side = norm(crossV([1, 0, 0], d));
    const top = crossV(d, side);
    const at = (p: Vec3, s: readonly [number, number]): Vec3 => [
      p[0] + side[0] * s[0] + top[0] * s[1],
      p[1] + side[1] * s[0] + top[1] * s[1],
      p[2] + side[2] * s[0] + top[2] * s[1],
    ];
    // Which way round the section goes, so normals point out.
    let area = 0;
    for (let i = 0; i < section.length; i++) {
      const [x0, y0] = section[i];
      const [x1, y1] = section[(i + 1) % section.length];
      area += x0 * y1 - x1 * y0;
    }
    const outward = area > 0 ? 1 : -1;
    for (let i = 0; i < section.length; i++) {
      const s0 = section[i];
      const s1 = section[(i + 1) % section.length];
      const ex = s1[0] - s0[0];
      const ey = s1[1] - s0[1];
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const nx = (ey / len) * outward;
      const ny = (-ex / len) * outward;
      const n = norm([
        side[0] * nx + top[0] * ny,
        side[1] * nx + top[1] * ny,
        side[2] * nx + top[2] * ny,
      ]);
      const p0 = at(a, s0);
      const p1 = at(a, s1);
      const q0 = at(b, s0);
      this.quad(name, p0, sub(p1, p0), sub(q0, p0), n, [0, 1], [0, 1], options);
    }
    if (!caps) return;
    for (const [end, n] of [
      [a, scale(d, -1)],
      [b, d],
    ] as const) {
      const c = at(end, centroid(section));
      for (let i = 0; i < section.length; i++) {
        this.triangle(
          name,
          c,
          at(end, section[i]),
          at(end, section[(i + 1) % section.length]),
          n,
          options,
        );
      }
    }
  }

  /** Every bucket as a mesh, with its material; static and frozen. */
  build(scene: Scene, name: string): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [key, b] of this.buckets) {
      if (b.indices.length === 0) continue;
      const mesh = new Mesh(`${name}:${key}`, scene);
      const data = new VertexData();
      data.positions = new Float32Array(b.positions);
      data.normals = new Float32Array(b.normals);
      data.uvs = new Float32Array(b.uvs);
      data.colors = new Float32Array(b.colors);
      data.indices = new Uint32Array(b.indices);
      data.applyToMesh(mesh, false);
      mesh.hasVertexAlpha = false;
      mesh.material = buildingMaterial(scene, b.surface, b.options);
      if (b.painted) mesh.metadata = { ...(mesh.metadata ?? {}), paintFromVertices: true };
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/** The library surface, with the paint taken from vertex colour on meshes that ask for it. */
export function buildingMaterial(
  scene: Scene,
  name: SurfaceName,
  options?: SurfaceOptions,
): PBRMaterial {
  const material = surface(scene, name, options);
  if (SURFACES[name].tint && !painted.has(material)) {
    painted.add(material);
    new VertexPaint(material);
  }
  return material;
}

const painted = new WeakSet<PBRMaterial>();

class VertexPaintDefines extends MaterialDefines {
  VERTEX_PAINT = false;
}

/**
 * For painted surfaces on meshes whose metadata says `paintFromVertices`: the paint is the vertex
 * colour's rgb instead of the material's tint, and the vertex alpha is wear over all of it. Runs
 * after SurfaceTint (priority 190), which has added the material's tint where the bake lets paint
 * show, and the engine, which has multiplied the bake by the vertex rgb: both are undone and redone.
 */
class VertexPaint extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "VertexPaint", 192, new VertexPaintDefines());
    this._enable(true);
  }

  override getClassName(): string {
    return "VertexPaint";
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: VertexPaintDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines.VERTEX_PAINT = !!mesh.metadata?.paintFromVertices;
  }

  override isReadyForSubMesh(): boolean {
    return true;
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_UPDATE_ALPHA: `
          #if defined(VERTEX_PAINT) && defined(ALBEDO) && defined(VERTEXCOLOR)
          {
            let vpPaint = fragmentInputs.vColor.rgb;
            let vpBake = (surfaceAlbedo - uniforms.sfTint * albedoTexture.a) / max(vpPaint, vec3f(0.002));
            surfaceAlbedo = max(vpBake + vpPaint * albedoTexture.a, vec3f(0.0)) * fragmentInputs.vColor.a;
          }
          #endif
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #if defined(VERTEX_PAINT) && defined(ALBEDO) && defined(VERTEXCOLOR)
        {
          vec3 vpPaint = vColor.rgb;
          vec3 vpBake = (surfaceAlbedo - sfTint * albedoTexture.a) / max(vpPaint, vec3(0.002));
          surfaceAlbedo = max(vpBake + vpPaint * albedoTexture.a, vec3(0.0)) * vColor.a;
        }
        #endif
      `,
    };
  }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function crossV(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
}
function centroid(points: readonly (readonly [number, number])[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

/** A hash of a quantised position, 0 to 1: the same on both sides of a seam. */
export function hash3(x: number, y: number, z: number): number {
  let h =
    Math.imul(Math.round(x * 50) | 0, 0x27d4eb2d) ^
    Math.imul(Math.round(y * 50) | 0, 0x165667b1) ^
    Math.imul(Math.round(z * 50) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function latticeHash(i: number, j: number, k: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 3D, 0 to 1, a feature every unit. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (a: number, b: number, c: number) => latticeHash(i + a, j + b, k + c, seed);
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), sx), lerp(h(0, 1, 0), h(1, 1, 0), sx), sy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), sx), lerp(h(0, 1, 1), h(1, 1, 1), sx), sy),
    sz,
  );
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
