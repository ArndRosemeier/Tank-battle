import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The shipped-assets pin (P3). Every audio file under `assets/audio/` must be named in
 * `assets/manifest.json` with its sha256 and provenance, and every manifest entry must
 * have a real file. A missing half of that contract fails the suite — a local asset
 * with no provenance is not shippable, and a manifest that points at nothing is a lie.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const AUDIO = join(ASSETS, 'audio');

interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: 'music' | 'sfx';
  readonly model: string;
  readonly prompt: string;
  readonly date: string;
}

interface Manifest {
  readonly version: number;
  readonly entries: readonly ManifestEntry[];
}

function loadManifest(): Manifest {
  const raw = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8')) as Manifest;
  expect(raw.version).toBe(1);
  expect(Array.isArray(raw.entries)).toBe(true);
  return raw;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('shipped audio assets', () => {
  it('every audio file is in the manifest with a matching sha256 and provenance', () => {
    const manifest = loadManifest();
    const files = readdirSync(AUDIO)
      .filter((name) => name.endsWith('.mp3'))
      .sort();
    expect(files.length).toBeGreaterThanOrEqual(11);
    const listed = new Set(manifest.entries.map((entry) => entry.path));
    for (const name of files) {
      const path = `assets/audio/${name}`;
      expect(listed.has(path), `${path} is shipped but not in assets/manifest.json`).toBe(true);
      const entry = manifest.entries.find((candidate) => candidate.path === path)!;
      expect(entry.kind === 'music' || entry.kind === 'sfx').toBe(true);
      expect(entry.model.length).toBeGreaterThan(0);
      expect(entry.prompt.length).toBeGreaterThan(20);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const file = join(ROOT, entry.path);
      expect(statSync(file).size).toBe(entry.bytes);
      expect(sha256(file)).toBe(entry.sha256);
    }
  });

  it('every manifest entry resolves to a file', () => {
    const manifest = loadManifest();
    for (const entry of manifest.entries) {
      const file = join(ROOT, entry.path);
      expect(statSync(file).isFile(), `${entry.path} is listed but missing`).toBe(true);
    }
  });
});
