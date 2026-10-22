import { describe, expect, it } from 'vitest';
import { teamTurnOrder } from './turnOrder.ts';
import { seededAssignmentOrder } from '../ai/teamBatch.ts';

describe('the per-tick team turn order', () => {
  it('is a pure function of seed, tick and the team-id set', () => {
    const first = teamTurnOrder(17, 42, [0, 1, 2, 3]);
    const second = teamTurnOrder(17, 42, [3, 1, 0, 2]);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(4);
    // The full set is present; the order itself is the seeded sequence.
    expect([...first].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('gives every team every rank exactly once over a four-tick cycle', () => {
    for (const seed of [0, 1, 7, 0xffff_ffff]) {
      const rankCounts = new Map<number, number[]>();
      for (const teamId of [0, 1, 2, 3]) rankCounts.set(teamId, []);
      for (let tick = 0; tick < 4; tick += 1) {
        const order = teamTurnOrder(seed, tick, [0, 1, 2, 3]);
        expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
        for (let rank = 0; rank < order.length; rank += 1) rankCounts.get(order[rank]!)!.push(rank);
      }
      for (const ranks of rankCounts.values()) {
        expect([...ranks].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it('permutes the team array deterministically without changing team identity', () => {
    const teams = [0, 1, 2, 3].map((teamId) => ({ teamId }));
    const first = seededAssignmentOrder(teams, 7).map((team) => team.teamId);
    const second = seededAssignmentOrder([...teams].reverse(), 7).map((team) => team.teamId);
    expect(second).toEqual(first);
    expect([...first].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(teams.map((team) => team.teamId)).toEqual([0, 1, 2, 3]);
    expect(seededAssignmentOrder(teams, 8).map((team) => team.teamId)).not.toEqual(first);
  });

  it('rejects malformed team ids and non-integer ticks', () => {
    expect(() => teamTurnOrder(1, 1, [0, 0])).toThrow(/unique/);
    expect(() => teamTurnOrder(1, 1, [])).toThrow(/non-empty/);
    expect(() => teamTurnOrder(1, -1, [0, 1])).toThrow(/tick/);
    expect(() => teamTurnOrder(1, 1, [0, 1.5])).toThrow(/team id/);
  });
});
