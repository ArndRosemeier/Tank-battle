import { describe, expect, it } from 'vitest';
import { blastTerrain, boxTerrain, flatTerrain } from '../world.ts';
import { createMatch, DEFAULT_MATCH_RULES, type MatchState } from '../sim.ts';
import { AIController } from './controller.ts';

const GROUND = 1.5;

function duel(): MatchState {
  return createMatch({
    level: flatTerrain(27, 27, GROUND),
    teams: [
      { id: 0, tanks: [{ xMetres: 5, zMetres: 5 }] },
      { id: 1, tanks: [{ xMetres: 15, zMetres: 5 }] },
    ],
    seed: 123,
    rules: DEFAULT_MATCH_RULES,
  });
}

describe('the vanguard controller', () => {
  it('fires only when the target is inside the current aim cone', () => {
    const state = duel();
    const tank = state.tanks[0]!;
    tank.turretYawDegrees = -90;
    const controller = new AIController({ tankId: 0, seed: 7, aimErrorScale: 0 });
    const aligned = controller.commandFor(state, 0);
    expect(controller.debug.visibleTankIds).toEqual([1]);
    expect(aligned.fire).toBe(true);

    const offState = duel();
    const off = new AIController({ tankId: 0, seed: 7, aimErrorScale: 0 });
    const misaligned = off.commandFor(offState, 0);
    expect(misaligned.fire).toBe(false);
    expect(misaligned.aimYaw).toBeCloseTo(-90, 6);
    // When the turret reaches the target direction at the next decision, the vanguard
    // fires; it does not fire just because the target exists.
    offState.tanks[0]!.turretYawDegrees = -90;
    offState.tick = 6;
    expect(off.commandFor(offState, 0).fire).toBe(true);
  });

  it('decides every six ticks and holds the command in between', () => {
    const state = duel();
    const controller = new AIController({ tankId: 0, seed: 7, aimErrorScale: 0 });
    controller.commandFor(state, 0);
    expect(controller.debug.decisionCount).toBe(1);
    state.tick = 1;
    const held = controller.commandFor(state, 0);
    expect(held.fire).toBe(false);
    for (const tick of [2, 3, 4, 5]) {
      state.tick = tick;
      expect(controller.commandFor(state, 0)).toBe(held);
      expect(controller.debug.decisionCount).toBe(1);
    }
    state.tick = 6;
    controller.commandFor(state, 0);
    expect(controller.debug.decisionCount).toBe(2);
  });

  it('recomputes its route within the next decision after a wall is destroyed', () => {
    const state = createMatch({
      // A low wall across the straight line between the tanks.
      level: boxTerrain(27, 27, GROUND, [{ minX: 19.5, maxX: 22.5, minZ: 0, maxZ: 9, topMetres: GROUND + 3 }]),
      teams: [
        { id: 0, tanks: [{ xMetres: 5, zMetres: 5 }] },
        { id: 1, tanks: [{ xMetres: 25, zMetres: 5 }] },
      ],
      seed: 123,
      rules: DEFAULT_MATCH_RULES,
    });
    const controller = new AIController({ tankId: 0, seed: 7, aimErrorScale: 0 });
    controller.commandFor(state, 0);
    const before = controller.debug.path;
    expect(before).not.toBeNull();
    const oldRevision = controller.debug.pathRevision;
    blastTerrain(state.world, 21, GROUND + 1.5, 5, 3, 900);
    // The shared graph refreshes at most every AI_NAV_REBUILD_TICKS.
    state.tick = 60;
    controller.commandFor(state, 0);
    expect(controller.debug.pathRevision).toBeGreaterThan(oldRevision);
    expect(controller.debug.path).not.toBeNull();
  });

  it('reproduces the same decision sequence from the same seed and state', () => {
    const first = new AIController({ tankId: 0, seed: 99 });
    const second = new AIController({ tankId: 0, seed: 99 });
    const firstState = duel();
    const secondState = duel();
    for (let tick = 0; tick < 24; tick += 1) {
      firstState.tick = tick;
      secondState.tick = tick;
      expect(first.commandFor(firstState, 0)).toEqual(second.commandFor(secondState, 0));
    }
    expect(first.debug.decisionCount).toBe(second.debug.decisionCount);
    expect(first.debug.pathGoalKey).toBe(second.debug.pathGoalKey);
  });
});
