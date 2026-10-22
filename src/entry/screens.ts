/**
 * The front-door DOM: title, drawn settings and pause. No HTML range inputs and no
 * default widgets: the sliders are divs with pointer + keyboard handling, the panels use
 * the same palette/clip as the HUD, and every screen is a plain overlay so the match
 * keeps running underneath (paused) and can resume without a reload.
 *
 * Settings are persisted by `settings.ts`; this module only edits them and tells the
 * host to apply them live.
 */

import { requireElement } from './dom.ts';
import { saveSettings, withSetting, type GameSettings } from './settings.ts';

type ScreenName = 'title' | 'settings' | 'pause';
type SettingsOrigin = 'title' | 'pause';

export interface ScreensCallbacks {
  readonly onPlay: () => void;
  readonly onTeam: () => void;
  readonly onSpectate: () => void;
  readonly onResume: () => void;
  readonly onQuit: () => void;
  readonly onGesture: () => void;
  readonly onSettingsChange: (settings: GameSettings) => void;
  readonly onSettingsOpened: (origin: SettingsOrigin) => void;
  readonly onSettingsClosed: (origin: SettingsOrigin) => void;
}

export interface Screens {
  showTitle(): void;
  showSettings(origin: SettingsOrigin): void;
  showPause(): void;
  hideAll(): void;
  setSoundUnlocked(unlocked: boolean): void;
  applySettings(settings: GameSettings): void;
  isSettingsOpen(): boolean;
  isPauseOpen(): boolean;
}

interface SliderSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
}

const SLIDERS: Readonly<Record<string, SliderSpec>> = {
  master: { min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}` },
  music: { min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}` },
  sfx: { min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}` },
  quality: { min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}` },
  mouseSensitivity: { min: 0.2, max: 2, step: 0.01, format: (v) => `${v.toFixed(2)}×` },
};

export function createScreens(initial: GameSettings, callbacks: ScreensCallbacks): Screens {
  const title = requireElement('title-screen', HTMLElement, 'title screen');
  const settingsScreen = requireElement('settings-screen', HTMLElement, 'settings screen');
  const pauseScreen = requireElement('pause-screen', HTMLElement, 'pause screen');
  const soundHint = requireElement('title-audio-hint', HTMLElement, 'audio hint');
  const play = requireElement('title-play', HTMLButtonElement, 'play button');
  const team = requireElement('title-team', HTMLButtonElement, 'team button');
  const spectate = requireElement('title-spectate', HTMLButtonElement, 'spectate button');
  const settingsButton = requireElement('title-settings', HTMLButtonElement, 'settings button');
  const settingsBack = requireElement('settings-back', HTMLButtonElement, 'settings back button');
  const motionToggle = requireElement('settings-motion', HTMLButtonElement, 'reduced motion toggle');
  const resume = requireElement('pause-resume', HTMLButtonElement, 'resume button');
  const pauseSettings = requireElement('pause-settings', HTMLButtonElement, 'pause settings button');
  const quit = requireElement('pause-quit', HTMLButtonElement, 'quit button');

  let settingsOrigin: SettingsOrigin = 'title';
  let settings: GameSettings = initial;
  let soundUnlocked = false;

  const sliders = [...settingsScreen.querySelectorAll<HTMLElement>('.slider')].map((element) => {
    const key = element.dataset.setting;
    if (!key || !(key in SLIDERS)) {
      throw new Error(`screens: slider has an unknown data-setting "${String(key)}"`);
    }
    return { element, key, spec: SLIDERS[key]! };
  });
  if (sliders.length !== 5) {
    throw new Error(`screens: expected 5 drawn sliders, found ${sliders.length}`);
  }

  const setScreen = (name: ScreenName): void => {
    title.hidden = name !== 'title';
    settingsScreen.hidden = name !== 'settings';
    pauseScreen.hidden = name !== 'pause';
  };

  const notifyChange = (): void => {
    saveSettings(settings);
    callbacks.onSettingsChange(settings);
    syncSliders();
  };

  const syncSliders = (): void => {
    for (const { element, key, spec } of sliders) {
      const value = settings[key as keyof GameSettings] as number;
      const fraction = (value - spec.min) / (spec.max - spec.min);
      element.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      element.setAttribute('aria-valuetext', spec.format(value));
      const fill = element.querySelector<HTMLElement>('.slider-fill');
      const knob = element.querySelector<HTMLElement>('.slider-knob');
      if (!fill || !knob) throw new Error('screens: slider is missing its fill/knob');
      fill.style.width = `${(fraction * 100).toFixed(2)}%`;
      knob.style.left = `${(fraction * 100).toFixed(2)}%`;
      const valueLabel = settingsScreen.querySelector<HTMLElement>(`[data-value="${key}"]`);
      if (!valueLabel) throw new Error(`screens: no value label for ${key}`);
      valueLabel.textContent = spec.format(value);
    }
    motionToggle.classList.toggle('on', settings.reducedMotion);
    motionToggle.setAttribute('aria-checked', String(settings.reducedMotion));
    motionToggle.textContent = settings.reducedMotion ? 'ON' : 'OFF';
  };

  const setSliderFromPointer = (element: HTMLElement, key: string, clientX: number): void => {
    const spec = SLIDERS[key]!;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = spec.min + fraction * (spec.max - spec.min);
    const stepped = Math.round(raw / spec.step) * spec.step;
    const value = Math.max(spec.min, Math.min(spec.max, stepped));
    settings = withSetting(settings, key as keyof GameSettings, value);
    notifyChange();
  };

  for (const { element, key } of sliders) {
    const onPointerDown = (event: PointerEvent): void => {
      callbacks.onGesture();
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      setSliderFromPointer(element, key, event.clientX);
      const onMove = (move: PointerEvent): void => setSliderFromPointer(element, key, move.clientX);
      const onUp = (up: PointerEvent): void => {
        element.releasePointerCapture(up.pointerId);
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onUp);
      };
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', onUp);
      element.addEventListener('pointercancel', onUp);
    };
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('keydown', (event: KeyboardEvent): void => {
      const spec = SLIDERS[key]!;
      const value = settings[key as keyof GameSettings] as number;
      let next: number | null = null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - spec.step;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + spec.step;
      else if (event.key === 'Home') next = spec.min;
      else if (event.key === 'End') next = spec.max;
      if (next === null) return;
      event.preventDefault();
      callbacks.onGesture();
      settings = withSetting(
        settings,
        key as keyof GameSettings,
        Math.max(spec.min, Math.min(spec.max, next)),
      );
      notifyChange();
    });
  }

  const bind = (button: HTMLButtonElement, action: () => void): void => {
    button.addEventListener('click', () => {
      callbacks.onGesture();
      action();
    });
  };
  bind(play, callbacks.onPlay);
  bind(team, callbacks.onTeam);
  bind(spectate, callbacks.onSpectate);
  bind(settingsButton, () => showSettings('title'));
  bind(settingsBack, () => {
    callbacks.onSettingsClosed(settingsOrigin);
    if (settingsOrigin === 'pause') setScreen('pause');
    else setScreen('title');
  });
  bind(resume, callbacks.onResume);
  bind(pauseSettings, () => showSettings('pause'));
  bind(quit, callbacks.onQuit);
  motionToggle.addEventListener('click', () => {
    callbacks.onGesture();
    settings = withSetting(settings, 'reducedMotion', !settings.reducedMotion);
    notifyChange();
  });

  const showTitle = (): void => {
    setScreen('title');
    syncSliders();
    soundHint.textContent = soundUnlocked ? 'SOUND ENABLED' : 'CLICK TO ENABLE SOUND';
    soundHint.style.opacity = soundUnlocked ? '0.4' : '0.9';
  };
  const showSettings = (origin: SettingsOrigin): void => {
    settingsOrigin = origin;
    setScreen('settings');
    syncSliders();
    callbacks.onSettingsOpened(origin);
  };
  const showPause = (): void => {
    setScreen('pause');
  };

  play.focus({ preventScroll: true });
  syncSliders();
  showTitle();

  return {
    showTitle,
    showSettings,
    showPause,
    hideAll(): void {
      title.hidden = true;
      settingsScreen.hidden = true;
      pauseScreen.hidden = true;
    },
    setSoundUnlocked(unlocked: boolean): void {
      soundUnlocked = unlocked;
      soundHint.textContent = unlocked ? 'SOUND ENABLED' : 'CLICK TO ENABLE SOUND';
      soundHint.style.opacity = unlocked ? '0.4' : '0.9';
    },
    applySettings(next: GameSettings): void {
      settings = next;
      syncSliders();
    },
    isSettingsOpen(): boolean {
      return !settingsScreen.hidden;
    },
    isPauseOpen(): boolean {
      return !pauseScreen.hidden;
    },
  };
}
