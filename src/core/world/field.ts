/**
 * The terrain state and its read-only queries.
 *
 * Layout: sample `(i, j, k)` sits at `(i·s, j·s, k·s)` metres and is stored at
 * `j + ny·(i + nx·k)`, so one vertical column is contiguous (ground and headroom
 * questions walk a column). `j = 0` is the bedrock layer: always full density and
 * never damaged, so there is always a floor and collapse always has an anchor.
 *
 * Outside the lattice: below `y = 0` is solid (bedrock continues down), above the top
 * layer and beyond the four sides is air. The arena's playable area is the lattice's
 * horizontal extent; the simulation keeps tanks inside it.
 */

import {
  DENSITY_ISO,
  DENSITY_MAX,
  MATERIAL_BEDROCK,
  MATERIAL_COUNT,
  RENDER_BLOCK_CELLS,
} from './constants.ts';

/** The authored terrain a level hands to `createWorld`. Arrays use the world layout. */
export interface WorldSpec {
  /** Sample counts per axis (cells + 1). */
  readonly samplesX: number;
  readonly samplesY: number;
  readonly samplesZ: number;
  readonly spacingMetres: number;
  /** One density byte per sample, index `j + ny·(i + nx·k)`. */
  readonly density: Uint8Array;
  /** One material per sample, same index. */
  readonly material: Uint8Array;
}

/** A piece of terrain that broke off and is falling. Samples keep their lattice index. */
export interface FallingChunk {
  readonly id: number;
  /** Original lattice indices of the chunk's samples, ascending. */
  readonly samples: Int32Array;
  readonly densities: Uint8Array;
  readonly materials: Uint8Array;
  /** Sample-space bounds of the chunk at its ORIGINAL position (inclusive). */
  readonly minI: number;
  readonly maxI: number;
  readonly minJ: number;
  readonly maxJ: number;
  readonly minK: number;
  readonly maxK: number;
  /** How far below its original position it has fallen, in metres (>= 0). */
  fallMetres: number;
  /** Downward speed in m/s (>= 0). */
  speed: number;
  /** Whole lattice steps already verified free of solid terrain. */
  drop: number;
}

export interface World {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly spacing: number;
  readonly widthMetres: number;
  readonly heightMetres: number;
  readonly depthMetres: number;
  /** Current density per sample. */
  readonly density: Uint8Array;
  /** Current material per sample. */
  readonly material: Uint8Array;
  /** The authored density regeneration heals towards. */
  readonly target: Uint8Array;
  readonly targetMaterial: Uint8Array;
  /** Render blocks per axis and one revision counter per block. */
  readonly blocksX: number;
  readonly blocksY: number;
  readonly blocksZ: number;
  readonly blockRevisions: Uint32Array;
  /** Bumped whenever any sample changes solidity or density. */
  revision: number;
  readonly chunks: FallingChunk[];
  nextChunkId: number;
  /** Ticks until the next regeneration pass. */
  regenCountdown: number;
}

export function createWorld(spec: WorldSpec): World {
  if (spec === null || typeof spec !== 'object') {
    throw new Error(`world.createWorld: spec must be an object, got ${String(spec)}`);
  }
  const { samplesX: nx, samplesY: ny, samplesZ: nz, spacingMetres: spacing } = spec;
  for (const [value, label] of [[nx, 'samplesX'], [ny, 'samplesY'], [nz, 'samplesZ']] as const) {
    if (!Number.isInteger(value) || value < 3 || value > 512) {
      throw new Error(`world.createWorld: ${label} must be an integer 3…512, got ${String(value)}`);
    }
  }
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new Error(`world.createWorld: spacingMetres must be finite and > 0, got ${String(spacing)}`);
  }
  const count = nx * ny * nz;
  if (!(spec.density instanceof Uint8Array) || spec.density.length !== count) {
    throw new Error(`world.createWorld: density must be a Uint8Array of ${count} samples`);
  }
  if (!(spec.material instanceof Uint8Array) || spec.material.length !== count) {
    throw new Error(`world.createWorld: material must be a Uint8Array of ${count} samples`);
  }
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const base = ny * (i + nx * k);
      if (spec.density[base] !== DENSITY_MAX || spec.material[base] !== MATERIAL_BEDROCK) {
        throw new Error(`world.createWorld: sample (${i}, 0, ${k}) must be full-density bedrock`);
      }
      for (let j = 1; j < ny; j += 1) {
        const material = spec.material[base + j]!;
        if (material >= MATERIAL_COUNT || material === MATERIAL_BEDROCK) {
          throw new Error(`world.createWorld: sample (${i}, ${j}, ${k}) has material ${material}; bedrock is the j = 0 layer only`);
        }
      }
    }
  }
  const cellsX = nx - 1;
  const cellsY = ny - 1;
  const cellsZ = nz - 1;
  const blocksX = Math.ceil(cellsX / RENDER_BLOCK_CELLS);
  const blocksY = Math.ceil(cellsY / RENDER_BLOCK_CELLS);
  const blocksZ = Math.ceil(cellsZ / RENDER_BLOCK_CELLS);
  return {
    nx,
    ny,
    nz,
    spacing,
    widthMetres: cellsX * spacing,
    heightMetres: cellsY * spacing,
    depthMetres: cellsZ * spacing,
    density: spec.density.slice(),
    material: spec.material.slice(),
    target: spec.density.slice(),
    targetMaterial: spec.material.slice(),
    blocksX,
    blocksY,
    blocksZ,
    blockRevisions: new Uint32Array(blocksX * blocksY * blocksZ),
    revision: 0,
    chunks: [],
    nextChunkId: 0,
    regenCountdown: 0,
  };
}

/** Lattice index of sample `(i, j, k)`; the caller guarantees it is in range. */
export function sampleIndex(world: World, i: number, j: number, k: number): number {
  return j + world.ny * (i + world.nx * k);
}

/** Inverse of `sampleIndex`. */
export function sampleCoordinates(world: World, index: number): { readonly i: number; readonly j: number; readonly k: number } {
  const j = index % world.ny;
  const column = (index - j) / world.ny;
  const i = column % world.nx;
  const k = (column - i) / world.nx;
  return { i, j, k };
}

/** Density of one sample, with the outside-the-lattice rules applied. */
export function sampleDensity(world: World, i: number, j: number, k: number): number {
  if (j < 0) return DENSITY_MAX;
  if (j >= world.ny || i < 0 || k < 0 || i >= world.nx || k >= world.nz) return 0;
  return world.density[j + world.ny * (i + world.nx * k)]!;
}

/** Trilinearly interpolated density at a point, 0…255. */
export function densityAt(world: World, x: number, y: number, z: number): number {
  const s = world.spacing;
  if (y < 0) return DENSITY_MAX;
  if (y > world.heightMetres || x < 0 || z < 0 || x > world.widthMetres || z > world.depthMetres) return 0;
  const fx = x / s;
  const fy = y / s;
  const fz = z / s;
  const i0 = Math.min(world.nx - 2, Math.floor(fx));
  const j0 = Math.min(world.ny - 2, Math.floor(fy));
  const k0 = Math.min(world.nz - 2, Math.floor(fz));
  const tx = fx - i0;
  const ty = fy - j0;
  const tz = fz - k0;
  const ny = world.ny;
  const nx = world.nx;
  const d = world.density;
  const a = j0 + ny * (i0 + nx * k0);
  const b = a + ny; // i + 1
  const c = a + ny * nx; // k + 1
  const e = c + ny; // i + 1, k + 1
  const lower =
    (d[a]! * (1 - tx) + d[b]! * tx) * (1 - tz) + (d[c]! * (1 - tx) + d[e]! * tx) * tz;
  const upper =
    (d[a + 1]! * (1 - tx) + d[b + 1]! * tx) * (1 - tz) + (d[c + 1]! * (1 - tx) + d[e + 1]! * tx) * tz;
  return lower * (1 - ty) + upper * ty;
}

/** Is the point inside solid terrain? */
export function isSolidAt(world: World, x: number, y: number, z: number): boolean {
  return densityAt(world, x, y, z) >= DENSITY_ISO;
}

/** Is this point inside the arena's horizontal extent? */
export function isInsideArena(world: World, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x <= world.widthMetres && z <= world.depthMetres;
}

/**
 * The bilinear density of every layer of the vertical line through `(x, z)`, written
 * into `out` (length `ny`). The density along a vertical line is exactly linear
 * between two layers, so surfaces found from this profile are the exact iso-surface.
 */
export function columnProfile(world: World, x: number, z: number, out: Float64Array): Float64Array {
  if (out.length < world.ny) {
    throw new Error(`world.columnProfile: out needs ${world.ny} entries, got ${out.length}`);
  }
  const s = world.spacing;
  const cx = Math.max(0, Math.min(world.widthMetres, x)) / s;
  const cz = Math.max(0, Math.min(world.depthMetres, z)) / s;
  const i0 = Math.min(world.nx - 2, Math.floor(cx));
  const k0 = Math.min(world.nz - 2, Math.floor(cz));
  const tx = cx - i0;
  const tz = cz - k0;
  const ny = world.ny;
  const d = world.density;
  const a = ny * (i0 + world.nx * k0);
  const b = a + ny;
  const c = a + ny * world.nx;
  const e = c + ny;
  const wa = (1 - tx) * (1 - tz);
  const wb = tx * (1 - tz);
  const wc = (1 - tx) * tz;
  const we = tx * tz;
  for (let j = 0; j < ny; j += 1) {
    out[j] = d[a + j]! * wa + d[b + j]! * wb + d[c + j]! * wc + d[e + j]! * we;
  }
  return out;
}

const scratchProfiles = new Map<number, Float64Array>();
function scratchProfile(world: World): Float64Array {
  let profile = scratchProfiles.get(world.ny);
  if (!profile) {
    profile = new Float64Array(world.ny);
    scratchProfiles.set(world.ny, profile);
  }
  return profile;
}

/**
 * The height of the highest ground surface at or below `yFrom` on the vertical line
 * through `(x, z)`: the first air→solid crossing met walking down. When `yFrom` itself
 * is inside solid terrain the answer is `yFrom` (the ground is at least that high).
 * Bedrock guarantees an answer.
 */
export function groundBelow(world: World, x: number, z: number, yFrom: number): number {
  const profile = columnProfile(world, x, z, scratchProfile(world));
  const s = world.spacing;
  const top = world.ny - 1;
  const fy = Math.min(yFrom / s, top);
  if (fy < 0) return yFrom;
  const j0 = Math.min(top - 1, Math.floor(fy));
  const t = fy - j0;
  const atFrom = profile[j0]! * (1 - t) + profile[j0 + 1]! * t;
  if (yFrom <= world.heightMetres && atFrom >= DENSITY_ISO) {
    return yFrom;
  }
  let upper = yFrom > world.heightMetres ? 0 : atFrom;
  let upperY = fy;
  for (let j = Math.floor(fy); j >= 0; j -= 1) {
    const value = profile[j]!;
    if (value >= DENSITY_ISO) {
      const span = upperY - j;
      const fraction = value === upper ? 0 : (value - DENSITY_ISO) / (value - upper);
      return (j + fraction * span) * s;
    }
    upper = value;
    upperY = j;
  }
  return 0;
}

/**
 * Every standable surface on the vertical line through `(x, z)`, bottom to top: each
 * air-above-solid crossing whose air gap above is at least `headroomMetres` tall (the
 * top of the lattice counts as open sky). Used by navigation to find cave floors and
 * hilltops in one column.
 */
export function columnSurfaces(world: World, x: number, z: number, headroomMetres: number): number[] {
  const profile = columnProfile(world, x, z, scratchProfile(world));
  const s = world.spacing;
  const surfaces: number[] = [];
  const top = world.ny - 1;
  let j = 0;
  while (j < top) {
    const below = profile[j]!;
    const above = profile[j + 1]!;
    if (below >= DENSITY_ISO && above < DENSITY_ISO) {
      const floorY = (j + (below - DENSITY_ISO) / (below - above)) * s;
      // Walk up to the next air→solid crossing (the ceiling), if any.
      let ceilingY = Infinity;
      for (let up = j + 1; up < top; up += 1) {
        const lo = profile[up]!;
        const hi = profile[up + 1]!;
        if (lo < DENSITY_ISO && hi >= DENSITY_ISO) {
          ceilingY = (up + (DENSITY_ISO - lo) / (hi - lo)) * s;
          break;
        }
      }
      if (ceilingY - floorY >= headroomMetres) {
        surfaces.push(floorY);
      }
    }
    j += 1;
  }
  return surfaces;
}

/** Marks every render block touched by sample `(i, j, k)` as changed. */
export function markSampleChanged(world: World, i: number, j: number, k: number): void {
  const cellsX = world.nx - 1;
  const cellsY = world.ny - 1;
  const cellsZ = world.nz - 1;
  const minBx = Math.floor(Math.max(0, i - 1) / RENDER_BLOCK_CELLS);
  const maxBx = Math.floor(Math.min(cellsX - 1, i) / RENDER_BLOCK_CELLS);
  const minBy = Math.floor(Math.max(0, j - 1) / RENDER_BLOCK_CELLS);
  const maxBy = Math.floor(Math.min(cellsY - 1, j) / RENDER_BLOCK_CELLS);
  const minBz = Math.floor(Math.max(0, k - 1) / RENDER_BLOCK_CELLS);
  const maxBz = Math.floor(Math.min(cellsZ - 1, k) / RENDER_BLOCK_CELLS);
  for (let bz = minBz; bz <= maxBz; bz += 1) {
    for (let by = minBy; by <= maxBy; by += 1) {
      for (let bx = minBx; bx <= maxBx; bx += 1) {
        const index = bx + world.blocksX * (by + world.blocksY * bz);
        world.blockRevisions[index] = world.blockRevisions[index]! + 1;
      }
    }
  }
}

/** Writes one sample and records the change. Returns whether the value changed. */
export function writeSample(world: World, index: number, density: number, material: number): boolean {
  if (world.density[index] === density && world.material[index] === material) {
    return false;
  }
  world.density[index] = density;
  world.material[index] = material;
  const { i, j, k } = sampleCoordinates(world, index);
  markSampleChanged(world, i, j, k);
  return true;
}
