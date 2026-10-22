import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_MATCH_RULES, type MatchState } from '../sim.ts';
import { createWorld, type Cell } from '../world.ts';
import {
  PerceptionMemory,
  eyePosition,
  hasLineOfSight,
  targetCentre,
  visibleEnemies,
} from './perception.ts';

const FLOOR = 0.2;

function flatMatch(): MatchState {
  return createMatch({
    level: { columns: 20, rows: 20, floorSurfaceHeightMetres: FLOOR },
    teams: [
      { id: 0, tanks: [{ xMetres: 5, zMetres: 5 }] },
      { id: 1, tanks: [{ xMetres: 15, zMetres: 5 }] },
    ],
    seed: 123,
    rules: DEFAULT_MATCH_RULES,
  });
}

describe('AI perception', () => {
  it('sees over a 1.2 m barrier but not through a 4.8 m wall', () => {
    const from = { x: 15, y: FLOOR + 1.6, z: 21 };
    const to = { x: 31, y: FLOOR + 1.0, z: 21 };
    const low = createWorld({
      columns: 20,
      rows: 20,
      floorSurfaceHeightMetres: FLOOR,
      placements: [{ x: 10, z: 10, material: 'wall', heightMetres: 1.2 }],
    });
    const tall = createWorld({
      columns: 20,
      rows: 20,
      floorSurfaceHeightMetres: FLOOR,
      placements: [{ x: 10, z: 10, material: 'wall', heightMetres: 4.8 }],
    });
    expect(hasLineOfSight(low, from, to)).toBe(true);
    expect(hasLineOfSight(tall, from, to)).toBe(false);

    const state = flatMatch();
    const tank = state.tanks[0]!;
    const target = state.tanks[1]!;
    expect(hasLineOfSight(state.world, eyePosition(state.world, tank), targetCentre(state.world, target))).toBe(true);
    expect(visibleEnemies(state, tank).map((enemy) => enemy.id)).toEqual([1]);
  });

  it('is team-aware and keeps a short last-seen memory', () => {
    const state = flatMatch();
    const tank = state.tanks[0]!;
    const target = state.tanks[1]!;
    const memory = new PerceptionMemory(2);
    expect(memory.update(state, tank).map((enemy) => enemy.id)).toEqual([1]);
    expect(memory.latest()?.x).toBe(target.x);

    // Move the target behind a tall wall without stepping the sim: this is a
    // perception test, not a movement test.
    (state.world.cells as unknown as Cell[])[2 * state.world.columns + 10] = {
      ...state.world.cells[2 * state.world.columns + 10]!,
      material: 'wall',
      heightMetres: 4.8,
      hp: 2,
      maxHp: 2,
    };
    target.x = 35;
    state.tick = 2;
    expect(memory.update(state, tank)).toHaveLength(0);
    expect(memory.latest()?.x).toBe(15);
    state.tick = 5;
    memory.update(state, tank);
    expect(memory.latest()).toBeNull();
  });
});
