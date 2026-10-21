/**
 * Damage: the entry points a shell (and, later, a breach AI) uses. Damage never
 * arrives as a cell mutation from outside — these two functions are the only way a
 * cell or a big block loses HP, so the debris outcome and the regeneration timer
 * cannot drift apart from the damage.
 */

import type { Rng } from '../rng.ts';
import { MATERIAL_PROFILES, secondsToTicks } from './constants.ts';
import { spawnDebris } from './debris.ts';
import { blockAt, cellAt, cellIndex, cellState, type World } from './state.ts';

/** What one `damageCell` call did. */
export interface CellDamageResult {
  /** HP actually removed (clamped to what the cell had left). */
  readonly damageApplied: number;
  readonly hpRemaining: number;
  /** True only when this call turned an intact cell into a hole. */
  readonly destroyedNow: boolean;
  readonly blocksSpawned: number;
  readonly shardsSpawned: number;
}

/** What one `damageBlock` call did. */
export interface BlockDamageResult {
  readonly damageApplied: number;
  readonly hpRemaining: number;
  readonly destroyedNow: boolean;
}

/**
 * Damages the cell at `(x, z)`. When it drops to 0 HP the cell becomes a hole and
 * yields the debris its material profile names, drawn from the seeded `rng`.
 *
 * A hole takes no damage: it has no material left, so this is a reported no-op rather
 * than an error — but the caller that gets `destroyedNow: false` and `damageApplied: 0`
 * has shot through a gap, which is a legitimate outcome (`isSolidAt` is the query that
 * says whether there was anything to hit).
 */
export function damageCell(world: World, x: number, z: number, amount: number, rng: Rng): CellDamageResult {
  const cell = cellAt(world, x, z);
  requireDamageAmount('damageCell', amount);

  if (cellState(cell) === 'hole') {
    return { damageApplied: 0, hpRemaining: 0, destroyedNow: false, blocksSpawned: 0, shardsSpawned: 0 };
  }

  const applied = Math.min(amount, cell.hp);
  cell.hp -= applied;
  // A fresh wound restarts the clock, so chipping at a wall never shortens the breach.
  cell.regenTicksRemaining = secondsToTicks(MATERIAL_PROFILES[cell.material].regenDelaySeconds);

  if (cell.hp > 0) {
    return { damageApplied: applied, hpRemaining: cell.hp, destroyedNow: false, blocksSpawned: 0, shardsSpawned: 0 };
  }

  const spawn = spawnDebris(world, cell, rng);
  return {
    damageApplied: applied,
    hpRemaining: 0,
    destroyedNow: true,
    blocksSpawned: spawn.blocks.length,
    shardsSpawned: spawn.shards.length,
  };
}

/**
 * Damages the big block in `(x, z)`; at 0 HP the rubble is gone and the cell's
 * regeneration timer — frozen while the block stood — can run again.
 */
export function damageBlock(world: World, x: number, z: number, amount: number): BlockDamageResult {
  requireDamageAmount('damageBlock', amount);
  const block = blockAt(world, x, z);
  if (!block) {
    throw new Error(`world.damageBlock: no big block at (${x}, ${z})`);
  }
  const applied = Math.min(amount, block.hp);
  block.hp -= applied;
  if (block.hp > 0) {
    return { damageApplied: applied, hpRemaining: block.hp, destroyedNow: false };
  }
  world.blocks.delete(cellIndex(world, x, z));
  return { damageApplied: applied, hpRemaining: 0, destroyedNow: true };
}

function requireDamageAmount(label: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`world.${label}: damage amount must be finite and > 0, got ${amount}`);
  }
}
