/**
 * The PURE mouse-look mapping: how mouse movement and the cursor position turn the
 * player's camera. The browser half (`browserInput.ts`) only gathers raw pointer
 * movement; this module owns what it means, so every mode is pinned in `node`.
 *
 * The camera yaw is a WORLD heading, decoupled from the hull: WASD drives, the mouse
 * looks. The turret already slews a full turn, so any direction the camera looks at is
 * a direction the gun can follow. Camera yaw and pitch are presentation only; the
 * simulation still receives ordinary `TankCommand`s, so online play is unaffected.
 *
 * Three modes (the player picks one in SETTINGS):
 *  - `edge-push` (default): pointer lock with our own cursor. The cursor moves freely
 *    on screen; pushing it past an edge turns the camera by the pushed distance, and
 *    holding it pinned at the left/right edge keeps turning.
 *  - `centred`: pointer lock, crosshair fixed above the screen centre. Mouse X turns the
 *    camera and mouse Y tilts it, like most tank shooters.
 *  - `edge-free`: no pointer lock. The real cursor aims; resting it near the left/right
 *    edge of the window turns the camera. On multi-monitor setups the cursor can leave
 *    the window, and turning then stops.
 *
 * Yaw sign: positive yaw turns LEFT (the sim's convention), so moving the mouse right
 * DECREASES yaw. Pitch is the orbit arm's downward angle: a larger pitch looks down.
 */

export const MOUSE_MODES = ['edge-push', 'centred', 'edge-free'] as const;
export type MouseMode = (typeof MOUSE_MODES)[number];
export const DEFAULT_MOUSE_MODE: MouseMode = 'edge-push';

export function isMouseMode(value: unknown): value is MouseMode {
  return typeof value === 'string' && (MOUSE_MODES as readonly string[]).includes(value);
}

/** True when the mode takes the pointer lock (the OS cursor is captured). */
export function usesPointerLock(mode: MouseMode): boolean {
  return mode !== 'edge-free';
}

export const MOUSE_LOOK = {
  /** Camera degrees per mouse pixel at sensitivity 1 (centred mode and edge overflow). */
  degreesPerPixel: 0.16,
  /** Locked cursor: within this |x| of the edge the cursor counts as pinned. */
  pinnedEdge: 0.985,
  /** Locked cursor pinned at an edge keeps turning at this rate (degrees per second). */
  pinnedTurnDegreesPerSecond: 90,
  /** Free cursor: the edge band starts at this |x| and ramps to the full rate at 1. */
  freeEdgeBand: 0.86,
  freeEdgeTurnDegreesPerSecond: 150,
  /** The orbit arm's pitch range (degrees down). The default matches the old fixed arm. */
  defaultPitchDegrees: 14,
  minPitchDegrees: 2,
  maxPitchDegrees: 40,
  /** Centred mode: the crosshair sits above the centre so it looks past the hull. */
  centredCursorY: -0.24,
} as const;

export interface LookState {
  /** The aim cursor, normalised: -1 = left/top edge, +1 = right/bottom edge. */
  readonly cursorX: number;
  readonly cursorY: number;
  /** World camera yaw, degrees, normalised to (-180, 180]. */
  readonly yawDegrees: number;
  /** Orbit arm pitch, degrees down. */
  readonly pitchDegrees: number;
}

export function initialLook(mode: MouseMode, yawDegrees: number): LookState {
  finite(yawDegrees, 'yawDegrees');
  return {
    cursorX: 0,
    cursorY: mode === 'centred' ? MOUSE_LOOK.centredCursorY : 0,
    yawDegrees: wrapDegrees(yawDegrees),
    pitchDegrees: MOUSE_LOOK.defaultPitchDegrees,
  };
}

/**
 * One locked-pointer movement (`movementX/Y` in CSS pixels) over a canvas of the given
 * size. `edge-free` has no locked movement and returns the state unchanged.
 */
export function applyLockedMove(
  state: LookState,
  mode: MouseMode,
  dxPixels: number,
  dyPixels: number,
  width: number,
  height: number,
  sensitivity: number,
): LookState {
  finite(dxPixels, 'dxPixels');
  finite(dyPixels, 'dyPixels');
  positive(width, 'width');
  positive(height, 'height');
  positive(sensitivity, 'sensitivity');
  const dx = dxPixels * sensitivity;
  const dy = dyPixels * sensitivity;
  if (mode === 'centred') {
    return {
      cursorX: 0,
      cursorY: MOUSE_LOOK.centredCursorY,
      yawDegrees: wrapDegrees(state.yawDegrees - dx * MOUSE_LOOK.degreesPerPixel),
      pitchDegrees: clampPitch(state.pitchDegrees + dy * MOUSE_LOOK.degreesPerPixel),
    };
  }
  if (mode === 'edge-push') {
    const rawX = state.cursorX + (dx * 2) / width;
    const rawY = state.cursorY + (dy * 2) / height;
    const cursorX = clampUnit(rawX);
    const cursorY = clampUnit(rawY);
    // The part of the move that went past the edge, back in pixels, turns the camera.
    const overflowX = ((rawX - cursorX) * width) / 2;
    const overflowY = ((rawY - cursorY) * height) / 2;
    return {
      cursorX,
      cursorY,
      yawDegrees: wrapDegrees(state.yawDegrees - overflowX * MOUSE_LOOK.degreesPerPixel),
      pitchDegrees: clampPitch(state.pitchDegrees + overflowY * MOUSE_LOOK.degreesPerPixel),
    };
  }
  return state;
}

/** The free (unlocked) cursor moved to a canvas-normalised position. */
export function applyFreePointer(state: LookState, x: number, y: number): LookState {
  finite(x, 'x');
  finite(y, 'y');
  return { ...state, cursorX: clampUnit(x), cursorY: clampUnit(y) };
}

/**
 * Continuous edge turning over one frame. `pointerInside` is false when the free cursor
 * has left the canvas (another monitor, the browser chrome): it then never turns, so
 * the view cannot spin while the player is elsewhere.
 */
export function advanceLook(
  state: LookState,
  mode: MouseMode,
  dtSeconds: number,
  pointerInside: boolean,
): LookState {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new Error(`mouseLook: dtSeconds must be finite and >= 0, got ${String(dtSeconds)}`);
  }
  const dt = Math.min(dtSeconds, 0.1);
  const turn = edgeTurnRate(state.cursorX, mode, pointerInside);
  if (turn === 0) return state;
  return { ...state, yawDegrees: wrapDegrees(state.yawDegrees - turn * dt) };
}

/** Signed edge turn rate in degrees per second; positive turns RIGHT (yaw decreases). */
export function edgeTurnRate(cursorX: number, mode: MouseMode, pointerInside: boolean): number {
  finite(cursorX, 'cursorX');
  const side = Math.sign(cursorX);
  const reach = Math.abs(cursorX);
  if (mode === 'edge-push') {
    return reach >= MOUSE_LOOK.pinnedEdge ? side * MOUSE_LOOK.pinnedTurnDegreesPerSecond : 0;
  }
  if (mode === 'edge-free') {
    if (!pointerInside || reach <= MOUSE_LOOK.freeEdgeBand) return 0;
    const ramp = Math.min(1, (reach - MOUSE_LOOK.freeEdgeBand) / (1 - MOUSE_LOOK.freeEdgeBand));
    return side * ramp * MOUSE_LOOK.freeEdgeTurnDegreesPerSecond;
  }
  return 0;
}

/** Puts the camera back behind the hull and the cursor back in its home position. */
export function recentreLook(mode: MouseMode, hullYawDegrees: number): LookState {
  return initialLook(mode, hullYawDegrees);
}

function clampPitch(value: number): number {
  return Math.max(MOUSE_LOOK.minPitchDegrees, Math.min(MOUSE_LOOK.maxPitchDegrees, value));
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function wrapDegrees(value: number): number {
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`mouseLook: ${label} must be finite, got ${String(value)}`);
  }
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`mouseLook: ${label} must be finite and > 0, got ${String(value)}`);
  }
}
