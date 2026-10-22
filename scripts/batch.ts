/**
 * THE headless batch command. Native TypeScript stripping, no build, no dependency:
 *
 *   pnpm batch --seeds 100
 *   node --experimental-strip-types scripts/batch.ts --seeds 100 --characters vanguard --teams 2
 *
 * It runs real matches on the authored ARENA through the same `createMatch` /
 * `stepMatch` / AIController seams the game uses, writes `reports/batch.json` plus one
 * seed's JSONL trace, and prints the table the owner judges battles with.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MATCH_RULES } from '../src/core/sim.ts';
import {
  AI_PROFILES,
  runBatchMatches,
  runTeamBatch,
  type BatchOptions,
  type TeamBatchResult,
} from '../src/core/ai.ts';
import { arenaBatchSetup, arenaDuelSetup, arenaTeamSetup } from '../src/game/aiBatch.ts';

interface CliOptions {
  readonly seeds: number;
  readonly teams: number;
  readonly tanksPerTeam: number;
  readonly characters: readonly string[];
  readonly seedStart: number;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTS = join(ROOT, 'reports');

function parseArgs(argv: readonly string[]): CliOptions {
  let seeds = 1;
  let teams = 2;
  let tanksPerTeam = 1;
  let characters: string[] = [];
  let seedStart = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      printHelp();
      process.exit(0);
    }
    if (
      argument === '--seeds' ||
      argument === '--teams' ||
      argument === '--tanks-per-team' ||
      argument === '--characters' ||
      argument === '--seed-start'
    ) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`batch: ${argument} needs a value`);
      }
      index += 1;
      if (argument === '--seeds') seeds = positiveInteger(value, '--seeds');
      else if (argument === '--teams') teams = positiveInteger(value, '--teams');
      else if (argument === '--tanks-per-team') tanksPerTeam = positiveInteger(value, '--tanks-per-team');
      else if (argument === '--seed-start') seedStart = nonNegativeInteger(value, '--seed-start');
      else {
        characters = value.split(',').map((name) => name.trim()).filter((name) => name.length > 0);
        if (characters.length === 0) throw new Error('batch: --characters needs at least one name');
      }
      continue;
    }
    throw new Error(`batch: unknown argument "${argument}" (try --help)`);
  }
  if (teams < 2 || teams > 4) {
    throw new Error(`batch: --teams must be 2…4, got ${teams}`);
  }
  if (tanksPerTeam < 1 || tanksPerTeam > 4) {
    throw new Error(`batch: --tanks-per-team must be 1…4, got ${tanksPerTeam}`);
  }
  const resolvedCharacters =
    characters.length > 0
      ? characters
      : tanksPerTeam === 1
        ? ['vanguard']
        : AI_PROFILES.map((profile) => profile.name);
  if (resolvedCharacters.length < tanksPerTeam) {
    throw new Error(
      `batch: ${resolvedCharacters.length} characters cannot fill ${tanksPerTeam} tanks per team`,
    );
  }
  if (tanksPerTeam === 1 && resolvedCharacters.length !== 1) {
    throw new Error('batch: --tanks-per-team 1 needs exactly one character');
  }
  return { seeds, teams, tanksPerTeam, characters: resolvedCharacters, seedStart };
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`batch: ${label} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function nonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`batch: ${label} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(
    'usage: pnpm batch [--seeds N] [--teams 2..4] [--tanks-per-team 1..4]\n' +
      '                   [--characters name[,name...]] [--seed-start N]\n' +
      '  1 tank/team: reports/batch.json + a trace. 2..4 tanks/team: reports/team-batch.json.',
  );
}

function main(): void {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(REPORTS, { recursive: true });
  if (cli.tanksPerTeam > 1) {
    const setup = arenaTeamSetup(cli.teams, cli.tanksPerTeam);
    const started = performance.now();
    const result = runTeamBatch(setup, {
      seeds: cli.seeds,
      characters: cli.characters,
      seedStart: cli.seedStart,
      rules: DEFAULT_MATCH_RULES,
      aimErrorScale: 0.1,
    });
    const seconds = (performance.now() - started) / 1000;
    const path = join(REPORTS, 'team-batch.json');
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
    printTeamReport(result, path, seconds);
    return;
  }
  const setup = cli.teams === 2 ? arenaDuelSetup() : arenaBatchSetup();
  const options: BatchOptions = {
    seeds: cli.seeds,
    teams: cli.teams,
    character: cli.characters[0]!,
    seedStart: cli.seedStart,
    rules: DEFAULT_MATCH_RULES,
  };
  const result = runBatchMatches(setup, options);
  const batchPath = join(REPORTS, 'batch.json');
  writeFileSync(batchPath, `${JSON.stringify(result, null, 2)}\n`);
  let tracePath: string | null = null;
  if (result.traceSeed !== null) {
    tracePath = join(REPORTS, `trace-seed-${result.traceSeed}.jsonl`);
    writeFileSync(tracePath, result.trace.map((record) => JSON.stringify(record)).join('\n') + '\n');
  }
  printReport(result, batchPath, tracePath);
}

function printTeamReport(result: TeamBatchResult, path: string, seconds: number): void {
  const s = result.summary;
  const winSplit = Object.entries(s.teamWinRates)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([team, rate]) => `team ${team}: ${(rate * 100).toFixed(1)}% (${s.teamWins[Number(team)] ?? 0})`)
    .join(' · ');
  const cornerSplit = Object.entries(s.cornerWinRates)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([corner, rate]) => `corner ${corner}: ${(rate * 100).toFixed(1)}% (${s.cornerWins[Number(corner)] ?? 0})`)
    .join(' · ');
  const rows: readonly (readonly [string, string])[] = [
    ['matches', String(s.matches)],
    ['draws', String(s.draws)],
    ['team win split', winSplit],
    ['corner win split', cornerSplit],
    ['mean match ticks', s.length.mean.toFixed(1)],
    ['median match ticks', s.length.median.toFixed(1)],
    ['length p25 / p75 (ticks)', `${s.length.p25.toFixed(0)} / ${s.length.p75.toFixed(0)}`],
    ['length min / max (ticks)', `${s.length.min} / ${s.length.max}`],
    ['cap hits', `${s.capHits}/${s.matches} (${percent(s.capHits / s.matches)})`],
    ['shots', String(s.shotsFired)],
    ['hits', String(s.hits)],
    ['accuracy', percent(s.accuracy)],
    ['kills', String(s.kills)],
    ['damage dealt', String(s.damageDealt)],
    ['deaths by cause', `shell ${s.deathsByCause.shell} / clock ${s.deathsByCause.clock}`],
    ['mean speed while alive (m/s)', s.meanSpeedMetresPerSecond.toFixed(2)],
    ['matches/second', (s.matches / seconds).toFixed(2)],
    ['elapsed', `${seconds.toFixed(2)} s`],
  ];
  console.log(
    `team batch: ${result.setup.characters.join(', ')} · ${result.setup.teams} teams × ` +
      `${result.setup.tanksPerTeam} tanks · seeds ${result.matches[0]?.seed ?? '-'}…` +
      `${result.matches[result.matches.length - 1]?.seed ?? '-'}`,
  );
  console.log('| metric | value |');
  console.log('| --- | --- |');
  for (const [metric, value] of rows) console.log(`| ${metric} | ${value} |`);
  console.log('| character | tanks | alive at end | deaths (shell/clock) | damage taken/tank | HP left/tank |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const character of result.characters) {
    const tanks = character.tanks;
    console.log(
      `| ${character.name} | ${tanks} | ${character.aliveAtEnd} | ` +
        `${character.deaths} (${character.shellDeaths}/${character.clockDeaths}) | ` +
        `${tanks === 0 ? 'n/a' : (character.damageTaken / tanks).toFixed(2)} | ` +
        `${tanks === 0 ? 'n/a' : (character.hpRemaining / tanks).toFixed(2)} |`,
    );
  }
  console.log(`wrote ${relativeRoot(path)}`);
}

function printReport(result: ReturnType<typeof runBatchMatches>, batchPath: string, tracePath: string | null): void {
  const s = result.summary;
  const wins = Object.entries(s.wins)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([team, count]) => `team ${team}: ${count}`)
    .join(' · ');
  const rows: readonly (readonly [string, string])[] = [
    ['matches', String(s.matches)],
    ['draws', String(s.draws)],
    ['win split', wins || 'none'],
    ['mean match ticks', s.meanTicks.toFixed(1)],
    ['median match ticks', String(s.medianTicks)],
    ['cap hits', `${s.capHits}/${s.matches} (${percent(s.capHits / s.matches)})`],
    ['shots', String(s.shotsFired)],
    ['hits', String(s.hits)],
    ['accuracy', percent(s.accuracy)],
    ['kills', String(s.kills)],
    ['time-to-kill (ticks from first shot)', s.timeToKillTicks === null ? 'n/a' : s.timeToKillTicks.toFixed(1)],
    ['median TTK (ticks)', s.medianTimeToKillTicks === null ? 'n/a' : String(s.medianTimeToKillTicks)],
    ['mean speed while alive (m/s)', s.meanSpeedMetresPerSecond.toFixed(2)],
    ['matches with kill', String(s.matchesWithKill)],
    ['deaths by cause', `shell ${s.deathsByCause.shell} / clock ${s.deathsByCause.clock}`],
  ];
  console.log(`batch: ${result.setup.character} · ${result.setup.teams} teams · seeds ${result.matches[0]?.seed ?? '-'}…${result.matches[result.matches.length - 1]?.seed ?? '-'}`);
  console.log('| metric | value |');
  console.log('| --- | --- |');
  for (const [metric, value] of rows) {
    console.log(`| ${metric} | ${value} |`);
  }
  console.log(`wrote ${relativeRoot(batchPath)}${tracePath ? ` and ${relativeRoot(tracePath)}` : ''}`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function relativeRoot(path: string): string {
  return path.startsWith(ROOT) ? path.slice(ROOT.length) : path;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
