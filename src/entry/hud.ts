/**
 * The minimal in-style HUD: three-segment hull HP, a reload ring, target HP and fps.
 * DOM only — no three.js, no simulation decisions. Colours come from the one palette;
 * the HUD never hardcodes a team identity.
 */

import { PALETTE, teamColor } from '../render/config.ts';
import type { MatchOutcome, MatchStatus } from '../core/sim.ts';

export interface HudState {
  readonly status: MatchStatus;
  readonly outcome: MatchOutcome | null;
  readonly winnerTeamId: number | null;
  readonly playerTeamId: number;
  readonly targetTeamId: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly targetHp: number;
  readonly targetMaxHp: number;
  readonly reloadTicksRemaining: number;
  readonly reloadTicks: number;
  readonly fps: number;
}

export interface Hud {
  update(state: HudState): void;
}

const HP_SEGMENTS = 3;

function segments(container: HTMLElement): readonly HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let index = 0; index < HP_SEGMENTS; index += 1) {
    const segment = document.createElement('span');
    segment.className = 'hp-seg';
    container.append(segment);
    result.push(segment);
  }
  return result;
}

export function createHud(): Hud {
  const root = document.getElementById('hud');
  const player = document.getElementById('hud-player');
  const target = document.getElementById('hud-target');
  const playerHp = document.getElementById('hud-player-hp');
  const targetHp = document.getElementById('hud-target-hp');
  const targetState = document.getElementById('hud-target-state');
  const reloadArc = document.getElementById('hud-reload-arc');
  const reloadLabel = document.getElementById('hud-reload-label');
  const fps = document.getElementById('hud-fps');
  const banner = document.getElementById('hud-banner');
  for (const [element, label] of [
    [root, '#hud'],
    [player, '#hud-player'],
    [target, '#hud-target'],
    [playerHp, '#hud-player-hp'],
    [targetHp, '#hud-target-hp'],
    [targetState, '#hud-target-state'],
    [reloadArc, '#hud-reload-arc'],
    [reloadLabel, '#hud-reload-label'],
    [fps, '#hud-fps'],
    [banner, '#hud-banner'],
  ] as const) {
    if (!element) {
      throw new Error(`hud: ${label} is missing from index.html`);
    }
  }
  if (!(reloadArc instanceof SVGElement)) {
    throw new Error('hud: reload arc must be an SVG element');
  }

  const playerSegments = segments(playerHp!);
  const targetSegments = segments(targetHp!);
  const circumference = 2 * Math.PI * 12;
  reloadArc.style.strokeDasharray = `${circumference}`;

  root!.style.display = 'block';
  root!.style.color = PALETTE.debugText;
  player!.style.color = teamColor(0);
  target!.style.color = teamColor(1);
  banner!.style.color = PALETTE.iceWhite;
  fps!.style.color = PALETTE.debugText;

  let lastBanner = '';
  return {
    update(state: HudState): void {
      player!.style.color = teamColor(state.playerTeamId);
      target!.style.color = teamColor(state.targetTeamId);
      for (let index = 0; index < HP_SEGMENTS; index += 1) {
        playerSegments[index]?.classList.toggle('live', index < state.playerHp);
        targetSegments[index]?.classList.toggle('live', index < state.targetHp);
      }
      targetState!.textContent = state.targetHp > 0 ? 'ACTIVE' : 'DESTROYED';

      const reload = Math.max(0, Math.min(state.reloadTicks, state.reloadTicksRemaining));
      const ready = state.reloadTicks <= 0 ? 1 : 1 - reload / state.reloadTicks;
      reloadArc!.style.strokeDashoffset = `${circumference * (1 - ready)}`;
      reloadLabel!.textContent = reload === 0 ? 'READY' : 'RELOAD';

      fps!.textContent = `${state.fps.toFixed(0)} FPS`;

      let bannerText = '';
      if (state.status === 'ended') {
        bannerText =
          state.winnerTeamId === null
            ? 'DRAW'
            : state.winnerTeamId === state.playerTeamId
              ? 'VICTORY'
              : 'DEFEAT';
      }
      if (bannerText !== lastBanner) {
        lastBanner = bannerText;
        banner!.textContent = bannerText;
        banner!.style.display = bannerText === '' ? 'none' : 'block';
      }
    },
  };
}
