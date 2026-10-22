import { describe, expect, it } from 'vitest';
import { runBatchMatches } from '../core/ai.ts';
import { CELL_SIZE_METRES } from '../core/world.ts';
import { ARENA } from './levels/arena.ts';
import { arenaDuelSetup } from './aiBatch.ts';

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
