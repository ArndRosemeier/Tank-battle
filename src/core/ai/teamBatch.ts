/**
 * The 4-team batch rig: the same real `createMatch` / `stepMatch` / `AIController`
 * seams as the 1v1 batch, but with same-sized teams of up to four tanks. It exists
 * because a 1v1 table cannot answer whether the corner spawns are fair once four
 * teams and sixteen tanks share the arena.
 *
 * The character assignment is by TANK SLOT within a team and is identical on every
 * team, so the comparison between corners is a comparison of the same cast. The rig
 * is renderer-free and clock-free; the CLI is the only place that reads the authored
 * arena.
 */

import {
  createMatch,
  stepMatch,
  type MatchRules,
  type TankCommandOrder,
  type TankSpawn,
  type TeamSpec,
  DEFAULT_MATCH_RULES,
} from '../sim.ts';
import type { WorldSpec } from '../world.ts';
import { STEP_SECONDS } from '../timestep.ts';
import { AIController } from './controller.ts';
import { AI_DECISION_INTERVAL_TICKS } from './constants.ts';
import { AI_PROFILES, getAIProfile, type AIProfile } from './profile.ts';

export interface TeamSpawnGroup {
  readonly teamId: number;
  readonly spawns: readonly TankSpawn[];
}

export interface TeamSetup {
  readonly level: WorldSpec;
  readonly teams: readonly TeamSpawnGroup[];
}

export interface TeamAssignment {
  /** The team id that owns the tanks. */
  readonly teamId: number;
  /** The corner spawn group those tanks start from this seed. */
  readonly corner: TeamSpawnGroup;
}

/** Rotates which team starts on which corner, so over a seed set every team sees every corner. */
export function rotateTeamAssignments(
  teams: readonly TeamSpawnGroup[],
  seed: number,
): readonly TeamAssignment[] {
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error('rotateTeamAssignments: teams must be a non-empty array');
  }
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`rotateTeamAssignments: seed must be a non-negative integer, got ${String(seed)}`);
  }
  const rotation = seed % teams.length;
  return teams.map((team, slot) => ({
    teamId: team.teamId,
    corner: teams[(slot + rotation) % teams.length]!,
  }));
}

export interface TeamBatchOptions {
  /** Number of consecutive seeds to run. */
  readonly seeds: number;
  /** Profile names by tank slot; one name per tank in a team. Default the cast. */
  readonly characters?: readonly string[];
  readonly seedStart?: number;
  /** Scales the profile's aim error; 1 is the 1v1 tuning, lower is more accurate. */
  readonly aimErrorScale?: number;
  readonly rules?: MatchRules;
}

export interface TeamBatchMatch {
  readonly seed: number;
  readonly ticks: number;
  readonly winnerTeamId: number | null;
  /** The spawn group (corner) the winning team was assigned to this seed. */
  readonly winnerCornerId: number | null;
  readonly capHit: boolean;
  readonly shotsFired: number;
  readonly hits: number;
  readonly kills: number;
  readonly damageDealt: number;
  readonly causes: Readonly<{ shell: number; clock: number }>;
}

export interface TeamLengthSummary {
  readonly min: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly max: number;
  readonly mean: number;
}

export interface TeamBatchSummary {
  readonly matches: number;
  readonly draws: number;
  readonly teamWins: Readonly<Record<number, number>>;
  readonly teamWinRates: Readonly<Record<number, number>>;
  /** Wins by the four corner spawn groups, independent of team id. */
  readonly cornerWins: Readonly<Record<number, number>>;
  readonly cornerWinRates: Readonly<Record<number, number>>;
  readonly length: TeamLengthSummary;
  readonly capHits: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly accuracy: number;
  readonly kills: number;
  readonly damageDealt: number;
  readonly deathsByCause: Readonly<{ shell: number; clock: number }>;
  readonly meanSpeedMetresPerSecond: number;
}

export interface TeamCharacterSummary {
  readonly name: string;
  /** Tank appearances across all matches (teams × matches). */
  readonly tanks: number;
  readonly aliveAtEnd: number;
  readonly deaths: number;
  readonly shellDeaths: number;
  readonly clockDeaths: number;
  readonly damageTaken: number;
  readonly hpRemaining: number;
}

export interface TeamBatchResult {
  readonly setup: {
    readonly teams: number;
    readonly tanksPerTeam: number;
    readonly characters: readonly string[];
  };
  readonly summary: TeamBatchSummary;
  readonly characters: readonly TeamCharacterSummary[];
  readonly matches: readonly TeamBatchMatch[];
}

interface MutableCharacter {
  tanks: number;
  aliveAtEnd: number;
  deaths: number;
  shellDeaths: number;
  clockDeaths: number;
  damageTaken: number;
  hpRemaining: number;
}

/**
 * Runs same-sized team matches. Every team gets the same character list by slot, and
 * every tank gets a deterministic controller seed and decision phase.
 */
export function runTeamBatch(setup: TeamSetup, options: TeamBatchOptions): TeamBatchResult {
  validateSetup(setup);
  if (!Number.isInteger(options.seeds) || options.seeds < 1) {
    throw new Error(`runTeamBatch: seeds must be a positive integer, got ${String(options.seeds)}`);
  }
  const seedStart = options.seedStart ?? 0;
  if (!Number.isInteger(seedStart) || seedStart < 0 || !Number.isSafeInteger(seedStart + options.seeds - 1)) {
    throw new Error(`runTeamBatch: seed range is invalid (start ${String(seedStart)}, count ${options.seeds})`);
  }
  if (seedStart + options.seeds > 0x1_0000_0000) {
    throw new Error('runTeamBatch: seed range must stay inside the 32-bit seed space');
  }

  const tanksPerTeam = setup.teams[0]!.spawns.length;
  const characterNames = [...(options.characters ?? AI_PROFILES.map((profile) => profile.name))];
  if (characterNames.length < tanksPerTeam) {
    throw new Error(
      `runTeamBatch: ${characterNames.length} characters cannot fill ${tanksPerTeam} tanks per team`,
    );
  }
  if (new Set(characterNames).size !== characterNames.length) {
    throw new Error('runTeamBatch: character names must be unique');
  }
  const profiles: AIProfile[] = characterNames.map((name) => getAIProfile(name));
  const selectedProfiles = profiles.slice(0, tanksPerTeam);
  const aimErrorScale = options.aimErrorScale ?? 1;
  if (!Number.isFinite(aimErrorScale) || aimErrorScale <= 0) {
    throw new Error(`runTeamBatch: aimErrorScale must be finite and > 0, got ${String(aimErrorScale)}`);
  }
  const rules = options.rules ?? DEFAULT_MATCH_RULES;
  const teams = [...setup.teams].sort((a, b) => a.teamId - b.teamId);

  const teamWins: Record<number, number> = {};
  const cornerWins: Record<number, number> = {};
  for (const team of teams) {
    teamWins[team.teamId] = 0;
    cornerWins[team.teamId] = 0;
  }

  const characterStats = new Map<string, MutableCharacter>();
  for (const name of characterNames.slice(0, tanksPerTeam)) {
    characterStats.set(name, {
      tanks: 0,
      aliveAtEnd: 0,
      deaths: 0,
      shellDeaths: 0,
      clockDeaths: 0,
      damageTaken: 0,
      hpRemaining: 0,
    });
  }

  const matches: TeamBatchMatch[] = [];
  let draws = 0;
  let totalShots = 0;
  let totalHits = 0;
  let totalKills = 0;
  let totalDamage = 0;
  let totalShellDeaths = 0;
  let totalClockDeaths = 0;
  let totalDistance = 0;
  let totalAliveTankTicks = 0;

  for (let offset = 0; offset < options.seeds; offset += 1) {
    const seed = seedStart + offset;
    // Rotate the team-to-corner assignment with the seed. Fixed assignments made a
    // corner pair win nearly every match in the first four-team runs; rotating keeps
    // each team on each corner over a seed set while the corner table still exposes a
    // genuinely favoured corner.
    const assignments = rotateTeamAssignments(teams, seed);
    const state = createMatch({
      level: setup.level,
      teams: assignments.map((assignment): TeamSpec => ({
        id: assignment.teamId,
        tanks: [...assignment.corner.spawns],
      })),
      seed,
      rules,
    });
    const controllers = new Map<number, AIController>();
    for (const tank of state.tanks) {
      const profile = selectedProfiles[tank.teamIndex];
      if (!profile) {
        throw new Error(
          `runTeamBatch: no character for team ${tank.teamId} slot ${tank.teamIndex}`,
        );
      }
      controllers.set(
        tank.id,
        new AIController({
          tankId: tank.id,
          profile,
          seed: teamControllerSeed(seed, tank.id),
          decisionPhaseTicks: teamDecisionPhase(seed, tank.teamId, tank.teamIndex),
          aimErrorScale,
        }),
      );
    }

    const previousHp = new Map<number, number>();
    const previousAlive = new Map<number, boolean>();
    for (const tank of state.tanks) {
      previousHp.set(tank.id, tank.hp);
      previousAlive.set(tank.id, tank.alive);
    }

    let guard = 0;
    while (state.status === 'active') {
      const before = state.tanks
        .filter((tank) => tank.alive)
        .map((tank) => ({ id: tank.id, x: tank.x, z: tank.z }));
      const orders: TankCommandOrder[] = [];
      for (const tank of state.tanks) {
        if (!tank.alive) continue;
        const controller = controllers.get(tank.id);
        if (!controller) throw new Error(`runTeamBatch: no controller for tank ${tank.id}`);
        orders.push({ tankId: tank.id, command: controller.commandFor(state, tank.id) });
      }
      stepMatch(state, orders);
      for (const start of before) {
        const tank = state.tanks.find((candidate) => candidate.id === start.id);
        if (!tank) continue;
        totalDistance += Math.hypot(tank.x - start.x, tank.z - start.z);
        totalAliveTankTicks += 1;
      }
      for (const tank of state.tanks) {
        const character = characterStats.get(selectedProfiles[tank.teamIndex]!.name);
        if (!character) throw new Error('runTeamBatch: character stats disappeared');
        const oldHp = previousHp.get(tank.id);
        if (oldHp === undefined) throw new Error(`runTeamBatch: no previous HP for tank ${tank.id}`);
        if (tank.hp < oldHp) character.damageTaken += oldHp - tank.hp;
        const wasAlive = previousAlive.get(tank.id) ?? true;
        if (wasAlive && !tank.alive) {
          character.deaths += 1;
          if (tank.deathCause === 'clock') character.clockDeaths += 1;
          else if (tank.deathCause === 'shell') character.shellDeaths += 1;
          else throw new Error(`runTeamBatch: tank ${tank.id} died without a cause`);
        }
        previousHp.set(tank.id, tank.hp);
        previousAlive.set(tank.id, tank.alive);
      }
      guard += 1;
      if (guard > rules.tickCap + 1) {
        throw new Error(`runTeamBatch: seed ${seed} exceeded the tick cap guard`);
      }
    }

    for (const tank of state.tanks) {
      const character = characterStats.get(selectedProfiles[tank.teamIndex]!.name);
      if (!character) throw new Error('runTeamBatch: character stats disappeared');
      character.tanks += 1;
      if (tank.alive) {
        character.aliveAtEnd += 1;
        character.hpRemaining += tank.hp;
      }
    }

    const winnerAssignment =
      state.winnerTeamId === null
        ? null
        : assignments.find((assignment) => assignment.teamId === state.winnerTeamId) ?? null;
    const winnerCornerId = winnerAssignment?.corner.teamId ?? null;
    const match: TeamBatchMatch = {
      seed,
      ticks: state.tick,
      winnerTeamId: state.winnerTeamId,
      winnerCornerId,
      capHit: state.tick >= rules.tickCap,
      shotsFired: state.stats.shotsFired,
      hits: state.stats.hits,
      kills: state.stats.kills,
      damageDealt: state.stats.damageDealt,
      causes: { ...state.stats.causes },
    };
    matches.push(match);
    totalShots += match.shotsFired;
    totalHits += match.hits;
    totalKills += match.kills;
    totalDamage += match.damageDealt;
    totalShellDeaths += match.causes.shell;
    totalClockDeaths += match.causes.clock;
    if (match.winnerTeamId === null) {
      draws += 1;
    } else {
      teamWins[match.winnerTeamId] = (teamWins[match.winnerTeamId] ?? 0) + 1;
      if (winnerCornerId !== null) {
        cornerWins[winnerCornerId] = (cornerWins[winnerCornerId] ?? 0) + 1;
      }
    }
  }

  const ticks = matches.map((match) => match.ticks).sort((a, b) => a - b);
  const teamWinRates: Record<number, number> = {};
  const cornerWinRates: Record<number, number> = {};
  for (const team of teams) {
    teamWinRates[team.teamId] = (teamWins[team.teamId] ?? 0) / matches.length;
    cornerWinRates[team.teamId] = (cornerWins[team.teamId] ?? 0) / matches.length;
  }
  // Every tank contributes its alive ticks; sum the per-match alive-tank ticks once.
  const meanSpeed = totalAliveTankTicks === 0 ? 0 : totalDistance / (totalAliveTankTicks * STEP_SECONDS);

  return {
    setup: {
      teams: teams.length,
      tanksPerTeam,
      characters: selectedProfiles.map((profile) => profile.name),
    },
    summary: {
      matches: matches.length,
      draws,
      teamWins,
      teamWinRates,
      cornerWins,
      cornerWinRates,
      length: {
        min: ticks[0] ?? 0,
        p25: quantile(ticks, 0.25),
        median: quantile(ticks, 0.5),
        p75: quantile(ticks, 0.75),
        max: ticks[ticks.length - 1] ?? 0,
        mean: mean(ticks),
      },
      capHits: matches.filter((match) => match.capHit).length,
      shotsFired: totalShots,
      hits: totalHits,
      accuracy: totalShots === 0 ? 0 : totalHits / totalShots,
      kills: totalKills,
      damageDealt: totalDamage,
      deathsByCause: { shell: totalShellDeaths, clock: totalClockDeaths },
      meanSpeedMetresPerSecond: meanSpeed,
    },
    characters: [...characterStats.entries()].map(([name, stats]) => ({
      name,
      tanks: stats.tanks,
      aliveAtEnd: stats.aliveAtEnd,
      deaths: stats.deaths,
      shellDeaths: stats.shellDeaths,
      clockDeaths: stats.clockDeaths,
      damageTaken: stats.damageTaken,
      hpRemaining: stats.hpRemaining,
    })),
    matches,
  };
}

function validateSetup(setup: TeamSetup): void {
  if (setup === null || typeof setup !== 'object') throw new Error('runTeamBatch: setup must be an object');
  if (!Array.isArray(setup.teams) || setup.teams.length < 2 || setup.teams.length > 4) {
    throw new Error('runTeamBatch: setup needs 2…4 teams');
  }
  const ids = new Set<number>();
  let tankCount: number | null = null;
  for (const team of setup.teams) {
    if (!Number.isInteger(team.teamId) || team.teamId < 0) {
      throw new Error(`runTeamBatch: team id must be a non-negative integer, got ${String(team.teamId)}`);
    }
    if (ids.has(team.teamId)) throw new Error(`runTeamBatch: team ${team.teamId} appears twice`);
    ids.add(team.teamId);
    if (!Array.isArray(team.spawns) || team.spawns.length < 1 || team.spawns.length > 4) {
      throw new Error(`runTeamBatch: team ${team.teamId} needs 1…4 tanks`);
    }
    if (tankCount === null) tankCount = team.spawns.length;
    if (team.spawns.length !== tankCount) {
      throw new Error('runTeamBatch: every team must have the same number of tanks');
    }
  }
}

/** The one deterministic controller seed for a team-mode tank. */
export function teamControllerSeed(seed: number, tankId: number): number {
  return (seed + Math.imul(tankId + 1, 0x9e3779b9)) >>> 0;
}

/** The one team decision phase; team id and tank slot both break the action-order tie. */
export function teamDecisionPhase(seed: number, teamId: number, teamIndex: number): number {
  return (seed + teamId * 5 + teamIndex) % AI_DECISION_INTERVAL_TICKS;
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error('runTeamBatch: quantile of an empty list');
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? sorted[0]!;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('runTeamBatch: mean of an empty list');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
