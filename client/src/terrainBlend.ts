import {
  type BaseTexture,
  type MaterialDefines,
  MaterialPluginBase,
  type PBRMaterial,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";

/** How a ground material is varied; changes show on the next frame. */
export interface TerrainLook {
  /** How much bare rock shows where the ground is steep, 0 none. */
  rock: number;
  /** How upright the ground must be to keep its own surface: rock takes over below this (0 to 1). */
  steep: number;
  /** How much the large-scale patches vary brightness, 0 none. */
  macro: number;
  /** Meters one repeat of the rock's texture covers. */
  rockTile: number;
  /** How bright the rock is against its texture. */
  rockBrightness: number;
  /** How much of the flat ground lies damp in patches: darker and glossier, 0 none. */
  wet: number;
}

const WGSL_DEFINITIONS = `
  var tbRock: texture_2d<f32>;
  var tbRockSampler: sampler;
  fn tbHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
  fn tbNoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(tbHash(i), tbHash(i + vec2f(1.0, 0.0)), u.x),
               mix(tbHash(i + vec2f(0.0, 1.0)), tbHash(i + vec2f(1.0, 1.0)), u.x), u.y);
  }
`;

const WGSL_CODE = `
  {
    let tbP = fragmentInputs.vPositionW;
    let tbN = normalize(fragmentInputs.vNormalW);
    let tbMacro = 0.55 * tbNoise(tbP.xz / 41.0) + 0.3 * tbNoise(tbP.xz / 13.0 + 7.1) + 0.15 * tbNoise(tbP.xz / 127.0 + 3.3);
    surfaceAlbedo *= mix(1.0, 0.55 + 0.9 * tbMacro, uniforms.tbParams.z);
    if (uniforms.tbParams.x > 0.0) {
      let tbBreak = tbNoise(tbP.xz / 9.0 + tbP.y / 23.0) - 0.5;
      let tbRockAmount = uniforms.tbParams.x * smoothstep(uniforms.tbParams.y, uniforms.tbParams.y - 0.22, tbN.y + 0.3 * tbBreak);
      let tbAcross = abs(tbN.x) / (abs(tbN.x) + abs(tbN.z) + 1e-4);
      let tbUvX = vec2f(tbP.z, tbP.y) / uniforms.tbParams.w;
      let tbUvZ = vec2f(tbP.x, tbP.y) / uniforms.tbParams.w;
      let tbStone = mix(textureSample(tbRock, tbRockSampler, tbUvZ).rgb, textureSample(tbRock, tbRockSampler, tbUvX).rgb, tbAcross);
      surfaceAlbedo = mix(surfaceAlbedo, tbStone * uniforms.tbMore.x * (0.7 + 0.6 * tbMacro), tbRockAmount);
    }
  }
`;

// Damp patches on the flat: darker, and glossy under a flashlight. Roughness goes through
// SurfaceVariation's (variation.ts), which every ground surface has.
const WGSL_WET = `
  #if defined(VARIATION_HEX) || defined(VARIATION_COURSES) || defined(VARIATION_CELLS)
  {
    let tbP = fragmentInputs.vPositionW;
    let tbFlat = smoothstep(0.85, 0.97, normalize(fragmentInputs.vNormalW).y);
    let tbDamp = 0.7 * tbNoise(tbP.xz / 5.0 + 11.0) + 0.3 * tbNoise(tbP.xz / 1.7 + 3.0);
    let tbWet = uniforms.tbMore.y * tbFlat * smoothstep(0.42, 0.68, tbDamp);
    vrRough *= mix(1.0, 0.3, tbWet);
    surfaceAlbedo *= mix(1.0, 0.65, tbWet);
  }
  #endif
`;

const GLSL_WET = `
  #if defined(VARIATION_HEX) || defined(VARIATION_COURSES) || defined(VARIATION_CELLS)
  {
    vec3 tbP = vPositionW;
    float tbFlat = smoothstep(0.85, 0.97, normalize(vNormalW).y);
    float tbDamp = 0.7 * tbNoise(tbP.xz / 5.0 + 11.0) + 0.3 * tbNoise(tbP.xz / 1.7 + 3.0);
    float tbWet = tbMore.y * tbFlat * smoothstep(0.42, 0.68, tbDamp);
    vrRough *= mix(1.0, 0.3, tbWet);
    surfaceAlbedo *= mix(1.0, 0.65, tbWet);
  }
  #endif
`;

const GLSL_DEFINITIONS = `
  uniform sampler2D tbRock;
  float tbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float tbNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(tbHash(i), tbHash(i + vec2(1.0, 0.0)), u.x),
               mix(tbHash(i + vec2(0.0, 1.0)), tbHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const GLSL_CODE = `
  {
    vec3 tbP = vPositionW;
    vec3 tbN = normalize(vNormalW);
    float tbMacro = 0.55 * tbNoise(tbP.xz / 41.0) + 0.3 * tbNoise(tbP.xz / 13.0 + 7.1) + 0.15 * tbNoise(tbP.xz / 127.0 + 3.3);
    surfaceAlbedo *= mix(1.0, 0.55 + 0.9 * tbMacro, tbParams.z);
    if (tbParams.x > 0.0) {
      float tbBreak = tbNoise(tbP.xz / 9.0 + tbP.y / 23.0) - 0.5;
      float tbRockAmount = tbParams.x * smoothstep(tbParams.y, tbParams.y - 0.22, tbN.y + 0.3 * tbBreak);
      float tbAcross = abs(tbN.x) / (abs(tbN.x) + abs(tbN.z) + 1e-4);
      vec2 tbUvX = vec2(tbP.z, tbP.y) / tbParams.w;
      vec2 tbUvZ = vec2(tbP.x, tbP.y) / tbParams.w;
      vec3 tbStone = mix(texture(tbRock, tbUvZ).rgb, texture(tbRock, tbUvX).rgb, tbAcross);
      surfaceAlbedo = mix(surfaceAlbedo, tbStone * tbMore.x * (0.7 + 0.6 * tbMacro), tbRockAmount);
    }
  }
`;

/**
 * Breaks up a tiled ground: large patches of lighter and darker ground in world space, so no repeat
 * shows from afar, and bare rock where the ground is steep (`rock` above 0), mapped from the
 * side so it doesn't stretch down slopes. For the valley sides, which are one surface, so their
 * coarse grid far out doesn't show as blotches.
 */
export class TerrainBlend extends MaterialPluginBase {
  constructor(
    material: PBRMaterial,
    private readonly look: TerrainLook,
    private readonly rock: BaseTexture,
  ) {
    // A define of its own, so its code isn't left out of an effect another material compiled;
    // after SurfaceVariation, whose roughness it changes.
    super(material, "TerrainBlend", 205, { TERRAINBLEND: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "TerrainBlend";
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.TERRAINBLEND = true;
  }

  override isCompatible(): boolean {
    return true;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("tbRock");
  }

  override getActiveTextures(textures: BaseTexture[]): void {
    textures.push(this.rock);
  }

  // Drawn once the rock has loaded: a texture not there yet can't be bound.
  override isReadyForSubMesh(): boolean {
    return this.rock.isReady();
  }

  override getUniforms(shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL) {
    return {
      ubo: [
        { name: "tbParams", size: 4, type: "vec4" },
        { name: "tbMore", size: 4, type: "vec4" },
      ],
      fragment:
        shaderLanguage === ShaderLanguage.WGSL
          ? "uniform tbParams: vec4f;\nuniform tbMore: vec4f;"
          : "uniform vec4 tbParams;\nuniform vec4 tbMore;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const { rock, steep, macro, rockTile, rockBrightness, wet } = this.look;
    ubo.updateFloat4("tbParams", rock, steep, macro, rockTile);
    ubo.updateFloat4("tbMore", rockBrightness, wet, 0, 0);
    ubo.setTexture("tbRock", this.rock);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl ? WGSL_DEFINITIONS : GLSL_DEFINITIONS,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: wgsl ? WGSL_CODE : GLSL_CODE,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: wgsl ? WGSL_WET : GLSL_WET,
    };
  }
}
