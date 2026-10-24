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
import { CRUCIBLE_CHOICE, describeArenaChoice, validateArenaChoice, type ArenaChoice } from './levels/catalog.ts';
import { ARENA_SIZES, MAX_ARENA_SEED, type ArenaSize } from './levels/generator.ts';

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
  /** The arena: the authored Crucible or a generated one (its own seed and size). */
  readonly arena: ArenaChoice;
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
  arena: CRUCIBLE_CHOICE,
});

/** The size a freshly generated arena starts at. */
export const DEFAULT_ARENA_SIZE: ArenaSize = 'medium';

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
  validateArenaChoice(setup.arena);
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
  if (setup.arena.kind === 'generated') {
    query.set('arena', 'generated');
    query.set('arenaSeed', String(setup.arena.seed));
    query.set('arenaSize', setup.arena.size);
  }
  return query.toString();
}

/** A short label for the title/setup summary, e.g. `4 TEAMS × 4 · 5 MIN`. */
export function describeMatchSetup(setup: MatchSetup): string {
  return `${setup.teams} TEAMS × ${setup.tanksPerTeam} · ${setup.minutes} MIN · ${describeArenaChoice(setup.arena)}`;
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

/** The URL keys that carry the arena choice. */
export const ARENA_QUERY_KEYS: readonly string[] = ['arena', 'arenaSeed', 'arenaSize'];

/**
 * Reads the arena from a launch URL: no `arena` key is the Crucible; `arena=generated`
 * needs `arenaSeed` and takes an optional `arenaSize` (default medium). A malformed value
 * throws; it never quietly becomes the Crucible.
 */
export function arenaChoiceFromQuery(query: URLSearchParams): ArenaChoice {
  const kind = query.get('arena');
  if (kind === null || kind === 'crucible') {
    if (query.has('arenaSeed') || query.has('arenaSize')) {
      throw new Error('matchSetup: ?arenaSeed/?arenaSize need ?arena=generated');
    }
    return CRUCIBLE_CHOICE;
  }
  if (kind !== 'generated') {
    throw new Error(`matchSetup: ?arena must be crucible or generated, got "${kind}"`);
  }
  const seedText = query.get('arenaSeed');
  if (seedText === null || !/^\d+$/.test(seedText)) {
    throw new Error(`matchSetup: ?arena=generated needs ?arenaSeed=0…${MAX_ARENA_SEED}, got "${seedText ?? ''}"`);
  }
  const size = (query.get('arenaSize') ?? DEFAULT_ARENA_SIZE) as ArenaSize;
  return validateArenaChoice({ kind: 'generated', seed: Number(seedText), size });
}

/**
 * Parses what a player typed into the arena seed field: digits only, inside the range.
 * Returns null for anything else, so the screen can show it as invalid and keep START
 * disabled; it never silently becomes another seed.
 */
export function parseArenaSeedText(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const seed = Number(trimmed);
  return seed <= MAX_ARENA_SEED ? seed : null;
}

/** Steps the generated arena's size; the Crucible has no size. */
export function stepArenaSize(setup: MatchSetup, direction: -1 | 1): MatchSetup {
  if (setup.arena.kind !== 'generated') throw new Error('matchSetup: only a generated arena has a size');
  const index = ARENA_SIZES.indexOf(setup.arena.size);
  const size = ARENA_SIZES[Math.max(0, Math.min(ARENA_SIZES.length - 1, index + direction))]!;
  return validateMatchSetup({ ...setup, arena: { ...setup.arena, size } });
}
