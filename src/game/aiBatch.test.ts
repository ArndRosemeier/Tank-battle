import { describe, expect, it } from 'vitest';
import { runBatchMatches, runTeamBatch } from '../core/ai.ts';
import { createMatch, DEFAULT_MATCH_RULES } from '../core/sim.ts';
import { ARENA_BOUNDS } from './levels/arena.ts';
import { arenaDuelSetup, arenaTeamSetup } from './aiBatch.ts';

describe('the duel staging', () => {
  it('pins the two spawns as an exact half-turn pair across the arena centre', () => {
    const setup = arenaDuelSetup();
    const first = setup.spawns[0]!;
    const second = setup.spawns[1]!;
    expect(first.teamId).toBe(0);
    expect(second.teamId).toBe(1);
    // Opposite pads: a half turn about the centre maps one spawn onto the other and
    // reverses the hull's facing.
    const size = ARENA_BOUNDS.maxX;
    expect(first.spawn.xMetres + second.spawn.xMetres).toBeCloseTo(size, 9);
    expect(first.spawn.zMetres + second.spawn.zMetres).toBeCloseTo(size, 9);
    const turn = ((((second.spawn.hullYawDegrees ?? NaN) - (first.spawn.hullYawDegrees ?? NaN)) % 360) + 360) % 360;
    expect(turn).toBeCloseTo(180, 9);
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
    const result = runTeamBatch(arenaTeamSetup(4, 4), {
      seeds: 1,
      aimErrorScale: 0.1,
      onMatchCreated: (state) => {
        // The adapter must map each team's stat, not force one team. A forced
        // `worldDestructionByTeam[0]` makes this test red.
        for (const team of state.teams) {
          state.stats.worldDestructionByTeam[team.id] = 10 + team.id * 10;
        }
      },
    });
    expect(result.matches).toHaveLength(1);
    expect(result.setup.teams).toBe(4);
    expect(result.setup.tanksPerTeam).toBe(4);
    expect(result.characters).toHaveLength(4);
    expect(Object.keys(result.summary.cornerWins)).toHaveLength(4);
    // Each corner carries its assigned team's distinct baseline. A forced team-0
    // mapping collapses every corner to the same value and fails the sorted lower
    // bounds.
    const destroyed = result.corners.map((corner) => corner.cellsDestroyed).sort((a, b) => a - b);
    expect(destroyed[0]).toBeGreaterThanOrEqual(10);
    expect(destroyed[1]).toBeGreaterThanOrEqual(20);
    expect(destroyed[2]).toBeGreaterThanOrEqual(30);
    expect(destroyed[3]).toBeGreaterThanOrEqual(40);
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
