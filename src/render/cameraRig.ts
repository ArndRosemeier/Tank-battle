/**
 * The `three` camera rig: a third-person orbit-follow spring arm that scrolls
 * continuously into first person. The maths lives in `cameraMath.ts` (pure, pinned in
 * node); this file only owns the `PerspectiveCamera`, the spring and the pose
 * application.
 *
 * The spring is exponential with a documented half-life, frame-rate independent: a
 * long frame does not make the arm jump. A `pose` selected for a screenshot FREEZES
 * the rig to `cameraPose(name, …)`, so a screenshot cannot depend on timing.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from './config.ts';
import {
  cameraPose,
  forwardFromYawDegrees,
  isFirstPerson,
  orbitPose,
  zoomDistance,
  type ArenaBounds,
  type CameraPose,
  type CameraPoseName,
  type Vec3,
} from './cameraMath.ts';

/** The tank the arm follows: its base position and its hull yaw. */
export interface CameraFocus {
  readonly position: Vec3;
  readonly yawDegrees: number;
}

export interface CameraRigOptions {
  readonly arena: ArenaBounds;
  readonly floorY: number;
  readonly focus: CameraFocus;
  /** A frozen screenshot pose, or `null` for the interactive follow arm. */
  readonly pose: CameraPoseName | null;
}

/** 1 - 0.5^(dt/halfLife): the fraction of the remaining gap closed this frame. */
function springBlend(dtSeconds: number, halfLifeSeconds: number): number {
  return 1 - Math.pow(0.5, dtSeconds / halfLifeSeconds);
}

/** Shortest signed difference between two angles in degrees, in (-180, 180]. */
function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

export class CameraRig {
  readonly camera: PerspectiveCamera;

  private readonly arena: ArenaBounds;
  private readonly floorY: number;

  private readonly targetFocus = new Vector3();
  private readonly currentFocus = new Vector3();
  private targetYawDegrees = 0;
  private currentYawDegrees = 0;
  private targetDistance: number = CAMERA.defaultDistanceMetres;
  private currentDistance: number = CAMERA.defaultDistanceMetres;

  private pose: CameraPoseName | null = null;
  private frozenPose: CameraPose | null = null;

  constructor(options: CameraRigOptions) {
    this.arena = options.arena;
    this.floorY = options.floorY;
    this.camera = new PerspectiveCamera(
      CAMERA.fovDegrees,
      1,
      CAMERA.nearMetres,
      CAMERA.farMetres,
    );
    this.camera.name = 'camera';
    this.setFocus(options.focus);
    this.currentFocus.copy(this.targetFocus);
    this.currentYawDegrees = this.targetYawDegrees;
    this.setPose(options.pose);
  }

  /** The camera is inside the hull; the caller hides the focused tank. */
  get firstPerson(): boolean {
    if (this.frozenPose && this.pose === 'first') {
      return true;
    }
    return isFirstPerson(this.currentDistance);
  }

  get distanceMetres(): number {
    return this.currentDistance;
  }

  /** The spring's current follow yaw; for verification, not gameplay. */
  get yawDegrees(): number {
    return this.currentYawDegrees;
  }

  /** Moves the follow target. The spring carries the camera there over a few frames. */
  setFocus(focus: CameraFocus): void {
    this.targetFocus.set(focus.position.x, this.floorY + CAMERA.focusHeightMetres, focus.position.z);
    this.targetYawDegrees = focus.yawDegrees;
  }

  /** One wheel event. The arm length is clamped; a snapshot pose is unaffected. */
  zoom(wheelDeltaY: number): void {
    this.targetDistance = zoomDistance(this.targetDistance, wheelDeltaY);
  }

  /**
   * Freezes the rig to a deterministic pose (`wide`, `tank`, `first`) or returns it to
   * the live follow arm (`null`). Called at boot by the URL pose parameter.
   */
  setPose(name: CameraPoseName | null): void {
    this.pose = name;
    if (name === null) {
      this.frozenPose = null;
      return;
    }
    this.frozenPose = cameraPose({
      name,
      arena: this.arena,
      floorY: this.floorY,
      focus: { x: this.targetFocus.x, y: this.targetFocus.y, z: this.targetFocus.z },
      focusYawDegrees: this.targetYawDegrees,
    });
    this.applyPose(this.frozenPose);
  }

  /** Advances the spring and applies the camera. `dt` is a clamped frame delta. */
  update(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
      throw new Error(`cameraRig: dtSeconds must be finite and >= 0, got ${dtSeconds}`);
    }
    if (this.frozenPose) {
      this.applyPose(this.frozenPose);
      return;
    }

    const followBlend = springBlend(dtSeconds, CAMERA.followHalfLifeSeconds);
    this.currentFocus.lerp(this.targetFocus, followBlend);

    const yawBlend = springBlend(dtSeconds, CAMERA.aimFollowHalfLifeSeconds);
    this.currentYawDegrees += shortestAngleDelta(this.currentYawDegrees, this.targetYawDegrees) * yawBlend;

    const zoomBlend = springBlend(dtSeconds, CAMERA.zoomHalfLifeSeconds);
    this.currentDistance += (this.targetDistance - this.currentDistance) * zoomBlend;

    const pose = orbitPose({
      focus: { x: this.currentFocus.x, y: this.currentFocus.y, z: this.currentFocus.z },
      forward: forwardFromYawDegrees(this.currentYawDegrees),
      distance: this.currentDistance,
      pitchDegrees: CAMERA.defaultPitchDegrees,
    });
    this.applyPose(pose);
  }

  /** Keeps the projection in step with the canvas. */
  resize(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) {
      throw new Error(`cameraRig: aspect must be finite and > 0, got ${aspect}`);
    }
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private applyPose(pose: CameraPose): void {
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    this.camera.updateMatrixWorld();
  }
}
