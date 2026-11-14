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
import { tunables } from "./tuning";

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
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        adaptToDeviceRatio: true,
        // Models' textures are KTX2 (ktx2.ts), which stay compressed on the GPU only as BC7: a
        // device has to be asked for that, or they're unpacked to four times the video memory.
        deviceDescriptor: { requiredFeatures: ["texture-compression-bc"] },
      });
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
export const GRADE = tunables(
  "Rendering/Picture",
  {
    exposure: { value: 0.95, min: 0.1, max: 3 },
    contrast: { value: 1.2, min: 0.5, max: 2.5 },
    toneMapping: { value: true, hint: "Khronos PBR neutral tone mapping" },
    vignetteWeight: { value: 0.8, min: 0, max: 5, hint: "How strongly the corners darken" },
    dithering: { value: true, hint: "Noise below one level, so dark gradients don't step" },
  },
  () => regrade(),
);

/**
 * Hue in degrees; density and saturation from -100 to 100. Babylon squares and halves density, so
 * 55 tints only 15%, and below about 30 the tint can't be seen. The tint multiplies, so it darkens.
 */
export const CURVES = tunables(
  "Rendering/Colour curves",
  {
    shadowsHue: { value: 220, min: 0, max: 360, step: 1, hint: "Blue-grey darkness" },
    shadowsDensity: { value: 55, min: 0, max: 100, step: 1 },
    shadowsSaturation: { value: -20, min: -100, max: 100, step: 1 },
    midtonesHue: { value: 0, min: 0, max: 360, step: 1 },
    midtonesDensity: { value: 0, min: 0, max: 100, step: 1 },
    midtonesSaturation: { value: 0, min: -100, max: 100, step: 1 },
    highlightsHue: {
      value: 40,
      min: 0,
      max: 360,
      step: 1,
      hint: "Lamps and flashlights stay warm",
    },
    highlightsDensity: { value: 35, min: 0, max: 100, step: 1 },
    highlightsSaturation: { value: 0, min: -100, max: 100, step: 1 },
    globalSaturation: { value: -5, min: -100, max: 100, step: 1 },
  },
  () => regrade(),
);

/** Every picture graded, to grade again when the settings change. */
const graded = new Set<ImageProcessingConfiguration>();

/**
 * Settings of the grade an environment changes for itself (the village grades its night apart),
 * applied over GRADE and CURVES. Levels without one are graded exactly as those say.
 */
export type GradeOverride = Partial<typeof GRADE & typeof CURVES>;
let override: (() => GradeOverride) | undefined;

/** Grades every picture with `get()`'s settings over the game's, from now on; regrade when they change. */
export function overrideGrade(get: (() => GradeOverride) | undefined): void {
  override = get;
  regrade();
}

export function gradePicture(config: ImageProcessingConfiguration): void {
  config.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  config.colorCurves = new ColorCurves();
  config.colorCurvesEnabled = true;
  config.vignetteEnabled = true;
  config.vignetteColor = new Color4(0, 0, 0, 0);
  config.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  graded.add(config);
  applyGrade(config);
}

/** Puts the grade's settings into a picture, as they are now. */
export function applyGrade(config: ImageProcessingConfiguration): void {
  const { toneMapping, contrast, exposure, vignetteWeight, dithering, ...curves } = {
    ...GRADE,
    ...CURVES,
    ...override?.(),
  };
  config.toneMappingEnabled = toneMapping;
  config.contrast = contrast;
  config.exposure = exposure;
  config.vignetteWeight = vignetteWeight;
  config.ditheringEnabled = dithering;
  if (config.colorCurves) Object.assign(config.colorCurves, curves);
}

export function regrade(): void {
  for (const config of graded) applyGrade(config);
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
  quality === "high" ? { ratio: 1, samples: 32 } : { ratio: 0.5, samples: 16 };

/** The post-processing's settings, applied to every camera's pipelines as they change. */
export const POST = tunables(
  "Rendering/Post-processing",
  {
    ssaoStrength: { value: 2, min: 0, max: 4, hint: "Contact shadows where things meet" },
    ssaoRadius: { value: 1.5, min: 0.1, max: 5, hint: "Meters around a point that darken it" },
    taaFactor: {
      value: 0.05,
      min: 0.01,
      max: 1,
      step: 0.01,
      hint: "How much of each new frame TAA takes: higher smears less but shimmers more",
    },
    bloom: { value: true },
    bloomThreshold: { value: 0.9, min: 0, max: 2, hint: "How bright a pixel must be to glow" },
    bloomWeight: { value: 0.15, min: 0, max: 1 },
    bloomKernel: {
      value: 64,
      min: 1,
      max: 256,
      step: 1,
      hint: "How far the glow spreads, in pixels",
    },
    sharpen: { value: true, hint: "TAA softens the picture a little" },
    sharpenEdge: { value: 0.2, min: 0, max: 2 },
    grain: { value: false },
    grainIntensity: { value: 30, min: 0, max: 100, step: 1 },
    chromaticAberration: { value: false },
    aberration: { value: 6, min: 0, max: 200, step: 1 },
  },
  () => {
    for (const pipelines of cameraPipelines) applyPost(pipelines);
  },
);

interface CameraPipelines {
  ssao: SSAO2RenderingPipeline;
  taa: TAARenderingPipeline;
  post: DefaultRenderingPipeline;
}

const cameraPipelines = new Set<CameraPipelines>();

function applyPost({ ssao, taa, post }: CameraPipelines) {
  ssao.totalStrength = POST.ssaoStrength;
  ssao.radius = POST.ssaoRadius;
  taa.factor = POST.taaFactor;
  post.bloomEnabled = POST.bloom;
  post.bloomThreshold = POST.bloomThreshold;
  post.bloomWeight = POST.bloomWeight;
  post.bloomKernel = POST.bloomKernel;
  post.sharpenEnabled = POST.sharpen;
  post.sharpen.edgeAmount = POST.sharpenEdge;
  post.grainEnabled = POST.grain;
  post.grain.intensity = POST.grainIntensity;
  post.chromaticAberrationEnabled = POST.chromaticAberration;
  post.chromaticAberration.aberrationAmount = POST.aberration;
}

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
  ssao.expensiveBlur = true;
  // Its pass binds the random texture only once it knows its camera, which it's told when the pass
  // before it runs. On a first frame where that pass's shader isn't ready yet but its own is, it
  // drew without it: WebGPU rejected the bind group and the render loop stopped. Told up front.
  const thin = (
    ssao as unknown as {
      _thinSSAORenderingPipeline?: { _ssaoPostProcess?: { camera: Camera | null } };
    }
  )._thinSSAORenderingPipeline?._ssaoPostProcess;
  if (thin && !thin.camera) thin.camera = camera;

  // After ambient occlusion, so its noise is smoothed over frames along with the rest. Half floats
  // for the same reason as ambient occlusion. Its history can smear a moving picture: `taaFactor`
  // is the setting to tune.
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
  const pipelines = { ssao, taa, post };
  applyPost(pipelines);
  cameraPipelines.add(pipelines);

  return () => {
    cameraPipelines.delete(pipelines);
    post.dispose();
    taa.dispose();
    ssao.dispose();
  };
}
