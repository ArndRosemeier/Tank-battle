import { describe, expect, it } from 'vitest';
import { PlayableSession } from '../game/session.ts';
import { createRng } from '../core/rng.ts';
import { damageCell } from '../core/world.ts';
import { createPlayableScene } from './playableScene.ts';

/** The rebuild gate: a no-op revision must not touch the merged world/debris buffers. */
describe('playable scene revisions', () => {
  it('rebuilds only when the world revision changes', () => {
    const session = new PlayableSession();
    const scene = createPlayableScene(session.state, {
      playerTankId: session.playerTankId,
      dummyTankId: session.dummyTankId,
    });

    try {
      expect(scene.syncWorld()).toBe(false);
      expect(scene.syncWorld()).toBe(false);

      damageCell(session.state.world, 1, 1, 1, createRng(404));
      expect(scene.syncWorld()).toBe(true);
      expect(scene.syncWorld()).toBe(false);
    } finally {
      scene.dispose();
    }
  });
});
