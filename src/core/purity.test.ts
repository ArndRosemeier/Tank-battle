import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The layer map, enforced instead of promised (`docs/ARCHITECTURE.md` §1).
 *
 * The layer scans cover every `.ts` file under `src/core/` that is NOT a test (`.test.ts`
 * / `.spec.ts`); the one-source cell-size scan also covers `src/render/`. A test file is
 * the one place the forbidden tokens have to be spelled out (this file is the scanner),
 * and a test never reaches the bundle; every simulation module is scanned. The scans
 * assert how many modules they found, so an empty or broken glob cannot pass as clean.
 *
 * `three` is matched as an IMPORT SPECIFIER, not as a word: a comment may name the
 * renderer while explaining that the core does not import it.
 */
const CORE_DIR = fileURLToPath(new URL('.', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));
const RENDER_DIR = join(SRC_DIR, 'render');

/** The layer violations: the renderer, the DOM, a window, or a host clock/timer. */
const HOST_OR_RENDERER =
  /(?:from|import)\s*\(?\s*['"]three|['"]three['"]|\bdocument\b|\bwindow\b|\bperformance\s*\.\s*now\b|\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/;

/** The one randomness ban: `createRng` is the only draw source in the core. */
const UNSEEDED_RANDOM = /\bMath\s*\.\s*random\b/;

interface SourceFile {
  readonly path: string;
  readonly source: string;
}

function coreModules(): readonly SourceFile[] {
  const modules: SourceFile[] = [];
  for (const entry of readdirSync(CORE_DIR, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) {
      continue;
    }
    const path = join(CORE_DIR, entry);
    modules.push({ path: relative(CORE_DIR, path), source: readFileSync(path, 'utf8') });
  }
  modules.sort((a, b) => a.path.localeCompare(b.path));
  return modules;
}

function allSourceModules(): readonly SourceFile[] {
  const modules: SourceFile[] = [];
  for (const dir of [CORE_DIR, RENDER_DIR]) {
    for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) {
        continue;
      }
      const path = join(dir, entry);
      modules.push({ path: relative(SRC_DIR, path), source: readFileSync(path, 'utf8') });
    }
  }
  modules.sort((a, b) => a.path.localeCompare(b.path));
  return modules;
}

function findMatches(modules: readonly SourceFile[], pattern: RegExp): readonly string[] {
  const hits: string[] = [];
  for (const module of modules) {
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

/**
 * A line that is entirely a comment is documentation, not code: it cannot import a
 * renderer, touch a global or draw a number. Skipping it keeps the scan honest without
 * forbidding the prose that explains WHY the core is pure (this is the file that has to
 * name what it bans). A violation on a line that carries any code still fails.
 */
function isDocumentationLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

describe('core purity', () => {
  it('no module under src/core/ imports three.js, or touches document, window, performance.now or any other host clock', () => {
    const modules = coreModules();
    // The scan must have found the simulation modules, or a clean result means nothing.
    expect(modules.length).toBeGreaterThanOrEqual(8);

    expect(findMatches(modules, HOST_OR_RENDERER)).toEqual([]);
  });

  it('no module under src/core/ calls Math.random', () => {
    const modules = coreModules();
    expect(modules.length).toBeGreaterThanOrEqual(8);

    expect(findMatches(modules, UNSEEDED_RANDOM)).toEqual([]);
  });

  it('the 2 m cell size is defined once and the renderer imports it', () => {
    const modules = allSourceModules();
    expect(modules.length).toBeGreaterThanOrEqual(20);

    const definitions = findMatches(modules, /\bCELL_SIZE_METRES\s*=\s*2\b/);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toContain('core/world/constants.ts');

    const renderConfig = modules.find((module) => module.path === 'render/config.ts');
    expect(renderConfig).toBeDefined();
    const source = renderConfig?.source ?? '';
    expect(source).toMatch(
      /import\s*\{[^}]*CELL_SIZE_METRES[^}]*\}\s*from\s*['"]\.\.\/core\/world\.ts['"]/,
    );
    expect(source).toMatch(/cellMetres:\s*CELL_SIZE_METRES/);
    expect(source).not.toMatch(/cellMetres:\s*2\b/);
  });
});
