/**
 * The simulation's pure geometry and angle helpers. No `three`, no world, no clock.
 *
 * The conventions live here so the renderer, the tests and the future network client
 * read one definition:
 *
 *  - **yaw 0 faces -z**, positive yaw turns towards -x;
 *  - **pitch is degrees above the horizon** (positive up), so a negative pitch aims at
 *    the floor;
 *  - a shell direction is `(-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))`;
 *  - segment intersections return a `t` in `[0, 1]` along `from → to`, or `null`.
 */

import * as detMath from '../detMath.ts';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const EPSILON = 1e-12;

/** Wrap an angle in degrees into `[-180, 180)`. An angle, not a clamp. */
export function normaliseDegrees(value: number): number {
  const wrapped = value % 360;
  if (wrapped >= 180) {
    return wrapped - 360;
  }
  if (wrapped < -180) {
    return wrapped + 360;
  }
  return wrapped;
}

/** The shortest signed difference `to - from`, in `[-180, 180)`. */
export function shortestAngleDelta(fromDegrees: number, toDegrees: number): number {
  return normaliseDegrees(toDegrees - fromDegrees);
}

/** Turns `current` towards `target` by at most `maxDelta` degrees, on the short arc. */
export function rotateTowards(currentDegrees: number, targetDegrees: number, maxDelta: number): number {
  if (maxDelta < 0 || !Number.isFinite(maxDelta)) {
    throw new Error(`sim: maxDelta must be finite and >= 0, got ${maxDelta}`);
  }
  const delta = shortestAngleDelta(currentDegrees, targetDegrees);
  if (Math.abs(delta) <= maxDelta) {
    return normaliseDegrees(targetDegrees);
  }
  return normaliseDegrees(currentDegrees + Math.sign(delta) * maxDelta);
}

/** Moves a plain number towards `target` by at most `maxDelta` (pitch, not wrapped). */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (maxDelta < 0 || !Number.isFinite(maxDelta)) {
    throw new Error(`sim: maxDelta must be finite and >= 0, got ${maxDelta}`);
  }
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }
  return current + Math.sign(delta) * maxDelta;
}

/** The horizontal unit forward vector for a hull/turret yaw. */
export function forwardFromYaw(yawDegrees: number): Vec3 {
  const radians = (yawDegrees * Math.PI) / 180;
  return { x: -detMath.sin(radians), y: 0, z: -detMath.cos(radians) };
}

/** The 3D unit direction a gun with this yaw and pitch points along. */
export function directionFromAim(yawDegrees: number, pitchDegrees: number): Vec3 {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const horizontal = detMath.cos(pitch);
  return {
    x: -detMath.sin(yaw) * horizontal,
    y: detMath.sin(pitch),
    z: -detMath.cos(yaw) * horizontal,
  };
}

export function pointAt(from: Vec3, to: Vec3, t: number): Vec3 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/**
 * The earliest `t` in `[0, 1]` at which the segment `from → to` enters the axis-aligned
 * box `[min, max]`, or `null`. The slab method; a segment starting inside returns 0.
 */
export function segmentAabbIntersection(from: Vec3, to: Vec3, min: Vec3, max: Vec3): number | null {
  let near = 0;
  let far = 1;
  const axes = ['x', 'y', 'z'] as const;
  for (const axis of axes) {
    const origin = from[axis];
    const direction = to[axis] - origin;
    const low = min[axis];
    const high = max[axis];
    if (Math.abs(direction) < EPSILON) {
      if (origin < low || origin > high) {
        return null;
      }
      continue;
    }
    let t1 = (low - origin) / direction;
    let t2 = (high - origin) / direction;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > near) near = t1;
    if (t2 < far) far = t2;
    if (near > far || far <= 0) return null;
  }
  return near;
}

/**
 * The earliest `t` in `[0, 1]` at which the segment enters a vertical cylinder
 * (radius `radius`, y in `[minY, maxY]`), or `null`. A segment starting inside returns
 * 0. Used for tank bodies: a shell hits the body, not a loose bounding box.
 */
export function segmentCylinderIntersection(
  from: Vec3,
  to: Vec3,
  centreX: number,
  centreZ: number,
  radius: number,
  minY: number,
  maxY: number,
): number | null {
  const ox = from.x - centreX;
  const oz = from.z - centreZ;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  const a = dx * dx + dz * dz;
  const c = ox * ox + oz * oz - radius * radius;

  let near = -Infinity;
  let far = Infinity;

  if (a < EPSILON) {
    // A vertical segment: it can only hit the side wall if it is already inside it.
    if (c > 0) return null;
  } else {
    const b = 2 * (ox * dx + oz * dz);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    near = (-b - root) / (2 * a);
    far = (-b + root) / (2 * a);
  }

  const y0 = from.y;
  if (Math.abs(dy) < EPSILON) {
    if (y0 < minY || y0 > maxY) return null;
  } else {
    let ty1 = (minY - y0) / dy;
    let ty2 = (maxY - y0) / dy;
    if (ty1 > ty2) {
      const swap = ty1;
      ty1 = ty2;
      ty2 = swap;
    }
    if (ty1 > near) near = ty1;
    if (ty2 < far) far = ty2;
  }

  if (near > far || far <= 0) return null;
  const t = Math.max(0, near);
  return t > 1 ? null : t;
}

/**
 * The earliest `t` in `[0, 1]` at which the horizontal segment `from → to` enters
 * the circle at `(centreX, centreZ)` with `radius`, or `null`. A segment starting
 * inside returns 0. This is the swept-circle test for tank-tank bodies: pass the sum
 * of the two radii as `radius`.
 */
export function segmentCircleIntersection(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  centreX: number,
  centreZ: number,
  radius: number,
): number | null {
  const ox = fromX - centreX;
  const oz = fromZ - centreZ;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const a = dx * dx + dz * dz;
  const c = ox * ox + oz * oz - radius * radius;

  if (a < EPSILON) {
    return c <= 0 ? 0 : null;
  }

  const b = 2 * (ox * dx + oz * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const root = Math.sqrt(discriminant);
  const t = (-b - root) / (2 * a);
  if (t > 1) {
    return null;
  }
  if (t < 0) {
    return c <= 0 ? 0 : null;
  }
  return t;
}

/** Clamp a number into `[min, max]`; callers validate their own inputs separately. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
