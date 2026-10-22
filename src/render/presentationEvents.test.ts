import { describe, expect, it } from 'vitest';
import { createMatch, stepMatch, idleTankCommand } from '../core/sim.ts';
import { createPlayableScene } from './playableScene.ts';
import { ARENA } from '../game/levels/arena.ts';

describe('tick-level presentation events', () => {
  it('keeps firing events across multiple simulation ticks before one rendered frame', () => {
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
      const tank = state.tanks[0]!;
      for (let tick = 0; tick < 10; tick += 1) {
        stepMatch(state, [
          { tankId: 0, command: { ...idleTankCommand(tank.turretYawDegrees), fire: true } },
          { tankId: 1, command: idleTankCommand() },
        ]);
      }
      scene.setShells(state.shells);
      const events = scene.takeEvents();
      expect(events.some((event) => event.type === 'fire')).toBe(true);
      expect(events.some((event) => event.type === 'reload')).toBe(true);
      expect(state.presentationEvents).toEqual([]);
      scene.setShells(state.shells);
      expect(scene.takeEvents()).toEqual([]);
    } finally {
      scene.dispose();
    }
  });
  it('does not collect presentation events in headless simulations', () => {
    const state = createMatch({
      level: ARENA.cells,
      teams: [
        { id: 0, tanks: [{ xMetres: 18, zMetres: 6, hullYawDegrees: -90 }] },
        { id: 1, tanks: [{ xMetres: 30, zMetres: 6, hullYawDegrees: 90 }] },
      ],
      seed: 9,
      rules: { tickCap: 600, bleedIntervalTicks: 600 },
    });
    stepMatch(state, [
      { tankId: 0, command: { ...idleTankCommand(-90), fire: true } },
      { tankId: 1, command: idleTankCommand() },
    ]);
    expect(state.presentationEvents).toBeUndefined();
  });
});
