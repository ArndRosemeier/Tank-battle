/**
 * The online front door, drawn in the same TRON panels as the other screens:
 *
 *  - CONNECT: pick a pilot name.
 *  - LOBBY: the live list of open rooms, join by code, or host a new room.
 *  - HOST: room name, public/private and the battle setup.
 *  - ROOM: who is on which team, the invite code/link, START for the host.
 *
 * It renders from `OnlineSession` state on every change; it never holds game state of
 * its own beyond form fields. Every notice from the session (errors included) is shown
 * in the panel's notice line, so nothing online fails silently.
 */

import { MAX_TANKS_PER_TEAM, MAX_TEAMS } from '../core/sim.ts';
import { MATCH_MINUTE_CHOICES, MIN_TANKS_PER_TEAM, MIN_TEAMS } from '../game/matchSetup.ts';
import { teamCounts, DEFAULT_ROOM_SETUP } from '../net/room.ts';
import type { RoomSummary } from '../net/gamehub.ts';
import type { OnlineNotice, OnlineSession } from '../net/onlineSession.ts';
import type { RoomSetup } from '../net/protocol.ts';
import { teamName } from '../game/matchResult.ts';
import { requireElement } from './dom.ts';

const NAME_KEY = 'tank-battle.online-name';

export interface OnlineScreensCallbacks {
  /** Opens a GameHub connection under this pilot name. */
  readonly connect: (name: string) => OnlineSession;
  readonly onBack: () => void;
  readonly onGesture: () => void;
  /** A colour per team id, from the game palette. */
  readonly teamColor: (teamId: number) => string;
}

export interface OnlineScreens {
  /** Shows the online screen; `joinCode` joins that room straight away (a lobby link). */
  show(joinCode?: string): void;
  hide(): void;
  isOpen(): boolean;
  readonly session: OnlineSession | null;
}

type View = 'connect' | 'lobby' | 'host' | 'room';

function loadName(): string {
  try {
    const stored = window.localStorage.getItem(NAME_KEY);
    if (stored && stored.trim().length > 0) return stored.trim().slice(0, 16);
  } catch {
    // Storage blocked (private mode): the name is a convenience, a fresh one is fine.
  }
  return `PILOT ${Math.floor(100 + Math.random() * 900)}`;
}

function saveName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage blocked: the name is not remembered, which only costs retyping it.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  element.append(...children);
  return element;
}

export function createOnlineScreens(callbacks: OnlineScreensCallbacks): OnlineScreens {
  const screen = requireElement('online-screen', HTMLElement, 'online screen');
  const body = requireElement('online-body', HTMLElement, 'online panel body');
  const noticeLine = requireElement('online-notice', HTMLElement, 'online notice line');
  const heading = requireElement('online-heading', HTMLElement, 'online heading');
  const eyebrow = requireElement('online-eyebrow', HTMLElement, 'online eyebrow');

  let session: OnlineSession | null = null;
  let view: View = 'connect';
  let rooms: RoomSummary[] = [];
  let stopLobby: (() => void) | null = null;
  let pendingJoin: string | null = null;
  let name = loadName();
  /** The room name the host typed; null until edited, so it follows the pilot name. */
  let hostName: string | null = null;
  let hostPublic = true;
  let hostSetup: RoomSetup = { ...DEFAULT_ROOM_SETUP };
  let busy = false;

  const showNotice = (notice: OnlineNotice | null): void => {
    noticeLine.textContent = notice?.text ?? '';
    noticeLine.classList.toggle('error', notice?.level === 'error');
  };

  const button = (label: string, sub: string | null, action: () => void | Promise<void>, disabled = false): HTMLButtonElement => {
    const b = el('button', { className: 'tron-button' }, label);
    b.type = 'button';
    if (sub) b.append(el('span', { text: sub }));
    b.disabled = disabled || busy;
    b.addEventListener('click', () => {
      callbacks.onGesture();
      run(action);
    });
    return b;
  };

  const toggle = (label: string, on: boolean, action: () => void, disabled = false): HTMLButtonElement => {
    const b = el('button', { className: `settings-toggle${on ? ' on' : ''}`, text: label });
    b.type = 'button';
    b.disabled = disabled;
    b.addEventListener('click', () => {
      callbacks.onGesture();
      run(action);
    });
    return b;
  };

  /** Runs a UI action; a failure is shown on the notice line, never swallowed. */
  const run = (action: () => void | Promise<void>): void => {
    try {
      const result = action();
      if (result instanceof Promise) {
        busy = true;
        render();
        result
          .catch((cause: unknown) => showNotice({ level: 'error', text: describeJoinError(cause) }))
          .finally(() => {
            busy = false;
            render();
          });
      } else {
        render();
      }
    } catch (cause) {
      showNotice({ level: 'error', text: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const stepper = (
    label: string,
    value: string,
    canDown: boolean,
    canUp: boolean,
    onStep: (direction: -1 | 1) => void,
    enabled = true,
  ): HTMLElement => {
    const down = el('button', { className: 'stepper-button', text: '◀' });
    const up = el('button', { className: 'stepper-button', text: '▶' });
    down.type = 'button';
    up.type = 'button';
    down.disabled = !enabled || !canDown;
    up.disabled = !enabled || !canUp;
    down.setAttribute('aria-label', `Less ${label.toLowerCase()}`);
    up.setAttribute('aria-label', `More ${label.toLowerCase()}`);
    down.addEventListener('click', () => run(() => onStep(-1)));
    up.addEventListener('click', () => run(() => onStep(1)));
    return el(
      'div',
      { className: 'setting-row' },
      el('span', { className: 'setting-label', text: label }),
      el('div', { className: 'stepper' }, down, el('span', { className: 'stepper-value', text: value }), up),
      el('span'),
    );
  };

  const setupSteppers = (setup: RoomSetup, onChange: (next: RoomSetup) => void, enabled: boolean): HTMLElement[] => {
    const minuteIndex = MATCH_MINUTE_CHOICES.indexOf(setup.minutes);
    return [
      stepper('TEAMS', String(setup.teams), setup.teams > MIN_TEAMS, setup.teams < MAX_TEAMS, (d) =>
        onChange({ ...setup, teams: setup.teams + d }), enabled),
      stepper('TANKS / TEAM', String(setup.tanksPerTeam), setup.tanksPerTeam > MIN_TANKS_PER_TEAM, setup.tanksPerTeam < MAX_TANKS_PER_TEAM, (d) =>
        onChange({ ...setup, tanksPerTeam: setup.tanksPerTeam + d }), enabled),
      stepper('TIME LIMIT', `${setup.minutes} MIN`, minuteIndex > 0, minuteIndex < MATCH_MINUTE_CHOICES.length - 1, (d) =>
        onChange({ ...setup, minutes: MATCH_MINUTE_CHOICES[minuteIndex + d]! }), enabled),
    ];
  };

  const textInput = (value: string, maxLength: number, onInput: (value: string) => void, label: string): HTMLInputElement => {
    const input = el('input', { className: 'online-input' });
    input.type = 'text';
    input.value = value;
    input.maxLength = maxLength;
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => onInput(input.value));
    // Typing must not drive the tank or trigger the title's shortcuts.
    input.addEventListener('keydown', (event) => event.stopPropagation());
    return input;
  };

  const ensureSession = (): OnlineSession => {
    if (session && session.phase !== 'closed') return session;
    const trimmed = name.trim().toUpperCase().slice(0, 16);
    if (trimmed.length === 0) throw new Error('Pick a pilot name first.');
    name = trimmed;
    saveName(name);
    session = callbacks.connect(name);
    session.onChange(() => {
      if (!session) return;
      if (session.phase === 'room' || session.phase === 'match') view = 'room';
      if (session.phase === 'lobby' && view === 'connect') view = 'lobby';
      if (session.phase === 'closed') view = 'connect';
      if (session.phase === 'lobby' && pendingJoin) {
        const code = pendingJoin;
        pendingJoin = null;
        run(() => session!.joinRoom(code));
      }
      render();
    });
    session.onNotice(showNotice);
    return session;
  };

  const startLobbyWatch = (): void => {
    if (stopLobby || !session) return;
    stopLobby = session.watchLobby((next) => {
      rooms = next;
      if (view === 'lobby') render();
    });
  };

  const stopLobbyWatch = (): void => {
    stopLobby?.();
    stopLobby = null;
  };

  // ------------------------------------------------------------ views

  const renderConnect = (): void => {
    eyebrow.textContent = 'NETWORK // GAMEHUB';
    heading.textContent = 'ONLINE';
    const input = textInput(name, 16, (value) => (name = value), 'Pilot name');
    body.append(
      el('div', { className: 'setting-row' }, el('span', { className: 'setting-label', text: 'PILOT NAME' }), input, el('span')),
      el(
        'div',
        { className: 'screen-actions' },
        button('CONNECT', 'GAMEHUB', () => {
          ensureSession();
          view = 'lobby';
        }),
        button('BACK', null, () => callbacks.onBack()),
      ),
    );
  };

  const renderLobby = (): void => {
    eyebrow.textContent = `NETWORK // ${name}`;
    heading.textContent = 'LOBBY';
    const s = session;
    if (!s || s.phase === 'connecting') {
      body.append(el('div', { className: 'setup-summary', text: 'CONNECTING TO GAMEHUB…' }));
    } else {
      startLobbyWatch();
      const list = el('div', { className: 'online-rooms' });
      if (rooms.length === 0) list.append(el('div', { className: 'online-empty', text: 'NO OPEN ROOMS. HOST ONE!' }));
      for (const room of rooms) {
        const meta = room.meta as { phase: string; setup: RoomSetup };
        const status = meta.phase === 'match' ? 'IN BATTLE' : 'IN ROOM';
        const row = button(
          room.name,
          `${room.players}/${room.maxPlayers} · ${meta.setup.teams}×${meta.setup.tanksPerTeam} · ${status}`,
          () => s.joinRoom(room.id),
        );
        list.append(row);
      }
      let code = '';
      const codeInput = textInput('', 6, (value) => (code = value), 'Room code');
      codeInput.placeholder = 'CODE';
      body.append(
        list,
        el(
          'div',
          { className: 'setting-row' },
          el('span', { className: 'setting-label', text: 'JOIN BY CODE' }),
          codeInput,
          toggle('JOIN', false, () => {
            if (code.trim().length !== 6) throw new Error('A room code has 6 characters.');
            run(() => s.joinRoom(code));
          }),
        ),
      );
    }
    body.append(
      el(
        'div',
        { className: 'screen-actions' },
        button('HOST', 'NEW ROOM', () => {
          view = 'host';
        }, !s || s.phase === 'connecting'),
        button('BACK', null, () => {
          stopLobbyWatch();
          callbacks.onBack();
        }),
      ),
    );
  };

  const renderHost = (): void => {
    eyebrow.textContent = 'NETWORK // NEW ROOM';
    heading.textContent = 'HOST';
    const s = session;
    body.append(
      el('div', { className: 'setting-row' }, el('span', { className: 'setting-label', text: 'ROOM NAME' }),
        textInput(hostName ?? `${name}'S ROOM`, 32, (value) => (hostName = value), 'Room name'), el('span')),
      el('div', { className: 'setting-row' }, el('span', { className: 'setting-label', text: 'VISIBILITY' }),
        el('div', { className: 'choice-group' },
          toggle('PUBLIC', hostPublic, () => { hostPublic = true; render(); }),
          toggle('INVITE ONLY', !hostPublic, () => { hostPublic = false; render(); })),
        el('span')),
      ...setupSteppers(hostSetup, (next) => { hostSetup = next; render(); }, true),
      el('div', { className: 'setup-summary', text: 'EMPTY SEATS ARE FILLED WITH AI TANKS' }),
      el('div', { className: 'screen-actions' },
        button('CREATE', 'ROOM', async () => {
          if (!s) throw new Error('Not connected.');
          const roomName = (hostName ?? `${name}'S ROOM`).trim().toUpperCase();
          if (roomName.length === 0) throw new Error('Give the room a name.');
          stopLobbyWatch();
          await s.createRoom(roomName, hostPublic, hostSetup);
        }),
        button('BACK', null, () => { view = 'lobby'; })),
    );
  };

  const renderRoom = (): void => {
    const s = session;
    const room = s?.room;
    eyebrow.textContent = `ROOM ${s?.roomCode ?? '……'} // ${s?.isHost ? 'YOU HOST' : 'GUEST'}`;
    heading.textContent = s?.roomName ?? 'ROOM';
    if (!s || !room) {
      body.append(el('div', { className: 'setup-summary', text: 'JOINING…' }));
      return;
    }
    const you = s.you;
    const counts = teamCounts(room);
    const teams = el('div', { className: 'online-teams' });
    for (let team = 0; team < room.setup.teams; team += 1) {
      const column = el('div', { className: 'online-team' });
      column.style.color = callbacks.teamColor(team);
      column.append(el('div', { className: 'online-team-name', text: `${teamName(team)} · ${counts[team]}/${room.setup.tanksPerTeam}` }));
      for (const member of room.members.filter((candidate) => candidate.teamId === team)) {
        const row = el('div', { className: 'online-member', text: member.name });
        if (member.playerId === you) row.classList.add('you');
        column.append(row);
      }
      const ai = room.setup.tanksPerTeam - counts[team]!;
      for (let index = 0; index < ai; index += 1) column.append(el('div', { className: 'online-member ai', text: 'AI' }));
      const mine = room.members.find((member) => member.playerId === you)?.teamId === team;
      if (!mine && room.phase === 'room') {
        column.append(toggle('JOIN TEAM', false, () => s.chooseTeam(team), counts[team]! >= room.setup.tanksPerTeam));
      }
      teams.append(column);
    }
    body.append(teams);
    if (s.isHost && room.phase === 'room') {
      body.append(...setupSteppers(room.setup, (next) => s.changeSetup(next), true));
    } else {
      body.append(el('div', { className: 'setup-summary', text: `${room.setup.teams} TEAMS × ${room.setup.tanksPerTeam} · ${room.setup.minutes} MIN` }));
    }
    const link = inviteLink(s.roomCode);
    const status =
      room.phase === 'match'
        ? 'A BATTLE IS RUNNING. YOU PLAY IN THE NEXT ONE.'
        : s.isHost
          ? 'PRESS START WHEN EVERYONE IS IN. EMPTY SEATS ARE AI.'
          : 'WAITING FOR THE HOST TO START…';
    body.append(
      el('div', { className: 'setup-summary', text: status }),
      el('div', { className: 'online-invite' }, `INVITE: CODE ${s.roomCode ?? ''} · `, el('span', { className: 'online-link', text: link })),
    );
    const actions = el('div', { className: 'screen-actions' });
    if (s.isHost && room.phase === 'room') actions.append(button('START', 'DEPLOY', () => s.start()));
    actions.append(
      button('COPY LINK', null, async () => {
        await navigator.clipboard.writeText(link);
        showNotice({ level: 'info', text: 'Invite link copied.' });
      }),
      button('LEAVE', null, async () => {
        await s.leaveRoom();
        view = 'lobby';
      }),
    );
    body.append(actions);
  };

  const render = (): void => {
    if (screen.hidden) return;
    const focusedLabel = document.activeElement instanceof HTMLInputElement ? document.activeElement.getAttribute('aria-label') : null;
    body.replaceChildren();
    if (view === 'connect') renderConnect();
    else if (view === 'lobby') renderLobby();
    else if (view === 'host') renderHost();
    else renderRoom();
    // Re-rendering on a network update must not steal the field being typed into.
    if (focusedLabel) body.querySelector<HTMLInputElement>(`input[aria-label="${focusedLabel}"]`)?.focus();
  };

  return {
    show(joinCode?: string): void {
      screen.hidden = false;
      showNotice(null);
      if (joinCode) {
        pendingJoin = joinCode;
        run(() => {
          const s = ensureSession();
          if (s.phase === 'lobby') {
            pendingJoin = null;
            return s.joinRoom(joinCode);
          }
        });
      }
      if (session && (session.phase === 'room' || session.phase === 'match')) view = 'room';
      render();
    },
    hide(): void {
      screen.hidden = true;
    },
    isOpen(): boolean {
      return !screen.hidden;
    },
    get session() {
      return session;
    },
  };
}

function inviteLink(code: string | null): string {
  const url = new URL(window.location.href);
  url.search = code ? `?room=${code}` : '';
  url.hash = '';
  return url.toString();
}

function describeJoinError(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code;
  if (code === 'no_such_room') return 'That room does not exist any more.';
  if (code === 'room_full') return 'That room is full.';
  if (code === 'already_in_room') return 'You are already in a room.';
  return cause instanceof Error ? cause.message : String(cause);
}
