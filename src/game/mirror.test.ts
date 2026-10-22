import { describe, expect, it } from 'vitest';
import { ARENA } from './levels/arena.ts';
import {
  createMatch,
  DEFAULT_MATCH_RULES,
  stepMatch,
  type TankCommand,
} from '../core/sim.ts';

/**
 * The mirror pin is deliberately a SCRIPTED duel, not the AI. It isolates the
 * simulation/scenario from AI randomness: the tanks at (18, 6) and (30, 6) are
 * mirrored through the x axis into (18, 42) and (30, 42), the teams are swapped, and
 * the first-shooter role moves from team 0 to team 1. With the same mirrored script,
 * a fair simulation must produce the mirrored winner and the same length/causes.
 */
const H = ARENA.cells.rows;

function mirroredWorld() {
  return {
    columns: ARENA.cells.columns,
    rows: ARENA.cells.rows,
    floorSurfaceHeightMetres: ARENA.cells.floorSurfaceHeightMetres,
    placements: (ARENA.cells.placements ?? []).map((placement) => ({
      ...placement,
      z: H - 1 - placement.z,
    })),
  };
}

function command(aimYaw: number, fire: boolean): TankCommand {
  return { throttle: 0, steer: 0, aimYaw, aimPitch: 0, fire };
}

interface ScriptSpawn {
  readonly teamId: number;
  readonly xMetres: number;
  readonly zMetres: number;
  readonly yawDegrees: number;
}

function runScripted(
  level: typeof ARENA.cells | ReturnType<typeof mirroredWorld>,
  spawns: readonly ScriptSpawn[],
  firstTeamId: number,
): { winner: number | null; ticks: number; causes: { shell: number; clock: number } } {
  const state = createMatch({
    level,
    teams: spawns.map((spawn) => ({
      id: spawn.teamId,
      tanks: [{
        xMetres: spawn.xMetres,
        zMetres: spawn.zMetres,
        hullYawDegrees: spawn.yawDegrees,
        turretYawDegrees: spawn.yawDegrees,
      }],
    })),
    seed: 1,
    rules: DEFAULT_MATCH_RULES,
  });
  for (const tank of state.tanks) tank.hp = 1;
  let guard = 0;
  while (state.status === 'active') {
    const orders = state.tanks
      .filter((tank) => tank.alive)
      .map((tank) => ({
        tankId: tank.id,
        command: command(
          tank.id === 0 ? -90 : 90,
          tank.teamId === firstTeamId ? state.tick <= 1 : state.tick >= 20,
        ),
      }));
    stepMatch(state, orders);
    guard += 1;
    if (guard > 100) throw new Error('mirror: the scripted duel did not terminate');
  }
  return {
    winner: state.winnerTeamId,
    ticks: state.tick,
    causes: { ...state.stats.causes },
  };
}

describe('the mirrored-arena pin', () => {
  it('a mirrored script produces the mirrored winner, length and causes', () => {
    const original = runScripted(
      ARENA.cells,
      [
        { teamId: 0, xMetres: 18, zMetres: 6, yawDegrees: -90 },
        { teamId: 1, xMetres: 30, zMetres: 6, yawDegrees: 90 },
      ],
      0,
    );
    const mirrored = runScripted(
      mirroredWorld(),
      [
        { teamId: 0, xMetres: 30, zMetres: 42, yawDegrees: 90 },
        { teamId: 1, xMetres: 18, zMetres: 42, yawDegrees: -90 },
      ],
      1,
    );
    expect(original.winner).toBe(0);
    expect(mirrored.winner).toBe(1);
    expect(mirrored.ticks).toBe(original.ticks);
    expect(mirrored.causes).toEqual(original.causes);
  });
});
