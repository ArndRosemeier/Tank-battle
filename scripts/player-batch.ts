/**
 * THE player-team stand-in batch: the scripted vanguard drives the player's tank for
 * `--seeds` matches against three AI teams of four, and the table is what the player
 * mode's win rate, length and cap look like without a human at the keyboard.
 *
 *   pnpm player-batch --seeds 100
 *   node --experimental-strip-types scripts/player-batch.ts --seeds 100 --seed-start 0
 *
 * Human skill is NOT measured; `setup.standIn` and `summary` say so. Writes
 * `reports/player-batch.json`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_PROFILES } from '../src/core/ai.ts';
import { runPlayerTeamBatch } from '../src/game/playerBatch.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTS = join(ROOT, 'reports');

interface CliOptions {
  readonly seeds: number;
  readonly seedStart: number;
  readonly characters: readonly string[];
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`player-batch: ${label} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function nonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`player-batch: ${label} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let seeds = 100;
  let seedStart = 0;
  let characters: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log(
        'usage: pnpm player-batch [--seeds N] [--seed-start N] [--characters name[,name...]]\n' +
          '  The scripted vanguard stands in for the human on team 0; human skill is not measured.',
      );
      process.exit(0);
    }
    if (argument === '--seeds' || argument === '--seed-start' || argument === '--characters') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`player-batch: ${argument} needs a value`);
      index += 1;
      if (argument === '--seeds') seeds = positiveInteger(value, '--seeds');
      else if (argument === '--seed-start') seedStart = nonNegativeInteger(value, '--seed-start');
      else {
        characters = value.split(',').map((name) => name.trim()).filter((name) => name.length > 0);
        if (characters.length === 0) throw new Error('player-batch: --characters needs at least one name');
      }
      continue;
    }
    throw new Error(`player-batch: unknown argument "${argument}" (try --help)`);
  }
  const resolved = characters.length > 0 ? characters : AI_PROFILES.map((profile) => profile.name);
  if (resolved.length !== 4) {
    throw new Error(`player-batch: exactly four characters are required, got ${resolved.length}`);
  }
  return { seeds, seedStart, characters: resolved };
}

const cli = parseArgs(process.argv.slice(2));
const started = performance.now();
const result = runPlayerTeamBatch({
  seeds: cli.seeds,
  seedStart: cli.seedStart,
  characters: cli.characters,
});
const seconds = (performance.now() - started) / 1000;

mkdirSync(REPORTS, { recursive: true });
const path = join(REPORTS, 'player-batch.json');
writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);

const { summary } = result;
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
console.log(
  `player-team stand-in: vanguard on team 0 + 3 AI squadmates vs 3 AI teams of 4 · ` +
    `seeds ${cli.seedStart}…${cli.seedStart + cli.seeds - 1} · human skill NOT measured`,
);
console.log('| metric | value |');
console.log('| --- | ---: |');
console.log(`| matches | ${summary.matches} |`);
console.log(`| player-team wins | ${summary.playerTeamWins} (${pct(summary.playerTeamWinRate)}) |`);
console.log(
  `| team win split | ${[0, 1, 2, 3]
    .map((teamId) => `${teamId}: ${pct(summary.teamWinRates[teamId] ?? 0)}`)
    .join(' · ')} |`,
);
console.log(`| draws | ${summary.draws} |`);
console.log(`| cap hits | ${summary.capHits}/${summary.matches} (${pct(summary.capRate)}) |`);
console.log(
  `| match length mean / median (ticks) | ${summary.length.mean.toFixed(1)} / ${summary.length.median.toFixed(1)} |`,
);
console.log(
  `| length p25 / p75 (ticks) | ${summary.length.p25.toFixed(0)} / ${summary.length.p75.toFixed(0)} |`,
);
console.log(`| length min / max (ticks) | ${summary.length.min} / ${summary.length.max} |`);
console.log(`| shots / hits / accuracy | ${summary.shotsFired} / ${summary.hits} / ${pct(summary.accuracy)} |`);
console.log(`| kills | ${summary.kills} |`);
console.log(
  `| deaths by cause | shell ${summary.deathsByCause.shell} / clock ${summary.deathsByCause.clock} |`,
);
console.log(`| elapsed | ${seconds.toFixed(1)} s |`);
console.log(`wrote ${path.slice(ROOT.length)}`);
