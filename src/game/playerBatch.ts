/**
 * The player-team stand-in measurement: the player's tank driven by a scripted vanguard
 * (the `AIController` a squadmate would use), against three AI teams of four. This is
 * the ONE way the player-team mode gets a win rate without a human at the keyboard;
 * human skill is not measured, and the report says so.
 *
 * Renderer-free and clock-free, like the rest of the game layer. The stand-in uses the
 * same seed/phase/aim scale as the real team session, so replacing it with a human
 * input controller is the ONLY difference between this table and play.
 */

import { DEFAULT_MATCH_RULES, type MatchRules } from '../core/sim.ts';
import { AI_PROFILES } from '../core/ai.ts';
import { mean, quantile } from '../core/ai/batchStats.ts';
import { TEAM_MODE_AIM_ERROR_SCALE } from './aiBatch.ts';
import { TeamSession, createVanguardStandIn } from './teamSession.ts';

export interface PlayerTeamBatchOptions {
  /** Number of consecutive seeds to run. */
  readonly seeds: number;
  readonly seedStart?: number;
  /** Profile names by tank slot; slot 0 is the player slot. Defaults the cast. */
  readonly characters?: readonly string[];
  readonly rules?: MatchRules;
  /** Scales the stand-in's aim error; defaults to the team-mode value. */
  readonly aimErrorScale?: number;
}

export interface PlayerTeamBatchMatch {
  readonly seed: number;
  readonly ticks: number;
  readonly winnerTeamId: number | null;
  readonly playerTeamWon: boolean;
  readonly capHit: boolean;
  readonly shotsFired: number;
  readonly hits: number;
  readonly kills: number;
}

export interface PlayerTeamBatchSummary {
  readonly matches: number;
  readonly playerTeamWins: number;
  readonly playerTeamWinRate: number;
  readonly draws: number;
  readonly capHits: number;
  readonly capRate: number;
  readonly length: {
    readonly min: number;
    readonly p25: number;
    readonly median: number;
    readonly p75: number;
    readonly max: number;
    readonly mean: number;
  };
  readonly shotsFired: number;
  readonly hits: number;
  readonly accuracy: number;
  readonly kills: number;
  readonly deathsByCause: Readonly<{ shell: number; clock: number }>;
  readonly teamWins: Readonly<Record<number, number>>;
  readonly teamWinRates: Readonly<Record<number, number>>;
}

export interface PlayerTeamBatchResult {
  readonly setup: {
    readonly mode: 'player-team-stand-in';
    readonly teams: number;
    readonly tanksPerTeam: number;
    readonly playerTeamId: number;
    readonly characters: readonly string[];
    readonly standIn: 'vanguard';
    readonly humanSkillMeasured: false;
  };
  readonly summary: PlayerTeamBatchSummary;
  readonly matches: readonly PlayerTeamBatchMatch[];
}

/**
 * Runs `seeds` player-team matches with the scripted vanguard on the player slot. Every
 * match is the real `TeamSession` — the same physical/team/AI seams play mode uses.
 */
export function runPlayerTeamBatch(
  options: PlayerTeamBatchOptions,
): PlayerTeamBatchResult {
  if (!Number.isInteger(options.seeds) || options.seeds < 1) {
    throw new Error(`playerBatch: seeds must be a positive integer, got ${String(options.seeds)}`);
  }
  const seedStart = options.seedStart ?? 0;
  if (!Number.isInteger(seedStart) || seedStart < 0) {
    throw new Error(`playerBatch: seedStart must be a non-negative integer, got ${String(seedStart)}`);
  }
  if (seedStart + options.seeds > 0xffffffff) {
    throw new Error('playerBatch: seed range must stay inside the 32-bit seed space');
  }
  const characters = [...(options.characters ?? AI_PROFILES.map((profile) => profile.name))];
  const aimErrorScale = options.aimErrorScale ?? TEAM_MODE_AIM_ERROR_SCALE;
  if (!Number.isFinite(aimErrorScale) || aimErrorScale <= 0) {
    throw new Error(`playerBatch: aimErrorScale must be finite and > 0, got ${String(aimErrorScale)}`);
  }
  const rules = options.rules ?? DEFAULT_MATCH_RULES;
  if (!Number.isInteger(rules.tickCap) || rules.tickCap < 1) {
    throw new Error(`playerBatch: rules.tickCap must be a positive integer, got ${String(rules.tickCap)}`);
  }

  const teamWins: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const matches: PlayerTeamBatchMatch[] = [];
  const ticks: number[] = [];
  let playerWins = 0;
  let draws = 0;
  let capHits = 0;
  let shots = 0;
  let hits = 0;
  let kills = 0;
  let shellDeaths = 0;
  let clockDeaths = 0;

  for (let index = 0; index < options.seeds; index += 1) {
    const seed = seedStart + index;
    const session = new TeamSession({
      seed,
      characters,
      rules,
      playerController: createVanguardStandIn(seed, aimErrorScale),
    });
    session.runTicks(rules.tickCap);
    const state = session.state;
    if (state.status !== 'ended') {
      throw new Error(`playerBatch: seed ${seed} did not end by the tick cap`);
    }
    const won = state.winnerTeamId === 0;
    if (won) playerWins += 1;
    if (state.winnerTeamId === null) draws += 1;
    else teamWins[state.winnerTeamId] = (teamWins[state.winnerTeamId] ?? 0) + 1;
    // A cap match can end with an HP/alive winner (`tick-cap`) or a tie (`draw`);
    // both spent the full clock, so the cap-hit definition is the tick count.
    if (state.tick >= rules.tickCap) capHits += 1;
    ticks.push(state.tick);
    shots += state.stats.shotsFired;
    hits += state.stats.hits;
    kills += state.stats.kills;
    shellDeaths += state.stats.causes.shell;
    clockDeaths += state.stats.causes.clock;
    matches.push({
      seed,
      ticks: state.tick,
      winnerTeamId: state.winnerTeamId,
      playerTeamWon: won,
      capHit: state.tick >= rules.tickCap,
      shotsFired: state.stats.shotsFired,
      hits: state.stats.hits,
      kills: state.stats.kills,
    });
  }

  const sorted = [...ticks].sort((a, b) => a - b);
  const total = matches.length;
  return {
    setup: {
      mode: 'player-team-stand-in',
      teams: 4,
      tanksPerTeam: 4,
      playerTeamId: 0,
      characters,
      standIn: 'vanguard',
      humanSkillMeasured: false,
    },
    summary: {
      matches: total,
      playerTeamWins: playerWins,
      playerTeamWinRate: playerWins / total,
      draws,
      capHits,
      capRate: capHits / total,
      length: {
        min: sorted[0] ?? 0,
        p25: quantile(sorted, 0.25),
        median: quantile(sorted, 0.5),
        p75: quantile(sorted, 0.75),
        max: sorted[sorted.length - 1] ?? 0,
        mean: mean(sorted),
      },
      shotsFired: shots,
      hits,
      accuracy: shots === 0 ? 0 : hits / shots,
      kills,
      deathsByCause: { shell: shellDeaths, clock: clockDeaths },
      teamWins,
      teamWinRates: Object.fromEntries(
        Object.entries(teamWins).map(([teamId, wins]) => [teamId, wins / total]),
      ),
    },
    matches,
  };
}
