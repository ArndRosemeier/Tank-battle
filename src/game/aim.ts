/**
 * P6's WORLD-point aiming seam.
 *
 * The pointer is not an angular offset any more. Each simulation tick the player's
 * controller casts a ray from the RENDER CAMERA (a plain camera snapshot supplied by the
 * shell) through the pointer NDC, takes the first enemy tank / world cell / big block /
 * floor-plane hit, and solves the turret yaw and pitch from the muzzle to that point.
 * Because the camera follows the HULL only, that mapping does not feed back into itself.
 *
 * The solver is pure: it has no `three`, DOM or clock. `castAimRay` lives in
 * `src/core/sim/step.ts` and uses the simulation's own segment/world maths, so the aim
 * and shell collision agree about walls and tanks instead of growing a second scene
 * raycaster.
 *
 * Clamps stay as a safety: the command yaw is the hull plus at most ±60°, and pitch is
 * within −30…+25°. The reported impact is the CLAMPED shell's first hit, which is what
 * the reticle projects; a clamped shot is visible, not a lie. Empty sky is marked
 * `outOfRange` and still yields a valid command aimed at the range endpoint.
 */

import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  MUZZLE_FORWARD_METRES,
  MUZZLE_HEIGHT_METRES,
  castAimRay,
  directionFromAim,
  forwardFromYaw,
  normaliseDegrees,
  shortestAngleDelta,
  type Controller,
  type MatchState,
  type Tank,
  type TankCommand,
  type Vec3,
} from '../core/sim.ts';
import { commandFromAim, type PlayerInput } from './input.ts';

/** The turret's maximum absolute yaw offset from the hull, in degrees. */
export const AIM_YAW_OFFSET_MAX_DEGREES = 60;
/** The pointer ray's useful reach; sky/void past this is `outOfRange`. */
export const AIM_RANGE_METRES = 80;

/** The plain camera snapshot the shell supplies; no three.js types cross this seam. */
export interface AimCamera {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovDegrees: number;
  readonly aspect: number;
}

export interface AimSolution {
  /** Absolute command angles after the hull/pitch clamps. */
  readonly aimYaw: number;
  readonly aimPitch: number;
  /** The camera ray's first hit, or its range endpoint when nothing was hit. */
  readonly desiredPoint: Vec3;
  /** Where the CLAMPED shot from the muzzle actually lands (or its range endpoint). */
  readonly impactPoint: Vec3;
  /** True when the camera ray hit nothing within `AIM_RANGE_METRES`. */
  readonly outOfRange: boolean;
  /** True when the yaw or pitch clamp changed the requested direction. */
  readonly clamped: boolean;
  /** The tank under the CLAMPED shot, if the true impact is a tank. */
  readonly targetTankId: number | null;
  readonly targetTeamId: number | null;
  /** The surface the CLAMPED shot hits, or null when it reaches the range endpoint. */
  readonly impactKind: 'tank' | 'world' | 'ground' | null;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`aim: ${label} must be finite, got ${String(value)}`);
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
    throw new Error(`aim: ${label} must be a non-zero direction`);
  }
  return { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function requireCamera(camera: AimCamera): void {
  if (camera === null || typeof camera !== 'object') {
    throw new Error('aim: a camera snapshot is required');
  }
  vector(camera.position, 'camera.position');
  vector(camera.target, 'camera.target');
  vector(camera.up, 'camera.up');
  finite(camera.fovDegrees, 'camera.fovDegrees');
  finite(camera.aspect, 'camera.aspect');
  if (camera.fovDegrees <= 1 || camera.fovDegrees >= 179) {
    throw new Error(`aim: camera.fovDegrees must be between 1 and 179, got ${camera.fovDegrees}`);
  }
  if (camera.aspect <= 0) {
    throw new Error(`aim: camera.aspect must be positive, got ${camera.aspect}`);
  }
  if (length({
    x: camera.target.x - camera.position.x,
    y: camera.target.y - camera.position.y,
    z: camera.target.z - camera.position.z,
  }) < 1e-9) {
    throw new Error('aim: the camera target must differ from its position');
  }
}

/**
 * The ONE pointer→world-ray convention: +x is the camera's right, +y its up, and the
 * browser's pointerY is +down, so NDC y is `-pointerY`. The returned direction is unit.
 */
export function cameraRayFromPointer(
  camera: AimCamera,
  pointerX: number,
  pointerY: number,
): Vec3 {
  requireCamera(camera);
  finite(pointerX, 'pointerX');
  finite(pointerY, 'pointerY');
  if (pointerX < -1 || pointerX > 1 || pointerY < -1 || pointerY > 1) {
    throw new Error(
      `aim: pointer coordinates must be within −1…1, got (${pointerX}, ${pointerY})`,
    );
  }
  const forward = normalise(
    {
      x: camera.target.x - camera.position.x,
      y: camera.target.y - camera.position.y,
      z: camera.target.z - camera.position.z,
    },
    'camera forward',
  );
  const right = normalise(cross(forward, camera.up), 'camera right');
  const up = normalise(cross(right, forward), 'camera up');
  const tanHalfVertical = Math.tan((camera.fovDegrees * Math.PI) / 360);
  const tanHalfHorizontal = tanHalfVertical * camera.aspect;
  return normalise(
    {
      x: forward.x + right.x * pointerX * tanHalfHorizontal + up.x * -pointerY * tanHalfVertical,
      y: forward.y + right.y * pointerX * tanHalfHorizontal + up.y * -pointerY * tanHalfVertical,
      z: forward.z + right.z * pointerX * tanHalfHorizontal + up.z * -pointerY * tanHalfVertical,
    },
    'pointer ray',
  );
}

function muzzleAt(tank: Tank, floorY: number, yawDegrees: number): Vec3 {
  const forward = forwardFromYaw(yawDegrees);
  return {
    x: tank.x + forward.x * MUZZLE_FORWARD_METRES,
    y: floorY + MUZZLE_HEIGHT_METRES,
    z: tank.z + forward.z * MUZZLE_FORWARD_METRES,
  };
}

/** The two turret angles from a muzzle point to a world point, in degrees. */
function anglesFromMuzzle(muzzle: Vec3, point: Vec3): { yaw: number; pitch: number } {
  const dx = point.x - muzzle.x;
  const dy = point.y - muzzle.y;
  const dz = point.z - muzzle.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 1e-9) {
    return { yaw: 0, pitch: dy >= 0 ? 90 : -90 };
  }
  // -sin(yaw)=dx/h and -cos(yaw)=dz/h: positive yaw is LEFT (towards -x).
  return {
    yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI,
    pitch: (Math.atan2(dy, horizontal) * 180) / Math.PI,
  };
}

/**
 * Solves the player's aim from the camera through the pointer. The yaw solution iterates
 * on the muzzle position because the 3 m muzzle swings with the turret; three passes
 * converge well inside the 0.5 m acceptance used by the shell pin.
 */
export function solveAim(
  state: MatchState,
  tank: Tank,
  camera: AimCamera,
  pointerX: number,
  pointerY: number,
): AimSolution {
  if (!state || !Array.isArray(state.tanks)) {
    throw new Error('aim: a live match state is required');
  }
  if (!tank.alive) {
    throw new Error('aim: a dead tank cannot aim');
  }
  requireCamera(camera);
  const ray = cameraRayFromPointer(camera, pointerX, pointerY);
  const cameraHit = castAimRay(
    state,
    camera.position,
    ray,
    AIM_RANGE_METRES,
    tank.teamId,
  );
  const desiredPoint: Vec3 = cameraHit
    ? cameraHit.point
    : {
        x: camera.position.x + ray.x * AIM_RANGE_METRES,
        y: camera.position.y + ray.y * AIM_RANGE_METRES,
        z: camera.position.z + ray.z * AIM_RANGE_METRES,
      };

  let aimYaw = tank.turretYawDegrees;
  let aimPitch = tank.aimPitchDegrees;
  let clamped = false;
  for (let pass = 0; pass < 4; pass += 1) {
    const muzzle = muzzleAt(tank, state.world.floorSurfaceHeightMetres, aimYaw);
    const requested = anglesFromMuzzle(muzzle, desiredPoint);
    const offset = shortestAngleDelta(tank.hullYawDegrees, requested.yaw);
    const clampedOffset = clamp(offset, -AIM_YAW_OFFSET_MAX_DEGREES, AIM_YAW_OFFSET_MAX_DEGREES);
    const clampedPitch = clamp(requested.pitch, AIM_PITCH_MIN_DEGREES, AIM_PITCH_MAX_DEGREES);
    aimYaw = normaliseDegrees(tank.hullYawDegrees + clampedOffset);
    aimPitch = clampedPitch;
    if (Math.abs(offset - clampedOffset) > 1e-9 || Math.abs(requested.pitch - clampedPitch) > 1e-9) {
      clamped = true;
    }
  }

  const muzzle = muzzleAt(tank, state.world.floorSurfaceHeightMetres, aimYaw);
  const direction = directionFromAim(aimYaw, aimPitch);
  const actualHit = castAimRay(state, muzzle, direction, AIM_RANGE_METRES, tank.teamId);
  const impactPoint: Vec3 = actualHit
    ? actualHit.point
    : {
        x: muzzle.x + direction.x * AIM_RANGE_METRES,
        y: muzzle.y + direction.y * AIM_RANGE_METRES,
        z: muzzle.z + direction.z * AIM_RANGE_METRES,
      };

  return {
    aimYaw,
    aimPitch,
    desiredPoint,
    impactPoint,
    outOfRange: cameraHit === null,
    clamped,
    targetTankId: actualHit?.kind === 'tank' ? actualHit.tankId : null,
    targetTeamId: actualHit?.kind === 'tank' ? actualHit.teamId : null,
    impactKind: actualHit?.kind ?? null,
  };
}

/**
 * The per-tick player controller. It reads the browser booleans and the latest camera
 * snapshot, solves the world aim, and maps the result through the ONE command builder.
 * The camera snapshot is one frame old while a tick batch runs; that is deliberate: the
 * pointer ray must stay fixed during the ticks for which the player aimed.
 */
export class PlayerAimController implements Controller {
  constructor(
    private readonly readInput: () => PlayerInput,
    private readonly readCamera: () => AimCamera | null,
  ) {}

  commandFor(state: MatchState, tankId: number): TankCommand {
    const tank = state.tanks.find((candidate) => candidate.id === tankId);
    if (!tank) {
      throw new Error(`aim: the player controller lost tank ${tankId}`);
    }
    const camera = this.readCamera();
    if (!camera) {
      throw new Error('aim: the player aim controller has no camera snapshot yet');
    }
    const input = this.readInput();
    const solution = solveAim(state, tank, camera, input.pointerX, input.pointerY);
    return commandFromAim(input, solution.aimYaw, solution.aimPitch);
  }
}
