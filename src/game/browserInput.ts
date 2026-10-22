/**
 * Browser event gathering for the pure mapping in `input.ts`. This module reads the
 * DOM; it makes NO decisions about throttle, aim or pitch. It owns only which keys are
 * held, where the pointer is in canvas-normalised coordinates, and whether fire is held.
 *
 * No pointer lock: the pointer is a camera-ray coordinate for the P6 world aim, and the
 * OS cursor is hidden in favour of the projected impact reticle. Clicking the canvas
 * fires and also focuses it; Escape remains the pause key.
 */

import { normalisePointerAxis, type PlayerInput } from './input.ts';

const KEY_CODES = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['Space'],
} as const;

export interface BrowserInput {
  /** The latest state; call once per simulation tick. */
  read(): PlayerInput;
  dispose(): void;
}

export function createBrowserInput(canvas: HTMLCanvasElement): BrowserInput {
  const pressed = new Set<string>();
  let pointerX = 0;
  let pointerY = 0;
  let pointerFire = false;

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
    pressed.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    pressed.delete(event.code);
  };
  const updatePointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      pointerX = 0;
      pointerY = 0;
      return;
    }
    // The ONE normalisation seam, pinned in node: right of centre is +x, above is -y.
    pointerX = normalisePointerAxis(event.clientX, rect.left, rect.width);
    pointerY = normalisePointerAxis(event.clientY, rect.top, rect.height);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    pointerFire = true;
    updatePointer(event);
    canvas.focus();
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) pointerFire = false;
  };
  const onBlur = (): void => {
    pressed.clear();
    pointerFire = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', updatePointer);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();
  canvas.addEventListener('contextmenu', onContextMenu);

  let disposed = false;
  return {
    read(): PlayerInput {
      return {
        forward: [...KEY_CODES.forward].some((code) => pressed.has(code)),
        backward: [...KEY_CODES.backward].some((code) => pressed.has(code)),
        left: [...KEY_CODES.left].some((code) => pressed.has(code)),
        right: [...KEY_CODES.right].some((code) => pressed.has(code)),
        pointerX,
        pointerY,
        fire: pointerFire || [...KEY_CODES.fire].some((code) => pressed.has(code)),
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointermove', updatePointer);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
