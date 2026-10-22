import { describe, expect, it } from 'vitest';
import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  directionFromAim,
  forwardFromYaw,
} from '../core/sim.ts';
import {
  AIM_YAW_OFFSET_MAX_DEGREES,
  commandFromInput,
  idlePlayerInput,
  normalisePointerAxis,
  scalePlayerInput,
  type PlayerInput,
} from './input.ts';

function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { ...idlePlayerInput(), ...overrides };
}

describe('the pure input mapping', () => {
  it('maps WASD to throttle and steer without touching the centre aim', () => {
    const forward = commandFromInput(input({ forward: true }), 0);
    expect(forward).toMatchObject({ throttle: 1, steer: 0, aimYaw: 0, aimPitch: 0 });
    expect(commandFromInput(input({ backward: true }), 0).throttle).toBe(-1);
    expect(commandFromInput(input({ left: true }), 0).steer).toBe(1);
    expect(commandFromInput(input({ right: true }), 0).steer).toBe(-1);
    expect(commandFromInput(input({ forward: true, backward: true }), 0).throttle).toBe(0);
    expect(commandFromInput(input({ left: true, right: true }), 0).steer).toBe(0);
  });

  it('moving the pointer RIGHT aims RIGHT, and the offset is clamped at +-60 degrees', () => {
    // Semantic, not arithmetic: this is the direction a player feels. Positive yaw turns
    // LEFT in this simulation, so a right-hand pointer must DECREASE the aim yaw.
    const aimedRight = commandFromInput(input({ pointerX: 0.5 }), 0);
    const rightForward = forwardFromYaw(aimedRight.aimYaw);
    expect(rightForward.x).toBeGreaterThan(0.4); // points to +X, i.e. right of -Z
    expect(rightForward.z).toBeLessThan(-0.8); // and still forward, not sideways

    const aimedLeft = commandFromInput(input({ pointerX: -0.5 }), 0);
    const leftForward = forwardFromYaw(aimedLeft.aimYaw);
    expect(leftForward.x).toBeLessThan(-0.4);
    expect(leftForward.z).toBeLessThan(-0.8);

    // The offset is relative to the hull: half-right at hull 0 is half-left in yaw terms.
    expect(commandFromInput(input({ pointerX: 0.5 }), 0).aimYaw).toBe(-AIM_YAW_OFFSET_MAX_DEGREES / 2);
    // And it is an offset, not an absolute angle: the same pointer follows the hull.
    expect(commandFromInput(input({ pointerX: 0.5 }), 40).aimYaw).toBe(40 - AIM_YAW_OFFSET_MAX_DEGREES / 2);

    // Clamped at the frame edges, whatever the pointer reports.
    expect(commandFromInput(input({ pointerX: 9 }), 0).aimYaw).toBe(-AIM_YAW_OFFSET_MAX_DEGREES);
    expect(commandFromInput(input({ pointerX: -9 }), 0).aimYaw).toBe(AIM_YAW_OFFSET_MAX_DEGREES);
    // Yaw wraps, not clamps: 170 deg minus 60 deg stays 110 deg in the canonical range.
    expect(commandFromInput(input({ pointerX: 1 }), 170).aimYaw).toBe(110);
  });

  it('normalises a client pointer so the right half is positive x and the top half is negative y', () => {
    expect(normalisePointerAxis(150, 100, 100)).toBe(0);
    expect(normalisePointerAxis(199, 100, 100)).toBeGreaterThan(0.9); // right edge
    expect(normalisePointerAxis(100, 100, 100)).toBe(-1); // left edge
    expect(normalisePointerAxis(-50, 100, 100)).toBe(-1); // clamped outside
    expect(normalisePointerAxis(400, 100, 100)).toBe(1); // clamped outside
    expect(() => normalisePointerAxis(10, 0, 0)).toThrow(/size/);
  });

  it('moving the pointer UP aims UP (positive pitch), with centre = zero', () => {
    const up = commandFromInput(input({ pointerY: -1 }), 0);
    expect(directionFromAim(up.aimYaw, up.aimPitch).y).toBeGreaterThan(0.3);
    const down = commandFromInput(input({ pointerY: 1 }), 0);
    expect(directionFromAim(down.aimYaw, down.aimPitch).y).toBeLessThan(-0.3);
    expect(commandFromInput(input({ pointerY: 0 }), 0).aimPitch).toBe(0);
    expect(commandFromInput(input({ pointerY: -1 }), 0).aimPitch).toBe(AIM_PITCH_MAX_DEGREES);
    expect(commandFromInput(input({ pointerY: 1 }), 0).aimPitch).toBe(AIM_PITCH_MIN_DEGREES);
    expect(commandFromInput(input({ pointerY: -9 }), 0).aimPitch).toBe(AIM_PITCH_MAX_DEGREES);
    expect(commandFromInput(input({ pointerY: 9 }), 0).aimPitch).toBe(AIM_PITCH_MIN_DEGREES);
  });

  it('passes the fire state through and rejects non-finite pointer input', () => {
    expect(commandFromInput(input({ fire: true }), 0).fire).toBe(true);
    expect(() => commandFromInput(input({ pointerX: Number.NaN }), 0)).toThrow(/pointerX/);
    expect(() => commandFromInput(input({ pointerY: Number.POSITIVE_INFINITY }), 0)).toThrow(
      /pointerY/,
    );
  });

  it('scales the pointer aim by the user sensitivity and clamps it', () => {
    const scaled = scalePlayerInput(input({ pointerX: 0.5, pointerY: -0.25 }), 2);
    expect(scaled.pointerX).toBe(1);
    expect(scaled.pointerY).toBe(-0.5);
    expect(scalePlayerInput(input({ pointerX: 0.3 }), 0.5).pointerX).toBeCloseTo(0.15, 10);
    expect(() => scalePlayerInput(input(), 0)).toThrow(/sensitivity/);
    expect(() => scalePlayerInput(input(), Number.NaN)).toThrow(/sensitivity/);
  });
});
