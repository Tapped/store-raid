import {
  Color3,
  MaterialPluginBase,
  PBRMaterial,
  type Scene,
  ShaderLanguage,
  Texture,
  type UniformBuffer,
} from "@babylonjs/core";
import { assetUrl } from "./assets";
import { SURFACE_NAMES, SURFACES, type SurfaceName, type SurfaceSpec } from "./surfaceTable";
import { addSurfaceVariation, type SurfaceVariation } from "./variation";

export { SURFACE_NAMES, SURFACES, type SurfaceName, type SurfaceSpec };

/**
 * The surface library: tiling PBR surfaces baked in code by scripts/surfaces/ (`pnpm run surface`)
 * into assets/textures/surfaces/, as materials. Meshes that use one need texture coordinates in
 * world meters divided by the surface's tile, `SURFACES[name].tile`, as
 * `worldBox(name, min, max, scene, SURFACES[name].tile)` makes.
 *
 *   wall.material = surface(scene, "painted-plaster", { tint: new Color3(0.55, 0.62, 0.58) });
 *
 * Tintable surfaces (those with a `tint` in the table) are painted: their colour texture's alpha
 * says how much of the paint shows, and the colour is what shows where it doesn't (chips, rust,
 * dirt), so one bake serves every paint colour: albedo = colour + tint × alpha.
 */
export interface SurfaceOptions {
  /** Paint colour in sRGB, as `surfaceMaterial` takes; the table's when left out. Ignored on surfaces that aren't tintable. */
  tint?: Color3;
  /**
   * How repeats are broken up, merged over the table's: a field given here wins, so
   * `{ grime: 0 }` keeps the table's sampling and drops the grime. `false` for none at all.
   */
  variation?: Partial<SurfaceVariation> | false;
  /** Multiplies the baked roughness. */
  roughness?: number;
  /** Multiplies the baked bumps' strength. */
  bump?: number;
}

const cache = new Map<string, PBRMaterial>();

/**
 * The material for a surface, shared by every request with the same name and options in a scene.
 * While its textures are missing, or if they fail to load, it shows the table's flat colour.
 */
export function surface(scene: Scene, name: SurfaceName, options: SurfaceOptions = {}): PBRMaterial {
  const spec = SURFACES[name];
  const tint = spec.tint ? (options.tint ?? new Color3(...spec.tint)) : undefined;
  const key = JSON.stringify([
    scene.uid,
    name,
    tint?.toHexString(),
    options.variation,
    options.roughness ?? 1,
    options.bump ?? 1,
  ]);
  let material = cache.get(key);
  if (material) return material;

  material = new PBRMaterial(`surface-${name}`, scene);
  cache.set(key, material);
  material.onDisposeObservable.addOnce(() => cache.delete(key));
  const made = material;

  let failed = false;
  const fallBack = () => {
    if (failed) return;
    failed = true;
    console.warn(`Surface ${name}: textures missing, drawn flat (pnpm run surface ${name})`);
    made.albedoTexture = null;
    made.bumpTexture = null;
    made.metallicTexture = null;
    made.albedoColor = (tint ?? new Color3(...spec.color)).toLinearSpace();
    made.metallic = 0;
    made.roughness = 0.75 * (options.roughness ?? 1);
  };
  const texture = (kind: string, sRGB: boolean) => {
    const t = new Texture(assetUrl(`textures/surfaces/${name}-${kind}.webp`), scene, {
      gammaSpace: sRGB,
      onError: fallBack,
    });
    t.anisotropicFilteringLevel = 8;
    return t;
  };
  material.albedoTexture = texture("base", true);
  material.bumpTexture = texture("normal", false);
  material.bumpTexture.level = options.bump ?? 1;
  material.metallicTexture = texture("orm", false);
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.useRoughnessFromMetallicTextureAlpha = false;
  material.invertNormalMapX = NORMAL_FLIP.x;
  material.invertNormalMapY = NORMAL_FLIP.y;
  material.metallic = 1;
  material.roughness = options.roughness ?? 1;
  material.albedoColor = Color3.White();
  material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
  if (tint) new SurfaceTint(material, tint.toLinearSpace());

  if (options.variation !== false) {
    const variation = { ...spec.variation, ...options.variation };
    if (variation.sampling || variation.brightness || variation.roughness || variation.grime)
      addSurfaceVariation(material, variation);
  }
  return material;
}

/**
 * The bakes write normal maps as OpenGL does, green up the texture (v); in this left-handed scene
 * the engine wants both x and y flipped. Checked with lit domes in the surface viewer, on WebGPU and WebGL.
 */
const NORMAL_FLIP = { x: true, y: true };

/**
 * Adds the tint where the colour texture's alpha lets it: albedo = colour + tint × alpha. It reads
 * the colour texture as the material does, so under hex tiling or shuffled cells the paint stays
 * with the bake.
 */
class SurfaceTint extends MaterialPluginBase {
  constructor(
    material: PBRMaterial,
    private readonly tint: Color3,
  ) {
    super(material, "SurfaceTint", 190);
    this._enable(true);
  }

  override getClassName(): string {
    return "SurfaceTint";
  }

  override isCompatible(): boolean {
    return true;
  }

  override getUniforms() {
    return {
      ubo: [{ name: "sfTint", size: 3, type: "vec3" }],
      fragment: "uniform vec3 sfTint;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat3("sfTint", this.tint.r, this.tint.g, this.tint.b);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    const tint = shaderLanguage === ShaderLanguage.WGSL ? "uniforms.sfTint" : "sfTint";
    return {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        #ifdef ALBEDO
        surfaceAlbedo += ${tint} * albedoTexture.a;
        #endif
      `,
    };
  }
}
