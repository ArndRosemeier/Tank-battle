/**
 * The camera's PURE maths: orbit-follow poses, the zoom clamp, the first-person
 * boundary and the deterministic screenshot poses. No `three`, no DOM, no clock —
 * just numbers in, numbers out — so it is pinned in `node` like the simulation.
 *
 * `cameraRig.ts` owns the `PerspectiveCamera` and the spring; this module owns what a
 * pose MEANS. Keeping the boundary here is what lets the suite state "first person is
 * entered at 2 m" without a browser.
 *
 * Angles: a tank's yaw is degrees, and 0 faces -z (the world's canonical forward).
 * An orbit pose places the camera `distance` metres from its focus, `pitch` degrees
 * above the focus plane, opposite the given forward vector.
 */

import { CAMERA } from './config.ts';

/** A point or direction in world metres. Plain data; no three.js types here. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
}

/** The arena's extents in metres — the `wide` pose frames this. */
export interface ArenaBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** The selectable deterministic screenshot poses. */
export const CAMERA_POSE_NAMES = ['wide', 'tank', 'first'] as const;
export type CameraPoseName = (typeof CAMERA_POSE_NAMES)[number];

export function isCameraPoseName(value: string): value is CameraPoseName {
  return (CAMERA_POSE_NAMES as readonly string[]).includes(value);
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** Clamps an arm length into the documented zoom range; malformed input throws. */
export function clampDistance(distance: number): number {
  requireFinite(distance, 'distance');
  return Math.min(CAMERA.maxDistanceMetres, Math.max(CAMERA.minDistanceMetres, distance));
}

/**
 * One wheel event's continuous zoom. Positive `deltaY` (scroll down) lengthens the
 * arm, negative shortens it; the result is always inside the documented clamp.
 */
export function zoomDistance(currentDistance: number, wheelDeltaY: number): number {
  requireFinite(currentDistance, 'currentDistance');
  requireFinite(wheelDeltaY, 'wheelDeltaY');
  return clampDistance(currentDistance * Math.exp(wheelDeltaY * CAMERA.zoomSensitivity));
}

/**
 * Is this arm length first person? The boundary is exclusive: exactly 2 m is still the
 * third-person arm, anything shorter is inside the hull and hides it.
 */
export function isFirstPerson(distance: number): boolean {
  requireFinite(distance, 'distance');
  return distance < CAMERA.firstPersonDistanceMetres;
}

/** The unit forward vector for a yaw in degrees: yaw 0 → -z. */
export function forwardFromYawDegrees(yawDegrees: number): Vec3 {
  requireFinite(yawDegrees, 'yawDegrees');
  const radians = (yawDegrees * Math.PI) / 180;
  return { x: -Math.sin(radians), y: 0, z: -Math.cos(radians) };
}

export interface OrbitPoseInput {
  /** The point the camera looks at (the tank's turret/eye height). */
  readonly focus: Vec3;
  /** The direction the tank faces; the camera sits behind it. */
  readonly forward: Vec3;
  /** Arm length in metres; must already be inside the zoom clamp. */
  readonly distance: number;
  /** Elevation above the focus plane, in degrees. */
  readonly pitchDegrees: number;
}

/**
 * The one orbit-to-pose conversion. As the arm collapses inside the first-person
 * distance, the target slides forward so the view looks AHEAD instead of at the
 * camera's own pivot; at the boundary the slide is zero, so the transition has no
 * jump. Every branch is deterministic: same input objects, same output values.
 */
export function orbitPose(input: OrbitPoseInput): CameraPose {
  const { focus, forward, distance, pitchDegrees } = input;
  requireFinite(distance, 'distance');
  requireFinite(pitchDegrees, 'pitchDegrees');
  requireFinite(focus.x, 'focus.x');
  requireFinite(focus.y, 'focus.y');
  requireFinite(focus.z, 'focus.z');
  requireFinite(forward.x, 'forward.x');
  requireFinite(forward.z, 'forward.z');
  if (distance < CAMERA.minDistanceMetres || distance > CAMERA.maxDistanceMetres) {
    throw new Error(
      `cameraMath: orbit distance ${distance} is outside the clamp ${CAMERA.minDistanceMetres}…${CAMERA.maxDistanceMetres}`,
    );
  }
  if (pitchDegrees <= -90 || pitchDegrees >= 90) {
    throw new Error(`cameraMath: pitch must be between -90 and 90 degrees, got ${pitchDegrees}`);
  }
  const forwardLength = Math.hypot(forward.x, forward.z);
  if (!Number.isFinite(forwardLength) || forwardLength === 0) {
    throw new Error('cameraMath: forward must be a non-zero horizontal direction');
  }
  const unitForward: Vec3 = { x: forward.x / forwardLength, y: 0, z: forward.z / forwardLength };

  const pitchRadians = (pitchDegrees * Math.PI) / 180;
  const back = distance * Math.cos(pitchRadians);
  const up = distance * Math.sin(pitchRadians);

  const position: Vec3 = {
    x: focus.x - unitForward.x * back,
    y: focus.y + up,
    z: focus.z - unitForward.z * back,
  };

  const firstPerson = isFirstPerson(distance);
  const lookAhead = firstPerson
    ? (1 - distance / CAMERA.firstPersonDistanceMetres) * CAMERA.firstPersonLookAheadMetres
    : 0;
  const target: Vec3 = {
    x: focus.x + unitForward.x * lookAhead,
    y: focus.y,
    z: focus.z + unitForward.z * lookAhead,
  };

  return { position, target, up: UP };
}

export interface CameraPoseRequest {
  readonly name: CameraPoseName;
  readonly arena: ArenaBounds;
  readonly floorY: number;
  /** The tank's base position, in metres. */
  readonly focus: Vec3;
  readonly focusYawDegrees: number;
}

/**
 * The deterministic screenshot poses — the same request always yields the same
 * position and target (pinned). These are also the poses the shot harness selects
 * with `?pose=`.
 *
 * - `wide`: the arena from a high three-quarter angle, framed from its extents.
 * - `tank`: the close third-person follow arm.
 * - `first`: a fixed eye-height forward view (hull hidden by the caller).
 */
export function cameraPose(request: CameraPoseRequest): CameraPose {
  const { name, arena, floorY, focus, focusYawDegrees } = request;
  requireFinite(floorY, 'floorY');
  const forward = forwardFromYawDegrees(focusYawDegrees);

  switch (name) {
    case 'wide': {
      const width = arena.maxX - arena.minX;
      const depth = arena.maxZ - arena.minZ;
      if (!(width > 0) || !(depth > 0)) {
        throw new Error(`cameraMath: the arena bounds are empty (${width} × ${depth} m)`);
      }
      const span = Math.max(width, depth);
      const center: Vec3 = {
        x: (arena.minX + arena.maxX) / 2,
        y: floorY + CAMERA.wideTargetHeightMetres,
        z: (arena.minZ + arena.maxZ) / 2,
      };
      const fractions = CAMERA.wideOffsetFractions;
      return {
        position: {
          x: center.x + span * fractions.x,
          y: center.y + span * fractions.y,
          z: center.z + span * fractions.z,
        },
        target: center,
        up: UP,
      };
    }
    case 'tank': {
      const eye: Vec3 = {
        x: focus.x,
        y: floorY + CAMERA.focusHeightMetres,
        z: focus.z,
      };
      const yaw = (CAMERA.tankPoseYawOffsetDegrees * Math.PI) / 180;
      // A 3/4 rear view shows the hull's flanks and the barrel; dead astern hides
      // the barrel behind the turret and reads as a slab.
      const poseForward: Vec3 = {
        x: forward.x * Math.cos(yaw) + forward.z * Math.sin(yaw),
        y: 0,
        z: -forward.x * Math.sin(yaw) + forward.z * Math.cos(yaw),
      };
      return orbitPose({
        focus: eye,
        forward: poseForward,
        distance: CAMERA.defaultDistanceMetres,
        pitchDegrees: CAMERA.defaultPitchDegrees,
      });
    }
    case 'first': {
      const eye: Vec3 = {
        x: focus.x + forward.x * 0.35,
        y: floorY + CAMERA.eyeHeightMetres,
        z: focus.z + forward.z * 0.35,
      };
      const pitchRadians = (CAMERA.firstPersonPitchDegrees * Math.PI) / 180;
      return {
        position: eye,
        target: {
          x: eye.x + forward.x * CAMERA.firstPersonLookAheadMetres,
          y: eye.y + Math.tan(pitchRadians) * CAMERA.firstPersonLookAheadMetres,
          z: eye.z + forward.z * CAMERA.firstPersonLookAheadMetres,
        },
        up: UP,
      };
    }
  }
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`cameraMath: ${label} must be finite, got ${value}`);
  }
}
