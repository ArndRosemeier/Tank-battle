/**
 * Fixed-timestep accumulator — the ONE place that turns real frame time into
 * simulation steps.
 *
 * Why it exists: a game that steps by the raw frame delta behaves differently on a
 * 144 Hz monitor than on a 60 Hz one, and a single long frame (tab switch, GC pause)
 * either teleports everything or starts a death spiral of catch-up steps. Simulation
 * therefore advances in fixed `step` slices, and the frame handler only decides HOW
 * MANY slices are owed.
 *
 * The clamp is the anti-spiral rule: a frame longer than `maxFrame` is credited as
 * `maxFrame`, so the simulation slows down instead of running away.
 *
 * Every entry point validates its input and throws LOUDLY — a NaN frame time must
 * never be absorbed into silent zero steps.
 */

/** One simulation slice, in seconds. 60 Hz. */
export const STEP_SECONDS = 1 / 60;

/** The longest frame that is ever credited, in seconds. */
export const MAX_FRAME_SECONDS = 0.25;

/**
 * Tolerance for the whole-step comparison, in seconds.
 *
 * Floating point cannot represent 0.01 or 1/60 exactly, so subtracting a step leaves
 * a remainder that can be *just* under one step (measured: a 0.25 s frame at a 0.01 s
 * step owed 25 slices and produced 24). Without a tolerance the simulation silently
 * runs slow at some rates and not others — the defect this constant prevents. It is a
 * numeric tolerance in a time accumulator, NOT a swallowed error: malformed input
 * still throws.
 */
const STEP_TOLERANCE = 1e-9;

export class FixedStep {
  /** Seconds per simulation slice. */
  readonly step: number;
  /** Seconds credited per frame at most. */
  readonly maxFrame: number;
  private accumulator = 0;

  constructor(step: number = STEP_SECONDS, maxFrame: number = MAX_FRAME_SECONDS) {
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`FixedStep: step must be finite and > 0, got ${step}`);
    }
    if (!Number.isFinite(maxFrame) || maxFrame < step) {
      throw new Error(`FixedStep: maxFrame must be finite and >= step (${step}), got ${maxFrame}`);
    }
    this.step = step;
    this.maxFrame = maxFrame;
  }

  /**
   * Credits one frame and runs `onStep` once per whole slice owed.
   * Returns the number of slices run.
   */
  advance(frameSeconds: number, onStep: (stepSeconds: number) => void): number {
    if (!Number.isFinite(frameSeconds) || frameSeconds < 0) {
      throw new Error(`FixedStep.advance: frameSeconds must be finite and >= 0, got ${frameSeconds}`);
    }
    this.accumulator += Math.min(frameSeconds, this.maxFrame);

    let steps = 0;
    while (this.accumulator >= this.step - STEP_TOLERANCE) {
      this.accumulator -= this.step;
      steps += 1;
      onStep(this.step);
    }
    if (this.accumulator < 0) {
      this.accumulator = 0;
    }
    return steps;
  }

  /** Sub-step remainder in [0, 1) — the interpolation factor for rendering. */
  get alpha(): number {
    return this.accumulator / this.step;
  }

  /** Drops the sub-step remainder (a pause/resume boundary). */
  reset(): void {
    this.accumulator = 0;
  }
}
