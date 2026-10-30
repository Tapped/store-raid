import {
  type AbstractEngine,
  type Camera,
  type Color4,
  DefaultRenderingPipeline,
  Engine,
  type Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  TAARenderingPipeline,
  WebGPUEngine,
} from "@babylonjs/core";

export type Quality = "balanced" | "high";

/** Balanced everywhere; `?quality=high` asks for all the effects. */
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

/** The sky colour as written; the high pipeline gamma-corrects it, so it needs to start out linear. */
export function skyColor(color: Color4): Color4 {
  return quality === "high" ? color.toLinearSpace() : color;
}

export const SHADOW_MAP_SIZE = quality === "high" ? 4096 : 2048;

/**
 * Post-processing for one camera; returns how to remove it, which must happen before the camera is
 * disposed. Each camera has its own pipelines because TAA keeps a history of the previous frames,
 * and split panes sharing one would blend each other's pictures.
 */
export function addCameraEffects(scene: Scene, camera: Camera): () => void {
  if (quality === "balanced") return () => {};

  // TAA has to come first.
  const taa = new TAARenderingPipeline(`taa-${camera.name}`, scene, [camera]);
  taa.samples = 16;
  taa.msaaSamples = 4;
  taa.reprojectHistory = true;
  taa.clampHistory = true;
  taa.disableOnCameraMove = false;

  const ssao = new SSAO2RenderingPipeline(
    `ssao-${camera.name}`,
    scene,
    { ssaoRatio: 1, blurRatio: 1 },
    [camera],
  );
  ssao.samples = 16;
  ssao.radius = 1.5;
  ssao.totalStrength = 1;
  ssao.expensiveBlur = true;

  const post = new DefaultRenderingPipeline(`post-${camera.name}`, true, scene, [camera]);
  post.samples = 4;
  post.bloomEnabled = true;
  post.bloomThreshold = 0.9;
  post.bloomWeight = 0.15;
  post.sharpenEnabled = true; // TAA softens the picture a little
  post.sharpen.edgeAmount = 0.2;

  return () => {
    post.dispose();
    ssao.dispose();
    taa.dispose();
  };
}
