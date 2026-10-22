import { describe, expect, it } from 'vitest';
import {
  commandFromAim,
  idlePlayerInput,
  normalisePointerAxis,
  type PlayerInput,
} from './input.ts';

function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { ...idlePlayerInput(), ...overrides };
}

describe('the pure button→command mapping', () => {
  it('maps WASD to throttle and steer and carries the solver angles through', () => {
    const forward = commandFromAim(input({ forward: true }), -12, 7);
    expect(forward).toMatchObject({ throttle: 1, steer: 0, aimYaw: -12, aimPitch: 7 });
    expect(commandFromAim(input({ backward: true }), 0, 0).throttle).toBe(-1);
    expect(commandFromAim(input({ left: true }), 0, 0).steer).toBe(1);
    expect(commandFromAim(input({ right: true }), 0, 0).steer).toBe(-1);
    expect(commandFromAim(input({ forward: true, backward: true }), 0, 0).throttle).toBe(0);
    expect(commandFromAim(input({ left: true, right: true }), 0, 0).steer).toBe(0);
  });

  it('does not read the pointer: the world solver owns the aim', () => {
    // P6 retired the hull-relative pointer offset. Moving the pointer without moving the
    // camera/solver must not produce a different command; otherwise a second, hidden
    // aim mapping would still exist here.
    const centre = commandFromAim(input(), 23, -4);
    const corner = commandFromAim(input({ pointerX: 0.9, pointerY: -0.9 }), 23, -4);
    expect(corner).toEqual(centre);
    expect(corner.aimYaw).toBe(23);
    expect(corner.aimPitch).toBe(-4);
  });

  it('wraps the absolute yaw and keeps the requested pitch', () => {
    expect(commandFromAim(input(), 190, -30).aimYaw).toBe(-170);
    expect(commandFromAim(input(), -190, 25).aimYaw).toBe(170);
    expect(commandFromAim(input(), 0, 25).aimPitch).toBe(25);
    expect(commandFromAim(input(), 0, -30).aimPitch).toBe(-30);
  });

  it('normalises a client pointer so the right half is positive x and the top half is negative y', () => {
    expect(normalisePointerAxis(150, 100, 100)).toBe(0);
    expect(normalisePointerAxis(199, 100, 100)).toBeGreaterThan(0.9); // right edge
    expect(normalisePointerAxis(100, 100, 100)).toBe(-1); // left edge
    expect(normalisePointerAxis(-50, 100, 100)).toBe(-1); // clamped outside
    expect(normalisePointerAxis(400, 100, 100)).toBe(1); // clamped outside
    expect(() => normalisePointerAxis(10, 0, 0)).toThrow(/size/);
  });

  it('passes fire through and rejects non-finite aim angles', () => {
    expect(commandFromAim(input({ fire: true }), 0, 0).fire).toBe(true);
    expect(() => commandFromAim(input(), Number.NaN, 0)).toThrow(/aimYaw/);
    expect(() => commandFromAim(input(), 0, Number.POSITIVE_INFINITY)).toThrow(/aimPitch/);
  });
});
