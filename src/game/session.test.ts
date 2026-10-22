import { describe, expect, it } from 'vitest';
import { PlayableSession } from './session.ts';

const FIRE = {
  throttle: 0,
  steer: 0,
  aimYaw: 0,
  aimPitch: 0,
  fire: true,
} as const;

describe('the playable session bridge', () => {
  it('the demo is deterministic and freezes on a shell in flight at tick 122', () => {
    const first = new PlayableSession({ demo: true });
    const second = new PlayableSession({ demo: true });
    first.runDemo(122);
    second.runDemo(122);

    expect(first.state.tick).toBe(122);
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
    session.runDemo(130);
    expect(session.state.tick).toBe(124);
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

  it('keeps the dummy static while the player drives and fires', () => {
    const session = new PlayableSession();
    const dummyStart = session.dummy;
    for (let tick = 0; tick < 20; tick += 1) {
      session.step(FIRE);
    }
    expect(session.dummy.x).toBe(dummyStart.x);
    expect(session.dummy.z).toBe(dummyStart.z);
    expect(session.state.tick).toBe(20);
  });
});
