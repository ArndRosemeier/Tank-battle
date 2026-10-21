import { describe, expect, it } from 'vitest';
import { FixedStep, MAX_FRAME_SECONDS, STEP_SECONDS } from './timestep.ts';

describe('FixedStep', () => {
  it('runs one slice per whole step and keeps the remainder', () => {
    const accumulator = new FixedStep(0.01, 1);
    const seen: number[] = [];

    const steps = accumulator.advance(0.035, (dt) => seen.push(dt));

    expect(steps).toBe(3);
    expect(seen).toEqual([0.01, 0.01, 0.01]);
    expect(accumulator.alpha).toBeCloseTo(0.5, 10);
  });

  it('runs exactly 60 slices for 60 frames of one 60 Hz slice, so the clock cannot drift', () => {
    const accumulator = new FixedStep();
    let steps = 0;

    for (let i = 0; i < 60; i += 1) {
      accumulator.advance(STEP_SECONDS, () => {
        steps += 1;
      });
    }

    expect(steps).toBe(60);
  });

  it('credits a long frame as at most maxFrame, so the simulation cannot spiral', () => {
    const accumulator = new FixedStep(0.01, 0.25);
    let steps = 0;

    accumulator.advance(10, () => {
      steps += 1;
    });

    // 10 s would be 1000 slices; the clamp caps the frame credit at 0.25 s = 25.
    expect(steps).toBe(25);
  });

  it('runs no slice for a zero-length frame', () => {
    const accumulator = new FixedStep(0.01, 1);
    const steps = accumulator.advance(0, () => {
      throw new Error('must not step');
    });

    expect(steps).toBe(0);
    expect(accumulator.alpha).toBe(0);
  });

  it('drops the sub-step remainder on reset', () => {
    const accumulator = new FixedStep(0.01, 1);
    accumulator.advance(0.019, () => undefined);
    expect(accumulator.alpha).toBeCloseTo(0.9, 10);

    accumulator.reset();

    expect(accumulator.alpha).toBe(0);
  });

  it('rejects a frame time that is negative or not finite', () => {
    const accumulator = new FixedStep(0.01, 1);

    expect(() => accumulator.advance(-0.01, () => undefined)).toThrow(/frameSeconds/);
    expect(() => accumulator.advance(Number.NaN, () => undefined)).toThrow(/frameSeconds/);
  });

  it('rejects a step that is not positive, or a maxFrame below the step', () => {
    expect(() => new FixedStep(0, 1)).toThrow(/step/);
    expect(() => new FixedStep(Number.NaN, 1)).toThrow(/step/);
    expect(() => new FixedStep(0.1, 0.05)).toThrow(/maxFrame/);
  });

  it('defaults to a 60 Hz slice with a quarter-second clamp', () => {
    const accumulator = new FixedStep();

    expect(accumulator.step).toBe(STEP_SECONDS);
    expect(accumulator.maxFrame).toBe(MAX_FRAME_SECONDS);
  });
});
