/**
 * The canonical MATCH-state hash — the witness two runs use to prove they stayed the
 * same run. It extends the A1 approach: a canonical text, sorted by id, hashed by the
 * shared `fnv1a`.
 *
 * It includes every mutable simulation field, including the RNG's internal state and
 * the per-match stats. Positions are quantised to millimetres, angles to microdegrees
 * and shell direction components to 1e-9: a hash is an equality witness, not a
 * measurement. The terrain has its own hash (every sample, falling chunks, the regen clock);
 * including it here keeps every field of both layers in one witness.
 */

import { fnv1a } from '../fnv1a.ts';
import { hashState } from '../world.ts';
import type { MatchState } from './match.ts';

/** An 8-character hex hash of the whole match. */
export function hashMatch(state: MatchState): string {
  const lines: string[] = [
    `match seed=${state.seed} tick=${state.tick} status=${state.status} outcome=${state.outcome ?? '-'} winner=${state.winnerTeamId ?? '-'} nextShell=${state.nextShellId}`,
    `rules tickCap=${state.rules.tickCap} bleed=${state.rules.bleedIntervalTicks}`,
    `rng ${state.rng.state}`,
    `teams ${state.teams.map((team) => `${team.id}:${team.tanks.map((tank) => tank.id).join(',')}`).join(';')}`,
    `world ${hashState(state.world)}`,
    `chunkCauses ${[...state.chunkCauses.entries()].sort((a, b) => a[0] - b[0]).map(([chunk, team]) => `${chunk}:${team}`).join(',')}`,
  ];

  const tanks = [...state.tanks].sort((a, b) => a.id - b.id);
  for (const tank of tanks) {
    lines.push(
      `tank ${tank.id} team=${tank.teamId} index=${tank.teamIndex} ` +
        `x=${millimetres(tank.x)} y=${millimetres(tank.y)} z=${millimetres(tank.z)} vy=${millimetres(tank.verticalSpeed)} ` +
        `hull=${microdegrees(tank.hullYawDegrees)} tilt=${microdegrees(tank.hullPitchDegrees)},${microdegrees(tank.hullRollDegrees)} turret=${microdegrees(tank.turretYawDegrees)} ` +
        `pitch=${microdegrees(tank.aimPitchDegrees)} hp=${tank.hp}/${tank.maxHp} ` +
        `alive=${tank.alive ? 1 : 0} reload=${tank.reloadTicksRemaining} ` +
        `bleed=${tank.bleedTicksRemaining} cause=${tank.deathCause ?? '-'} died=${tank.diedAtTick ?? '-'} ` +
        `killer=${tank.killedByTeamId ?? '-'}`,
    );
  }

  const shells = [...state.shells].sort((a, b) => a.id - b.id);
  for (const shell of shells) {
    lines.push(
      `shell ${shell.id} owner=${shell.ownerTankId} team=${shell.ownerTeamId} ` +
        `x=${millimetres(shell.x)} y=${millimetres(shell.y)} z=${millimetres(shell.z)} ` +
        `dir=${direction(shell.dx)},${direction(shell.dy)},${direction(shell.dz)} ` +
        `travelled=${millimetres(shell.travelledMetres)}`,
    );
  }

  lines.push(
    `stats shots=${state.stats.shotsFired} hits=${state.stats.hits} kills=${state.stats.kills} ` +
      `damage=${state.stats.damageDealt} ticks=${state.stats.ticks} ` +
      `damageByTeam=${[0, 1, 2, 3].map((teamId) => state.stats.damageByTeam[teamId] ?? 0).join(',')} ` +
      `shells=${state.stats.causes.shell} clocks=${state.stats.causes.clock} terrain=${state.stats.causes.terrain} ` +
      `winner=${state.stats.winnerTeamId ?? '-'} outcome=${state.stats.outcome ?? '-'}`,
  );

  return fnv1a(lines.join('\n'));
}

function millimetres(metres: number): number {
  return Math.round(metres * 1000);
}

function microdegrees(degrees: number): number {
  return Math.round(degrees * 1_000_000);
}

function direction(component: number): number {
  return Math.round(component * 1_000_000_000);
}
