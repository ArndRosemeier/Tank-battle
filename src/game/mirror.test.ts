import { describe, expect, it } from 'vitest';
import { ARENA, ARENA_BOUNDS } from './levels/arena.ts';
import {
  createMatch,
  DEFAULT_MATCH_RULES,
  stepMatch,
  type TankCommand,
} from '../core/sim.ts';

/**
 * The rotation pin is deliberately a SCRIPTED duel, not the AI. It isolates the
 * simulation/scenario from AI randomness: two tanks face each other across team 0's
 * pad, then the same duel is staged on team 1's pad (the arena turned 90°) with the
 * teams swapped and the first-shooter role moved from team 0 to team 1. On a fair,
 * four-fold arena the turned script must produce the swapped winner and the same
 * length and causes.
 */
const SIZE = ARENA_BOUNDS.maxX;

function turn(spawn: ScriptSpawn, teamId: number): ScriptSpawn {
  return {
    teamId,
    xMetres: SIZE - spawn.zMetres,
    zMetres: spawn.xMetres,
    yawDegrees: spawn.yawDegrees - 90,
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
  spawns: readonly ScriptSpawn[],
  firstTeamId: number,
): { winner: number | null; ticks: number; causes: { shell: number; clock: number } } {
  const state = createMatch({
    level: ARENA.terrain,
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
          spawns.find((spawn) => spawn.teamId === tank.teamId)!.yawDegrees,
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

describe('the rotated-arena pin', () => {
  it('a turned script produces the swapped winner, length and causes', () => {
    const staged: ScriptSpawn[] = [
      { teamId: 0, xMetres: 7.5, zMetres: 11, yawDegrees: -90 },
      { teamId: 1, xMetres: 14.5, zMetres: 11, yawDegrees: 90 },
    ];
    const original = runScripted(staged, 0);
    const turned = runScripted([turn(staged[0]!, 1), turn(staged[1]!, 0)], 1);
    expect(original.winner).toBe(0);
    expect(turned.winner).toBe(1);
    expect(turned.ticks).toBe(original.ticks);
    expect(turned.causes).toEqual(original.causes);
  });
});
