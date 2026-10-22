/**
 * The seeded deterministic PRNG — the ONE source of randomness in the simulation.
 *
 * Why it is not `Math.random`: the batch rig compares seeded matches, the world
 * model's state hash asserts that two identical runs stay byte-identical, and a
 * future authoritative server has to reproduce a client's tick. Every one of those
 * is noise if the sequence is not reproducible.
 *
 * **mulberry32** is chosen for the discipline it forces: a 32-bit integer state and
 * integer-only mixing (`Math.imul`, shifts, xor). IEEE-754 doubles then do exactly
 * the same thing on every JavaScript engine for a given seed — no trigonometry, no
 * engine-defined rounding, no clock. `next()` is `state / 2^32`, which is exact.
 *
 * A source-scanning pin in `src/core/purity.test.ts` makes `Math.random` a build
 * failure inside this directory, so this file stays the only way to draw numbers.
 */

/** A seeded draw source. Same seed → the identical sequence, every run. */
export interface Rng {
  /** A float in `[0, 1)`. */
  next(): number;
  /** An integer in `[0, maxExclusive)`. */
  int(maxExclusive: number): number;
  /**
   * The current 32-bit internal state, read-only. A simulation hash must include it:
   * a state can look identical while sitting at a different point in the draw sequence,
   * and the next debris angle would then differ. Read it; never set it.
   */
  readonly state: number;
}

/** The seed space: a 32-bit unsigned integer. */
export const RNG_SEED_LIMIT = 0x1_0000_0000;

/**
 * Creates a draw source from `seed`, an integer in `[0, 2^32)`.
 *
 * The seed is NOT masked: a seed outside the state width would alias another seed's
 * sequence, which is exactly the kind of silent surprise this project refuses.
 */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed >= RNG_SEED_LIMIT) {
    throw new Error(`rng: seed must be an integer in [0, ${RNG_SEED_LIMIT}), got ${seed}`);
  }

  let state = seed >>> 0;

  const next = (): number => {
    // 32-bit integer state, kept exact by masking every step (an unmasked sum would
    // leave the safe-integer range after ~4.7e6 draws and silently lose the low bits).
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = t ^ (t + Math.imul(t ^ (t >>> 7), t | 61));
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`rng.int: maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  return {
    next,
    int,
    get state() {
      return state;
    },
  };
}
