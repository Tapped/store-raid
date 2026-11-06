import type { ImageProcessingConfiguration } from "@babylonjs/core";
import { RUN_AGAIN } from "../../shared/constants";

/** Stamina above this doesn't show, and at 0 tiredness is full. */
const SHOWS_BELOW = 0.6;
/** How quickly the effect follows stamina, per second. */
const SMOOTHING = 3;
/** Breaths per second when slightly tired, and when winded. */
const CALM_BREATHING = 0.6;
const HEAVY_BREATHING = 1.4;

/**
 * At full tiredness the vignette reaches in from every edge, round rather than just in the corners:
 * Babylon's vignette darkens by distance from the centre scaled by its field of view, raised to its
 * weight. Then how much colour drains, and how much the light dims on each breath in.
 */
const VIGNETTE_FOV = 1.2;
const VIGNETTE_WEIGHT = 1.6;
/** How much more the vignette closes in at the top of each breath. */
const VIGNETTE_BREATH = 0.5;
const DESATURATE = 70;
const BREATH_DIM = 0.18;

/**
 * Being tired, on the screen: the corners close in and the picture drains of colour, both pulsing
 * with heavy breaths. It changes the scene's picture grading, which is fine with one player per
 * screen, and puts it back as it was when the player is rested.
 */
export class TiredEffect {
  private readonly vignette: { weight: number; fov: number; stretch: number };
  private readonly saturation: number;
  private readonly exposure: number;
  private tiredness = 0;
  /** Where in a breath we are, in breaths. */
  private breath = 0;

  constructor(private readonly config: ImageProcessingConfiguration) {
    this.vignette = {
      weight: config.vignetteWeight,
      fov: config.vignetteCameraFov,
      stretch: config.vignetteStretch,
    };
    this.saturation = config.colorCurves?.globalSaturation ?? 0;
    this.exposure = config.exposure;
  }

  /** The breath now, from -1 out to 1 in, weighted by tiredness: for a camera heave. */
  get heave(): number {
    return Math.sin(this.breath * 2 * Math.PI) * this.tiredness;
  }

  /** Once per frame, with the player's stamina (1 when there's no player) and whether they're winded. */
  update(stamina: number, winded: boolean, dt: number): void {
    const tired = (s: number) => Math.min(1, Math.max(0, (SHOWS_BELOW - s) / SHOWS_BELOW));
    // Winded lasts while stamina comes back, so it eases from full to what that stamina shows.
    const target = winded
      ? 1 - (1 - tired(RUN_AGAIN)) * Math.min(1, stamina / RUN_AGAIN)
      : tired(stamina);
    this.tiredness += (target - this.tiredness) * (1 - Math.exp(-SMOOTHING * dt));
    this.breath =
      (this.breath + dt * (CALM_BREATHING + (HEAVY_BREATHING - CALM_BREATHING) * this.tiredness)) %
      1;

    // Breaths in close the picture in: 0 between breaths, 1 at the top of one.
    const pulse = 0.5 - 0.5 * Math.cos(this.breath * 2 * Math.PI);
    const t = this.tiredness;
    const { weight, fov, stretch } = this.vignette;
    this.config.vignetteCameraFov = fov + (VIGNETTE_FOV - fov) * t;
    this.config.vignetteStretch = stretch + (1 - stretch) * t;
    this.config.vignetteWeight = weight + (VIGNETTE_WEIGHT - weight + VIGNETTE_BREATH * pulse) * t;
    this.config.exposure = this.exposure * (1 - BREATH_DIM * t * pulse);
    if (this.config.colorCurves) {
      this.config.colorCurves.globalSaturation = this.saturation - DESATURATE * t;
    }
  }

  /** Puts the picture back as it was. */
  dispose(): void {
    this.config.vignetteWeight = this.vignette.weight;
    this.config.vignetteCameraFov = this.vignette.fov;
    this.config.vignetteStretch = this.vignette.stretch;
    this.config.exposure = this.exposure;
    if (this.config.colorCurves) this.config.colorCurves.globalSaturation = this.saturation;
  }
}
