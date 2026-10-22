#!/usr/bin/env node
/**
 * THE round-robin command: 6 pairings × 2 orientations × seeds/2, plus the four
 * behavioural signatures. Native TypeScript stripping; writes reports/round-robin.json.
 *
 *   pnpm round-robin --seeds 200
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRoundRobin } from '../src/game/aiBatch.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTS = join(ROOT, 'reports');
const SEEDS = Number(process.argv[2] === '--seeds' ? process.argv[3] : 200);
if (!Number.isInteger(SEEDS) || SEEDS < 2 || SEEDS % 2 !== 0) {
  console.error('round-robin: --seeds must be an even integer >= 2');
  process.exit(1);
}

const result = runRoundRobin(SEEDS);
mkdirSync(REPORTS, { recursive: true });
const path = join(REPORTS, 'round-robin.json');
writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);

const names = result.characters;
console.log(`round robin: ${SEEDS} seeds/pairing, ${result.seedsPerOrientation} each way, ${names.length * (names.length - 1) / 2} pairings`);
console.log('| row vs column | ' + names.join(' | ') + ' |');
console.log('| --- | ' + names.map(() => '---:').join(' | ') + ' |');
for (const row of names) {
  const cells = names.map((col) =>
    row === col ? '—' : `${result.matrix[row]?.[col] ?? 0} / ${result.matrixMatches[row]?.[col] ?? 0}`,
  );
  console.log(`| ${row} | ${cells.join(' | ')} |`);
}
console.log('| character | wins | matches | win % |');
console.log('| --- | ---: | ---: | ---: |');
for (const signature of result.signatures) {
  console.log(`| ${signature.name} | ${signature.wins} | ${signature.matches} | ${(signature.winRate * 100).toFixed(1)}% |`);
}
console.log('| character | engagement m | world damage | out-of-LOS | speed m/s |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const signature of result.signatures) {
  console.log(
    `| ${signature.name} | ${signature.engagementDistanceMetres?.toFixed(1) ?? 'n/a'} | ` +
      `${signature.worldDamagePerMatch.toFixed(2)} | ${(signature.outOfLosShare * 100).toFixed(1)}% | ` +
      `${signature.meanSpeedMetresPerSecond.toFixed(2)} |`,
  );
}
console.log(
  `| field median | ${result.medianSignature.engagementDistanceMetres.toFixed(1)} | ` +
    `${result.medianSignature.worldDamagePerMatch.toFixed(2)} | ` +
    `${(result.medianSignature.outOfLosShare * 100).toFixed(1)}% | ` +
    `${result.medianSignature.meanSpeedMetresPerSecond.toFixed(2)} |`,
);
console.log(`wrote ${path.slice(ROOT.length)}`);
