import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';
import {
  blockAt,
  cellAt,
  cellState,
  damageCell,
  listShards,
  shardDeflection,
  shatterShard,
  type WorldSpec,
} from './world.ts';
import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  DEFAULT_MATCH_RULES,
  MATCH_TICK_CAP,
  MUZZLE_FORWARD_METRES,
  MUZZLE_HEIGHT_METRES,
  RELOAD_TICKS,
  SHELL_METRES_PER_TICK,
  SHELL_RANGE_METRES,
  TANK_MAX_HP,
  TANK_SPEED_METRES_PER_SECOND,
  TANK_TURN_RATE_DEGREES_PER_SECOND,
  TURRET_RATE_DEGREES_PER_SECOND,
  createMatch,
  hashMatch,
  stepMatch,
  type MatchState,
  type MatchRules,
  type TankCommand,
  type TankCommandOrder,
  type TankSpawn,
  type TeamSpec,
  type ScriptedController,
} from './sim.ts';
import { ScriptedController as Scripted } from './sim/controller.ts';

const FLOOR = 0.25;
const TICK = 1 / 60;

function level(overrides: Partial<WorldSpec> = {}): WorldSpec {
  return {
    columns: 12,
    rows: 12,
    floorSurfaceHeightMetres: FLOOR,
    ...overrides,
  };
}

function duel(options: {
  shooter?: TankSpawn;
  target?: TankSpawn;
  world?: WorldSpec;
  rules?: MatchRules;
  seed?: number;
} = {}): MatchState {
  return createMatch({
    level: options.world ?? level(),
    teams: [
      { id: 0, tanks: [options.shooter ?? { xMetres: 5, zMetres: 5 }] },
      { id: 1, tanks: [options.target ?? { xMetres: 21, zMetres: 21 }] },
    ],
    seed: options.seed ?? 12345,
    rules: options.rules ?? DEFAULT_MATCH_RULES,
  });
}

function matchWithTeams(teams: readonly TeamSpec[], options: {
  world?: WorldSpec;
  rules?: MatchRules;
  seed?: number;
} = {}): MatchState {
  return createMatch({
    level: options.world ?? level(),
    teams,
    seed: options.seed ?? 12345,
    rules: options.rules ?? DEFAULT_MATCH_RULES,
  });
}

function command(overrides: Partial<TankCommand> = {}): TankCommand {
  return {
    throttle: 0,
    steer: 0,
    aimYaw: 0,
    aimPitch: 0,
    fire: false,
    ...overrides,
  };
}

/** A command for every ALIVE tank, preserving its current aim unless overridden. */
function orders(state: MatchState, overrides: ReadonlyMap<number, Partial<TankCommand>> = new Map()): TankCommandOrder[] {
  return state.tanks
    .filter((tank) => tank.alive)
    .map((tank) => ({
      tankId: tank.id,
      command: command({
        aimYaw: tank.turretYawDegrees,
        aimPitch: tank.aimPitchDegrees,
        ...(overrides.get(tank.id) ?? {}),
      }),
    }));
}

function step(state: MatchState, overrides: ReadonlyMap<number, Partial<TankCommand>> = new Map()): MatchState {
  return stepMatch(state, orders(state, overrides));
}

function onlyOverrides(entries: readonly (readonly [number, Partial<TankCommand>])[]): Map<number, Partial<TankCommand>> {
  return new Map(entries);
}

function tankAt(state: MatchState, id: number) {
  const tank = state.tanks.find((candidate) => candidate.id === id);
  if (!tank) {
    throw new Error(`test: no tank ${id}`);
  }
  return tank;
}

describe('the combat core', () => {
  it('a tank cannot drive into a wall cell but can drive over a floor hole', () => {
    const wallWorld = level({
      placements: [{ x: 2, z: 2, material: 'wall', heightMetres: 3 }],
    });
    const blocked = duel({
      world: wallWorld,
      shooter: { xMetres: 5, zMetres: 9, hullYawDegrees: 0 },
    });
    for (let tick = 0; tick < 60; tick += 1) {
      step(blocked, onlyOverrides([[0, { throttle: 1 }]]));
    }
    // The wall cell is z = 4…6; a radius-1 tank stops with its centre at z ≈ 7.
    expect(tankAt(blocked, 0).z).toBeGreaterThanOrEqual(7 - 1e-9);
    expect(tankAt(blocked, 0).z).toBeLessThan(9);

    const holeWorld = level();
    const holeMatch = duel({ world: holeWorld, shooter: { xMetres: 5, zMetres: 9 } });
    // Destroy the floor cell the tank is heading for.
    damageCell(holeMatch.world, 2, 2, 1, createRng(3));
    expect(cellState(cellAt(holeMatch.world, 2, 2))).toBe('hole');
    for (let tick = 0; tick < 40; tick += 1) {
      step(holeMatch, onlyOverrides([[0, { throttle: 1 }]]));
    }
    expect(tankAt(holeMatch, 0).z).toBeLessThan(7);
  });

  it('a tank cannot drive through another tank', () => {
    const state = duel({
      shooter: { xMetres: 5, zMetres: 9, hullYawDegrees: 0 },
      target: { xMetres: 5, zMetres: 5, hullYawDegrees: 0 },
    });
    for (let tick = 0; tick < 60; tick += 1) {
      step(state, onlyOverrides([[0, { throttle: 1 }]]));
    }
    const shooter = tankAt(state, 0);
    const target = tankAt(state, 1);
    expect(target.z).toBe(5);
    expect(shooter.z).toBeGreaterThanOrEqual(7 - 1e-9);
    expect(Math.hypot(shooter.x - target.x, shooter.z - target.z)).toBeGreaterThanOrEqual(
      2 - 1e-9,
    );
  });

  it('tank-tank blocking is independent of the tank array order', () => {
    function run(reverse: boolean): { positions: readonly string[]; hash: string } {
      const state = matchWithTeams([
        { id: 0, tanks: [{ xMetres: 5, zMetres: 9, hullYawDegrees: 0 }] },
        { id: 1, tanks: [{ xMetres: 5, zMetres: 5, hullYawDegrees: 180 }] },
      ]);
      if (reverse) {
        state.tanks.reverse();
      }
      for (let tick = 0; tick < 60; tick += 1) {
        step(state, onlyOverrides([[0, { throttle: 1 }], [1, { throttle: 1 }]]));
      }
      return {
        positions: state.tanks
          .map((tank) => `${tank.id}:${tank.x.toFixed(9)},${tank.z.toFixed(9)}`)
          .sort(),
        hash: hashMatch(state),
      };
    }

    expect(run(true)).toEqual(run(false));
  });

  it('two tanks spawned on the same cell are rejected at match creation', () => {
    expect(() =>
      matchWithTeams([
        { id: 0, tanks: [{ xMetres: 5, zMetres: 5 }] },
        { id: 1, tanks: [{ xMetres: 5, zMetres: 5 }] },
      ]),
    ).toThrow(/shares cell|overlaps/);
  });

  it('two tanks in adjacent cells whose circles overlap are rejected at match creation', () => {
    expect(() =>
      matchWithTeams([
        { id: 0, tanks: [{ xMetres: 5, zMetres: 5 }] },
        // Cell (2, 2) is x 4…6; cell (3, 2) is x 6…8. The centres are 1.9 m apart,
        // so the SAME-CELL check cannot catch this one; only circle overlap can.
        { id: 1, tanks: [{ xMetres: 6.9, zMetres: 5 }] },
      ]),
    ).toThrow(/overlaps/);
  });

  it('a blocked diagonal drive slides along the free x axis', () => {
    // A wall directly north; a diagonal north-east move must slide east rather than
    // stop dead. The tank starts clear of the wall and drives until it reaches it.
    const state = duel({
      world: level({
        placements: Array.from({ length: 12 }, (_, x) => ({ x, z: 2, material: 'wall' as const, heightMetres: 3 })),
      }),
      shooter: { xMetres: 4.7, zMetres: 9, hullYawDegrees: -45 },
    });
    for (let tick = 0; tick < 60; tick += 1) {
      step(state, onlyOverrides([[0, { throttle: 1 }]]));
    }
    const tank = tankAt(state, 0);
    expect(tank.x).toBeGreaterThan(4.7);
    expect(tank.z).toBeGreaterThanOrEqual(7 - 1e-9);
  });

  it('throttle and steer produce the documented speed and turn rate', () => {
    const state = duel({ shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 0 } });
    step(state, onlyOverrides([[0, { throttle: 1 }]]));
    expect(tankAt(state, 0).x).toBeCloseTo(5, 10);
    expect(tankAt(state, 0).z).toBeCloseTo(5 - TANK_SPEED_METRES_PER_SECOND * TICK, 10);

    const turning = duel({ shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 0 } });
    step(turning, onlyOverrides([[0, { steer: 1 }]]));
    expect(tankAt(turning, 0).hullYawDegrees).toBeCloseTo(
      TANK_TURN_RATE_DEGREES_PER_SECOND * TICK,
      10,
    );
    expect(tankAt(turning, 0).z).toBe(5);
  });

  it('the turret yaw is independent of the hull', () => {
    const state = duel({ shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 0, turretYawDegrees: 0 } });
    step(state, onlyOverrides([[0, { steer: 1, aimYaw: 90 }]]));
    const tank = tankAt(state, 0);
    expect(tank.hullYawDegrees).toBeCloseTo(TANK_TURN_RATE_DEGREES_PER_SECOND * TICK, 10);
    expect(tank.turretYawDegrees).toBeCloseTo(TURRET_RATE_DEGREES_PER_SECOND * TICK, 10);
    expect(tank.turretYawDegrees).not.toBe(tank.hullYawDegrees);

    for (let tick = 0; tick < 60; tick += 1) {
      step(state, onlyOverrides([[0, { aimYaw: 90 }]]));
    }
    expect(tankAt(state, 0).turretYawDegrees).toBeCloseTo(90, 9);
    expect(tankAt(state, 0).hullYawDegrees).not.toBe(90);
  });

  it('the aim pitch is clamped to the documented range', () => {
    const state = duel();
    expect(() =>
      step(state, onlyOverrides([[0, { aimPitch: AIM_PITCH_MAX_DEGREES + 0.1 }]])),
    ).toThrow(/aimPitch/);
    expect(() =>
      step(state, onlyOverrides([[0, { aimPitch: AIM_PITCH_MIN_DEGREES - 0.1 }]])),
    ).toThrow(/aimPitch/);
    expect(() => step(state, onlyOverrides([[0, { aimPitch: Number.NaN }]]))).toThrow(/finite/);
    expect(state.tick).toBe(0);

    const aiming = duel({ shooter: { xMetres: 5, zMetres: 5, aimPitchDegrees: 0 } });
    for (let tick = 0; tick < 20; tick += 1) {
      step(aiming, onlyOverrides([[0, { aimPitch: AIM_PITCH_MIN_DEGREES }]]));
    }
    expect(tankAt(aiming, 0).aimPitchDegrees).toBe(AIM_PITCH_MIN_DEGREES);
    expect(tankAt(aiming, 0).aimPitchDegrees).toBeGreaterThanOrEqual(AIM_PITCH_MIN_DEGREES);
  });

  it('firing is refused until the reload elapses and spawns exactly one shell at the muzzle', () => {
    const state = duel({ shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 0, turretYawDegrees: 0 } });
    step(state, onlyOverrides([[0, { fire: true }]]));
    expect(state.shells).toHaveLength(1);
    expect(state.stats.shotsFired).toBe(1);
    const shell = state.shells[0];
    expect(shell?.x).toBeCloseTo(5, 10);
    expect(shell?.z).toBeCloseTo(5 - MUZZLE_FORWARD_METRES, 10);
    expect(shell?.y).toBeCloseTo(FLOOR + MUZZLE_HEIGHT_METRES, 10);
    expect(tankAt(state, 0).reloadTicksRemaining).toBe(RELOAD_TICKS);

    for (let tick = 1; tick < RELOAD_TICKS; tick += 1) {
      step(state, onlyOverrides([[0, { fire: true }]]));
    }
    expect(state.stats.shotsFired).toBe(1);
    step(state, onlyOverrides([[0, { fire: true }]]));
    expect(state.stats.shotsFired).toBe(2);
  });

  it('a shell advances the documented distance per tick and despawns at max range', () => {
    const wide = level({ columns: 80, rows: 12 });
    const state = duel({
      world: wide,
      shooter: { xMetres: 10, zMetres: 10, hullYawDegrees: -90, turretYawDegrees: -90 },
      target: { xMetres: 150, zMetres: 20 },
    });
    step(state, onlyOverrides([[0, { fire: true }]]));
    const first = state.shells[0];
    expect(first).toBeDefined();
    const startX = first?.x ?? 0;
    step(state);
    const second = state.shells[0];
    expect(second).toBeDefined();
    expect((second?.x ?? 0) - startX).toBeCloseTo(SHELL_METRES_PER_TICK, 9);

    let ticks = 1;
    while (state.shells.length > 0 && ticks < 300) {
      step(state);
      ticks += 1;
    }
    expect(state.shells).toHaveLength(0);
    expect(ticks).toBeLessThanOrEqual(Math.ceil(SHELL_RANGE_METRES / SHELL_METRES_PER_TICK) + 2);
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(SHELL_RANGE_METRES / SHELL_METRES_PER_TICK));
  });

  it('a shell that strikes a wall cell damages it by one and despawns', () => {
    const state = duel({
      world: level({ placements: [{ x: 2, z: 5, material: 'wall', heightMetres: 3 }] }),
      shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    const wallBefore = cellAt(state.world, 2, 5);
    expect(wallBefore.hp).toBe(2);
    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 5 && state.shells.length > 0; tick += 1) {
      step(state);
    }
    expect(state.shells).toHaveLength(0);
    expect(cellAt(state.world, 2, 5).hp).toBe(1);
  });

  it('a shell aimed downward breaks the floor cell it strikes', () => {
    const state = duel({ shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0, aimPitchDegrees: -30 } });
    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 8 && state.shells.length > 0; tick += 1) {
      step(state);
    }
    // The floor cell under the descending path, not the shooter's own cell.
    expect(cellState(cellAt(state.world, 2, 5))).toBe('hole');
  });

  it('a wall between the hull and the muzzle stops the shell on the spawn tick and the reload is still spent', () => {
    const state = duel({
      world: level({ placements: [{ x: 2, z: 6, material: 'wall', heightMetres: 3 }] }),
      shooter: { xMetres: 5, zMetres: 15, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    expect(cellAt(state.world, 2, 6).hp).toBe(2);

    step(state, onlyOverrides([[0, { fire: true }]]));

    expect(state.shells).toHaveLength(0);
    expect(cellAt(state.world, 2, 6).hp).toBe(1);
    expect(tankAt(state, 0).reloadTicksRemaining).toBe(RELOAD_TICKS);
    expect(state.stats.shotsFired).toBe(1);
  });

  it('a shell that spawns inside a solid cell resolves that hit exactly once', () => {
    const state = duel({
      world: level({ placements: [{ x: 2, z: 5, material: 'wall', heightMetres: 3 }] }),
      shooter: { xMetres: 5, zMetres: 13.5, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    // The muzzle is at z = 10.5, inside the wall cell occupying 10…12 m.
    step(state, onlyOverrides([[0, { fire: true }]]));

    expect(state.shells).toHaveLength(0);
    expect(cellAt(state.world, 2, 5).hp).toBe(1);
    expect(blockAt(state.world, 2, 5)).toBeNull();
    expect(tankAt(state, 0).reloadTicksRemaining).toBe(RELOAD_TICKS);
    expect(state.stats.shotsFired).toBe(1);
  });

  it('attributes a destroyed cell to the team that fired the shell', () => {
    const state = duel({
      world: level({ placements: [{ x: 2, z: 5, material: 'wall', heightMetres: 3 }] }),
      shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    // Leave the wall at one HP; the next shell is the destroying shot.
    damageCell(state.world, 2, 5, 1, createRng(7));
    expect(cellAt(state.world, 2, 5).hp).toBe(1);
    expect(state.stats.worldDestructionByTeam[0]).toBe(0);
    expect(state.stats.worldDestructionByTeam[1]).toBe(0);

    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 20 && state.shells.length > 0; tick += 1) {
      step(state);
    }

    expect(cellState(cellAt(state.world, 2, 5))).toBe('hole');
    expect(state.stats.worldDestructionByTeam[0]).toBe(1);
    expect(state.stats.worldDestructionByTeam[1]).toBe(0);
  });

  it('a shell that strikes a big block damages it', () => {
    const state = duel({
      world: level({ placements: [{ x: 2, z: 5, material: 'wall', heightMetres: 3 }] }),
      shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    const destroyed = damageCell(state.world, 2, 5, 2, createRng(7));
    expect(destroyed.destroyedNow).toBe(true);
    expect(blockAt(state.world, 2, 5)?.hp).toBe(2);
    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 8 && state.shells.length > 0; tick += 1) {
      step(state);
    }
    expect(state.shells).toHaveLength(0);
    expect(blockAt(state.world, 2, 5)?.hp).toBe(1);
  });

  it('a moving tank shoves floor shards out of its cell', () => {
    const state = duel({ shooter: { xMetres: 5, zMetres: 9, hullYawDegrees: 0 } });
    damageCell(state.world, 2, 2, 1, createRng(3));
    expect(listShards(state.world).filter((shard) => shard.x === 2 && shard.z === 2)).toHaveLength(3);
    for (let tick = 0; tick < 45; tick += 1) {
      step(state, onlyOverrides([[0, { throttle: 1 }]]));
    }
    expect(listShards(state.world).filter((shard) => shard.x === 2 && shard.z === 2)).toHaveLength(0);
  });

  it('a shard shatters and deflects the shell at its stored mirror angle', () => {
    const state = duel({
      shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0, aimPitchDegrees: -30 },
    });
    // Make a clear 3×3 wound around the target cell, keep exactly one shard in it.
    for (let z = 4; z <= 6; z += 1) {
      for (let x = 1; x <= 3; x += 1) {
        damageCell(state.world, x, z, 1, createRng(x * 10 + z));
      }
    }
    const centreShard = listShards(state.world).find(
      (candidate) => candidate.x === 2 && candidate.z === 5,
    );
    if (!centreShard) throw new Error('test: no shard in the target cell');
    for (const shard of [...listShards(state.world)]) {
      if (shard.id !== centreShard.id) {
        shatterShard(state.world, shard.id);
      }
    }
    const shards = listShards(state.world);
    expect(shards).toHaveLength(1);
    const shard = shards[0];
    if (!shard) throw new Error('test: no shard');
    const horizontalBefore = { x: 0, z: -1 };
    const reflected = shardDeflection(shard, horizontalBefore);
    const before = state.world.shards.length;

    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 8 && state.shells.length > 0; tick += 1) {
      step(state);
    }
    expect(state.world.shards.length).toBe(before - 1);
    const shell = state.shells[0];
    expect(shell).toBeDefined();
    if (shell) {
      // The horizontal direction is the stored mirror reflection; the vertical
      // component is unchanged by a 2D shard facet.
      expect(shell.dx).toBeCloseTo(reflected.x * Math.cos((-30 * Math.PI) / 180), 6);
      expect(shell.dz).toBeCloseTo(reflected.z * Math.cos((-30 * Math.PI) / 180), 6);
      expect(shell.dy).toBeCloseTo(Math.sin((-30 * Math.PI) / 180), 9);
    }
  });

  it('a shell striking an enemy tank deals one damage and despawns; three kill', () => {
    const state = duel({
      shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 180, turretYawDegrees: 180 },
      target: { xMetres: 5, zMetres: 15, hullYawDegrees: 0 },
    });
    let guard = 0;
    while (state.status === 'active' && guard < RELOAD_TICKS * 3 + 100) {
      step(state, onlyOverrides([[0, { fire: true }]]));
      guard += 1;
    }
    expect(state.status).toBe('ended');
    expect(tankAt(state, 1).alive).toBe(false);
    expect(tankAt(state, 1).deathCause).toBe('shell');
    expect(state.stats.shotsFired).toBe(3);
    expect(state.stats.hits).toBe(3);
    expect(state.stats.kills).toBe(1);
    expect(state.stats.damageDealt).toBe(TANK_MAX_HP);
    expect(state.stats.causes.shell).toBe(1);
    expect(state.stats.causes.clock).toBe(0);
    expect(state.winnerTeamId).toBe(0);
    expect(state.outcome).toBe('last-team');
    expect(state.shells).toHaveLength(0);
  });

  it('a shell cannot damage a teammate and stops at the teammate body', () => {
    const state = matchWithTeams([
      { id: 0, tanks: [
        { xMetres: 5, zMetres: 5, hullYawDegrees: 180, turretYawDegrees: 180 },
        { xMetres: 5, zMetres: 15, hullYawDegrees: 0 },
      ] },
      { id: 1, tanks: [{ xMetres: 21, zMetres: 21 }] },
    ]);
    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 8 && state.shells.length > 0; tick += 1) {
      step(state);
    }
    expect(state.shells).toHaveLength(0);
    expect(tankAt(state, 1).hp).toBe(TANK_MAX_HP);
    expect(state.stats.hits).toBe(0);
    expect(state.stats.damageDealt).toBe(0);
  });

  it('a wounded tank loses one HP per bleed interval and can die from the clock', () => {
    const rules: MatchRules = { tickCap: 500, bleedIntervalTicks: 3 };
    const state = duel({
      rules,
      shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 180, turretYawDegrees: 180 },
      target: { xMetres: 5, zMetres: 15 },
    });
    // One hit only; the target is now wounded.
    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 20 && tankAt(state, 1).hp === TANK_MAX_HP; tick += 1) {
      step(state);
    }
    expect(tankAt(state, 1).hp).toBe(2);
    expect(tankAt(state, 1).bleedTicksRemaining).toBeGreaterThan(0);

    for (let tick = 0; tick < rules.bleedIntervalTicks; tick += 1) {
      if (state.status !== 'active') break;
      step(state);
    }
    expect(tankAt(state, 1).hp).toBe(1);
    for (let tick = 0; tick < rules.bleedIntervalTicks; tick += 1) {
      if (state.status !== 'active') break;
      step(state);
    }
    expect(tankAt(state, 1).alive).toBe(false);
    expect(tankAt(state, 1).deathCause).toBe('clock');
    expect(state.stats.causes.clock).toBe(1);
    expect(state.stats.kills).toBe(0);
  });

  it('a dead tank no longer moves, aims or fires', () => {
    const state = matchWithTeams([
      { id: 0, tanks: [{ xMetres: 5, zMetres: 5, hullYawDegrees: 180, turretYawDegrees: 180 }] },
      { id: 1, tanks: [
        { xMetres: 5, zMetres: 15, hullYawDegrees: 0 },
        { xMetres: 21, zMetres: 21, hullYawDegrees: 0 },
      ] },
    ]);
    let guard = 0;
    while (tankAt(state, 1).alive && guard < RELOAD_TICKS * 3 + 100) {
      step(state, onlyOverrides([[0, { fire: true }]]));
      guard += 1;
    }
    expect(tankAt(state, 1).alive).toBe(false);
    const victim = tankAt(state, 1);
    const before = {
      x: victim.x,
      z: victim.z,
      hull: victim.hullYawDegrees,
      turret: victim.turretYawDegrees,
      pitch: victim.aimPitchDegrees,
      shells: state.shells.length,
      shots: state.stats.shotsFired,
    };
    stepMatch(
      state,
      state.tanks.map((tank) => ({
        tankId: tank.id,
        command: command({ throttle: 1, steer: 1, aimYaw: 90, aimPitch: 10, fire: true }),
      })),
    );
    expect(victim.x).toBe(before.x);
    expect(victim.z).toBe(before.z);
    expect(victim.hullYawDegrees).toBe(before.hull);
    expect(victim.turretYawDegrees).toBe(before.turret);
    expect(victim.aimPitchDegrees).toBe(before.pitch);
    expect(state.stats.shotsFired).toBeGreaterThanOrEqual(before.shots);
  });

  it('the match ends when one team remains, and at the cap the greater total HP wins', () => {
    const killState = duel({
      shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 180, turretYawDegrees: 180 },
      target: { xMetres: 5, zMetres: 15 },
    });
    let guard = 0;
    while (killState.status === 'active' && guard < RELOAD_TICKS * 3 + 100) {
      step(killState, onlyOverrides([[0, { fire: true }]]));
      guard += 1;
    }
    expect(killState.status).toBe('ended');
    expect(killState.winnerTeamId).toBe(0);
    expect(killState.outcome).toBe('last-team');

    const rules: MatchRules = { tickCap: 30, bleedIntervalTicks: 1000 };
    const capState = duel({
      rules,
      shooter: { xMetres: 5, zMetres: 5, hullYawDegrees: 180, turretYawDegrees: 180 },
      target: { xMetres: 5, zMetres: 15 },
    });
    // One hit, then stop shooting; both teams stay alive, team 0 has more HP.
    step(capState, onlyOverrides([[0, { fire: true }]]));
    let hitGuard = 0;
    while (tankAt(capState, 1).hp === TANK_MAX_HP && hitGuard < 30) {
      step(capState);
      hitGuard += 1;
    }
    expect(tankAt(capState, 1).hp).toBe(2);
    while (capState.status === 'active' && capState.tick < MATCH_TICK_CAP) {
      step(capState);
      if (capState.tick >= rules.tickCap) break;
    }
    expect(capState.status).toBe('ended');
    expect(capState.outcome).toBe('tick-cap');
    expect(capState.winnerTeamId).toBe(0);
  });

  it('a match that ends at the cap with equal HP and equal tanks is a draw', () => {
    const state = duel({ rules: { tickCap: 1, bleedIntervalTicks: 600 } });
    step(state);

    expect(state.status).toBe('ended');
    expect(state.outcome).toBe('draw');
    expect(state.winnerTeamId).toBeNull();
    expect(state.stats.outcome).toBe('draw');
    expect(state.stats.winnerTeamId).toBeNull();
    expect(tankAt(state, 0).hp).toBe(3);
    expect(tankAt(state, 1).hp).toBe(3);
    expect(state.teams.map((team) => team.tanks.filter((tank) => tank.alive).length)).toEqual([
      1, 1,
    ]);
  });

  it('the same seed and command sequence produce an identical match-state hash', () => {
    function run(): MatchState {
      const state = duel({
        shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0, aimPitchDegrees: -30 },
      });
      step(state, onlyOverrides([[0, { fire: true }]]));
      for (let tick = 0; tick < 20; tick += 1) {
        step(state);
      }
      return state;
    }
    const first = run();
    const second = run();
    expect(hashMatch(second)).toBe(hashMatch(first));

    const different = duel({
      shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0, aimPitchDegrees: -30 },
    });
    step(different, onlyOverrides([[0, { throttle: 1, fire: true }]]));
    for (let tick = 0; tick < 20; tick += 1) {
      step(different);
    }
    expect(hashMatch(different)).not.toBe(hashMatch(first));
  });

  it('the scripted duel runs to a shell kill and its stats tell the story', () => {
    const rules: MatchRules = { tickCap: 1000, bleedIntervalTicks: 600 };
    const state = duel({
      rules,
      shooter: { xMetres: 5, zMetres: 10, hullYawDegrees: 180, turretYawDegrees: 180 },
      target: { xMetres: 5, zMetres: 20, hullYawDegrees: 0 },
    });
    const startTargetZ = tankAt(state, 1).z;
    const shooterCommands = Array.from({ length: RELOAD_TICKS * 3 + 30 }, () =>
      command({ aimYaw: 180, aimPitch: 0, fire: true }),
    );
    // The target moves off its start, then holds the line: with the one 285-tick
    // reload, a target that kept driving would walk out of three fixed-aim shots.
    const targetCommands = Array.from({ length: RELOAD_TICKS * 3 + 30 }, (_, tick) =>
      tick < 20
        ? command({ throttle: 0.2, aimYaw: 0, aimPitch: 0 })
        : command({ throttle: 0, aimYaw: 0, aimPitch: 0 }),
    );
    const controller: ScriptedController = new Scripted(
      new Map([
        [0, shooterCommands],
        [1, targetCommands],
      ]),
    );

    let guard = 0;
    while (state.status === 'active' && guard < RELOAD_TICKS * 3 + 30) {
      const commandOrders = state.tanks
        .filter((tank) => tank.alive)
        .map((tank) => ({
          tankId: tank.id,
          command: controller.commandFor(state, tank.id),
        }));
      stepMatch(state, commandOrders);
      guard += 1;
    }

    expect(state.status).toBe('ended');
    expect(state.winnerTeamId).toBe(0);
    expect(state.outcome).toBe('last-team');
    expect(tankAt(state, 1).alive).toBe(false);
    expect(tankAt(state, 1).deathCause).toBe('shell');
    expect(tankAt(state, 1).z).toBeLessThan(startTargetZ);
    expect(state.stats.shotsFired).toBe(3);
    expect(state.stats.hits).toBe(3);
    expect(state.stats.kills).toBe(1);
    expect(state.stats.damageDealt).toBe(3);
    expect(state.stats.causes.shell).toBe(1);
    expect(state.stats.causes.clock).toBe(0);
    expect(state.stats.ticks).toBe(state.tick);
    expect(state.tick).toBeLessThan(rules.tickCap);
  });

  it('a malformed command throws instead of being silently clamped', () => {
    const state = duel();
    expect(() => step(state, onlyOverrides([[0, { throttle: 1.5 }]]))).toThrow(/throttle/);
    expect(() => step(state, onlyOverrides([[0, { steer: -1.5 }]]))).toThrow(/steer/);
    expect(() => step(state, onlyOverrides([[0, { aimPitch: 90 }]]))).toThrow(/aimPitch/);
    expect(() =>
      step(state, onlyOverrides([[0, { fire: 1 as unknown as boolean }]])),
    ).toThrow(/fire/);
    expect(state.tick).toBe(0);
  });
});
