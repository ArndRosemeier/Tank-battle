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
  collectControllerOrders,
  type MatchRules,
  type MatchState,
  type TankSpawn,
  type TeamSpec,
  DEFAULT_MATCH_RULES,
} from '../sim.ts';
import type { WorldSpec } from '../world.ts';
import { STEP_SECONDS } from '../timestep.ts';
import { createRng } from '../rng.ts';
import { AIController } from './controller.ts';
import { hasLineOfSight, eyePosition, targetCentre } from './perception.ts';
import { AI_DECISION_INTERVAL_TICKS } from './constants.ts';
import { AI_PROFILES, getAIProfile, type AIProfile } from './profile.ts';
import { mean, quantile } from './batchStats.ts';
import * as detMath from '../detMath.ts';

export interface TeamSpawnGroup {
  readonly teamId: number;
  readonly spawns: readonly TankSpawn[];
}

export interface TeamSetup {
  readonly level: WorldSpec;
  readonly teams: readonly TeamSpawnGroup[];
  /** Optional seeded facing patterns, indexed by seed and then by corner group. */
  readonly cornerYawPatterns?: readonly (readonly number[])[];
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

/** A deterministic per-seed permutation of team specs, used to rotate tank ids too. */
export function seededAssignmentOrder<T extends { readonly teamId: number }>(
  assignments: readonly T[],
  seed: number,
): readonly T[] {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`seededAssignmentOrder: seed must be a non-negative integer, got ${String(seed)}`);
  }
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const ordered = [...assignments].sort((a, b) => a.teamId - b.teamId);
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const swap = rng.int(index + 1);
    [ordered[index], ordered[swap]] = [ordered[swap]!, ordered[index]!];
  }
  return ordered;
}

/** Shared staging for live teams, spectator, and the headless table. */
export function createTeamMatch(
  setup: TeamSetup,
  seed: number,
  rules: MatchRules = DEFAULT_MATCH_RULES,
  order: 'stable' | 'seeded' = 'stable',
): { readonly state: MatchState; readonly assignments: readonly TeamAssignment[] } {
  validateSetup(setup);
  const groups = [...setup.teams].sort((a, b) => a.teamId - b.teamId);
  const assignments = rotateTeamAssignments(groups, seed);
  const ordered = order === 'seeded' ? seededAssignmentOrder(assignments, seed) : assignments;
  const patterns = setup.cornerYawPatterns;
  if (patterns !== undefined && patterns.length === 0) {
    throw new Error('createTeamMatch: cornerYawPatterns cannot be empty');
  }
  const yawPattern = patterns?.[seed % patterns.length];
  const state = createMatch({
    level: setup.level,
    teams: ordered.map((assignment): TeamSpec => ({
      id: assignment.teamId,
      tanks: assignment.corner.spawns.map((spawn) => ({
        ...spawn,
        hullYawDegrees: yawPattern?.[assignment.corner.teamId] ?? spawn.hullYawDegrees,
      })),
    })),
    seed,
    rules,
  });
  return { state, assignments };
}

/** All modes derive AI seed, phase and profile from the same tank slot. */
export function createTeamAIController(
  tank: { readonly id: number; readonly teamId: number; readonly teamIndex: number },
  profile: AIProfile,
  seed: number,
  aimErrorScale: number,
): AIController {
  return new AIController({
    tankId: tank.id,
    profile,
    seed: teamControllerSeed(seed, tank.teamIndex),
    decisionPhaseTicks: teamDecisionPhase(seed, tank.teamId, tank.teamIndex),
    aimErrorScale,
  });
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
  /** A test seam: called after the match exists but before the first tick. */
  readonly onMatchCreated?: (state: MatchState) => void;
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

export interface TeamCornerDiagnostic {
  readonly cornerId: number;
  readonly matches: number;
  readonly wins: number;
  /** Mean tick of the first eye-to-centre sighting; null when never seen. */
  readonly firstLosMeanTick: number | null;
  readonly firstLosSamples: number;
  readonly distanceFirst600Metres: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly cellsDestroyed: number;
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
  readonly teamWins: number;
  readonly teamAppearances: number;
  readonly teamWinRate: number;
}

export interface TeamBatchResult {
  readonly setup: {
    readonly teams: number;
    readonly tanksPerTeam: number;
    readonly characters: readonly string[];
  };
  readonly summary: TeamBatchSummary;
  readonly characters: readonly TeamCharacterSummary[];
  readonly corners: readonly TeamCornerDiagnostic[];
  /** wins[cornerId][teamId], the cross-tab that tells a dead corner from a weak team. */
  readonly cornerTeamWins: Readonly<Record<number, Readonly<Record<number, number>>>>;
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
  teamWins: number;
  teamAppearances: number;
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

  const cornerTeamWins: Record<number, Record<number, number>> = {};
  for (const team of teams) {
    cornerTeamWins[team.teamId] = {};
    for (const other of teams) cornerTeamWins[team.teamId]![other.teamId] = 0;
  }
  const cornerStats = new Map<number, {
    matches: number;
    wins: number;
    firstLosSum: number;
    firstLosSamples: number;
    distanceFirst600Metres: number;
    damageDealt: number;
    damageTaken: number;
    cellsDestroyed: number;
  }>();
  for (const team of teams) {
    cornerStats.set(team.teamId, {
      matches: 0,
      wins: 0,
      firstLosSum: 0,
      firstLosSamples: 0,
      distanceFirst600Metres: 0,
      damageDealt: 0,
      damageTaken: 0,
      cellsDestroyed: 0,
    });
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
      teamWins: 0,
      teamAppearances: 0,
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
    const { state, assignments } = createTeamMatch(setup, seed, rules, 'seeded');
    options.onMatchCreated?.(state);
    const controllers = new Map<number, AIController>();
    for (const tank of state.tanks) {
      const profile = selectedProfiles[tank.teamIndex];
      if (!profile) {
        throw new Error(
          `runTeamBatch: no character for team ${tank.teamId} slot ${tank.teamIndex}`,
        );
      }
      controllers.set(tank.id, createTeamAIController(tank, profile, seed, aimErrorScale));
    }

    const previousHp = new Map<number, number>();
    const previousAlive = new Map<number, boolean>();
    const distanceFirst600 = new Map<number, number>();
    const firstLos = new Map<number, number>();
    const teamForTank = new Map<number, number>();
    const cornerForTeam = new Map<number, number>();
    for (const assignment of assignments) cornerForTeam.set(assignment.teamId, assignment.corner.teamId);
    for (const tank of state.tanks) {
      previousHp.set(tank.id, tank.hp);
      previousAlive.set(tank.id, tank.alive);
      teamForTank.set(tank.id, tank.teamId);
      distanceFirst600.set(tank.teamId, 0);
    }

    let guard = 0;
    while (state.status === 'active') {
      const before = state.tanks
        .filter((tank) => tank.alive)
        .map((tank) => ({ id: tank.id, x: tank.x, z: tank.z }));
      stepMatch(state, collectControllerOrders(state, controllers, 'runTeamBatch'));
      for (const start of before) {
        const tank = state.tanks.find((candidate) => candidate.id === start.id);
        if (!tank) continue;
        const moved = detMath.hypot(tank.x - start.x, tank.z - start.z);
        totalDistance += moved;
        totalAliveTankTicks += 1;
        if (state.tick <= 600) {
          const teamId = teamForTank.get(tank.id);
          if (teamId !== undefined) {
            distanceFirst600.set(teamId, (distanceFirst600.get(teamId) ?? 0) + moved);
          }
        }
      }
      for (const tank of state.tanks) {
        const character = characterStats.get(selectedProfiles[tank.teamIndex]!.name);
        if (!character) throw new Error('runTeamBatch: character stats disappeared');
        const oldHp = previousHp.get(tank.id);
        if (oldHp === undefined) throw new Error(`runTeamBatch: no previous HP for tank ${tank.id}`);
        if (tank.hp < oldHp) {
          character.damageTaken += oldHp - tank.hp;
          const corner = cornerForTeam.get(tank.teamId);
          if (corner === undefined) throw new Error('runTeamBatch: no corner for tank team');
          const cornerEntry = cornerStats.get(corner);
          if (!cornerEntry) throw new Error('runTeamBatch: corner diagnostics disappeared');
          cornerEntry.damageTaken += oldHp - tank.hp;
        }
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
      for (const assignment of assignments) {
        if (firstLos.has(assignment.teamId)) continue;
        if (teamHasSight(state, assignment.teamId)) {
          firstLos.set(assignment.teamId, state.tick);
        }
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
      character.teamAppearances += 1;
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
    if (state.winnerTeamId !== null) {
      // Mixed teams contain one of each character; one win per character on the
      // winning team. The team/corner rotation makes this a de-rotated rate.
      for (const name of selectedProfiles.map((profile) => profile.name)) {
        const character = characterStats.get(name);
        if (!character) throw new Error('runTeamBatch: character stats disappeared');
        character.teamWins += 1;
      }
    }
    matches.push(match);
    for (const assignment of assignments) {
      const corner = cornerStats.get(assignment.corner.teamId);
      if (!corner) throw new Error('runTeamBatch: corner diagnostics disappeared');
      corner.matches += 1;
      if (winnerCornerId === assignment.corner.teamId) {
        corner.wins += 1;
        if (state.winnerTeamId !== null) {
          cornerTeamWins[assignment.corner.teamId]![state.winnerTeamId] =
            (cornerTeamWins[assignment.corner.teamId]![state.winnerTeamId] ?? 0) + 1;
        }
      }
      const los = firstLos.get(assignment.teamId);
      if (los !== undefined) {
        corner.firstLosSum += los;
        corner.firstLosSamples += 1;
      }
      corner.distanceFirst600Metres += distanceFirst600.get(assignment.teamId) ?? 0;
      corner.damageDealt += state.stats.damageByTeam[assignment.teamId] ?? 0;
      corner.cellsDestroyed += state.stats.worldDestructionByTeam[assignment.teamId] ?? 0;
    }
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
    cornerTeamWins,
    corners: [...cornerStats.entries()].map(([cornerId, stats]) => ({
      cornerId,
      matches: stats.matches,
      wins: stats.wins,
      firstLosMeanTick: stats.firstLosSamples === 0 ? null : stats.firstLosSum / stats.firstLosSamples,
      firstLosSamples: stats.firstLosSamples,
      distanceFirst600Metres: stats.distanceFirst600Metres,
      damageDealt: stats.damageDealt,
      damageTaken: stats.damageTaken,
      cellsDestroyed: stats.cellsDestroyed,
    })),
    characters: [...characterStats.entries()].map(([name, stats]) => ({
      name,
      tanks: stats.tanks,
      aliveAtEnd: stats.aliveAtEnd,
      deaths: stats.deaths,
      shellDeaths: stats.shellDeaths,
      clockDeaths: stats.clockDeaths,
      damageTaken: stats.damageTaken,
      hpRemaining: stats.hpRemaining,
      teamWins: stats.teamWins,
      teamAppearances: stats.teamAppearances,
      teamWinRate: stats.teamAppearances === 0 ? 0 : stats.teamWins / stats.teamAppearances,
    })),
    matches,
  };
}

function teamHasSight(state: MatchState, teamId: number): boolean {
  for (const tank of state.tanks) {
    if (!tank.alive || tank.teamId !== teamId) continue;
    const eye = eyePosition(tank);
    for (const enemy of state.tanks) {
      if (!enemy.alive || enemy.teamId === teamId) continue;
      if (hasLineOfSight(state.world, eye, targetCentre(enemy))) return true;
    }
  }
  return false;
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
export function teamControllerSeed(seed: number, teamIndex: number): number {
  return (seed + Math.imul(teamIndex + 1, 0x9e3779b9)) >>> 0;
}

/** The one team decision phase; team id and tank slot both break the action-order tie. */
export function teamDecisionPhase(seed: number, teamId: number, teamIndex: number): number {
  return (seed + teamId * 5 + teamIndex) % AI_DECISION_INTERVAL_TICKS;
}
