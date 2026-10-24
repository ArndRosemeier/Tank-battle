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
import {
  DEFAULT_MATCH_SETUP,
  MATCH_MINUTE_CHOICES,
  MIN_TANKS_PER_TEAM,
  MIN_TEAMS,
  DEFAULT_ARENA_SIZE,
  freshMatchSeed,
  parseArenaSeedText,
  stepArenaSize,
  stepMatchSetup,
  validateMatchSetup,
  type MatchSetup,
} from '../game/matchSetup.ts';
import { MAX_TANKS_PER_TEAM, MAX_TEAMS } from '../core/sim.ts';
import { ARENA_SIZES } from '../game/levels/generator.ts';

type ScreenName = 'title' | 'settings' | 'pause' | 'setup' | 'end';
type SettingsOrigin = 'title' | 'pause';

export interface ScreensCallbacks {
  readonly onPlay: () => void;
  /** The setup screen's START: the chosen, validated setup. */
  readonly onStartSetup: (setup: MatchSetup) => void;
  readonly onSpectate: () => void;
  /** The end screen's REMATCH. */
  readonly onRematch: () => void;
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
  showSetup(): void;
  /** The end-of-match panel; `color` is the headline's palette colour. */
  showEnd(headline: string, detail: string, color: string): void;
  isEndOpen(): boolean;
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
};

export function createScreens(initial: GameSettings, callbacks: ScreensCallbacks): Screens {
  const title = requireElement('title-screen', HTMLElement, 'title screen');
  const settingsScreen = requireElement('settings-screen', HTMLElement, 'settings screen');
  const pauseScreen = requireElement('pause-screen', HTMLElement, 'pause screen');
  const soundHint = requireElement('title-audio-hint', HTMLElement, 'audio hint');
  const play = requireElement('title-play', HTMLButtonElement, 'play button');
  const setupButton = requireElement('title-setup', HTMLButtonElement, 'battle setup button');
  const setupScreen = requireElement('setup-screen', HTMLElement, 'setup screen');
  const setupStart = requireElement('setup-start', HTMLButtonElement, 'setup start button');
  const setupBack = requireElement('setup-back', HTMLButtonElement, 'setup back button');
  const setupReroll = requireElement('setup-reroll', HTMLButtonElement, 'setup reroll button');
  const setupSummary = requireElement('setup-summary', HTMLElement, 'setup summary');
  const arenaSeedInput = requireElement('setup-arena-seed', HTMLInputElement, 'arena seed field');
  const arenaReroll = requireElement('setup-arena-reroll', HTMLButtonElement, 'arena random button');
  const arenaSeedRow = requireElement('setup-arena-seed-row', HTMLElement, 'arena seed row');
  const arenaSizeRow = requireElement('setup-arena-size-row', HTMLElement, 'arena size row');
  const endScreen = requireElement('end-screen', HTMLElement, 'end screen');
  const endHeadline = requireElement('end-headline', HTMLElement, 'end headline');
  const endDetail = requireElement('end-detail', HTMLElement, 'end detail');
  const endRematch = requireElement('end-rematch', HTMLButtonElement, 'rematch button');
  const endQuit = requireElement('end-quit', HTMLButtonElement, 'end quit button');
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
  if (sliders.length !== 4) {
    throw new Error(`screens: expected 4 drawn sliders, found ${sliders.length}`);
  }

  const setScreen = (name: ScreenName): void => {
    title.hidden = name !== 'title';
    settingsScreen.hidden = name !== 'settings';
    pauseScreen.hidden = name !== 'pause';
    setupScreen.hidden = name !== 'setup';
    endScreen.hidden = name !== 'end';
  };

  // ---- the custom battle setup ----
  let setup: MatchSetup = { ...DEFAULT_MATCH_SETUP, seed: freshMatchSeed(Math.random) };
  const modeButtons = [...setupScreen.querySelectorAll<HTMLButtonElement>('[data-setup-mode]')];
  const stepButtons = [...setupScreen.querySelectorAll<HTMLButtonElement>('[data-step]')];
  const arenaButtons = [...setupScreen.querySelectorAll<HTMLButtonElement>('[data-setup-arena]')];
  const arenaSizeButtons = [...setupScreen.querySelectorAll<HTMLButtonElement>('[data-arena-size-step]')];
  if (modeButtons.length !== 2 || stepButtons.length !== 6 || arenaButtons.length !== 2 || arenaSizeButtons.length !== 2) {
    throw new Error(
      `screens: setup expects 2 mode, 6 step, 2 arena and 2 arena-size buttons, found ` +
        `${modeButtons.length}/${stepButtons.length}/${arenaButtons.length}/${arenaSizeButtons.length}`,
    );
  }
  /** The generated arena's seed and size, kept while the player flips back to the Crucible. */
  let arenaSeed = freshMatchSeed(Math.random);
  let arenaSize = DEFAULT_ARENA_SIZE;
  /** False while the seed field holds text that is not a seed: START stays disabled. */
  let arenaSeedValid = true;
  const setupValue = (key: string): HTMLElement => {
    const element = setupScreen.querySelector<HTMLElement>(`[data-setup-value="${key}"]`);
    if (!element) throw new Error(`screens: setup has no value label for ${key}`);
    return element;
  };
  const syncSetup = (): void => {
    validateMatchSetup(setup);
    for (const button of modeButtons) {
      const on = button.dataset.setupMode === setup.mode;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    }
    setupValue('teams').textContent = String(setup.teams);
    setupValue('tanksPerTeam').textContent = String(setup.tanksPerTeam);
    setupValue('minutes').textContent = `${setup.minutes} MIN`;
    setupValue('seed').textContent = String(setup.seed);
    const generated = setup.arena.kind === 'generated';
    for (const button of arenaButtons) {
      const on = button.dataset.setupArena === setup.arena.kind;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    }
    arenaSeedRow.hidden = !generated;
    arenaSizeRow.hidden = !generated;
    if (document.activeElement !== arenaSeedInput) arenaSeedInput.value = String(arenaSeed);
    arenaSeedInput.classList.toggle('invalid', !arenaSeedValid);
    setupValue('arenaSize').textContent = arenaSize.toUpperCase();
    const sizeIndex = ARENA_SIZES.indexOf(arenaSize);
    for (const button of arenaSizeButtons) {
      const direction = Number(button.dataset.arenaSizeStep);
      button.disabled = direction < 0 ? sizeIndex <= 0 : sizeIndex >= ARENA_SIZES.length - 1;
    }
    setupStart.disabled = generated && !arenaSeedValid;
    for (const button of stepButtons) {
      const field = button.dataset.step;
      const direction = Number(button.dataset.dir);
      const value =
        field === 'teams' ? setup.teams : field === 'tanksPerTeam' ? setup.tanksPerTeam : setup.minutes;
      const [min, max] =
        field === 'teams'
          ? [MIN_TEAMS, MAX_TEAMS]
          : field === 'tanksPerTeam'
            ? [MIN_TANKS_PER_TEAM, MAX_TANKS_PER_TEAM]
            : [MATCH_MINUTE_CHOICES[0]!, MATCH_MINUTE_CHOICES[MATCH_MINUTE_CHOICES.length - 1]!];
      button.disabled = direction < 0 ? value <= min : value >= max;
    }
    const enemies = setup.teams - 1;
    const enemyText = `${enemies} ${enemies === 1 ? 'TEAM' : 'TEAMS'} OF ${setup.tanksPerTeam}`;
    if (setup.mode === 'spectate') {
      setupSummary.textContent = `ALL AI · ${setup.teams} TEAMS OF ${setup.tanksPerTeam}`;
    } else if (setup.tanksPerTeam === 1) {
      setupSummary.textContent = `YOU ALONE VS ${enemyText}`;
    } else {
      const mates = setup.tanksPerTeam - 1;
      setupSummary.textContent = `YOU + ${mates} ${mates === 1 ? 'SQUADMATE' : 'SQUADMATES'} VS ${enemyText}`;
    }
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
  bind(setupButton, () => showSetup());
  for (const button of modeButtons) {
    bind(button, () => {
      const mode = button.dataset.setupMode;
      if (mode !== 'team' && mode !== 'spectate') {
        throw new Error(`screens: unknown setup mode "${String(mode)}"`);
      }
      setup = validateMatchSetup({ ...setup, mode });
      syncSetup();
    });
  }
  for (const button of stepButtons) {
    bind(button, () => {
      const field = button.dataset.step;
      const direction = Number(button.dataset.dir);
      if (field !== 'teams' && field !== 'tanksPerTeam' && field !== 'minutes') {
        throw new Error(`screens: unknown setup field "${String(field)}"`);
      }
      if (direction !== -1 && direction !== 1) {
        throw new Error(`screens: setup step direction must be ±1, got ${String(direction)}`);
      }
      setup = stepMatchSetup(setup, field, direction);
      syncSetup();
    });
  }
  const setArena = (kind: string): void => {
    if (kind === 'crucible') {
      setup = validateMatchSetup({ ...setup, arena: { kind: 'crucible' } });
    } else if (kind === 'generated') {
      setup = validateMatchSetup({ ...setup, arena: { kind: 'generated', seed: arenaSeed, size: arenaSize } });
    } else {
      throw new Error(`screens: unknown arena "${kind}"`);
    }
  };
  for (const button of arenaButtons) {
    bind(button, () => {
      setArena(String(button.dataset.setupArena));
      syncSetup();
    });
  }
  for (const button of arenaSizeButtons) {
    bind(button, () => {
      const direction = Number(button.dataset.arenaSizeStep);
      if (direction !== -1 && direction !== 1) {
        throw new Error(`screens: arena size step must be ±1, got ${String(direction)}`);
      }
      setup = stepArenaSize(setup, direction);
      if (setup.arena.kind === 'generated') arenaSize = setup.arena.size;
      syncSetup();
    });
  }
  arenaSeedInput.addEventListener('input', () => {
    const parsed = parseArenaSeedText(arenaSeedInput.value);
    arenaSeedValid = parsed !== null;
    if (parsed !== null) {
      arenaSeed = parsed;
      setArena('generated');
    }
    syncSetup();
  });
  arenaSeedInput.addEventListener('keydown', (event: KeyboardEvent) => {
    // Keys typed into the seed must not drive a tank or open the pause menu.
    event.stopPropagation();
    if (event.key === 'Enter' && arenaSeedValid) setupStart.click();
  });
  arenaSeedInput.addEventListener('blur', () => syncSetup());
  bind(arenaReroll, () => {
    arenaSeed = freshMatchSeed(Math.random);
    arenaSeedValid = true;
    setArena('generated');
    syncSetup();
  });
  bind(setupReroll, () => {
    setup = validateMatchSetup({ ...setup, seed: freshMatchSeed(Math.random) });
    syncSetup();
  });
  bind(setupStart, () => {
    if (setup.arena.kind === 'generated' && !arenaSeedValid) return;
    callbacks.onStartSetup(validateMatchSetup(setup));
  });
  bind(setupBack, () => showTitle());
  bind(endRematch, callbacks.onRematch);
  bind(endQuit, callbacks.onQuit);
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
  const showSetup = (): void => {
    setScreen('setup');
    syncSetup();
    setupStart.focus({ preventScroll: true });
  };

  play.focus({ preventScroll: true });
  syncSliders();
  showTitle();

  return {
    showTitle,
    showSettings,
    showPause,
    showSetup,
    showEnd(headline: string, detail: string, color: string): void {
      endHeadline.textContent = headline;
      endHeadline.style.color = color;
      endDetail.textContent = detail;
      setScreen('end');
      endRematch.focus({ preventScroll: true });
    },
    isEndOpen(): boolean {
      return !endScreen.hidden;
    },
    hideAll(): void {
      title.hidden = true;
      settingsScreen.hidden = true;
      pauseScreen.hidden = true;
      setupScreen.hidden = true;
      endScreen.hidden = true;
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
