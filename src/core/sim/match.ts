/**
 * The match: teams of tanks in a real A1 world, shells in flight, a seeded RNG and the
 * match clock. This module creates the state; `step.ts` advances it one deterministic
 * tick.
 *
 * What is deliberately absent: a renderer, a DOM, a wall clock, an input device, and
 * any `isPlayer` distinction. A tank's control is a `TankCommand` supplied by a
 * `Controller` (local human or AI; A3c wires the former, Slice B the latter).
 *
 * Conventions (all documented in `src/render` too, via `docs/ARCHITECTURE.md`):
 *  - positions are metres in the world's floor plane; `CELL_SIZE_METRES` converts to
 *    the A1 grid (the A1 model carries heights only, not a horizontal cell size);
 *  - hull/turret yaw 0 faces -z, positive turns towards -x;
 *  - aim pitch is degrees above the horizon, negative aims down;
 *  - all teams are hostile to every other team; a teammate is never damaged.
 */

import { createRng, type Rng } from '../rng.ts';
import {
  createWorld,
  isCellPassable,
  isSolidAt,
  type World,
  type WorldSpec,
} from '../world.ts';
import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  CELL_SIZE_METRES,
  MAX_TANKS_PER_TEAM,
  MAX_TEAMS,
  TANK_COLLISION_HEIGHT_METRES,
  TANK_MAX_HP,
  TANK_RADIUS_METRES,
  type MatchRules,
} from './constants.ts';
import { normaliseDegrees } from './geometry.ts';
import {
  createMatchStats,
  type DeathCause,
  type MatchOutcome,
  type MatchStats,
} from './stats.ts';

/** One authored tank slot. Angles default to a hull-forward, level gun. */
export interface TankSpawn {
  readonly xMetres: number;
  readonly zMetres: number;
  /** Hull yaw in degrees; default 0 (faces -z). */
  readonly hullYawDegrees?: number;
  /** Absolute turret yaw; default the hull yaw. */
  readonly turretYawDegrees?: number;
  /** Absolute pitch; default 0 (level). */
  readonly aimPitchDegrees?: number;
}

/** One team and the tanks it starts with. Team ids are 0…3. */
export interface TeamSpec {
  readonly id: number;
  readonly tanks: readonly TankSpawn[];
}

/** Everything `createMatch` needs. `rules` is required; defaults live in constants. */
export interface CreateMatchInput {
  readonly level: WorldSpec;
  readonly teams: readonly TeamSpec[];
  readonly seed: number;
  readonly rules: MatchRules;
}

/** A tank in the simulation. Mutable fields are advanced by `stepMatch`. */
export interface Tank {
  readonly id: number;
  readonly teamId: number;
  /** Position within its team, 0-based. */
  readonly teamIndex: number;
  x: number;
  z: number;
  hullYawDegrees: number;
  turretYawDegrees: number;
  aimPitchDegrees: number;
  hp: number;
  readonly maxHp: number;
  alive: boolean;
  reloadTicksRemaining: number;
  /** 0 for a healthy tank; otherwise ticks to the next clock damage. */
  bleedTicksRemaining: number;
  deathCause: DeathCause | null;
  diedAtTick: number | null;
  /** The team whose shell killed this tank; null for a clock death or a living tank. */
  killedByTeamId: number | null;
}

/** A shell in flight. Its owner may be dead; the shell keeps flying. */
export interface Shell {
  readonly id: number;
  readonly ownerTankId: number;
  readonly ownerTeamId: number;
  x: number;
  y: number;
  z: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  dz: number;
  travelledMetres: number;
}

/** A team in the live state. `tanks` is a stable creation-order view. */
export interface MatchTeam {
  readonly id: number;
  readonly tanks: readonly Tank[];
}

export type MatchStatus = 'active' | 'ended';

/** The whole simulation state. Mutated by `stepMatch`; hash it with `hashMatch`. */
export interface MatchState {
  readonly seed: number;
  readonly rules: MatchRules;
  readonly world: World;
  readonly rng: Rng;
  readonly teams: readonly MatchTeam[];
  readonly tanks: Tank[];
  readonly shells: Shell[];
  tick: number;
  nextShellId: number;
  status: MatchStatus;
  outcome: MatchOutcome | null;
  winnerTeamId: number | null;
  readonly stats: MatchStats;
}

/**
 * Builds a match from a level and teams, validating every authoring boundary loudly.
 * A match needs 2…4 teams (a one-team field is not a battle) of 1…4 tanks.
 */
export function createMatch(input: CreateMatchInput): MatchState {
  if (input === null || typeof input !== 'object') {
    throw new Error(`sim.createMatch: input must be an object, got ${String(input)}`);
  }
  validateRules(input.rules);
  const world = createWorld(input.level);

  const teamSpecs = input.teams as readonly TeamSpec[];
  if (!Array.isArray(teamSpecs) || teamSpecs.length < 2) {
    throw new Error(
      `sim.createMatch: a match needs at least 2 teams, got ${Array.isArray(teamSpecs) ? teamSpecs.length : String(teamSpecs)}`,
    );
  }
  if (teamSpecs.length > MAX_TEAMS) {
    throw new Error(`sim.createMatch: at most ${MAX_TEAMS} teams, got ${teamSpecs.length}`);
  }

  const rng = createRng(input.seed);
  const teams: MatchTeam[] = [];
  const tanks: Tank[] = [];
  const teamIds = new Set<number>();

  for (const teamSpec of teamSpecs) {
    if (!Number.isInteger(teamSpec.id) || teamSpec.id < 0 || teamSpec.id >= MAX_TEAMS) {
      throw new Error(`sim.createMatch: team id must be an integer in 0…${MAX_TEAMS - 1}, got ${teamSpec.id}`);
    }
    if (teamIds.has(teamSpec.id)) {
      throw new Error(`sim.createMatch: team id ${teamSpec.id} appears twice`);
    }
    teamIds.add(teamSpec.id);

    const tankSpecs = teamSpec.tanks as readonly TankSpawn[];
    if (!Array.isArray(tankSpecs) || tankSpecs.length < 1) {
      throw new Error(`sim.createMatch: team ${teamSpec.id} needs at least one tank`);
    }
    if (tankSpecs.length > MAX_TANKS_PER_TEAM) {
      throw new Error(
        `sim.createMatch: team ${teamSpec.id} has ${tankSpecs.length} tanks, at most ${MAX_TANKS_PER_TEAM}`,
      );
    }

    const teamTanks: Tank[] = [];
    tankSpecs.forEach((spawn: TankSpawn, teamIndex: number) => {
      const hullYawDegrees = normaliseDegrees(spawn.hullYawDegrees ?? 0);
      const turretYawDegrees = normaliseDegrees(spawn.turretYawDegrees ?? hullYawDegrees);
      const aimPitchDegrees = spawn.aimPitchDegrees ?? 0;
      if (!Number.isFinite(hullYawDegrees) || !Number.isFinite(spawn.hullYawDegrees ?? 0)) {
        throw new Error(`sim.createMatch: tank ${teamSpec.id}/${teamIndex} has a non-finite hull yaw`);
      }
      if (!Number.isFinite(spawn.turretYawDegrees ?? turretYawDegrees)) {
        throw new Error(`sim.createMatch: tank ${teamSpec.id}/${teamIndex} has a non-finite turret yaw`);
      }
      if (!Number.isFinite(aimPitchDegrees) || aimPitchDegrees < AIM_PITCH_MIN_DEGREES || aimPitchDegrees > AIM_PITCH_MAX_DEGREES) {
        throw new Error(
          `sim.createMatch: tank ${teamSpec.id}/${teamIndex} aimPitch must be within ${AIM_PITCH_MIN_DEGREES}…${AIM_PITCH_MAX_DEGREES}, got ${aimPitchDegrees}`,
        );
      }
      if (!Number.isFinite(spawn.xMetres) || !Number.isFinite(spawn.zMetres)) {
        throw new Error(`sim.createMatch: tank ${teamSpec.id}/${teamIndex} has a non-finite spawn position`);
      }
      if (!isTankPositionFree(world, spawn.xMetres, spawn.zMetres)) {
        throw new Error(
          `sim.createMatch: tank ${teamSpec.id}/${teamIndex} spawn (${spawn.xMetres}, ${spawn.zMetres}) is blocked or outside the arena`,
        );
      }
      assertTankSpawnDoesNotOverlap(tanks, spawn, teamSpec.id, teamIndex);

      const tank: Tank = {
        id: tanks.length,
        teamId: teamSpec.id,
        teamIndex,
        x: spawn.xMetres,
        z: spawn.zMetres,
        hullYawDegrees,
        turretYawDegrees,
        aimPitchDegrees,
        hp: TANK_MAX_HP,
        maxHp: TANK_MAX_HP,
        alive: true,
        reloadTicksRemaining: 0,
        bleedTicksRemaining: 0,
        deathCause: null,
        diedAtTick: null,
        killedByTeamId: null,
      };
      tanks.push(tank);
      teamTanks.push(tank);
    });
    teams.push({ id: teamSpec.id, tanks: teamTanks });
  }

  return {
    seed: input.seed,
    rules: input.rules,
    world,
    rng,
    teams,
    tanks,
    shells: [],
    tick: 0,
    nextShellId: 0,
    status: 'active',
    outcome: null,
    winnerTeamId: null,
    stats: createMatchStats(),
  };
}

/**
 * Is the tank's circular footprint free at `(x, z)`? A tank is blocked by a wall,
 * pillar or big block (the A1 `isCellPassable` answer for ground units) and by any
 * material at hull height (`isSolidAt`), never by a floor hole. The circle is tested
 * against each cell's AABB, so a tank cannot clip a wall corner.
 */
export function isTankPositionFree(world: World, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error(`sim: tank position must be finite, got (${x}, ${z})`);
  }
  const radius = TANK_RADIUS_METRES;
  const width = world.columns * CELL_SIZE_METRES;
  const height = world.rows * CELL_SIZE_METRES;
  if (x - radius < 0 || x + radius > width || z - radius < 0 || z + radius > height) {
    return false;
  }

  const minCellX = Math.max(0, Math.floor((x - radius) / CELL_SIZE_METRES));
  const maxCellX = Math.min(world.columns - 1, Math.floor((x + radius) / CELL_SIZE_METRES));
  const minCellZ = Math.max(0, Math.floor((z - radius) / CELL_SIZE_METRES));
  const maxCellZ = Math.min(world.rows - 1, Math.floor((z + radius) / CELL_SIZE_METRES));

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const blocked =
        !isCellPassable(world, cellX, cellZ) ||
        isSolidAt(world, cellX, cellZ, TANK_COLLISION_HEIGHT_METRES);
      if (!blocked) {
        continue;
      }
      const nearX = clampNumber(x, cellX * CELL_SIZE_METRES, (cellX + 1) * CELL_SIZE_METRES);
      const nearZ = clampNumber(z, cellZ * CELL_SIZE_METRES, (cellZ + 1) * CELL_SIZE_METRES);
      const dx = x - nearX;
      const dz = z - nearZ;
      if (dx * dx + dz * dz < radius * radius) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Rejects a spawn that shares a cell with, or whose circular body overlaps, an already
 * created tank. This is authoring validation, not a nudge: a level with two tanks on
 * one another is a broken level. A same-cell pair is rejected even when two corners of
 * that 2 m cell would leave the circles just clear.
 */
function assertTankSpawnDoesNotOverlap(
  tanks: readonly Tank[],
  spawn: TankSpawn,
  teamId: number,
  teamIndex: number,
): void {
  const cellX = Math.floor(spawn.xMetres / CELL_SIZE_METRES);
  const cellZ = Math.floor(spawn.zMetres / CELL_SIZE_METRES);
  const minimumDistance = TANK_RADIUS_METRES * 2;
  for (const tank of tanks) {
    const otherCellX = Math.floor(tank.x / CELL_SIZE_METRES);
    const otherCellZ = Math.floor(tank.z / CELL_SIZE_METRES);
    if (cellX === otherCellX && cellZ === otherCellZ) {
      throw new Error(
        `sim.createMatch: tank ${teamId}/${teamIndex} spawn (${spawn.xMetres}, ${spawn.zMetres}) shares cell (${cellX}, ${cellZ}) with tank ${tank.id}; spawn overlap is rejected`,
      );
    }
    const dx = spawn.xMetres - tank.x;
    const dz = spawn.zMetres - tank.z;
    if (dx * dx + dz * dz < minimumDistance * minimumDistance) {
      throw new Error(
        `sim.createMatch: tank ${teamId}/${teamIndex} spawn (${spawn.xMetres}, ${spawn.zMetres}) overlaps tank ${tank.id} at (${tank.x}, ${tank.z}); bodies need at least ${minimumDistance} m centre separation`,
      );
    }
  }
}

function validateRules(rules: MatchRules): void {
  if (rules === null || typeof rules !== 'object') {
    throw new Error(`sim.createMatch: rules must be an object, got ${String(rules)}`);
  }
  if (!Number.isInteger(rules.tickCap) || rules.tickCap < 1) {
    throw new Error(`sim.createMatch: tickCap must be a positive integer, got ${rules.tickCap}`);
  }
  if (!Number.isInteger(rules.bleedIntervalTicks) || rules.bleedIntervalTicks < 1) {
    throw new Error(
      `sim.createMatch: bleedIntervalTicks must be a positive integer, got ${rules.bleedIntervalTicks}`,
    );
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
