/**
 * How a tank's hull sits on the terrain: the ONE place that turns density questions
 * into a pose (height, pitch, roll) and a yes/no for "may the body be here".
 *
 * The hull rests on the highest of five ground probes, so it never sinks into a bump,
 * and its pitch and roll come from the front/back and left/right probes. A position is
 * free when the footprint is inside the arena and no rock fills the body's headroom.
 */

import { groundBelow, isSolidAt, type World } from '../world.ts';
import {
  TANK_HEADROOM_HEIGHTS_METRES,
  TANK_PROBE_FORWARD_METRES,
  TANK_PROBE_SIDE_METRES,
  TANK_RADIUS_METRES,
} from './constants.ts';
import * as detMath from '../detMath.ts';

export interface HullPose {
  /** The hull origin's height (the ground under the highest probe). */
  readonly y: number;
  readonly pitchDegrees: number;
  readonly rollDegrees: number;
}

/**
 * The hull pose at `(x, z)` for a hull yaw, looking for ground at or below `fromY`.
 * Pitch is positive nose-up; roll is positive when the left side is higher.
 */
export function hullPoseAt(world: World, x: number, z: number, yawDegrees: number, fromY: number): HullPose {
  const radians = (yawDegrees * Math.PI) / 180;
  const fx = -detMath.sin(radians);
  const fz = -detMath.cos(radians);
  // Left of forward in this convention is (-fz, fx) rotated: yaw + 90° turns towards -x.
  const lx = -detMath.cos(radians);
  const lz = detMath.sin(radians);
  const centre = groundBelow(world, x, z, fromY);
  const front = groundBelow(world, x + fx * TANK_PROBE_FORWARD_METRES, z + fz * TANK_PROBE_FORWARD_METRES, fromY);
  const back = groundBelow(world, x - fx * TANK_PROBE_FORWARD_METRES, z - fz * TANK_PROBE_FORWARD_METRES, fromY);
  const left = groundBelow(world, x + lx * TANK_PROBE_SIDE_METRES, z + lz * TANK_PROBE_SIDE_METRES, fromY);
  const right = groundBelow(world, x - lx * TANK_PROBE_SIDE_METRES, z - lz * TANK_PROBE_SIDE_METRES, fromY);
  const y = Math.max(centre, front, back, left, right);
  return {
    y,
    pitchDegrees: (detMath.atan2(front - back, 2 * TANK_PROBE_FORWARD_METRES) * 180) / Math.PI,
    rollDegrees: (detMath.atan2(left - right, 2 * TANK_PROBE_SIDE_METRES) * 180) / Math.PI,
  };
}

/** Is the horizontal footprint inside the arena with the body's radius to spare? */
export function footprintInsideArena(world: World, x: number, z: number): boolean {
  const r = TANK_RADIUS_METRES;
  return x - r >= 0 && z - r >= 0 && x + r <= world.widthMetres && z + r <= world.depthMetres;
}

const HEADROOM_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [-0.7071, 0.7071],
  [0.7071, -0.7071],
  [-0.7071, -0.7071],
];

/** True when no rock fills the body's volume with the hull origin at height `y`. */
export function bodyHeadroomClear(world: World, x: number, y: number, z: number): boolean {
  const reach = TANK_RADIUS_METRES * 0.9;
  for (const height of TANK_HEADROOM_HEIGHTS_METRES) {
    for (const [dx, dz] of HEADROOM_DIRECTIONS) {
      if (isSolidAt(world, x + dx * reach, y + height, z + dz * reach)) return false;
    }
  }
  return true;
}

/**
 * Can a tank stand at `(x, z)` with its hull resting on the ground found below
 * `fromY`? Returns the pose, or null when the footprint leaves the arena or rock fills
 * the body.
 */
export function standingPoseAt(world: World, x: number, z: number, yawDegrees: number, fromY: number): HullPose | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(fromY)) {
    throw new Error(`sim: tank position must be finite, got (${x}, ${fromY}, ${z})`);
  }
  if (!footprintInsideArena(world, x, z)) return null;
  const pose = hullPoseAt(world, x, z, yawDegrees, fromY);
  if (pose.y >= fromY - 1e-9) return null; // the probe started inside rock
  if (!bodyHeadroomClear(world, x, pose.y, z)) return null;
  return pose;
}
