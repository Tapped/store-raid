import type { ImageProcessingConfiguration } from "@babylonjs/core";
import { applyGrade, CURVES, GRADE } from "./graphics";
import { tunables } from "./tuning";

/**
 * How being tired looks. At full tiredness the vignette reaches in from every edge, round rather
 * than just in the corners: Babylon's vignette darkens by distance from the centre scaled by its
 * field of view, raised to its weight.
 */
const TIRED = tunables("Feel/Tired", {
  showsBelow: { value: 0.6, min: 0.05, max: 1, hint: "Stamina above this doesn't show" },
  smoothing: {
    value: 3,
    min: 0.2,
    max: 20,
    hint: "How quickly the effect follows stamina, per second",
  },
  calmBreathing: { value: 0.6, min: 0.1, max: 3, hint: "Breaths per second when slightly tired" },
  heavyBreathing: { value: 1.4, min: 0.1, max: 4, hint: "Breaths per second when winded" },
  vignetteFov: { value: 1.2, min: 0.1, max: 3, hint: "The vignette's reach at full tiredness" },
  vignetteWeight: { value: 1.6, min: 0, max: 6, hint: "The vignette's strength at full tiredness" },
  vignetteBreath: {
    value: 0.5,
    min: 0,
    max: 3,
    hint: "How much more it closes in at the top of a breath",
  },
  desaturate: {
    value: 70,
    min: 0,
    max: 100,
    step: 1,
    hint: "How much colour drains at full tiredness",
  },
  breathDim: { value: 0.18, min: 0, max: 1, hint: "How much the light dims on each breath in" },
});

/**
 * Being tired, on the screen: the corners close in and the picture drains of colour, both pulsing
 * with heavy breaths. It changes the scene's picture grading, which is fine with one player per
 * screen, on top of the grade's own settings (graphics.ts), and puts it back as the grade has it
 * when the player is rested.
 */
export class TiredEffect {
  /** Babylon's vignette shape, which the grade doesn't set. */
  private readonly vignette: { fov: number; stretch: number };
  private tiredness = 0;
  /** Where in a breath we are, in breaths. */
  private breath = 0;

  constructor(private readonly config: ImageProcessingConfiguration) {
    this.vignette = { fov: config.vignetteCameraFov, stretch: config.vignetteStretch };
  }

  /** The breath now, from -1 out to 1 in, weighted by tiredness: for a camera heave. */
  get heave(): number {
    return Math.sin(this.breath * 2 * Math.PI) * this.tiredness;
  }

  /**
   * Once per frame, with the player's stamina (1 when there's no player), whether they're winded,
   * and the stamina they can run again at (the room's `runAgain`).
   */
  update(stamina: number, winded: boolean, runAgain: number, dt: number): void {
    const { showsBelow } = TIRED;
    const tired = (s: number) => Math.min(1, Math.max(0, (showsBelow - s) / showsBelow));
    // Winded lasts while stamina comes back, so it eases from full to what that stamina shows.
    const target = winded
      ? 1 - (1 - tired(runAgain)) * Math.min(1, stamina / Math.max(runAgain, 1e-6))
      : tired(stamina);
    this.tiredness += (target - this.tiredness) * (1 - Math.exp(-TIRED.smoothing * dt));
    const rate =
      TIRED.calmBreathing + (TIRED.heavyBreathing - TIRED.calmBreathing) * this.tiredness;
    this.breath = (this.breath + dt * rate) % 1;

    // Breaths in close the picture in: 0 between breaths, 1 at the top of one.
    const pulse = 0.5 - 0.5 * Math.cos(this.breath * 2 * Math.PI);
    const t = this.tiredness;
    const { fov, stretch } = this.vignette;
    const weight = GRADE.vignetteWeight;
    this.config.vignetteCameraFov = fov + (TIRED.vignetteFov - fov) * t;
    this.config.vignetteStretch = stretch + (1 - stretch) * t;
    this.config.vignetteWeight =
      weight + (TIRED.vignetteWeight - weight + TIRED.vignetteBreath * pulse) * t;
    this.config.exposure = GRADE.exposure * (1 - TIRED.breathDim * t * pulse);
    if (this.config.colorCurves) {
      this.config.colorCurves.globalSaturation = CURVES.globalSaturation - TIRED.desaturate * t;
    }
  }

  /** Puts the picture back as the grade has it. */
  dispose(): void {
    this.config.vignetteCameraFov = this.vignette.fov;
    this.config.vignetteStretch = this.vignette.stretch;
    applyGrade(this.config);
  }
}
