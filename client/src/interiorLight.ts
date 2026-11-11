import {
  type AbstractMesh,
  Color3,
  Constants,
  MaterialDefines,
  MaterialPluginBase,
  Matrix,
  type Mesh,
  MeshBuilder,
  PBRMaterial,
  RawTexture,
  RawTexture3D,
  type Scene,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";
import { ITEM_KINDS } from "../../shared/constants";
import type { Level, LightSpawn } from "../../shared/level";
import { SCREEN_CABINET, type Side } from "../../shared/tiles";
import { drawInstances } from "./graphics";
import { type BakeInput, type BakeOutput, type BakeSource, bakeLight } from "./lightBake";
import type { World } from "./scene";
import { tunables } from "./tuning";

/**
 * Interior lighting, for levels with light fittings (`Level.lights`): each room lit by its own
 * tubes, bulbs and emergency lamps, light spilling through doorways and down stairwells, flickering
 * and dead fittings, and rooms with none left dark for the flashlight.
 *
 * The light is baked at load, in a worker, into a grid of voxels over the building (lightBake.ts),
 * which never lets light through walls, floors or ceilings, and read back in every PBR material by a
 * plugin. It takes no scene lights, so a material's few (MAX_LIGHTS) stay for flashlights. The
 * fittings that change, flickering ones and TV screens, are kept apart in the bake and scaled each
 * frame by their brightness, from a small texture of every fitting's light. The same texture drives
 * the fittings' glow: `glow()` makes any mesh's material glow with the fitting it belongs to.
 *
 * `?interior=off` skips it all, to compare against the even light it replaces.
 */

/** What the rest of the page can do with interior lighting. */
export interface InteriorLighting {
  /**
   * How bright fitting `light` (an index into `Level.lights`) is right now: 0 when off or dead,
   * about 1 when on, times its power and the room's light level.
   */
  brightness(light: number): number;
  /**
   * Makes `mesh`'s material glow as the fitting it belongs to does, flickering and dying with it:
   * its emissive colour (and texture) is multiplied by that fitting's brightness, and with `tint`
   * by its colour too. For a mesh drawn as thin instances, pass one fitting per instance; else
   * one for the whole mesh. The material must be a PBRMaterial; set this before it's first drawn.
   */
  glow(mesh: Mesh, lights: number | readonly number[], options?: { tint?: boolean }): void;
  /** The room's light level, 0 to 1, as the dimmer (and a game) leave it. */
  setLevel(level: number): void;
  /** Settles when the first bake is in. */
  readonly ready: Promise<void>;
  /** What the bake holds at the voxel round a point, for debugging. */
  probe(x: number, y: number, z: number): { a: number[]; b: number[] } | undefined;
}

const ENABLED = new URLSearchParams(location.search).get("interior") !== "off";

/** Meters a voxel; walls of tiled levels lie on their boundaries. */
const VOXEL = 0.5;
const MAX_VOXELS = 4_000_000;
/** Fittings a row of the lights texture, and its rows a fitting. */
const ROW = 256;

/** How the shader reads the light: the even values update the uniforms as they change. */
const LOOK = tunables("Rendering/Interior light", {
  strength: { value: 1, min: 0, max: 4, hint: "All the fittings' light" },
  levelCurve: {
    value: 0.5,
    min: 0.2,
    max: 2,
    hint: "The room's light level to this power scales it: below 1 dims gently",
  },
  minimum: {
    value: 0.025,
    min: 0,
    max: 0.1,
    step: 0.001,
    hint: "Light everywhere, so the dark is never a void",
  },
  directional: {
    value: 1.6,
    min: 0,
    max: 3,
    hint: "How much brighter faces turned to the light are than those turned away",
  },
  wrap: {
    value: 0.15,
    min: 0,
    max: 1,
    hint: "Light faces turned away from it still take, as a ceiling round a tube does",
  },
  normalOffset: {
    value: 0.3,
    min: 0,
    max: 1,
    hint: "Meters off a surface the light is read, out of the wall it's on",
  },
  specular: { value: 1, min: 0, max: 4, hint: "Highlights of the fittings on glossy floors" },
  reflections: {
    value: 1.5,
    min: 0,
    max: 10,
    hint: "How fast sky reflections come back with the light: dark rooms don't shine",
  },
  reflectionFloor: { value: 0.02, min: 0, max: 1, hint: "Sky reflections left in the dark" },
  skyAmbient: { value: 0, min: 0, max: 1, hint: "The sky's soft light, where it's lit" },
});

/** How bright each kind of fitting is, and how far its light reaches; changing these re-bakes. */
const BAKE = tunables(
  "Rendering/Interior bake",
  {
    tube: { value: 3, min: 0, max: 30, hint: "An ordinary ceiling tube, of power 1" },
    bulb: { value: 3, min: 0, max: 30 },
    emergency: { value: 2, min: 0, max: 30 },
    exit: { value: 0.6, min: 0, max: 10 },
    screen: { value: 1.2, min: 0, max: 10, hint: "A TV showing static" },
    reach: { value: 9, min: 2, max: 20, hint: "Meters a tube's light carries, before bounce" },
    bounce: { value: 0.5, min: 0, max: 3, hint: "Light off walls and floors, next to direct" },
    spread: { value: 3, min: 0.5, max: 8, hint: "Meters bounce light carries into the dark" },
  },
  () => rebake?.(),
);

const FITTINGS = tunables("Look/Light fittings", {
  glow: { value: 6, min: 0, max: 30, hint: "How bright a working fitting glows" },
});

/** A TV's light: cold, from in front of its screen. */
const SCREEN_COLOR: [number, number, number] = [0.55, 0.65, 0.95];
const TURN: Record<Side, number> = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 };

/** What every material's plugin reads: set before any plugin exists, and refilled by each bake. */
const shared: {
  a?: RawTexture3D;
  b?: RawTexture3D;
  lights?: RawTexture;
  origin: [number, number, number];
  dims: [number, number, number];
  size: number;
  level: number;
} = { origin: [0, 0, 0], dims: [1, 1, 1], size: VOXEL, level: 1 };

const GLSL_DEFINITIONS = `
  uniform highp sampler3D ilVolumeA;
  uniform highp sampler3D ilVolumeB;
  uniform highp sampler2D ilLights;

  vec3 ilLightOf(int i) { return texelFetch(ilLights, ivec2(i % ${ROW}, 2 * (i / ${ROW})), 0).rgb; }

  // The light at p, blended from the eight voxels round it, leaving out any on the far side of a
  // closed edge from the one that counts most: light never blends through a wall.
  void ilSample(vec3 p, out vec3 light, out vec3 dir) {
    vec3 u = (p - ilOrigin.xyz) * ilOrigin.w - 0.5;
    vec3 base = floor(u);
    vec3 f = u - base;
    ivec3 b = ivec3(base);
    ivec3 dims = ivec3(ilDims.xyz);
    vec4 ca[8];
    vec4 cb[8];
    float w[8];
    int m[8];
    int best = -1;
    float bestW = -1.0;
    for (int c = 0; c < 8; c++) {
      ivec3 o = ivec3(c & 1, (c >> 1) & 1, (c >> 2) & 1);
      ivec3 q = b + o;
      vec3 t = mix(1.0 - f, f, vec3(o));
      w[c] = t.x * t.y * t.z;
      m[c] = -1;
      ca[c] = vec4(0.0);
      cb[c] = vec4(0.0);
      if (any(lessThan(q, ivec3(0))) || any(greaterThanEqual(q, dims))) continue;
      ca[c] = texelFetch(ilVolumeA, q, 0);
      if (ca[c].w < 0.0) continue;
      cb[c] = texelFetch(ilVolumeB, q, 0);
      m[c] = int(ca[c].w + 0.5);
      if (w[c] > bestW) { bestW = w[c]; best = c; }
    }
    light = vec3(0.0);
    dir = vec3(0.0);
    if (best < 0) return;
    float total = 0.0;
    for (int c = 0; c < 8; c++) {
      if (m[c] < 0) continue;
      int diff = c ^ best;
      bool open = true;
      for (int a = 0; a < 3; a++) {
        int bit = 1 << a;
        if ((diff & bit) == 0) continue;
        int lowBest = m[best & ~bit];
        int lowHere = m[c & ~bit];
        open = open && lowBest >= 0 && ((lowBest >> a) & 1) == 1 && lowHere >= 0 && ((lowHere >> a) & 1) == 1;
      }
      if (!open) continue;
      int index = m[c] >> 3;
      vec3 l = ca[c].rgb;
      if (index > 0) l += cb[c].w * ilLightOf(index - 1);
      light += w[c] * l;
      dir += w[c] * cb[c].xyz;
      total += w[c];
    }
    light /= max(total, 1e-5);
    dir /= max(total, 1e-5);
  }
`;

const GLSL_LIGHT = `
  {
    vec3 ilNormal = normalize(vNormalW);
    vec3 ilLight;
    vec3 ilDir;
    ilSample(vPositionW + ilNormal * ilParams.z, ilLight, ilDir);
    ilLight *= ilParams.x;
    vec3 ilIrradiance = ilLight * max(ilParams.y, 1.0 + ilParams.w * dot(normalW, ilDir)) + ilMinimum.rgb;
    finalDiffuse += ilIrradiance * surfaceAlbedo * aoOut.ambientOcclusionColor;
    float ilOneWay = length(ilDir);
    if (ilOneWay > 0.01 && ilShade.x > 0.0) {
      vec3 ilL = ilDir / ilOneWay;
      vec3 ilH = normalize(ilL + viewDirectionW);
      float ilNdotL = max(dot(normalW, ilL), 0.0);
      float ilNdotH = max(dot(normalW, ilH), 0.0);
      float ilRough = max(1.0 - microSurface, 0.1);
      float ilA2 = ilRough * ilRough * ilRough * ilRough;
      float ilDenom = ilNdotH * ilNdotH * (ilA2 - 1.0) + 1.0;
      float ilD = min(ilA2 / (3.14159 * ilDenom * ilDenom), 40.0);
      finalDiffuse += min(ilD * 0.25 * ilNdotL * ilOneWay * ilShade.x * ilLight * specularEnvironmentR0, vec3(40.0));
    }
    #ifdef REFLECTION
    float ilLit = clamp(dot(ilLight, vec3(0.2126, 0.7152, 0.0722)) * ilShade.y, 0.0, 1.0);
    finalIrradiance *= ilLit * ilShade.z;
    finalRadianceScaled *= max(ilLit, ilShade.w);
    #endif
  }
`;

const WGSL_DEFINITIONS = `
  var ilVolumeA: texture_3d<f32>;
  var ilVolumeB: texture_3d<f32>;
  var ilLights: texture_2d<f32>;

  fn ilLightOf(i: i32) -> vec3f {
    return textureLoad(ilLights, vec2i(i % ${ROW}, 2 * (i / ${ROW})), 0).rgb;
  }

  struct IlSample { light: vec3f, dir: vec3f, }

  fn ilSample(p: vec3f) -> IlSample {
    let u = (p - uniforms.ilOrigin.xyz) * uniforms.ilOrigin.w - 0.5;
    let base = floor(u);
    let f = u - base;
    let b = vec3i(base);
    let dims = vec3i(uniforms.ilDims.xyz);
    var ca: array<vec4f, 8>;
    var cb: array<vec4f, 8>;
    var w: array<f32, 8>;
    var m: array<i32, 8>;
    var best = -1;
    var bestW = -1.0;
    for (var c = 0; c < 8; c++) {
      let o = vec3i(c & 1, (c >> 1u) & 1, (c >> 2u) & 1);
      let q = b + o;
      let t = mix(1.0 - f, f, vec3f(o));
      w[c] = t.x * t.y * t.z;
      m[c] = -1;
      if (any(q < vec3i(0)) || any(q >= dims)) { continue; }
      ca[c] = textureLoad(ilVolumeA, q, 0);
      if (ca[c].w < 0.0) { continue; }
      cb[c] = textureLoad(ilVolumeB, q, 0);
      m[c] = i32(ca[c].w + 0.5);
      if (w[c] > bestW) { bestW = w[c]; best = c; }
    }
    var result: IlSample;
    result.light = vec3f(0.0);
    result.dir = vec3f(0.0);
    if (best < 0) { return result; }
    var total = 0.0;
    for (var c = 0; c < 8; c++) {
      if (m[c] < 0) { continue; }
      let diff = c ^ best;
      var open = true;
      for (var a = 0u; a < 3u; a++) {
        let bit = 1 << a;
        if ((diff & bit) == 0) { continue; }
        let lowBest = m[best & ~bit];
        let lowHere = m[c & ~bit];
        open = open && lowBest >= 0 && ((lowBest >> a) & 1) == 1 && lowHere >= 0 && ((lowHere >> a) & 1) == 1;
      }
      if (!open) { continue; }
      let index = m[c] >> 3u;
      var l = ca[c].rgb;
      if (index > 0) { l += cb[c].w * ilLightOf(index - 1); }
      result.light += w[c] * l;
      result.dir += w[c] * cb[c].xyz;
      total += w[c];
    }
    result.light /= max(total, 1e-5);
    result.dir /= max(total, 1e-5);
    return result;
  }
`;

const WGSL_LIGHT = `
  {
    let ilNormal = normalize(fragmentInputs.vNormalW);
    let ilFound = ilSample(fragmentInputs.vPositionW + ilNormal * uniforms.ilParams.z);
    let ilLight = ilFound.light * uniforms.ilParams.x;
    let ilDir = ilFound.dir;
    let ilIrradiance = ilLight * max(uniforms.ilParams.y, 1.0 + uniforms.ilParams.w * dot(normalW, ilDir)) + uniforms.ilMinimum.rgb;
    finalDiffuse += ilIrradiance * surfaceAlbedo * aoOut.ambientOcclusionColor;
    let ilOneWay = length(ilDir);
    if (ilOneWay > 0.01 && uniforms.ilShade.x > 0.0) {
      let ilL = ilDir / ilOneWay;
      let ilH = normalize(ilL + viewDirectionW);
      let ilNdotL = max(dot(normalW, ilL), 0.0);
      let ilNdotH = max(dot(normalW, ilH), 0.0);
      let ilRough = max(1.0 - microSurface, 0.1);
      let ilA2 = ilRough * ilRough * ilRough * ilRough;
      let ilDenom = ilNdotH * ilNdotH * (ilA2 - 1.0) + 1.0;
      let ilD = min(ilA2 / (3.14159 * ilDenom * ilDenom), 40.0);
      finalDiffuse += min(ilD * 0.25 * ilNdotL * ilOneWay * uniforms.ilShade.x * ilLight * specularEnvironmentR0, vec3f(40.0));
    }
    #ifdef REFLECTION
    let ilLit = clamp(dot(ilLight, vec3f(0.2126, 0.7152, 0.0722)) * uniforms.ilShade.y, 0.0, 1.0);
    finalIrradiance *= ilLit * uniforms.ilShade.z;
    finalRadianceScaled *= max(ilLit, uniforms.ilShade.w);
    #endif
  }
`;

/**
 * A plugin added to a material that has already laid out its uniforms (one cloned from a model,
 * say) needs them laid out again: Babylon does that before it counts the new plugin in.
 */
function rebuildUniforms(material: PBRMaterial) {
  const inner = material as unknown as { _createUniformBuffer(): void };
  material.resetDrawCache();
  inner._createUniformBuffer();
}

/** Interior light in a PBR material, from the baked volume; see the module's comment. */
class InteriorLightPlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "InteriorLight", 220);
    // Cloned materials get their own when they're added to the scene: Babylon can't find this
    // class by name to copy it.
    this.doNotSerialize = true;
    this._enable(true);
    rebuildUniforms(material);
  }

  override getClassName(): string {
    return "InteriorLightPlugin";
  }

  override isCompatible(): boolean {
    return true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("ilVolumeA", "ilVolumeB", "ilLights");
  }

  override getUniforms(shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL) {
    const names = ["ilOrigin", "ilDims", "ilParams", "ilShade", "ilMinimum"];
    return {
      ubo: names.map((name) => ({ name, size: 4, type: "vec4" })),
      fragment: names
        .map((name) =>
          shaderLanguage === ShaderLanguage.WGSL
            ? `uniform ${name}: vec4f;`
            : `uniform vec4 ${name};`,
        )
        .join("\n"),
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const [ox, oy, oz] = shared.origin;
    const [nx, ny, nz] = shared.dims;
    ubo.updateFloat4("ilOrigin", ox, oy, oz, 1 / shared.size);
    ubo.updateFloat4("ilDims", nx, ny, nz, 0);
    ubo.updateFloat4(
      "ilParams",
      LOOK.strength * shared.level ** LOOK.levelCurve,
      LOOK.wrap,
      LOOK.normalOffset,
      LOOK.directional,
    );
    ubo.updateFloat4(
      "ilShade",
      LOOK.specular,
      LOOK.reflections,
      LOOK.skyAmbient,
      LOOK.reflectionFloor,
    );
    // A little cold, as moonlight from nowhere.
    const low = LOOK.minimum;
    ubo.updateFloat4("ilMinimum", low * 0.8, low * 0.9, low * 1.15, 0);
    ubo.setTexture("ilVolumeA", shared.a ?? null);
    ubo.setTexture("ilVolumeB", shared.b ?? null);
    ubo.setTexture("ilLights", shared.lights ?? null);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: WGSL_DEFINITIONS,
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: WGSL_LIGHT,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFINITIONS,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: GLSL_LIGHT,
    };
  }
}

class GlowDefines extends MaterialDefines {
  FIXTURE_GLOW = false;
}

/** The per-vertex or per-instance attribute naming the fitting a glowing mesh belongs to. */
const FIXTURE = "fixture";

/** A material that glows with the fitting each of its meshes (or instances) belongs to. */
class FixtureGlowPlugin extends MaterialPluginBase {
  constructor(
    material: PBRMaterial,
    private readonly tint: boolean,
  ) {
    super(material, "FixtureGlow", 230, new GlowDefines());
    this.doNotSerialize = true;
    this._enable(true);
    rebuildUniforms(material);
  }

  override getClassName(): string {
    return "FixtureGlowPlugin";
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: GlowDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines.FIXTURE_GLOW = mesh.isVerticesDataPresent(FIXTURE);
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(FIXTURE)) attributes.push(FIXTURE);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("fgLights");
  }

  override getUniforms(shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: [{ name: "fgParams", size: 4, type: "vec4" }],
      fragment:
        shaderLanguage === ShaderLanguage.WGSL
          ? "uniform fgParams: vec4f;"
          : "uniform vec4 fgParams;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat4(
      "fgParams",
      FITTINGS.glow * shared.level ** LOOK.levelCurve,
      this.tint ? 1 : 0,
      0,
      0,
    );
    ubo.setTexture("fgLights", shared.lights ?? null);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderLanguage === ShaderLanguage.WGSL) {
      if (shaderType === "vertex") {
        return {
          CUSTOM_VERTEX_DEFINITIONS: `
            #ifdef FIXTURE_GLOW
            attribute ${FIXTURE}: f32;
            varying vFixture: f32;
            #endif
          `,
          CUSTOM_VERTEX_MAIN_END: `
            #ifdef FIXTURE_GLOW
            vertexOutputs.vFixture = vertexInputs.${FIXTURE};
            #endif
          `,
        };
      }
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `
          #ifdef FIXTURE_GLOW
          varying vFixture: f32;
          var fgLights: texture_2d<f32>;
          #endif
        `,
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
          #ifdef FIXTURE_GLOW
          {
            let fgIndex = i32(fragmentInputs.vFixture + 0.5);
            let fgTexel = textureLoad(fgLights, vec2i(fgIndex % ${ROW}, 2 * (fgIndex / ${ROW}) + 1), 0);
            let fgColor = select(vec3f(fgTexel.a), fgTexel.rgb, uniforms.fgParams.y > 0.5);
            finalEmissive *= fgColor * uniforms.fgParams.x;
          }
          #endif
        `,
      };
    }
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
          #ifdef FIXTURE_GLOW
          attribute float ${FIXTURE};
          varying float vFixture;
          #endif
        `,
        CUSTOM_VERTEX_MAIN_END: `
          #ifdef FIXTURE_GLOW
          vFixture = ${FIXTURE};
          #endif
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef FIXTURE_GLOW
        varying float vFixture;
        uniform highp sampler2D fgLights;
        #endif
      `,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
        #ifdef FIXTURE_GLOW
        {
          int fgIndex = int(vFixture + 0.5);
          vec4 fgTexel = texelFetch(fgLights, ivec2(fgIndex % ${ROW}, 2 * (fgIndex / ${ROW}) + 1), 0);
          vec3 fgColor = fgParams.y > 0.5 ? fgTexel.rgb : vec3(fgTexel.a);
          finalEmissive *= fgColor * fgParams.x;
        }
        #endif
      `,
    };
  }
}

/** Re-bakes with the settings as they are now, once the first bake has started. */
let rebake: (() => void) | undefined;

/**
 * How a fitting's brightness moves: a failing tube's stutter, a dying one's dim pulsing, a starter
 * that keeps trying, a nervous buzz, or a TV's static. Each runs on its own clock and dice.
 */
type Pattern = "stutter" | "dying" | "starter" | "buzz" | "static";
const PATTERNS: Pattern[] = ["stutter", "dying", "starter", "buzz"];

const between = (min: number, max: number) => min + Math.random() * (max - min);

class Flicker {
  value = 1;
  /** Seconds left in the current phase, and until the next change within it. */
  private phase = between(0, 4);
  private tick = 0;
  private mode = 0;
  private count = 0;
  private slow = Math.random() * 10;

  constructor(private readonly pattern: Pattern) {}

  step(dt: number): number {
    this.phase -= dt;
    this.tick -= dt;
    this.slow += dt;
    switch (this.pattern) {
      case "stutter":
        // On for a while, then a fit of rapid stuttering, now and then going out for a moment.
        if (this.phase <= 0) {
          this.mode = this.mode === 0 ? (Math.random() < 0.2 ? 2 : 1) : 0;
          this.phase =
            this.mode === 0
              ? between(0.8, 7)
              : this.mode === 1
                ? between(0.15, 1.4)
                : between(0.3, 2);
        }
        if (this.mode === 0) this.value = 1;
        else if (this.mode === 2) this.value = 0;
        else if (this.tick <= 0) {
          this.tick = between(1 / 40, 1 / 10);
          const roll = Math.random();
          this.value = roll < 0.45 ? 0 : roll < 0.6 ? 0.2 : 1;
        }
        break;
      case "dying":
        // Dim and wavering, with a sudden surge or a drop now and then.
        if (this.phase <= 0) {
          this.mode = Math.random() < 0.5 ? 1 : 2;
          this.phase = between(0.05, 0.2);
          this.count = between(2, 7);
        }
        if (this.mode !== 0 && this.phase < 0.25 && this.phase > 0) {
          this.value = this.mode === 1 ? 1 : 0.04;
        } else {
          this.value = 0.35 + 0.12 * Math.sin(this.slow * 2.3) + 0.06 * Math.sin(this.slow * 7.1);
        }
        if (this.phase <= 0.001 && this.mode !== 0) {
          this.mode = 0;
          this.phase = this.count;
        }
        break;
      case "starter":
        // Dark, then a burst of blinks as the starter tries; sometimes it catches for a while.
        if (this.phase <= 0) {
          if (this.mode === 0) {
            this.mode = 1;
            this.count = Math.floor(between(2, 7));
            this.phase = 10;
            this.tick = 0;
            this.value = 0;
          } else {
            this.mode = 0;
            this.phase = between(0.8, 3.5);
            this.value = 0;
          }
        }
        if (this.mode === 1 && this.tick <= 0) {
          if (this.value > 0) {
            this.value = 0;
            this.tick = between(0.05, 0.3);
            if (--this.count <= 0) {
              if (Math.random() < 0.35) {
                this.mode = 2;
                this.value = 1;
                this.phase = between(1.5, 8);
              } else {
                this.mode = 0;
                this.phase = between(0.8, 3.5);
              }
            }
          } else {
            this.value = between(0.6, 1);
            this.tick = between(0.03, 0.12);
          }
        }
        break;
      case "buzz":
        // On, but never quite steady, with the odd dropout.
        if (this.phase <= 0) {
          this.phase = between(2, 10);
          this.mode = 1;
          this.count = between(0.04, 0.12);
        }
        if (this.mode === 1) {
          this.count -= dt;
          this.value = 0.15;
          if (this.count <= 0) this.mode = 0;
        } else if (this.tick <= 0) {
          this.tick = 1 / 20;
          this.value = between(0.82, 1);
        }
        break;
      case "static":
        if (this.tick <= 0) {
          this.tick = 1 / 24;
          this.value = (0.55 + 0.45 * Math.random()) * (0.85 + 0.15 * Math.sin(this.slow * 2.2));
        }
        break;
    }
    return this.value;
  }
}

/** A fitting or screen as both the bake and the glow see it. */
interface Fitting {
  source: BakeSource;
  color: [number, number, number];
  power: number;
  /** 0 for a dead fitting, else 1, or its flicker. */
  flicker: Flicker | undefined;
  dead: boolean;
  kind: LightSpawn["kind"] | "screen";
}

function strengthOf(kind: Fitting["kind"]): number {
  return kind === "screen" ? BAKE.screen : BAKE[kind];
}

function reachOf(kind: Fitting["kind"], power: number): number {
  const scale = { tube: 1, bulb: 1.3, emergency: 0.7, exit: 0.35, screen: 0.55 }[kind];
  return BAKE.reach * scale * Math.sqrt(Math.max(0.1, power));
}

const SHAPES: Record<Fitting["kind"], BakeSource["shape"]> = {
  tube: "tube",
  bulb: "bulb",
  emergency: "spot",
  exit: "sign",
  screen: "screen",
};

/** Every fitting of the level, then a light in front of every TV screen. */
function fittingsOf(level: Level): Fitting[] {
  const fittings: Fitting[] = level.lights.map((light, i) => {
    const turn = light.turn;
    // A tube's length runs along x before it's turned; a sign faces +z.
    const [dx, dz] =
      light.kind === "tube" ? [Math.cos(turn), -Math.sin(turn)] : [Math.sin(turn), Math.cos(turn)];
    return {
      source: {
        x: light.x,
        y: light.y,
        z: light.z,
        shape: SHAPES[light.kind],
        dx,
        dz,
        r: 0,
        g: 0,
        b: 0,
        reach: 0,
        dynamic: light.state === "flicker" ? i : -1,
      },
      color: light.color,
      power: light.power,
      flicker:
        light.state === "flicker"
          ? new Flicker(PATTERNS[(i * 7 + 3) % PATTERNS.length])
          : undefined,
      dead: light.state === "dead",
      kind: light.kind,
    };
  });
  const [, tvHeight, tvDepth] = ITEM_KINDS.tv.size;
  for (const screen of level.screens) {
    const turn = TURN[screen.faces];
    const [dx, dz] = [Math.sin(turn), Math.cos(turn)];
    const out = tvDepth / 2 + 0.1;
    fittings.push({
      source: {
        x: screen.x + dx * out,
        y: screen.y + SCREEN_CABINET.height + tvHeight / 2,
        z: screen.z + dz * out,
        shape: "screen",
        dx,
        dz,
        r: 0,
        g: 0,
        b: 0,
        reach: 0,
        dynamic: fittings.length,
      },
      color: SCREEN_COLOR,
      power: 1,
      flicker: new Flicker("static"),
      dead: false,
      kind: "screen",
    });
  }
  return fittings;
}

/** What blocks light: walls, floors, furniture, the roof. Railings don't, to speak of. */
function blockersOf(
  level: Level,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
) {
  const out: number[] = [];
  for (const box of level.boxes) {
    if (box.kind === "rail") continue;
    // A staircase's railings are thin; what's solid under its ramp is not.
    if (box.kind === "stairs" && Math.min(box.maxX - box.minX, box.maxZ - box.minZ) < 0.3) continue;
    out.push(box.minX, box.y, box.minZ, box.maxX, box.y + box.height, box.maxZ);
  }
  for (const floor of level.floors) {
    if (floor.kind === "ground") continue;
    const rise = floor.rise;
    if (!rise) {
      out.push(floor.minX, floor.y - floor.thickness, floor.minZ, floor.maxX, floor.y, floor.maxZ);
      continue;
    }
    // A ramp, as steps.
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const [from, to] = [i / steps, (i + 1) / steps];
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const { minX, maxX, minZ, maxZ } = floor;
      const part =
        rise.toward === "n"
          ? { minX, maxX, minZ: lerp(minZ, maxZ, from), maxZ: lerp(minZ, maxZ, to) }
          : rise.toward === "s"
            ? { minX, maxX, minZ: lerp(maxZ, minZ, to), maxZ: lerp(maxZ, minZ, from) }
            : rise.toward === "e"
              ? { minZ, maxZ, minX: lerp(minX, maxX, from), maxX: lerp(minX, maxX, to) }
              : { minZ, maxZ, minX: lerp(maxX, minX, to), maxX: lerp(maxX, minX, from) };
      const top = floor.y + rise.height * to;
      out.push(
        part.minX,
        top - floor.thickness - rise.height / steps,
        part.minZ,
        part.maxX,
        top,
        part.maxZ,
      );
    }
  }
  if (level.roof !== undefined) {
    out.push(
      bounds.minX - 1,
      level.roof,
      bounds.minZ - 1,
      bounds.maxX + 1,
      level.roof + 0.3,
      bounds.maxZ + 1,
    );
  }
  return Float32Array.from(out);
}

/** The building's extent: its floors and walls, not the pits below or anything outside. */
function boundsOf(level: Level) {
  const floors = level.floors.filter((f) => f.kind !== "ground");
  const walls = level.boxes.filter((b) => b.kind === "wall" || b.kind === "partition");
  const all = [...floors, ...walls];
  const minX = Math.min(...all.map((b) => b.minX));
  const maxX = Math.max(...all.map((b) => b.maxX));
  const minZ = Math.min(...all.map((b) => b.minZ));
  const maxZ = Math.max(...all.map((b) => b.maxZ));
  const minY = Math.min(...floors.map((f) => f.y - f.thickness));
  const maxY = level.roof ?? Math.max(...walls.map((b) => b.y + b.height));
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function makeVolume(scene: Scene, data: Float32Array, dims: [number, number, number]) {
  return new RawTexture3D(
    data,
    dims[0],
    dims[1],
    dims[2],
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Constants.TEXTURE_NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  );
}

/** Runs a bake in a worker, or here if workers can't be had. */
function runBake(input: BakeInput): Promise<BakeOutput> {
  try {
    const worker = new Worker(new URL("./lightBake.worker.ts", import.meta.url), {
      type: "module",
    });
    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<BakeOutput>) => {
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        worker.terminate();
        console.warn("Light bake worker failed, baking on the page", event.message);
        try {
          resolve(bakeLight(input));
        } catch (err) {
          reject(err);
        }
      };
      worker.postMessage(input);
    });
  } catch {
    return Promise.resolve(bakeLight(input));
  }
}

/**
 * Lights a level by its fittings, if it has any (and `?interior=off` isn't set): turns off the even
 * light it would otherwise have, bakes, and draws stand-ins for the fittings until their models
 * exist. Returns undefined for a level without fittings, which is left exactly as it was.
 */
export function addInteriorLighting(world: World): InteriorLighting | undefined {
  const { scene, level } = world;
  if (!ENABLED || level.lights.length === 0) return undefined;

  // The even light this replaces: the sky light and the sun, and the sun's shadow map with it.
  scene.getLightByName("hemi")?.setEnabled(false);
  scene.getLightByName("sun")?.setEnabled(false);

  const fittings = fittingsOf(level);
  const rows = Math.ceil(fittings.length / ROW);
  const lightData = new Float32Array(ROW * rows * 2 * 4);
  shared.lights = new RawTexture(
    lightData,
    ROW,
    rows * 2,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Constants.TEXTURE_NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  );
  // Until the bake is in: one closed, dark voxel.
  shared.a = makeVolume(scene, new Float32Array([0, 0, 0, 0]), [1, 1, 1]);
  shared.b = makeVolume(scene, new Float32Array([0, 0, 0, 0]), [1, 1, 1]);
  shared.dims = [1, 1, 1];

  const bounds = boundsOf(level);
  // A coarser grid for a building too big for the fine one.
  const gridOf = (size: number) => {
    const down = (value: number) => Math.floor(value / size) * size - size;
    const up = (value: number) => Math.ceil(value / size) * size + size;
    const origin: [number, number, number] = [
      down(bounds.minX),
      down(bounds.minY),
      down(bounds.minZ),
    ];
    const dims: [number, number, number] = [
      Math.round((up(bounds.maxX) - origin[0]) / size),
      Math.round((up(bounds.maxY) - origin[1]) / size),
      Math.round((up(bounds.maxZ) - origin[2]) / size),
    ];
    return { size, origin, dims };
  };
  let grid = gridOf(VOXEL);
  if (grid.dims[0] * grid.dims[1] * grid.dims[2] > MAX_VOXELS) grid = gridOf(VOXEL * 2);
  const { size, origin, dims } = grid;
  const blockers = blockersOf(level, bounds);

  const bake = async () => {
    for (const fitting of fittings) {
      const strength = fitting.dead ? 0 : strengthOf(fitting.kind) * fitting.power;
      fitting.source.r = fitting.color[0] * strength;
      fitting.source.g = fitting.color[1] * strength;
      fitting.source.b = fitting.color[2] * strength;
      fitting.source.reach = reachOf(fitting.kind, fitting.power);
    }
    const input: BakeInput = {
      origin,
      size,
      dims,
      blockers,
      sources: fittings.filter((f) => !f.dead).map((f) => f.source),
      bounce: BAKE.bounce,
      spread: BAKE.spread,
    };
    const output = await runBake(input);
    const { grid: g, direct: d, bounce: b } = output.stages;
    console.info(
      `Interior light baked in ${Math.round(output.ms)} ms (grid ${Math.round(g)}, direct ${Math.round(d)}, bounce ${Math.round(b)}): ${dims.join("×")} voxels, ${input.sources.length} lights`,
    );
    shared.a?.dispose();
    shared.b?.dispose();
    baked = output;
    shared.a = makeVolume(scene, output.a, dims);
    shared.b = makeVolume(scene, output.b, dims);
    shared.origin = origin;
    shared.dims = dims;
    shared.size = size;
  };
  let pending: ReturnType<typeof setTimeout> | undefined;
  rebake = () => {
    clearTimeout(pending);
    pending = setTimeout(() => void bake(), 300);
  };
  let baked: BakeOutput | undefined;
  const ready = bake();

  // Every PBR material takes the light, now and as they're made.
  const light = (material: unknown) => {
    if (material instanceof PBRMaterial && !material.pluginManager?.getPlugin("InteriorLight")) {
      new InteriorLightPlugin(material);
    }
  };
  for (const material of scene.materials) light(material);
  // A material's constructor announces it before setting its own fields, hence the wait.
  scene.onNewMaterialAddedObservable.add((material) => queueMicrotask(() => light(material)));

  // Each frame: every fitting's light and glow as it is now.
  const brightness = new Float32Array(fittings.length);
  const update = (dt: number) => {
    for (const [i, fitting] of fittings.entries()) {
      const now = fitting.dead ? 0 : (fitting.flicker?.step(dt) ?? 1);
      brightness[i] = now;
      const strength = strengthOf(fitting.kind) * fitting.power * now;
      const at = (row: number) => ((2 * Math.floor(i / ROW) + row) * ROW + (i % ROW)) * 4;
      const [r, g, b] = fitting.color;
      lightData.set([r * strength, g * strength, b * strength, now], at(0));
      const glow = fitting.power * now;
      lightData.set([r * glow, g * glow, b * glow, glow], at(1));
    }
    shared.lights?.update(lightData);
  };
  update(0);
  scene.onBeforeRenderObservable.add(() =>
    update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)),
  );

  const glow: InteriorLighting["glow"] = (mesh, lights, options = {}) => {
    const material = mesh.material;
    if (!(material instanceof PBRMaterial)) return;
    if (!material.pluginManager?.getPlugin("FixtureGlow")) {
      new FixtureGlowPlugin(material, options.tint ?? false);
    }
    if (typeof lights === "number") {
      const vertices = mesh.getTotalVertices();
      mesh.setVerticesData(FIXTURE, new Float32Array(vertices).fill(lights), false, 1);
    } else {
      mesh.thinInstanceSetBuffer(FIXTURE, Float32Array.from(lights), 1, true);
    }
  };

  addStandIns(scene, level, glow);

  return {
    brightness: (i) =>
      (brightness[i] ?? 0) * (fittings[i]?.power ?? 0) * shared.level ** LOOK.levelCurve,
    glow,
    probe(x, y, z) {
      const [i, j, k] = [x - origin[0], y - origin[1], z - origin[2]].map((v) =>
        Math.floor(v / size),
      );
      if (!baked || i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return;
      const v = (i + j * dims[0] + k * dims[0] * dims[1]) * 4;
      return { a: [...baked.a.subarray(v, v + 4)], b: [...baked.b.subarray(v, v + 4)] };
    },
    setLevel(value) {
      shared.level = value;
    },
    ready,
  };
}

/** Stand-ins for the fittings' models, until they exist: a glowing shape at each, by kind. */
function addStandIns(scene: Scene, level: Level, glow: InteriorLighting["glow"]) {
  const shapes: Record<LightSpawn["kind"], () => Mesh> = {
    tube: () =>
      MeshBuilder.CreateBox("fitting-tube", { width: 1.2, height: 0.05, depth: 0.09 }, scene),
    bulb: () => MeshBuilder.CreateSphere("fitting-bulb", { diameter: 0.14, segments: 8 }, scene),
    emergency: () =>
      MeshBuilder.CreateBox("fitting-emergency", { width: 0.3, height: 0.08, depth: 0.12 }, scene),
    exit: () =>
      MeshBuilder.CreateBox("fitting-exit", { width: 0.36, height: 0.15, depth: 0.04 }, scene),
  };
  const material = new PBRMaterial("fitting-glow", scene);
  material.albedoColor = new Color3(0.22, 0.22, 0.22);
  material.roughness = 0.5;
  material.emissiveColor = Color3.White();
  for (const kind of Object.keys(shapes) as LightSpawn["kind"][]) {
    const which = level.lights.flatMap((light, i) => (light.kind === kind ? [i] : []));
    if (which.length === 0) continue;
    const mesh = shapes[kind]();
    mesh.material = material;
    mesh.isPickable = false;
    const matrices = new Float32Array(which.length * 16);
    for (const [n, i] of which.entries()) {
      const light = level.lights[i];
      Matrix.RotationY(light.turn)
        .multiply(Matrix.Translation(light.x, light.y, light.z))
        .copyToArray(matrices, n * 16);
    }
    drawInstances(mesh, matrices);
    glow(mesh, which, { tint: true });
  }
}
