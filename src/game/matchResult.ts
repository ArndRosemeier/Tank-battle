/**
 * The words on the end-of-match screen and the match clock, derived from the match
 * state. Game layer: no DOM. One place decides what "VICTORY", "DEFEAT" and the time
 * readout say, so the HUD and the end screen can never disagree.
 */

import { STEP_SECONDS } from '../core/timestep.ts';
import type { MatchState } from '../core/sim.ts';

/** Team names in palette order (cyan, orange, magenta, lime). */
export const TEAM_NAMES: readonly string[] = ['CYAN', 'ORANGE', 'MAGENTA', 'LIME'];

export function teamName(teamId: number): string {
  const name = TEAM_NAMES[teamId];
  if (name === undefined) {
    throw new Error(`matchResult: team ${teamId} has no name`);
  }
  return name;
}

export interface MatchResultText {
  /** The big word: VICTORY, DEFEAT, DRAW, or "<TEAM> WINS" for a spectated match. */
  readonly headline: string;
  /** How it ended, in one line. */
  readonly detail: string;
  /** The team whose colour the headline takes; null for a draw. */
  readonly colorTeamId: number | null;
}

/**
 * Describes a finished match. `playerTeamId` is null when nobody played (spectator),
 * which names the winning team instead of VICTORY/DEFEAT.
 */
export function describeMatchResult(state: MatchState, playerTeamId: number | null): MatchResultText {
  if (state.status !== 'ended') {
    throw new Error('matchResult: the match has not ended');
  }
  const winner = state.winnerTeamId;
  const how =
    state.outcome === 'tick-cap'
      ? 'TIME LIMIT · MOST HULL WINS'
      : state.outcome === 'draw'
        ? 'NO TEAM LEFT STANDING'
        : 'LAST TEAM STANDING';
  const seconds = Math.round(state.tick * STEP_SECONDS);
  const detail = `${how} · ${formatClock(seconds)}`;
  if (winner === null) {
    return { headline: 'DRAW', detail, colorTeamId: null };
  }
  if (playerTeamId === null) {
    return { headline: `${teamName(winner)} WINS`, detail, colorTeamId: winner };
  }
  return {
    headline: winner === playerTeamId ? 'VICTORY' : 'DEFEAT',
    detail: winner === playerTeamId ? detail : `${teamName(winner)} WINS · ${detail}`,
    colorTeamId: winner,
  };
}

/** `m:ss` for a non-negative number of whole seconds. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`matchResult: clock seconds must be finite and >= 0, got ${String(seconds)}`);
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Seconds left before the time limit, never negative. */
export function secondsRemaining(state: MatchState): number {
  return Math.max(0, (state.rules.tickCap - state.tick) * STEP_SECONDS);
}
