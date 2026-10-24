/**
 * The world model — the ONE public entrance to the terrain. Everything below
 * `src/core/` is renderer-free, and this module is the surface the rest talks to.
 *
 * ## What the world is
 *
 * A volumetric density lattice (`src/core/world/constants.ts`): one byte per sample,
 * 1.5 m apart in all three axes. The iso-surface of that field is the landscape —
 * rolling ground, hills, arches, overhangs and caves — and the renderer draws it as
 * glowing triangles (marching tetrahedra). The simulation never sees a mesh; it asks
 * density questions (`densityAt`, `isSolidAt`, `groundBelow`, `raycastTerrain`).
 *
 * ## The rules
 *
 *  - **Everything above bedrock is breakable.** A shell carves a crater
 *    (`blastTerrain`); crystal is harder than rock; the bedrock layer never changes.
 *  - **Unsupported rock falls.** After every change the solid samples are flood-filled
 *    from bedrock. A piece that lost its connection crumbles (tiny) or breaks off as a
 *    falling chunk, which lands as rubble or shatters on a tank and crushes it.
 *  - **The landscape heals slowly.** Regeneration regrows the authored terrain from its
 *    surviving walls and erodes rubble that is not part of it.
 *
 * ## What the world deliberately is not
 *
 * It knows nothing about tanks, shells or AI. Tanks arrive as `Occupant` cylinders each
 * step and leave as `Crush` results; shells arrive as `blastTerrain` calls.
 *
 * ## Determinism
 *
 * Every loop runs in lattice-index or chunk-id order and every density is an integer
 * byte; `hashState` folds the whole state into one comparable string.
 */

export {
  BLAST_RADIUS_METRES,
  BLAST_STRENGTH,
  DENSITY_ISO,
  DENSITY_MAX,
  DUST_MAX_SAMPLES,
  GRAVITY_METRES_PER_SECOND_SQUARED,
  MATERIAL_BEDROCK,
  MATERIAL_COUNT,
  MATERIAL_CRYSTAL,
  MATERIAL_HARDNESS,
  MATERIAL_ROCK,
  REGEN_INTERVAL_TICKS,
  REGEN_STEP,
  RENDER_BLOCK_CELLS,
  RUBBLE_DENSITY_FACTOR,
  TERRAIN_SPACING_METRES,
  type TerrainMaterial,
} from './world/constants.ts';

export {
  columnProfile,
  columnSurfaces,
  createWorld,
  densityAt,
  groundBelow,
  isInsideArena,
  isSolidAt,
  sampleCoordinates,
  sampleDensity,
  sampleIndex,
  type FallingChunk,
  type World,
  type WorldSpec,
} from './world/field.ts';

export { hasClearLine, raycastTerrain, RAYCAST_STEP_METRES, type TerrainHit } from './world/raycast.ts';

export {
  blastTerrain,
  collapseTerrain,
  crushDamage,
  type BlastResult,
  type Crush,
  type DebrisEvent,
  type Occupant,
} from './world/destruction.ts';

export { stepWorld, type WorldStepResult } from './world/regeneration.ts';

export { hashState } from './world/hash.ts';

export {
  boxTerrain,
  buildTerrain,
  flatTerrain,
  type TerrainBox,
  type TerrainSample,
  type TerrainShape,
} from './world/builder.ts';
