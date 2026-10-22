import { describe, expect, it } from 'vitest';
import { runBatchMatches } from '../core/ai.ts';
import { arenaDuelSetup } from './aiBatch.ts';

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
