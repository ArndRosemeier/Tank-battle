import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PALETTE } from './config.ts';

/**
 * The render layer's TWO source-scanning pins (`docs/DESIGN.md` §§5.1 and 9):
 *
 *  1. three.js may only be imported by the render layer, `src/main.ts` and the entry
 *     glue. The simulation core stays renderer-free, so it keeps testing headless.
 *  2. the palette has ONE home. A hex colour outside `src/render/config.ts` would
 *     fork the look (and is most often a stale literal that outlives a tuning pass).
 *
 * Both scans read code lines (a comment cannot import a renderer or paint a wall)
 * and assert how many modules they found, so an empty glob cannot pass as clean.
 */

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

/** `three` and every subpath of it, as an import specifier — never the bare word. */
const THREE_IMPORT = /(?:from|import)\s*\(?\s*['"]three(?:\/[^'"]*)?['"]/;

/** A 3-, 4-, 6- or 8-digit hex colour literal. */
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/;

interface SourceModule {
  /** Repo-relative to `src/`, with `/` separators. */
  readonly path: string;
  readonly source: string;
}

function sourceModules(): readonly SourceModule[] {
  const modules: SourceModule[] = [];
  for (const entry of readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts')) {
      continue;
    }
    const absolute = join(SRC_DIR, entry);
    modules.push({
      path: relative(SRC_DIR, absolute).split(sep).join('/'),
      source: readFileSync(absolute, 'utf8'),
    });
  }
  modules.sort((a, b) => a.path.localeCompare(b.path));
  return modules;
}

/** A line that is entirely a comment is documentation, not behaviour. */
function isDocumentationLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function findMatches(modules: readonly SourceModule[], pattern: RegExp, skip: (path: string) => boolean): readonly string[] {
  const hits: string[] = [];
  for (const module of modules) {
    if (skip(module.path)) {
      continue;
    }
    const lines = module.source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (isDocumentationLine(line)) {
        continue;
      }
      if (pattern.test(line)) {
        hits.push(`${module.path}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  return hits;
}

/** Where a three.js import is legal: the render layer, the entry wiring, main. */
function mayImportThree(path: string): boolean {
  return path.startsWith('render/') || path.startsWith('entry/') || path === 'main.ts';
}

describe('render layer purity', () => {
  it('no file outside src/render/, src/main.ts and src/entry/ imports three', () => {
    const modules = sourceModules();
    expect(modules.length).toBeGreaterThanOrEqual(15);

    const offenders = findMatches(modules, THREE_IMPORT, mayImportThree);
    expect(offenders).toEqual([]);
  });

  it('the palette carries four distinct team colours and no module outside src/render/config.ts hardcodes a hex colour', () => {
    expect(PALETTE.team).toHaveLength(4);
    expect(new Set(PALETTE.team).size).toBe(4);
    expect(new Set([PALETTE.background, PALETTE.iceWhite]).size).toBe(2);

    const modules = sourceModules();
    expect(modules.length).toBeGreaterThanOrEqual(15);

    const offenders = findMatches(
      modules,
      HEX_COLOUR,
      (path) => path === 'render/config.ts',
    );
    expect(offenders).toEqual([]);
  });
});
