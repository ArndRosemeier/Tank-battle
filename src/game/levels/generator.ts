/**
 * The procedural arena generator: a seed and a size become a four-fold symmetric
 * landscape of glowing triangles with four corner pads, in the same `LevelDefinition`
 * format the authored arena uses, and through the same `buildTerrain` path.
 *
 * What a generated arena is made of:
 *  - rolling ground (seeded value noise) rising into a steep rim at the edge;
 *  - one CENTREPIECE: a hill with crossing tunnels and a cavern, a crater ring with
 *    four gaps, a plateau with four ramps over a crossing cave, or a giant mushroom
 *    spire in a ring of mounds;
 *  - per quarter, a handful of FEATURES: hills, cave mounds with a tunnel through,
 *    arched walls with a crystal crown, mushroom spires, plateaus with a ramp and low
 *    cover walls. Each feature is placed once and rotated onto the other three quarters.
 *
 * Fair by construction: the shape is a sum over the four 90° turns, and `buildTerrain`
 * samples it once per rotation orbit, so the four quarters are identical byte for byte
 * and the four pads are rotations of each other. Every generated level then goes through
 * the full `validateLevel` (flat pads, symmetry, every slot and the centre connected on
 * foot through the AI's own navigation graph). A seed whose layout fails is re-rolled
 * deterministically (attempt 1, 2, …); a seed that fails every attempt throws.
 *
 * Deterministic across machines: the generator uses only integer hashing and +, −, ×, ÷
 * and `Math.sqrt` (all exactly rounded in IEEE 754) — no `sin`, `cos`, `atan2`, `exp`
 * or `hypot`, whose last bit may differ between JavaScript engines. The same seed and
 * size give the same bytes on every host, which online play depends on.
 */

import {
  DENSITY_ISO,
  MATERIAL_CRYSTAL,
  MATERIAL_ROCK,
  buildTerrain,
  type TerrainSample,
  type WorldSpec,
} from '../../core/world.ts';
import { validateLevel, type LevelDefinition, type LevelSpawn, type SpawnSlot } from './format.ts';

export type ArenaSize = 'small' | 'medium' | 'large';

/** The sizes the setup screen offers, smallest first. */
export const ARENA_SIZES: readonly ArenaSize[] = ['small', 'medium', 'large'];

/** Lattice cells per side (1.5 m each): 60 m, 72 m (the authored arena's size) and 90 m. */
const SIZE_CELLS: Readonly<Record<ArenaSize, number>> = { small: 40, medium: 48, large: 60 };

/** Generated arena seeds share the match seed's range. */
export const MAX_ARENA_SEED = 999_999;

/** How many deterministic re-rolls a seed gets before generation fails loudly. */
const MAX_ATTEMPTS = 12;

const SPACING = 1.5;
const CELLS_Y = 16; // 24 m of headroom: the tallest feature tops out near 17 m
const BASE = 4.5;
const SLOT_OFFSET = 2.4;
const PAD_FLAT_RADIUS = 6;
const PAD_BLEND = 4;
/** Features keep this far from a pad centre (beyond their own radius). */
const PAD_CLEARANCE = PAD_FLAT_RADIUS + PAD_BLEND + 1.5;
/** A tunnel or arch opening: comfortably above the tank's 1.5 m body plus nav headroom. */
const TUNNEL_MIN_RADIUS = 2.6;

export interface GeneratedArena {
  readonly level: LevelDefinition;
  readonly seed: number;
  readonly size: ArenaSize;
  readonly widthMetres: number;
  /** The open ground level (the pads). Cameras and demos frame on it. */
  readonly baseHeightMetres: number;
  /** Which re-roll of the seed produced the level (0 = the first try). */
  readonly attempt: number;
}

// ---------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------

/** mulberry32: a 32-bit integer PRNG, exact on every engine. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** A unit vector in the horizontal plane, from integer-free math. */
  direction(): { x: number; z: number };
}

function rngFrom(seed: number): Rng {
  const next = createRandom(seed);
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    direction: () => {
      for (;;) {
        const x = next() * 2 - 1;
        const z = next() * 2 - 1;
        const length = Math.sqrt(x * x + z * z);
        if (length > 0.2 && length <= 1) return { x: x / length, z: z / length };
      }
    },
  };
  return rng;
}

// ---------------------------------------------------------------------------------
// Shape helpers (all exact-arithmetic)
// ---------------------------------------------------------------------------------

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function length2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/** A round bump: 1 at the centre, 0 at t ≥ 1, zero slope at both ends. */
function bump(t: number): number {
  if (t >= 1) return 0;
  const s = 1 - t * t;
  return s * s;
}

/** Smooth 2-D value noise in [0, 1). */
function valueNoise(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash3(ix, iz, salt);
  const b = hash3(ix + 1, iz, salt);
  const c = hash3(ix, iz + 1, salt);
  const d = hash3(ix + 1, iz + 1, salt);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

/** One 90° turn about the centre, in centre-relative coordinates (the builder's turn). */
function turn(u: number, v: number): { u: number; v: number } {
  return { u: -v, v: u };
}

// ---------------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------------

interface ShapeContext {
  readonly ground: number;
}

/** One piece of landscape at a centre-relative position. */
interface Feature {
  readonly kind: string;
  readonly u: number;
  readonly v: number;
  /** Footprint radius, for spacing and pad clearance. */
  readonly radius: number;
  /** Raises the open ground (hills, mesas); in metres above BASE. */
  readonly height?: (du: number, dv: number) => number;
  /** Solid volume over the ground (walls, spires, domes), with its material. */
  readonly solid?: (du: number, dv: number, y: number, context: ShapeContext) => TerrainSample;
  /** The feature turned by 90°, for the next quarter. */
  rotate(): Feature;
}

interface FeatureParams {
  readonly kind: string;
  readonly radius: number;
  /** Orientation (unit vector); features without one ignore it. */
  readonly dirX: number;
  readonly dirZ: number;
  readonly values: readonly number[];
}

function makeFeature(params: FeatureParams, u: number, v: number): Feature {
  const { kind, radius, dirX, dirZ, values } = params;
  // Coordinates along (a) and across (b) the feature's direction.
  const local = (du: number, dv: number): { a: number; b: number } => ({
    a: du * dirX + dv * dirZ,
    b: -du * dirZ + dv * dirX,
  });
  const rotate = (): Feature => {
    const p = turn(u, v);
    const d = turn(dirX, dirZ);
    return makeFeature({ ...params, dirX: d.u, dirZ: d.v }, p.u, p.v);
  };
  const base = { kind, u, v, radius, rotate };
  switch (kind) {
    case 'hill': {
      const [height] = values as [number];
      return { ...base, height: (du, dv) => height * bump(length2(du, dv) / radius) };
    }
    case 'mesa': {
      // A flat-topped plateau with cliffs and one ramp running out along the direction.
      const [height, top, rampLength, rampHalfWidth] = values as [number, number, number, number];
      return {
        ...base,
        height: (du, dv) => {
          const d = length2(du, dv);
          const cliff = height * (1 - smoothstep(top, top + 1.2, d));
          const { a, b } = local(du, dv);
          const along = (a - top + 0.6) / rampLength;
          const ramp =
            a > 0 && along < 1 && Math.abs(b) < rampHalfWidth
              ? height * (1 - clamp01(along)) * (1 - smoothstep(rampHalfWidth - 1, rampHalfWidth, Math.abs(b)))
              : 0;
          return Math.max(cliff, ramp);
        },
      };
    }
    case 'cave': {
      // A dome with a straight tunnel through it along the direction.
      const [height, tunnelRadius] = values as [number, number];
      return {
        ...base,
        solid: (du, dv, y, context) => {
          const d = length2(du, dv);
          if (d >= radius) return { solidity: -Infinity };
          const top = BASE + height * bump(d / radius) * 1.0;
          const { b } = local(du, dv);
          const above = Math.max(0, y - context.ground);
          const tunnel = tunnelRadius - length2(b, above);
          return { solidity: Math.min(top - y, -tunnel) };
        },
      };
    }
    case 'arch': {
      // A wall across the direction, pierced by a round arch; its crown is crystal.
      const [halfLength, halfThickness, wallTop, archRadius] = values as [number, number, number, number];
      return {
        ...base,
        solid: (du, dv, y, context) => {
          const { a, b } = local(du, dv);
          if (Math.abs(a) > halfThickness + 2 || Math.abs(b) > halfLength + 2) return { solidity: -Infinity };
          const wall = Math.min(halfThickness - Math.abs(a), halfLength - Math.abs(b), BASE + wallTop - y);
          const hole = archRadius - length2(b, Math.max(0, y - context.ground));
          const solidity = Math.min(wall, -hole);
          return { solidity, material: y >= BASE + wallTop - 1.4 ? MATERIAL_CRYSTAL : MATERIAL_ROCK };
        },
      };
    }
    case 'wall': {
      // Low cover: hides a hull, not a turret.
      const [halfLength, halfThickness, wallTop] = values as [number, number, number];
      return {
        ...base,
        solid: (du, dv, y) => {
          const { a, b } = local(du, dv);
          if (Math.abs(a) > halfThickness + 2 || Math.abs(b) > halfLength + 2) return { solidity: -Infinity };
          return { solidity: Math.min(halfThickness - Math.abs(a), halfLength - Math.abs(b), BASE + wallTop - y) };
        },
      };
    }
    case 'spire': {
      // A mushroom: a flared stem under a crystal cap that falls when the stem is cut.
      const [stemRadius, stemTop, capRadius, capHalfHeight] = values as [number, number, number, number];
      return {
        ...base,
        solid: (du, dv, y) => {
          const d = length2(du, dv);
          if (d > capRadius + 2) return { solidity: -Infinity };
          const flare = 1.4 * (1 - smoothstep(BASE, BASE + 2.5, y));
          const stem = Math.min(stemRadius + flare - d, BASE + stemTop - y);
          const capCentre = BASE + stemTop + capHalfHeight * 0.5;
          const e = length2(d / capRadius, (y - capCentre) / capHalfHeight);
          const cap = (1 - e) * capHalfHeight;
          return cap > stem - 0.4 && cap > 0
            ? { solidity: Math.max(stem, cap), material: MATERIAL_CRYSTAL }
            : { solidity: Math.max(stem, cap) };
        },
      };
    }
    default:
      throw new Error(`generator: unknown feature kind "${kind}"`);
  }
}

// ---------------------------------------------------------------------------------
// The arena
// ---------------------------------------------------------------------------------

interface Layout {
  readonly name: string;
  readonly intent: string;
  readonly sample: (x: number, y: number, z: number) => TerrainSample;
  readonly pad: number;
  readonly cells: number;
}

const NAME_FIRST = ['Neon', 'Vector', 'Prism', 'Grid', 'Pulse', 'Chrome', 'Laser', 'Ion', 'Static', 'Photon', 'Quartz', 'Zero'];
const NAME_SECOND = ['Hollows', 'Spires', 'Basin', 'Ridges', 'Crown', 'Maze', 'Dunes', 'Bastion', 'Rift', 'Gardens', 'Foundry', 'Steppe'];

const CENTREPIECES = ['tunnel-hill', 'crater', 'plateau', 'great-spire'] as const;
type Centrepiece = (typeof CENTREPIECES)[number];

const CENTREPIECE_TEXT: Readonly<Record<Centrepiece, string>> = {
  'tunnel-hill': 'a central hill whose two crossing tunnels meet in a cavern under the summit',
  crater: 'a central crater ringed by a wall with four gaps',
  plateau: 'a central plateau with four ramps, hollowed by a crossing cave',
  'great-spire': 'a giant crystal-capped spire at the centre in a ring of mounds',
};

const FEATURE_TEXT: Readonly<Record<string, [string, string]>> = {
  hill: ['hill', 'hills'],
  mesa: ['plateau with a ramp', 'plateaus with ramps'],
  cave: ['cave mound', 'cave mounds'],
  arch: ['arched wall', 'arched walls'],
  wall: ['cover wall', 'cover walls'],
  spire: ['mushroom spire', 'mushroom spires'],
};

/** Feature kinds and their draw weights. */
const FEATURE_WEIGHTS: readonly (readonly [string, number])[] = [
  ['hill', 3],
  ['cave', 2],
  ['arch', 2],
  ['spire', 2],
  ['mesa', 1.5],
  ['wall', 1.5],
];

function drawFeatureParams(rng: Rng, scale: number): FeatureParams {
  let total = 0;
  for (const [, weight] of FEATURE_WEIGHTS) total += weight;
  let roll = rng.next() * total;
  let kind = FEATURE_WEIGHTS[0]![0];
  for (const [candidate, weight] of FEATURE_WEIGHTS) {
    roll -= weight;
    if (roll < 0) {
      kind = candidate;
      break;
    }
  }
  const dir = rng.direction();
  const make = (radius: number, values: number[]): FeatureParams => ({ kind, radius, dirX: dir.x, dirZ: dir.z, values });
  switch (kind) {
    case 'hill': {
      const radius = rng.range(5, 8.5) * scale;
      // Height ≤ 0.5 × radius keeps the steepest flank under the 40° climb limit.
      return make(radius, [radius * rng.range(0.28, 0.48)]);
    }
    case 'mesa': {
      const height = rng.range(2.6, 4.2);
      const top = rng.range(3.2, 4.6);
      const rampLength = height / 0.5;
      return make(top + rampLength + 1, [height, top, rampLength, 2.4]);
    }
    case 'cave': {
      const tunnelRadius = rng.range(TUNNEL_MIN_RADIUS, 3.1);
      const height = tunnelRadius + rng.range(2.2, 3.6);
      return make(rng.range(6.5, 8.5) * scale, [height, tunnelRadius]);
    }
    case 'arch': {
      const archRadius = rng.range(TUNNEL_MIN_RADIUS + 0.1, 3.2);
      const halfLength = rng.range(5, 7.5) * scale;
      return make(halfLength + 1, [halfLength, rng.range(1, 1.5), archRadius + rng.range(2, 3.4), archRadius]);
    }
    case 'wall': {
      const halfLength = rng.range(2.8, 4.5);
      return make(halfLength + 1, [halfLength, rng.range(0.8, 1.1), rng.range(1.6, 2.2)]);
    }
    case 'spire': {
      const capRadius = rng.range(3, 4.3);
      return make(capRadius + 0.5, [rng.range(1.3, 1.9), rng.range(5.5, 7.5), capRadius, rng.range(1.2, 1.7)]);
    }
    default:
      throw new Error(`generator: no parameters for feature kind "${kind}"`);
  }
}

function centrepieceSolidity(
  kind: Centrepiece,
  values: readonly number[],
  u: number,
  v: number,
  y: number,
  ground: number,
): TerrainSample {
  const r = length2(u, v);
  switch (kind) {
    case 'tunnel-hill': {
      const [radius, height, tunnelRadius, cavernRadius] = values as [number, number, number, number];
      if (r >= radius) return { solidity: -Infinity };
      const top = BASE + height * bump(r / radius);
      const above = Math.max(0, y - ground);
      const tunnelU = tunnelRadius - length2(v, above);
      const tunnelV = tunnelRadius - length2(u, above);
      const cavern = cavernRadius - length2(r, above * 0.9);
      return { solidity: Math.min(top - y, -tunnelU, -tunnelV, -cavern) };
    }
    case 'crater': {
      const [ringRadius, halfThickness, wallTop, gapHalfWidth] = values as [number, number, number, number];
      const ring = Math.min(halfThickness - Math.abs(r - ringRadius), BASE + wallTop - y);
      // Four gaps on the diagonals: |u| ≈ |v|.
      const gap = gapHalfWidth - Math.abs(Math.abs(u) - Math.abs(v)) / 1.41421356;
      return { solidity: Math.min(ring, -gap), material: y >= BASE + wallTop - 1.2 ? MATERIAL_CRYSTAL : MATERIAL_ROCK };
    }
    case 'plateau': {
      const [top, height, rampLength, tunnelRadius] = values as [number, number, number, number];
      // A square-ish plateau (rounded) with four ramps along the axes.
      const d = Math.max(Math.abs(u), Math.abs(v)) * 0.6 + r * 0.4;
      const cliff = height * (1 - smoothstep(top, top + 1.2, d));
      const axial = Math.max(Math.abs(u), Math.abs(v));
      const lateral = Math.min(Math.abs(u), Math.abs(v));
      const along = (axial - top + 0.6) / rampLength;
      const ramp = along < 1 && lateral < 2.6 ? height * (1 - clamp01(along)) * (1 - smoothstep(1.6, 2.6, lateral)) : 0;
      const surface = BASE + Math.max(cliff, ramp);
      if (surface <= BASE + 0.01) return { solidity: -Infinity };
      // The crossing cave runs on the diagonals, under the plateau top only.
      const above = Math.max(0, y - ground);
      const diagonal = Math.abs(Math.abs(u) - Math.abs(v)) / 1.41421356;
      const cave = tunnelRadius - length2(diagonal, above);
      return { solidity: Math.min(surface - y, -cave) };
    }
    case 'great-spire': {
      const [stemRadius, stemTop, capRadius, capHalfHeight, moundRing, moundRadius, moundHeight] = values as [
        number, number, number, number, number, number, number,
      ];
      const flare = 2 * (1 - smoothstep(BASE, BASE + 3.5, y));
      const stem = Math.min(stemRadius + flare - r, BASE + stemTop - y);
      const capCentre = BASE + stemTop + capHalfHeight * 0.5;
      const e = length2(r / capRadius, (y - capCentre) / capHalfHeight);
      const cap = (1 - e) * capHalfHeight;
      let mound = -Infinity;
      for (const [mu, mv] of [[moundRing, 0], [0, moundRing], [-moundRing, 0], [0, -moundRing]] as const) {
        mound = Math.max(mound, BASE + moundHeight * bump(length2(u - mu, v - mv) / moundRadius) - y);
      }
      const solidity = Math.max(stem, cap, mound);
      return cap > 0 && cap > stem - 0.4 && cap >= mound ? { solidity, material: MATERIAL_CRYSTAL } : { solidity };
    }
  }
}

function centrepieceParams(kind: Centrepiece, rng: Rng, scale: number): { radius: number; values: number[] } {
  switch (kind) {
    case 'tunnel-hill': {
      const radius = rng.range(14, 18) * scale;
      return { radius, values: [radius, rng.range(6.5, 8.5), rng.range(2.7, 3.1), rng.range(4.8, 5.8)] };
    }
    case 'crater': {
      const ringRadius = rng.range(9, 12) * scale;
      return { radius: ringRadius + 2, values: [ringRadius, rng.range(1.2, 1.7), rng.range(3.5, 5.5), rng.range(2.8, 3.6)] };
    }
    case 'plateau': {
      const top = rng.range(6, 8) * scale;
      const height = rng.range(4.5, 5.8);
      const rampLength = height / 0.5;
      return { radius: top + rampLength + 1, values: [top, height, rampLength, rng.range(2.7, 3.0)] };
    }
    case 'great-spire': {
      const moundRing = rng.range(9, 12) * scale;
      const moundRadius = rng.range(4, 5.5);
      return {
        radius: moundRing + moundRadius,
        values: [rng.range(2.2, 2.8), rng.range(8, 10.5), rng.range(5.5, 7), rng.range(1.6, 2.1), moundRing, moundRadius, moundRadius * rng.range(0.3, 0.45)],
      };
    }
  }
}

function describeFeatures(kinds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([kind, count]) => {
    const [one, many] = FEATURE_TEXT[kind]!;
    return count === 1 ? `${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}` : `${count} ${many}`;
  });
  if (parts.length === 0) return 'open ground';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
}

function sizeLabel(size: ArenaSize, width: number): string {
  return `${size}, ${width} × ${width} m`;
}

/** One candidate layout for a seed and attempt. */
function layoutFor(seed: number, size: ArenaSize, attempt: number): Layout {
  const rng = rngFrom(Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b));
  const cells = SIZE_CELLS[size];
  const width = cells * SPACING;
  const centre = width / 2;
  const scale = width / 72;

  const rimWidth = rng.range(5.5, 7.5);
  const rimHeight = rng.range(5.5, 8);
  const pad = rimWidth + 4.5;
  const padCentres = [
    [pad - centre, pad - centre],
    [centre - pad, pad - centre],
    [centre - pad, centre - pad],
    [pad - centre, centre - pad],
  ] as const;

  const roughness = rng.range(0.4, 1.4);
  const noiseScale = rng.range(7, 11);
  const noiseSalt = rng.int(1, 1 << 30);

  const centrepiece = rng.pick(CENTREPIECES);
  const centreParams = centrepieceParams(centrepiece, rng, scale);

  // Per-quarter features, placed in centre-relative coordinates and rotated four times.
  const features: Feature[] = [];
  const wanted = rng.int(2, 4) + (size === 'large' ? 2 : size === 'medium' ? 1 : 0);
  const placedKinds: string[] = [];
  const limit = centre - rimWidth - 1;
  for (let tries = 0; tries < 200 && placedKinds.length < wanted; tries += 1) {
    const params = drawFeatureParams(rng, scale);
    const u = rng.range(-limit, limit);
    const v = rng.range(-limit, limit);
    if (Math.max(Math.abs(u), Math.abs(v)) + params.radius * 0.55 > limit) continue;
    if (length2(u, v) < centreParams.radius + params.radius * 0.6 + 1) continue;
    let clear = true;
    for (const [pu, pv] of padCentres) {
      if (length2(u - pu, v - pv) < PAD_CLEARANCE + params.radius * 0.6) clear = false;
    }
    // Keep the four rotations of this feature apart from each other and the others.
    let candidate = makeFeature(params, u, v);
    const copies: Feature[] = [];
    for (let quarter = 0; quarter < 4; quarter += 1) {
      copies.push(candidate);
      candidate = candidate.rotate();
    }
    for (const copy of copies) {
      for (const other of features) {
        if (length2(copy.u - other.u, copy.v - other.v) < (copy.radius + other.radius) * 0.75 + 1.5) clear = false;
      }
    }
    for (let a = 1; a < 4; a += 1) {
      if (length2(copies[0]!.u - copies[a]!.u, copies[0]!.v - copies[a]!.v) < params.radius * 1.5 + 1.5) clear = false;
    }
    if (!clear) continue;
    features.push(...copies);
    placedKinds.push(params.kind);
  }

  const groundAt = (u: number, v: number): number => {
    const x = u + centre;
    const z = v + centre;
    // Rotation-summed value noise: the same under every 90° turn.
    let noise = 0;
    let pu = u;
    let pv = v;
    for (let quarter = 0; quarter < 4; quarter += 1) {
      noise += valueNoise(pu / noiseScale, pv / noiseScale, noiseSalt) + 0.5 * valueNoise(pu / (noiseScale * 0.45), pv / (noiseScale * 0.45), noiseSalt + 7);
      const next = turn(pu, pv);
      pu = next.u;
      pv = next.v;
    }
    noise = noise / 6 - 0.5; // about −0.5…0.5
    let padDistance = Infinity;
    for (const [qu, qv] of padCentres) padDistance = Math.min(padDistance, length2(u - qu, v - qv));
    const open = smoothstep(PAD_FLAT_RADIUS, PAD_FLAT_RADIUS + PAD_BLEND, padDistance);
    const edge = Math.min(x, z, width - x, width - z);
    const rim = rimHeight * (1 - smoothstep(0, rimWidth, edge));
    let raised = 0;
    for (const feature of features) {
      if (!feature.height) continue;
      const du = u - feature.u;
      const dv = v - feature.v;
      if (Math.abs(du) > feature.radius + 1 || Math.abs(dv) > feature.radius + 1) continue;
      raised = Math.max(raised, feature.height(du, dv));
    }
    return BASE + noise * 2 * roughness * open + raised + rim;
  };

  const sample = (x: number, y: number, z: number): TerrainSample => {
    const u = x - centre;
    const v = z - centre;
    const ground = groundAt(u, v);
    let best: TerrainSample = { solidity: ground - y };
    const context: ShapeContext = { ground: Math.min(ground, BASE + 1) };
    const central = centrepieceSolidity(centrepiece, centreParams.values, u, v, y, BASE);
    if (central.solidity > best.solidity) best = central;
    for (const feature of features) {
      if (!feature.solid) continue;
      const du = u - feature.u;
      const dv = v - feature.v;
      if (Math.abs(du) > feature.radius + 3 || Math.abs(dv) > feature.radius + 3) continue;
      const piece = feature.solid(du, dv, y, context);
      if (piece.solidity > best.solidity) best = piece;
    }
    return best;
  };

  const name = `${NAME_FIRST[seed % NAME_FIRST.length]!} ${NAME_SECOND[Math.floor(seed / NAME_FIRST.length) % NAME_SECOND.length]!} ${seed}`;
  const intent =
    `Generated from seed ${seed} (${sizeLabel(size, width)}): four corner pads around ${CENTREPIECE_TEXT[centrepiece]}; ` +
    `each quarter holds ${describeFeatures(placedKinds)}, rotated onto the other three so no corner is favoured. A steep rim closes the arena.`;
  return { name, intent, sample, pad, cells };
}

/** Removes solid samples that do not connect to bedrock (they would fall at the first blast). */
function pruneFloating(spec: WorldSpec): void {
  const { samplesX: nx, samplesY: ny, samplesZ: nz, density, material } = spec;
  const count = nx * ny * nz;
  const reached = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const index = ny * (i + nx * k);
      reached[index] = 1;
      queue[tail++] = index;
    }
  }
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
    if (i + 1 < nx) visit(index + ny);
    if (i > 0) visit(index - ny);
    if (k + 1 < nz) visit(index + ny * nx);
    if (k > 0) visit(index - ny * nx);
  }
  for (let index = 0; index < count; index += 1) {
    if (reached[index] === 0 && density[index]! >= DENSITY_ISO) {
      density[index] = DENSITY_ISO - 1;
      material[index] = MATERIAL_ROCK;
    }
  }
}

function buildSpawns(pad: number, width: number): readonly LevelSpawn[] {
  const rotatePoint = (x: number, z: number): { x: number; z: number } => ({ x: width - z, z: x });
  const teamZero: readonly SpawnSlot[] = [
    { xMetres: pad + SLOT_OFFSET, zMetres: pad + SLOT_OFFSET },
    { xMetres: pad + SLOT_OFFSET, zMetres: pad - SLOT_OFFSET },
    { xMetres: pad - SLOT_OFFSET, zMetres: pad + SLOT_OFFSET },
    { xMetres: pad - SLOT_OFFSET, zMetres: pad - SLOT_OFFSET },
  ];
  const spawns: LevelSpawn[] = [];
  let centre = { x: pad, z: pad };
  let slots = teamZero.map((slot) => ({ x: slot.xMetres, z: slot.zMetres }));
  for (let teamId = 0; teamId < 4; teamId += 1) {
    // Team 0 faces the centre: forward (+1, +1) is yaw −135° in the sim convention.
    let yaw = -135 - 90 * teamId;
    while (yaw < -180) yaw += 360;
    spawns.push({
      teamId,
      xMetres: centre.x,
      zMetres: centre.z,
      yawDegrees: yaw,
      slots: slots.map((slot) => ({ xMetres: slot.x, zMetres: slot.z })),
    });
    centre = rotatePoint(centre.x, centre.z);
    slots = slots.map((slot) => rotatePoint(slot.x, slot.z));
  }
  return spawns;
}

export function validateArenaSeed(seed: number): number {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_ARENA_SEED) {
    throw new Error(`generator: arena seed must be an integer 0…${MAX_ARENA_SEED}, got ${String(seed)}`);
  }
  return seed;
}

export function validateArenaSize(size: string): ArenaSize {
  if (!(ARENA_SIZES as readonly string[]).includes(size)) {
    throw new Error(`generator: arena size must be one of ${ARENA_SIZES.join(', ')}, got "${size}"`);
  }
  return size as ArenaSize;
}

/**
 * Generates the arena for a seed and size. Pure: the same inputs give the same level,
 * byte for byte, on every machine. Throws when no attempt yields a valid level.
 */
export function generateArena(seed: number, size: ArenaSize): GeneratedArena {
  validateArenaSeed(seed);
  validateArenaSize(size);
  const failures: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const layout = layoutFor(seed, size, attempt);
    const terrain = buildTerrain({
      cellsX: layout.cells,
      cellsY: CELLS_Y,
      cellsZ: layout.cells,
      spacingMetres: SPACING,
      fourFold: true,
      sample: layout.sample,
    });
    pruneFloating(terrain);
    const width = layout.cells * SPACING;
    const level: LevelDefinition = {
      name: layout.name,
      intent: layout.intent,
      terrain,
      spawns: buildSpawns(layout.pad, width),
    };
    try {
      validateLevel(level);
    } catch (error) {
      // A rejected layout is re-rolled, never used; every reason is kept for the error.
      failures.push(`attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    return { level, seed, size, widthMetres: width, baseHeightMetres: BASE, attempt };
  }
  throw new Error(`generator: seed ${seed} (${size}) produced no valid arena:\n${failures.join('\n')}`);
}
