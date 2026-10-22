/**
 * The per-match counters the batch rig will consume. This is the ONE stats shape:
 * a test, the HUD (A3c/A5) and the future batch runner read the same object.
 *
 * Definitions matter, so they are explicit:
 *  - `shotsFired` — trigger pulls that spent the reload: a shell spawned, or a swept
 *    muzzle obstruction that consumed the shot (holding fire while reloading does not
 *    count);
 *  - `hits` — shells or swept-muzzle shots that DAMAGED an enemy tank (a teammate's
 *    body is not a hit, and a wall/block hit is not a tank hit);
 *  - `kills` — tanks killed by a shell or a muzzle hit;
 *  - `damageDealt` — HP removed from tanks by shells/muzzle shots (clock damage is not
 *    "dealt");
 *  - `causes` — where every tank death came from; `kills` equals `causes.shell`.
 */

/** How a tank died. The owner's clock is a real kill path (Q1). */
export type DeathCause = 'shell' | 'clock';

/** Why the match stopped. A tick-cap tie is a draw, not a winner. */
export type MatchOutcome = 'last-team' | 'tick-cap' | 'draw';

export interface MatchStats {
  shotsFired: number;
  hits: number;
  kills: number;
  damageDealt: number;
  /** The tick the match has reached; mirrors `MatchState.tick`. */
  ticks: number;
  /** Deaths by cause. `shell + clock` equals the number of dead tanks. */
  readonly causes: Record<DeathCause, number>;
  winnerTeamId: number | null;
  outcome: MatchOutcome | null;
}

/** A fresh all-zero stats object. Every field is mutated by the simulation. */
export function createMatchStats(): MatchStats {
  return {
    shotsFired: 0,
    hits: 0,
    kills: 0,
    damageDealt: 0,
    ticks: 0,
    causes: { shell: 0, clock: 0 },
    winnerTeamId: null,
    outcome: null,
  };
}
