/**
 * The match: teams of tanks on a destructible terrain, shells in flight, a seeded RNG and the
 * match clock. This module creates the state; `step.ts` advances it one deterministic
 * tick.
 *
 * What is deliberately absent: a renderer, a DOM, a wall clock, an input device, and
 * any `isPlayer` distinction. A tank's control is a `TankCommand` supplied by a
 * `Controller` (local human or AI; A3c wires the former, Slice B the latter).
 *
 * Conventions (all documented in `src/render` too, via `docs/ARCHITECTURE.md`):
 *  - positions are metres; `y` is up and a tank's `y` is its hull origin on the ground;
 *  - hull/turret yaw 0 faces -z, positive turns towards -x;
 *  - aim pitch is degrees above the horizon, negative aims down;
 *  - all teams are hostile to every other team; a teammate is never damaged.
 */

import { createRng, type Rng } from '../rng.ts';
import { createWorld, type World, type WorldSpec } from '../world.ts';
import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  MAX_TANKS_PER_TEAM,
  MAX_TEAMS,
  TANK_HEIGHT_METRES,
  TANK_MAX_HP,
  TANK_RADIUS_METRES,
  TANK_STEP_METRES,
  type MatchRules,
} from './constants.ts';
import { standingPoseAt } from './terrainBody.ts';
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
  /**
   * Optional height hint: the tank stands on the highest ground at or below this
   * height (a cave floor under a hill). Default: the highest ground in the column.
   */
  readonly yMetres?: number;
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
  /** Height of the hull origin (the ground it rests on, or mid-fall). */
  y: number;
  z: number;
  /** Vertical speed in m/s, negative while falling; 0 on the ground. */
  verticalSpeed: number;
  hullYawDegrees: number;
  /** The hull's tilt on the terrain: pitch nose-up positive, roll left-up positive. */
  hullPitchDegrees: number;
  hullRollDegrees: number;
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
  /** The team whose shell (or rockfall) killed this tank; null otherwise. */
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

export type PresentationEvent =
  | { readonly type: 'fire'; readonly tankId: number; readonly teamId: number; readonly x: number; readonly y: number; readonly z: number; readonly dx: number; readonly dy: number; readonly dz: number }
  | { readonly type: 'impact'; readonly teamId: number; readonly x: number; readonly y: number; readonly z: number }
  | { readonly type: 'hit'; readonly tankId: number; readonly teamId: number; readonly x: number; readonly y: number; readonly z: number }
  | {
      /** Terrain breaking up: a crater, dust, a chunk breaking off, landing or crushing. */
      readonly type: 'terrain';
      readonly kind: 'crater' | 'dust' | 'break' | 'land' | 'crush';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      /** Lattice samples involved (crater: samples destroyed). */
      readonly samples: number;
    }
  | {
      readonly type: 'death';
      readonly tankId: number;
      readonly teamId: number;
      readonly tick: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
      /** The killing shell's direction, when the death was a shell hit. */
      readonly dx?: number;
      readonly dy?: number;
      readonly dz?: number;
    };

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
  /** The team whose shell broke each falling chunk loose (crush kills are credited to it). */
  readonly chunkCauses: Map<number, number>;
  /** Optional presentation-only event capture, enabled by a live scene. */
  capturePresentationEvents?: boolean;
  presentationEvents?: PresentationEvent[];
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
      if (!Number.isFinite(spawn.xMetres) || !Number.isFinite(spawn.zMetres) || !Number.isFinite(spawn.yMetres ?? 0)) {
        throw new Error(`sim.createMatch: tank ${teamSpec.id}/${teamIndex} has a non-finite spawn position`);
      }
      const pose = spawnPose(world, spawn, hullYawDegrees);
      if (!pose) {
        throw new Error(
          `sim.createMatch: tank ${teamSpec.id}/${teamIndex} spawn (${spawn.xMetres}, ${spawn.zMetres}) is blocked or outside the arena`,
        );
      }
      assertTankSpawnDoesNotOverlap(tanks, spawn, pose.y, teamSpec.id, teamIndex);

      const tank: Tank = {
        id: tanks.length,
        teamId: teamSpec.id,
        teamIndex,
        x: spawn.xMetres,
        y: pose.y,
        z: spawn.zMetres,
        verticalSpeed: 0,
        hullYawDegrees,
        hullPitchDegrees: pose.pitchDegrees,
        hullRollDegrees: pose.rollDegrees,
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
    chunkCauses: new Map(),
    tick: 0,
    nextShellId: 0,
    status: 'active',
    outcome: null,
    winnerTeamId: null,
    stats: createMatchStats(),
  };
}

/**
 * Is a tank body free at `(x, z)` standing on the ground at or below `fromY`? The
 * footprint must be inside the arena and no rock may fill the body. Tank-vs-tank
 * contact is the step's business, not this query's.
 */
export function isTankPositionFree(world: World, x: number, z: number, fromY: number, yawDegrees = 0): boolean {
  return standingPoseAt(world, x, z, yawDegrees, fromY) !== null;
}

/** The pose a spawn stands in: on the highest ground (or below the hint), or null. */
function spawnPose(world: World, spawn: TankSpawn, yawDegrees: number) {
  const fromY = spawn.yMetres !== undefined ? spawn.yMetres + TANK_STEP_METRES : world.heightMetres + 1;
  return standingPoseAt(world, spawn.xMetres, spawn.zMetres, yawDegrees, fromY);
}

/**
 * Rejects a spawn whose body overlaps an already created tank. This is authoring
 * validation, not a nudge: a level with two tanks on one another is a broken level.
 */
function assertTankSpawnDoesNotOverlap(
  tanks: readonly Tank[],
  spawn: TankSpawn,
  y: number,
  teamId: number,
  teamIndex: number,
): void {
  const minimumDistance = TANK_RADIUS_METRES * 2;
  for (const tank of tanks) {
    if (Math.abs(tank.y - y) >= TANK_HEIGHT_METRES) continue;
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
