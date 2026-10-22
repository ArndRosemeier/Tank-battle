import { describe, expect, it } from 'vitest';
import { describeKill } from './killFeed.ts';
import type { KillNotice } from './killFeed.ts';

const CHARACTERS = ['vanguard', 'sniper', 'ambusher', 'brute'] as const;

describe('the kill feed labels', () => {
  it('names a squad kill, a squad loss and a clock death', () => {
    const squadKill: KillNotice = {
      tankId: 9,
      victimTeamId: 2,
      victimTeamIndex: 1,
      killerTeamId: 0,
      cause: 'shell',
      tick: 120,
    };
    expect(describeKill(squadKill, CHARACTERS)).toEqual({
      killerTeamId: 0,
      killerLabel: 'SQUAD',
      victimTeamId: 2,
      victimLabel: 'TEAM 3',
      cause: 'shell',
    });

    const squadLoss: KillNotice = {
      tankId: 1,
      victimTeamId: 0,
      victimTeamIndex: 1,
      killerTeamId: 3,
      cause: 'shell',
      tick: 200,
    };
    expect(describeKill(squadLoss, CHARACTERS)).toEqual({
      killerTeamId: 3,
      killerLabel: 'TEAM 4',
      victimTeamId: 0,
      victimLabel: 'SNIPER',
      cause: 'shell',
    });

    const clock: KillNotice = {
      tankId: 2,
      victimTeamId: 0,
      victimTeamIndex: 2,
      killerTeamId: null,
      cause: 'clock',
      tick: 300,
    };
    expect(describeKill(clock, CHARACTERS)).toMatchObject({
      killerTeamId: null,
      killerLabel: '—',
      victimLabel: 'AMBUSHER',
      cause: 'clock',
    });
  });
});
