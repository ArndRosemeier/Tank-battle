/**
 * The minimal in-style HUD: three-segment hull HP, a reload ring, target HP, the
 * squad readout and fps. DOM only — no three.js, no simulation decisions. Colours come
 * from the one palette; the HUD never hardcodes a team identity.
 *
 * The squad panel is the player-team mode's readout: one row per AI squadmate with its
 * character name, three HP pips and a LIVE/KIA state. It is hidden in duel mode, where
 * there is no squad. The player's own block (HP segments + reload ring) is the same in
 * both modes.
 */

import { PALETTE, teamColor } from '../render/config.ts';
import type { MatchOutcome, MatchStatus } from '../core/sim.ts';

/** One AI squadmate's HUD row. */
export interface HudSquadMember {
  /** Character name, uppercased by the HUD (e.g. `sniper`). */
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

export interface HudState {
  readonly status: MatchStatus;
  readonly outcome: MatchOutcome | null;
  readonly winnerTeamId: number | null;
  readonly playerTeamId: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly reloadTicksRemaining: number;
  readonly reloadTicks: number;
  readonly fps: number;
  /** The duel's training target. Omitted in player-team mode (no single target). */
  readonly targetTeamId?: number;
  readonly targetHp?: number;
  readonly targetMaxHp?: number;
  /** The player's AI squadmates, in slot order. Omitted/empty hides the panel. */
  readonly squad?: readonly HudSquadMember[];
}

export interface Hud {
  update(state: HudState): void;
}

const HP_SEGMENTS = 3;
const SQUAD_ROWS = 3;

function segments(container: HTMLElement, className: string): readonly HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let index = 0; index < HP_SEGMENTS; index += 1) {
    const segment = document.createElement('span');
    segment.className = className;
    container.append(segment);
    result.push(segment);
  }
  return result;
}

interface SquadRow {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly pips: readonly HTMLElement[];
  readonly state: HTMLElement;
}

export function createHud(): Hud {
  const root = document.getElementById('hud');
  const player = document.getElementById('hud-player');
  const squad = document.getElementById('hud-squad');
  const squadList = document.getElementById('hud-squad-list');
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
    [squad, '#hud-squad'],
    [squadList, '#hud-squad-list'],
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

  const playerSegments = segments(playerHp!, 'hp-seg');
  const targetSegments = segments(targetHp!, 'hp-seg');
  const squadRows: SquadRow[] = [];
  for (let index = 0; index < SQUAD_ROWS; index += 1) {
    const row = document.createElement('div');
    row.className = 'squad-row';
    const name = document.createElement('span');
    name.className = 'squad-name';
    const hp = document.createElement('span');
    hp.className = 'squad-hp';
    const state = document.createElement('span');
    state.className = 'squad-state';
    row.append(name, hp, state);
    squadList!.append(row);
    squadRows.push({ root: row, name, pips: segments(hp, 'hp-seg'), state });
  }
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
      const playerColor = teamColor(state.playerTeamId);
      player!.style.color = playerColor;
      squad!.style.color = playerColor;
      if (state.targetTeamId !== undefined) {
        target!.style.color = teamColor(state.targetTeamId);
      }
      for (let index = 0; index < HP_SEGMENTS; index += 1) {
        playerSegments[index]?.classList.toggle('live', index < state.playerHp);
        targetSegments[index]?.classList.toggle('live', index < (state.targetHp ?? 0));
      }
      const hasTarget = state.targetHp !== undefined;
      target!.style.display = hasTarget ? 'grid' : 'none';
      if (hasTarget) {
        targetState!.textContent = (state.targetHp ?? 0) > 0 ? 'ACTIVE' : 'DESTROYED';
      }

      const squadMembers = state.squad ?? [];
      squad!.style.display = squadMembers.length > 0 ? 'grid' : 'none';
      for (let index = 0; index < SQUAD_ROWS; index += 1) {
        const row = squadRows[index]!;
        const member = squadMembers[index];
        row.root.style.display = member ? 'grid' : 'none';
        if (!member) {
          continue;
        }
        row.name.textContent = member.name.toUpperCase();
        row.root.classList.toggle('dead', !member.alive);
        row.state.textContent = member.alive ? 'LIVE' : 'KIA';
        for (let pip = 0; pip < HP_SEGMENTS; pip += 1) {
          row.pips[pip]?.classList.toggle('live', pip < member.hp);
        }
      }

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
