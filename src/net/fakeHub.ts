/**
 * An in-memory stand-in for the GameHub server, for tests: rooms, host promotion to
 * the lowest id, ordered delivery, and the late-joiner replay of the latest state plus
 * the deltas after it. Messages queue until `flush()`, like a real network round trip.
 */

import type { CreateRoomOptions, GameHub, HubEvents, PlayerInfo, RoomSummary } from './gamehub.ts';

interface FakeRoom {
  summary: RoomSummary;
  members: Map<number, FakeClient<unknown, unknown, unknown>>;
  snapshot: unknown;
  deltas: unknown[];
}

export class FakeServer {
  private nextPlayer = 1;
  private nextRoom = 1;
  private readonly rooms = new Map<string, FakeRoom>();
  private readonly lobby = new Set<FakeClient<unknown, unknown, unknown>>();
  private queue: (() => void)[] = [];

  connect<S, D, M>(name: string): GameHub<S, D, M> & FakeClient<S, D, M> {
    return new FakeClient<S, D, M>(this, this.nextPlayer++, name) as GameHub<S, D, M> & FakeClient<S, D, M>;
  }

  /** Delivers every queued message, including the ones that delivery causes. */
  flush(): void {
    for (let rounds = 0; this.queue.length > 0; rounds += 1) {
      if (rounds > 10_000) throw new Error('fakeHub: message storm');
      const batch = this.queue;
      this.queue = [];
      for (const deliver of batch) deliver();
    }
  }

  /** @internal */
  post(deliver: () => void): void {
    this.queue.push(deliver);
  }

  /** @internal */
  create(client: FakeClient<unknown, unknown, unknown>, options: CreateRoomOptions): RoomSummary {
    const id = `R${String(this.nextRoom++).padStart(5, '0')}`;
    const room: FakeRoom = {
      summary: {
        id,
        name: options.name ?? id,
        public: options.public ?? true,
        players: 0,
        maxPlayers: options.maxPlayers ?? 16,
        meta: options.meta ?? null,
        host: client.you!,
        createdAt: 0,
      },
      members: new Map(),
      snapshot: null,
      deltas: [],
    };
    this.rooms.set(id, room);
    this.join(client, id);
    return room.summary;
  }

  /** @internal */
  join(client: FakeClient<unknown, unknown, unknown>, id: string): RoomSummary {
    const room = this.rooms.get(id);
    if (!room) throw Object.assign(new Error('gamehub: no_such_room'), { code: 'no_such_room' });
    if (room.members.size >= room.summary.maxPlayers) throw Object.assign(new Error('gamehub: room_full'), { code: 'room_full' });
    const players = [...room.members.values()].map((member) => member.info);
    for (const member of room.members.values()) this.post(() => member.receive('player+', client.info));
    room.members.set(client.you!, client);
    room.summary.players = room.members.size;
    const snapshot = room.snapshot;
    const deltas = [...room.deltas];
    this.post(() => client.receiveJoined(room.summary, [...players, client.info], snapshot, deltas));
    this.lobbyChanged();
    return room.summary;
  }

  /** @internal */
  leave(client: FakeClient<unknown, unknown, unknown>): void {
    const room = client.roomId ? this.rooms.get(client.roomId) : undefined;
    if (!room) return;
    room.members.delete(client.you!);
    room.summary.players = room.members.size;
    for (const member of room.members.values()) this.post(() => member.receive('player-', client.you!));
    if (room.summary.host === client.you && room.members.size > 0) {
      room.summary.host = Math.min(...room.members.keys());
      for (const member of room.members.values()) this.post(() => member.receiveHost(room.summary.host));
    }
    this.lobbyChanged();
  }

  /** @internal */
  setState(client: FakeClient<unknown, unknown, unknown>, data: unknown): void {
    const room = this.requireHostRoom(client);
    room.snapshot = structuredClone(data);
    room.deltas = [];
    for (const member of room.members.values()) {
      if (member !== client) this.post(() => member.receive('state', structuredClone(data), 0));
    }
  }

  /** @internal */
  sendDelta(client: FakeClient<unknown, unknown, unknown>, data: unknown): void {
    const room = this.requireHostRoom(client);
    room.deltas.push(structuredClone(data));
    for (const member of room.members.values()) {
      if (member !== client) this.post(() => member.receive('delta', structuredClone(data), 0));
    }
  }

  /** @internal */
  send(client: FakeClient<unknown, unknown, unknown>, data: unknown, to?: number): void {
    const room = client.roomId ? this.rooms.get(client.roomId) : undefined;
    if (!room) throw new Error('fakeHub: not_in_room');
    for (const member of room.members.values()) {
      if (member === client || (to !== undefined && member.you !== to)) continue;
      this.post(() => member.receive('msg', structuredClone(data), client.you!));
    }
  }

  /** @internal */
  setRoom(client: FakeClient<unknown, unknown, unknown>, meta: unknown): void {
    const room = this.requireHostRoom(client);
    room.summary.meta = meta;
    this.lobbyChanged();
  }

  /** @internal */
  watch(client: FakeClient<unknown, unknown, unknown>, on: boolean): void {
    if (on) this.lobby.add(client);
    else this.lobby.delete(client);
    if (on) this.post(() => client.receive('lobby', this.publicRooms()));
  }

  private lobbyChanged(): void {
    for (const client of this.lobby) this.post(() => client.receive('lobby', this.publicRooms()));
  }

  private publicRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.summary.public && room.members.size > 0)
      .map((room) => ({ ...room.summary }));
  }

  private requireHostRoom(client: FakeClient<unknown, unknown, unknown>): FakeRoom {
    const room = client.roomId ? this.rooms.get(client.roomId) : undefined;
    if (!room || room.summary.host !== client.you) throw new Error('fakeHub: not_host');
    return room;
  }
}

type AnyFn = (...args: unknown[]) => void;

export class FakeClient<S, D, M> {
  readonly ready: Promise<{ you: number; name: string }>;
  readonly info: PlayerInfo;
  roomId: string | null = null;
  private hostId: number | null = null;
  private roomSummary: RoomSummary | null = null;
  private readonly members = new Map<number, PlayerInfo>();
  private readonly handlers = new Map<string, Set<AnyFn>>();
  private closed = false;

  constructor(
    private readonly server: FakeServer,
    readonly you: number,
    name: string,
  ) {
    this.info = { id: you, name };
    this.ready = Promise.resolve({ you, name });
  }

  get host(): number | null {
    return this.hostId;
  }
  get isHost(): boolean {
    return this.hostId === this.you;
  }
  get room(): RoomSummary | null {
    return this.roomSummary;
  }
  get players(): PlayerInfo[] {
    return [...this.members.values()];
  }

  on<E extends keyof HubEvents<S, D, M>>(event: E, fn: HubEvents<S, D, M>[E]): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn as AnyFn);
    return () => this.handlers.get(event)?.delete(fn as AnyFn);
  }

  listRooms(): Promise<RoomSummary[]> {
    return Promise.reject(new Error('fakeHub: listRooms is not modelled'));
  }

  watchLobby(onRooms: (rooms: RoomSummary[]) => void): () => void {
    const off = this.on('lobby', onRooms as HubEvents<S, D, M>['lobby']);
    this.server.watch(this.erased(), true);
    return () => {
      off();
      this.server.watch(this.erased(), false);
    };
  }

  create(options: CreateRoomOptions = {}): Promise<RoomSummary> {
    return Promise.resolve(this.server.create(this.erased(), options));
  }

  join(code: string): Promise<RoomSummary> {
    try {
      return Promise.resolve(this.server.join(this.erased(), code));
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  leave(): Promise<unknown> {
    this.server.leave(this.erased());
    this.roomId = null;
    this.hostId = null;
    this.roomSummary = null;
    this.members.clear();
    return Promise.resolve({});
  }

  setState(data: S): void {
    this.server.setState(this.erased(), data);
  }
  sendDelta(data: D): void {
    this.server.sendDelta(this.erased(), data);
  }
  send(data: M, to?: number): void {
    this.server.send(this.erased(), data, to);
  }
  sendBinary(): void {
    throw new Error('fakeHub: binary frames are not modelled');
  }
  setRoom(changes: { meta?: unknown }): void {
    this.server.setRoom(this.erased(), changes.meta);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.server.leave(this.erased());
    this.emit('close', {} as CloseEvent);
  }

  /** @internal */
  receive(event: string, ...args: unknown[]): void {
    if (this.closed) return;
    if (event === 'player+') {
      const player = args[0] as PlayerInfo;
      this.members.set(player.id, player);
    }
    if (event === 'player-') this.members.delete(args[0] as number);
    this.emit(event, ...args);
  }

  /** @internal */
  receiveHost(id: number): void {
    if (this.closed) return;
    this.hostId = id;
    this.emit('host', id);
  }

  /** @internal */
  receiveJoined(summary: RoomSummary, players: PlayerInfo[], snapshot: unknown, deltas: unknown[]): void {
    if (this.closed) return;
    this.roomId = summary.id;
    this.roomSummary = summary;
    this.hostId = summary.host;
    this.members.clear();
    for (const player of players) this.members.set(player.id, player);
    this.emit('joined', summary, { you: this.you, host: summary.host, players });
    if (snapshot !== null) this.emit('state', structuredClone(snapshot), 0);
    for (const delta of deltas) this.emit('delta', structuredClone(delta), 0);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }

  private erased(): FakeClient<unknown, unknown, unknown> {
    return this as unknown as FakeClient<unknown, unknown, unknown>;
  }
}
