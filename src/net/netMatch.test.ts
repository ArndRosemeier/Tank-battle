import { describe, expect, it } from 'vitest';
import type { TankCommand } from '../core/sim.ts';
import { NetMatch, TICKS_PER_BATCH } from './netMatch.ts';
import { encodeCommand, parseTickBatch, type MatchSpec, type TickBatch } from './protocol.ts';

const SPEC: MatchSpec = {
  matchNo: 1,
  seed: 4242,
  setup: { teams: 2, tanksPerTeam: 2, minutes: 2 },
  seats: [
    { playerId: 1, name: 'HOST', teamId: 0, teamIndex: 0 },
    { playerId: 2, name: 'GUEST', teamId: 1, teamIndex: 0 },
    { playerId: 3, name: 'THIRD', teamId: 1, teamIndex: 1 },
  ],
};

const FRAME = 1 / 60;

function drive(tick: number): TankCommand {
  return { throttle: 1, steer: Math.sin(tick / 20) * 0.7, aimYaw: (tick * 3) % 360, aimPitch: -2, fire: tick % 50 === 0 };
}

/** Sends a batch through JSON and the parser, as the network would. */
function wire(batch: TickBatch, seats = SPEC.seats.length): TickBatch {
  return parseTickBatch(JSON.parse(JSON.stringify(batch)), seats);
}

describe('netMatch lockstep', () => {
  it('a client fed the host batches reaches the same state hash, and the host hash check passes', () => {
    const host = new NetMatch({ spec: SPEC, localSeat: 0, role: 'host' });
    const client = new NetMatch({ spec: SPEC, localSeat: 1, role: 'client' });
    let batches = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      host.setSeatCommand(1, encodeCommand(drive(frame + 7)));
      for (const batch of host.produce(FRAME, () => drive(frame))) {
        batches += 1;
        expect(batch.c.length).toBeLessThanOrEqual(TICKS_PER_BATCH);
        client.receive(wire(batch));
      }
      client.consume(FRAME);
    }
    // Drain: the client runs a few ticks behind by design.
    for (let i = 0; i < 30; i += 1) client.consume(FRAME);
    expect(batches).toBe(200);
    expect(client.state.tick).toBe(host.state.tick);
    expect(client.session.hash()).toBe(host.session.hash());
    expect(client.desync).toBeNull();
    // The players actually moved: the test is not comparing two idle worlds.
    expect(host.state.tanks[client.localTankId!]!.x).not.toBe(client.session.tankInSlot({ teamId: 1, teamIndex: 1 }).x);
  });

  it('flags a divergence when the host hash differs', () => {
    const host = new NetMatch({ spec: SPEC, localSeat: 0, role: 'host' });
    const client = new NetMatch({ spec: SPEC, localSeat: 1, role: 'client' });
    for (let frame = 0; frame < 130; frame += 1) {
      for (const batch of host.produce(FRAME, () => drive(frame))) {
        client.receive(batch.h ? { ...batch, h: [batch.h[0], 'deadbeef'] } : batch);
      }
      client.consume(FRAME);
    }
    for (let i = 0; i < 30; i += 1) client.consume(FRAME);
    expect(client.desync).toMatch(/out of sync with the host at tick 120/);
  });

  it('keeps running after the local tank dies: a dead tank is never asked to aim', () => {
    const host = new NetMatch({ spec: SPEC, localSeat: 0, role: 'host' });
    const client = new NetMatch({ spec: SPEC, localSeat: 1, role: 'client' });
    // The real aim controller throws for a dead tank; this stand-in does the same.
    const aimFor = (match: NetMatch, frame: number) => (): TankCommand => {
      if (!match.localTankAlive) throw new Error('aim: a dead tank cannot aim');
      return drive(frame);
    };
    for (let frame = 0; frame < 120; frame += 1) {
      if (frame === 30) {
        const dead = host.state.tanks[host.localTankId!]!;
        dead.hp = 0;
        dead.alive = false;
      }
      for (const batch of host.produce(FRAME, aimFor(host, frame))) client.receive(wire(batch));
      client.consume(FRAME);
    }
    expect(host.localTankAlive).toBe(false);
    expect(host.state.tick).toBeGreaterThan(100);
  });

  it('a client never steps past the rows it holds', () => {
    const client = new NetMatch({ spec: SPEC, localSeat: 1, role: 'client' });
    expect(client.consume(0.2)).toBe(0);
    expect(client.state.tick).toBe(0);
  });

  it('rejects a gap in the tick stream loudly', () => {
    const client = new NetMatch({ spec: SPEC, localSeat: 1, role: 'client' });
    const row = SPEC.seats.map(() => encodeCommand(drive(0)));
    expect(() => client.receive({ k: 'ticks', matchNo: 1, from: 5, c: [row] })).toThrow(/gap/);
  });

  it('hands a seat to the AI at the same tick on host and client', () => {
    const host = new NetMatch({ spec: SPEC, localSeat: 0, role: 'host' });
    const client = new NetMatch({ spec: SPEC, localSeat: 1, role: 'client' });
    for (let frame = 0; frame < 300; frame += 1) {
      if (frame === 100) host.handOver(2);
      for (const batch of host.produce(FRAME, () => drive(frame))) client.receive(wire(batch));
      client.consume(FRAME);
    }
    for (let i = 0; i < 30; i += 1) client.consume(FRAME);
    expect(client.isHandedOver(2)).toBe(true);
    expect(client.session.hash()).toBe(host.session.hash());
  });

  it('host migration: the promoted peer collects the newest rows and everyone converges', () => {
    const host = new NetMatch({ spec: SPEC, localSeat: 0, role: 'host' });
    const a = new NetMatch({ spec: SPEC, localSeat: 1, role: 'client' });
    const b = new NetMatch({ spec: SPEC, localSeat: 2, role: 'client' });
    for (let frame = 0; frame < 200; frame += 1) {
      for (const batch of host.produce(FRAME, () => drive(frame))) {
        b.receive(wire(batch));
        // `a` misses the host's last batches: it will be the new host and must catch up.
        if (frame < 180) a.receive(wire(batch));
      }
      a.consume(FRAME);
      b.consume(FRAME);
    }
    // The host leaves. `a` is promoted, asks for rows, `b` answers.
    const have = a.rowCount;
    expect(b.rowCount).toBeGreaterThan(have);
    a.mergeSync(JSON.parse(JSON.stringify(b.syncPayload(have))));
    a.becomeHost();
    a.handOver(0);
    const resend = a.resendFrom(Math.min(b.rowCount, a.rowCount));
    if (resend) b.receive(wire(resend));
    for (let frame = 200; frame < 400; frame += 1) {
      for (const batch of a.produce(FRAME, () => drive(frame))) b.receive(wire(batch));
      b.consume(FRAME);
    }
    const tail = a.flushPending();
    if (tail) b.receive(wire(tail));
    for (let i = 0; i < 30; i += 1) b.consume(FRAME);
    expect(b.state.tick).toBe(a.state.tick);
    expect(b.session.hash()).toBe(a.session.hash());
    expect(b.desync).toBeNull();
    expect(b.isHandedOver(0)).toBe(true);
  });
});
