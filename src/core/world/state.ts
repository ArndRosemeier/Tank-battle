/**
 * The world's state: a grid of cells, the big blocks and shards standing in it, and
 * the queries that read it. Nothing here mutates except through the seams in
 * `destruction.ts`, `debris.ts` and `regeneration.ts`.
 *
 * Geometry in words:
 *  - A cell's `heightMetres` is its TOP. An intact cell is solid below its top and is
 *    the surface things stand on at it, so a shot above the top passes (`isSolidAt`).
 *  - A cell whose `hp` is 0 is a **hole**: it is not solid at any height, and it is
 *    still drivable (`isCellPassable` stays true). A hole in the floor is not a pit —
 *    the owner ruled that tanks never fall — so `floorSurfaceHeightAt` keeps returning
 *    the floor plane through a hole.
 *  - Solid and passable are two different questions: an intact floor slab is solid at
 *    0.1 m and still passable. Only a wall/pillar (or a big block) makes a cell
 *    impassable, and only passability decides where a shoved entity may go.
 */

import { MATERIAL_PROFILES, type CellMaterial } from './constants.ts';

/** One cell of the grid. `x`/`z` are integers in `[0, columns)` / `[0, rows)`. */
export interface Cell {
  readonly x: number;
  readonly z: number;
  /** What the cell is built as; a hole is `cellState(cell) === 'hole'`, not a material. */
  readonly material: CellMaterial;
  /** The cell's top, in metres: the floor slab top, or how high a wall/pillar is solid. */
  readonly heightMetres: number;
  readonly maxHp: number;
  /** Remaining HP; `0` means the cell is a hole. */
  hp: number;
  /** Ticks until the next repaired frame; frozen while a big block holds the cell. */
  regenTicksRemaining: number;
}

/** A destroyed wall/pillar's rubble: static, occupies the cell, must be shot clear. */
export interface BigBlock {
  readonly x: number;
  readonly z: number;
  readonly material: Exclude<CellMaterial, 'floor'>;
  readonly heightMetres: number;
  readonly maxHp: number;
  hp: number;
}

/** Small debris: pushed by tanks, deflects a shell at its mirror, shatters on a hit. */
export interface Shard {
  readonly id: number;
  x: number;
  z: number;
  /** The mirror's NORMAL, in degrees from +x towards +z. Always a `MIRROR_ANGLE_STEPS` step. */
  readonly mirrorAngleDegrees: number;
  /** The tick the shard appeared; array order is age order, and the cap uses it. */
  readonly bornTick: number;
}

/** The whole world. Read the fields; mutate only through the seams. */
export interface World {
  readonly columns: number;
  readonly rows: number;
  /** The drivable floor plane, in metres. A hole keeps this surface (tanks never fall). */
  readonly floorSurfaceHeightMetres: number;
  /** Row-major: index `z * columns + x`. */
  readonly cells: readonly Cell[];
  /** Keyed by cell index. At most one block per cell, and only over a destroyed cell. */
  readonly blocks: Map<number, BigBlock>;
  /** Spawn order = age order. The shard cap drops from the front. */
  readonly shards: Shard[];
  tick: number;
  nextShardId: number;
  /**
   * Monotonic version of the world's VISIBLE state. It increments exactly when a
   * mutation changes cells, blocks, shards or an occupant displacement — never for a
   * regen-timer tickdown alone. The renderer rebuilds only when this changes.
   */
  revision: number;
}

/** A wall or pillar authored into the level grid. */
export interface CellPlacement {
  readonly x: number;
  readonly z: number;
  readonly material: Exclude<CellMaterial, 'floor'>;
  /** The top of the wall/pillar, in metres; must be above the floor plane. */
  readonly heightMetres: number;
}

/**
 * The world to build. This slice has no level loader yet, so the level is a floor
 * plane plus explicit wall/pillar placements; the authored level arrives with the
 * renderer slice and fills the same shape.
 */
export interface WorldSpec {
  readonly columns: number;
  readonly rows: number;
  readonly floorSurfaceHeightMetres: number;
  readonly placements?: readonly CellPlacement[];
}

/** The cell's state in one word: `intact` while it has HP, `hole` once destroyed. */
export type CellState = 'intact' | 'hole';

/** Marks a visible world mutation. Internal seams call this once per changed operation. */
export function markWorldChanged(world: World): void {
  world.revision += 1;
}

/** Builds a world from a spec, failing loudly on any malformed field. */
export function createWorld(spec: WorldSpec): World {
  requirePositiveInteger(spec.columns, 'columns');
  requirePositiveInteger(spec.rows, 'rows');
  requireNonNegativeFinite(spec.floorSurfaceHeightMetres, 'floorSurfaceHeightMetres');

  const cells: Cell[] = [];
  for (let z = 0; z < spec.rows; z += 1) {
    for (let x = 0; x < spec.columns; x += 1) {
      const profile = MATERIAL_PROFILES.floor;
      cells.push({
        x,
        z,
        material: 'floor',
        heightMetres: spec.floorSurfaceHeightMetres,
        maxHp: profile.maxHp,
        hp: profile.maxHp,
        regenTicksRemaining: 0,
      });
    }
  }

  const world: World = {
    columns: spec.columns,
    rows: spec.rows,
    floorSurfaceHeightMetres: spec.floorSurfaceHeightMetres,
    cells,
    blocks: new Map(),
    shards: [],
    tick: 0,
    nextShardId: 0,
    revision: 0,
  };

  for (const placement of spec.placements ?? []) {
    if (placement.material !== 'wall' && placement.material !== 'pillar') {
      throw new Error(
        `world: placement at (${placement.x}, ${placement.z}) must be a wall or a pillar, got ${String(placement.material)}`,
      );
    }
    requireNonNegativeFinite(placement.heightMetres, 'placement heightMetres');
    if (placement.heightMetres <= spec.floorSurfaceHeightMetres) {
      throw new Error(
        `world: wall at (${placement.x}, ${placement.z}) has height ${placement.heightMetres}, which is not above the floor plane ${spec.floorSurfaceHeightMetres}`,
      );
    }
    const index = cellIndex(world, placement.x, placement.z);
    const existing = cells[index];
    if (!existing) {
      throw new Error(`world: placement at (${placement.x}, ${placement.z}) is missing from the grid`);
    }
    if (existing.material !== 'floor') {
      throw new Error(
        `world: (${placement.x}, ${placement.z}) is placed twice (already a ${existing.material})`,
      );
    }
    const profile = MATERIAL_PROFILES[placement.material];
    cells[index] = {
      x: placement.x,
      z: placement.z,
      material: placement.material,
      heightMetres: placement.heightMetres,
      maxHp: profile.maxHp,
      hp: profile.maxHp,
      regenTicksRemaining: 0,
    };
  }

  return world;
}

/** The flat index of a cell, validating the address loudly. */
export function cellIndex(world: World, x: number, z: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(z)) {
    throw new Error(`world: cell address (${x}, ${z}) must be integers`);
  }
  if (x < 0 || x >= world.columns || z < 0 || z >= world.rows) {
    throw new Error(`world: cell (${x}, ${z}) is outside the ${world.columns}x${world.rows} grid`);
  }
  return z * world.columns + x;
}

/** The cell at `(x, z)`, validating the address loudly. */
export function cellAt(world: World, x: number, z: number): Cell {
  const index = cellIndex(world, x, z);
  const cell = world.cells[index];
  if (!cell) {
    throw new Error(`world: cell (${x}, ${z}) is missing from the grid`);
  }
  return cell;
}

/** `hole` once the cell has no HP left, else `intact`. */
export function cellState(cell: Cell): CellState {
  return cell.hp > 0 ? 'intact' : 'hole';
}

/** The drivable floor plane, in metres — a property of the world, not of the cell. */
export function floorSurfaceHeightAt(world: World, x: number, z: number): number {
  cellIndex(world, x, z);
  return world.floorSurfaceHeightMetres;
}

/**
 * Is there material at `(x, z, heightMetres)`? Height-aware by construction, because
 * a low wall must not stop a high shot (`docs/DESIGN.md` §5.3):
 *
 *  - below a big block's top → solid, even though its cell is a hole;
 *  - a hole with no block over it → not solid at any height;
 *  - an intact cell → solid strictly below its top (its top is the surface, not material).
 *
 * A shard is never solid: it deflects, it does not block.
 */
export function isSolidAt(world: World, x: number, z: number, heightMetres: number): boolean {
  const cell = cellAt(world, x, z);
  if (!Number.isFinite(heightMetres) || heightMetres < 0) {
    throw new Error(`world: heightMetres must be finite and >= 0, got ${heightMetres}`);
  }
  const block = blockAt(world, x, z);
  if (block && heightMetres < block.heightMetres) {
    return true;
  }
  if (cellState(cell) === 'hole') {
    return false;
  }
  return heightMetres < cell.heightMetres;
}

/**
 * Can a ground occupant stand in `(x, z)`? This is the ONE definition of free, used
 * by both regeneration displacement and shard shoves. A hole in the floor is passable
 * (tanks stand on the bedrock, the owner ruled they never fall); a wall, a pillar or
 * a big block is not.
 */
export function isCellPassable(world: World, x: number, z: number): boolean {
  const cell = cellAt(world, x, z);
  if (blockAt(world, x, z)) {
    return false;
  }
  if (cellState(cell) === 'hole') {
    return true;
  }
  return cell.material === 'floor';
}

/** The big block in `(x, z)`, or `null`. */
export function blockAt(world: World, x: number, z: number): BigBlock | null {
  return world.blocks.get(cellIndex(world, x, z)) ?? null;
}

/** Every big block, in a stable cell order (nearest z first, then x). */
export function listBlocks(world: World): readonly BigBlock[] {
  return [...world.blocks.values()].sort((a, b) => a.z - b.z || a.x - b.x);
}

/** Every shard, oldest first. */
export function listShards(world: World): readonly Shard[] {
  return world.shards;
}

/** The oldest shard in `(x, z)`, or `null`. Shards may share a cell. */
export function shardAt(world: World, x: number, z: number): Shard | null {
  cellIndex(world, x, z);
  for (const shard of world.shards) {
    if (shard.x === x && shard.z === z) {
      return shard;
    }
  }
  return null;
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`world: ${label} must be a positive integer, got ${value}`);
  }
}

function requireNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`world: ${label} must be finite and >= 0, got ${value}`);
  }
}
