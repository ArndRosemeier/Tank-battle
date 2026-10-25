/**
 * Per-browser settings: the ONLY place user preferences are read/written. Volumes feed
 * the audio buses, quality feeds `setSurfaceDetail` + the bloom pass, and reduced motion
 * disables the title animation and VFX. The mouse mode picks how the camera turns
 * (`src/game/mouseLook.ts`) and the mouse speed scales it. A stored object from before
 * the mouse mode existed still loads: the missing mode falls back to the default.
 *
 * Stored values are data from the browser, so they are validated; a corrupt store is a
 * user-preference failure, not a simulation failure, and falls back to the documented
 * defaults with a console warning. The UI never invents a value outside these ranges.
 */

import { DEFAULT_MOUSE_MODE, MOUSE_MODES, isMouseMode, type MouseMode } from '../game/mouseLook.ts';

export interface GameSettings {
  /** 0…1 bus volumes. */
  readonly master: number;
  readonly music: number;
  readonly sfx: number;
  /** 0…1; also the SURFACE_DETAIL scalar. */
  readonly quality: number;
  /** 0.2…2 mouse speed: locked-cursor movement and camera turning per mouse pixel. */
  readonly mouseSensitivity: number;
  /**
   * How the mouse turns the camera; see `mouseLook.ts`. Stored as `mouseControl`: the
   * first release's `mouseMode` key is deliberately ignored, so every player picks up
   * the new `offset` default once (the old default was saved on every boot).
   */
  readonly mouseControl: MouseMode;
  readonly reducedMotion: boolean;
}

export const SETTINGS_KEY = 'tank-battle.settings.v1';

export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  master: 0.8,
  music: 0.65,
  sfx: 0.8,
  quality: 0.3,
  mouseSensitivity: 1,
  mouseControl: DEFAULT_MOUSE_MODE,
  reducedMotion: false,
});

function requireRange(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`settings: ${label} must be a number within ${min}…${max}, got ${String(value)}`);
  }
  return value;
}

/** Validates a stored object. Throws on malformed data; `loadSettings` handles it. */
export function parseSettings(raw: unknown): GameSettings {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('settings: stored value must be an object');
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.reducedMotion !== 'boolean') {
    throw new Error('settings: reducedMotion must be a boolean');
  }
  return {
    master: requireRange(value.master, 0, 1, 'master'),
    music: requireRange(value.music, 0, 1, 'music'),
    sfx: requireRange(value.sfx, 0, 1, 'sfx'),
    quality: requireRange(value.quality, 0, 1, 'quality'),
    mouseSensitivity: requireRange(value.mouseSensitivity, 0.2, 2, 'mouseSensitivity'),
    mouseControl: parseMouseMode(value.mouseControl),
    reducedMotion: value.reducedMotion,
  };
}

function parseMouseMode(value: unknown): MouseMode {
  // Settings saved before the mouse mode existed have no key: they get the default.
  if (value === undefined) return DEFAULT_MOUSE_MODE;
  if (!isMouseMode(value)) {
    throw new Error(`settings: mouseControl must be one of ${MOUSE_MODES.join(', ')}, got ${String(value)}`);
  }
  return value;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(storage: StorageLike | null = browserStorage()): GameSettings {
  if (!storage) return DEFAULT_SETTINGS;
  const text = storage.getItem(SETTINGS_KEY);
  if (text === null) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(text) as unknown);
  } catch (error) {
    console.warn(`settings: ignoring the stored preferences (${String(error)})`);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(
  settings: GameSettings,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  const validated = parseSettings(settings);
  storage.setItem(SETTINGS_KEY, JSON.stringify(validated));
}

/** Applies a UI step to a setting and returns the new immutable settings object. */
export function withSetting(
  settings: GameSettings,
  key: keyof GameSettings,
  value: number | boolean | MouseMode,
): GameSettings {
  const candidate = { ...settings, [key]: value };
  return parseSettings(candidate);
}
