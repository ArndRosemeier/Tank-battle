/**
 * Turning a shape into a terrain spec. A level describes its landscape as a signed
 * "solidity" function in metres (positive inside rock, negative in air, roughly the
 * distance to the surface); the builder samples it onto the lattice and writes the
 * bedrock layer. Levels, tests and demos all build terrain through this ONE path.
 */

import {
  DENSITY_ISO,
  DENSITY_MAX,
  MATERIAL_BEDROCK,
  MATERIAL_ROCK,
  TERRAIN_SPACING_METRES,
} from './constants.ts';
import type { WorldSpec } from './field.ts';

/** What the shape says about one point. */
export interface TerrainSample {
  /** Signed solidity in metres: > 0 inside rock. */
  readonly solidity: number;
  /** Material for a solid point; ignored in air. Default rock. */
  readonly material?: number;
}

export interface TerrainShape {
  /** Cells per axis; samples are cells + 1. */
  readonly cellsX: number;
  readonly cellsY: number;
  readonly cellsZ: number;
  readonly spacingMetres?: number;
  /**
   * When true, the shape is sampled once per orbit of the 90° rotation about the
   * arena's vertical centre line and copied to the other three, so the terrain is
   * exactly four-fold symmetric. Requires a square arena.
   */
  readonly fourFold?: boolean;
  readonly sample: (x: number, y: number, z: number) => TerrainSample;
}

/** Density per metre of solidity: the surface blends over about one lattice step. */
function densityFor(solidity: number, spacing: number): number {
  const value = Math.round(DENSITY_ISO + (solidity * DENSITY_ISO) / spacing);
  return value < 0 ? 0 : value > DENSITY_MAX ? DENSITY_MAX : value;
}

export function buildTerrain(shape: TerrainShape): WorldSpec {
  const spacing = shape.spacingMetres ?? TERRAIN_SPACING_METRES;
  const nx = shape.cellsX + 1;
  const ny = shape.cellsY + 1;
  const nz = shape.cellsZ + 1;
  if (shape.fourFold && nx !== nz) {
    throw new Error(`buildTerrain: a four-fold arena must be square, got ${shape.cellsX}×${shape.cellsZ} cells`);
  }
  const count = nx * ny * nz;
  const density = new Uint8Array(count);
  const material = new Uint8Array(count);
  const done = new Uint8Array(count);
  const last = nx - 1;
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < ny; j += 1) {
        const index = j + ny * (i + nx * k);
        if (done[index]) continue;
        let d: number;
        let m: number;
        if (j === 0) {
          d = DENSITY_MAX;
          m = MATERIAL_BEDROCK;
        } else {
          const value = shape.sample(i * spacing, j * spacing, k * spacing);
          if (!Number.isFinite(value.solidity)) {
            throw new Error(`buildTerrain: solidity at (${i}, ${j}, ${k}) is not finite`);
          }
          d = densityFor(value.solidity, spacing);
          m = value.material ?? MATERIAL_ROCK;
          if (m === MATERIAL_BEDROCK) {
            throw new Error(`buildTerrain: bedrock is reserved for the bottom layer (sample ${i}, ${j}, ${k})`);
          }
        }
        if (shape.fourFold) {
          // The orbit (i, k) → (last − k, i) → (last − i, last − k) → (k, last − i).
          let ci = i;
          let ck = k;
          for (let turn = 0; turn < 4; turn += 1) {
            const target = j + ny * (ci + nx * ck);
            density[target] = d;
            material[target] = m;
            done[target] = 1;
            const next = last - ck;
            ck = ci;
            ci = next;
          }
        } else {
          density[index] = d;
          material[index] = m;
          done[index] = 1;
        }
      }
    }
  }
  return { samplesX: nx, samplesY: ny, samplesZ: nz, spacingMetres: spacing, density, material };
}

/** A flat field: rock up to `groundMetres`, air above. The workhorse of tests. */
export function flatTerrain(cellsX: number, cellsZ: number, groundMetres: number, cellsY = 8): WorldSpec {
  return buildTerrain({
    cellsX,
    cellsY,
    cellsZ,
    sample: (_x, y) => ({ solidity: groundMetres - y }),
  });
}

/** An axis-aligned block standing on the ground, in metres. */
export interface TerrainBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly topMetres: number;
  readonly material?: number;
}

/**
 * A flat field with upright blocks on it: walls and barriers for tests and demos.
 * The cells are `TERRAIN_SPACING_METRES` wide, so block faces between lattice planes
 * round to the nearest sample.
 */
export function boxTerrain(
  cellsX: number,
  cellsZ: number,
  groundMetres: number,
  boxes: readonly TerrainBox[],
  cellsY = 8,
): WorldSpec {
  return buildTerrain({
    cellsX,
    cellsY,
    cellsZ,
    sample: (x, y, z) => {
      let best: TerrainSample = { solidity: groundMetres - y };
      for (const box of boxes) {
        const inside = Math.min(x - box.minX, box.maxX - x, z - box.minZ, box.maxZ - z, box.topMetres - y);
        if (inside > best.solidity) {
          best = box.material === undefined ? { solidity: inside } : { solidity: inside, material: box.material };
        }
      }
      return best;
    },
  });
}
