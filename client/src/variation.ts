import {
  MaterialDefines,
  MaterialPluginBase,
  type PBRMaterial,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";
import { STOREY } from "../../shared/tiles";

/**
 * Hex tiling, after Mikkelsen, "Practical Real-Time Hex-Tiling" (JCGT 2022): the surface is covered
 * in hexagons, each showing the texture from its own random place, turned by its own angle, and
 * neighbours blend where they meet. Suits textures with no direction or grid: concrete, asphalt,
 * plaster, dirt.
 */
export interface HexTiling {
  kind: "hex";
  /** Hexagons across one repeat of the texture. More hides repeats better but blends more. */
  cells?: number;
  /** 0 keeps the texture upright, 1 turns each hexagon any way. */
  rotate?: number;
  /** How much brighter texels win where hexagons blend, which keeps contrast; 0 to 1. */
  contrast?: number;
  /** How sharp the blend between hexagons is. */
  sharpness?: number;
  /**
   * Shift hexagons only along u, so v keeps its place: for walls whose wear depends on height
   * above the floor. Use with `rotate: 0`.
   */
  keepHeight?: boolean;
}

/**
 * For textures of square cells with a joint on their edges, like floor tiles, ceiling tiles or a
 * slab between saw cuts: every cell in the world shows a random cell of the texture, turned a
 * random way, and since every cell's edges are joints they still meet. Nothing blends.
 */
export interface CellShuffle {
  kind: "cells";
  /** Cells across and up one repeat of the texture; joints lie on their edges. */
  cells: readonly [number, number];
  /**
   * "any" turns cells by quarter turns and mirrors them (for square cells, seen from above);
   * "mirror" only mirrors them left to right, keeping up up for walls; "none" only moves them.
   */
  turn?: "any" | "mirror" | "none";
}

/**
 * For textures in courses, like brick, blocks or planks: every course is cut into runs of random
 * length, each run taken from another course of the texture at a random shift, and a mortar joint is
 * drawn at every cut, copied from the texture's own joints turned on end. Nothing is blended, so the
 * pattern stays crisp.
 */
export interface CourseShuffle {
  kind: "courses";
  /** Courses in one repeat of the texture, up its v; joints lie on their boundaries. */
  rows: number;
  /** Shortest and longest run before a cut, in repeats of the texture. */
  run?: readonly [number, number];
  /** Width of a joint in repeats of the texture. */
  joint?: number;
}

export interface SurfaceVariation {
  sampling?: HexTiling | CourseShuffle | CellShuffle;
  /** Meters across one patch of the slow brightness and roughness drift in world space. */
  patch?: number;
  /** How far brightness drifts, as a fraction. */
  brightness?: number;
  /** How far roughness drifts, as a fraction. */
  roughness?: number;
  /** How much walls darken along their foot, above every storey's floor. */
  grime?: number;
}

/** `?variation=off` shows surfaces as they were, to compare. */
const ENABLED = new URLSearchParams(location.search).get("variation") !== "off";

// Every texture these maps read goes through the same variation, so albedo, normal and ORM stay
// lined up. The maps must share one set of texture coordinates (the same uScale and vScale).
const VARIED_MAPS = "albedo|reflectivity|ambient|microSurface";

const GLSL_DEFINITIONS = `
  vec2 vrUV; vec2 vrDx; vec2 vrDy;
  vec2 vrST0; vec2 vrST1; vec2 vrST2;
  mat2 vrM0 = mat2(1.0); mat2 vrM1 = mat2(1.0); mat2 vrM2 = mat2(1.0);
  vec3 vrW = vec3(1.0, 0.0, 0.0);
  float vrRough = 1.0;

  vec4 vrHash(vec2 p) {
    vec4 p4 = fract(p.xyxy * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
  }
  float vrNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vrHash(i).x, vrHash(i + vec2(1.0, 0.0)).x, f.x),
               mix(vrHash(i + vec2(0.0, 1.0)).x, vrHash(i + vec2(1.0, 1.0)).x, f.x), f.y);
  }
  float vrFbm(vec2 p) {
    return 0.5 * vrNoise(p) + 0.3 * vrNoise(p * 2.03 + 7.1) + 0.2 * vrNoise(p * 4.07 - 3.3);
  }
  mat2 vrTurn(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }

  vec4 vrTap(sampler2D s, vec2 st, mat2 m) { return textureGrad(s, st, m * vrDx, m * vrDy); }
  vec4 variedSample(sampler2D s) {
    vec4 c = vrW.x * vrTap(s, vrST0, vrM0);
    if (vrW.y > 0.0) c += vrW.y * vrTap(s, vrST1, vrM1);
    if (vrW.z > 0.0) c += vrW.z * vrTap(s, vrST2, vrM2);
    return c;
  }
  // A turned tap turns its normals with it: tangent-space x and y go back through the turn.
  vec3 vrNormalTap(sampler2D s, vec2 st, mat2 m) {
    vec3 n = vrTap(s, st, m).xyz * 2.0 - 1.0;
    n.xy = n.xy * m;
    return n;
  }
  vec4 variedNormal(sampler2D s) {
    vec3 n = vrW.x * vrNormalTap(s, vrST0, vrM0);
    if (vrW.y > 0.0) n += vrW.y * vrNormalTap(s, vrST1, vrM1);
    if (vrW.z > 0.0) n += vrW.z * vrNormalTap(s, vrST2, vrM2);
    return vec4(n * 0.5 + 0.5, 1.0);
  }

  #ifdef VARIATION_HEX
  float vrLuma(vec2 st, mat2 m) {
    #ifdef ALBEDO
    return dot(vrTap(albedoSampler, st, m).rgb, vec3(0.299, 0.587, 0.114));
    #else
    return 1.0;
    #endif
  }
  // One corner of the triangle the point is in: its texture placement, as st = m * uv + offset.
  void vrHexCorner(vec2 corner, out vec2 st, out mat2 m) {
    float cells = vrParams.x;
    vec2 centre = mat2(1.0, 0.0, 0.5, 0.8660254) * corner / cells;
    vec4 h = vrHash(corner + 0.5);
    m = vrTurn((h.x * 2.0 - 1.0) * 3.14159265 * vrParams.y);
    #ifdef VARIATION_KEEP_HEIGHT
    st = m * (vrUV - centre) + centre + vec2(h.y, 0.0);
    #else
    st = m * (vrUV - centre) + centre + h.yz;
    #endif
  }
  void vrSetUp() {
    vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (vrUV * vrParams.x);
    vec2 base = floor(skewed);
    vec3 t = vec3(fract(skewed), 0.0);
    t.z = 1.0 - t.x - t.y;
    float s = step(0.0, -t.z);
    float s2 = 2.0 * s - 1.0;
    vec3 w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
    vrHexCorner(base + vec2(s, s), vrST0, vrM0);
    vrHexCorner(base + vec2(s, 1.0 - s), vrST1, vrM1);
    vrHexCorner(base + vec2(1.0 - s, s), vrST2, vrM2);
    vec3 luma = vec3(vrLuma(vrST0, vrM0), vrLuma(vrST1, vrM1), vrLuma(vrST2, vrM2));
    vec3 weight = mix(vec3(1.0), luma, vrParams.z) * pow(max(w, vec3(0.0)), vec3(vrParams.w));
    vrW = weight / max(weight.x + weight.y + weight.z, 1e-5);
  }
  #endif

  #ifdef VARIATION_COURSES
  void vrSetUp() {
    float rows = vrParams.x;
    float row = floor(vrUV.y * rows);
    vec4 hr = vrHash(vec2(row, 91.0));
    float run = mix(vrParams.y, vrParams.z, hr.x);
    float along = vrUV.x / run + hr.y;
    float piece = floor(along);
    vec4 hp = vrHash(vec2(row, piece) + 0.5);
    vrST0 = vrUV + vec2(hp.y, floor(hp.x * rows) / rows);
    // Signed distance from the nearest cut, and a horizontal joint of the texture to copy there.
    float cut = (floor(along + 0.5) - hr.y) * run;
    float d = vrUV.x - cut;
    float halfWidth = vrParams.w;
    float joint = 1.0 - smoothstep(0.5 * halfWidth, halfWidth, abs(d));
    if (joint > 0.0) {
      vrM1 = mat2(0.0, 1.0, -1.0, 0.0); // a quarter turn stands the joint on end
      float source = floor(hp.z * rows) / rows;
      vrST1 = vrM1 * vrUV + vec2(hp.w, source - cut);
      vrW = vec3(1.0 - joint, joint, 0.0);
    }
  }
  #endif

  #ifdef VARIATION_CELLS
  // Quarter turns and mirrors keep a square cell's edges on its edges, so its joints still meet.
  void vrSetUp() {
    vec2 n = vrParams.xy;
    vec2 g = vrUV * n;
    vec2 here = floor(g);
    vec4 h = vrHash(here + 0.5);
    float turns = vrParams.z > 1.5 ? floor(h.x * 4.0) : 0.0;
    float a = turns * 1.57079633;
    mat2 m = mat2(cos(a), sin(a), -sin(a), cos(a));
    if (vrParams.z > 0.5 && h.w > 0.5) m = m * mat2(-1.0, 0.0, 0.0, 1.0);
    vrM0 = m;
    vrST0 = (floor(h.yz * n) + 0.5 + m * (g - here - 0.5)) / n;
  }
  #endif
`;

const GLSL_MAIN_BEGIN = `
  #ifdef ALBEDO
  vrUV = vAlbedoUV;
  #endif
  vrDx = dFdx(vrUV);
  vrDy = dFdy(vrUV);
  vrST0 = vrUV;
  #if defined(VARIATION_HEX) || defined(VARIATION_COURSES) || defined(VARIATION_CELLS)
  vrSetUp();
  #endif
`;

const GLSL_BEFORE_LIGHTS = `
  {
    vec3 n = abs(vNormalW);
    vec2 place = n.y > 0.5 ? vPositionW.xz : (n.x > 0.5 ? vPositionW.zy : vPositionW.xy);
    float drift = vrFbm(place / vrMacro.x);
    float upright = 1.0 - smoothstep(0.3, 0.6, n.y);
    float aboveFloor = mod(vPositionW.y + 0.01, ${STOREY.toFixed(1)});
    float grime = vrMacro.w * upright * (1.0 - smoothstep(0.0, 0.7, aboveFloor))
                * mix(0.4, 1.0, vrFbm(place / 1.3 + 19.0));
    surfaceAlbedo *= mix(1.0 - vrMacro.y, 1.0 + vrMacro.y, drift) * (1.0 - grime);
    vrRough = mix(1.0 - vrMacro.z, 1.0 + vrMacro.z, vrFbm(place / (0.6 * vrMacro.x) + 41.0)) + grime * 0.5;
  }
`;

const WGSL_DEFINITIONS = `
  var<private> vrUV: vec2f;
  var<private> vrDx: vec2f;
  var<private> vrDy: vec2f;
  var<private> vrST0: vec2f;
  var<private> vrST1: vec2f;
  var<private> vrST2: vec2f;
  var<private> vrM0: mat2x2f = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var<private> vrM1: mat2x2f = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var<private> vrM2: mat2x2f = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var<private> vrW: vec3f = vec3f(1.0, 0.0, 0.0);
  var<private> vrRough: f32 = 1.0;

  fn vrHash(p: vec2f) -> vec4f {
    var p4 = fract(p.xyxy * vec4f(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
  }
  fn vrNoise(p: vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vrHash(i).x, vrHash(i + vec2f(1.0, 0.0)).x, f.x),
               mix(vrHash(i + vec2f(0.0, 1.0)).x, vrHash(i + vec2f(1.0, 1.0)).x, f.x), f.y);
  }
  fn vrFbm(p: vec2f) -> f32 {
    return 0.5 * vrNoise(p) + 0.3 * vrNoise(p * 2.03 + 7.1) + 0.2 * vrNoise(p * 4.07 - 3.3);
  }
  fn vrTurn(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

  fn vrTap(t: texture_2d<f32>, s: sampler, st: vec2f, m: mat2x2f) -> vec4f {
    return textureSampleGrad(t, s, st, m * vrDx, m * vrDy);
  }
  fn variedSample(t: texture_2d<f32>, s: sampler) -> vec4f {
    var c = vrW.x * vrTap(t, s, vrST0, vrM0);
    if (vrW.y > 0.0) { c += vrW.y * vrTap(t, s, vrST1, vrM1); }
    if (vrW.z > 0.0) { c += vrW.z * vrTap(t, s, vrST2, vrM2); }
    return c;
  }
  fn vrNormalTap(t: texture_2d<f32>, s: sampler, st: vec2f, m: mat2x2f) -> vec3f {
    var n = vrTap(t, s, st, m).xyz * 2.0 - 1.0;
    let xy = n.xy * m;
    return vec3f(xy, n.z);
  }
  fn variedNormal(t: texture_2d<f32>, s: sampler) -> vec4f {
    var n = vrW.x * vrNormalTap(t, s, vrST0, vrM0);
    if (vrW.y > 0.0) { n += vrW.y * vrNormalTap(t, s, vrST1, vrM1); }
    if (vrW.z > 0.0) { n += vrW.z * vrNormalTap(t, s, vrST2, vrM2); }
    return vec4f(n * 0.5 + 0.5, 1.0);
  }

  #ifdef VARIATION_HEX
  fn vrLuma(st: vec2f, m: mat2x2f) -> f32 {
    #ifdef ALBEDO
    return dot(vrTap(albedoSampler, albedoSamplerSampler, st, m).rgb, vec3f(0.299, 0.587, 0.114));
    #else
    return 1.0;
    #endif
  }
  struct VrCorner { st: vec2f, m: mat2x2f, }
  fn vrHexCorner(corner: vec2f) -> VrCorner {
    let cells = uniforms.vrParams.x;
    let centre = mat2x2f(1.0, 0.0, 0.5, 0.8660254) * corner / cells;
    let h = vrHash(corner + 0.5);
    let m = vrTurn((h.x * 2.0 - 1.0) * 3.14159265 * uniforms.vrParams.y);
    #ifdef VARIATION_KEEP_HEIGHT
    return VrCorner(m * (vrUV - centre) + centre + vec2f(h.y, 0.0), m);
    #else
    return VrCorner(m * (vrUV - centre) + centre + h.yz, m);
    #endif
  }
  fn vrSetUp() {
    let skewed = mat2x2f(1.0, 0.0, -0.57735027, 1.15470054) * (vrUV * uniforms.vrParams.x);
    let base = floor(skewed);
    var t = vec3f(fract(skewed), 0.0);
    t.z = 1.0 - t.x - t.y;
    let s = step(0.0, -t.z);
    let s2 = 2.0 * s - 1.0;
    let w = vec3f(-t.z * s2, s - t.y * s2, s - t.x * s2);
    let c0 = vrHexCorner(base + vec2f(s, s));
    let c1 = vrHexCorner(base + vec2f(s, 1.0 - s));
    let c2 = vrHexCorner(base + vec2f(1.0 - s, s));
    vrST0 = c0.st; vrM0 = c0.m;
    vrST1 = c1.st; vrM1 = c1.m;
    vrST2 = c2.st; vrM2 = c2.m;
    let luma = vec3f(vrLuma(vrST0, vrM0), vrLuma(vrST1, vrM1), vrLuma(vrST2, vrM2));
    let weight = mix(vec3f(1.0), luma, uniforms.vrParams.z) * pow(max(w, vec3f(0.0)), vec3f(uniforms.vrParams.w));
    vrW = weight / max(weight.x + weight.y + weight.z, 1e-5);
  }
  #endif

  #ifdef VARIATION_COURSES
  fn vrSetUp() {
    let rows = uniforms.vrParams.x;
    let row = floor(vrUV.y * rows);
    let hr = vrHash(vec2f(row, 91.0));
    let run = mix(uniforms.vrParams.y, uniforms.vrParams.z, hr.x);
    let along = vrUV.x / run + hr.y;
    let piece = floor(along);
    let hp = vrHash(vec2f(row, piece) + 0.5);
    vrST0 = vrUV + vec2f(hp.y, floor(hp.x * rows) / rows);
    let cut = (floor(along + 0.5) - hr.y) * run;
    let d = vrUV.x - cut;
    let halfWidth = uniforms.vrParams.w;
    let joint = 1.0 - smoothstep(0.5 * halfWidth, halfWidth, abs(d));
    if (joint > 0.0) {
      vrM1 = mat2x2f(0.0, 1.0, -1.0, 0.0);
      let source = floor(hp.z * rows) / rows;
      vrST1 = vrM1 * vrUV + vec2f(hp.w, source - cut);
      vrW = vec3f(1.0 - joint, joint, 0.0);
    }
  }
  #endif

  #ifdef VARIATION_CELLS
  fn vrSetUp() {
    let n = uniforms.vrParams.xy;
    let g = vrUV * n;
    let here = floor(g);
    let h = vrHash(here + 0.5);
    var turns = 0.0;
    if (uniforms.vrParams.z > 1.5) { turns = floor(h.x * 4.0); }
    let a = turns * 1.57079633;
    var m = mat2x2f(cos(a), sin(a), -sin(a), cos(a));
    if (uniforms.vrParams.z > 0.5 && h.w > 0.5) { m = m * mat2x2f(-1.0, 0.0, 0.0, 1.0); }
    vrM0 = m;
    vrST0 = (floor(h.yz * n) + 0.5 + m * (g - here - 0.5)) / n;
  }
  #endif
`;

const WGSL_MAIN_BEGIN = `
  #ifdef ALBEDO
  vrUV = fragmentInputs.vAlbedoUV;
  #endif
  vrDx = dpdx(vrUV);
  vrDy = dpdy(vrUV);
  vrST0 = vrUV;
  #if defined(VARIATION_HEX) || defined(VARIATION_COURSES) || defined(VARIATION_CELLS)
  vrSetUp();
  #endif
`;

const WGSL_BEFORE_LIGHTS = `
  {
    let vrN = abs(fragmentInputs.vNormalW);
    let vrP = fragmentInputs.vPositionW;
    var place = vrP.xy;
    if (vrN.y > 0.5) { place = vrP.xz; } else if (vrN.x > 0.5) { place = vrP.zy; }
    let drift = vrFbm(place / uniforms.vrMacro.x);
    let upright = 1.0 - smoothstep(0.3, 0.6, vrN.y);
    let storey = ${STOREY.toFixed(1)};
    let aboveFloor = (vrP.y + 0.01) - storey * floor((vrP.y + 0.01) / storey);
    let grime = uniforms.vrMacro.w * upright * (1.0 - smoothstep(0.0, 0.7, aboveFloor))
              * mix(0.4, 1.0, vrFbm(place / 1.3 + 19.0));
    surfaceAlbedo *= mix(1.0 - uniforms.vrMacro.y, 1.0 + uniforms.vrMacro.y, drift) * (1.0 - grime);
    vrRough = mix(1.0 - uniforms.vrMacro.z, 1.0 + uniforms.vrMacro.z, vrFbm(place / (0.6 * uniforms.vrMacro.x) + 41.0)) + grime * 0.5;
  }
`;

class VariationDefines extends MaterialDefines {
  VARIATION_HEX = false;
  VARIATION_COURSES = false;
  VARIATION_CELLS = false;
  VARIATION_KEEP_HEIGHT = false;
}

/**
 * Breaks up the repeats of a tiled PBR surface: a different way of reading its textures (hex tiling
 * or course shuffling), and slow drift in brightness and roughness over world space on top.
 */
class SurfaceVariationPlugin extends MaterialPluginBase {
  private readonly params: [number, number, number, number];
  private readonly macro: [number, number, number, number];

  constructor(
    material: PBRMaterial,
    private readonly options: SurfaceVariation,
  ) {
    super(material, "SurfaceVariation", 200, new VariationDefines());
    const { sampling } = options;
    if (sampling?.kind === "hex") {
      const { cells = 2, rotate = 1, contrast = 0.6, sharpness = 6 } = sampling;
      this.params = [cells, rotate, contrast, sharpness];
    } else if (sampling?.kind === "courses") {
      const { rows, run = [0.35, 0.9], joint = 0.006 } = sampling;
      this.params = [rows, run[0], run[1], joint];
    } else if (sampling?.kind === "cells") {
      const turn = { none: 0, mirror: 1, any: 2 }[sampling.turn ?? "any"];
      this.params = [sampling.cells[0], sampling.cells[1], turn, 0];
    } else {
      this.params = [1, 0, 0, 1];
    }
    const { patch = 9, brightness = 0.15, roughness = 0.15, grime = 0 } = options;
    this.macro = [patch, brightness, roughness, grime];
    this._enable(true);
  }

  override getClassName(): string {
    return "SurfaceVariationPlugin";
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: VariationDefines): void {
    const { sampling } = this.options;
    defines.VARIATION_HEX = sampling?.kind === "hex";
    defines.VARIATION_COURSES = sampling?.kind === "courses";
    defines.VARIATION_CELLS = sampling?.kind === "cells";
    defines.VARIATION_KEEP_HEIGHT = sampling?.kind === "hex" && !!sampling.keepHeight;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "vrParams", size: 4, type: "vec4" },
        { name: "vrMacro", size: 4, type: "vec4" },
      ],
      fragment: "uniform vec4 vrParams;\nuniform vec4 vrMacro;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat4("vrParams", ...this.params);
    ubo.updateFloat4("vrMacro", ...this.macro);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    // The bump key comes first so that the normal map is read by variedNormal, not variedSample.
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: WGSL_DEFINITIONS,
        CUSTOM_FRAGMENT_MAIN_BEGIN: WGSL_MAIN_BEGIN,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: WGSL_BEFORE_LIGHTS,
        "!TEXRD\\(bumpSampler,bumpSamplerSampler,fragmentInputs\\.vBumpUV\\+uvOffset\\)(;?)":
          "variedNormal(bumpSampler,bumpSamplerSampler)$1",
        [`!TEXRD\\((${VARIED_MAPS})Sampler,\\w+,fragmentInputs\\.v\\w+UV\\+uvOffset\\)(;?)`]:
          "variedSample($1Sampler,$1SamplerSampler)$2",
        "!var microSurface: f32=reflectivityOut\\.microSurface;var roughness: f32=reflectivityOut\\.roughness;":
          "var roughness: f32=clamp(reflectivityOut.roughness*vrRough,0.0,1.0);var microSurface: f32=1.0-roughness;",
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFINITIONS,
      CUSTOM_FRAGMENT_MAIN_BEGIN: GLSL_MAIN_BEGIN,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: GLSL_BEFORE_LIGHTS,
      "!TEXRD\\(bumpSampler,vBumpUV\\+uvOffset\\)(;?)": "variedNormal(bumpSampler)$1",
      [`!TEXRD\\((${VARIED_MAPS})Sampler,v\\w+UV\\+uvOffset\\)(;?)`]: "variedSample($1Sampler)$2",
      "!float microSurface=reflectivityOut\\.microSurface;float roughness=reflectivityOut\\.roughness;":
        "float roughness=clamp(reflectivityOut.roughness*vrRough,0.0,1.0);float microSurface=1.0-roughness;",
    };
  }
}

/** Gives a tiled PBR surface variation; see SurfaceVariation. Does nothing under `?variation=off`. */
export function addSurfaceVariation(material: PBRMaterial, options: SurfaceVariation): void {
  if (ENABLED) new SurfaceVariationPlugin(material, options);
}
