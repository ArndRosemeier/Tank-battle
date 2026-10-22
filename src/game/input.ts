/**
 * The PURE input→command mapping for the player's buttons and the aim solver's angles.
 * The browser only gathers booleans and a normalised pointer; this module owns what
 * those mean, so the boolean half is pinned in `node`.
 *
 * P6 retired the pointer→hull-relative offset: the pointer now selects a WORLD point
 * through the camera (`src/game/aim.ts`), and the solver supplies the absolute turret
 * yaw and pitch. This module therefore deliberately ignores pointerX/pointerY; keeping a
 * second pointer mapping here would fork the aim convention.
 *
 * No pointer lock: the OS cursor is hidden while playing and the projected impact
 * reticle is the cursor. A locked pointer would add Escape/focus/recentre states without
 * improving a control whose reference is the world point under the pointer.
 */

import {
  normaliseDegrees,
  normaliseTankCommand,
  type TankCommand,
} from '../core/sim.ts';

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

/**
 * Normalises a client coordinate against an element's left/top edge and size to [-1, 1].
 * A pointer at the RIGHT edge is +1 and at the TOP edge is -1; that is the convention
 * `cameraRayFromPointer` relies on. Pure on purpose: the browser half of the aim chain
 * is pinned in `node`, not discovered by the owner.
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
 * Builds the player's command from the buttons and the WORLD-aim solver's absolute
 * angles. The pointer itself is not read: the camera ray has already selected the point
 * and `solveAim` has applied the ±60° / −30…+25° clamps. Throttle, steer and fire keep
 * their existing semantics.
 */
export function commandFromAim(
  input: PlayerInput,
  aimYaw: number,
  aimPitch: number,
): TankCommand {
  requireFinite(aimYaw, 'aimYaw');
  requireFinite(aimPitch, 'aimPitch');
  const throttle = Number(input.forward) - Number(input.backward);
  // Positive sim steer turns LEFT, so A adds and D subtracts.
  const steer = Number(input.left) - Number(input.right);
  return normaliseTankCommand(
    {
      throttle,
      steer,
      aimYaw: normaliseDegrees(aimYaw),
      aimPitch,
      fire: input.fire,
    },
    'sim.input command',
  );
}
