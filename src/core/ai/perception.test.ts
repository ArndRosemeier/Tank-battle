import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_MATCH_RULES, type MatchState } from '../sim.ts';
import { boxTerrain, createWorld, flatTerrain, type TerrainBox } from '../world.ts';
import {
  PerceptionMemory,
  eyePosition,
  hasLineOfSight,
  targetCentre,
  visibleEnemies,
} from './perception.ts';

const GROUND = 1.5;
const CELLS = 27;

function flatMatch(boxes: readonly TerrainBox[] = []): MatchState {
  return createMatch({
    level: boxes.length === 0 ? flatTerrain(CELLS, CELLS, GROUND) : boxTerrain(CELLS, CELLS, GROUND, boxes),
    teams: [
      { id: 0, tanks: [{ xMetres: 5, zMetres: 5 }] },
      { id: 1, tanks: [{ xMetres: 15, zMetres: 5 }] },
    ],
    seed: 123,
    rules: DEFAULT_MATCH_RULES,
  });
}

const wall = (topMetres: number): TerrainBox => ({ minX: 20, maxX: 23, minZ: 15, maxZ: 27, topMetres });

describe('AI perception', () => {
  it('sees over a low barrier but not through a tall wall', () => {
    const from = { x: 12, y: GROUND + 1.6, z: 21 };
    const to = { x: 31, y: GROUND + 1.0, z: 21 };
    const low = createWorld(boxTerrain(CELLS, CELLS, GROUND, [wall(GROUND + 0.8)]));
    const tall = createWorld(boxTerrain(CELLS, CELLS, GROUND, [wall(GROUND + 4.8)]));
    expect(hasLineOfSight(low, from, to)).toBe(true);
    expect(hasLineOfSight(tall, from, to)).toBe(false);

    const state = flatMatch();
    const tank = state.tanks[0]!;
    const target = state.tanks[1]!;
    expect(tank.y).toBeCloseTo(GROUND, 1);
    expect(hasLineOfSight(state.world, eyePosition(tank), targetCentre(target))).toBe(true);
    expect(visibleEnemies(state, tank).map((enemy) => enemy.id)).toEqual([1]);
  });

  it('is team-aware and keeps a short last-seen memory', () => {
    // A tall wall stands east of the target's start, between x 24 and 27.
    const state = flatMatch([{ minX: 24, maxX: 27, minZ: 0, maxZ: 12, topMetres: GROUND + 4.8 }]);
    const tank = state.tanks[0]!;
    const target = state.tanks[1]!;
    const memory = new PerceptionMemory(2);
    expect(memory.update(state, tank).map((enemy) => enemy.id)).toEqual([1]);
    expect(memory.latest()?.x).toBe(target.x);

    // Move the target behind the wall without stepping the sim: this is a perception
    // test, not a movement test.
    target.x = 35;
    state.tick = 2;
    expect(memory.update(state, tank)).toHaveLength(0);
    expect(memory.latest()?.x).toBe(15);
    state.tick = 5;
    memory.update(state, tank);
    expect(memory.latest()).toBeNull();
  });
});
