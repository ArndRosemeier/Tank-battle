/**
 * The per-tick team resolution order.
 *
 * The simulation still applies each tank's intent sequentially (movement, muzzle
 * collision, shell damage), so any fixed order gives the first team an advantage over
 * thousands of ticks. The order is therefore a pure rotation of the team ids, seeded
 * by `(match seed, tick)`: every `teamCount` ticks each team occupies every rank
 * exactly once. It depends on nothing else — not spawn, position, team array order or
 * tank id.
 */

/** A deterministic per-tick rotation of the match's team ids. */
export function teamTurnOrder(
  seed: number,
  tick: number,
  teamIds: readonly number[],
): readonly number[] {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error(`turnOrder: seed must be a non-negative safe integer, got ${String(seed)}`);
  }
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(`turnOrder: tick must be a non-negative integer, got ${String(tick)}`);
  }
  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    throw new Error('turnOrder: teamIds must be a non-empty array');
  }
  const sorted = [...new Set(teamIds)].sort((a, b) => a - b);
  if (sorted.length !== teamIds.length) {
    throw new Error('turnOrder: team ids must be unique');
  }
  for (const teamId of sorted) {
    if (!Number.isInteger(teamId) || teamId < 0) {
      throw new Error(`turnOrder: team id must be a non-negative integer, got ${String(teamId)}`);
    }
  }
  const rotation = ((seed >>> 0) + tick) % sorted.length;
  return [...sorted.slice(rotation), ...sorted.slice(0, rotation)];
}
