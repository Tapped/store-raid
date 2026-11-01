import { MaterialPluginBase, type PBRMaterial, ShaderLanguage } from "@babylonjs/core";

const GLSL_NOISE = `
  float pavingWetness = 0.0;
  float pavingHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float pavingNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(pavingHash(i), pavingHash(i + vec2(1.0, 0.0)), f.x),
      mix(pavingHash(i + vec2(0.0, 1.0)), pavingHash(i + vec2(1.0, 1.0)), f.x),
      f.y);
  }
  float pavingFbm(vec2 p) {
    return 0.5 * pavingNoise(p) + 0.3 * pavingNoise(p * 2.03) + 0.2 * pavingNoise(p * 4.07);
  }
`;

const WGSL_NOISE = `
  var<private> pavingWetness: f32 = 0.0;
  fn pavingHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
  fn pavingNoise(p: vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(pavingHash(i), pavingHash(i + vec2f(1.0, 0.0)), f.x),
      mix(pavingHash(i + vec2f(0.0, 1.0)), pavingHash(i + vec2f(1.0, 1.0)), f.x),
      f.y);
  }
  fn pavingFbm(p: vec2f) -> f32 {
    return 0.5 * pavingNoise(p) + 0.3 * pavingNoise(p * 2.03) + 0.2 * pavingNoise(p * 4.07);
  }
`;

const GLSL_SHADE = `
  vec2 pavingPlace = vPositionW.xz;
  float pavingLight = pavingFbm(pavingPlace / 31.0);
  float pavingGrime = pavingFbm(pavingPlace / 9.0 + vec2(41.0, 17.0));
  pavingWetness = smoothstep(0.54, 0.68, pavingFbm(pavingPlace / 17.0 + vec2(-23.0, 58.0)));
  surfaceAlbedo *= mix(0.62, 1.3, pavingLight) * mix(0.8, 1.1, pavingGrime) * mix(1.0, 0.55, pavingWetness);
`;

const WGSL_SHADE = `
  let pavingPlace = fragmentInputs.vPositionW.xz;
  let pavingLight = pavingFbm(pavingPlace / 31.0);
  let pavingGrime = pavingFbm(pavingPlace / 9.0 + vec2f(41.0, 17.0));
  pavingWetness = smoothstep(0.54, 0.68, pavingFbm(pavingPlace / 17.0 + vec2f(-23.0, 58.0)));
  surfaceAlbedo *= mix(0.62, 1.3, pavingLight) * mix(0.8, 1.1, pavingGrime) * mix(1.0, 0.55, pavingWetness);
`;

/**
 * Breaks up repeating paving without touching its slab joints: slow noise in world space, so it runs
 * across every copy of a tile, varies the brightness and leaves damp patches that catch the sky.
 */
class PavingVariation extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "PavingVariation", 200);
    this._enable(true);
  }

  override getClassName(): string {
    return "PavingVariation";
  }

  override isCompatible(): boolean {
    return true;
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: WGSL_NOISE,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: WGSL_SHADE,
        "!var microSurface: f32=reflectivityOut\\.microSurface;var roughness: f32=reflectivityOut\\.roughness;":
          "var roughness: f32=reflectivityOut.roughness*(1.0-0.65*pavingWetness);var microSurface: f32=1.0-roughness;",
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: GLSL_NOISE,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: GLSL_SHADE,
      "!float microSurface=reflectivityOut\\.microSurface;float roughness=reflectivityOut\\.roughness;":
        "float roughness=reflectivityOut.roughness*(1.0-0.65*pavingWetness);float microSurface=1.0-roughness;",
    };
  }
}

export function addPavingVariation(material: PBRMaterial): void {
  new PavingVariation(material);
}
