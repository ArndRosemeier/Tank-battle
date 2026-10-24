import { describe, expect, it } from 'vitest';
import { SCENE_BUDGET } from './config.ts';
import { PlayableSession } from '../game/session.ts';
import { createPlayableScene } from './playableScene.ts';
import { SpectatorSession } from '../game/spectator.ts';
import { measureScene } from './sceneStats.ts';

/**
 * The GPU-independent budget (ledger row 31): this host has no accessible GPU, so a
 * frame-rate number cannot gate a landing. The pin builds the SAME scene the app
 * renders (the terrain landscape plus the duel) and holds its draw-object, triangle
 * and vertex totals to 20 % headroom over the measured triangle-landscape scene.
 */
describe('scene budget', () => {
  it('the playable arena scene stays inside the pinned draw-object, triangle and vertex budget', () => {
    const session = new PlayableSession();
    const scene = createPlayableScene(session.state, {
      playerTankId: session.playerTankId,
      dummyTankId: session.dummyTankId,
    });
    try {
      scene.setTanks([session.player]);
      scene.syncWorld();
      const stats = measureScene(scene.group);

      console.log(
        `[scene-budget] drawObjects=${stats.drawObjects} triangles=${stats.triangles} ` +
          `vertices=${stats.vertices} (max ${SCENE_BUDGET.maxDrawObjects}/${SCENE_BUDGET.maxTriangles}/${SCENE_BUDGET.maxVertices})`,
      );

      // A non-empty scene, so a broken traversal cannot pass as "inside budget".
      expect(stats.drawObjects).toBeGreaterThan(0);
      expect(stats.triangles).toBeGreaterThan(0);
      expect(stats.vertices).toBeGreaterThan(0);

      expect(stats.drawObjects).toBeLessThanOrEqual(SCENE_BUDGET.maxDrawObjects);
      expect(stats.drawObjects).toBeLessThanOrEqual(SCENE_BUDGET.absoluteMaxDrawObjects);
      expect(stats.triangles).toBeLessThanOrEqual(SCENE_BUDGET.maxTriangles);
      expect(stats.vertices).toBeLessThanOrEqual(SCENE_BUDGET.maxVertices);
    } finally {
      scene.dispose();
    }
  });

  it('budgets the actual live 4x4 scene before and after play', () => {
    const match = new SpectatorSession({ seed: 7, teams: 4, tanksPerTeam: 4 });
    const scene = createPlayableScene(match.state, { focusTankId: match.state.tanks[0]!.id });
    try {
      for (let step = 0; step < 2; step += 1) {
        if (step) match.advance(1);
        scene.setTanks(match.interpolatedTanks(match.alpha));
        scene.setShells(match.state.shells);
        scene.syncWorld();
        const stats = measureScene(scene.group);
        expect(stats.drawObjects).toBeGreaterThan(0);
        expect(stats.drawObjects).toBeLessThanOrEqual(SCENE_BUDGET.absoluteMaxDrawObjects);
      }
    } finally {
      scene.dispose();
    }
  });
});
