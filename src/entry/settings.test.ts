import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  parseSettings,
  saveSettings,
  withSetting,
} from './settings.ts';

function memoryStore(initial: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('settings persistence', () => {
  it('round-trips a valid settings object', () => {
    const store = memoryStore();
    const next = withSetting(DEFAULT_SETTINGS, 'music', 0.2);
    saveSettings(next, store);
    expect(loadSettings(store)).toEqual(next);
  });

  it('rejects a malformed stored value and falls back to the documented defaults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memoryStore({ [SETTINGS_KEY]: '{not json' });
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('retires the sensitivity row while still accepting the stored key', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).not.toContain('data-setting="mouseSensitivity"');
    expect(html.match(/data-setting="/g)).toHaveLength(4);
    // The persisted key survives only so an existing settings object still loads.
    expect(parseSettings({ ...DEFAULT_SETTINGS, mouseSensitivity: 1.8 }).mouseSensitivity).toBe(1.8);
  });

  it('rejects out-of-range values instead of clamping them into a silent default', () => {
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, master: 1.4 })).toThrow(/master/);
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, quality: -0.1 })).toThrow(/quality/);
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, mouseSensitivity: 0.1 })).toThrow(/mouseSensitivity/);
    expect(() => withSetting(DEFAULT_SETTINGS, 'reducedMotion', true)).not.toThrow();
    expect(withSetting(DEFAULT_SETTINGS, 'reducedMotion', true).reducedMotion).toBe(true);
  });
});
