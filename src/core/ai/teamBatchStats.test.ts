import { describe, expect, it } from 'vitest';
import { runTeamBatch } from './teamBatch.ts';
import { ARENA } from '../../game/levels/arena.ts';
import { arenaTeamSetup } from '../../game/aiBatch.ts';

describe('team batch character accounting', () => {
  it('attributes each tank to its character slot, not its team id', () => {
    // Two teams with three character slots: team-id attribution incorrectly reports
    // three tanks each for the first two characters and zero for the third.
    const result = runTeamBatch(arenaTeamSetup(2, 3), {
      seeds: 1,
      rules: { tickCap: 60, bleedIntervalTicks: 60 },
    });
    expect(result.characters.map((character) => character.tanks)).toEqual([2, 2, 2]);
    expect(result.characters.map((character) => character.teamAppearances)).toEqual([2, 2, 2]);
    expect(result.characters.reduce((sum, character) => sum + character.deaths, 0))
      .toBeLessThanOrEqual(6);
    expect(ARENA.spawns).toHaveLength(4);
  });
});
