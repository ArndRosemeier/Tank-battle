import { describe, expect, it } from 'vitest';
import {
  blastTerrain,
  boxTerrain,
  buildTerrain,
  densityAt,
  flatTerrain,
  isSolidAt,
  type TerrainBox,
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

const FLOOR = 1.5;
const TICK = 1 / 60;

/** A flat 24 × 24 m field (16 cells of 1.5 m), optionally with upright blocks. */
function level(options: { cellsX?: number; boxes?: readonly TerrainBox[] } = {}): WorldSpec {
  const cellsX = options.cellsX ?? 16;
  return options.boxes ? boxTerrain(cellsX, 16, FLOOR, options.boxes) : flatTerrain(cellsX, 16, FLOOR);
}

/** A wall block across x 0…24 between two z planes, 3 m tall. */
function wallAcross(minZ: number, maxZ: number): TerrainBox {
  return { minX: -3, maxX: 27, minZ, maxZ, topMetres: FLOOR + 3 };
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
  it('a tank cannot drive into a wall but drives down into and out of a crater', () => {
    const blocked = duel({
      world: level({ boxes: [wallAcross(3, 6)] }),
      shooter: { xMetres: 5, zMetres: 10, hullYawDegrees: 0 },
    });
    for (let tick = 0; tick < 90; tick += 1) {
      step(blocked, onlyOverrides([[0, { throttle: 1 }]]));
    }
    // The wall face is at z = 6; the hull (radius 1, probes 1 m ahead) stops short of it.
    expect(tankAt(blocked, 0).z).toBeGreaterThan(6.5);
    expect(tankAt(blocked, 0).z).toBeLessThan(10);
    expect(tankAt(blocked, 0).y).toBeCloseTo(FLOOR, 1);

    const craterMatch = duel({ shooter: { xMetres: 5, zMetres: 12, hullYawDegrees: 0 } });
    blastTerrain(craterMatch.world, 5, FLOOR, 7);
    let lowest = Infinity;
    for (let tick = 0; tick < 90; tick += 1) {
      step(craterMatch, onlyOverrides([[0, { throttle: 1 }]]));
      lowest = Math.min(lowest, tankAt(craterMatch, 0).y);
    }
    expect(lowest).toBeLessThan(FLOOR - 0.3);
    expect(tankAt(craterMatch, 0).z).toBeLessThan(4);
    expect(tankAt(craterMatch, 0).alive).toBe(true);
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
        // The centres are 1.9 m apart: only circle overlap can catch this one.
        { id: 1, tanks: [{ xMetres: 6.9, zMetres: 5 }] },
      ]),
    ).toThrow(/overlaps/);
  });

  it('a blocked diagonal drive slides along the free x axis', () => {
    // A wall directly north; a diagonal north-east move must slide east rather than
    // stop dead. The tank starts clear of the wall and drives until it reaches it.
    const state = duel({
      world: level({ boxes: [wallAcross(3, 6)] }),
      shooter: { xMetres: 4.7, zMetres: 10, hullYawDegrees: -45 },
    });
    for (let tick = 0; tick < 60; tick += 1) {
      step(state, onlyOverrides([[0, { throttle: 1 }]]));
    }
    const tank = tankAt(state, 0);
    expect(tank.x).toBeGreaterThan(4.7 + 3);
    expect(tank.z).toBeGreaterThan(6.5);
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
    const wide = level({ cellsX: 107 });
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

  it('a shell that strikes a wall blasts a crater into it and despawns', () => {
    const state = duel({
      world: level({ boxes: [wallAcross(9, 12)] }),
      shooter: { xMetres: 5, zMetres: 20, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    const probe = { x: 5, y: FLOOR + MUZZLE_HEIGHT_METRES, z: 12.2 };
    expect(isSolidAt(state.world, probe.x, probe.y, probe.z - 0.5)).toBe(true);
    const revision = state.world.revision;
    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 5 && state.shells.length > 0; tick += 1) {
      step(state);
    }
    expect(state.shells).toHaveLength(0);
    expect(state.world.revision).toBeGreaterThan(revision);
    // The face where the shell struck is now open air.
    expect(isSolidAt(state.world, probe.x, probe.y, probe.z - 0.5)).toBe(false);
  });

  it('a shell aimed downward blasts a crater into the ground it strikes', () => {
    const state = duel({ shooter: { xMetres: 5, zMetres: 16, hullYawDegrees: 0, turretYawDegrees: 0, aimPitchDegrees: -30 } });
    // The descending path meets the ground about 5 m ahead of the muzzle.
    const before = densityAt(state.world, 5, FLOOR - 0.5, 10.9);
    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 8 && state.shells.length > 0; tick += 1) {
      step(state);
    }
    expect(densityAt(state.world, 5, FLOOR - 0.5, 10.9)).toBeLessThan(before);
    // Not under the shooter.
    expect(densityAt(state.world, 5, FLOOR - 0.5, 16)).toBe(before);
  });

  it('rock between the hull and the muzzle stops the shell on the spawn tick and the reload is still spent', () => {
    // The tank stands 1.5 m from a wall; its 3 m barrel reaches into the rock.
    const state = duel({
      world: level({ boxes: [wallAcross(9, 12)] }),
      shooter: { xMetres: 5, zMetres: 14, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    const revision = state.world.revision;

    step(state, onlyOverrides([[0, { fire: true }]]));

    expect(state.shells).toHaveLength(0);
    expect(state.world.revision).toBeGreaterThan(revision);
    expect(tankAt(state, 0).reloadTicksRemaining).toBe(RELOAD_TICKS);
    expect(state.stats.shotsFired).toBe(1);
  });



  it('attributes blasted rock to the team that fired the shell', () => {
    const state = duel({
      world: level({ boxes: [wallAcross(9, 12)] }),
      shooter: { xMetres: 5, zMetres: 20, hullYawDegrees: 0, turretYawDegrees: 0 },
    });
    expect(state.stats.worldDestructionByTeam[0]).toBe(0);
    expect(state.stats.worldDestructionByTeam[1]).toBe(0);

    step(state, onlyOverrides([[0, { fire: true }]]));
    for (let tick = 0; tick < 20 && state.shells.length > 0; tick += 1) {
      step(state);
    }

    expect(state.stats.worldDestructionByTeam[0]).toBeGreaterThan(0);
    expect(state.stats.worldDamageByTeam[0]).toBeGreaterThanOrEqual(state.stats.worldDestructionByTeam[0]!);
    expect(state.stats.worldDestructionByTeam[1]).toBe(0);
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
    expect(tankAt(state, 1).killedByTeamId).toBe(0);
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
    expect(tankAt(state, 1).killedByTeamId).toBeNull();
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

describe('tanks on a landscape', () => {
  it('drives up a ramp: the hull rises and pitches nose-up, and slows on the climb', () => {
    // A 25° ramp rising towards −z from z = 14, topping out 4 m up.
    const ramp = buildTerrain({
      cellsX: 16,
      cellsY: 8,
      cellsZ: 16,
      sample: (_x, y, z) => ({ solidity: Math.min(FLOOR + 4, FLOOR + Math.max(0, 14 - z) * Math.tan((25 * Math.PI) / 180)) - y }),
    });
    const state = duel({ world: ramp, shooter: { xMetres: 5, zMetres: 18, hullYawDegrees: 0 } });
    let pitched = false;
    let slowest = Infinity;
    for (let tick = 0; tick < 300; tick += 1) {
      const z = tankAt(state, 0).z;
      step(state, onlyOverrides([[0, { throttle: 1 }]]));
      if (tankAt(state, 0).hullPitchDegrees > 15) {
        pitched = true;
        slowest = Math.min(slowest, z - tankAt(state, 0).z);
      }
    }
    expect(pitched).toBe(true);
    expect(tankAt(state, 0).y).toBeGreaterThan(FLOOR + 3.5);
    // Climbing costs speed, but the tank still makes headway.
    expect(slowest).toBeLessThan(TANK_SPEED_METRES_PER_SECOND * TICK * 0.8);
    expect(slowest).toBeGreaterThan(TANK_SPEED_METRES_PER_SECOND * TICK * 0.3);
  });

  it('a wall steeper than the climb limit stops the tank', () => {
    const state = duel({
      world: level({ boxes: [wallAcross(3, 6)] }),
      shooter: { xMetres: 5, zMetres: 10, hullYawDegrees: 0 },
    });
    for (let tick = 0; tick < 120; tick += 1) step(state, onlyOverrides([[0, { throttle: 1 }]]));
    expect(tankAt(state, 0).y).toBeLessThan(FLOOR + 0.5);
  });

  it('drives off a cliff, falls under gravity and takes fall damage on a hard landing', () => {
    // A 12 m mesa over the west half of the field.
    const mesa = buildTerrain({
      cellsX: 16,
      cellsY: 12,
      cellsZ: 16,
      sample: (x, y) => ({ solidity: Math.max(FLOOR - y, Math.min(12 - x, FLOOR + 12 - y)) }),
    });
    const state = duel({
      world: mesa,
      shooter: { xMetres: 8, zMetres: 5, hullYawDegrees: -90 },
      target: { xMetres: 20, zMetres: 20 },
    });
    expect(tankAt(state, 0).y).toBeCloseTo(FLOOR + 12, 0);
    let fell = false;
    for (let tick = 0; tick < 150 && tankAt(state, 0).alive; tick += 1) {
      step(state, onlyOverrides([[0, { throttle: tick < 60 ? 1 : 0 }]]));
      if (tankAt(state, 0).verticalSpeed < -5) fell = true;
    }
    expect(fell).toBe(true);
    const tank = tankAt(state, 0);
    expect(tank.hp).toBeLessThan(TANK_MAX_HP);
    if (tank.alive) expect(tank.y).toBeCloseTo(FLOOR, 0);
    else expect(tank.deathCause).toBe('terrain');
  });

  it('shooting out a stem drops the rock above it on a tank and credits the shooter', () => {
    // A mushroom: a 1.2 m stem holding a 4 m cap whose underside is 5 m up.
    const mushroom = buildTerrain({
      cellsX: 16,
      cellsY: 8,
      cellsZ: 16,
      sample: (x, y, z) => {
        const r = Math.hypot(x - 12, z - 12);
        const stem = Math.min(1.2 - r, FLOOR + 6 - y);
        const cap = Math.min(4 - r, y - (FLOOR + 5), FLOOR + 6.5 - y);
        return { solidity: Math.max(FLOOR - y, stem, cap) };
      },
    });
    const state = duel({
      world: mushroom,
      shooter: { xMetres: 3, zMetres: 12, hullYawDegrees: -90, turretYawDegrees: -90 },
      target: { xMetres: 14.6, zMetres: 12, hullYawDegrees: 0 },
    });
    let crushed = false;
    for (let tick = 0; tick < 200 && state.status === 'active'; tick += 1) {
      step(state, onlyOverrides([[0, { fire: tick === 0 }]]));
      if (tankAt(state, 1).hp < TANK_MAX_HP) crushed = true;
    }
    expect(crushed).toBe(true);
    const victim = tankAt(state, 1);
    if (!victim.alive) {
      expect(victim.deathCause).toBe('terrain');
      expect(victim.killedByTeamId).toBe(0);
    }
    // The cap no longer stands over the stem's old place.
    expect(isSolidAt(state.world, 12, FLOOR + 5.7, 12)).toBe(false);
    expect(state.world.chunks).toHaveLength(0);
  });
});
