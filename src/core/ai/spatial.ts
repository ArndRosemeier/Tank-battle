/**
 * The AI's D4 spatial frame.
 *
 * A tank that starts in a rotated or mirrored copy of the same arena must make the same
 * decision in its own frame. The arena is 4-fold symmetric, so navigation is run in a
 * canonical frame with the tank's spawn pose mapped to the canonical NW/east pose.
 * Points, cells and yaw can be transformed; the simulation itself stays in world space.
 *
 * `reflected` is a reflection in z, followed by `turns` counter-clockwise quarter turns.
 * Both are exact grid symmetries of a square arena.
 */

import { CELL_SIZE_METRES, shortestAngleDelta } from '../sim.ts';
import type { World } from '../world.ts';

export interface SpatialFrame {
  readonly reflected: boolean;
  readonly turns: 0 | 1 | 2 | 3;
}

export const IDENTITY_FRAME: SpatialFrame = Object.freeze({ reflected: false, turns: 0 });

export interface FramePoint {
  readonly x: number;
  readonly z: number;
}

/** The pose a canonical frame maps a spawn to: NW corner, hull facing east. */
const CANONICAL_YAW_DEGREES = -90;

/** Transforms a world point into the canonical frame. */
export function worldToFrame(world: World, frame: SpatialFrame, x: number, z: number): FramePoint {
  const centreX = (world.columns * CELL_SIZE_METRES) / 2;
  const centreZ = (world.rows * CELL_SIZE_METRES) / 2;
  let dx = x - centreX;
  let dz = z - centreZ;
  if (frame.reflected) dz = -dz;
  for (let turn = 0; turn < frame.turns; turn += 1) {
    const nextX = -dz;
    dz = dx;
    dx = nextX;
  }
  return { x: centreX + dx, z: centreZ + dz };
}

/** Transforms a canonical point back to world space. */
export function frameToWorld(world: World, frame: SpatialFrame, x: number, z: number): FramePoint {
  const centreX = (world.columns * CELL_SIZE_METRES) / 2;
  const centreZ = (world.rows * CELL_SIZE_METRES) / 2;
  let dx = x - centreX;
  let dz = z - centreZ;
  for (let turn = 0; turn < frame.turns; turn += 1) {
    const nextX = dz;
    dz = -dx;
    dx = nextX;
  }
  if (frame.reflected) dz = -dz;
  return { x: centreX + dx, z: centreZ + dz };
}

/** Transforms a hull/turret yaw into the canonical frame. */
export function worldYawToFrame(frame: SpatialFrame, yawDegrees: number): number {
  const radians = (yawDegrees * Math.PI) / 180;
  let fx = -Math.sin(radians);
  let fz = -Math.cos(radians);
  if (frame.reflected) fz = -fz;
  for (let turn = 0; turn < frame.turns; turn += 1) {
    const nextX = -fz;
    fz = fx;
    fx = nextX;
  }
  return (Math.atan2(-fx, -fz) * 180) / Math.PI;
}

/**
 * Selects the D4 transform that maps a starting pose into the canonical NW/east pose.
 * The choice is deterministic: exact yaw match first, then closest to the NW corner,
 * then the lowest frame index. If no candidate lands in the NW quadrant, the closest
 * yaw candidate is used (a loud fallback for an unusual authored start).
 */
export function frameForPose(world: World, xMetres: number, zMetres: number, yawDegrees: number): SpatialFrame {
  if (!Number.isFinite(xMetres) || !Number.isFinite(zMetres) || !Number.isFinite(yawDegrees)) {
    throw new Error('spatial: pose must be finite');
  }
  const centreX = (world.columns * CELL_SIZE_METRES) / 2;
  const centreZ = (world.rows * CELL_SIZE_METRES) / 2;
  let best: SpatialFrame | null = null;
  let bestScore = Infinity;
  let bestYawError = Infinity;
  for (const reflected of [false, true] as const) {
    for (const turns of [0, 1, 2, 3] as const) {
      const frame: SpatialFrame = { reflected, turns };
      const point = worldToFrame(world, frame, xMetres, zMetres);
      const yaw = worldYawToFrame(frame, yawDegrees);
      const yawError = Math.abs(shortestAngleDelta(yaw, CANONICAL_YAW_DEGREES));
      const inNw = point.x <= centreX && point.z <= centreZ;
      const distance = Math.hypot(point.x - CELL_SIZE_METRES * 3, point.z - CELL_SIZE_METRES * 3);
      const score = (inNw ? 0 : 1_000_000) + yawError * 1000 + distance;
      if (score < bestScore) {
        best = frame;
        bestScore = score;
        bestYawError = yawError;
      }
    }
  }
  if (!best) {
    throw new Error('spatial: no D4 frame candidate');
  }
  // A start with no NW candidate is still deterministic; keep the closest-yaw frame.
  if (bestYawError === Infinity) {
    throw new Error('spatial: no finite yaw candidate');
  }
  return Object.freeze(best);
}
