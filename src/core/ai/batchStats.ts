/**
 * Summary statistics shared by the batch rigs. Linear-interpolated quantiles and the
 * arithmetic mean, with a loud error on an empty sample (stats of no matches are not
 * a result).
 */

/** The `fraction` quantile of an ASCENDING list, linearly interpolated. */
export function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error('batchStats: quantile of an empty list');
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error(`batchStats: fraction must be within 0…1, got ${String(fraction)}`);
  }
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? sorted[0]!;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('batchStats: mean of an empty list');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
