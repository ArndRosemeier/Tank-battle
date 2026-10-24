/**
 * One online match: the local copy of the deterministic simulation, fed by the tick
 * stream of human commands (see `protocol.ts` for the model).
 *
 * The host PRODUCES ticks: on its own fixed clock it takes the latest command of every
 * seat, records them as the row for that tick, steps, and batches the rows for the
 * network. A client CONSUMES ticks: it steps only through rows it has received, a few
 * ticks behind the host, catching up when it falls behind. Both step through the SAME
 * code path (`stepOne`), so host and client cannot drift by construction.
 *
 * Game layer: no DOM, no three.js, no socket. `OnlineSession` moves batches between this
 * and GameHub; this module is fully unit-testable with two instances wired together.
 */

import { CRUCIBLE_CHOICE } from '../game/levels/catalog.ts';
import { FixedStep } from '../core/timestep.ts';
import type { Controller, MatchState, TankCommand } from '../core/sim.ts';
import { matchTickCap } from '../game/matchSetup.ts';
import { TeamSession } from '../game/teamSession.ts';
import { DEFAULT_MATCH_RULES } from '../core/sim.ts';
import type { TankRenderFrame } from '../game/tankFrames.ts';
import {
  IDLE_WIRE_COMMAND,
  decodeCommand,
  encodeCommand,
  type MatchSpec,
  type TickBatch,
  type TickCommands,
  type WireCommand,
} from './protocol.ts';

/** Ticks per network batch: 60 Hz simulation, 20 batches per second. */
export const TICKS_PER_BATCH = 3;
/** The host sends its state hash this often; a client compares and flags a divergence. */
export const HASH_EVERY_TICKS = 120;
/** A client aims to run this many ticks behind the newest row it holds. */
export const TARGET_BUFFER_TICKS = 6;
/** Beyond this many buffered ticks a client runs extra ticks per frame to catch up. */
const CATCH_UP_ABOVE_TICKS = 12;
const MAX_CATCH_UP_PER_FRAME = 6;

export type NetRole = 'host' | 'client';

export interface NetMatchOptions {
  readonly spec: MatchSpec;
  /** This browser's seat index in `spec.seats`, or null when it only watches. */
  readonly localSeat: number | null;
  readonly role: NetRole;
}

/** The rows a peer holds after `have`, for a newly promoted host (migration). */
export interface SyncPayload {
  readonly from: number;
  readonly c: readonly TickCommands[];
  readonly ai: readonly (readonly [number, number])[];
}

class RelayController implements Controller {
  constructor(
    private readonly match: NetMatch,
    private readonly seat: number,
  ) {}

  commandFor(state: MatchState): TankCommand {
    return this.match.commandAt(state.tick, this.seat);
  }
}

export class NetMatch {
  readonly spec: MatchSpec;
  readonly session: TeamSession;
  readonly localSeat: number | null;
  /** Set when this peer's state hash differs from the host's: the match has diverged. */
  desync: string | null = null;

  private roleValue: NetRole;
  private readonly rows: TickCommands[] = [];
  /** seat → the tick from which an AI drives it. */
  private readonly handovers = new Map<number, number>();
  private readonly handedOver = new Set<number>();
  private readonly expectedHashes = new Map<number, string>();
  private readonly fixed = new FixedStep();
  private readonly seatTankIds: readonly number[];
  // Host only.
  private latest: WireCommand[];
  private pendingFrom = 0;
  private pendingRows: TickCommands[] = [];
  private pendingAi: [number, number][] = [];
  private pendingHash: [number, string] | null = null;

  constructor(options: NetMatchOptions) {
    const { spec, localSeat } = options;
    if (localSeat !== null && (localSeat < 0 || localSeat >= spec.seats.length)) {
      throw new Error(`netMatch: local seat ${localSeat} is not one of ${spec.seats.length} seats`);
    }
    this.spec = spec;
    this.localSeat = localSeat;
    this.roleValue = options.role;
    // The view follows this browser's seat, or the first seat for a watcher.
    const view = spec.seats[localSeat ?? 0] ?? { teamId: 0, teamIndex: 0 };
    this.session = new TeamSession({
      seed: spec.seed,
      teams: spec.setup.teams,
      tanksPerTeam: spec.setup.tanksPerTeam,
      rules: { ...DEFAULT_MATCH_RULES, tickCap: matchTickCap({ mode: 'team', ...spec.setup, seed: spec.seed, arena: CRUCIBLE_CHOICE }) },
      seats: spec.seats.map((seat, index) => ({
        teamId: seat.teamId,
        teamIndex: seat.teamIndex,
        controller: new RelayController(this, index),
      })),
      viewSeat: { teamId: view.teamId, teamIndex: view.teamIndex },
    });
    this.seatTankIds = spec.seats.map((seat) => this.session.tankInSlot(seat).id);
    this.latest = spec.seats.map(() => IDLE_WIRE_COMMAND);
  }

  get role(): NetRole {
    return this.roleValue;
  }

  get state(): MatchState {
    return this.session.state;
  }

  get alpha(): number {
    return this.fixed.alpha;
  }

  /** Ticks received (client) or produced (host) so far. */
  get rowCount(): number {
    return this.rows.length;
  }

  /** Ticks a client holds but has not stepped yet. */
  get bufferedTicks(): number {
    return this.rows.length - this.state.tick;
  }

  get localTankId(): number | null {
    return this.localSeat === null ? null : this.seatTankIds[this.localSeat]!;
  }

  /**
   * True while this browser's tank can still be steered. A dead tank gets no command
   * (the sim skips it), and asking the aim controller for one throws.
   */
  get localTankAlive(): boolean {
    const id = this.localTankId;
    return id !== null && this.state.tanks[id]?.alive === true;
  }

  tankIdOfSeat(seat: number): number {
    const id = this.seatTankIds[seat];
    if (id === undefined) throw new Error(`netMatch: no seat ${seat}`);
    return id;
  }

  /** The command a seat applies at a tick. A missing row is a sequencing bug: it throws. */
  commandAt(tick: number, seat: number): TankCommand {
    const row = this.rows[tick];
    if (!row) throw new Error(`netMatch: no commands for tick ${tick} (have ${this.rows.length})`);
    const command = row[seat];
    if (!command) throw new Error(`netMatch: tick ${tick} has no command for seat ${seat}`);
    return decodeCommand(command, `tick ${tick} seat ${seat}`);
  }

  interpolatedTanks(alpha: number): readonly TankRenderFrame[] {
    return this.session.interpolatedTanks(alpha);
  }

  // ------------------------------------------------------------ host

  /** Host: a seat's newest command, held until the next one arrives. */
  setSeatCommand(seat: number, command: WireCommand): void {
    if (seat < 0 || seat >= this.latest.length) throw new Error(`netMatch: no seat ${seat}`);
    this.latest[seat] = command;
  }

  /** Host: from the next produced tick on, an AI drives this seat (its player left). */
  handOver(seat: number): void {
    this.requireRole('host', 'handOver');
    if (this.handovers.has(seat)) return;
    const tick = this.rows.length;
    this.handovers.set(seat, tick);
    this.pendingAi.push([seat, tick]);
  }

  /**
   * Host: credits a frame and produces the ticks owed. `localCommand` is sampled per
   * tick for this browser's own seat. Returns the batches to send (usually 0 or 1).
   */
  produce(frameSeconds: number, localCommand: (() => TankCommand) | null): TickBatch[] {
    this.requireRole('host', 'produce');
    const batches: TickBatch[] = [];
    this.fixed.advance(frameSeconds, () => {
      if (this.state.status !== 'active') return;
      if (this.localSeat !== null && localCommand && !this.handovers.has(this.localSeat) && this.localTankAlive) {
        this.latest[this.localSeat] = encodeCommand(localCommand());
      }
      const tick = this.rows.length;
      if (this.pendingRows.length === 0) this.pendingFrom = tick;
      const row = [...this.latest];
      this.rows.push(row);
      this.pendingRows.push(row);
      this.stepOne();
      if (this.state.tick % HASH_EVERY_TICKS === 0) {
        this.pendingHash = [this.state.tick, this.session.hash()];
      }
      if (this.pendingRows.length >= TICKS_PER_BATCH || this.state.status !== 'active') {
        batches.push(this.flush());
      }
    });
    if (this.pendingRows.length === 0 && this.pendingAi.length > 0) {
      // A hand-over with no tick to ride on (the match ended): still announce it.
      batches.push(this.flush());
    }
    return batches;
  }

  /** Host after a migration: re-send everything from `tick` so every peer has it. */
  resendFrom(tick: number): TickBatch | null {
    this.requireRole('host', 'resendFrom');
    if (tick >= this.rows.length) return null;
    const ai = [...this.handovers.entries()];
    return {
      k: 'ticks',
      matchNo: this.spec.matchNo,
      from: tick,
      c: this.rows.slice(tick),
      ...(ai.length > 0 ? { ai } : {}),
    };
  }

  /** Host: sends the rows not yet batched (used when leaving a match and by tests). */
  flushPending(): TickBatch | null {
    this.requireRole('host', 'flushPending');
    return this.pendingRows.length > 0 || this.pendingAi.length > 0 ? this.flush() : null;
  }

  private flush(): TickBatch {
    const batch: TickBatch = {
      k: 'ticks',
      matchNo: this.spec.matchNo,
      from: this.pendingFrom,
      c: this.pendingRows,
      ...(this.pendingAi.length > 0 ? { ai: this.pendingAi } : {}),
      ...(this.pendingHash ? { h: this.pendingHash } : {}),
    };
    this.pendingRows = [];
    this.pendingAi = [];
    this.pendingHash = null;
    this.pendingFrom = this.rows.length;
    return batch;
  }

  // ------------------------------------------------------------ client

  /** Client: stores a batch from the host. Rows it already holds must match. */
  receive(batch: TickBatch): void {
    if (batch.matchNo !== this.spec.matchNo) return; // a previous match's tail: not ours
    this.merge(batch.from, batch.c, batch.ai ?? []);
    if (batch.h) this.expectedHashes.set(batch.h[0], batch.h[1]);
  }

  /**
   * Client: credits a frame and steps through the rows it holds, never past them. A
   * starved client freezes (alpha stays 0) instead of guessing; a client far behind runs
   * a few extra ticks per frame.
   */
  consume(frameSeconds: number): number {
    this.requireRole('client', 'consume');
    let stepped = 0;
    let starved = false;
    this.fixed.advance(frameSeconds, () => {
      if (this.state.status !== 'active') return;
      if (this.bufferedTicks <= 0) {
        starved = true;
        return;
      }
      this.stepOne();
      stepped += 1;
    });
    if (starved) this.fixed.reset();
    let extra = 0;
    while (
      this.state.status === 'active' &&
      this.bufferedTicks > CATCH_UP_ABOVE_TICKS &&
      extra < MAX_CATCH_UP_PER_FRAME
    ) {
      this.stepOne();
      extra += 1;
    }
    return stepped + extra;
  }

  // ------------------------------------------------------------ migration

  /** What this peer holds beyond `have`, for a newly promoted host. */
  syncPayload(have: number): SyncPayload {
    const from = Math.min(have, this.rows.length);
    return { from, c: this.rows.slice(from), ai: [...this.handovers.entries()] };
  }

  /** New host: adds rows and hand-overs another peer held. */
  mergeSync(payload: SyncPayload): void {
    this.merge(payload.from, payload.c, payload.ai);
  }

  /**
   * Promotes this peer to host. It first steps through every row it holds (so its
   * world is the newest any peer had), then continues producing from there, holding
   * each seat's last command until that player sends a new one.
   */
  becomeHost(): void {
    if (this.roleValue === 'host') return;
    this.roleValue = 'host';
    while (this.state.status === 'active' && this.bufferedTicks > 0) this.stepOne();
    const last = this.rows[this.rows.length - 1];
    this.latest = this.spec.seats.map((_, seat) => last?.[seat] ?? IDLE_WIRE_COMMAND);
    this.pendingRows = [];
    this.pendingAi = [];
    this.pendingFrom = this.rows.length;
    this.fixed.reset();
  }

  /** Host lost: this peer becomes a client again (it will be told who hosts now). */
  becomeClient(): void {
    this.roleValue = 'client';
  }

  isHandedOver(seat: number): boolean {
    return this.handovers.has(seat);
  }

  // ------------------------------------------------------------ shared

  private merge(from: number, rows: readonly TickCommands[], ai: readonly (readonly [number, number])[]): void {
    if (from > this.rows.length) {
      throw new Error(`netMatch: tick stream gap, got tick ${from} while holding ${this.rows.length}`);
    }
    for (const [seat, tick] of ai) {
      const known = this.handovers.get(seat);
      if (known !== undefined && known !== tick) {
        throw new Error(`netMatch: seat ${seat} handed to AI at tick ${known} and at ${tick}`);
      }
      if (known === undefined) {
        if (tick < this.state.tick) {
          throw new Error(`netMatch: seat ${seat} hand-over at tick ${tick} arrived after stepping tick ${this.state.tick}`);
        }
        this.handovers.set(seat, tick);
      }
    }
    rows.forEach((row, offset) => {
      const tick = from + offset;
      const held = this.rows[tick];
      if (held) {
        if (JSON.stringify(held) !== JSON.stringify(row)) {
          throw new Error(`netMatch: two different command rows for tick ${tick}`);
        }
        return;
      }
      this.rows.push(row);
    });
  }

  private stepOne(): void {
    const tick = this.state.tick;
    for (const [seat, from] of this.handovers) {
      if (from <= tick && !this.handedOver.has(seat)) {
        this.handedOver.add(seat);
        this.session.handToAI(this.tankIdOfSeat(seat));
      }
    }
    this.session.stepTick();
    const expected = this.expectedHashes.get(this.state.tick);
    if (expected !== undefined) {
      this.expectedHashes.delete(this.state.tick);
      const actual = this.session.hash();
      if (actual !== expected && this.desync === null) {
        this.desync = `out of sync with the host at tick ${this.state.tick} (${actual} vs ${expected})`;
      }
    }
  }

  private requireRole(role: NetRole, action: string): void {
    if (this.roleValue !== role) throw new Error(`netMatch: ${action} is for the ${role}, this peer is ${this.roleValue}`);
  }
}
