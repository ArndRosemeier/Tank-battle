/**
 * Debris: the two tiers the owner asked for, and the only geometry that touches them.
 *
 *  - **Big block** — rubble from a destroyed wall/pillar. Static, occupies one cell,
 *    blocks movement and shells, has its own HP, and holds that cell's regeneration
 *    frozen until it is destroyed. Not capped.
 *  - **Shard** — the floor's shards. Small, shoved by a tank one cell at a time,
 *    deflects a shell at a FIXED mirror angle, shatters on a hit, and is absorbed by a
 *    cell that heals under it. Globally capped, oldest first.
 *
 * No trigonometry here: the mirror normals are literals so every JavaScript engine
 * computes the identical reflection (the defect class a transcendental would hide).
 */

import type { Rng } from '../rng.ts';
import {
  BLOCK_HEIGHT_METRES,
  BLOCK_MAX_HP,
  MATERIAL_PROFILES,
  MIRROR_ANGLE_STEP_DEGREES,
  MIRROR_ANGLE_STEPS,
  SHARD_CAP,
} from './constants.ts';
import { cellIndex, isCellPassable, markWorldChanged, type BigBlock, type Cell, type Shard, type World } from './state.ts';

/** A direction on the x/z plane. Not required to be normalised. */
export interface Direction {
  readonly x: number;
  readonly z: number;
}

/** What one destroyed cell left behind. */
export interface DebrisSpawn {
  readonly blocks: readonly BigBlock[];
  readonly shards: readonly Shard[];
}

/** Where a shard ended up after a shove, and whether it moved at all. */
export interface ShoveResult {
  readonly x: number;
  readonly z: number;
  readonly moved: boolean;
}

/** A 1-cell step. */
interface Step {
  readonly x: number;
  readonly z: number;
}

const cos2205 = 0.9238795325112867;
const sin2205 = 0.3826834323650898;
const cos45 = 0.7071067811865476;

/**
 * The mirror NORMALS, 22.5° apart, as literals: `MIRROR_NORMALS[i]` is the normal at
 * `i * MIRROR_ANGLE_STEP_DEGREES`. Literals (not `Math.cos`) because the point of the
 * table is that the double is identical on every engine and every machine.
 */
const MIRROR_NORMALS: readonly Direction[] = buildMirrorNormals([
  { x: 1, z: 0 },
  { x: cos2205, z: sin2205 },
  { x: cos45, z: cos45 },
  { x: sin2205, z: cos2205 },
  { x: 0, z: 1 },
  { x: -sin2205, z: cos2205 },
  { x: -cos45, z: cos45 },
  { x: -cos2205, z: sin2205 },
  { x: -1, z: 0 },
  { x: -cos2205, z: -sin2205 },
  { x: -cos45, z: -cos45 },
  { x: -sin2205, z: -cos2205 },
  { x: 0, z: -1 },
  { x: sin2205, z: -cos2205 },
  { x: cos45, z: -cos45 },
  { x: cos2205, z: -sin2205 },
]);

/** The 4-neighbourhood, in the fixed order that makes every choice below repeatable. */
const SHOVE_PERIPHERAL_ORDER: readonly Step[] = [
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

const SHOVE_LATERAL_ORDER: readonly Step[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
];

/**
 * Spawns the debris a destroyed cell yields, from the ONE material profile table, then
 * applies the shard cap. The caller (`damageCell`) owns the decision that the cell is
 * destroyed; this owns what that means.
 */
export function spawnDebris(world: World, cell: Cell, rng: Rng, markRevision = true): DebrisSpawn {
  const profile = MATERIAL_PROFILES[cell.material];
  const blocks: BigBlock[] = [];
  const shards: Shard[] = [];

  for (let index = 0; index < profile.debris.blocks; index += 1) {
    if (cell.material === 'floor') {
      throw new Error(`world: the ${cell.material} profile yields a big block, which only a wall or pillar can`);
    }
    const cellSlot = cellIndex(world, cell.x, cell.z);
    if (world.blocks.has(cellSlot)) {
      throw new Error(
        `world: a big block already holds (${cell.x}, ${cell.z}); a cell cannot be destroyed twice before it heals`,
      );
    }
    const block: BigBlock = {
      x: cell.x,
      z: cell.z,
      material: cell.material,
      heightMetres: BLOCK_HEIGHT_METRES,
      maxHp: BLOCK_MAX_HP,
      hp: BLOCK_MAX_HP,
    };
    world.blocks.set(cellSlot, block);
    blocks.push(block);
  }

  for (let index = 0; index < profile.debris.shards; index += 1) {
    const shard: Shard = {
      id: world.nextShardId,
      x: cell.x,
      z: cell.z,
      mirrorAngleDegrees: rng.int(MIRROR_ANGLE_STEPS) * MIRROR_ANGLE_STEP_DEGREES,
      bornTick: world.tick,
    };
    world.nextShardId += 1;
    world.shards.push(shard);
    shards.push(shard);
  }

  enforceShardCap(world);
  if (markRevision && (blocks.length > 0 || shards.length > 0)) {
    markWorldChanged(world);
  }

  return { blocks, shards };
}

/**
 * The shell's reflection at a shard: `d - 2(d·n)n` for the shard's stored normal.
 * A fixed mirror angle, never jitter — the owner chose determinism so the AI can learn
 * the geometry (ledger row 17).
 */
export function shardDeflection(shard: Shard, direction: Direction): Direction {
  requireDirection('shardDeflection', direction);
  const index = shard.mirrorAngleDegrees / MIRROR_ANGLE_STEP_DEGREES;
  const normal = Number.isInteger(index) ? MIRROR_NORMALS[index] : undefined;
  if (!normal) {
    throw new Error(
      `world: shard ${shard.id} has mirror angle ${shard.mirrorAngleDegrees}, which is not one of the ${MIRROR_ANGLE_STEPS} table steps`,
    );
  }
  const projection = direction.x * normal.x + direction.z * normal.z;
  return {
    x: direction.x - 2 * projection * normal.x,
    z: direction.z - 2 * projection * normal.z,
  };
}

/** Removes a shard because a shell hit it. Returns the shard that was there. */
export function shatterShard(world: World, shardId: number): Shard {
  const index = requireShardIndex(world, shardId);
  const shard = world.shards[index];
  if (!shard) {
    throw new Error(`world: shard ${shardId} is missing from the list`);
  }
  world.shards.splice(index, 1);
  markWorldChanged(world);
  return shard;
}

/**
 * Shoves a shard one cell along `direction`, because a tank overlapped it.
 *
 * A shard cannot be pushed into material its pusher could not stand in, so:
 *  1. try the requested cell;
 *  2. else slide one cell along the two perpendiculars, in a fixed order;
 *  3. else it stays where it is — a legitimate physical outcome, reported in `moved`,
 *     not an error and not a silent success.
 */
export function shoveShard(world: World, shardId: number, direction: Direction): ShoveResult {
  requireDirection('shoveShard', direction);
  const index = requireShardIndex(world, shardId);
  const shard = world.shards[index];
  if (!shard) {
    throw new Error(`world: shard ${shardId} is missing from the list`);
  }

  const requested = quantiseStep(direction);
  const steps: readonly Step[] =
    requested.x !== 0 ? [requested, ...SHOVE_PERIPHERAL_ORDER] : [requested, ...SHOVE_LATERAL_ORDER];

  for (const step of steps) {
    const x = shard.x + step.x;
    const z = shard.z + step.z;
    if (x < 0 || x >= world.columns || z < 0 || z >= world.rows) {
      continue;
    }
    if (!isCellPassable(world, x, z)) {
      continue;
    }
    shard.x = x;
    shard.z = z;
    markWorldChanged(world);
    return { x, z, moved: true };
  }

  return { x: shard.x, z: shard.z, moved: false };
}

/**
 * Removes every shard lying in `(x, z)` — the cell healed under them. Returns how many
 * were absorbed. Not an error when the cell is empty.
 */
export function absorbShardsIn(world: World, x: number, z: number, markRevision = true): number {
  cellIndex(world, x, z);
  const before = world.shards.length;
  for (let index = world.shards.length - 1; index >= 0; index -= 1) {
    const shard = world.shards[index];
    if (shard && shard.x === x && shard.z === z) {
      world.shards.splice(index, 1);
    }
  }
  const removed = before - world.shards.length;
  if (markRevision && removed > 0) {
    markWorldChanged(world);
  }
  return removed;
}

function enforceShardCap(world: World): void {
  while (world.shards.length > SHARD_CAP) {
    world.shards.shift();
  }
}

function requireShardIndex(world: World, shardId: number): number {
  const index = world.shards.findIndex((shard) => shard.id === shardId);
  if (index < 0) {
    throw new Error(`world: shard ${shardId} does not exist`);
  }
  return index;
}

function requireDirection(label: string, direction: Direction): void {
  if (!Number.isFinite(direction.x) || !Number.isFinite(direction.z)) {
    throw new Error(`${label}: direction must be finite, got (${direction.x}, ${direction.z})`);
  }
  if (direction.x === 0 && direction.z === 0) {
    throw new Error(`${label}: direction must not be zero`);
  }
}

/** The dominant axis of a direction, as a 1-cell step. Ties go to x, which is fixed. */
function quantiseStep(direction: Direction): Step {
  if (Math.abs(direction.x) >= Math.abs(direction.z)) {
    return { x: Math.sign(direction.x), z: 0 };
  }
  return { x: 0, z: Math.sign(direction.z) };
}

/** Fails loudly on a malformed table, so a mistyped literal cannot quietly bend shots. */
function buildMirrorNormals(normals: readonly Direction[]): readonly Direction[] {
  if (normals.length !== MIRROR_ANGLE_STEPS) {
    throw new Error(`world: the mirror table has ${normals.length} normals, expected ${MIRROR_ANGLE_STEPS}`);
  }
  for (const normal of normals) {
    const length = normal.x * normal.x + normal.z * normal.z;
    if (Math.abs(length - 1) > 1e-12) {
      throw new Error(`world: the mirror normal (${normal.x}, ${normal.z}) is not a unit vector`);
    }
  }
  return normals;
}
