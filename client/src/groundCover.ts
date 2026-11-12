import {
  type MaterialDefines,
  MaterialPluginBase,
  type PBRMaterial,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";

/** How a material's ground cover is drawn; changes show on the next frame. */
export interface GroundCoverLook {
  /** Multiplies the card's colour, linear: brings straw and heather down to the ground's value. */
  tint: [number, number, number];
  /** How much of the card's own colour is kept: night greys it, and 1 keeps it. */
  saturation: number;
  /** How dark the cover is at its base, where the ground and its neighbours shade it: 0 black, 1 none. */
  base: number;
  /** How far the cards' normals turn to face up, so they're lit as the ground under them is: 0 to 1. */
  up: number;
  /** Meters from the camera where the plants have thinned out entirely; they start thinning at 70% of it. */
  reach: number;
  /** The same for copies whose colour's alpha is under 1: the dense cover. */
  coverReach: number;
}

/**
 * Grass, heather and fern cards, made to sit in the ground: lit as the ground they stand on is
 * (normals turned up), darker towards their base, toned by `tint` (the copy's own colour, from the
 * ground where it stands, multiplies on top), and thinned out with distance by a dither TAA smooths,
 * so the edge of the cover never pops. `height` is the model's, in meters, from its base at y = 0.
 */
export class GroundCover extends MaterialPluginBase {
  constructor(
    material: PBRMaterial,
    private readonly height: number,
    private readonly look: GroundCoverLook,
  ) {
    // A define of its own, so its code isn't left out of an effect another material compiled.
    super(material, "GroundCover", 196, { GROUNDCOVER: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "GroundCover";
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.GROUNDCOVER = true;
  }

  override isCompatible(): boolean {
    return true;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "gcTint", size: 4, type: "vec4" },
        { name: "gcParams", size: 4, type: "vec4" },
        { name: "gcReach", size: 2, type: "vec2" },
      ],
      vertex: "uniform vec4 gcParams;",
      fragment: "uniform vec4 gcTint; uniform vec4 gcParams; uniform vec2 gcReach;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const { tint, saturation, base, up, reach, coverReach } = this.look;
    ubo.updateFloat4("gcTint", tint[0], tint[1], tint[2], saturation);
    // The frame, for the dither to move each frame, so TAA averages it into a fade.
    const frame = this._material.getScene().getFrameId() % 16;
    ubo.updateFloat4("gcParams", this.height, base, up, frame);
    ubo.updateFloat2("gcReach", reach, coverReach);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    if (shaderType === "vertex") {
      if (wgsl) {
        return {
          CUSTOM_VERTEX_UPDATE_NORMAL: `
            normalUpdated = normalize(mix(normalUpdated, vec3f(0.0, 1.0, 0.0), uniforms.gcParams.z));
          `,
          // Darker towards the base, through the copy's colour: a varying of its own would be one
          // more than WebGPU allows a material like this.
          CUSTOM_VERTEX_MAIN_END: `
            #if defined(INSTANCESCOLOR) || defined(VERTEXCOLOR)
            {
              let gcRise = clamp(positionUpdated.y / uniforms.gcParams.x, 0.0, 1.0);
              vertexOutputs.vColor = vec4f(vertexOutputs.vColor.rgb * mix(uniforms.gcParams.y, 1.0, sqrt(gcRise)), vertexOutputs.vColor.a);
            }
            #endif
          `,
        };
      }
      return {
        CUSTOM_VERTEX_UPDATE_NORMAL: `
          normalUpdated = normalize(mix(normalUpdated, vec3(0.0, 1.0, 0.0), gcParams.z));
        `,
        CUSTOM_VERTEX_MAIN_END: `
          #if defined(INSTANCESCOLOR) || defined(VERTEXCOLOR)
          vColor.rgb *= mix(gcParams.y, 1.0, sqrt(clamp(positionUpdated.y / gcParams.x, 0.0, 1.0)));
          #endif
        `,
      };
    }
    if (shaderType !== "fragment") return null;
    if (wgsl) {
      return {
        CUSTOM_FRAGMENT_UPDATE_ALPHA: `
          {
            let gcGrey = vec3f(dot(surfaceAlbedo, vec3f(0.2126, 0.7152, 0.0722)));
            surfaceAlbedo = mix(gcGrey, surfaceAlbedo, uniforms.gcTint.w) * uniforms.gcTint.rgb;
            var gcFar = uniforms.gcReach.x;
            #ifdef INSTANCESCOLOR
            gcFar = select(uniforms.gcReach.y, uniforms.gcReach.x, fragmentInputs.vColor.a > 0.995);
            #endif
            let gcFrame = uniforms.gcParams.w;
            let gcAway = distance(fragmentInputs.vPositionW.xz, scene.vEyePosition.xz);
            let gcKeep = smoothstep(gcFar, gcFar * 0.7, gcAway);
            let gcPixel = fragmentInputs.position.xy + gcFrame * 5.588238;
            let gcNoise = fract(52.9829189 * fract(dot(gcPixel, vec2f(0.06711056, 0.00583715))));
            if (gcNoise > gcKeep) { discard; }
          }
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
        {
          vec3 gcGrey = vec3(dot(surfaceAlbedo, vec3(0.2126, 0.7152, 0.0722)));
          surfaceAlbedo = mix(gcGrey, surfaceAlbedo, gcTint.w) * gcTint.rgb;
          float gcFar = gcReach.x;
          #ifdef INSTANCESCOLOR
          gcFar = vColor.a > 0.995 ? gcReach.x : gcReach.y;
          #endif
          float gcFrame = gcParams.w;
          float gcAway = distance(vPositionW.xz, vEyePosition.xz);
          float gcKeep = smoothstep(gcFar, gcFar * 0.7, gcAway);
          vec2 gcPixel = gl_FragCoord.xy + gcFrame * 5.588238;
          float gcNoise = fract(52.9829189 * fract(dot(gcPixel, vec2(0.06711056, 0.00583715))));
          if (gcNoise > gcKeep) discard;
        }
      `,
    };
  }
}
