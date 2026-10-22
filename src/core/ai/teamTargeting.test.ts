import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_MATCH_RULES, stepMatch } from '../sim.ts';
import { AIController } from './controller.ts';
import { getAIProfile } from './profile.ts';

describe('four-team targeting', () => {
  it('does not leave a tank permanently locked on one enemy', () => {
    // Four one-tank teams on an open floor: every tank can see every other tank, so
    // this isolates target choice from terrain and from team stacking.
    const state = createMatch({
      level: { columns: 24, rows: 24, floorSurfaceHeightMetres: 0.2 },
      teams: [
        { id: 0, tanks: [{ xMetres: 5, zMetres: 5, hullYawDegrees: -90 }] },
        { id: 1, tanks: [{ xMetres: 37, zMetres: 5, hullYawDegrees: -90 }] },
        { id: 2, tanks: [{ xMetres: 37, zMetres: 37, hullYawDegrees: -90 }] },
        { id: 3, tanks: [{ xMetres: 5, zMetres: 37, hullYawDegrees: -90 }] },
      ],
      seed: 1,
      rules: DEFAULT_MATCH_RULES,
    });
    const controllers = new Map<number, AIController>();
    const targets = new Map<number, Set<number>>();
    for (const tank of state.tanks) {
      controllers.set(
        tank.id,
        new AIController({ tankId: tank.id, profile: getAIProfile('vanguard'), seed: tank.id + 1 }),
      );
      targets.set(tank.id, new Set<number>());
    }

    for (let tick = 0; tick < 1200; tick += 1) {
      const orders = state.tanks
        .filter((tank) => tank.alive)
        .map((tank) => ({
          tankId: tank.id,
          command: controllers.get(tank.id)!.commandFor(state, tank.id),
        }));
      stepMatch(state, orders);
      for (const tank of state.tanks) {
        const target = controllers.get(tank.id)!.debug.targetTankId;
        if (target !== null) targets.get(tank.id)!.add(target);
      }
    }

    for (const tank of state.tanks) {
      expect(targets.get(tank.id)!.size).toBeGreaterThanOrEqual(2);
    }
  });
});
