import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_SETUP,
  MATCH_MINUTE_CHOICES,
  MAX_MATCH_SEED,
  freshMatchSeed,
  matchSetupQuery,
  matchTickCap,
  stepMatchSetup,
  validateMatchSetup,
} from './matchSetup.ts';
import { DEFAULT_MATCH_RULES } from '../core/sim.ts';
import { SpectatorSession } from './spectator.ts';
import { TeamSession } from './teamSession.ts';

describe('the custom match setup', () => {
  it('defaults to the authored 4×4 on the app’s five-minute rule', () => {
    expect(DEFAULT_MATCH_SETUP).toMatchObject({ mode: 'team', teams: 4, tanksPerTeam: 4, minutes: 5 });
    expect(matchTickCap(DEFAULT_MATCH_SETUP)).toBe(DEFAULT_MATCH_RULES.tickCap);
  });

  it('refuses every out-of-range value loudly instead of clamping it', () => {
    const base = DEFAULT_MATCH_SETUP;
    expect(() => validateMatchSetup({ ...base, teams: 1 })).toThrow(/teams/);
    expect(() => validateMatchSetup({ ...base, teams: 5 })).toThrow(/teams/);
    expect(() => validateMatchSetup({ ...base, tanksPerTeam: 0 })).toThrow(/tanksPerTeam/);
    expect(() => validateMatchSetup({ ...base, tanksPerTeam: 2.5 })).toThrow(/tanksPerTeam/);
    expect(() => validateMatchSetup({ ...base, minutes: 4 })).toThrow(/minutes/);
    expect(() => validateMatchSetup({ ...base, seed: -1 })).toThrow(/seed/);
    expect(() => validateMatchSetup({ ...base, seed: MAX_MATCH_SEED + 1 })).toThrow(/seed/);
    expect(() => validateMatchSetup({ ...base, mode: 'duel' as never })).toThrow(/mode/);
  });

  it('steps each field inside its bounds and never past them', () => {
    let setup = { ...DEFAULT_MATCH_SETUP };
    setup = stepMatchSetup(setup, 'teams', 1);
    expect(setup.teams).toBe(4);
    for (let i = 0; i < 5; i += 1) setup = stepMatchSetup(setup, 'teams', -1);
    expect(setup.teams).toBe(2);
    for (let i = 0; i < 5; i += 1) setup = stepMatchSetup(setup, 'tanksPerTeam', -1);
    expect(setup.tanksPerTeam).toBe(1);
    for (let i = 0; i < 9; i += 1) setup = stepMatchSetup(setup, 'minutes', 1);
    expect(setup.minutes).toBe(MATCH_MINUTE_CHOICES[MATCH_MINUTE_CHOICES.length - 1]);
    setup = stepMatchSetup(setup, 'minutes', -1);
    expect(setup.minutes).toBe(MATCH_MINUTE_CHOICES[MATCH_MINUTE_CHOICES.length - 2]);
  });

  it('round-trips through the URL that a rematch or a shared link loads', () => {
    const setup = { mode: 'spectate' as const, teams: 3, tanksPerTeam: 2, minutes: 8, seed: 4242 };
    const query = new URLSearchParams(matchSetupQuery(setup));
    expect(Object.fromEntries(query)).toEqual({
      mode: 'spectate',
      teams: '3',
      tanksPerTeam: '2',
      minutes: '8',
      seed: '4242',
    });
  });

  it('draws fresh seeds inside the accepted range from an injected random source', () => {
    expect(freshMatchSeed(() => 0)).toBe(0);
    expect(freshMatchSeed(() => 0.999999999)).toBe(MAX_MATCH_SEED);
    expect(() => freshMatchSeed(() => 1)).toThrow(/random/);
  });

  it('builds a player match with the chosen team count, squad size and time limit', () => {
    const tickCap = matchTickCap({ ...DEFAULT_MATCH_SETUP, minutes: 2 });
    const session = new TeamSession({
      seed: MAX_MATCH_SEED,
      teams: 3,
      tanksPerTeam: 2,
      rules: { ...DEFAULT_MATCH_RULES, tickCap },
    });
    expect(session.state.teams).toHaveLength(3);
    expect(session.state.teams.every((team) => team.tanks.length === 2)).toBe(true);
    expect(session.squad[0]?.id).toBe(session.playerTankId);
    expect(session.state.rules.tickCap).toBe(7200);
  });

  it('lets a lone player fight with no squadmates', () => {
    const session = new TeamSession({ seed: 3, teams: 2, tanksPerTeam: 1 });
    expect(session.squad).toHaveLength(1);
    expect(session.state.tanks).toHaveLength(2);
  });

  it('gives the spectator the chosen time limit', () => {
    const spectator = new SpectatorSession({
      teams: 2,
      tanksPerTeam: 3,
      seed: 9,
      rules: { ...DEFAULT_MATCH_RULES, tickCap: 600 },
    });
    expect(spectator.state.rules.tickCap).toBe(600);
    expect(spectator.state.tanks).toHaveLength(6);
  });
});
