/**
 * The kill feed's data half: watch the match for alive→dead transitions and emit one
 * notice per death with the cause and the sim's killer team. Presentation only — it
 * does not touch the match, and it labels no tank as a player in the core.
 *
 * The sim records `Tank.killedByTeamId` when a shell kills; a clock death has no
 * killer. The HUD renders the notices; this module gives them names and ticks.
 */

import type { DeathCause, MatchState } from '../core/sim.ts';

export interface KillNotice {
  readonly tankId: number;
  readonly victimTeamId: number;
  readonly victimTeamIndex: number;
  /** `null` for a clock death (the wound clock has no firing team). */
  readonly killerTeamId: number | null;
  readonly cause: DeathCause;
  readonly tick: number;
}

/** One HUD row's labels, built from the notice and the team/slot naming rule. */
export interface KillFeedRow {
  readonly killerTeamId: number | null;
  readonly killerLabel: string;
  readonly victimTeamId: number;
  readonly victimLabel: string;
  readonly cause: DeathCause;
  readonly tick: number;
}

/**
 * Tracks the tanks' alive flags. It emits only a transition that happens while it is
 * watching, so constructing it on a finished match does not dump its whole history.
 */
function noticeFor(tank: MatchState['tanks'][number], stateTick: number): KillNotice {
  return {
    tankId: tank.id,
    victimTeamId: tank.teamId,
    victimTeamIndex: tank.teamIndex,
    killerTeamId: tank.killedByTeamId,
    cause: tank.deathCause ?? 'shell',
    tick: tank.diedAtTick ?? stateTick,
  };
}

export class KillFeedTracker {
  private readonly alive = new Map<number, boolean>();

  update(state: MatchState): readonly KillNotice[] {
    const notices: KillNotice[] = [];
    for (const tank of state.tanks) {
      const wasAlive = this.alive.get(tank.id);
      if (wasAlive === true && !tank.alive) {
        notices.push(noticeFor(tank, state.tick));
      }
      this.alive.set(tank.id, tank.alive);
    }
    return notices;
  }

  /**
   * The screenshot/live-start case: seed the alive map from the current state and
   * return recent deaths, newest first. A frozen demo still shows the feed it earned
   * before the freeze; a fresh live match returns nothing.
   */
  prime(state: MatchState, lookbackTicks = 420): readonly KillNotice[] {
    const recent: KillNotice[] = [];
    for (const tank of state.tanks) {
      this.alive.set(tank.id, tank.alive);
      if (
        !tank.alive &&
        tank.diedAtTick !== null &&
        state.tick - tank.diedAtTick <= lookbackTicks
      ) {
        recent.push(noticeFor(tank, state.tick));
      }
    }
    recent.sort((a, b) => b.tick - a.tick || a.tankId - b.tankId);
    return recent;
  }
}

/** The feed's naming rule: the player is YOU, squadmates are characters, enemies teams. */
export function describeKill(
  notice: KillNotice,
  characters: readonly string[],
  playerTeamId = 0,
): Omit<KillFeedRow, 'tick'> {
  const victimIsPlayer = notice.victimTeamId === playerTeamId && notice.victimTeamIndex === 0;
  const victimLabel = victimIsPlayer
    ? 'YOU'
    : notice.victimTeamId === playerTeamId
      ? (characters[notice.victimTeamIndex] ?? `SLOT ${notice.victimTeamIndex + 1}`).toUpperCase()
      : `TEAM ${notice.victimTeamId + 1}`;
  if (notice.killerTeamId === null) {
    return {
      killerTeamId: null,
      killerLabel: '—',
      victimTeamId: notice.victimTeamId,
      victimLabel,
      cause: notice.cause,
    };
  }
  const killerIsPlayer = notice.killerTeamId === playerTeamId;
  return {
    killerTeamId: notice.killerTeamId,
    killerLabel: killerIsPlayer ? 'SQUAD' : `TEAM ${notice.killerTeamId + 1}`,
    victimTeamId: notice.victimTeamId,
    victimLabel,
    cause: notice.cause,
  };
}
