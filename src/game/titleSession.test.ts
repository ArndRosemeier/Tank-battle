import { describe, expect, it } from 'vitest';
import { TitleSession, TITLE_DIRECTOR_INTERVAL_TICKS } from './titleSession.ts';

describe('the title background match', () => {
  it('is deterministic for a seed and uses the slow director', () => {
    const first = new TitleSession({ seed: 11 });
    const second = new TitleSession({ seed: 11 });
    first.runTicks(600);
    second.runTicks(600);
    expect(first.hash()).toBe(second.hash());
    expect(first.state.tick).toBe(600);
    expect(first.spectator.directorIntervalTicks).toBe(TITLE_DIRECTOR_INTERVAL_TICKS);
    expect(TITLE_DIRECTOR_INTERVAL_TICKS).toBe(420);

    const other = new TitleSession({ seed: 12 });
    other.runTicks(600);
    expect(other.hash()).not.toBe(first.hash());
  }, 20000);

  it('is disposed when the title is left and cannot advance afterwards', () => {
    const session = new TitleSession({ seed: 5 });
    expect(session.disposed).toBe(false);
    session.advance(1 / 60);
    session.dispose();
    expect(session.disposed).toBe(true);
    expect(() => session.advance(1 / 60)).toThrow(/disposed/);
    expect(() => session.runTicks(10)).toThrow(/disposed/);
    expect(() => session.dispose()).not.toThrow();
  });
});
