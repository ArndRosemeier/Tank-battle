import { describe, expect, it } from 'vitest';
import { describeMatchResult, formatClock, secondsRemaining, teamName } from './matchResult.ts';
import { TeamSession } from './teamSession.ts';
import type { MatchState } from '../core/sim.ts';

function ended(
  state: MatchState,
  winnerTeamId: number | null,
  outcome: 'last-team' | 'tick-cap' | 'draw',
  tick: number,
): MatchState {
  return { ...state, status: 'ended', winnerTeamId, outcome, tick } as MatchState;
}

describe('the end-of-match words', () => {
  const base = new TeamSession({ seed: 1 }).state;

  it('says VICTORY to the winning player and DEFEAT, with the winner, to the loser', () => {
    const won = describeMatchResult(ended(base, 0, 'last-team', 3660), 0);
    expect(won).toEqual({ headline: 'VICTORY', detail: 'LAST TEAM STANDING · 1:01', colorTeamId: 0 });
    const lost = describeMatchResult(ended(base, 2, 'tick-cap', 18000), 0);
    expect(lost.headline).toBe('DEFEAT');
    expect(lost.detail).toBe('MAGENTA WINS · TIME LIMIT · MOST HULL WINS · 5:00');
  });

  it('names the winning team for a spectated match, and calls a draw a draw', () => {
    expect(describeMatchResult(ended(base, 3, 'last-team', 600), null).headline).toBe('LIME WINS');
    expect(describeMatchResult(ended(base, null, 'draw', 600), 0).headline).toBe('DRAW');
  });

  it('refuses to describe a match that is still running', () => {
    expect(() => describeMatchResult(base, 0)).toThrow(/not ended/);
  });

  it('formats the clock and counts down to the time limit', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(305)).toBe('5:05');
    expect(secondsRemaining(base)).toBe(300);
    expect(secondsRemaining({ ...base, tick: base.rules.tickCap + 50 } as MatchState)).toBe(0);
    expect(() => teamName(4)).toThrow(/no name/);
  });
});
