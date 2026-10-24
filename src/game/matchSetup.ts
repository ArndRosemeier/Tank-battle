/**
 * The ONE description of a custom match: who fights, how many, for how long, on
 * which seed. The setup screen edits it, the URL carries it (so a rematch or a shared
 * link reproduces the same setup), and the sessions are built from it.
 *
 * Game layer: no DOM, no three.js. Every value is validated here, and a bad value
 * throws — it never silently becomes a default.
 */

import { MAX_TANKS_PER_TEAM, MAX_TEAMS } from '../core/sim.ts';
import { STEP_SECONDS } from '../core/timestep.ts';

/** `team` = the player's squad fights; `spectate` = every tank is AI. */
export type MatchSetupMode = 'team' | 'spectate';

export interface MatchSetup {
  readonly mode: MatchSetupMode;
  /** Number of teams, 2…4. */
  readonly teams: number;
  /** Tanks per team, 1…4. In team mode the player is one of them. */
  readonly tanksPerTeam: number;
  /** The time limit in minutes; at the limit the team with the most HP wins. */
  readonly minutes: number;
  /** The match seed. The same setup and seed reproduce the same battle. */
  readonly seed: number;
}

/** The time limits the setup screen offers. */
export const MATCH_MINUTE_CHOICES: readonly number[] = [2, 3, 5, 8, 10];
export const DEFAULT_MATCH_MINUTES = 5;
export const MIN_TEAMS = 2;
export const MIN_TANKS_PER_TEAM = 1;
/** Seeds stay inside the core RNG's accepted range. */
export const MAX_MATCH_SEED = 999_999;

export const DEFAULT_MATCH_SETUP: MatchSetup = Object.freeze({
  mode: 'team',
  teams: MAX_TEAMS,
  tanksPerTeam: MAX_TANKS_PER_TEAM,
  minutes: DEFAULT_MATCH_MINUTES,
  seed: 1,
});

export function validateMatchSetup(setup: MatchSetup): MatchSetup {
  if (setup.mode !== 'team' && setup.mode !== 'spectate') {
    throw new Error(`matchSetup: mode must be team or spectate, got "${String(setup.mode)}"`);
  }
  if (!Number.isInteger(setup.teams) || setup.teams < MIN_TEAMS || setup.teams > MAX_TEAMS) {
    throw new Error(`matchSetup: teams must be an integer ${MIN_TEAMS}…${MAX_TEAMS}, got ${String(setup.teams)}`);
  }
  if (
    !Number.isInteger(setup.tanksPerTeam) ||
    setup.tanksPerTeam < MIN_TANKS_PER_TEAM ||
    setup.tanksPerTeam > MAX_TANKS_PER_TEAM
  ) {
    throw new Error(
      `matchSetup: tanksPerTeam must be an integer ${MIN_TANKS_PER_TEAM}…${MAX_TANKS_PER_TEAM}, got ${String(setup.tanksPerTeam)}`,
    );
  }
  if (!MATCH_MINUTE_CHOICES.includes(setup.minutes)) {
    throw new Error(
      `matchSetup: minutes must be one of ${MATCH_MINUTE_CHOICES.join(', ')}, got ${String(setup.minutes)}`,
    );
  }
  if (!Number.isInteger(setup.seed) || setup.seed < 0 || setup.seed > MAX_MATCH_SEED) {
    throw new Error(`matchSetup: seed must be an integer 0…${MAX_MATCH_SEED}, got ${String(setup.seed)}`);
  }
  return setup;
}

/** The time limit as the core's tick cap. */
export function matchTickCap(setup: MatchSetup): number {
  return Math.round((setup.minutes * 60) / STEP_SECONDS);
}

/** The query string that reproduces this setup (no leading `?`). */
export function matchSetupQuery(setup: MatchSetup): string {
  validateMatchSetup(setup);
  const query = new URLSearchParams({
    mode: setup.mode,
    teams: String(setup.teams),
    tanksPerTeam: String(setup.tanksPerTeam),
    minutes: String(setup.minutes),
    seed: String(setup.seed),
  });
  return query.toString();
}

/** A short label for the title/setup summary, e.g. `4 TEAMS × 4 · 5 MIN`. */
export function describeMatchSetup(setup: MatchSetup): string {
  return `${setup.teams} TEAMS × ${setup.tanksPerTeam} · ${setup.minutes} MIN`;
}

/**
 * A fresh seed for a new match. `random` is injected (the caller passes
 * `Math.random`) so this stays testable and the core never sees a wall-clock source.
 */
export function freshMatchSeed(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`matchSetup: random() must return [0, 1), got ${String(value)}`);
  }
  return Math.floor(value * (MAX_MATCH_SEED + 1));
}

/** Steps a numeric field within its bounds; the setup screen's ◀ ▶ use this. */
export function stepMatchSetup(
  setup: MatchSetup,
  field: 'teams' | 'tanksPerTeam' | 'minutes',
  direction: -1 | 1,
): MatchSetup {
  if (field === 'minutes') {
    const index = MATCH_MINUTE_CHOICES.indexOf(setup.minutes);
    if (index < 0) throw new Error(`matchSetup: unknown minutes ${setup.minutes}`);
    const next = MATCH_MINUTE_CHOICES[Math.max(0, Math.min(MATCH_MINUTE_CHOICES.length - 1, index + direction))]!;
    return validateMatchSetup({ ...setup, minutes: next });
  }
  const [min, max] = field === 'teams' ? [MIN_TEAMS, MAX_TEAMS] : [MIN_TANKS_PER_TEAM, MAX_TANKS_PER_TEAM];
  const next = Math.max(min, Math.min(max, setup[field] + direction));
  return validateMatchSetup({ ...setup, [field]: next });
}
