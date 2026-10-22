/**
 * The ONE numbers module for the world model.
 *
 * Every material, debris, regeneration and mirror number lives here, so tuning is a
 * single file and nothing is duplicated across the model (`COPIES: 1`). The values
 * are the vetoable defaults recorded in `docs/DESIGN.md` §7; the design decisions
 * they express are the owner's (ledger rows 9, 16, 17, 19).
 */

import { STEP_SECONDS } from '../timestep.ts';

/**
 * The horizontal size of one world cell, in metres. This is the ONE definition:
 * the simulation and the renderer both import it (render may import a core constant;
 * core never imports render). It is world data because every cell address, grid
 * query and displacement is expressed in cells.
 */
export const CELL_SIZE_METRES = 2;

/**
 * What a cell is BUILT as. A destroyed cell is not a fourth material: it is a `hole`
 * derived from `hp === 0` (`cellState`), because the material is what regeneration
 * must restore, and two competing representations would drift apart.
 */
export type CellMaterial = 'floor' | 'wall' | 'pillar';

/** The damage a cell takes before it becomes a hole, and what it leaves behind. */
export interface MaterialProfile {
  readonly maxHp: number;
  /** Seconds from a wound to the next repaired frame of damage. */
  readonly regenDelaySeconds: number;
  /** Debris spawned when the cell is destroyed. */
  readonly debris: DebrisYield;
}

/** What one destroyed cell yields. Both counts are per cell; big blocks are uncapped. */
export interface DebrisYield {
  readonly blocks: number;
  readonly shards: number;
}

/**
 * A floor is one hit; a wall two; a pillar three. The wall/pillar split is what makes
 * a pillar worth a detour around rather than a shot through.
 */
export const MATERIAL_PROFILES: Readonly<Record<CellMaterial, MaterialProfile>> = {
  floor: { maxHp: 1, regenDelaySeconds: 20, debris: { blocks: 0, shards: 3 } },
  wall: { maxHp: 2, regenDelaySeconds: 20, debris: { blocks: 1, shards: 0 } },
  pillar: { maxHp: 3, regenDelaySeconds: 20, debris: { blocks: 1, shards: 0 } },
};

/** HP of the static big block a destroyed wall/pillar leaves in its cell. */
export const BLOCK_MAX_HP = 2;

/**
 * How tall a big block stands, in metres. Deliberately lower than a wall: the hole's
 * debris is rubble, so a shot can clear the rubble while still being stopped by an
 * intact wall — that is the height-aware cover the owner asked for.
 */
export const BLOCK_HEIGHT_METRES = 1.5;

/** Live shards allowed at once; beyond it the OLDEST despawns. Big blocks are not capped. */
export const SHARD_CAP = 64;

/**
 * A shard's mirror facet has one of 16 fixed normals, 22.5° apart. Sixteen discrete
 * angles are a design choice, not a shortcut: the normal is data the AI can learn,
 * and every engine sees the identical double because `debris.ts` holds literals.
 */
export const MIRROR_ANGLE_STEPS = 16;

/** Degrees between adjacent mirror normals. */
export const MIRROR_ANGLE_STEP_DEGREES = 360 / MIRROR_ANGLE_STEPS;

/**
 * Converts seconds of simulation time to whole ticks — the ONE conversion between the
 * two, so a tick is always one fixed slice of `src/core/timestep.ts`.
 */
export function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`world: seconds must be finite and > 0, got ${seconds}`);
  }
  return Math.max(1, Math.round(seconds / STEP_SECONDS));
}
