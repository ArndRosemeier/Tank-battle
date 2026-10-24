/**
 * Deterministic math: the ONE source of trigonometry and vector length for the
 * simulation and everything that feeds it.
 *
 * Why not `Math.sin` and friends: the JavaScript spec only asks them to be
 * "implementation-approximated", so V8 (Chrome), SpiderMonkey (Firefox) and
 * JavaScriptCore (Safari) may differ in the last bit. Online play runs one simulation
 * per browser from the same commands, and a one-bit difference eventually turns a hit
 * into a miss. These functions are stdlib's pure-JavaScript ports of FreeBSD's msun
 * (fdlibm). They use only + - * /, bit operations and `Math.sqrt`/`floor`/`abs`/`fround`,
 * which IEEE 754 makes exact, so every engine returns the same bits.
 *
 * A source pin in `purity.test.ts` keeps `Math.sin/cos/tan/atan2/hypot/...` out of
 * `src/core` and `src/game`.
 */

import stdAtan2 from '@stdlib/math-base-special-atan2';
import stdCos from '@stdlib/math-base-special-cos';
import stdSin from '@stdlib/math-base-special-sin';
import stdTan from '@stdlib/math-base-special-tan';

export const sin: (radians: number) => number = stdSin;
export const cos: (radians: number) => number = stdCos;
export const tan: (radians: number) => number = stdTan;
export const atan2: (y: number, x: number) => number = stdAtan2;

/**
 * sqrt(x² + y² [+ z²]): products, a sum and `Math.sqrt` are all exactly rounded, so
 * every engine agrees. Unlike `Math.hypot` it does not guard against overflow, which
 * world-scale metres never come near; it is also the hot path of the AI, so it stays
 * this cheap.
 */
export function hypot(x: number, y: number, z = 0): number {
  return Math.sqrt(x * x + y * y + z * z);
}
