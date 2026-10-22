/**
 * The headless batch runner's pure half: real matches on a supplied level, one
 * vanguard tank per team, a summary table and one deterministic trace seed.
 *
 * The level is passed in (not imported from `src/game`) so this stays a core module:
 * the CLI in `scripts/batch.ts` is the only place that reads `ARENA`. The runner uses
 * the real `createMatch` / `stepMatch` / `hashMatch` seam and the real AIController;
 * there is no second simulation.
 */

import {
  DEFAULT_MATCH_RULES,
  createMatch,
  hashMatch,
  stepMatch,
  type MatchRules,
  type MatchState,
  type TankCommandOrder,
  type TankSpawn,
  type TeamSpec,
} from '../sim.ts';
import type { WorldSpec } from '../world.ts';
import { AIController } from './controller.ts';
import { AI_DECISION_INTERVAL_TICKS } from './constants.ts';
import { getAIProfile, type AIProfile } from './profile.ts';

export interface BatchSpawn {
  readonly teamId: number;
  readonly spawn: TankSpawn;
}

export interface BatchSetup {
  readonly level: WorldSpec;
  readonly spawns: readonly BatchSpawn[];
}

export interface BatchOptions {
  /** Number of consecutive seeds to run. */
  readonly seeds: number;
  /** Teams in the match and one vanguard tank per team. Default 2. */
  readonly teams?: number;
  /** The profile name. Default vanguard. */
  readonly character?: string;
  readonly seedStart?: number;
  readonly rules?: MatchRules;
  /** Which seed gets the per-tick trace. Default the first seed. */
  readonly traceSeed?: number;
}

export interface BatchMatchResult {
  readonly seed: number;
  readonly hash: string;
  readonly ticks: number;
  readonly outcome: string;
  readonly winnerTeamId: number | null;
  readonly shotsFired: number;
  readonly hits: number;
  readonly accuracy: number;
  readonly kills: number;
  readonly damageDealt: number;
  readonly firstShotTick: number | null;
  readonly firstKillTick: number | null;
  readonly timeToKillTicks: number | null;
  readonly causes: Readonly<{ shell: number; clock: number }>;
  readonly capHit: boolean;
}

export interface BatchSummary {
  readonly matches: number;
  readonly draws: number;
  readonly wins: Readonly<Record<string, number>>;
  readonly meanTicks: number;
  readonly medianTicks: number;
  readonly capHits: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly accuracy: number;
  readonly kills: number;
  readonly timeToKillTicks: number | null;
  readonly medianTimeToKillTicks: number | null;
  readonly matchesWithKill: number;
  readonly deathsByCause: Readonly<{ shell: number; clock: number }>;
}

export interface BatchTraceRecord {
  readonly tick: number;
  readonly tanks: readonly {
    readonly id: number;
    readonly teamId: number;
    readonly x: number;
    readonly z: number;
    readonly hp: number;
    readonly alive: boolean;
    readonly turretYawDegrees: number;
    readonly aimPitchDegrees: number;
  }[];
  readonly shells: number;
}

export interface BatchResult {
  readonly setup: { readonly teams: number; readonly character: string };
  readonly summary: BatchSummary;
  readonly matches: readonly BatchMatchResult[];
  readonly traceSeed: number | null;
  readonly trace: readonly BatchTraceRecord[];
}

/**
 * Runs the batch. Every match starts from the same supplied spawns and level; the
 * per-tank controller seed is derived deterministically from the match seed and tank
 * id, so a repeated call has the same hashes, shots, paths and trace.
 */
export function runBatchMatches(setup: BatchSetup, options: BatchOptions): BatchResult {
  if (setup === null || typeof setup !== 'object') {
    throw new Error('runBatchMatches: setup must be an object');
  }
  if (!Number.isInteger(options.seeds) || options.seeds < 1) {
    throw new Error(`runBatchMatches: seeds must be a positive integer, got ${String(options.seeds)}`);
  }
  const teams = options.teams ?? 2;
  if (!Number.isInteger(teams) || teams < 2 || teams > 4) {
    throw new Error(`runBatchMatches: teams must be an integer 2…4, got ${String(teams)}`);
  }
  if (setup.spawns.length < teams) {
    throw new Error(
      `runBatchMatches: setup has ${setup.spawns.length} spawns, needs ${teams} for ${teams} teams`,
    );
  }
  const characterName = options.character ?? 'vanguard';
  const profile = getAIProfile(characterName);
  const seedStart = options.seedStart ?? 0;
  if (!Number.isInteger(seedStart) || seedStart < 0 || !Number.isSafeInteger(seedStart + options.seeds - 1)) {
    throw new Error(`runBatchMatches: seed range is invalid (start ${String(seedStart)}, count ${options.seeds})`);
  }
  if (seedStart + options.seeds > 0x1_0000_0000) {
    throw new Error('runBatchMatches: seed range must stay inside the 32-bit seed space');
  }
  const traceSeed = options.traceSeed ?? seedStart;
  const rules = options.rules ?? DEFAULT_MATCH_RULES;
  const selectedSpawns = [...setup.spawns].sort((a, b) => a.teamId - b.teamId).slice(0, teams);
  const teamIds = new Set<number>();
  for (const item of selectedSpawns) {
    if (teamIds.has(item.teamId)) {
      throw new Error(`runBatchMatches: spawn team ${item.teamId} appears twice`);
    }
    teamIds.add(item.teamId);
  }

  const matchResults: BatchMatchResult[] = [];
  let trace: BatchTraceRecord[] = [];
  for (let offset = 0; offset < options.seeds; offset += 1) {
    const seed = seedStart + offset;
    const match = createMatch({
      level: setup.level,
      teams: selectedSpawns.map((item): TeamSpec => ({ id: item.teamId, tanks: [item.spawn] })),
      seed,
      rules,
    });
    const controllers = new Map<number, AIController>();
    for (const tank of match.tanks) {
      controllers.set(
        tank.id,
        new AIController({
          tankId: tank.id,
          profile,
          seed: controllerSeed(seed, tank.id),
          decisionPhaseTicks: controllerSeed(seed, tank.id) % AI_DECISION_INTERVAL_TICKS,
        }),
      );
    }
    const collected: BatchTraceRecord[] = [];
    const collect = seed === traceSeed;
    let firstShotTick: number | null = null;
    let previousShots = 0;
    let guard = 0;
    while (match.status === 'active') {
      if (collect && match.tick % AI_DECISION_INTERVAL_TICKS === 0) {
        collected.push(traceRecord(match));
      }
      const orders: TankCommandOrder[] = [];
      for (const tank of match.tanks) {
        if (!tank.alive) continue;
        const controller = controllers.get(tank.id);
        if (!controller) {
          throw new Error(`runBatchMatches: no controller for tank ${tank.id}`);
        }
        orders.push({ tankId: tank.id, command: controller.commandFor(match, tank.id) });
      }
      stepMatch(match, orders);
      if (firstShotTick === null && match.stats.shotsFired > previousShots) {
        firstShotTick = match.tick;
      }
      previousShots = match.stats.shotsFired;
      guard += 1;
      if (guard > rules.tickCap + 1) {
        throw new Error(`runBatchMatches: seed ${seed} exceeded the tick cap guard`);
      }
    }
    if (collect) {
      const last = collected[collected.length - 1];
      if (!last || last.tick !== match.tick) {
        collected.push(traceRecord(match));
      }
      trace = collected;
    }
    const firstKill = firstKillTick(match);
    const timeToKill = firstKill !== null && firstShotTick !== null ? firstKill - firstShotTick : null;
    matchResults.push({
      seed,
      hash: hashMatch(match),
      ticks: match.tick,
      outcome: match.outcome ?? 'active',
      winnerTeamId: match.winnerTeamId,
      shotsFired: match.stats.shotsFired,
      hits: match.stats.hits,
      accuracy: match.stats.shotsFired === 0 ? 0 : match.stats.hits / match.stats.shotsFired,
      kills: match.stats.kills,
      damageDealt: match.stats.damageDealt,
      firstShotTick,
      firstKillTick: firstKill,
      timeToKillTicks: timeToKill,
      causes: { ...match.stats.causes },
      capHit: match.tick >= rules.tickCap,
    });
  }

  return {
    setup: { teams, character: profile.name },
    summary: summarize(matchResults),
    matches: matchResults,
    traceSeed: traceSeed >= seedStart && traceSeed < seedStart + options.seeds ? traceSeed : null,
    trace,
  };
}

function summarize(matches: readonly BatchMatchResult[]): BatchSummary {
  const ticks = matches.map((match) => match.ticks);
  const wins: Record<string, number> = {};
  let draws = 0;
  for (const match of matches) {
    if (match.winnerTeamId === null) {
      draws += 1;
    } else {
      const key = String(match.winnerTeamId);
      wins[key] = (wins[key] ?? 0) + 1;
    }
  }
  const killTimes = matches
    .map((match) => match.timeToKillTicks)
    .filter((tick): tick is number => tick !== null);
  const shotsFired = matches.reduce((sum, match) => sum + match.shotsFired, 0);
  const hits = matches.reduce((sum, match) => sum + match.hits, 0);
  const causes = matches.reduce(
    (sum, match) => ({
      shell: sum.shell + match.causes.shell,
      clock: sum.clock + match.causes.clock,
    }),
    { shell: 0, clock: 0 },
  );
  return {
    matches: matches.length,
    draws,
    wins,
    meanTicks: mean(ticks),
    medianTicks: median(ticks),
    capHits: matches.filter((match) => match.capHit).length,
    shotsFired,
    hits,
    accuracy: shotsFired === 0 ? 0 : hits / shotsFired,
    kills: matches.reduce((sum, match) => sum + match.kills, 0),
    timeToKillTicks: killTimes.length === 0 ? null : mean(killTimes),
    medianTimeToKillTicks: killTimes.length === 0 ? null : median(killTimes),
    matchesWithKill: killTimes.length,
    deathsByCause: causes,
  };
}

function traceRecord(state: MatchState): BatchTraceRecord {
  return {
    tick: state.tick,
    tanks: state.tanks.map((tank) => ({
      id: tank.id,
      teamId: tank.teamId,
      x: tank.x,
      z: tank.z,
      hp: tank.hp,
      alive: tank.alive,
      turretYawDegrees: tank.turretYawDegrees,
      aimPitchDegrees: tank.aimPitchDegrees,
    })),
    shells: state.shells.length,
  };
}

function firstKillTick(state: MatchState): number | null {
  let first: number | null = null;
  for (const tank of state.tanks) {
    if (tank.diedAtTick !== null && (first === null || tank.diedAtTick < first)) {
      first = tank.diedAtTick;
    }
  }
  return first;
}

function controllerSeed(seed: number, tankId: number): number {
  return (seed + Math.imul(tankId + 1, 0x9e3779b9)) >>> 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('batch: mean of an empty list');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('batch: median of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The profile is exposed for the CLI's validation/error path. */
export function batchProfile(character: string): AIProfile {
  return getAIProfile(character);
}
