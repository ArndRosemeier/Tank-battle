import { describe, expect, it } from 'vitest';
import { flatTerrain } from '../core/world.ts';
import { createMatch, stepMatch, idleTankCommand } from '../core/sim.ts';
import { createPlayableScene } from './playableScene.ts';

describe('tick-level presentation events', () => {
  it('keeps firing events across multiple simulation ticks before one rendered frame', () => {
    const state = createMatch({
      level: flatTerrain(40, 40, 1.5),
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
      level: flatTerrain(40, 40, 1.5),
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

describe('death direction', () => {
  it('carries the killing shell direction and its death tick', () => {
    const state = createMatch({
      level: flatTerrain(53, 26, 1.5),
      teams: [
        { id: 0, tanks: [{ xMetres: 18, zMetres: 6, hullYawDegrees: -90 }] },
        { id: 1, tanks: [{ xMetres: 30, zMetres: 6, hullYawDegrees: 90 }] },
      ],
      seed: 8,
      rules: { tickCap: 600, bleedIntervalTicks: 600 },
    });
    try {
      state.capturePresentationEvents = true;
      const target = state.tanks[1]!;
      target.hp = 1;
      for (let tick = 0; tick < 80 && target.alive; tick += 1) {
        stepMatch(state, [
          { tankId: 0, command: { ...idleTankCommand(-90), fire: tick === 0 } },
          { tankId: 1, command: idleTankCommand(90) },
        ]);
      }
      const death = state.presentationEvents?.find((event) => event.type === 'death');
      expect(death).toBeDefined();
      expect(death!.type).toBe('death');
      if (death?.type !== 'death') throw new Error('missing death event');
      expect(death.dx).toBeCloseTo(1, 6);
      expect(death.dy).toBeCloseTo(0, 6);
      expect(death.dz).toBeCloseTo(0, 6);
      expect(death.tick).toBeGreaterThan(0);
    } finally {
      // No resources are owned by MatchState.
    }
  });
});
