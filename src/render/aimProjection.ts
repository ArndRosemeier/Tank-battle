/**
 * The aiming loop's PURE maths: where the gun points on screen, and how far the camera
 * turns towards it.
 *
 * A tank's turret is independent of its hull (up to ±60°), so a camera that follows
 * the hull alone can leave the gun's aim outside a ~80° horizontal frame. P2's fix is
 * not a wider lens (that would distort the whole look) but a camera that turns part of
 * the way towards the turret, with the existing spring as its lag. The remainder is
 * shown by a projected reticle at the shell's direction and an edge indicator when that
 * direction is outside the frame.
 *
 * The projection is a direction-to-NDC projection, not a fixed centre crosshair: the
 * reticle's screen position is the gun's direction in the camera's basis, so it moves
 * as the turret moves, as the ship rolls/turns, and while the camera lags.
 */

import { normaliseDegrees, shortestAngleDelta } from '../core/sim/geometry.ts';
import { CAMERA } from './config.ts';
import type { Vec3 } from './cameraMath.ts';

export type { Vec3 };

export interface AimView {
  readonly cameraPosition: Vec3;
  readonly cameraTarget: Vec3;
  /** The camera's up vector (world up; this game has no roll). */
  readonly cameraUp: Vec3;
  readonly fovDegrees: number;
  readonly aspect: number;
}

export interface AimProjection {
  /** Normalised device coordinates of the aim direction; -1…1 is the frame. */
  readonly x: number;
  readonly y: number;
  /** True when the gun's direction is inside the frame in front of the camera. */
  readonly onScreen: boolean;
  /** True when the aim is behind the camera; no meaningful NDC point exists. */
  readonly behind: boolean;
  /** Clamped NDC used to keep the edge indicator/reticle inside the safe frame. */
  readonly edgeX: number;
  readonly edgeY: number;
  /** Screen-space direction of the aim from the centre, radians (for an arrow). */
  readonly angleRadians: number;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`aimProjection: ${label} must be finite, got ${String(value)}`);
  }
}

function vector(value: Vec3, label: string): void {
  finite(value.x, `${label}.x`);
  finite(value.y, `${label}.y`);
  finite(value.z, `${label}.z`);
}

function length(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalise(value: Vec3, label: string): Vec3 {
  const magnitude = length(value);
  if (magnitude < 1e-9) {
    throw new Error(`aimProjection: ${label} must be a non-zero direction`);
  }
  return { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Projects the gun's direction into the camera's NDC frame. `edgeMargin` is the
 * fraction of the frame the reticle may occupy (0.9 keeps it clear of the physical
 * edge); the edge position and arrow angle are always returned.
 */
export function projectAimDirection(
  view: AimView,
  aimDirection: Vec3,
  edgeMargin: number = CAMERA.aimEdgeMargin,
): AimProjection {
  vector(view.cameraPosition, 'cameraPosition');
  vector(view.cameraTarget, 'cameraTarget');
  vector(view.cameraUp, 'cameraUp');
  vector(aimDirection, 'aimDirection');
  finite(view.fovDegrees, 'fovDegrees');
  finite(view.aspect, 'aspect');
  finite(edgeMargin, 'edgeMargin');
  if (view.fovDegrees <= 1 || view.fovDegrees >= 179) {
    throw new Error(`aimProjection: fovDegrees must be between 1 and 179, got ${view.fovDegrees}`);
  }
  if (view.aspect <= 0) {
    throw new Error(`aimProjection: aspect must be positive, got ${view.aspect}`);
  }
  if (edgeMargin <= 0 || edgeMargin >= 1) {
    throw new Error(`aimProjection: edgeMargin must be within 0…1, got ${edgeMargin}`);
  }

  const forward = normalise(
    {
      x: view.cameraTarget.x - view.cameraPosition.x,
      y: view.cameraTarget.y - view.cameraPosition.y,
      z: view.cameraTarget.z - view.cameraPosition.z,
    },
    'camera forward',
  );
  const right = normalise(cross(forward, view.cameraUp), 'camera right');
  const up = normalise(cross(right, forward), 'camera up');
  const aim = normalise(aimDirection, 'aimDirection');
  const depth = dot(aim, forward);
  const behind = depth <= 1e-9;

  const halfFov = (view.fovDegrees * Math.PI) / 360;
  const tanHalfVertical = Math.tan(halfFov);
  const tanHalfHorizontal = tanHalfVertical * view.aspect;
  let x = 0;
  let y = 0;
  if (!behind) {
    x = dot(aim, right) / depth / tanHalfHorizontal;
    y = dot(aim, up) / depth / tanHalfVertical;
  } else {
    // A direction behind the camera has no on-screen point. Keep the horizontal side
    // so the edge arrow still tells the player which way to turn.
    x = dot(aim, right) >= 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }

  const onScreen = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  const edgeX = clamp(x, -edgeMargin, edgeMargin);
  const edgeY = clamp(y, -edgeMargin, edgeMargin);
  const angleRadians = behind ? (x >= 0 ? 0 : Math.PI) : Math.atan2(y, x);
  return { x, y, onScreen, behind, edgeX, edgeY, angleRadians };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Projects a world POINT (e.g. a target on the shell path) into the same NDC frame. */
export function projectAimPoint(
  view: AimView,
  point: Vec3,
  edgeMargin: number = CAMERA.aimEdgeMargin,
): AimProjection {
  vector(point, 'point');
  return projectAimDirection(
    view,
    {
      x: point.x - view.cameraPosition.x,
      y: point.y - view.cameraPosition.y,
      z: point.z - view.cameraPosition.z,
    },
    edgeMargin,
  );
}

/**
 * The camera's yaw target for the player: the hull heading plus a fixed fraction of
 * the turret's offset. P6's live fraction is 0 (hull only) because a camera that chased
 * the turret would move the world point under the cursor. The spring in `cameraRig.ts`
 * is the lag; an explicit fraction remains available for tests and tuning.
 */
export function aimFollowYawDegrees(
  hullYawDegrees: number,
  turretYawDegrees: number,
  fraction: number = CAMERA.aimFollowFraction,
): number {
  finite(hullYawDegrees, 'hullYawDegrees');
  finite(turretYawDegrees, 'turretYawDegrees');
  finite(fraction, 'aimFollowFraction');
  if (fraction < 0 || fraction > 1) {
    throw new Error(
      `aimProjection: aimFollowFraction must be within 0…1, got ${fraction}`,
    );
  }
  return normaliseDegrees(hullYawDegrees + shortestAngleDelta(hullYawDegrees, turretYawDegrees) * fraction);
}
