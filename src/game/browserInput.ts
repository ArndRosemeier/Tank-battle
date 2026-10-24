/**
 * Browser event gathering for the pure mappings in `input.ts` and `mouseLook.ts`. This
 * module reads the DOM; it makes NO decisions about throttle, aim or camera turning. It
 * owns which keys are held, the raw pointer (position or locked movement), whether fire
 * is held, and the pointer lock itself.
 *
 * The mouse mode comes from SETTINGS and is read live, so a change in the pause menu
 * applies on resume. In the locked modes the first click on the canvas only captures the
 * mouse (it does not fire); the browser always releases the lock on Escape, and
 * `onLockLost` lets the shell pause the match when that happens.
 */

import { normalisePointerAxis, type PlayerInput } from './input.ts';
import {
  advanceLook,
  applyFreePointer,
  applyLockedMove,
  initialLook,
  recentreLook,
  usesPointerLock,
  type LookState,
  type MouseMode,
} from './mouseLook.ts';

/** A click is latched long enough for at least one simulation tick, even on a slow frame. */
const FIRE_LATCH_MS = 600;

const KEY_CODES = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['Space'],
} as const;

/** A locked-pointer step larger than this (CSS px) is a browser glitch, not a hand. */
const MAX_LOCKED_STEP_PX = 400;

/** Puts the camera back behind the hull. */
const RECENTRE_KEY = 'KeyC';

export interface BrowserInputOptions {
  /** The player's mouse mode, read live (it can change in the pause menu). */
  readonly mode: () => MouseMode;
  /** Mouse speed multiplier, read live. */
  readonly sensitivity: () => number;
  /** The pointer lock ended while the player had it (Escape, alt-tab, …). */
  readonly onLockLost?: () => void;
}

export interface BrowserInput {
  /** The latest state; call once per simulation tick. */
  read(): PlayerInput;
  /**
   * Advances the mouse look by one render frame and returns the camera yaw/pitch. The
   * first call (and the recentre key) starts the camera behind the given hull yaw.
   */
  look(dtSeconds: number, hullYawDegrees: number): LookState;
  /** True while this canvas holds the pointer lock. */
  readonly locked: boolean;
  /** Asks for the pointer lock when the mode uses it. Must run inside a user gesture. */
  requestLock(): void;
  /** Gives the pointer lock back (pause, end screen). */
  releaseLock(): void;
  dispose(): void;
}

export function createBrowserInput(
  canvas: HTMLCanvasElement,
  options: BrowserInputOptions,
): BrowserInput {
  const pressed = new Set<string>();
  let pointerFire = false;
  let fireLatchUntil = 0;
  let pointerInside = false;
  let state: LookState | null = null;
  let stateMode: MouseMode = options.mode();
  let recentreRequested = false;
  let pendingFreePointer: { x: number; y: number } | null = null;

  const isLocked = (): boolean => document.pointerLockElement === canvas;

  /** The mode can change between frames; a new mode starts from a clean cursor. */
  const syncMode = (): MouseMode => {
    const mode = options.mode();
    if (mode !== stateMode) {
      stateMode = mode;
      if (state) state = initialLook(mode, state.yawDegrees);
      if (!usesPointerLock(mode) && isLocked()) document.exitPointerLock();
    }
    return mode;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      document.activeElement === canvas &&
      (event.code === 'Space' ||
      event.code === 'ArrowUp' ||
      event.code === 'ArrowDown' ||
      event.code === 'ArrowLeft' ||
      event.code === 'ArrowRight')
    ) {
      event.preventDefault();
    }
    if (event.code === 'Space') fireLatchUntil = performance.now() + FIRE_LATCH_MS;
    if (event.code === RECENTRE_KEY && !event.repeat) recentreRequested = true;
    pressed.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    pressed.delete(event.code);
  };
  const normalisedPointer = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // The ONE normalisation seam, pinned in node: right of centre is +x, above is -y.
    return {
      x: normalisePointerAxis(event.clientX, rect.left, rect.width),
      y: normalisePointerAxis(event.clientY, rect.top, rect.height),
    };
  };
  const onPointerMove = (event: PointerEvent): void => {
    pointerInside = true;
    const mode = syncMode();
    if (usesPointerLock(mode)) {
      if (!isLocked() || !state) return;
      // Some browsers report a bogus jump (hundreds of pixels) now and then under the
      // lock; a real hand never moves that far in one event, so it is dropped.
      if (Math.abs(event.movementX) > MAX_LOCKED_STEP_PX || Math.abs(event.movementY) > MAX_LOCKED_STEP_PX) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      state = applyLockedMove(
        state,
        mode,
        event.movementX,
        event.movementY,
        rect.width,
        rect.height,
        options.sensitivity(),
      );
      return;
    }
    const point = normalisedPointer(event);
    if (!point) return;
    if (state) state = applyFreePointer(state, point.x, point.y);
    else pendingFreePointer = point;
  };
  const onPointerLeave = (): void => {
    pointerInside = false;
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    canvas.focus();
    const mode = syncMode();
    if (usesPointerLock(mode) && !isLocked()) {
      // This click only captures the mouse; firing on it would surprise the player.
      requestLock();
      return;
    }
    pointerFire = true;
    fireLatchUntil = performance.now() + FIRE_LATCH_MS;
    if (!usesPointerLock(mode)) onPointerMove(event);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) pointerFire = false;
  };
  const onBlur = (): void => {
    pressed.clear();
    pointerFire = false;
    fireLatchUntil = 0;
    pointerInside = false;
  };
  let hadLock = false;
  const onLockChange = (): void => {
    const locked = isLocked();
    if (hadLock && !locked) {
      pointerFire = false;
      options.onLockLost?.();
    }
    hadLock = locked;
  };
  const onLockError = (): void => {
    // A refused lock (too soon after Escape, no gesture) just leaves the click hint up.
  };

  function requestLock(): void {
    if (!usesPointerLock(syncMode()) || isLocked()) return;
    try {
      const result = canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Same as onLockError: the hint stays and the next click tries again.
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();
  canvas.addEventListener('contextmenu', onContextMenu);

  let disposed = false;
  return {
    read(): PlayerInput {
      const mode = syncMode();
      const home = initialLook(mode, 0);
      return {
        forward: [...KEY_CODES.forward].some((code) => pressed.has(code)),
        backward: [...KEY_CODES.backward].some((code) => pressed.has(code)),
        left: [...KEY_CODES.left].some((code) => pressed.has(code)),
        right: [...KEY_CODES.right].some((code) => pressed.has(code)),
        pointerX: state?.cursorX ?? pendingFreePointer?.x ?? home.cursorX,
        pointerY: state?.cursorY ?? pendingFreePointer?.y ?? home.cursorY,
        fire:
          pointerFire ||
          performance.now() < fireLatchUntil ||
          [...KEY_CODES.fire].some((code) => pressed.has(code)),
      };
    },
    look(dtSeconds: number, hullYawDegrees: number): LookState {
      const mode = syncMode();
      if (state === null || recentreRequested) {
        const cursor = state && !usesPointerLock(mode) ? state : null;
        state = recentreLook(mode, hullYawDegrees);
        if (cursor) state = applyFreePointer(state, cursor.cursorX, cursor.cursorY);
        else if (pendingFreePointer && !usesPointerLock(mode)) {
          state = applyFreePointer(state, pendingFreePointer.x, pendingFreePointer.y);
        }
        pendingFreePointer = null;
        recentreRequested = false;
      }
      // A locked mode without the lock (paused, before the first click) holds still.
      if (!usesPointerLock(mode) || isLocked()) {
        state = advanceLook(state, mode, dtSeconds, pointerInside);
      }
      return state;
    },
    get locked(): boolean {
      return isLocked();
    },
    requestLock,
    releaseLock(): void {
      if (isLocked()) document.exitPointerLock();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (isLocked()) document.exitPointerLock();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
