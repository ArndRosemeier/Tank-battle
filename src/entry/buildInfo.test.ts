import { compareVersions, formatVersion, parseChangelogFile, readBuildInfo } from '../../scripts/buildInfo.ts';

describe('build info: version numbers', () => {
  it('starts at 0.100 and adds 0.001 per main commit', () => {
    expect(formatVersion(1)).toBe('0.100');
    expect(formatVersion(2)).toBe('0.101');
    expect(formatVersion(900)).toBe('0.999');
    expect(formatVersion(901)).toBe('1.000');
  });
  it('refuses a count with no commit after the anchor', () => {
    expect(() => formatVersion(0)).toThrow(/at least one commit/);
  });
  it('compares numerically', () => {
    expect(compareVersions('0.105', '0.099')).toBeGreaterThan(0);
    expect(compareVersions('1.000', '0.999')).toBeGreaterThan(0);
    expect(() => compareVersions('0.1', '0.100')).toThrow(/not a version/);
  });
});

describe('build info: changelog files', () => {
  it('reads a title and items', () => {
    expect(parseChangelogFile('a.md', '# New arena\n\n- Bigger hills\n- More caves\n')).toEqual({
      title: 'New arena',
      items: ['Bigger hills', 'More caves'],
    });
  });
  it('fails loudly on a malformed file', () => {
    expect(() => parseChangelogFile('a.md', '- no title\n')).toThrow(/line 1/);
    expect(() => parseChangelogFile('a.md', '# Title only\n')).toThrow(/no "- item"/);
    expect(() => parseChangelogFile('a.md', '# T\nloose text\n')).toThrow(/line 2/);
  });
  it('builds from this repository: every entry parses and none is newer than the build', () => {
    const info = readBuildInfo(process.cwd());
    expect(info.changelog.length).toBeGreaterThan(0);
    for (const entry of info.changelog) {
      // An uncommitted file in a local checkout ships with the next version, at most one ahead.
      expect(compareVersions(entry.version, info.version)).toBeLessThanOrEqual(1);
    }
  });
});
