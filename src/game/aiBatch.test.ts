import { describe, expect, it } from 'vitest';
import { runBatchMatches, runTeamBatch } from '../core/ai.ts';
import { createMatch, DEFAULT_MATCH_RULES } from '../core/sim.ts';
import { CELL_SIZE_METRES } from '../core/world.ts';
import { ARENA } from './levels/arena.ts';
import { arenaDuelSetup, arenaTeamSetup } from './aiBatch.ts';

describe('the duel staging', () => {
  it('pins the two spawns as an exact mirror pair across the arena centre', () => {
    const setup = arenaDuelSetup();
    const first = setup.spawns[0]!;
    const second = setup.spawns[1]!;
    expect(first).toEqual({
      teamId: 0,
      spawn: { xMetres: 18, zMetres: 6, hullYawDegrees: -90 },
    });
    expect(second).toEqual({
      teamId: 1,
      spawn: { xMetres: 30, zMetres: 6, hullYawDegrees: 90 },
    });
    // Mirroring x through the 48 m arena's centre must map one spawn onto the other,
    // and reverse the hull's facing.
    expect(first.spawn.xMetres + second.spawn.xMetres).toBe(ARENA.cells.columns * CELL_SIZE_METRES);
    expect(first.spawn.zMetres).toBe(second.spawn.zMetres);
    expect(first.spawn.hullYawDegrees ?? NaN).toBe(-(second.spawn.hullYawDegrees ?? NaN));
  });
});

describe('the headless AI batch', () => {
  it('builds the 4×4 and 2×2 authored team stagings without overlapping tanks', () => {
    for (const [teams, tanksPerTeam] of [[4, 4], [2, 2]] as const) {
      const setup = arenaTeamSetup(teams, tanksPerTeam);
      const state = createMatch({
        level: setup.level,
        teams: setup.teams.map((team) => ({ id: team.teamId, tanks: [...team.spawns] })),
        seed: 7,
        rules: DEFAULT_MATCH_RULES,
      });
      expect(state.teams).toHaveLength(teams);
      expect(state.tanks).toHaveLength(teams * tanksPerTeam);
      expect(new Set(state.tanks.map((tank) => `${tank.x},${tank.z}`)).size).toBe(teams * tanksPerTeam);
    }
  });

  it('runs the authored 4×4 team table without sharing a corner', () => {
    const result = runTeamBatch(arenaTeamSetup(4, 4), { seeds: 1, aimErrorScale: 0.1 });
    expect(result.matches).toHaveLength(1);
    expect(result.setup.teams).toBe(4);
    expect(result.setup.tanksPerTeam).toBe(4);
    expect(result.characters).toHaveLength(4);
    expect(Object.keys(result.summary.cornerWins)).toHaveLength(4);
    const wins = Object.values(result.summary.teamWins).reduce((sum, value) => sum + value, 0);
    expect(wins + result.summary.draws).toBe(1);
  }, 20000);

  it('reproduces the same three-seed result and trace', () => {
    const setup = arenaDuelSetup();
    const options = {
      seeds: 3,
      teams: 2,
      character: 'vanguard',
      rules: { tickCap: 600, bleedIntervalTicks: 600 },
    } as const;
    const first = runBatchMatches(setup, options);
    const second = runBatchMatches(setup, options);
    expect(first).toEqual(second);
    expect(first.matches).toHaveLength(3);
    expect(first.trace.length).toBeGreaterThan(0);
    expect(first.matches.map((match) => match.hash)).toEqual(
      second.matches.map((match) => match.hash),
    );
  });
});
