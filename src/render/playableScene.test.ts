import { describe, expect, it } from 'vitest';
import { PlayableSession } from '../game/session.ts';
import { blastTerrain } from '../core/world.ts';
import { createPlayableScene } from './playableScene.ts';

/** The rebuild gate: a no-op revision must not re-mesh the terrain. */
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

      // A crater in open ground: no overhang, so nothing is left falling afterwards.
      blastTerrain(session.state.world, 30, 4.5, 14);
      expect(scene.syncWorld()).toBe(true);
      expect(scene.syncWorld()).toBe(false);
    } finally {
      scene.dispose();
    }
  });

  it('emits fire and reload presentation events for a newly spawned shell', () => {
    const session = new PlayableSession({ demo: true });
    session.runDemo(1);
    const scene = createPlayableScene(session.state, {
      playerTankId: session.playerTankId,
      dummyTankId: session.dummyTankId,
    });
    try {
      scene.setShells(session.state.shells);
      const events = scene.takeEvents();
      expect(events.some((event) => event.type === 'fire')).toBe(true);
      expect(events.some((event) => event.type === 'reload')).toBe(true);
      expect(scene.takeEvents()).toEqual([]);
    } finally {
      scene.dispose();
    }
  });
});
