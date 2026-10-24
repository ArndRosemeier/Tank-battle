/**
 * The Tank Battle wire format on top of GameHub.
 *
 * Model: HOST-SEQUENCED INPUT LOCKSTEP. The core is deterministic from a seed plus the
 * per-tick commands, so the host does not ship the world. It ships, for every tick, the
 * commands of the human seats; every peer runs the same simulation (same seed, same AI
 * controllers) and arrives at the same world, terrain damage included.
 *
 *  - Room state (`setState`): the lobby roster, the chosen setup and, once started,
 *    the match spec (seed and seat → tank slot). Small; resent on every change.
 *  - Tick batches (`sendDelta`): ~20 per second, each carrying 3 ticks of human commands,
 *    seat hand-overs to AI, and a periodic state hash so a divergence is detected.
 *  - Intents (`send` to the host): a player's latest command, team choice, ready.
 *
 * Everything that arrives from the network is parsed here, loudly: a malformed message
 * throws a `ProtocolError` naming the field. It never becomes a default.
 */

import { AIM_PITCH_MAX_DEGREES, AIM_PITCH_MIN_DEGREES, MAX_TANKS_PER_TEAM, MAX_TEAMS } from '../core/sim.ts';
import { normaliseDegrees, type TankCommand } from '../core/sim.ts';
import { MATCH_MINUTE_CHOICES, MAX_MATCH_SEED, MIN_TANKS_PER_TEAM, MIN_TEAMS } from '../game/matchSetup.ts';

/** Bumped whenever the wire format or the simulation changes incompatibly. */
export const PROTOCOL_VERSION = 1;
/** The `game` tag in room meta, so a stray room of another app is never joined. */
export const ROOM_GAME_TAG = 'tank-battle';

export class ProtocolError extends Error {
  constructor(message: string) {
    super(`protocol: ${message}`);
    this.name = 'ProtocolError';
  }
}

// ---------------------------------------------------------------- commands

/** A command on the wire: [throttle, steer, aimYaw, aimPitch, fire]. */
export type WireCommand = readonly [number, number, number, number, 0 | 1];

const round = (value: number, scale: number): number => Math.round(value * scale) / scale;

/**
 * The ONE quantisation of a human command. The host applies the quantised command to
 * its own simulation too, so every peer steps with exactly the same numbers.
 */
export function quantiseCommand(command: TankCommand): TankCommand {
  const pitch = Math.max(AIM_PITCH_MIN_DEGREES, Math.min(AIM_PITCH_MAX_DEGREES, round(command.aimPitch, 100)));
  let yaw = round(normaliseDegrees(command.aimYaw), 100);
  if (yaw >= 180) yaw -= 360;
  return {
    throttle: round(command.throttle, 1000),
    steer: round(command.steer, 1000),
    aimYaw: yaw,
    aimPitch: pitch,
    fire: command.fire,
  };
}

export function encodeCommand(command: TankCommand): WireCommand {
  const q = quantiseCommand(command);
  return [q.throttle, q.steer, q.aimYaw, q.aimPitch, q.fire ? 1 : 0];
}

export function decodeCommand(value: unknown, label: string): TankCommand {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new ProtocolError(`${label} must be a 5-element command array`);
  }
  const [throttle, steer, aimYaw, aimPitch, fire] = value as unknown[];
  const finite = (v: unknown, name: string, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      throw new ProtocolError(`${label}.${name} must be a number in ${min}…${max}, got ${String(v)}`);
    }
    return v;
  };
  if (fire !== 0 && fire !== 1) throw new ProtocolError(`${label}.fire must be 0 or 1, got ${String(fire)}`);
  return quantiseCommand({
    throttle: finite(throttle, 'throttle', -1, 1),
    steer: finite(steer, 'steer', -1, 1),
    aimYaw: finite(aimYaw, 'aimYaw', -360, 360),
    aimPitch: finite(aimPitch, 'aimPitch', AIM_PITCH_MIN_DEGREES, AIM_PITCH_MAX_DEGREES),
    fire: fire === 1,
  });
}

export const IDLE_WIRE_COMMAND: WireCommand = [0, 0, 0, 0, 0];

// ---------------------------------------------------------------- room state

/** The parts of a match setup an online room chooses (the seed is drawn at START). */
export interface RoomSetup {
  readonly teams: number;
  readonly tanksPerTeam: number;
  readonly minutes: number;
}

/** A player in the room and the team they asked for. */
export interface RoomMember {
  readonly playerId: number;
  readonly name: string;
  readonly teamId: number;
}

/** One human seat in a started match: a GameHub player driving one tank slot. */
export interface MatchSeat {
  readonly playerId: number;
  readonly name: string;
  readonly teamId: number;
  readonly teamIndex: number;
}

export interface MatchSpec {
  /** Increments per START, so a stale batch from a previous match is recognised. */
  readonly matchNo: number;
  readonly seed: number;
  readonly setup: RoomSetup;
  /** Human seats, in seat order: batch command arrays use this order. */
  readonly seats: readonly MatchSeat[];
}

export interface RoomState {
  readonly v: number;
  readonly phase: 'room' | 'match';
  readonly setup: RoomSetup;
  readonly members: readonly RoomMember[];
  /** The running (or last finished) match; null before the first START. */
  readonly match: MatchSpec | null;
}

/** The free-form `meta` this game puts on a GameHub room, for the lobby list. */
export interface RoomMeta {
  readonly game: typeof ROOM_GAME_TAG;
  readonly v: number;
  readonly phase: 'room' | 'match';
  readonly setup: RoomSetup;
}

// ---------------------------------------------------------------- tick batches

/** One tick: a command per human seat, in `MatchSpec.seats` order. */
export type TickCommands = readonly WireCommand[];

export interface TickBatch {
  readonly k: 'ticks';
  readonly matchNo: number;
  /** The tick index the first entry of `c` is applied at. */
  readonly from: number;
  readonly c: readonly TickCommands[];
  /** Seats handed to the AI, as [seatIndex, tick]: from that tick an AI drives them. */
  readonly ai?: readonly (readonly [number, number])[];
  /** [tick, hash]: the host's `hashMatch` after stepping `tick`. */
  readonly h?: readonly [number, string];
}

// ---------------------------------------------------------------- intents

export type Intent =
  | { readonly type: 'cmd'; readonly matchNo: number; readonly c: WireCommand }
  | { readonly type: 'team'; readonly teamId: number }
  /** Sent to a newly promoted host: the ticks this peer holds beyond `have`. */
  | { readonly type: 'sync'; readonly matchNo: number; readonly from: number; readonly c: readonly TickCommands[]; readonly ai: readonly (readonly [number, number])[] }
  /** Sent by a newly promoted host: please send me your ticks after `have`. */
  | { readonly type: 'sync?'; readonly matchNo: number; readonly have: number };

// ---------------------------------------------------------------- parsing

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function int(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ProtocolError(`${label} must be an integer in ${min}…${max}, got ${String(value)}`);
  }
  return value;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ProtocolError(`${label} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

function list(value: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new ProtocolError(`${label} must be an array of at most ${maxLength} entries`);
  }
  return value;
}

export function validateRoomSetup(value: unknown, label = 'setup'): RoomSetup {
  const r = record(value, label);
  const minutes = int(r.minutes, `${label}.minutes`, 1, 60);
  if (!MATCH_MINUTE_CHOICES.includes(minutes)) {
    throw new ProtocolError(`${label}.minutes must be one of ${MATCH_MINUTE_CHOICES.join(', ')}`);
  }
  return {
    teams: int(r.teams, `${label}.teams`, MIN_TEAMS, MAX_TEAMS),
    tanksPerTeam: int(r.tanksPerTeam, `${label}.tanksPerTeam`, MIN_TANKS_PER_TEAM, MAX_TANKS_PER_TEAM),
    minutes,
  };
}

const MAX_PLAYER_ID = 2 ** 31;
const MAX_SEATS = MAX_TEAMS * MAX_TANKS_PER_TEAM;
/** Members may outnumber seats: the extras wait for the next match. */
const MAX_MEMBERS = 64;

export function parseRoomState(value: unknown): RoomState {
  const r = record(value, 'room state');
  const v = int(r.v, 'room state.v', 0, 1_000_000);
  if (v !== PROTOCOL_VERSION) {
    throw new ProtocolError(`this room runs protocol ${v}, this game speaks ${PROTOCOL_VERSION}; reload to update`);
  }
  if (r.phase !== 'room' && r.phase !== 'match') {
    throw new ProtocolError(`room state.phase must be room or match, got ${String(r.phase)}`);
  }
  const setup = validateRoomSetup(r.setup, 'room state.setup');
  const members = list(r.members, 'room state.members', MAX_MEMBERS).map((entry, index) => {
    const m = record(entry, `member ${index}`);
    return {
      playerId: int(m.playerId, `member ${index}.playerId`, 0, MAX_PLAYER_ID),
      name: text(m.name, `member ${index}.name`, 32),
      teamId: int(m.teamId, `member ${index}.teamId`, 0, setup.teams - 1),
    };
  });
  let match: MatchSpec | null = null;
  if (r.match !== null) {
    const m = record(r.match, 'room state.match');
    const matchSetup = validateRoomSetup(m.setup, 'match.setup');
    const seats = list(m.seats, 'match.seats', MAX_SEATS).map((entry, index) => {
      const s = record(entry, `seat ${index}`);
      return {
        playerId: int(s.playerId, `seat ${index}.playerId`, 0, MAX_PLAYER_ID),
        name: text(s.name, `seat ${index}.name`, 32),
        teamId: int(s.teamId, `seat ${index}.teamId`, 0, matchSetup.teams - 1),
        teamIndex: int(s.teamIndex, `seat ${index}.teamIndex`, 0, matchSetup.tanksPerTeam - 1),
      };
    });
    const slots = new Set(seats.map((seat) => `${seat.teamId}:${seat.teamIndex}`));
    if (slots.size !== seats.length) throw new ProtocolError('match.seats has two humans in one tank slot');
    if (new Set(seats.map((seat) => seat.playerId)).size !== seats.length) {
      throw new ProtocolError('match.seats lists a player twice');
    }
    match = {
      matchNo: int(m.matchNo, 'match.matchNo', 1, 1_000_000),
      seed: int(m.seed, 'match.seed', 0, MAX_MATCH_SEED),
      setup: matchSetup,
      seats,
    };
  }
  if (r.phase === 'match' && match === null) throw new ProtocolError('room state is in a match but has no match spec');
  return { v, phase: r.phase, setup, members, match };
}

const MAX_TICK = 60 * 60 * 61;
/** A batch never carries more than this many ticks (a migration sync may be long). */
const MAX_BATCH_TICKS = MAX_TICK;

function parseTickRows(value: unknown, label: string, seatCount: number): TickCommands[] {
  return list(value, label, MAX_BATCH_TICKS).map((row, tickOffset) => {
    const commands = list(row, `${label}[${tickOffset}]`, seatCount);
    if (commands.length !== seatCount) {
      throw new ProtocolError(`${label}[${tickOffset}] has ${commands.length} commands for ${seatCount} seats`);
    }
    return commands.map((command, seat) => encodeCommand(decodeCommand(command, `${label}[${tickOffset}][${seat}]`)));
  });
}

function parseHandovers(value: unknown, label: string, seatCount: number): [number, number][] {
  return list(value, label, seatCount).map((entry, index) => {
    const pair = list(entry, `${label}[${index}]`, 2);
    return [int(pair[0], `${label}[${index}].seat`, 0, seatCount - 1), int(pair[1], `${label}[${index}].tick`, 0, MAX_TICK)];
  });
}

export function parseTickBatch(value: unknown, seatCount: number): TickBatch {
  const r = record(value, 'tick batch');
  if (r.k !== 'ticks') throw new ProtocolError(`tick batch.k must be "ticks", got ${String(r.k)}`);
  const batch: { -readonly [K in keyof TickBatch]: TickBatch[K] } = {
    k: 'ticks',
    matchNo: int(r.matchNo, 'tick batch.matchNo', 1, 1_000_000),
    from: int(r.from, 'tick batch.from', 0, MAX_TICK),
    c: parseTickRows(r.c, 'tick batch.c', seatCount),
  };
  if (r.ai !== undefined) batch.ai = parseHandovers(r.ai, 'tick batch.ai', seatCount);
  if (r.h !== undefined) {
    const h = list(r.h, 'tick batch.h', 2);
    batch.h = [int(h[0], 'tick batch.h.tick', 0, MAX_TICK), text(h[1], 'tick batch.h.hash', 16)];
  }
  return batch;
}

/** Parses an intent. `seatCount` is the current match's seat count (0 outside a match). */
export function parseIntent(value: unknown, seatCount: number, teams: number): Intent {
  const r = record(value, 'intent');
  switch (r.type) {
    case 'cmd':
      return { type: 'cmd', matchNo: int(r.matchNo, 'cmd.matchNo', 1, 1_000_000), c: encodeCommand(decodeCommand(r.c, 'cmd.c')) };
    case 'team':
      return { type: 'team', teamId: int(r.teamId, 'team.teamId', 0, teams - 1) };
    case 'sync':
      return {
        type: 'sync',
        matchNo: int(r.matchNo, 'sync.matchNo', 1, 1_000_000),
        from: int(r.from, 'sync.from', 0, MAX_TICK),
        c: parseTickRows(r.c, 'sync.c', seatCount),
        ai: parseHandovers(r.ai, 'sync.ai', seatCount),
      };
    case 'sync?':
      return {
        type: 'sync?',
        matchNo: int(r.matchNo, 'sync?.matchNo', 1, 1_000_000),
        have: int(r.have, 'sync?.have', -1, MAX_TICK),
      };
    default:
      throw new ProtocolError(`unknown intent type ${String(r.type)}`);
  }
}

/** True when a lobby room belongs to this game and speaks this protocol. */
export function isCompatibleRoomMeta(meta: unknown): meta is RoomMeta {
  if (meta === null || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  if (m.game !== ROOM_GAME_TAG || m.v !== PROTOCOL_VERSION) return false;
  try {
    validateRoomSetup(m.setup);
  } catch {
    // A lobby row of an incompatible room is filtered out, not an error: it is someone
    // else's room, and the list shows only rooms this build can join.
    return false;
  }
  return m.phase === 'room' || m.phase === 'match';
}
