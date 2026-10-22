import { describe, expect, it } from 'vitest';
import { hashMatch } from '../core/sim.ts';
import { SpectatorSession } from './spectator.ts';

describe('the spectator session', () => {
  it('runs a deterministic four-team match and exposes a director shot', () => {
    const first = new SpectatorSession({ teams: 4, tanksPerTeam: 4, seed: 7 });
    const second = new SpectatorSession({ teams: 4, tanksPerTeam: 4, seed: 7 });
    expect(first.state.teams).toHaveLength(4);
    expect(first.state.tanks).toHaveLength(16);
    expect(first.characters).toEqual(['vanguard', 'sniper', 'ambusher', 'brute']);

    first.runTicks(180);
    second.runTicks(180);
    expect(hashMatch(first.state)).toBe(hashMatch(second.state));
    expect(first.directorShot()).toEqual(second.directorShot());
    const shot = first.directorShot();
    expect(shot.distanceMetres).toBeGreaterThanOrEqual(12);
    expect(shot.distanceMetres).toBeLessThanOrEqual(44);
    expect(first.state.tanks.some((tank) => tank.alive && tank.id === shot.focusTankId)).toBe(true);
  });

  it('next-tank locks a manual follow and auto can be resumed', () => {
    const spectator = new SpectatorSession({ teams: 2, tanksPerTeam: 2, seed: 3 });
    const next = spectator.nextTank();
    expect(next).not.toBeNull();
    expect(spectator.autoDirector).toBe(false);
    expect(spectator.followedTankId).toBe(next);
    expect(spectator.directorShot().reason).toBe('follow');
    spectator.resumeAutoDirector();
    expect(spectator.autoDirector).toBe(true);
    expect(spectator.followedTankId).not.toBeNull();
  });
});
