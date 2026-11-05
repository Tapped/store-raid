import {
  type AbstractEngine,
  type Camera,
  type Color3,
  Color4,
  ColorCurves,
  Constants,
  DefaultRenderingPipeline,
  Engine,
  ImageProcessingConfiguration,
  type Mesh,
  PBRMaterial,
  type Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  TAARenderingPipeline,
  WebGPUEngine,
} from "@babylonjs/core";

export type Quality = "balanced" | "high";

/** Both tiers run the same pipeline; `?quality=high` only makes shadows and ambient occlusion finer. */
export const quality: Quality =
  new URLSearchParams(location.search).get("quality") === "high" ? "high" : "balanced";

/** WebGPU where the browser offers it (secure pages only), otherwise WebGL2; `?engine=webgl` forces WebGL2. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  // Native resolution is what stops the picture looking soft on HiDPI screens, on every tier.
  const forceWebGL = new URLSearchParams(location.search).get("engine") === "webgl";
  if (!forceWebGL && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
      await engine.initAsync();
      return engine;
    } catch (err) {
      console.warn("WebGPU failed to start, using WebGL2", err);
    }
  }
  return new Engine(canvas, true, undefined, true);
}

export function configureShadows(shadows: ShadowGenerator): void {
  shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  if (quality === "high") {
    shadows.useContactHardeningShadow = true;
    shadows.contactHardeningLightSizeUVRatio = 0.25;
  } else {
    shadows.usePercentageCloserFiltering = true;
  }
}

/** A physically based surface. Colours are written as they should look, in sRGB. */
export function surfaceMaterial(
  name: string,
  scene: Scene,
  color: Color3,
  { roughness = 0.8, metallic = 0 } = {},
): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = color.toLinearSpace();
  material.roughness = roughness;
  material.metallic = metallic;
  return material;
}

/**
 * The game's look: cool, muted darkness and warm light, contrasty, with darkened corners. Colour
 * curves run on the tone-mapped picture and split it by brightness into thirds; at night nearly
 * everything falls in the shadows third, so that is where most of the look comes from.
 */
export function gradePicture(config: ImageProcessingConfiguration): void {
  config.toneMappingEnabled = true;
  config.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  config.contrast = 1.2;
  config.exposure = 0.95;

  // Hue in degrees; density and saturation from -100 to 100. Babylon squares and halves density, so
  // 55 tints only 15%, and below about 30 the tint can't be seen. The tint multiplies, so it darkens.
  const curves = new ColorCurves();
  curves.shadowsHue = 220; // blue-grey darkness
  curves.shadowsDensity = 55;
  curves.shadowsSaturation = -20;
  curves.highlightsHue = 40; // lamps and flashlights stay warm and keep their colour
  curves.highlightsDensity = 35;
  curves.globalSaturation = -5;
  config.colorCurves = curves;
  config.colorCurvesEnabled = true;

  config.vignetteEnabled = true;
  config.vignetteWeight = 0.8;
  config.vignetteColor = new Color4(0, 0, 0, 0);
  config.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

  // The screen has 8 bits per channel: noise below one level keeps dark gradients, like the sky,
  // fog and vignette, from stepping.
  config.ditheringEnabled = true;
}

export const SHADOW_MAP_SIZE = quality === "high" ? 4096 : 2048;

/**
 * Draws a mesh at many fixed places. The copies never move, so last frame's matrices are the same
 * ones. Saying so up front matters: left to itself, Babylon only adds them after the first draw,
 * which WebGPU rejects once TAA asks for motion vectors.
 */
export function drawInstances(mesh: Mesh, matrices: Float32Array): void {
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
  mesh.thinInstanceSetBuffer("previousMatrix", matrices, 16, true);
  mesh.thinInstanceRefreshBoundingInfo();
}

/**
 * Screen-space ambient occlusion darkens where things meet, such as a box on the floor or a shelf
 * against a wall, on top of the occlusion models carry, baked by scripts/models/.
 */
const AMBIENT_OCCLUSION =
  quality === "high"
    ? { ratio: 1, samples: 32, radius: 1.5 }
    : { ratio: 0.5, samples: 16, radius: 1.5 };

/**
 * Post-processing for one camera; returns how to remove it, which must happen before the camera is
 * disposed. Each camera has its own pipelines because TAA keeps a history of the previous frames,
 * which the lobby camera and the player's camera must not share.
 */
export function addCameraEffects(scene: Scene, camera: Camera): () => void {
  // Half floats: ambient occlusion copies the picture before tone mapping, still linear and dark, and
  // in 8 bits its few dark levels show as bands once grading stretches the contrast.
  const ssao = new SSAO2RenderingPipeline(
    `ssao-${camera.name}`,
    scene,
    { ssaoRatio: AMBIENT_OCCLUSION.ratio, blurRatio: AMBIENT_OCCLUSION.ratio },
    [camera],
    false,
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  ssao.samples = AMBIENT_OCCLUSION.samples;
  ssao.radius = AMBIENT_OCCLUSION.radius;
  ssao.totalStrength = 1;
  ssao.expensiveBlur = true;

  // After ambient occlusion, so its noise is smoothed over frames along with the rest. Half floats
  // for the same reason as ambient occlusion. Its history can smear a moving picture: `factor`, how
  // much of each new frame it takes (default 0.05), is the setting to tune.
  const taa = new TAARenderingPipeline(
    `taa-${camera.name}`,
    scene,
    [camera],
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  taa.samples = 16;
  taa.reprojectHistory = true;
  taa.clampHistory = true;
  taa.disableOnCameraMove = false;

  // The scene is drawn into the pre-pass target, so that's where multisampling goes.
  const prePass = scene.enablePrePassRenderer();
  if (prePass) prePass.samples = 4;

  const post = new DefaultRenderingPipeline(`post-${camera.name}`, true, scene, [camera]);
  post.bloomEnabled = true;
  post.bloomThreshold = 0.9;
  post.bloomWeight = 0.15;
  post.sharpenEnabled = true; // TAA softens the picture a little
  post.sharpen.edgeAmount = 0.2;

  return () => {
    post.dispose();
    taa.dispose();
    ssao.dispose();
  };
}
