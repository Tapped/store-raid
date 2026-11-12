import {
  type Color3,
  type MaterialDefines,
  MaterialPluginBase,
  PBRMaterial,
  type Scene,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";

/** A layer of mist lying in low ground; changes show on the next frame. */
export interface HeightFogLook {
  /** Its colour as it looks, in sRGB. */
  color: Color3;
  /** How thick it is at `floor`, per meter of sight through it. */
  density: number;
  /** Meters up over which it thins to a third. */
  falloff: number;
  /** The height it's thickest at, and below. */
  floor: number;
  /** The most of a surface it can hide, 0 to 1. */
  most: number;
}

/**
 * Mist that lies low, thickest at `floor` and thinning upward, summed along the line of sight in
 * closed form (exponential height fog). It comes after the scene's own fog, which stays a thin haze
 * over everything: so the valley floor and the river disappear into it, buildings stand out by value
 * against the slopes behind them, and the ridges stand clear against the sky.
 */
class HeightFog extends MaterialPluginBase {
  constructor(
    material: PBRMaterial,
    private readonly look: HeightFogLook,
  ) {
    // A define of its own, so its code isn't left out of an effect another material compiled.
    super(material, "HeightFog", 220, { HEIGHTFOG: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "HeightFog";
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.HEIGHTFOG = true;
  }

  override isCompatible(): boolean {
    return true;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "hfColor", size: 3, type: "vec3" },
        { name: "hfParams", size: 4, type: "vec4" },
      ],
      fragment: "uniform vec3 hfColor; uniform vec4 hfParams;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const { color, density, falloff, floor, most } = this.look;
    const linear = color.toLinearSpace();
    ubo.updateFloat3("hfColor", linear.r, linear.g, linear.b);
    ubo.updateFloat4("hfParams", density, 1 / Math.max(falloff, 0.1), floor, most);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
          {
            let hfEye = scene.vEyePosition.xyz;
            let hfRay = fragmentInputs.vPositionW - hfEye;
            let hfB = uniforms.hfParams.y;
            let hfStart = uniforms.hfParams.x * exp(-hfB * clamp(hfEye.y - uniforms.hfParams.z, 0.0, 80.0));
            let hfDy = clamp(hfRay.y * hfB, -20.0, 20.0);
            var hfLine = 1.0;
            if (abs(hfDy) > 1e-3) { hfLine = (1.0 - exp(-hfDy)) / hfDy; }
            let hfAmount = (1.0 - exp(-hfStart * length(hfRay) * hfLine)) * uniforms.hfParams.w;
            finalColor = vec4f(mix(finalColor.rgb, uniforms.hfColor * finalColor.a, hfAmount), finalColor.a);
          }
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        {
          vec3 hfEye = vEyePosition.xyz;
          vec3 hfRay = vPositionW - hfEye;
          float hfB = hfParams.y;
          float hfStart = hfParams.x * exp(-hfB * clamp(hfEye.y - hfParams.z, 0.0, 80.0));
          float hfDy = clamp(hfRay.y * hfB, -20.0, 20.0);
          float hfLine = abs(hfDy) > 1e-3 ? (1.0 - exp(-hfDy)) / hfDy : 1.0;
          float hfAmount = (1.0 - exp(-hfStart * length(hfRay) * hfLine)) * hfParams.w;
          finalColor = vec4(mix(finalColor.rgb, hfColor * finalColor.a, hfAmount), finalColor.a);
        }
      `,
    };
  }
}

/** Lays the mist over every PBR surface in the scene, now and from now on. */
export function addHeightFog(scene: Scene, look: HeightFogLook): void {
  const add = (material: unknown) => {
    if (material instanceof PBRMaterial && !material.pluginManager?.getPlugin("HeightFog")) {
      new HeightFog(material, look);
    }
  };
  for (const material of scene.materials) add(material);
  // A material's constructor announces it before setting its own fields, hence the wait.
  scene.onNewMaterialAddedObservable.add((material) => queueMicrotask(() => add(material)));
}
