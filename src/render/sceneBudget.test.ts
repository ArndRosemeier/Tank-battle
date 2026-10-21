import { describe, expect, it } from 'vitest';
import { SCENE_BUDGET } from './config.ts';
import { buildArenaScene } from './sceneAssembly.ts';

/**
 * The GPU-independent budget (ledger row 31): this host has no accessible GPU, so a
 * frame-rate number cannot gate a landing. The pin builds the SAME scene the app
 * renders and holds its draw-object, triangle and vertex totals to 20 % headroom over
 * the measured A2b showcase.
 */
describe('scene budget', () => {
  it('the showcase scene stays inside the pinned draw-object, triangle and vertex budget', () => {
    const arena = buildArenaScene();
    const { stats } = arena;

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

    arena.dispose();
  });
});
