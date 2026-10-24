/**
 * Game-layer batch adapters: the authored arena's duel stagings, the signature metrics
 * and the character round-robin. The AI core stays generic; this file owns the arena
 * choices and the measurement shape the owner compares slices with.
 */

import {
  createMatch,
  DEFAULT_MATCH_RULES,
  stepMatch,
  type TankCommandOrder,
} from '../core/sim.ts';
import { STEP_SECONDS } from '../core/timestep.ts';
import {
  AIController,
  hasLineOfSight,
  eyePosition,
  targetCentre,
  getAIProfile,
  AI_PROFILES,
} from '../core/ai.ts';
import type { BatchSetup, TeamSetup } from '../core/ai.ts';
import { ARENA, spawnCentreMetres } from './levels/arena.ts';
import { validateLevel, type LevelSpawn } from './levels/format.ts';
import * as detMath from '../core/detMath.ts';

function spawnFor(teamId: number): LevelSpawn {
  const spawn = ARENA.spawns.find((candidate) => candidate.teamId === teamId);
  if (!spawn) throw new Error(`aiBatch: the arena has no spawn for team ${teamId}`);
  return spawn;
}

/**
 * A symmetric 1v1 duel staging: the two tanks start on opposite corner pads (teams 0
 * and 2's front slots), so the hill and two ridges stand between them.
 */
export function arenaDuelSetup(): BatchSetup {
  validateLevel(ARENA);
  const a = spawnFor(0);
  const b = spawnFor(2);
  return {
    level: ARENA.terrain,
    spawns: [
      { teamId: 0, spawn: { xMetres: a.slots[0]!.xMetres, zMetres: a.slots[0]!.zMetres, hullYawDegrees: a.yawDegrees } },
      { teamId: 1, spawn: { xMetres: b.slots[0]!.xMetres, zMetres: b.slots[0]!.zMetres, hullYawDegrees: b.yawDegrees } },
    ],
  };
}

/**
 * The team-mode aim-error scale. Sixteen tanks firing at the 1v1 spread turned a
 * four-team match into a wall-hitting cap; 0.09 keeps the cast's relative accuracy
 * while the 4×4 battle resolves. The spectator, the player's squadmates, the enemy
 * teams and the stand-in all use this ONE value.
 */
export const TEAM_MODE_AIM_ERROR_SCALE = 0.09;

/**
 * The corner-pad team setup: each team fills the first `tanksPerTeam` slots of its own
 * pad, facing the centre. The pads are rotations of one another, so no corner has a
 * geometric advantage.
 */
export function arenaTeamSetup(teams = 4, tanksPerTeam = 4): TeamSetup {
  validateLevel(ARENA);
  if (!Number.isInteger(teams) || teams < 2 || teams > 4) {
    throw new Error(`arenaTeamSetup: teams must be 2…4, got ${String(teams)}`);
  }
  if (!Number.isInteger(tanksPerTeam) || tanksPerTeam < 1 || tanksPerTeam > 4) {
    throw new Error(`arenaTeamSetup: tanksPerTeam must be 1…4, got ${String(tanksPerTeam)}`);
  }
  const selected = [...ARENA.spawns].sort((a, b) => a.teamId - b.teamId).slice(0, teams);
  const groups = selected.map((spawn) => ({
    teamId: spawn.teamId,
    spawns: spawn.slots.slice(0, tanksPerTeam).map((slot) => ({
      xMetres: slot.xMetres,
      zMetres: slot.zMetres,
      hullYawDegrees: spawn.yawDegrees,
    })),
  }));
  return { level: ARENA.terrain, teams: groups };
}

/** Validates the arena and returns one one-tank spawn per authored team. */
export function arenaBatchSetup(): BatchSetup {
  validateLevel(ARENA);
  return {
    level: ARENA.terrain,
    spawns: ARENA.spawns.map((spawn) => {
      const centre = spawnCentreMetres(spawn);
      return {
        teamId: spawn.teamId,
        spawn: {
          xMetres: centre.xMetres,
          zMetres: centre.zMetres,
          hullYawDegrees: spawn.yawDegrees,
        },
      };
    }),
  };
}

/** One character's per-match signature contribution. */
export interface CharacterMatchStats {
  readonly character: string;
  readonly teamId: number;
  readonly won: boolean;
  readonly engagementDistanceMetres: number | null;
  readonly engagementSamples: number;
  readonly worldDamage: number;
  readonly outOfLosTicks: number;
  readonly aliveTicks: number;
  readonly distanceMovedMetres: number;
  readonly meanSpeedMetresPerSecond: number;
}

export interface CharacterMatch {
  readonly seed: number;
  readonly ticks: number;
  readonly winnerTeamId: number | null;
  readonly characters: readonly CharacterMatchStats[];
}

export interface CharacterSignature {
  readonly name: string;
  readonly matches: number;
  readonly wins: number;
  readonly draws: number;
  readonly winRate: number;
  readonly engagementDistanceMetres: number | null;
  readonly worldDamagePerMatch: number;
  readonly outOfLosShare: number;
  readonly meanSpeedMetresPerSecond: number;
  readonly signatureDeltas: {
    readonly engagementDistance: number;
    readonly worldDamage: number;
    readonly outOfLos: number;
    readonly speed: number;
  };
}

export interface RoundRobinResult {
  readonly seedsPerPairing: number;
  readonly seedsPerOrientation: number;
  readonly characters: readonly string[];
  readonly matrix: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly matrixMatches: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly draws: number;
  readonly signatures: readonly CharacterSignature[];
  readonly medianSignature: {
    readonly engagementDistanceMetres: number;
    readonly worldDamagePerMatch: number;
    readonly outOfLosShare: number;
    readonly meanSpeedMetresPerSecond: number;
  };
}

/**
 * Runs one 1v1 with a different profile per team. The signature metrics sample every
 * tick: distance when the tank has line of sight to a live enemy, out-of-LOS ticks,
 * distance moved, and the world damage attributed to its team by the sim.
 */
function runCharacterMatch(
  seed: number,
  teamCharacters: readonly [string, string],
): CharacterMatch {
  const setup = arenaDuelSetup();
  const profiles = teamCharacters.map((name) => getAIProfile(name));
  const state = createMatch({
    level: setup.level,
    teams: setup.spawns.map((spawn) => ({
      id: spawn.teamId,
      tanks: [spawn.spawn],
    })),
    seed,
    rules: DEFAULT_MATCH_RULES,
  });
  const controllers = new Map<number, AIController>();
  for (const tank of state.tanks) {
    const profile = profiles[tank.teamId];
    if (!profile) throw new Error(`runCharacterMatch: no profile for team ${tank.teamId}`);
    const phase = (seed + tank.teamId * 3) % 6;
    controllers.set(
      tank.id,
      new AIController({
        tankId: tank.id,
        profile,
        seed: (seed + Math.imul(tank.teamId + 1, 0x9e3779b9)) >>> 0,
        decisionPhaseTicks: phase,
      }),
    );
  }
  const charStats = new Map<number, {
    character: string;
    teamId: number;
    engagementSum: number;
    engagementSamples: number;
    outOfLosTicks: number;
    aliveTicks: number;
    distanceMoved: number;
  }>();
  for (const tank of state.tanks) {
    charStats.set(tank.id, {
      character: teamCharacters[tank.teamId]!,
      teamId: tank.teamId,
      engagementSum: 0,
      engagementSamples: 0,
      outOfLosTicks: 0,
      aliveTicks: 0,
      distanceMoved: 0,
    });
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
      if (!controller) throw new Error(`runCharacterMatch: no controller for tank ${tank.id}`);
      orders.push({ tankId: tank.id, command: controller.commandFor(state, tank.id) });
    }
    stepMatch(state, orders);
    guard += 1;
    if (guard > state.rules.tickCap + 1) throw new Error('runCharacterMatch: tick cap guard');

    for (const tank of state.tanks) {
      if (!tank.alive) continue;
      const stats = charStats.get(tank.id);
      if (!stats) throw new Error(`runCharacterMatch: no stats for tank ${tank.id}`);
      const start = before.find((entry) => entry.id === tank.id);
      if (start) stats.distanceMoved += detMath.hypot(tank.x - start.x, tank.z - start.z);
      stats.aliveTicks += 1;

      const eye = eyePosition(tank);
      let nearestVisible: number | null = null;
      for (const enemy of state.tanks) {
        if (!enemy.alive || enemy.teamId === tank.teamId) continue;
        if (hasLineOfSight(state.world, eye, targetCentre(enemy))) {
          const distance = detMath.hypot(tank.x - enemy.x, tank.z - enemy.z);
          if (nearestVisible === null || distance < nearestVisible) nearestVisible = distance;
        }
      }
      if (nearestVisible === null) {
        stats.outOfLosTicks += 1;
      } else {
        stats.engagementSum += nearestVisible;
        stats.engagementSamples += 1;
      }
    }
  }

  const characters: CharacterMatchStats[] = [...charStats.values()].map((stats) => ({
    character: stats.character,
    teamId: stats.teamId,
    won: state.winnerTeamId === stats.teamId,
    engagementDistanceMetres:
      stats.engagementSamples === 0 ? null : stats.engagementSum / stats.engagementSamples,
    engagementSamples: stats.engagementSamples,
    worldDamage: state.stats.worldDestructionByTeam[stats.teamId] ?? 0,
    outOfLosTicks: stats.outOfLosTicks,
    aliveTicks: stats.aliveTicks,
    distanceMovedMetres: stats.distanceMoved,
    meanSpeedMetresPerSecond:
      stats.aliveTicks === 0 ? 0 : stats.distanceMoved / (stats.aliveTicks * STEP_SECONDS),
  }));
  return {
    seed,
    ticks: state.tick,
    winnerTeamId: state.winnerTeamId,
    characters,
  };
}

/**
 * The full round robin: every unordered character pairing, each both ways. A pairing
 * gets 200 matches in total (100 per orientation), so 6 pairings × 200 = 1200 matches.
 */
export function runRoundRobin(seedsPerPairing = 200): RoundRobinResult {
  if (!Number.isInteger(seedsPerPairing) || seedsPerPairing < 2 || seedsPerPairing % 2 !== 0) {
    throw new Error(`runRoundRobin: seedsPerPairing must be an even integer >= 2, got ${String(seedsPerPairing)}`);
  }
  const characters = AI_PROFILES.map((profile) => profile.name);
  const seedsPerOrientation = seedsPerPairing / 2;
  const matrix: Record<string, Record<string, number>> = {};
  const matrixMatches: Record<string, Record<string, number>> = {};
  const draws = new Map<string, number>();
  for (const row of characters) {
    matrix[row] = {};
    matrixMatches[row] = {};
    for (const col of characters) {
      matrix[row]![col] = 0;
      matrixMatches[row]![col] = 0;
    }
  }
  const aggregate = new Map<string, {
    matches: number;
    wins: number;
    draws: number;
    engagementSum: number;
    engagementSamples: number;
    worldDamage: number;
    outOfLosTicks: number;
    aliveTicks: number;
    distanceMoved: number;
  }>();
  for (const name of characters) {
    aggregate.set(name, {
      matches: 0,
      wins: 0,
      draws: 0,
      engagementSum: 0,
      engagementSamples: 0,
      worldDamage: 0,
      outOfLosTicks: 0,
      aliveTicks: 0,
      distanceMoved: 0,
    });
  }

  const record = (match: CharacterMatch): void => {
    const team0 = match.characters.find((entry) => entry.teamId === 0);
    const team1 = match.characters.find((entry) => entry.teamId === 1);
    if (!team0 || !team1) throw new Error('runRoundRobin: a match lost a team');
    for (const entry of match.characters) {
      const stats = aggregate.get(entry.character);
      if (!stats) throw new Error(`runRoundRobin: no aggregate for ${entry.character}`);
      stats.matches += 1;
      stats.wins += entry.won ? 1 : 0;
      stats.draws += match.winnerTeamId === null ? 1 : 0;
      stats.engagementSum += (entry.engagementDistanceMetres ?? 0) * entry.engagementSamples;
      stats.engagementSamples += entry.engagementSamples;
      stats.worldDamage += entry.worldDamage;
      stats.outOfLosTicks += entry.outOfLosTicks;
      stats.aliveTicks += entry.aliveTicks;
      stats.distanceMoved += entry.distanceMovedMetres;
    }
    if (match.winnerTeamId === null) {
      draws.set('draw', (draws.get('draw') ?? 0) + 1);
      return;
    }
    const winner = match.winnerTeamId === 0 ? team0.character : team1.character;
    const loser = match.winnerTeamId === 0 ? team1.character : team0.character;
    matrix[winner]![loser] = (matrix[winner]![loser] ?? 0) + 1;
    matrixMatches[winner]![loser] = (matrixMatches[winner]![loser] ?? 0) + 1;
    matrixMatches[loser]![winner] = (matrixMatches[loser]![winner] ?? 0) + 1;
  };

  for (let first = 0; first < characters.length; first += 1) {
    for (let second = first + 1; second < characters.length; second += 1) {
      const a = characters[first]!;
      const b = characters[second]!;
      for (let seed = 0; seed < seedsPerOrientation; seed += 1) {
        record(runCharacterMatch(seed, [a, b]));
        record(runCharacterMatch(seed, [b, a]));
      }
    }
  }

  const signatures: CharacterSignature[] = characters.map((name) => {
    const stats = aggregate.get(name)!;
    const engagementDistanceMetres =
      stats.engagementSamples === 0 ? null : stats.engagementSum / stats.engagementSamples;
    return {
      name,
      matches: stats.matches,
      wins: stats.wins,
      draws: stats.draws,
      winRate: stats.matches === 0 ? 0 : stats.wins / stats.matches,
      engagementDistanceMetres,
      worldDamagePerMatch: stats.matches === 0 ? 0 : stats.worldDamage / stats.matches,
      outOfLosShare: stats.aliveTicks === 0 ? 0 : stats.outOfLosTicks / stats.aliveTicks,
      meanSpeedMetresPerSecond:
        stats.aliveTicks === 0 ? 0 : stats.distanceMoved / (stats.aliveTicks * STEP_SECONDS),
      signatureDeltas: {
        engagementDistance: 0,
        worldDamage: 0,
        outOfLos: 0,
        speed: 0,
      },
    };
  });
  const values = (key: 'engagementDistanceMetres' | 'worldDamagePerMatch' | 'outOfLosShare' | 'meanSpeedMetresPerSecond'): number[] =>
    signatures.map((signature) => {
      const value = signature[key];
      return value === null ? 0 : value;
    });
  const median = (numbers: readonly number[]): number => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  };
  const medianSignature = {
    engagementDistanceMetres: median(values('engagementDistanceMetres')),
    worldDamagePerMatch: median(values('worldDamagePerMatch')),
    outOfLosShare: median(values('outOfLosShare')),
    meanSpeedMetresPerSecond: median(values('meanSpeedMetresPerSecond')),
  };
  const withDeltas = signatures.map((signature) => {
    const delta = (value: number, medianValue: number): number =>
      medianValue === 0 ? (value > 0 ? Infinity : 0) : (value - medianValue) / Math.abs(medianValue);
    return {
      ...signature,
      signatureDeltas: {
        engagementDistance: delta(signature.engagementDistanceMetres ?? 0, medianSignature.engagementDistanceMetres),
        worldDamage: delta(signature.worldDamagePerMatch, medianSignature.worldDamagePerMatch),
        outOfLos: delta(signature.outOfLosShare, medianSignature.outOfLosShare),
        speed: delta(signature.meanSpeedMetresPerSecond, medianSignature.meanSpeedMetresPerSecond),
      },
    };
  });
  return {
    seedsPerPairing,
    seedsPerOrientation,
    characters,
    matrix,
    matrixMatches,
    draws: draws.get('draw') ?? 0,
    signatures: withDeltas,
    medianSignature,
  };
}
