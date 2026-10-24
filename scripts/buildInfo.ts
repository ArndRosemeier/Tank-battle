/**
 * The game's version and its "What's new" list, both derived from git at build time.
 *
 * VERSION: 0.100 is the first commit on main's first-parent line after ANCHOR, and every
 * further commit on that line (in practice: every merged PR) adds 0.001. Nothing is stored
 * in a file, so two PRs merging in parallel can never conflict over a version bump; the
 * merge ORDER decides who gets which number.
 *
 * CHANGELOG: one Markdown file per change in `changelog/`. An entry's version is the
 * version of the main commit that first added its file, so an author never has to know
 * the number in advance. A file not committed yet is shown as the next version.
 *
 * No silent fallbacks (AGENTS.md): a missing or shallow git history fails the build loudly.
 * CI needs `fetch-depth: 0`; `TANK_BATTLE_VERSION` overrides the number deliberately.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The last commit on main before versioning began (2026-10-24). */
export const VERSION_ANCHOR = '6c09331183f4a64bf4d7e0a9487439952886b997';
/** Version number of the first build after the anchor, in thousandths (0.100). */
export const FIRST_VERSION_THOUSANDTHS = 100;
export const CHANGELOG_DIR = 'changelog';

export interface ChangelogEntry {
  readonly version: string;
  readonly title: string;
  readonly items: readonly string[];
}

export interface BuildInfo {
  readonly version: string;
  readonly changelog: readonly ChangelogEntry[];
}

/** `count` commits after the anchor on main's first-parent line → "0.100", "0.101", … */
export function formatVersion(count: number): string {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`buildInfo: a version needs at least one commit after the anchor, got ${count}`);
  }
  const thousandths = FIRST_VERSION_THOUSANDTHS + count - 1;
  return `${Math.floor(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, '0')}`;
}

/** Orders "0.105" above "0.99" (numeric, not string, comparison). */
export function compareVersions(a: string, b: string): number {
  const toNumber = (v: string): number => {
    const match = /^(\d+)\.(\d{3})$/.exec(v);
    if (!match) throw new Error(`buildInfo: "${v}" is not a version like 0.100`);
    return Number(match[1]) * 1000 + Number(match[2]);
  };
  return toNumber(a) - toNumber(b);
}

/**
 * One changelog file: a `# Title` line, then `- item` lines (blank lines allowed).
 * Anything else is an error, so a typo cannot ship as a half-empty entry.
 */
export function parseChangelogFile(name: string, text: string): { title: string; items: string[] } {
  let title: string | null = null;
  const items: string[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('# ') && title === null && items.length === 0) {
      title = line.slice(2).trim();
    } else if (line.startsWith('- ') && title !== null) {
      items.push(line.slice(2).trim());
    } else {
      throw new Error(
        `buildInfo: ${CHANGELOG_DIR}/${name} line ${index + 1} must be "# Title" (first) or "- item": ${JSON.stringify(raw)}`,
      );
    }
  }
  if (title === null || title === '') throw new Error(`buildInfo: ${CHANGELOG_DIR}/${name} has no "# Title" line`);
  if (items.length === 0) throw new Error(`buildInfo: ${CHANGELOG_DIR}/${name} has no "- item" lines`);
  return { title, items };
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`buildInfo: "git ${args.join(' ')}" failed: ${detail}`);
  }
}

/** Version of `commit`: its first-parent distance from the anchor. */
function versionOf(root: string, commit: string): string {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', VERSION_ANCHOR, commit], { cwd: root, stdio: 'ignore' });
  } catch {
    throw new Error(
      `buildInfo: the version anchor ${VERSION_ANCHOR.slice(0, 7)} is not in this checkout's history ` +
        `(a shallow clone? CI needs "fetch-depth: 0"). Set TANK_BATTLE_VERSION to override deliberately.`,
    );
  }
  const count = Number(git(root, ['rev-list', '--count', '--first-parent', `${VERSION_ANCHOR}..${commit}`]));
  return formatVersion(count);
}

function nextVersion(version: string): string {
  const [major, minor] = version.split('.').map(Number) as [number, number];
  const thousandths = major * 1000 + minor + 1;
  return `${Math.floor(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, '0')}`;
}

export function readBuildInfo(root: string): BuildInfo {
  const override = process.env.TANK_BATTLE_VERSION?.trim();
  if (override) compareVersions(override, override); // validates the format
  const version = override || versionOf(root, 'HEAD');

  const dir = join(root, CHANGELOG_DIR);
  if (!existsSync(dir)) throw new Error(`buildInfo: no ${CHANGELOG_DIR}/ folder at ${root}`);
  const files = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md');
  const entries = files.map((name) => {
    const { title, items } = parseChangelogFile(name, readFileSync(join(dir, name), 'utf8'));
    // With an override there may be no git at all: every entry carries the override.
    if (override) return { name, entry: { version, title, items } };
    const added = git(root, ['log', '--first-parent', '--diff-filter=A', '--format=%H', 'HEAD', '--', `${CHANGELOG_DIR}/${name}`])
      .split('\n')
      .filter(Boolean);
    // Not committed yet (a local dev build): it will ship with the next version.
    const entryVersion = added.length === 0 ? nextVersion(version) : versionOf(root, added[added.length - 1]!);
    return { name, entry: { version: entryVersion, title, items } };
  });
  entries.sort((a, b) => compareVersions(b.entry.version, a.entry.version) || b.name.localeCompare(a.name));
  return { version, changelog: entries.map((e) => e.entry) };
}
