/**
 * The player's in-style HUD: the hull segments and reload ring, the squad readout, the
 * duel target, a compact kill feed, the victory/defeat banner and the aiming reticle.
 *
 * DOM only — no three.js, no simulation decisions. Colours come from the one palette;
 * the HUD never hardcodes a team identity. It is still a player readout, not a second
 * UI system: the aim projection is computed by `src/render/aimProjection.ts`, and the
 * HUD only turns its numbers into pixels.
 */

import { PALETTE, teamColor } from '../render/config.ts';
import type { DeathCause, MatchOutcome, MatchStatus } from '../core/sim.ts';
import { STEP_SECONDS } from '../core/timestep.ts';
import { formatClock } from '../game/matchResult.ts';

/** One AI squadmate's HUD row. */
export interface HudSquadMember {
  /** Character name, uppercased by the HUD (e.g. `sniper`). */
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

/** One kill-feed row: the sim's killer attribution plus the victim's name. */
export interface HudFeedEntry {
  readonly killerTeamId: number | null;
  readonly killerLabel: string;
  readonly victimTeamId: number;
  readonly victimLabel: string;
  readonly cause: DeathCause;
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
  /** Newest first. An empty/omitted list hides the feed. */
  readonly feed?: readonly HudFeedEntry[];
  /** 0…1 damage flash for the player's own hit; decays in the host loop. */
  readonly damageFlash?: number;
  /** Seconds before the time limit; omitted hides the match clock. */
  readonly secondsRemaining?: number;
}

/** Under this many seconds the match clock turns to the alarm colour. */
const CLOCK_URGENT_SECONDS = 30;

/** The projected aim, in the terms the HUD needs. */
export interface AimScreenState {
  readonly x: number;
  readonly y: number;
  readonly onScreen: boolean;
  readonly edgeX: number;
  readonly edgeY: number;
  readonly angleRadians: number;
  /** True when the pointer ray hit nothing inside the aim range. */
  readonly outOfRange?: boolean;
  /** The team whose tank the true impact hits, so the bracket can carry its colour. */
  readonly targetTeamId?: number | null;
}

export interface Hud {
  update(state: HudState): void;
}

export interface AimHud {
  /** `null` hides both the reticle and the edge indicator. */
  update(state: AimScreenState | null, width: number, height: number, color: string): void;
}

const HP_SEGMENTS = 3;
const SQUAD_ROWS = 3;
const FEED_ROWS = 4;

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

interface FeedRow {
  readonly root: HTMLElement;
  readonly bar: HTMLElement;
  readonly killer: HTMLElement;
  readonly victim: HTMLElement;
  readonly cause: HTMLElement;
}

function requireById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`hud: #${id} is missing from index.html`);
  }
  return element;
}

export function createHud(): Hud {
  const root = requireById('hud');
  const player = requireById('hud-player');
  const squad = requireById('hud-squad');
  const squadList = requireById('hud-squad-list');
  const target = requireById('hud-target');
  const playerHp = requireById('hud-player-hp');
  const playerHpLabel = requireById('hud-player-hp-label');
  const targetHp = requireById('hud-target-hp');
  const targetState = requireById('hud-target-state');
  const reloadArc = requireById('hud-reload-arc');
  const reloadLabel = requireById('hud-reload-label');
  const reloadValue = requireById('hud-reload-value');
  const fps = requireById('hud-fps');
  const banner = requireById('hud-banner');
  const clock = requireById('hud-clock');
  const feed = requireById('hud-feed');
  const feedList = requireById('hud-feed-list');
  const vignette = requireById('damage-vignette');
  if (!(reloadArc instanceof SVGElement)) {
    throw new Error('hud: reload arc must be an SVG element');
  }

  const playerSegments = segments(playerHp, 'hp-seg');
  const targetSegments = segments(targetHp, 'hp-seg');
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
    squadList.append(row);
    squadRows.push({ root: row, name, pips: segments(hp, 'hp-seg'), state });
  }

  const feedRows: FeedRow[] = [];
  for (let index = 0; index < FEED_ROWS; index += 1) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    const bar = document.createElement('span');
    bar.className = 'feed-bar';
    const killer = document.createElement('span');
    killer.className = 'feed-killer';
    const arrow = document.createElement('span');
    arrow.className = 'feed-arrow';
    arrow.textContent = '→';
    const victim = document.createElement('span');
    victim.className = 'feed-victim';
    const cause = document.createElement('span');
    cause.className = 'feed-cause';
    row.append(bar, killer, arrow, victim, cause);
    feedList.append(row);
    feedRows.push({ root: row, bar, killer, victim, cause });
  }

  const circumference = 2 * Math.PI * 12;
  reloadArc.style.strokeDasharray = `${circumference}`;

  root.style.display = 'block';
  root.style.color = PALETTE.debugText;
  player.style.color = teamColor(0);
  squad.style.color = teamColor(0);
  target.style.color = teamColor(1);
  feed.style.color = PALETTE.debugText;
  banner.style.color = PALETTE.iceWhite;
  fps.style.color = PALETTE.debugText;

  let lastBanner = '';
  return {
    update(state: HudState): void {
      const playerColor = teamColor(state.playerTeamId);
      player.style.color = playerColor;
      squad.style.color = playerColor;
      if (state.targetTeamId !== undefined) {
        target.style.color = teamColor(state.targetTeamId);
      }

      for (let index = 0; index < HP_SEGMENTS; index += 1) {
        playerSegments[index]?.classList.toggle('live', index < state.playerHp);
        targetSegments[index]?.classList.toggle('live', index < (state.targetHp ?? 0));
      }
      playerHpLabel.textContent = `${state.playerHp} / ${state.playerMaxHp}`;
      const hasTarget = state.targetHp !== undefined;
      target.style.display = hasTarget ? 'grid' : 'none';
      if (hasTarget) {
        targetState.textContent = (state.targetHp ?? 0) > 0 ? 'ACTIVE' : 'DESTROYED';
      }

      const squadMembers = state.squad ?? [];
      squad.style.display = squadMembers.length > 0 ? 'grid' : 'none';
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
      reloadArc.style.strokeDashoffset = `${circumference * (1 - ready)}`;
      reloadLabel.textContent = reload === 0 ? 'READY' : 'RELOAD';
      reloadValue.textContent =
        reload === 0 ? 'GUN READY' : `${(reload * STEP_SECONDS).toFixed(1)} S`;

      const entries = state.feed ?? [];
      feed.style.display = entries.length > 0 ? 'grid' : 'none';
      for (let index = 0; index < FEED_ROWS; index += 1) {
        const row = feedRows[index]!;
        const entry = entries[index];
        row.root.style.display = entry ? 'flex' : 'none';
        if (!entry) {
          continue;
        }
        const killerColor =
          entry.killerTeamId === null ? PALETTE.iceWhite : teamColor(entry.killerTeamId);
        row.bar.style.color = killerColor;
        row.killer.style.color = killerColor;
        row.killer.textContent = entry.killerLabel;
        row.victim.style.color = teamColor(entry.victimTeamId);
        row.victim.textContent = entry.victimLabel;
        row.cause.textContent = entry.cause.toUpperCase();
      }

      const flash = Math.max(0, Math.min(1, state.damageFlash ?? 0));
      vignette.style.opacity = (flash * 0.9).toFixed(3);

      fps.textContent = `${state.fps.toFixed(0)} FPS`;

      if (state.secondsRemaining === undefined || state.status === 'ended') {
        clock.style.display = 'none';
      } else {
        const remaining = Math.max(0, Math.ceil(state.secondsRemaining));
        clock.style.display = 'block';
        clock.textContent = formatClock(remaining);
        clock.style.color =
          remaining <= CLOCK_URGENT_SECONDS ? PALETTE.error : PALETTE.debugText;
      }

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
        banner.textContent = bannerText;
        banner.style.display = bannerText === '' ? 'none' : 'block';
      }
    },
  };
}

/**
 * The projected IMPACT reticle (P6). Its position is the clamped shell's true impact
 * point, not a fixed centre or the pointer; a team-coloured corner bracket marks a tank
 * hit. If the point is behind the camera the safe-edge fallback and chevron still apply.
 */
export function createAimHud(): AimHud {
  const reticle = requireById('aim-reticle');
  const edge = requireById('aim-edge');
  const target = requireById('aim-target');
  return {
    update(state: AimScreenState | null, width: number, height: number, color: string): void {
      if (!state || width <= 0 || height <= 0) {
        reticle.style.display = 'none';
        edge.style.display = 'none';
        target.style.display = 'none';
        return;
      }
      const ndcX = state.onScreen ? state.x : state.edgeX;
      const ndcY = state.onScreen ? state.y : state.edgeY;
      const x = (ndcX * 0.5 + 0.5) * width;
      const y = (1 - (ndcY * 0.5 + 0.5)) * height;
      reticle.style.display = 'block';
      reticle.style.color = color;
      reticle.style.left = `${x.toFixed(1)}px`;
      reticle.style.top = `${y.toFixed(1)}px`;
      reticle.classList.toggle('offscreen', !state.onScreen);
      reticle.classList.toggle('out-of-range', state.outOfRange === true);

      const targetTeamId = state.targetTeamId;
      const showTarget = state.onScreen && targetTeamId !== null && targetTeamId !== undefined;
      target.style.display = showTarget ? 'block' : 'none';
      if (showTarget) {
        target.style.color = teamColor(targetTeamId);
        target.style.left = `${x.toFixed(1)}px`;
        target.style.top = `${y.toFixed(1)}px`;
      }

      if (state.onScreen) {
        edge.style.display = 'none';
        return;
      }
      target.style.display = 'none';
      // Push the chevron a little outward from the clamped reticle along the aim's
      // screen direction. CSS rotate() is clockwise with y-down; the projection's
      // angle is counter-clockwise with y-up, so the sign flips.
      const offset = 22;
      const edgeX = x + Math.cos(state.angleRadians) * offset;
      const edgeY = y - Math.sin(state.angleRadians) * offset;
      edge.style.display = 'block';
      edge.style.color = color;
      edge.style.left = `${edgeX.toFixed(1)}px`;
      edge.style.top = `${edgeY.toFixed(1)}px`;
      edge.style.transform = `translate(-50%, -50%) rotate(${(-state.angleRadians).toFixed(4)}rad)`;
    },
  };
}
