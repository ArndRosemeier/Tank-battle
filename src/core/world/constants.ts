/**
 * The ONE tuning module for the terrain (`src/core/world/`).
 *
 * The world is a volumetric DENSITY LATTICE: one byte per sample point, spaced
 * `TERRAIN_SPACING_METRES` apart in x, y and z. A point is solid when its trilinearly
 * interpolated density is at least `DENSITY_ISO`. The renderer draws the iso-surface
 * with marching tetrahedra, which is where the glowing triangles come from; the
 * simulation only ever asks density questions, so it never depends on a mesh.
 *
 * Units: metres, seconds, density bytes (0…255) and whole simulation ticks.
 */

/** Distance between neighbouring lattice samples, in metres. */
export const TERRAIN_SPACING_METRES = 1.5;

/** The density at which a point turns solid. */
export const DENSITY_ISO = 128;
export const DENSITY_MAX = 255;

/** Sample materials. Bedrock is the indestructible bottom layer (`j = 0`). */
export const MATERIAL_ROCK = 0;
export const MATERIAL_CRYSTAL = 1;
export const MATERIAL_BEDROCK = 2;
export type TerrainMaterial = typeof MATERIAL_ROCK | typeof MATERIAL_CRYSTAL | typeof MATERIAL_BEDROCK;
export const MATERIAL_COUNT = 3;

/** How much a blast is divided by on each material. Bedrock never takes damage. */
export const MATERIAL_HARDNESS: readonly number[] = Object.freeze([1, 1.8, Infinity]);

/** A shell's crater: density removed at the centre, falling linearly to the radius. */
export const BLAST_RADIUS_METRES = 2.4;
export const BLAST_STRENGTH = 360;

/**
 * Collapse: after material is removed, every solid sample that is no longer connected
 * (6-neighbour) to the bedrock layer breaks off. A piece of at most this many samples
 * crumbles to dust; a bigger one becomes a falling chunk.
 */
export const DUST_MAX_SAMPLES = 3;

/** Gravity for falling chunks and falling tanks, in m/s² (a little heavier than Earth: it reads better). */
export const GRAVITY_METRES_PER_SECOND_SQUARED = 20;

/** A landed chunk becomes rubble at this fraction of its density (cracked, looser rock). */
export const RUBBLE_DENSITY_FACTOR = 0.85;

/** Crush damage by chunk size in samples: at least 6 → 1 HP, 30 → 2 HP, 80 → 3 HP. */
export const CRUSH_DAMAGE_STEPS: readonly { readonly samples: number; readonly damage: number }[] = Object.freeze([
  { samples: 80, damage: 3 },
  { samples: 30, damage: 2 },
  { samples: 6, damage: 1 },
]);

/**
 * Regeneration: every `REGEN_INTERVAL_TICKS`, each sample moves `REGEN_STEP` density
 * towards its authored target. A missing sample only regrows next to solid material,
 * so a crater heals from its walls inwards; rubble that is not part of the authored
 * landscape erodes away. A sample inside a tank never grows.
 */
export const REGEN_INTERVAL_TICKS = 30;
export const REGEN_STEP = 5;

/** The renderer rebuilds the mesh in blocks of this many cells per axis. */
export const RENDER_BLOCK_CELLS = 8;
