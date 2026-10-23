import { describe, expect, it } from 'vitest';
import { createMatch } from '../core/sim.ts';
import { createPlayableScene } from './playableScene.ts';
import { snapshotTanks } from '../game/tankFrames.ts';
import { ARENA } from '../game/levels/arena.ts';
import { measureScene } from './sceneStats.ts';

describe('the wreck in the playable scene', () => {
  it('hides the dead tank in the same frame it spawns the wreck', () => {
    const state = createMatch({
      level: ARENA.cells,
      teams: [
        { id: 0, tanks: [{ xMetres: 18, zMetres: 6, hullYawDegrees: -90 }] },
        { id: 1, tanks: [{ xMetres: 30, zMetres: 6, hullYawDegrees: 90 }] },
      ],
      seed: 8,
      rules: { tickCap: 600, bleedIntervalTicks: 600 },
    });
    const scene = createPlayableScene(state, { playerTankId: 0 });
    try {
      const before = measureScene(scene.group);
      const target = state.tanks[1]!;
      target.alive = false;
      target.hp = 0;
      scene.setTanks([...snapshotTanks(state).values()]);
      expect(scene.tanks.get(target.id)!.group.visible).toBe(false);

      state.presentationEvents!.push({
        type: 'death',
        tankId: target.id,
        teamId: target.teamId,
        tick: state.tick,
        x: target.x,
        y: state.world.floorSurfaceHeightMetres + 0.8,
        z: target.z,
        dx: 1,
        dy: 0,
        dz: 0,
      });
      scene.setShells([]);
      scene.updateEffects(0.016);

      expect(scene.tanks.get(target.id)!.group.visible).toBe(false);
      expect(scene.wreck.debug().activePieces).toBeGreaterThan(0);
      expect(scene.takeEvents().some((event) => event.type === 'death')).toBe(true);
      const after = measureScene(scene.group);
      console.log(
        `[wreck] drawObjects ${before.drawObjects}->${after.drawObjects}, ` +
          `lines ${before.lineObjects}->${after.lineObjects}, triangles ${before.triangles}->${after.triangles}`,
      );
      expect(after.lineObjects).toBeLessThanOrEqual(before.lineObjects + 1);
      expect(after.drawObjects).toBeLessThanOrEqual(before.drawObjects + 1);
    } finally {
      scene.dispose();
    }
  });
});
