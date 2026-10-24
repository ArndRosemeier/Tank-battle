import { describe, expect, it } from 'vitest';
import type { TankCommand } from '../core/sim.ts';
import { FakeServer } from './fakeHub.ts';
import { OnlineSession, type OnlineHub, type OnlineNotice } from './onlineSession.ts';

const FRAME = 1 / 60;

function command(tick: number, salt: number): TankCommand {
  return { throttle: 1, steer: ((tick + salt * 13) % 40) / 40 - 0.5, aimYaw: (tick * 2 + salt * 90) % 360, aimPitch: 0, fire: (tick + salt) % 45 === 0 };
}

function harness() {
  const server = new FakeServer();
  const timers: (() => void)[] = [];
  const notices: OnlineNotice[] = [];
  let seed = 100;
  const make = (name: string) => {
    const session = new OnlineSession(server.connect(name) as unknown as OnlineHub, {
      schedule: (callback) => timers.push(callback),
      freshSeed: () => seed++,
    });
    session.onNotice((notice) => notices.push(notice));
    return session;
  };
  const runFrames = (sessions: readonly OnlineSession[], frames: number) => {
    for (let frame = 0; frame < frames; frame += 1) {
      sessions.forEach((session, salt) => {
        const tick = session.match?.state.tick ?? 0;
        session.frame(FRAME, session.match?.localSeat === null ? null : () => command(tick, salt));
      });
      server.flush();
    }
  };
  return { server, timers, notices, make, runFrames };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('online session over a fake GameHub', () => {
  it('host creates a room, players join and pick teams, START gives every browser the same match', async () => {
    const { server, notices, make, runFrames } = harness();
    const host = make('ALICE');
    const bob = make('BOB');
    const carol = make('CAROL');
    await settle();
    expect(host.phase).toBe('lobby');

    await host.createRoom('ALICE ROOM', true, { teams: 2, tanksPerTeam: 2, minutes: 2 });
    server.flush();
    expect(host.phase).toBe('room');
    await bob.joinRoom(host.roomCode!);
    await carol.joinRoom(host.roomCode!);
    server.flush();
    expect(bob.room?.members.map((member) => member.name)).toEqual(['ALICE', 'BOB', 'CAROL']);
    // Newcomers fill the emptiest team.
    expect(bob.room?.members.map((member) => member.teamId)).toEqual([0, 1, 0]);

    carol.chooseTeam(1);
    server.flush();
    expect(host.room?.members.map((member) => member.teamId)).toEqual([0, 1, 1]);

    const started: string[] = [];
    bob.onMatch((match) => started.push(match ? 'start' : 'end'));
    host.start();
    server.flush();
    expect(started).toEqual(['start']);
    expect(bob.phase).toBe('match');
    expect(bob.match?.localSeat).toBe(1);
    expect(carol.match?.spec.seats.map((seat) => [seat.name, seat.teamId, seat.teamIndex])).toEqual([
      ['ALICE', 0, 0],
      ['BOB', 1, 0],
      ['CAROL', 1, 1],
    ]);

    runFrames([host, bob, carol], 400);
    // Let the clients drain the few ticks they run behind.
    for (let i = 0; i < 20; i += 1) {
      bob.frame(FRAME, null);
      carol.frame(FRAME, null);
    }
    expect(host.match!.state.tick).toBeGreaterThan(300);
    expect(bob.match!.state.tick).toBeGreaterThan(host.match!.state.tick - 6);
    // Compare at the same tick: run the host's hash check through the stream.
    expect(bob.match!.desync).toBeNull();
    expect(carol.match!.desync).toBeNull();
    expect(notices.filter((notice) => notice.level === 'error')).toEqual([]);
  });

  it('when the host leaves mid-match, the next player takes over and the others keep playing in sync', async () => {
    const { server, timers, notices, make, runFrames } = harness();
    const host = make('ALICE');
    const bob = make('BOB');
    const carol = make('CAROL');
    await settle();
    await host.createRoom('R', false, { teams: 2, tanksPerTeam: 2, minutes: 2 });
    server.flush();
    await bob.joinRoom(host.roomCode!);
    await carol.joinRoom(host.roomCode!);
    server.flush();
    host.start();
    server.flush();
    runFrames([host, bob, carol], 200);

    host.close();
    server.flush();
    expect(bob.isHost).toBe(true);
    // Bob asked Carol for her rows; her answer completes the hand-over without the timer.
    expect(timers.length).toBe(1);
    expect(bob.match?.role).toBe('host');
    expect(notices.some((notice) => notice.text.includes('You are hosting now'))).toBe(true);

    runFrames([bob, carol], 400);
    for (let i = 0; i < 20; i += 1) carol.frame(FRAME, null);
    expect(bob.match!.isHandedOver(0)).toBe(true);
    expect(carol.match!.isHandedOver(0)).toBe(true);
    expect(carol.match!.desync).toBeNull();
    expect(notices.filter((notice) => notice.level === 'error')).toEqual([]);
    // Same tick, same world.
    expect(Math.abs(carol.match!.state.tick - bob.match!.state.tick)).toBeLessThanOrEqual(12);
  });

  it('back to room ends the match on every browser and a second START is a new match', async () => {
    const { server, make, runFrames } = harness();
    const host = make('ALICE');
    const bob = make('BOB');
    await settle();
    await host.createRoom('R', true, { teams: 2, tanksPerTeam: 1, minutes: 2 });
    server.flush();
    await bob.joinRoom(host.roomCode!);
    server.flush();
    host.start();
    server.flush();
    runFrames([host, bob], 60);
    host.backToRoom();
    server.flush();
    expect(bob.match).toBeNull();
    expect(bob.phase).toBe('room');
    host.start();
    server.flush();
    expect(bob.match?.spec.matchNo).toBe(2);
    expect(bob.match?.spec.seed).not.toBe(100);
  });

  it('a player who joins during a match waits and is seated in the next one', async () => {
    const { server, make, runFrames } = harness();
    const host = make('ALICE');
    const late = make('LATE');
    await settle();
    await host.createRoom('R', true, { teams: 2, tanksPerTeam: 2, minutes: 2 });
    server.flush();
    host.start();
    server.flush();
    runFrames([host], 30);
    await late.joinRoom(host.roomCode!);
    server.flush();
    expect(late.match).toBeNull();
    expect(late.phase).toBe('room');
    expect(late.room?.phase).toBe('match');
    host.backToRoom();
    server.flush();
    host.start();
    server.flush();
    expect(late.match?.localSeat).toBe(1);
  });
});
