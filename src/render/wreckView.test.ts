import { describe, expect, it } from 'vitest';
import {
  WRECK_FADE_START_FRACTION,
  WRECK_LIFETIME_SECONDS,
  WRECK_MAX_WRECKS,
  WRECK_REDUCED_LIFETIME_SECONDS,
  createWreckView,
  wreckAlpha,
  type WreckSpawn,
} from './wreckView.ts';
import { TANK_WRECK_PARTS } from './placeholderTank.ts';

const SPAWN: WreckSpawn = {
  x: 12,
  y: 0.2,
  z: 12,
  hullYawDegrees: -90,
  turretYawDegrees: -90,
  aimPitchDegrees: 0,
  teamId: 0,
  seed: 7,
  tankId: 1,
  tick: 1234,
  direction: { x: 1, y: 0, z: 0 },
  reducedMotion: false,
};

function view() {
  return createWreckView(() => 0.2);
}

describe('the instanced wreck system', () => {
  it('is deterministic for one death seed and packs every authored part', () => {
    const first = view();
    const second = view();
    try {
      first.spawn(SPAWN);
      second.spawn(SPAWN);
      first.update(0);
      second.update(0);
      expect(first.debug()).toEqual(second.debug());
      expect(first.debug().activePieces).toBe(TANK_WRECK_PARTS.length);
      expect(first.group.children).toHaveLength(1);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('fades monotonically and reaches exactly zero at the lifetime', () => {
    expect(wreckAlpha(0)).toBe(1);
    expect(wreckAlpha(WRECK_LIFETIME_SECONDS * WRECK_FADE_START_FRACTION)).toBe(1);
    expect(wreckAlpha(2.4)).toBeLessThan(1);
    expect(wreckAlpha(2.4)).toBeGreaterThan(0);
    expect(wreckAlpha(WRECK_LIFETIME_SECONDS)).toBe(0);
    expect(wreckAlpha(4)).toBe(0);
    let previous = 1;
    for (let age = 0; age <= WRECK_LIFETIME_SECONDS; age += 0.05) {
      const alpha = wreckAlpha(age);
      expect(alpha).toBeLessThanOrEqual(previous + 1e-12);
      previous = alpha;
    }
  });

  it('reduced motion removes the scatter and fades in place over 0.4 s', () => {
    const wreck = view();
    try {
      wreck.spawn({ ...SPAWN, reducedMotion: true });
      wreck.update(0);
      const before = wreck.debug().pieces.map((piece) => ({ ...piece.position }));
      wreck.update(0.2);
      const after = wreck.debug().pieces.map((piece) => ({ ...piece.position }));
      expect(after).toEqual(before);
      expect(wreck.debug().pieces[0]?.alpha).toBeCloseTo(0.5, 10);
      wreck.update(WRECK_REDUCED_LIFETIME_SECONDS / 2);
      expect(wreck.debug().activePieces).toBe(0);
    } finally {
      wreck.dispose();
    }
  });

  it('evicts the oldest of nine deaths without growing the pool', () => {
    const wreck = view();
    try {
      for (let index = 0; index < WRECK_MAX_WRECKS + 1; index += 1) {
        wreck.spawn({ ...SPAWN, tick: 2000 + index });
        wreck.update(0);
      }
      const state = wreck.debug();
      expect(state.spawnCount).toBe(WRECK_MAX_WRECKS + 1);
      expect(state.activeWrecks).toBe(WRECK_MAX_WRECKS);
      expect(state.activePieces).toBe(WRECK_MAX_WRECKS * TANK_WRECK_PARTS.length);
      expect(state.allocatedPieces).toBe(WRECK_MAX_WRECKS * TANK_WRECK_PARTS.length);
      const activeSequences = state.slots
        .filter((slot) => slot.active)
        .map((slot) => slot.sequence)
        .sort((a, b) => a - b);
      expect(activeSequences).toEqual(
        Array.from({ length: WRECK_MAX_WRECKS }, (_, index) => index + 2),
      );
    } finally {
      wreck.dispose();
    }
  });
});
