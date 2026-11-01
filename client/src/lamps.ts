import {
  Color3,
  MaterialPluginBase,
  Matrix,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  ShaderLanguage,
  StandardMaterial,
} from "@babylonjs/core";
import { drawInstances } from "./graphics";

/** Where things are on the street light model. */
const LIGHT_HEIGHT = 7.9;
const HEAD_OFFSET = 1.6;

const REACH = 19; // meters until a lamp's light has faded out
const COLOR = "1.0, 0.86, 0.68";
const STRENGTH = 240;

/** Set before any plugin exists: the plugin's base constructor already asks for its shader code. */
let lamps: { x: number; y: number; z: number }[] = [];

const number = (value: number) => value.toFixed(2);

/** The world position of a point on the model, for one 16-number matrix under a glTF root. */
function pointOnLamp(m: Float32Array, i: number, x: number, y: number, z: number) {
  return {
    x: -(x * m[i] + y * m[i + 4] + z * m[i + 8] + m[i + 12]),
    y: x * m[i + 1] + y * m[i + 5] + z * m[i + 9] + m[i + 13],
    z: x * m[i + 2] + y * m[i + 6] + z * m[i + 10] + m[i + 14],
  };
}

/**
 * Light from every lamp, summed in the shader. Each lamp as a real scene light would count towards
 * the few lights a material can have, and this keeps the positions out of the per-frame uniforms.
 */
class LampLight extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, "LampLight", 210);
    this._enable(true);
  }

  override getClassName(): string {
    return "LampLight";
  }

  override isCompatible(): boolean {
    return true;
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL,
  ): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    const count = lamps.length;
    const places = lamps.map((p) => `${number(p.x)}, ${number(p.y)}, ${number(p.z)}`);
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `
          var<private> lampPlaces: array<vec3f, ${count}> = array<vec3f, ${count}>(${places.map((p) => `vec3f(${p})`).join(", ")});
        `,
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
          for (var lamp = 0; lamp < ${count}; lamp++) {
            let lampOffset = lampPlaces[lamp] - fragmentInputs.vPositionW;
            let lampDistance = max(dot(lampOffset, lampOffset), 1.0);
            let lampFade = clamp(1.0 - lampDistance / ${number(REACH * REACH)}, 0.0, 1.0);
            if (lampFade <= 0.0) { continue; }
            let lampDirection = lampOffset / sqrt(lampDistance);
            let lampCone = smoothstep(0.25, 0.75, lampDirection.y);
            let lampArrival = lampCone * lampFade * lampFade * ${number(STRENGTH)} / lampDistance * vec3f(${COLOR});
            let lampHalf = normalize(lampDirection + viewDirectionW);
            let lampGloss = pow(max(dot(normalW, lampHalf), 0.0), 4.0 + 120.0 * microSurface * microSurface) * microSurface * microSurface;
            finalDiffuse += lampArrival * max(dot(normalW, lampDirection), 0.0) * (surfaceAlbedo + vec3f(lampGloss));
          }
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        const vec3 lampPlaces[${count}] = vec3[${count}](${places.map((p) => `vec3(${p})`).join(", ")});
      `,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
        for (int lamp = 0; lamp < ${count}; lamp++) {
          vec3 lampOffset = lampPlaces[lamp] - vPositionW;
          float lampDistance = max(dot(lampOffset, lampOffset), 1.0);
          float lampFade = clamp(1.0 - lampDistance / ${number(REACH * REACH)}, 0.0, 1.0);
          if (lampFade <= 0.0) continue;
          vec3 lampDirection = lampOffset / sqrt(lampDistance);
          float lampCone = smoothstep(0.25, 0.75, lampDirection.y);
          vec3 lampArrival = lampCone * lampFade * lampFade * ${number(STRENGTH)} / lampDistance * vec3(${COLOR});
          vec3 lampHalf = normalize(lampDirection + viewDirectionW);
          float lampGloss = pow(max(dot(normalW, lampHalf), 0.0), 4.0 + 120.0 * microSurface * microSurface) * microSurface * microSurface;
          finalDiffuse += lampArrival * max(dot(normalW, lampDirection), 0.0) * (surfaceAlbedo + vec3(lampGloss));
        }
      `,
    };
  }
}

/** Light the street lights: a glowing face under each head, and light on everything around them. */
export function addStreetLamps(scene: Scene, matrices: Float32Array): void {
  lamps = [];
  const faces: Matrix[] = [];
  for (let i = 0; i < matrices.length; i += 16) {
    lamps.push(pointOnLamp(matrices, i, 0, LIGHT_HEIGHT, 0));
    for (const side of [-1, 1]) {
      const head = pointOnLamp(matrices, i, 0, LIGHT_HEIGHT, side * HEAD_OFFSET);
      faces.push(Matrix.Translation(head.x, head.y, head.z));
    }
  }

  const face = MeshBuilder.CreateDisc("lampFace", { radius: 0.2 }, scene);
  face.rotation.x = Math.PI / 2;
  face.bakeCurrentTransformIntoVertices();
  const glow = new StandardMaterial("lampGlow", scene);
  glow.disableLighting = true;
  glow.emissiveColor = new Color3(1, 0.95, 0.85);
  glow.backFaceCulling = false;
  face.material = glow;
  face.isPickable = false;
  const buffer = new Float32Array(faces.length * 16);
  for (const [i, matrix] of faces.entries()) matrix.copyToArray(buffer, i * 16);
  drawInstances(face, buffer);

  const light = (material: unknown) => {
    // Loaded materials are announced twice: when created, and when added to the scene.
    if (material instanceof PBRMaterial && !material.pluginManager?.getPlugin("LampLight")) {
      new LampLight(material);
    }
  };
  for (const material of scene.materials) light(material);
  // A material's constructor announces it before setting its own fields, hence the wait.
  scene.onNewMaterialAddedObservable.add((material) => queueMicrotask(() => light(material)));
}
