/**
 * The world model — the ONE public entrance to it. Everything below `src/core/` is
 * renderer-free, and this module is the surface the next slice talks to.
 *
 * ## What the world is
 *
 * A grid of `(x, z)` cells on a flat floor plane, each with a material, a height, HP,
 * and a slow regeneration timer. The model is FULLY 3D in the only sense the core can
 * own: every height is in metres and every query about blocking is made AT A HEIGHT
 * (`isSolidAt`), so a low wall never stops a high shot. The renderer slice will draw
 * these numbers; it will not own them.
 *
 * ## The rules the owner set (ledger rows 9, 16, 17, 19)
 *
 *  - **Everything is breakable, including the floor.** A destroyed wall/pillar leaves
 *    a hole and one static big block of rubble; a destroyed floor leaves a hole and
 *    three shards. A floor hole is still drivable — tanks stand on the bottomless
 *    bedrock and never fall — so `floorSurfaceHeightAt` keeps the floor plane through
 *    a hole even though `isSolidAt` says the cell has no material.
 *  - **Regeneration is slow.** One frame of damage per `regenDelaySeconds`, and a
 *    regenerating cell shoves an occupant to the nearest free cell without damaging it.
 *  - **Debris blocks if big enough.** A big block occupies its cell (blocks movement
 *    and shells), holds that cell's regeneration frozen until it is destroyed, and is
 *    never part of the shard cap. Small debris (shards) is shoved by tanks, deflects a
 *    shell at a stored mirror angle, shatters when hit, and is absorbed by a cell that
 *    heals under it. The live shard count is capped; the oldest despawns first.
 *
 * ## What the world deliberately is not
 *
 * It knows nothing about tanks, shells or AI. Tanks arrive as `Occupant` positions each
 * step and leave as `Displacement`s; shells arrive as `damageCell` calls; a shell's
 * reflection is a pure `shardDeflection` query the shell slice applies. That is what
 * keeps this slice small and every later slice honest.
 *
 * ## Determinism
 *
 * `createRng(seed)` is the only randomness; `stepWorld` and every query are ordered by
 * data (row-major cells, occupant id, a fixed neighbour order); and `hashState` turns
 * the whole state into one comparable string. A test asserts that two identical runs
 * agree byte for byte.
 */

export type {
  CellMaterial,
  DebrisYield,
  MaterialProfile,
} from './world/constants.ts';
export {
  BLOCK_HEIGHT_METRES,
  BLOCK_MAX_HP,
  MATERIAL_PROFILES,
  MIRROR_ANGLE_STEP_DEGREES,
  MIRROR_ANGLE_STEPS,
  SHARD_CAP,
  secondsToTicks,
} from './world/constants.ts';

export type {
  BigBlock,
  Cell,
  CellPlacement,
  CellState,
  Shard,
  World,
  WorldSpec,
} from './world/state.ts';
export {
  blockAt,
  cellAt,
  cellIndex,
  cellState,
  createWorld,
  floorSurfaceHeightAt,
  isCellPassable,
  isSolidAt,
  listBlocks,
  listShards,
  shardAt,
} from './world/state.ts';

export type {
  BlockDamageResult,
  CellDamageResult,
} from './world/destruction.ts';
export { damageBlock, damageCell } from './world/destruction.ts';

export type { DebrisSpawn, Direction, ShoveResult } from './world/debris.ts';
export {
  shardDeflection,
  shatterShard,
  shoveShard,
} from './world/debris.ts';

export type {
  Displacement,
  Occupant,
  WorldStepResult,
} from './world/regeneration.ts';
export { stepWorld } from './world/regeneration.ts';

export { hashState } from './world/hash.ts';
