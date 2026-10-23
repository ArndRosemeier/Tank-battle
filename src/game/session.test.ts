import { describe, expect, it } from 'vitest';
import { PlayableSession } from './session.ts';

const FIRE = {
  throttle: 0,
  steer: 0,
  aimYaw: 0,
  aimPitch: 0,
  fire: true,
} as const;

const IDLE = {
  throttle: 0,
  steer: 0,
  aimYaw: 0,
  aimPitch: 0,
  fire: false,
} as const;

describe('the playable session bridge', () => {
  it('the demo is deterministic and freezes on a shell in flight at tick 571', () => {
    const first = new PlayableSession({ demo: true });
    const second = new PlayableSession({ demo: true });
    first.runDemo(571);
    second.runDemo(571);

    expect(first.state.tick).toBe(571);
    expect(first.state.status).toBe('active');
    expect(first.dummy.hp).toBe(1);
    expect(first.state.shells).toHaveLength(1);
    expect(first.state.stats).toMatchObject({ shotsFired: 3, hits: 2, kills: 0 });
    expect(first.state.world.revision).toBeGreaterThan(0);
    expect(first.state.world.revision).toBe(second.state.world.revision);
    expect(first.interpolatedTanks(1)).toEqual(second.interpolatedTanks(1));
    expect(first.demo).toBe(true);
  });

  it('the demo reaches a real last-team win and leaves a dead dummy', () => {
    const session = new PlayableSession({ demo: true });
    session.runDemo(600);
    expect(session.state.tick).toBe(574);
    expect(session.state.status).toBe('ended');
    expect(session.state.outcome).toBe('last-team');
    expect(session.state.winnerTeamId).toBe(0);
    expect(session.dummy.alive).toBe(false);
    expect(session.dummy.hp).toBe(0);
    expect(session.state.stats.causes.shell).toBe(1);
  });

  it('interpolates tank transforms between the previous and current sim tick', () => {
    const session = new PlayableSession();
    const start = session.player;
    session.step({ ...FIRE, fire: false, throttle: 1 });
    const after = session.player;
    expect(after.x).toBeGreaterThan(start.x);

    const atStart = session.interpolatedTanks(0).find((frame) => frame.id === session.playerTankId);
    const atEnd = session.interpolatedTanks(1).find((frame) => frame.id === session.playerTankId);
    expect(atStart?.x).toBe(start.x);
    expect(atEnd?.x).toBe(after.x);
  });

  it('starts a REAL 1v1: the AI opponent spawns across the arena, closes in and fires', () => {
    const session = new PlayableSession();
    const start = session.dummy;
    const player = session.player;
    // The old fixture put a static target 6 m ahead; the owner read that as an opponent
    // "sitting directly next to me". The opponent must come from the opposite corner.
    expect(Math.hypot(start.x - player.x, start.z - player.z)).toBeGreaterThan(24);

    for (let tick = 0; tick < 900; tick += 1) {
      session.step(IDLE);
    }

    const after = session.dummy;
    expect(Math.hypot(after.x - start.x, after.z - start.z)).toBeGreaterThan(2);
    expect(session.state.stats.shotsFired).toBeGreaterThan(0);
    expect(session.state.tick).toBe(900);
  });
});
