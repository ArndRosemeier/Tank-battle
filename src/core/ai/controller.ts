/**
 * The first AI pilot: one "vanguard" profile over the shared perception/navigation
 * seams. It decides at 10 Hz and the command is HELD between decisions, so the
 * simulation sees a stable intent rather than a twitch every tick.
 *
 * Vanguard does exactly three things: gains a sightline (patrol the centre / follow
 * the last seen position), approaches while the target is beyond its preferred range,
 * and fires only when the target is inside its aim cone with a clear sightline. It does
 * not seek cover, flank or breach; those are B1b's job.
 */

import { createRng, type Rng } from '../rng.ts';
import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  MUZZLE_HEIGHT_METRES,
  TANK_TURN_RATE_DEGREES_PER_SECOND,
  clamp,
  normaliseDegrees,
  shortestAngleDelta,
  type Controller,
  type MatchState,
  type Tank,
  type TankCommand,
} from '../sim.ts';
import { CELL_SIZE_METRES } from '../world.ts';
import {
  AI_DECISION_INTERVAL_TICKS,
  AI_TARGET_CENTRE_HEIGHT_METRES,
  AI_WAYPOINT_REACHED_METRES,
} from './constants.ts';
import { PerceptionMemory } from './perception.ts';
import { NavigationCache, reachablePointNear, type GridPoint } from './navigation.ts';
import {
  VANGUARD_PROFILE,
  validateAIProfile,
  type AIProfile,
} from './profile.ts';

export interface AIControllerOptions {
  /** The tank this controller owns. One controller instance owns one tank. */
  readonly tankId: number;
  /** The validated profile; defaults to vanguard. */
  readonly profile?: AIProfile;
  /** Seed for tie-breaks and small decision jitter. Same seed reproduces every decision. */
  readonly seed: number;
  /** Decision cadence; defaults to 6 ticks (10 Hz). */
  readonly decisionIntervalTicks?: number;
  /** Seeded reaction offset within the cadence; defaults to 0 (decide on tick 0). */
  readonly decisionPhaseTicks?: number;
}

export interface AIControllerDebug {
  readonly decisionCount: number;
  readonly lastDecisionTick: number | null;
  readonly targetTankId: number | null;
  readonly visibleTankIds: readonly number[];
  readonly path: readonly GridPoint[] | null;
  readonly pathIndex: number;
  readonly pathRevision: number;
  readonly pathGoalKey: string;
}

interface TargetChoice {
  readonly tank: Tank | null;
  readonly x: number;
  readonly z: number;
  readonly visible: boolean;
}

export class AIController implements Controller {
  readonly tankId: number;
  readonly profile: AIProfile;
  readonly decisionIntervalTicks: number;
  readonly decisionPhaseTicks: number;
  readonly memory: PerceptionMemory;

  private readonly rng: Rng;
  private readonly navigation = new NavigationCache();
  private command: TankCommand;
  private lastDecisionTick: number | null = null;
  private lastSeenTick: number | null = null;
  private decisionCount = 0;
  private path: readonly GridPoint[] | null = null;
  private pathIndex = 0;
  private targetTankId: number | null = null;
  private visibleTankIds: readonly number[] = [];

  constructor(options: AIControllerOptions) {
    if (!Number.isInteger(options.tankId) || options.tankId < 0) {
      throw new Error(`AIController: tankId must be a non-negative integer, got ${String(options.tankId)}`);
    }
    this.tankId = options.tankId;
    this.profile = validateAIProfile(options.profile ?? VANGUARD_PROFILE);
    this.decisionIntervalTicks = options.decisionIntervalTicks ?? AI_DECISION_INTERVAL_TICKS;
    if (!Number.isInteger(this.decisionIntervalTicks) || this.decisionIntervalTicks < 1) {
      throw new Error(
        `AIController: decisionIntervalTicks must be a positive integer, got ${String(this.decisionIntervalTicks)}`,
      );
    }
    this.decisionPhaseTicks = options.decisionPhaseTicks ?? 0;
    if (!Number.isInteger(this.decisionPhaseTicks) || this.decisionPhaseTicks < 0 || this.decisionPhaseTicks >= this.decisionIntervalTicks) {
      throw new Error(
        `AIController: decisionPhaseTicks must be an integer 0…${this.decisionIntervalTicks - 1}, got ${String(this.decisionPhaseTicks)}`,
      );
    }
    this.rng = createRng(options.seed);
    this.memory = new PerceptionMemory(this.profile.memoryTicks);
    this.command = {
      throttle: 0,
      steer: 0,
      aimYaw: 0,
      aimPitch: 0,
      fire: false,
    };
  }

  get debug(): AIControllerDebug {
    return {
      decisionCount: this.decisionCount,
      lastDecisionTick: this.lastDecisionTick,
      targetTankId: this.targetTankId,
      visibleTankIds: this.visibleTankIds,
      path: this.path,
      pathIndex: this.pathIndex,
      pathRevision: this.navigation.pathRevision,
      pathGoalKey: this.navigation.goalKey,
    };
  }

  /**
   * Returns the held command. A decision is made on the first call and then every
   * `decisionIntervalTicks` simulation ticks; calls in between return the SAME object
   * and do not consult perception, navigation or the RNG.
   */
  commandFor(state: MatchState, tankId: number): TankCommand {
    if (tankId !== this.tankId) {
      throw new Error(`AIController(${this.tankId}): asked for tank ${tankId}`);
    }
    if (this.lastSeenTick !== null && state.tick < this.lastSeenTick) {
      throw new Error(
        `AIController(${this.tankId}): tick went backwards from ${this.lastSeenTick} to ${state.tick}`,
      );
    }
    this.lastSeenTick = state.tick;

    const tank = state.tanks.find((candidate) => candidate.id === this.tankId);
    if (!tank) {
      throw new Error(`AIController(${this.tankId}): tank is missing from the match`);
    }
    if (!tank.alive) {
      return this.command;
    }

    const due =
      this.lastDecisionTick === null
        ? state.tick >= this.decisionPhaseTicks &&
          (state.tick - this.decisionPhaseTicks) % this.decisionIntervalTicks === 0
        : state.tick - this.lastDecisionTick >= this.decisionIntervalTicks;
    if (due) {
      this.command = this.decide(state, tank);
      this.lastDecisionTick = state.tick;
      this.decisionCount += 1;
    }
    return this.command;
  }

  private decide(state: MatchState, tank: Tank): TankCommand {
    const visible = this.memory.update(state, tank);
    this.visibleTankIds = visible.map((candidate) => candidate.id);
    const target = this.chooseTarget(tank, visible);
    this.targetTankId = target?.tank?.id ?? null;

    const targetPoint = target
      ? { x: target.x, z: target.z }
      : this.fallbackPoint(state, tank);
    const distance = target
      ? Math.hypot(target.x - tank.x, target.z - tank.z)
      : Infinity;
    // A seeded stand-off jitter keeps identical arena geometry from producing an
    // exact clone army across seeds, while every draw is reproducible.
    const standoffJitter = (this.rng.next() - 0.5) * 0.4;
    const wantsApproach =
      target !== null &&
      target.visible &&
      distance > this.profile.preferredRangeMetres + standoffJitter &&
      this.profile.weights['approach-preferred-range'] > 0;
    const wantsSight =
      target === null &&
      this.profile.weights['gain-line-of-sight'] > 0;
    const wantsRemembered =
      target !== null &&
      !target.visible &&
      this.profile.weights['gain-line-of-sight'] > 0;
    const goal = wantsApproach || wantsSight || wantsRemembered ? targetPoint : null;

    if (goal) {
      this.setPath(state, tank, goal);
    } else {
      this.path = null;
      this.pathIndex = 0;
    }

    const aimPoint = target ? { x: target.x, z: target.z } : null;
    const aim = aimPoint
      ? aimAt(state, tank, aimPoint.x, aimPoint.z)
      : { yaw: tank.turretYawDegrees, pitch: tank.aimPitchDegrees };
    const canFire = Boolean(target && target.visible);
    const yawError = Math.abs(shortestAngleDelta(tank.turretYawDegrees, aim.yaw));
    const pitchError = Math.abs(tank.aimPitchDegrees - aim.pitch);
    const fire =
      canFire &&
      this.profile.weights['fire-in-cone'] > 0 &&
      tank.reloadTicksRemaining === 0 &&
      yawError <= this.profile.fireConeDegrees &&
      pitchError <= this.profile.fireConeDegrees;

    const movement = this.steerAlongPath(tank);
    return {
      throttle: movement.throttle,
      steer: movement.steer,
      aimYaw: aim.yaw,
      aimPitch: clamp(aim.pitch, AIM_PITCH_MIN_DEGREES, AIM_PITCH_MAX_DEGREES),
      fire,
    };
  }

  private chooseTarget(tank: Tank, visible: readonly Tank[]): TargetChoice | null {
    if (visible.length > 0) {
      const nearest = visible[0]!;
      let nearestDistance = squaredDistance(tank, nearest);
      const tied = visible.filter((candidate) => {
        const distance = squaredDistance(tank, candidate);
        return Math.abs(distance - nearestDistance) <= 1e-9;
      });
      // The seeded draw settles an exact distance tie only; single candidates never
      // consume RNG, so unrelated decisions cannot perturb a reproducible sequence.
      const chosen = tied.length > 1 ? tied[this.rng.int(tied.length)]! : tied[0]!;
      return { tank: chosen, x: chosen.x, z: chosen.z, visible: true };
    }
    const remembered = this.memory.latest();
    if (remembered) {
      return { tank: null, x: remembered.x, z: remembered.z, visible: false };
    }
    return null;
  }

  private fallbackPoint(state: MatchState, tank: Tank): { x: number; z: number } {
    const centreX = (state.world.columns * CELL_SIZE_METRES) / 2;
    const centreZ = (state.world.rows * CELL_SIZE_METRES) / 2;
    // Seeded patrol jitter, at most one cell: different seeds explore different
    // approaches to the centre instead of every match being the same rehearsal.
    const jitterX = (this.rng.next() - 0.5) * CELL_SIZE_METRES;
    const jitterZ = (this.rng.next() - 0.5) * CELL_SIZE_METRES;
    return (
      reachablePointNear(state.world, tank.x, tank.z, centreX + jitterX, centreZ + jitterZ) ?? {
        x: centreX,
        z: centreZ,
      }
    );
  }

  private setPath(state: MatchState, tank: Tank, goal: { x: number; z: number }): void {
    const next = this.navigation.findPath(state.world, tank.x, tank.z, goal.x, goal.z);
    if (next !== this.path) {
      this.path = next;
      this.pathIndex = 0;
    }
    if (this.path && this.path.length > 0) {
      if (this.pathIndex === 0 && this.path.length > 1) {
        this.pathIndex = 1;
      }
      while (
        this.pathIndex < this.path.length &&
        distanceTo(tank, this.path[this.pathIndex]!) <= AI_WAYPOINT_REACHED_METRES
      ) {
        this.pathIndex += 1;
      }
    }
  }

  private steerAlongPath(tank: Tank): { throttle: number; steer: number } {
    if (!this.path || this.pathIndex >= this.path.length) {
      return { throttle: 0, steer: 0 };
    }
    const waypoint = this.path[this.pathIndex]!;
    const waypointX = (waypoint.x + 0.5) * CELL_SIZE_METRES;
    const waypointZ = (waypoint.z + 0.5) * CELL_SIZE_METRES;
    const desiredYaw = yawTo(tank.x, tank.z, waypointX, waypointZ);
    const yawError = shortestAngleDelta(tank.hullYawDegrees, desiredYaw);
    const steer = clamp(yawError / (TANK_TURN_RATE_DEGREES_PER_SECOND / 10), -1, 1);
    const throttle = Math.abs(yawError) <= 45 ? 0.7 : 0;
    return { throttle, steer };
  }
}

function aimAt(state: MatchState, tank: Tank, x: number, z: number): { yaw: number; pitch: number } {
  const angle = yawTo(tank.x, tank.z, x, z);
  const horizontal = Math.hypot(x - tank.x, z - tank.z);
  const muzzleY = state.world.floorSurfaceHeightMetres + MUZZLE_HEIGHT_METRES;
  const targetY = state.world.floorSurfaceHeightMetres + AI_TARGET_CENTRE_HEIGHT_METRES;
  const pitch = horizontal < 1e-9 ? 0 : (Math.atan2(targetY - muzzleY, horizontal) * 180) / Math.PI;
  return { yaw: normaliseDegrees(angle), pitch };
}

/**
 * Yaw pointing from one point to another in the simulation convention: forward is
 * `(-sin yaw, -cos yaw)`, so yaw = atan2(-dx, -dz).
 */
function yawTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return normaliseDegrees((Math.atan2(-(toX - fromX), -(toZ - fromZ)) * 180) / Math.PI);
}

function squaredDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function distanceTo(a: { x: number; z: number }, b: GridPoint): number {
  return Math.hypot(a.x - (b.x + 0.5) * CELL_SIZE_METRES, a.z - (b.z + 0.5) * CELL_SIZE_METRES);
}
