/**
 * Segment-vs-terrain queries. A segment is marched in short steps against the
 * trilinear density and the first solid step is refined by bisection, so the hit point
 * lies on the iso-surface to within a millimetre.
 */

import { DENSITY_ISO } from './constants.ts';
import { densityAt, type World } from './field.ts';

/** Step length of the march. Thinner than the thinnest wall a 1.5 m lattice can make. */
export const RAYCAST_STEP_METRES = 0.25;
const BISECTION_STEPS = 10;

export interface TerrainHit {
  /** Fraction along `from → to`, 0…1. */
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The first point where the segment enters solid terrain, or null. A segment that
 * starts inside solid terrain hits at `t = 0`.
 */
export function raycastTerrain(world: World, from: Point, to: Point): TerrainHit | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (densityAt(world, from.x, from.y, from.z) >= DENSITY_ISO) {
    return { t: 0, x: from.x, y: from.y, z: from.z };
  }
  if (length < 1e-12) {
    return null;
  }
  const steps = Math.max(1, Math.ceil(length / RAYCAST_STEP_METRES));
  let previous = 0;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    if (densityAt(world, from.x + dx * t, from.y + dy * t, from.z + dz * t) >= DENSITY_ISO) {
      let low = previous;
      let high = t;
      for (let iteration = 0; iteration < BISECTION_STEPS; iteration += 1) {
        const middle = (low + high) / 2;
        if (densityAt(world, from.x + dx * middle, from.y + dy * middle, from.z + dz * middle) >= DENSITY_ISO) {
          high = middle;
        } else {
          low = middle;
        }
      }
      return { t: high, x: from.x + dx * high, y: from.y + dy * high, z: from.z + dz * high };
    }
    previous = t;
  }
  return null;
}

/** True when the straight segment between the two points stays in air. */
export function hasClearLine(world: World, from: Point, to: Point): boolean {
  return raycastTerrain(world, from, to) === null;
}
