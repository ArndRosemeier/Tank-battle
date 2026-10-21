import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

describe('createRng', () => {
  it('the same seed produces the identical sequence, every time', () => {
    // The GOLDEN vector is the algorithm's contract: it is the canonical mulberry32
    // stream, so a change here is a change to every seeded run in the project.
    const first = createRng(2026);
    const firstValues = Array.from({ length: 5 }, () => first.next());
    expect(firstValues).toEqual([
      0.45540769933722913, 0.30849614599719644, 0.6611574492417276, 0.6184752183035016,
      0.15228010178543627,
    ]);

    const again = createRng(2026);
    expect(Array.from({ length: 5 }, () => again.next())).toEqual(firstValues);

    const firstInts = createRng(2026);
    expect(Array.from({ length: 5 }, () => firstInts.int(16))).toEqual([7, 4, 10, 9, 2]);

    const other = createRng(1);
    expect(Array.from({ length: 5 }, () => other.next())).not.toEqual(firstValues);
  });

  it('int(maxExclusive) stays inside its bound, and a bound or seed that cannot be drawn from is rejected loudly', () => {
    const rng = createRng(42);
    for (let draw = 0; draw < 1000; draw += 1) {
      const value = rng.int(16);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(16);
      expect(Number.isInteger(value)).toBe(true);
    }

    expect(() => createRng(-1)).toThrow(/seed/);
    expect(() => createRng(2 ** 32)).toThrow(/seed/);
    expect(() => createRng(1.5)).toThrow(/seed/);
    expect(() => rng.int(0)).toThrow(/maxExclusive/);
    expect(() => rng.int(-2)).toThrow(/maxExclusive/);
    expect(() => rng.int(1.5)).toThrow(/maxExclusive/);
  });
});
