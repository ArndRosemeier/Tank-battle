import { describe, expect, it } from 'vitest';
import * as detMath from './detMath.ts';

describe('detMath', () => {
  it('returns pinned bits, so a library update that changes a result is caught here', () => {
    // These exact doubles are what every browser computes; online peers rely on it.
    expect(detMath.sin(1)).toBe(0.8414709848078965);
    expect(detMath.cos(1)).toBe(0.5403023058681398);
    expect(detMath.tan(1)).toBe(1.5574077246549023);
    expect(detMath.atan2(1, 2)).toBe(0.4636476090008061);
    expect(detMath.sin(1e6)).toBe(-0.34999350217129294);
    expect(detMath.cos(-123.456)).toBe(-0.5947139710921574);
    expect(detMath.atan2(-0.3, -0.7)).toBe(-2.7367008673047097);
    expect(detMath.hypot(3, 4)).toBe(5);
    expect(detMath.hypot(1, 2, 2)).toBe(3);
  });

  it('stays within one ulp-scale error of the engine functions', () => {
    for (let i = -500; i <= 500; i += 1) {
      const x = i * 0.0731;
      expect(Math.abs(detMath.sin(x) - Math.sin(x))).toBeLessThan(1e-15);
      expect(Math.abs(detMath.cos(x) - Math.cos(x))).toBeLessThan(1e-15);
      expect(Math.abs(detMath.atan2(x, 1.3) - Math.atan2(x, 1.3))).toBeLessThan(1e-15);
    }
  });
});
