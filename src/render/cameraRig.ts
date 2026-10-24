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
  /**
   * The first blocking hit on the segment `from → to` as a fraction 0…1, or `null`
   * when the segment is clear. The follow arm shortens to stay out of hills and caves.
   */
  readonly occluder?: (from: Vec3, to: Vec3) => number | null;
}

/** The arm never shortens below this, so the hull stays readable in a tight tunnel. */
const MIN_ARM_FRACTION = 0.18;
/** How fast a shortened arm grows back once the line is clear again. */
const ARM_RELEASE_HALF_LIFE_SECONDS = 0.35;

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
  private readonly occluder: ((from: Vec3, to: Vec3) => number | null) | null;
  private armFraction = 1;

  private readonly targetFocus = new Vector3();
  private readonly currentFocus = new Vector3();
  private targetYawDegrees = 0;
  private currentYawDegrees = 0;
  private targetDistance: number = CAMERA.defaultDistanceMetres;
  private currentDistance: number = CAMERA.defaultDistanceMetres;
  /** The orbit arm's downward angle; the mouse can tilt it (centred / edge-push modes). */
  private targetPitchDegrees: number = CAMERA.defaultPitchDegrees;
  private currentPitchDegrees: number = CAMERA.defaultPitchDegrees;

  private pose: CameraPoseName | null = null;
  private frozenPose: CameraPose | null = null;
  private recoilAmount = 0;
  private readonly recoilBack = new Vector3();
  private readonly lastPoseTarget = new Vector3();

  constructor(options: CameraRigOptions) {
    this.arena = options.arena;
    this.floorY = options.floorY;
    this.occluder = options.occluder ?? null;
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
    this.targetFocus.set(
      focus.position.x,
      focus.position.y + CAMERA.focusHeightMetres,
      focus.position.z,
    );
    this.targetYawDegrees = focus.yawDegrees;
  }

  /** Tilts the follow arm, in degrees down. The arm eases there with the yaw spring. */
  setPitch(pitchDegrees: number): void {
    if (!Number.isFinite(pitchDegrees) || pitchDegrees <= -80 || pitchDegrees >= 80) {
      throw new Error(`cameraRig: pitch must be finite and within ±80°, got ${String(pitchDegrees)}`);
    }
    this.targetPitchDegrees = pitchDegrees;
  }

  /** One wheel event. The arm length is clamped; a snapshot pose is unaffected. */
  zoom(wheelDeltaY: number): void {
    this.targetDistance = zoomDistance(this.targetDistance, wheelDeltaY);
  }

  /** One firing blowback impulse. The camera returns to the spring pose as it decays. */
  kick(strength = 1): void {
    if (!Number.isFinite(strength) || strength < 0 || strength > 2) {
      throw new Error(`cameraRig: kick strength must be finite and within 0…2, got ${String(strength)}`);
    }
    this.recoilAmount = Math.min(1, Math.max(this.recoilAmount, strength));
  }

  /** The current recoil, 0…1. Presentation only; never read by the simulation. */
  get recoil(): number {
    return this.recoilAmount;
  }

  /**
   * Apply the current blowback to the RENDER camera. The aim camera snapshot must be
   * taken before this call: a jolted camera must never move the pointer's world point.
   */
  applyRecoil(): void {
    if (this.recoilAmount <= 0 || this.pose !== null || this.frozenPose !== null) return;
    const recoil = this.recoilAmount;
    this.recoilBack
      .set(
        this.camera.position.x - this.lastPoseTarget.x,
        this.camera.position.y - this.lastPoseTarget.y,
        this.camera.position.z - this.lastPoseTarget.z,
      )
      .normalize();
    this.camera.position.addScaledVector(this.recoilBack, CAMERA.recoilBackMetres * recoil);
    this.camera.position.y += CAMERA.recoilUpMetres * recoil;
    this.camera.lookAt(
      this.lastPoseTarget.x,
      this.lastPoseTarget.y + CAMERA.recoilPitchMetres * recoil,
      this.lastPoseTarget.z,
    );
    this.camera.updateMatrixWorld();
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
      focus: {
        x: this.targetFocus.x,
        y: this.targetFocus.y - CAMERA.focusHeightMetres,
        z: this.targetFocus.z,
      },
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

    this.currentPitchDegrees += (this.targetPitchDegrees - this.currentPitchDegrees) * yawBlend;

    const zoomBlend = springBlend(dtSeconds, CAMERA.zoomHalfLifeSeconds);
    this.currentDistance += (this.targetDistance - this.currentDistance) * zoomBlend;

    const focus = { x: this.currentFocus.x, y: this.currentFocus.y, z: this.currentFocus.z };
    const forward = forwardFromYawDegrees(this.currentYawDegrees);
    let armTarget = 1;
    if (this.occluder) {
      const full = orbitPose({
        focus,
        forward,
        distance: this.currentDistance,
        pitchDegrees: this.currentPitchDegrees,
      });
      const hit = this.occluder(focus, full.position);
      if (hit !== null) armTarget = Math.max(MIN_ARM_FRACTION, hit * 0.85);
    }
    // Snap in at once (never show the inside of a hill); ease back out.
    this.armFraction =
      armTarget < this.armFraction
        ? armTarget
        : this.armFraction +
          (armTarget - this.armFraction) * springBlend(dtSeconds, ARM_RELEASE_HALF_LIFE_SECONDS);
    const pose = orbitPose({
      focus,
      forward,
      distance: this.currentDistance * this.armFraction,
      pitchDegrees: this.currentPitchDegrees,
    });
    this.applyPose(pose);
    if (this.recoilAmount > 0) {
      this.recoilAmount = Math.max(0, this.recoilAmount - dtSeconds / CAMERA.recoilSeconds);
    }
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
    this.lastPoseTarget.set(pose.target.x, pose.target.y, pose.target.z);
    this.camera.updateMatrixWorld();
  }
}
