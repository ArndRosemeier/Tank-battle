/**
 * The online session: one GameHub connection, the room on it, and the match running
 * in it. It turns hub events into room-state transitions (host) or room-state updates
 * (everyone else), starts and ends `NetMatch`es, and moves tick batches and commands.
 *
 * No DOM and no three.js: the UI subscribes to `onChange`, and main's frame loop calls
 * `frame()`. Errors from the network are LOUD: they reach `onNotice` (the UI shows
 * them), and a broken tick stream stops the match instead of guessing.
 */

import type { TankCommand } from '../core/sim.ts';
import type { GameHub, RoomSummary } from './gamehub.ts';
import { NetMatch } from './netMatch.ts';
import {
  encodeCommand,
  isCompatibleRoomMeta,
  parseIntent,
  parseRoomState,
  parseTickBatch,
  type Intent,
  type RoomSetup,
  type RoomState,
  type TickBatch,
  type WireCommand,
} from './protocol.ts';
import {
  addMember,
  changeRoomSetup,
  createRoomState,
  removeMember,
  returnToRoom,
  roomMeta,
  seatIndexOf,
  setMemberTeam,
  startRoomMatch,
} from './room.ts';

export type OnlineHub = GameHub<RoomState, TickBatch, Intent>;

/** How long a newly promoted host waits for the other peers' rows. */
export const MIGRATION_WAIT_MS = 750;
/** A client sends its command at most this often (the server allows 60 messages/s). */
const COMMAND_INTERVAL_SECONDS = 1 / 30;

export type OnlinePhase = 'connecting' | 'lobby' | 'room' | 'match' | 'closed';

export interface OnlineNotice {
  readonly level: 'info' | 'error';
  readonly text: string;
}

export interface OnlineSessionOptions {
  /** Schedules a callback; the browser passes `setTimeout`, tests a manual clock. */
  readonly schedule?: (callback: () => void, milliseconds: number) => void;
  /** A fresh match seed; the browser passes one drawn from `Math.random`. */
  readonly freshSeed: () => number;
}

export class OnlineSession {
  readonly hub: OnlineHub;
  phase: OnlinePhase = 'connecting';
  room: RoomState | null = null;
  match: NetMatch | null = null;

  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(notice: OnlineNotice) => void>();
  private readonly matchListeners = new Set<(match: NetMatch | null) => void>();
  private readonly schedule: (callback: () => void, milliseconds: number) => void;
  private readonly freshSeed: () => number;
  private pendingSetup: RoomSetup | null = null;
  private lastSent: WireCommand | null = null;
  private sinceSent = Number.POSITIVE_INFINITY;
  private migration: { readonly waiting: Set<number>; done: boolean } | null = null;

  constructor(hub: OnlineHub, options: OnlineSessionOptions) {
    this.hub = hub;
    this.schedule = options.schedule ?? ((callback, ms) => void setTimeout(callback, ms));
    this.freshSeed = options.freshSeed;

    hub.ready.then(
      () => {
        if (this.phase === 'connecting') this.setPhase('lobby');
      },
      (cause: unknown) => {
        this.notice('error', `Could not reach the game server: ${describe(cause)}`);
        this.setPhase('closed');
      },
    );
    hub.on('joined', () => this.guard('joining the room', () => this.onJoined()));
    hub.on('state', (data) => this.guard('reading the room state', () => this.onState(data)));
    hub.on('delta', (data) => this.guard('reading the match stream', () => this.onDelta(data)));
    hub.on('msg', (data, from) => this.guard(`reading a message from player ${from}`, () => this.onMessage(data, from)));
    hub.on('player+', (player) => this.guard('adding a player', () => {
      if (!hub.isHost || !this.room) return;
      this.publish(addMember(this.room, player.id, player.name));
    }));
    hub.on('player-', (id) => this.guard('removing a player', () => this.onPlayerLeft(id)));
    hub.on('host', (id) => this.guard('changing host', () => this.onHostChanged(id)));
    hub.on('need-snapshot', () => this.guard('sending a snapshot', () => {
      if (hub.isHost && this.room) this.publish(this.room);
    }));
    hub.on('error', (error) => {
      if (error.req !== undefined) return; // a request's own rejection reports it
      this.notice('error', `Game server error: ${error.code}`);
    });
    hub.on('close', () => {
      if (this.phase === 'closed') return;
      this.notice('error', 'The connection to the game server was lost.');
      this.endMatch();
      this.setPhase('closed');
    });
  }

  // ------------------------------------------------------------ subscriptions

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onNotice(listener: (notice: OnlineNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  /** Called with the new match at START, and with null when the room returns from it. */
  onMatch(listener: (match: NetMatch | null) => void): () => void {
    this.matchListeners.add(listener);
    return () => this.matchListeners.delete(listener);
  }

  // ------------------------------------------------------------ identity

  get you(): number | null {
    return this.hub.you;
  }

  get isHost(): boolean {
    return this.hub.isHost;
  }

  get roomCode(): string | null {
    return this.hub.room?.id ?? null;
  }

  get roomName(): string | null {
    return this.hub.room?.name ?? null;
  }

  /** This browser's seat in the running match, or null when it watches or waits. */
  get localSeat(): number | null {
    const match = this.room?.match;
    if (!match || this.you === null) return null;
    return seatIndexOf(match, this.you);
  }

  // ------------------------------------------------------------ lobby

  /** Live list of joinable Tank Battle rooms. */
  watchLobby(onRooms: (rooms: RoomSummary[]) => void): () => void {
    return this.hub.watchLobby((rooms) => onRooms(rooms.filter((room) => isCompatibleRoomMeta(room.meta))));
  }

  async createRoom(name: string, isPublic: boolean, setup: RoomSetup): Promise<void> {
    this.pendingSetup = setup;
    await this.hub.create({
      name,
      public: isPublic,
      maxPlayers: 16,
      meta: roomMeta(createRoomState(setup, { playerId: 0, name: '' })),
    });
  }

  async joinRoom(code: string): Promise<void> {
    await this.hub.join(code.trim().toUpperCase());
  }

  async leaveRoom(): Promise<void> {
    this.endMatch();
    await this.hub.leave();
    this.room = null;
    this.setPhase('lobby');
  }

  close(): void {
    this.phase = 'closed';
    this.hub.close();
  }

  // ------------------------------------------------------------ room actions

  chooseTeam(teamId: number): void {
    if (!this.room) throw new Error('online: not in a room');
    if (this.isHost) {
      this.publish(setMemberTeam(this.room, this.requireYou(), teamId));
    } else {
      this.sendToHost({ type: 'team', teamId });
    }
  }

  changeSetup(setup: RoomSetup): void {
    this.requireHost('change the setup');
    this.publish(changeRoomSetup(this.room!, setup));
  }

  start(): void {
    this.requireHost('start the match');
    if (this.room!.phase !== 'room') throw new Error('online: a match is already running');
    this.publish(startRoomMatch(this.room!, this.freshSeed()));
  }

  /** Host, after a match: everyone back to the room screen. */
  backToRoom(): void {
    this.requireHost('end the match');
    const tail = this.match?.role === 'host' ? this.match.flushPending() : null;
    if (tail) this.hub.sendDelta(tail);
    this.publish(returnToRoom(this.room!));
  }

  // ------------------------------------------------------------ per frame

  /**
   * Main's frame loop: the host produces ticks and sends them; a client consumes the
   * ticks it holds and sends its own command when it changed.
   */
  frame(frameSeconds: number, localCommand: (() => TankCommand) | null): void {
    const match = this.match;
    if (!match || this.migration) return;
    if (match.role === 'host') {
      for (const batch of match.produce(frameSeconds, localCommand)) this.hub.sendDelta(batch);
      return;
    }
    match.consume(frameSeconds);
    this.sinceSent += frameSeconds;
    if (localCommand && match.localSeat !== null && match.state.status === 'active') {
      const command = encodeCommand(localCommand());
      const changed = this.lastSent === null || command.some((value, index) => value !== this.lastSent![index]);
      if (changed && this.sinceSent >= COMMAND_INTERVAL_SECONDS) this.sendCommand(command);
    }
  }

  // ------------------------------------------------------------ hub events

  private onJoined(): void {
    if (this.hub.isHost) {
      const setup = this.pendingSetup;
      if (!setup) throw new Error('online: hosting a room without a setup');
      let room = createRoomState(setup, { playerId: this.requireYou(), name: this.myName() });
      for (const player of this.hub.players) room = addMember(room, player.id, player.name);
      this.publish(room);
    }
    this.setPhase('room');
  }

  private onState(data: unknown): void {
    if (this.hub.isHost) return; // the host's own state is authoritative locally
    const room = parseRoomState(data);
    const previous = this.room;
    this.room = room;
    if (room.phase === 'match' && room.match && this.match?.spec.matchNo !== room.match.matchNo) {
      const seat = seatIndexOf(room.match, this.requireYou());
      // A newcomer to a running match waits for the next one; only seated players play.
      if (seat !== null && previous !== null) this.beginMatch('client');
    } else if (room.phase === 'room' && this.match) {
      this.endMatch();
    }
    this.syncPhase();
    this.emit();
  }

  private onDelta(data: unknown): void {
    if (this.hub.isHost || !this.match) return;
    this.match.receive(parseTickBatch(data, this.match.spec.seats.length));
  }

  private onMessage(data: unknown, from: number): void {
    const room = this.room;
    if (!room) return;
    const intent = parseIntent(data, this.match?.spec.seats.length ?? 0, room.setup.teams);
    switch (intent.type) {
      case 'cmd': {
        if (!this.isHost || !this.match || intent.matchNo !== this.match.spec.matchNo) return;
        const seat = seatIndexOf(this.match.spec, from);
        if (seat === null || this.match.isHandedOver(seat)) return;
        this.match.setSeatCommand(seat, intent.c);
        return;
      }
      case 'team':
        if (!this.isHost) return;
        try {
          this.publish(setMemberTeam(room, from, intent.teamId));
        } catch (cause) {
          // A full team is a race between two players clicking; the room state the
          // host just published already shows it, so the refusal is reported, not fatal.
          this.notice('info', describe(cause));
        }
        return;
      case 'sync?': {
        if (!this.match || intent.matchNo !== this.match.spec.matchNo) return;
        const payload = this.match.syncPayload(intent.have);
        this.hub.send({ type: 'sync', matchNo: intent.matchNo, ...payload }, from);
        // Re-send our command to the new host.
        this.lastSent = null;
        return;
      }
      case 'sync': {
        const migration = this.migration;
        if (!migration || !this.match || intent.matchNo !== this.match.spec.matchNo) return;
        this.match.mergeSync(intent);
        this.peerHave.set(from, intent.from + intent.c.length);
        migration.waiting.delete(from);
        if (migration.waiting.size === 0) this.finishMigration();
        return;
      }
    }
  }

  private readonly peerHave = new Map<number, number>();

  private onPlayerLeft(id: number): void {
    this.migration?.waiting.delete(id);
    if (this.migration && this.migration.waiting.size === 0) this.finishMigration();
    if (!this.hub.isHost || !this.room) return;
    const match = this.match;
    if (match && match.role === 'host') {
      const seat = seatIndexOf(match.spec, id);
      if (seat !== null) match.handOver(seat);
    }
    this.publish(removeMember(this.room, id));
  }

  private onHostChanged(id: number): void {
    if (id !== this.you) {
      this.match?.becomeClient();
      this.lastSent = null;
      this.emit();
      return;
    }
    // Promoted. Continue from our copy of the room; reconcile who is still here.
    if (!this.room) return;
    const present = new Set(this.hub.players.map((player) => player.id));
    let room = this.room;
    for (const member of room.members) if (!present.has(member.playerId)) room = removeMember(room, member.playerId);
    for (const player of this.hub.players) room = addMember(room, player.id, player.name);
    this.room = room;
    this.notice('info', 'The host left. You are hosting now.');
    const match = this.match;
    if (!match) {
      this.publish(room);
      return;
    }
    const others = this.hub.players.filter((player) => player.id !== this.you).map((player) => player.id);
    this.migration = { waiting: new Set(others), done: false };
    this.peerHave.clear();
    for (const peer of others) this.hub.send({ type: 'sync?', matchNo: match.spec.matchNo, have: match.rowCount }, peer);
    if (others.length === 0) this.finishMigration();
    else this.schedule(() => this.guard('finishing the host hand-over', () => this.finishMigration()), MIGRATION_WAIT_MS);
  }

  private finishMigration(): void {
    const migration = this.migration;
    const match = this.match;
    if (!migration || migration.done || !match || !this.room) return;
    migration.done = true;
    this.migration = null;
    match.becomeHost();
    const present = new Set(this.hub.players.map((player) => player.id));
    match.spec.seats.forEach((seat, index) => {
      if (!present.has(seat.playerId)) match.handOver(index);
    });
    const haves = [...this.peerHave.values()];
    const from = haves.length > 0 ? Math.min(...haves) : match.rowCount;
    const resend = match.resendFrom(from);
    if (resend) this.hub.sendDelta(resend);
    this.publish(this.room);
  }

  // ------------------------------------------------------------ helpers

  private beginMatch(role: 'host' | 'client'): void {
    const spec = this.room?.match;
    if (!spec) throw new Error('online: START without a match spec');
    this.endMatch();
    this.match = new NetMatch({ spec, localSeat: seatIndexOf(spec, this.requireYou()), role });
    this.lastSent = null;
    this.sinceSent = Number.POSITIVE_INFINITY;
    for (const listener of this.matchListeners) listener(this.match);
  }

  private endMatch(): void {
    if (!this.match) return;
    this.match = null;
    this.migration = null;
    for (const listener of this.matchListeners) listener(null);
  }

  /** Host: the one way room state changes. Publishes it and the lobby meta. */
  private publish(room: RoomState): void {
    const previous = this.room;
    this.room = room;
    this.hub.setState(room);
    if (!previous || previous.phase !== room.phase || JSON.stringify(previous.setup) !== JSON.stringify(room.setup)) {
      this.hub.setRoom({ meta: roomMeta(room) });
    }
    if (room.phase === 'match' && room.match && this.match?.spec.matchNo !== room.match.matchNo) {
      this.beginMatch('host');
    } else if (room.phase === 'room' && this.match) {
      this.endMatch();
    }
    this.syncPhase();
    this.emit();
  }

  private syncPhase(): void {
    if (this.phase === 'closed') return;
    this.phase = this.match ? 'match' : 'room';
  }

  private setPhase(phase: OnlinePhase): void {
    this.phase = phase;
    this.emit();
  }

  private sendCommand(command: WireCommand): void {
    const match = this.match;
    if (!match) return;
    this.sendToHost({ type: 'cmd', matchNo: match.spec.matchNo, c: command });
    this.lastSent = command;
    this.sinceSent = 0;
  }

  private sendToHost(intent: Intent): void {
    const host = this.hub.host;
    if (host === null) throw new Error('online: the room has no host');
    this.hub.send(intent, host);
  }

  private myName(): string {
    const you = this.requireYou();
    return this.hub.players.find((player) => player.id === you)?.name ?? `PLAYER ${you}`;
  }

  private requireYou(): number {
    const you = this.hub.you;
    if (you === null) throw new Error('online: not connected yet');
    return you;
  }

  private requireHost(action: string): void {
    if (!this.isHost || !this.room) throw new Error(`online: only the host can ${action}`);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private notice(level: OnlineNotice['level'], text: string): void {
    for (const listener of this.noticeListeners) listener({ level, text });
  }

  /** Runs a hub handler; a failure is shown to the player and, mid-match, stops the match. */
  private guard(action: string, run: () => void): void {
    try {
      run();
    } catch (cause) {
      this.notice('error', `Online error while ${action}: ${describe(cause)}`);
      console.error(cause);
      if (this.match) this.endMatch();
      this.emit();
    }
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
