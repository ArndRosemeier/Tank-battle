/**
 * The first AI pilot: one "vanguard" profile over the shared perception/navigation
 * seams. It decides at 10 Hz and the command is HELD between decisions, so the
 * simulation sees a stable intent rather than a twitch every tick.
 *
 * Vanguard still has the three B1a goals: gain a sightline, approach a preferred range
 * and fire inside a clear cone. B1b adds continuous strafing in contact, a lateral dodge
 * after firing or taking a hit, and a seeded range-scaled aim error so the duel is not a
 * five-second stationary trade. It does not seek cover, flank or breach; that is B1c's
 * job.
 */

import { createRng, type Rng } from '../rng.ts';
import {
  AIM_PITCH_MAX_DEGREES,
  AIM_PITCH_MIN_DEGREES,
  MUZZLE_HEIGHT_METRES,
  RELOAD_TICKS,
  TANK_TURN_RATE_DEGREES_PER_SECOND,
  clamp,
  forwardFromYaw,
  isTankPositionFree,
  normaliseDegrees,
  shortestAngleDelta,
  type Controller,
  type MatchState,
  type Tank,
  type TankCommand,
} from '../sim.ts';
import { CELL_SIZE_METRES, cellAt, isSolidAt } from '../world.ts';
import {
  AI_DECISION_INTERVAL_TICKS,
  AI_DODGE_TICKS,
  AI_TARGET_CENTRE_HEIGHT_METRES,
  AI_WAYPOINT_REACHED_METRES,
} from './constants.ts';
import { PerceptionMemory, hasLineOfSight, hasShotLine, targetCentre } from './perception.ts';
import { NavigationCache, findPath, reachablePointNear, type GridPoint } from './navigation.ts';
import {
  frameForPose,
  frameToWorld,
  worldToFrame,
  type SpatialFrame,
} from './spatial.ts';
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
  /** Multiplies the seeded aim spread; tests use 0 for an exact aim. Default 1. */
  readonly aimErrorScale?: number;
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
  readonly aimErrorScale: number;
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
  private frame: SpatialFrame | null = null;
  private lastDecisionPosition: { x: number; z: number } | null = null;
  private lastDecisionThrottle = 0;
  private stuckDecisions = 0;
  private forcePath = false;
  private dodgeUntilTick = -1;
  private dodgeSign: 1 | -1 = 1;
  private lastHp: number | null = null;
  private strafeSign: 1 | -1 = 1;
  private nextStrafeFlip = 0;
  private movementGoal: { x: number; z: number } | null = null;
  private ambushSpot: { x: number; z: number } | null = null;
  private ambushUntilTick = 0;
  private breachedCell: { x: number; z: number } | null = null;
  private bruteBreachDone = false;

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
    this.aimErrorScale = options.aimErrorScale ?? 1;
    if (!Number.isFinite(this.aimErrorScale) || this.aimErrorScale < 0) {
      throw new Error(`AIController: aimErrorScale must be finite and >= 0, got ${String(this.aimErrorScale)}`);
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
      const decision = this.decide(state, tank);
      this.command = { ...decision, fire: false };
      this.lastDecisionTick = state.tick;
      this.decisionCount += 1;
      return decision;
    }
    return this.command;
  }

  private decide(state: MatchState, tank: Tank): TankCommand {
    if (!this.frame) {
      this.frame = frameForPose(state.world, tank.x, tank.z, tank.hullYawDegrees);
      this.navigation.setFrame(this.frame);
    }
    if (
      this.lastDecisionPosition !== null &&
      this.lastDecisionThrottle > 0 &&
      Math.hypot(tank.x - this.lastDecisionPosition.x, tank.z - this.lastDecisionPosition.z) < 0.05
    ) {
      this.stuckDecisions += 1;
    } else {
      this.stuckDecisions = 0;
    }
    this.forcePath = this.stuckDecisions >= 2 && this.path !== null;
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
    const shotClear = target && target.visible && target.tank
      ? hasShotLine(state.world, tank, target.tank)
      : false;
    // A seeded stand-off jitter keeps identical arena geometry from producing an
    // exact clone army across seeds, while every draw is reproducible.
    const standoffJitter = (this.rng.next() - 0.5) * 0.4;
    const incoming = this.incomingShell(state, tank);
    const hpDropped = this.lastHp !== null && tank.hp < this.lastHp;
    if (incoming || hpDropped) {
      this.startDodge(state.tick);
    }

    const mode = this.mode();
    if (this.breachedCell && mode === 'brute') {
      const cell = cellAt(state.world, this.breachedCell.x, this.breachedCell.z);
      if (cell.material === 'floor' || cell.hp === 0) {
        this.bruteBreachDone = true;
        this.breachedCell = null;
      }
    }
    if (
      mode === 'brute' &&
      target &&
      target.visible &&
      target.tank &&
      !this.breachedCell &&
      (!this.bruteBreachDone || !shotClear)
    ) {
      this.breachedCell =
        this.blockingCell(state, tank, target.tank) ??
        (this.bruteBreachDone ? null : this.coverCell(state, tank));
    }
    const breachPoint = this.breachedCell
      ? {
          x: (this.breachedCell.x + 0.5) * CELL_SIZE_METRES,
          z: (this.breachedCell.z + 0.5) * CELL_SIZE_METRES,
        }
      : null;
    const aimPoint = breachPoint ?? (target ? { x: target.x, z: target.z } : null);
    const aim = aimPoint
      ? aimAt(state, tank, aimPoint.x, aimPoint.z, breachPoint ? state.world.floorSurfaceHeightMetres + 0.6 : undefined)
      : { yaw: tank.turretYawDegrees, pitch: tank.aimPitchDegrees };
    if (aimPoint) {
      const aimDistance = Math.hypot(aimPoint.x - tank.x, aimPoint.z - tank.z);
      // A deliberate breach shot is aimed at a stationary wall cell, so it uses the
      // tight end of the profile's spread instead of the moving-target value.
      const spread = breachPoint
        ? Math.min(
            1,
            (this.profile.aimErrorBaseDegrees * 0.08 +
              aimDistance * this.profile.aimErrorPerMetre * 0.03) *
              this.aimErrorScale,
          )
        : (this.profile.aimErrorBaseDegrees + aimDistance * this.profile.aimErrorPerMetre) *
          this.aimErrorScale;
      const yawError = (this.rng.next() * 2 - 1) * spread;
      aim.yaw = normaliseDegrees(aim.yaw + yawError);
      // A smaller pitch error keeps shots in the tank's vertical body while still
      // making range and movement matter.
      aim.pitch = clamp(aim.pitch + (this.rng.next() * 2 - 1) * spread * 0.35, AIM_PITCH_MIN_DEGREES, AIM_PITCH_MAX_DEGREES);
    }
    const yawError = Math.abs(shortestAngleDelta(tank.turretYawDegrees, aim.yaw));
    const pitchError = Math.abs(tank.aimPitchDegrees - aim.pitch);
    const fire =
      Boolean(target && target.visible) &&
      (shotClear || this.breachedCell !== null) &&
      this.profile.weights['fire-in-cone'] > 0 &&
      tank.reloadTicksRemaining === 0 &&
      yawError <= this.profile.fireConeDegrees &&
      pitchError <= this.profile.fireConeDegrees;
    if (fire) {
      // Keep the trigger-to-trigger cadence in the dodge timing: the AI sidesteps
      // between shots under the SAME global reload a human uses.
      this.startDodge(state.tick, RELOAD_TICKS - AI_DECISION_INTERVAL_TICKS);
    }

    if (target && target.visible && state.tick >= this.nextStrafeFlip) {
      this.strafeSign = this.rng.int(2) === 0 ? -1 : 1;
      this.nextStrafeFlip = state.tick + 36;
    }
    const wounded =
      this.profile.weights['wounded-retreat'] > 0 && tank.hp < tank.maxHp;
    const dodging = state.tick < this.dodgeUntilTick;
    let goal: { x: number; z: number } | null = null;

    if (wounded && target) {
      goal = this.retreatPoint(state, tank, targetPoint);
    } else if (mode === 'ambusher' && target) {
      // A profile with hold-cover disabled never settles into the ambush pocket.
      if (!this.ambushSpot && this.profile.weights['hold-cover'] > 0.5) {
        this.ambushSpot = this.hiddenPoint(state, tank, targetPoint);
        this.ambushUntilTick = state.tick + this.profile.ambushHoldTicks;
      }
      const holding = this.ambushSpot !== null && state.tick < this.ambushUntilTick;
      if (holding) {
        const atSpot = Math.hypot(tank.x - this.ambushSpot!.x, tank.z - this.ambushSpot!.z) < 1.2;
        goal = atSpot ? null : this.ambushSpot;
      } else {
        goal = targetPoint;
      }
      if (fire) {
        // Firing from ambush exposes the position: relocate after the shot.
        this.ambushSpot = null;
        this.ambushUntilTick = state.tick + this.profile.ambushHoldTicks;
      }
    } else if (mode === 'sniper' && target) {
      if (target.visible && distance < this.profile.minRangeMetres) {
        goal = this.retreatPoint(state, tank, targetPoint);
      } else if (!target.visible) {
        goal = targetPoint;
      } else if (!shotClear) {
        goal = targetPoint;
      } else if (this.profile.weights['hold-cover'] > 0.5) {
        // Holding cover is the default sniper goal, but it is a weighted choice.
        goal = null;
      } else {
        goal = this.profile.weights['flank'] > 0
          ? this.strafePoint(state, tank, targetPoint)
          : targetPoint;
      }
    } else if (mode === 'brute') {
      // The brute closes and lets the breach shot open the route; once the breach is
      // done it brawls like the vanguard instead of walking straight down the muzzle.
      const brawling =
        target !== null &&
        target.visible &&
        shotClear &&
        this.bruteBreachDone &&
        !this.breachedCell &&
        this.profile.weights['flank'] > 0;
      goal = brawling && target ? this.strafePoint(state, tank, targetPoint) : target || dodging ? targetPoint : this.fallbackPoint(state, tank);
      if (this.breachedCell) goal = breachPoint ?? targetPoint;
      if (dodging && !this.breachedCell) goal = this.dodgePoint(state, tank, targetPoint);
    } else {
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
      const needsReposition = Boolean(target && target.visible && !shotClear);
      // `flank` is the gate for the lateral strafe; with it off the profile closes
      // directly instead of circling the target.
      goal =
        target && target.visible
          ? this.profile.weights['flank'] > 0
            ? this.strafePoint(state, tank, targetPoint)
            : targetPoint
          : dodging
            ? this.dodgePoint(state, tank, targetPoint)
            : wantsSight || wantsRemembered || needsReposition || wantsApproach
              ? targetPoint
              : null;
    }

    if (goal) {
      this.setPath(state, tank, goal);
    } else {
      this.path = null;
      this.pathIndex = 0;
      this.movementGoal = null;
    }

    const movement = this.steerAlongPath(tank);
    this.lastHp = tank.hp;
    this.lastDecisionPosition = { x: tank.x, z: tank.z };
    this.lastDecisionThrottle = movement.throttle;
    this.forcePath = false;
    return {
      throttle: movement.throttle,
      steer: movement.steer,
      aimYaw: aim.yaw,
      aimPitch: clamp(aim.pitch, AIM_PITCH_MIN_DEGREES, AIM_PITCH_MAX_DEGREES),
      fire,
    };
  }

  private startDodge(tick: number, durationTicks = AI_DODGE_TICKS): void {
    if (tick >= this.dodgeUntilTick) {
      this.dodgeSign = this.rng.int(2) === 0 ? -1 : 1;
    }
    this.dodgeUntilTick = Math.max(this.dodgeUntilTick, tick + durationTicks);
  }

  private strafePoint(state: MatchState, tank: Tank, target: { x: number; z: number }): { x: number; z: number } {
    const angle = Math.atan2(tank.z - target.z, tank.x - target.x) + 0.9 * this.strafeSign;
    const radius = Math.max(6, Math.min(14, this.profile.preferredRangeMetres));
    const width = state.world.columns * CELL_SIZE_METRES;
    const height = state.world.rows * CELL_SIZE_METRES;
    return {
      x: clamp(target.x + Math.cos(angle) * radius, CELL_SIZE_METRES * 1.5, width - CELL_SIZE_METRES * 1.5),
      z: clamp(target.z + Math.sin(angle) * radius, CELL_SIZE_METRES * 1.5, height - CELL_SIZE_METRES * 1.5),
    };
  }

  private dodgePoint(state: MatchState, tank: Tank, reference: { x: number; z: number }): { x: number; z: number } {
    const direction = yawTo(tank.x, tank.z, reference.x, reference.z) + 90 * this.dodgeSign;
    const forward = forwardFromYaw(direction);
    const width = state.world.columns * CELL_SIZE_METRES;
    const height = state.world.rows * CELL_SIZE_METRES;
    return {
      x: clamp(tank.x + forward.x * 9, CELL_SIZE_METRES * 1.5, width - CELL_SIZE_METRES * 1.5),
      z: clamp(tank.z + forward.z * 9, CELL_SIZE_METRES * 1.5, height - CELL_SIZE_METRES * 1.5),
    };
  }

  private incomingShell(state: MatchState, tank: Tank): boolean {
    for (const shell of state.shells) {
      if (shell.ownerTeamId === tank.teamId) continue;
      const dx = tank.x - shell.x;
      const dz = tank.z - shell.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 25 || distance < 0.5) continue;
      if (dx * shell.dx + dz * shell.dz <= 0) continue;
      const lateral = Math.abs(dx * shell.dz - dz * shell.dx);
      if (lateral <= 2.5) return true;
    }
    return false;
  }

  private mode(): 'vanguard' | 'sniper' | 'ambusher' | 'brute' {
    if (this.profile.weights['ambush-chokepoint'] > 0.5) return 'ambusher';
    if (this.profile.weights['breach-wall'] > 0.5) return 'brute';
    if (this.profile.minRangeMetres > 0) return 'sniper';
    return 'vanguard';
  }

  private retreatPoint(state: MatchState, tank: Tank, target: { x: number; z: number }): { x: number; z: number } {
    const direction = yawTo(tank.x, tank.z, target.x, target.z) + 180;
    const forward = forwardFromYaw(direction);
    const width = state.world.columns * CELL_SIZE_METRES;
    const height = state.world.rows * CELL_SIZE_METRES;
    return {
      x: clamp(tank.x + forward.x * 12, CELL_SIZE_METRES * 1.5, width - CELL_SIZE_METRES * 1.5),
      z: clamp(tank.z + forward.z * 12, CELL_SIZE_METRES * 1.5, height - CELL_SIZE_METRES * 1.5),
    };
  }

  private hiddenPoint(state: MatchState, tank: Tank, target: { x: number; z: number }): { x: number; z: number } | null {
    const candidates: { x: number; z: number; distance: number }[] = [];
    const eye = {
      x: target.x,
      y: state.world.floorSurfaceHeightMetres + 1.6,
      z: target.z,
    };
    for (let z = 1; z < state.world.rows - 1; z += 1) {
      for (let x = 1; x < state.world.columns - 1; x += 1) {
        const wx = (x + 0.5) * CELL_SIZE_METRES;
        const wz = (z + 0.5) * CELL_SIZE_METRES;
        const distance = Math.hypot(wx - tank.x, wz - tank.z);
        if (distance > 28) continue;
        if (!isTankPositionFree(state.world, wx, wz)) continue;
        if (hasLineOfSight(state.world, eye, { x: wx, y: state.world.floorSurfaceHeightMetres + 1, z: wz })) continue;
        candidates.push({ x: wx, z: wz, distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
    // A hidden cell is only useful if the tank can walk to it; sealed pockets behind
    // the rings look hidden but leave the ambusher exposed while it fails to arrive.
    for (const candidate of candidates.slice(0, 12)) {
      if (findPath(state.world, tank.x, tank.z, candidate.x, candidate.z, this.frame ?? undefined) !== null) {
        return { x: candidate.x, z: candidate.z };
      }
    }
    return null;
  }

  private coverCell(state: MatchState, tank: Tank): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDistance = Infinity;
    for (let z = 1; z < state.world.rows - 1; z += 1) {
      for (let x = 1; x < state.world.columns - 1; x += 1) {
        const cell = cellAt(state.world, x, z);
        if (cell.material === 'floor') continue;
        const wx = (x + 0.5) * CELL_SIZE_METRES;
        const wz = (z + 0.5) * CELL_SIZE_METRES;
        const distance = Math.hypot(wx - tank.x, wz - tank.z);
        if (distance > this.profile.breachRangeMetres || distance < 3) continue;
        if (distance < bestDistance) {
          best = { x, z };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  private blockingCell(state: MatchState, tank: Tank, target: Tank): { x: number; z: number } | null {
    const from = {
      x: tank.x,
      y: state.world.floorSurfaceHeightMetres + MUZZLE_HEIGHT_METRES,
      z: tank.z,
    };
    const to = targetCentre(state.world, target);
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.ceil(distance / 0.25);
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      const cx = Math.floor(x / CELL_SIZE_METRES);
      const cz = Math.floor(z / CELL_SIZE_METRES);
      if (cx < 0 || cz < 0 || cx >= state.world.columns || cz >= state.world.rows) return null;
      if (isSolidAt(state.world, cx, cz, y)) return { x: cx, z: cz };
      if (Math.hypot(to.x - x, to.z - z) > this.profile.breachRangeMetres) return null;
    }
    return null;
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
    const canonicalCentre = worldToFrame(state.world, this.frame!, centreX, centreZ);
    const canonicalGoal = {
      x: canonicalCentre.x + jitterX,
      z: canonicalCentre.z + jitterZ,
    };
    const worldGoal = frameToWorld(state.world, this.frame!, canonicalGoal.x, canonicalGoal.z);
    return (
      reachablePointNear(
        state.world,
        tank.x,
        tank.z,
        worldGoal.x,
        worldGoal.z,
        this.frame!,
      ) ?? { x: centreX, z: centreZ }
    );
  }

  private setPath(state: MatchState, tank: Tank, goal: { x: number; z: number }): void {
    this.movementGoal = goal;
    const next = this.navigation.findPath(state.world, tank.x, tank.z, goal.x, goal.z, this.forcePath);
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
      if (!this.movementGoal) {
        return { throttle: 0, steer: 0 };
      }
      const dx = this.movementGoal.x - tank.x;
      const dz = this.movementGoal.z - tank.z;
      if (Math.hypot(dx, dz) < AI_WAYPOINT_REACHED_METRES) {
        return { throttle: 0, steer: 0 };
      }
      return this.steerToward(tank, this.movementGoal.x, this.movementGoal.z);
    }
    const waypoint = this.path[this.pathIndex]!;
    return this.steerToward(
      tank,
      (waypoint.x + 0.5) * CELL_SIZE_METRES,
      (waypoint.z + 0.5) * CELL_SIZE_METRES,
    );
  }

  private steerToward(tank: Tank, x: number, z: number): { throttle: number; steer: number } {
    const desiredYaw = yawTo(tank.x, tank.z, x, z);
    const yawError = shortestAngleDelta(tank.hullYawDegrees, desiredYaw);
    const steer = clamp(yawError / (TANK_TURN_RATE_DEGREES_PER_SECOND / 10), -1, 1);
    const throttle = Math.abs(yawError) <= 45 ? 0.85 : 0.35;
    return { throttle, steer };
  }
}

function aimAt(state: MatchState, tank: Tank, x: number, z: number, targetYOverride?: number): { yaw: number; pitch: number } {
  const angle = yawTo(tank.x, tank.z, x, z);
  const horizontal = Math.hypot(x - tank.x, z - tank.z);
  const muzzleY = state.world.floorSurfaceHeightMetres + MUZZLE_HEIGHT_METRES;
  const targetY = targetYOverride ?? state.world.floorSurfaceHeightMetres + AI_TARGET_CENTRE_HEIGHT_METRES;
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
