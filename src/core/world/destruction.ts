/**
 * Craters, collapse and falling chunks — the "realistic breakdown" half of the terrain.
 *
 *  - `blastTerrain` removes density in a sphere (a crater). Hard crystal resists; the
 *    bedrock layer never changes.
 *  - `collapseTerrain` floods from the bedrock through 6-connected solid samples. Every
 *    solid piece the flood does not reach has lost its support: a tiny piece crumbles to
 *    dust, a bigger one is lifted out of the lattice as a `FallingChunk`.
 *  - `stepChunks` lets chunks fall under gravity. A chunk lands when the next lattice
 *    step down would overlap solid terrain and is written back as rubble; a chunk that
 *    falls onto a tank shatters on it and crushes it.
 *
 * Everything is ordered by lattice index or chunk id, so the outcome is deterministic.
 */

import { STEP_SECONDS } from '../timestep.ts';
import {
  BLAST_RADIUS_METRES,
  BLAST_STRENGTH,
  CRUSH_DAMAGE_STEPS,
  DENSITY_ISO,
  DUST_MAX_SAMPLES,
  GRAVITY_METRES_PER_SECOND_SQUARED,
  MATERIAL_HARDNESS,
  RUBBLE_DENSITY_FACTOR,
} from './constants.ts';
import {
  sampleCoordinates,
  writeSample,
  type FallingChunk,
  type World,
} from './field.ts';

/** A vertical cylinder the world must not put rock into (a tank's body). */
export interface Occupant {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly bottomY: number;
  readonly topY: number;
}

export interface DebrisEvent {
  readonly kind: 'dust' | 'break' | 'land' | 'crush';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Samples involved. */
  readonly samples: number;
  readonly chunkId: number | null;
}

export interface Crush {
  readonly occupantId: number;
  readonly damage: number;
  readonly chunkId: number;
}

export interface BlastResult {
  /** Samples whose density went down. */
  readonly samplesDamaged: number;
  /** Samples that went from solid to air. */
  readonly samplesDestroyed: number;
  readonly debris: readonly DebrisEvent[];
}

/** Carves a crater centred on `(x, y, z)`. Runs the collapse check if anything broke. */
export function blastTerrain(
  world: World,
  x: number,
  y: number,
  z: number,
  radiusMetres = BLAST_RADIUS_METRES,
  strength = BLAST_STRENGTH,
): BlastResult {
  for (const [value, label] of [[x, 'x'], [y, 'y'], [z, 'z'], [radiusMetres, 'radius'], [strength, 'strength']] as const) {
    if (!Number.isFinite(value)) {
      throw new Error(`world.blastTerrain: ${label} must be finite, got ${String(value)}`);
    }
  }
  if (radiusMetres <= 0 || strength < 0) {
    throw new Error(`world.blastTerrain: radius must be > 0 and strength >= 0`);
  }
  const s = world.spacing;
  const minI = Math.max(0, Math.ceil((x - radiusMetres) / s));
  const maxI = Math.min(world.nx - 1, Math.floor((x + radiusMetres) / s));
  const minJ = Math.max(1, Math.ceil((y - radiusMetres) / s));
  const maxJ = Math.min(world.ny - 1, Math.floor((y + radiusMetres) / s));
  const minK = Math.max(0, Math.ceil((z - radiusMetres) / s));
  const maxK = Math.min(world.nz - 1, Math.floor((z + radiusMetres) / s));
  let damaged = 0;
  let destroyed = 0;
  for (let k = minK; k <= maxK; k += 1) {
    for (let i = minI; i <= maxI; i += 1) {
      for (let j = minJ; j <= maxJ; j += 1) {
        const distance = Math.hypot(i * s - x, j * s - y, k * s - z);
        if (distance > radiusMetres) continue;
        const index = j + world.ny * (i + world.nx * k);
        const before = world.density[index]!;
        if (before === 0) continue;
        const hardness = MATERIAL_HARDNESS[world.material[index]!]!;
        const removal = Math.round((strength * (1 - distance / radiusMetres)) / hardness);
        if (removal <= 0) continue;
        const after = Math.max(0, before - removal);
        writeSample(world, index, after, world.material[index]!);
        damaged += 1;
        if (before >= DENSITY_ISO && after < DENSITY_ISO) destroyed += 1;
      }
    }
  }
  if (damaged > 0) world.revision += 1;
  const debris = destroyed > 0 ? collapseTerrain(world) : [];
  return { samplesDamaged: damaged, samplesDestroyed: destroyed, debris };
}

/**
 * Detaches every solid piece that is no longer connected to the bedrock. Returns one
 * debris event per piece (dust or a new falling chunk).
 */
export function collapseTerrain(world: World): DebrisEvent[] {
  const { nx, ny, nz } = world;
  const count = nx * ny * nz;
  const density = world.density;
  const reached = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const index = ny * (i + nx * k);
      if (density[index]! >= DENSITY_ISO) {
        reached[index] = 1;
        queue[tail++] = index;
      }
    }
  }
  const strideI = ny;
  const strideK = ny * nx;
  const visit = (index: number): void => {
    if (reached[index] === 0 && density[index]! >= DENSITY_ISO) {
      reached[index] = 1;
      queue[tail++] = index;
    }
  };
  while (head < tail) {
    const index = queue[head++]!;
    const j = index % ny;
    const column = (index - j) / ny;
    const i = column % nx;
    const k = (column - i) / nx;
    if (j + 1 < ny) visit(index + 1);
    if (j > 0) visit(index - 1);
    if (i + 1 < nx) visit(index + strideI);
    if (i > 0) visit(index - strideI);
    if (k + 1 < nz) visit(index + strideK);
    if (k > 0) visit(index - strideK);
  }

  const events: DebrisEvent[] = [];
  for (let start = 0; start < count; start += 1) {
    if (reached[start] !== 0 || density[start]! < DENSITY_ISO) continue;
    // Gather this unsupported piece.
    head = 0;
    tail = 0;
    reached[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++]!;
      const j = index % ny;
      const column = (index - j) / ny;
      const i = column % nx;
      const k = (column - i) / nx;
      if (j + 1 < ny) visit(index + 1);
      if (j > 0) visit(index - 1);
      if (i + 1 < nx) visit(index + strideI);
      if (i > 0) visit(index - strideI);
      if (k + 1 < nz) visit(index + strideK);
      if (k > 0) visit(index - strideK);
    }
    const members = Array.from(queue.subarray(0, tail)).sort((a, b) => a - b);
    events.push(detachPiece(world, members));
  }
  if (events.length > 0) world.revision += 1;
  return events;
}

function detachPiece(world: World, members: readonly number[]): DebrisEvent {
  const s = world.spacing;
  let minI = Infinity;
  let maxI = -Infinity;
  let minJ = Infinity;
  let maxJ = -Infinity;
  let minK = Infinity;
  let maxK = -Infinity;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const index of members) {
    const { i, j, k } = sampleCoordinates(world, index);
    minI = Math.min(minI, i);
    maxI = Math.max(maxI, i);
    minJ = Math.min(minJ, j);
    maxJ = Math.max(maxJ, j);
    minK = Math.min(minK, k);
    maxK = Math.max(maxK, k);
    sumX += i * s;
    sumY += j * s;
    sumZ += k * s;
  }
  const centre = { x: sumX / members.length, y: sumY / members.length, z: sumZ / members.length };
  if (members.length <= DUST_MAX_SAMPLES) {
    for (const index of members) {
      writeSample(world, index, 0, world.material[index]!);
    }
    return { kind: 'dust', ...centre, samples: members.length, chunkId: null };
  }
  const chunk: FallingChunk = {
    id: world.nextChunkId,
    samples: Int32Array.from(members),
    densities: Uint8Array.from(members.map((index) => world.density[index]!)),
    materials: Uint8Array.from(members.map((index) => world.material[index]!)),
    minI,
    maxI,
    minJ,
    maxJ,
    minK,
    maxK,
    fallMetres: 0,
    speed: 0,
    drop: 0,
  };
  world.nextChunkId += 1;
  for (const index of members) {
    writeSample(world, index, 0, world.material[index]!);
  }
  world.chunks.push(chunk);
  return { kind: 'break', ...centre, samples: members.length, chunkId: chunk.id };
}

export interface ChunkStepResult {
  readonly debris: readonly DebrisEvent[];
  readonly crushes: readonly Crush[];
}

/** One tick of falling for every chunk, in id order. */
export function stepChunks(world: World, occupants: readonly Occupant[]): ChunkStepResult {
  if (world.chunks.length === 0) return { debris: [], crushes: [] };
  const debris: DebrisEvent[] = [];
  const crushes: Crush[] = [];
  const s = world.spacing;
  const remaining: FallingChunk[] = [];
  let changed = false;
  for (const chunk of [...world.chunks].sort((a, b) => a.id - b.id)) {
    chunk.speed += GRAVITY_METRES_PER_SECOND_SQUARED * STEP_SECONDS;
    chunk.fallMetres += chunk.speed * STEP_SECONDS;
    const wanted = Math.floor(chunk.fallMetres / s + 1e-9);
    let landed = false;
    while (chunk.drop < wanted) {
      if (chunkOverlapsTerrain(world, chunk, chunk.drop + 1)) {
        landed = true;
        break;
      }
      chunk.drop += 1;
    }
    const crushed = occupantsUnder(world, chunk, occupants);
    if (crushed.length > 0) {
      const damage = crushDamage(chunk.samples.length);
      for (const occupant of crushed) {
        crushes.push({ occupantId: occupant.id, damage, chunkId: chunk.id });
      }
      debris.push({ kind: 'crush', ...chunkCentre(world, chunk), samples: chunk.samples.length, chunkId: chunk.id });
      changed = true;
      continue;
    }
    if (landed) {
      chunk.fallMetres = chunk.drop * s;
      depositChunk(world, chunk, occupants);
      debris.push({ kind: 'land', ...chunkCentre(world, chunk), samples: chunk.samples.length, chunkId: chunk.id });
      changed = true;
      continue;
    }
    remaining.push(chunk);
  }
  world.chunks.splice(0, world.chunks.length, ...remaining);
  if (changed) {
    world.revision += 1;
    // Rubble that landed on something that has since gone (or on another chunk) may
    // itself be unsupported; the flood settles it.
    debris.push(...collapseTerrain(world));
  }
  return { debris, crushes };
}

/** Would the chunk, dropped `drop` lattice steps, overlap solid terrain? */
function chunkOverlapsTerrain(world: World, chunk: FallingChunk, drop: number): boolean {
  if (chunk.minJ - drop < 1) return true;
  for (let n = 0; n < chunk.samples.length; n += 1) {
    if (chunk.densities[n]! < DENSITY_ISO) continue;
    const target = chunk.samples[n]! - drop;
    if (world.density[target]! >= DENSITY_ISO) return true;
  }
  return false;
}

function occupantsUnder(world: World, chunk: FallingChunk, occupants: readonly Occupant[]): Occupant[] {
  if (occupants.length === 0) return [];
  const s = world.spacing;
  const half = s / 2;
  const hit: Occupant[] = [];
  for (const occupant of occupants) {
    const minX = chunk.minI * s - half;
    const maxX = chunk.maxI * s + half;
    const minZ = chunk.minK * s - half;
    const maxZ = chunk.maxK * s + half;
    if (occupant.x + occupant.radius < minX || occupant.x - occupant.radius > maxX) continue;
    if (occupant.z + occupant.radius < minZ || occupant.z - occupant.radius > maxZ) continue;
    let touching = false;
    for (let n = 0; n < chunk.samples.length && !touching; n += 1) {
      if (chunk.densities[n]! < DENSITY_ISO) continue;
      const { i, j, k } = sampleCoordinates(world, chunk.samples[n]!);
      const y = j * s - chunk.fallMetres;
      if (y + half < occupant.bottomY || y - half > occupant.topY) continue;
      const dx = i * s - occupant.x;
      const dz = k * s - occupant.z;
      const reach = occupant.radius + half;
      if (dx * dx + dz * dz <= reach * reach) touching = true;
    }
    if (touching) hit.push(occupant);
  }
  return hit.sort((a, b) => a.id - b.id);
}

function depositChunk(world: World, chunk: FallingChunk, occupants: readonly Occupant[]): void {
  const s = world.spacing;
  for (let n = 0; n < chunk.samples.length; n += 1) {
    const target = chunk.samples[n]! - chunk.drop;
    const { i, j, k } = sampleCoordinates(world, target);
    if (insideOccupant(i * s, j * s, k * s, s / 2, occupants)) continue;
    const rubble = Math.round(chunk.densities[n]! * RUBBLE_DENSITY_FACTOR);
    if (rubble > world.density[target]!) {
      writeSample(world, target, rubble, chunk.materials[n]!);
    }
  }
}

/** Is the point within `margin` of any occupant's cylinder? */
export function insideOccupant(x: number, y: number, z: number, margin: number, occupants: readonly Occupant[]): boolean {
  for (const occupant of occupants) {
    if (y < occupant.bottomY - margin || y > occupant.topY + margin) continue;
    const dx = x - occupant.x;
    const dz = z - occupant.z;
    const reach = occupant.radius + margin;
    if (dx * dx + dz * dz <= reach * reach) return true;
  }
  return false;
}

function chunkCentre(world: World, chunk: FallingChunk): { x: number; y: number; z: number } {
  const s = world.spacing;
  return {
    x: ((chunk.minI + chunk.maxI) / 2) * s,
    y: ((chunk.minJ + chunk.maxJ) / 2) * s - chunk.fallMetres,
    z: ((chunk.minK + chunk.maxK) / 2) * s,
  };
}

/** Crush damage for a chunk of this many samples (0 for a pebble). */
export function crushDamage(samples: number): number {
  for (const step of CRUSH_DAMAGE_STEPS) {
    if (samples >= step.samples) return step.damage;
  }
  return 0;
}
