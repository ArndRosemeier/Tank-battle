/**
 * The PURE input→command mapping. The browser only gathers booleans and a normalised
 * pointer; this module owns what they mean, so the mapping is pinned in `node`.
 *
 * Mouse aim is a yaw OFFSET from the current hull yaw (not an absolute compass angle),
 * and pointer height maps to pitch: top of the view = +25°, centre = 0°, bottom = −30°.
 * The yaw offset is clamped to ±60° so the turret cannot snap behind the hull.
 *
 * No pointer lock: the cursor stays visible and its position IS the aim; a locked
 * pointer would add Escape/focus/recentre states without improving this third-person
 * control, and would make the screenshot harness one more browser state to fake.
 */

import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  normaliseDegrees,
  normaliseTankCommand,
  type TankCommand,
} from '../core/sim.ts';

/** The largest turret yaw offset from the hull, in degrees. */
export const AIM_YAW_OFFSET_MAX_DEGREES = 60;

/** One frame's gathered input. Pointer coordinates are normalised to [-1, 1]. */
export interface PlayerInput {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly left: boolean;
  readonly right: boolean;
  /** -1 = left edge, 0 = centre, +1 = right edge. */
  readonly pointerX: number;
  /** -1 = top edge, 0 = centre, +1 = bottom edge. */
  readonly pointerY: number;
  readonly fire: boolean;
}

/** Scales the pointer aim by a user setting, clamped to the frame. */
export function scalePlayerInput(input: PlayerInput, sensitivity: number): PlayerInput {
  requireFinite(input.pointerX, 'pointerX');
  requireFinite(input.pointerY, 'pointerY');
  if (!Number.isFinite(sensitivity) || sensitivity <= 0 || sensitivity > 4) {
    throw new Error(`sim.input: sensitivity must be finite and within 0…4, got ${String(sensitivity)}`);
  }
  return {
    ...input,
    pointerX: clampUnit(input.pointerX * sensitivity),
    pointerY: clampUnit(input.pointerY * sensitivity),
  };
}

/**
 * Normalises a client coordinate against an element's left/top edge and size to [-1, 1].
 * A pointer at the RIGHT edge is +1 and at the TOP edge is -1; that is the convention
 * `commandFromInput` relies on. Pure on purpose: the browser half of the aim chain is
 * pinned in `node`, not discovered by the owner.
 */
export function normalisePointerAxis(client: number, edge: number, size: number): number {
  requireFinite(client, 'client coordinate');
  requireFinite(edge, 'element edge');
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`sim.input: element size must be finite and > 0, got ${String(size)}`);
  }
  return clampUnit(((client - edge) / size) * 2 - 1);
}

export function idlePlayerInput(): PlayerInput {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    pointerX: 0,
    pointerY: 0,
    fire: false,
  };
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`sim.input: ${label} must be finite, got ${String(value)}`);
  }
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Maps the gathered input to a command for the player's CURRENT hull yaw. A relative
 * mouse yaw is the point: if the hull turns, the turret offset turns with it.
 */
export function commandFromInput(input: PlayerInput, hullYawDegrees: number): TankCommand {
  requireFinite(hullYawDegrees, 'hullYawDegrees');
  requireFinite(input.pointerX, 'pointerX');
  requireFinite(input.pointerY, 'pointerY');

  const pointerX = clampUnit(input.pointerX);
  const pointerY = clampUnit(input.pointerY);
  const throttle = Number(input.forward) - Number(input.backward);
  // Positive sim steer turns LEFT, so A adds and D subtracts.
  const steer = Number(input.left) - Number(input.right);
  // POSITIVE YAW IS LEFT in this simulation (`forwardFromYaw` returns `x = -sin(yaw)`),
  // so a pointer to the RIGHT must SUBTRACT from the yaw. The owner found this the hard
  // way: the first version added, and moving the mouse left swung the turret right.
  const aimYaw = normaliseDegrees(hullYawDegrees - pointerX * AIM_YAW_OFFSET_MAX_DEGREES);
  const aimPitch =
    pointerY === 0
      ? 0
      : pointerY < 0
        ? -pointerY * AIM_PITCH_MAX_DEGREES
        : -pointerY * Math.abs(AIM_PITCH_MIN_DEGREES);

  return normaliseTankCommand(
    {
      throttle,
      steer,
      aimYaw,
      aimPitch: Math.max(AIM_PITCH_MIN_DEGREES, Math.min(AIM_PITCH_MAX_DEGREES, aimPitch)),
      fire: input.fire,
    },
    'sim.input command',
  );
}
