import { describe, expect, it } from 'vitest';
import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
} from '../core/sim.ts';
import {
  AIM_YAW_OFFSET_MAX_DEGREES,
  commandFromInput,
  idlePlayerInput,
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

  it('turns the turret RELATIVE to the hull and clamps the offset', () => {
    const right = commandFromInput(input({ pointerX: 1 }), 40);
    expect(right.aimYaw).toBe(40 + AIM_YAW_OFFSET_MAX_DEGREES);
    const left = commandFromInput(input({ pointerX: -1 }), 40);
    expect(left.aimYaw).toBe(40 - AIM_YAW_OFFSET_MAX_DEGREES);
    expect(commandFromInput(input({ pointerX: 9 }), 0).aimYaw).toBe(AIM_YAW_OFFSET_MAX_DEGREES);
    expect(commandFromInput(input({ pointerX: -9 }), 0).aimYaw).toBe(-AIM_YAW_OFFSET_MAX_DEGREES);
    // Yaw wraps, not clamps: 170° + 60° is -130° in the simulation's canonical range.
    expect(commandFromInput(input({ pointerX: 1 }), 170).aimYaw).toBe(-130);
  });

  it('maps pointer height to a clamped pitch, with centre = zero', () => {
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
});
