import { flatTerrain } from '../world.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMatch, RELOAD_TICKS, stepMatch, type TankCommand } from '../sim.ts';

const AI_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * The one reload rule (P1): the AI is gated by the simulation's `RELOAD_TICKS`, not by
 * a second, longer fire interval. This pin scans the AI source for the deleted
 * constant, so a future "pacing" tweak cannot silently reintroduce the handicap.
 */
function source(path: string): string {
  return readFileSync(join(AI_DIR, path), 'utf8');
}

describe('one reload rule', () => {
  it('the AI-only fire interval is gone and the AI reads the sim reload', () => {
    const constants = source('constants.ts');
    const controller = source('controller.ts');
    expect(constants).not.toMatch(/AI_FIRE_INTERVAL_TICKS/);
    expect(controller).not.toMatch(/AI_FIRE_INTERVAL_TICKS/);
    expect(controller).toMatch(/\bRELOAD_TICKS\b/);
    expect(controller).toMatch(/tank\.reloadTicksRemaining === 0/);

    // No other module in the tree may reintroduce the second cadence.
    const hits: string[] = [];
    for (const entry of readdirSync(join(AI_DIR, '..'), { recursive: true, encoding: 'utf8' })) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
      if (/AI_FIRE_INTERVAL_TICKS/.test(readFileSync(join(AI_DIR, '..', entry), 'utf8'))) {
        hits.push(entry);
      }
    }
    expect(hits).toEqual([]);
  });

  it('a held trigger fires at exactly the global reload cadence', () => {
    const level = flatTerrain(16, 16, 1.5);
    const state = createMatch({
      level,
      teams: [
        { id: 0, tanks: [{ xMetres: 5, zMetres: 5, hullYawDegrees: -90, turretYawDegrees: -90 }] },
        { id: 1, tanks: [{ xMetres: 21, zMetres: 21 }] },
      ],
      seed: 0,
      rules: { tickCap: RELOAD_TICKS * 3 + 60, bleedIntervalTicks: 600 },
    });
    const shotTicks: number[] = [];
    let before = 0;
    const fire: TankCommand = {
      throttle: 0,
      steer: 0,
      aimYaw: -90,
      aimPitch: 0,
      fire: true,
    };
    const idle: TankCommand = { throttle: 0, steer: 0, aimYaw: 0, aimPitch: 0, fire: false };
    for (let tick = 0; tick < RELOAD_TICKS * 3; tick += 1) {
      stepMatch(state, [
        { tankId: 0, command: fire },
        { tankId: 1, command: idle },
      ]);
      if (state.stats.shotsFired > before) {
        shotTicks.push(state.tick);
        before = state.stats.shotsFired;
      }
    }
    // The trigger is held every tick; only the global reload may pace it.
    expect(shotTicks).toEqual([1, 1 + RELOAD_TICKS, 1 + 2 * RELOAD_TICKS]);
  });
});
