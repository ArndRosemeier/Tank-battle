import { describe, expect, it } from 'vitest';
import {
  MOUSE_LOOK,
  advanceLook,
  applyFreePointer,
  applyLockedMove,
  edgeTurnRate,
  initialLook,
  usesPointerLock,
} from './mouseLook.ts';

const W = 1000;
const H = 600;

describe('mouse look', () => {
  it('starts behind the hull with the cursor home', () => {
    expect(initialLook('edge-push', 30)).toEqual({
      cursorX: 0,
      cursorY: 0,
      yawDegrees: 30,
      pitchDegrees: MOUSE_LOOK.defaultPitchDegrees,
    });
    expect(initialLook('centred', 0).cursorY).toBe(MOUSE_LOOK.centredCursorY);
  });

  it('only the free-edge mode leaves the pointer unlocked', () => {
    expect(usesPointerLock('edge-push')).toBe(true);
    expect(usesPointerLock('centred')).toBe(true);
    expect(usesPointerLock('edge-free')).toBe(false);
  });

  it('edge push: moves the cursor freely inside the screen without turning', () => {
    const start = initialLook('edge-push', 0);
    const moved = applyLockedMove(start, 'edge-push', 250, -150, W, H, 1);
    expect(moved.cursorX).toBeCloseTo(0.5);
    expect(moved.cursorY).toBeCloseTo(-0.5);
    expect(moved.yawDegrees).toBe(0);
    expect(moved.pitchDegrees).toBe(MOUSE_LOOK.defaultPitchDegrees);
  });

  it('edge push: the part of a move past the right edge turns the camera right', () => {
    const start = initialLook('edge-push', 0);
    // 500 px reaches the edge; the extra 100 px turn the camera.
    const pushed = applyLockedMove(start, 'edge-push', 600, 0, W, H, 1);
    expect(pushed.cursorX).toBe(1);
    expect(pushed.yawDegrees).toBeCloseTo(-100 * MOUSE_LOOK.degreesPerPixel);
    const back = applyLockedMove(pushed, 'edge-push', -100, 0, W, H, 1);
    expect(back.cursorX).toBeCloseTo(0.8);
    expect(back.yawDegrees).toBeCloseTo(pushed.yawDegrees);
  });

  it('edge push: a cursor pinned at the edge keeps turning; one inside does not', () => {
    const pinned = { ...initialLook('edge-push', 0), cursorX: -1 };
    expect(advanceLook(pinned, 'edge-push', 0.5, true).yawDegrees).toBeCloseTo(
      0.1 * MOUSE_LOOK.pinnedTurnDegreesPerSecond, // dt is capped at 0.1 s
    );
    const inside = { ...pinned, cursorX: -0.9 };
    expect(advanceLook(inside, 'edge-push', 0.05, true).yawDegrees).toBe(0);
  });

  it('centred: the mouse turns and tilts the view, the crosshair stays put', () => {
    const start = initialLook('centred', 10);
    const turned = applyLockedMove(start, 'centred', 50, -20, W, H, 2);
    expect(turned.cursorX).toBe(0);
    expect(turned.cursorY).toBe(MOUSE_LOOK.centredCursorY);
    expect(turned.yawDegrees).toBeCloseTo(10 - 100 * MOUSE_LOOK.degreesPerPixel);
    expect(turned.pitchDegrees).toBeCloseTo(MOUSE_LOOK.defaultPitchDegrees - 40 * MOUSE_LOOK.degreesPerPixel);
    const down = applyLockedMove(start, 'centred', 0, 10_000, W, H, 1);
    expect(down.pitchDegrees).toBe(MOUSE_LOOK.maxPitchDegrees);
    expect(advanceLook(turned, 'centred', 0.1, true)).toEqual(turned);
  });

  it('free edge: turns only near the edge and only while the pointer is in the window', () => {
    expect(edgeTurnRate(0.5, 'edge-free', true)).toBe(0);
    expect(edgeTurnRate(1, 'edge-free', true)).toBe(MOUSE_LOOK.freeEdgeTurnDegreesPerSecond);
    expect(edgeTurnRate(-1, 'edge-free', true)).toBe(-MOUSE_LOOK.freeEdgeTurnDegreesPerSecond);
    // The pointer went to another monitor: no runaway spin.
    expect(edgeTurnRate(1, 'edge-free', false)).toBe(0);
    const atEdge = applyFreePointer(initialLook('edge-free', 0), 0.99, 0.2);
    expect(atEdge.cursorY).toBe(0.2);
    expect(advanceLook(atEdge, 'edge-free', 0.1, true).yawDegrees).toBeLessThan(0);
    expect(applyLockedMove(atEdge, 'edge-free', 100, 100, W, H, 1)).toEqual(atEdge);
  });

  it('offset: turns faster the further the cursor is from the centre, gently at first', () => {
    expect(edgeTurnRate(0, 'offset', true)).toBe(0);
    expect(edgeTurnRate(MOUSE_LOOK.offsetDeadZone, 'offset', true)).toBe(0);
    const small = edgeTurnRate(0.25, 'offset', true);
    const half = edgeTurnRate(0.5, 'offset', true);
    const full = edgeTurnRate(1, 'offset', true);
    expect(full).toBe(MOUSE_LOOK.offsetMaxTurnDegreesPerSecond);
    expect(edgeTurnRate(-1, 'offset', true)).toBe(-full);
    expect(small).toBeGreaterThan(0);
    // Not linear: a quarter of the way out turns well under a quarter of the top rate.
    expect(small).toBeLessThan(full * 0.1);
    expect(half).toBeLessThan(full * 0.3);
    expect(half / small).toBeGreaterThan(3);
    // Cursor right turns right (yaw decreases), and it moves freely like edge push.
    const right = applyLockedMove(initialLook('offset', 0), 'offset', 250, 0, W, H, 1);
    expect(right.cursorX).toBeCloseTo(0.5);
    expect(right.yawDegrees).toBe(0);
    expect(advanceLook(right, 'offset', 0.1, true).yawDegrees).toBeCloseTo(-half * 0.1);
  });

  it('wraps yaw and rejects bad numbers', () => {
    const start = initialLook('centred', 179);
    const wrapped = applyLockedMove(start, 'centred', -100, 0, W, H, 1);
    expect(wrapped.yawDegrees).toBeLessThan(0);
    expect(() => applyLockedMove(start, 'centred', Number.NaN, 0, W, H, 1)).toThrow(/dxPixels/);
    expect(() => advanceLook(start, 'centred', -1, true)).toThrow(/dtSeconds/);
  });
});
