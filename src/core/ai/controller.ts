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
  RELOAD_TICKS,
  TANK_TURN_RATE_DEGREES_PER_SECOND,
  clamp,
  directionFromAim,
  forwardFromYaw,
  normaliseDegrees,
  shortestAngleDelta,
  type Controller,
  type MatchState,
  type Tank,
  type TankCommand,
  type Vec3,
} from '../sim.ts';
import { hasClearLine, isSolidAt, raycastTerrain, type World } from '../world.ts';
import {
  AI_PATH_LOOKAHEAD_METRES,
  AI_PATROL_ARRIVED_METRES,
  AI_PATROL_LEG_TICKS,
  AI_PATROL_MIN_METRES,
  AI_DECISION_INTERVAL_TICKS,
  AI_DODGE_TICKS,
  AI_EYE_HEIGHT_METRES,
  AI_WAYPOINT_REACHED_METRES,
} from './constants.ts';
import { PerceptionMemory, gunPosition, hasLineOfSight, hasShotLine, targetCentre } from './perception.ts';
import {
  NavigationCache,
  findNodePath,
  navGraphFor,
  nodeNear,
  reachableFrom,
  type NavPoint,
} from './navigation.ts';
import {
  VANGUARD_PROFILE,
  validateAIProfile,
  type AIProfile,
} from './profile.ts';
import * as detMath from '../detMath.ts';

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
  readonly path: readonly NavPoint[] | null;
  readonly pathIndex: number;
  readonly pathRevision: number;
  readonly pathGoalKey: string;
}

interface TargetChoice {
  readonly tank: Tank | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visible: boolean;
}

/** Keep movement goals this far inside the arena edge (the rim is unclimbable). */
const GOAL_MARGIN_METRES = 6;

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
  private path: readonly NavPoint[] | null = null;
  private pathIndex = 0;
  private targetTankId: number | null = null;
  private visibleTankIds: readonly number[] = [];
  private lastDecisionPosition: { x: number; z: number } | null = null;
  private lastDecisionThrottle = 0;
  private stuckDecisions = 0;
  private forcePath = false;
  private dodgeUntilTick = -1;
  private dodgeSign: 1 | -1 = 1;
  private lastHp: number | null = null;
  private strafeSign: 1 | -1 = 1;
  private nextStrafeFlip = 0;
  private movementGoal: NavPoint | null = null;
  private ambushSpot: NavPoint | null = null;
  private patrolPoint: NavPoint | null = null;
  private patrolUntilTick = 0;
  private home: { x: number; z: number } | null = null;
  private ambushUntilTick = 0;
  /** A point just inside the rock the brute is shooting a way through. */
  private breachPoint: Vec3 | null = null;
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
    if (
      this.lastDecisionPosition !== null &&
      this.lastDecisionThrottle > 0 &&
      detMath.hypot(tank.x - this.lastDecisionPosition.x, tank.z - this.lastDecisionPosition.z) < 0.05
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

    const targetPoint: NavPoint = target
      ? { x: target.x, y: target.y, z: target.z }
      : this.fallbackPoint(state, tank);
    const distance = target
      ? detMath.hypot(target.x - tank.x, target.z - tank.z)
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
    if (this.breachPoint && mode === 'brute') {
      if (!isSolidAt(state.world, this.breachPoint.x, this.breachPoint.y, this.breachPoint.z)) {
        this.bruteBreachDone = true;
        this.breachPoint = null;
      }
    }
    if (
      mode === 'brute' &&
      target &&
      target.visible &&
      target.tank &&
      !this.breachPoint &&
      (!this.bruteBreachDone || !shotClear)
    ) {
      this.breachPoint =
        this.blockingPoint(state, tank, target.tank) ??
        (this.bruteBreachDone ? null : this.coverPoint(state, tank));
    }
    const breachPoint = this.breachPoint;
    const aimPoint: Vec3 | null = breachPoint ?? (target ? { x: target.x, y: target.y + 1, z: target.z } : null);
    const aim = aimPoint
      ? aimAt(tank, aimPoint)
      : { yaw: tank.turretYawDegrees, pitch: tank.aimPitchDegrees };
    if (aimPoint) {
      const aimDistance = detMath.hypot(aimPoint.x - tank.x, aimPoint.z - tank.z);
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
      (shotClear || this.breachPoint !== null) &&
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
    let goal: NavPoint | null = null;

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
        const atSpot = detMath.hypot(tank.x - this.ambushSpot!.x, tank.z - this.ambushSpot!.z) < 1.2;
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
        !this.breachPoint &&
        this.profile.weights['flank'] > 0;
      goal = brawling && target ? this.strafePoint(state, tank, targetPoint) : target || dodging ? targetPoint : this.fallbackPoint(state, tank);
      if (this.breachPoint) goal = { x: this.breachPoint.x, y: tank.y, z: this.breachPoint.z };
      if (dodging && !this.breachPoint) goal = this.dodgePoint(state, tank, targetPoint);
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

    const movement = this.steerAlongPath(state.world, tank);
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

  /** Clamps a goal into the drivable interior, keeping the reference height. */
  private interior(state: MatchState, x: number, y: number, z: number): NavPoint {
    return {
      x: clamp(x, GOAL_MARGIN_METRES, state.world.widthMetres - GOAL_MARGIN_METRES),
      y,
      z: clamp(z, GOAL_MARGIN_METRES, state.world.depthMetres - GOAL_MARGIN_METRES),
    };
  }

  private strafePoint(state: MatchState, tank: Tank, target: NavPoint): NavPoint {
    const angle = detMath.atan2(tank.z - target.z, tank.x - target.x) + 0.9 * this.strafeSign;
    const radius = Math.max(6, Math.min(14, this.profile.preferredRangeMetres));
    return this.interior(state, target.x + detMath.cos(angle) * radius, tank.y, target.z + detMath.sin(angle) * radius);
  }

  private dodgePoint(state: MatchState, tank: Tank, reference: NavPoint): NavPoint {
    const direction = yawTo(tank.x, tank.z, reference.x, reference.z) + 90 * this.dodgeSign;
    const forward = forwardFromYaw(direction);
    return this.interior(state, tank.x + forward.x * 9, tank.y, tank.z + forward.z * 9);
  }

  private incomingShell(state: MatchState, tank: Tank): boolean {
    for (const shell of state.shells) {
      if (shell.ownerTeamId === tank.teamId) continue;
      const dx = tank.x - shell.x;
      const dz = tank.z - shell.z;
      const distance = detMath.hypot(dx, dz);
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

  private retreatPoint(state: MatchState, tank: Tank, target: NavPoint): NavPoint {
    const direction = yawTo(tank.x, tank.z, target.x, target.z) + 180;
    const forward = forwardFromYaw(direction);
    return this.interior(state, tank.x + forward.x * 12, tank.y, tank.z + forward.z * 12);
  }

  /**
   * The nearest reachable place within 28 m that the target cannot see: a reverse
   * slope, the far side of a ridge, a tunnel. Searched over the navigation graph, so
   * the ambusher never picks a sealed pocket it cannot drive to.
   */
  private hiddenPoint(state: MatchState, tank: Tank, target: NavPoint): NavPoint | null {
    const graph = navGraphFor(state.world, state.tick);
    const start = nodeNear(graph, tank.x, tank.y, tank.z);
    if (start === null) return null;
    const reached = reachableFrom(graph, start);
    const eye = { x: target.x, y: target.y + AI_EYE_HEIGHT_METRES, z: target.z };
    const candidates: { node: number; distance: number }[] = [];
    for (let node = 0; node < graph.nodeCount; node += 1) {
      if (!reached[node]) continue;
      const distance = detMath.hypot(graph.nodeX[node]! - tank.x, graph.nodeZ[node]! - tank.z);
      if (distance > 28) continue;
      candidates.push({ node, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.node - b.node);
    let checked = 0;
    for (const candidate of candidates) {
      const point = { x: graph.nodeX[candidate.node]!, y: graph.nodeY[candidate.node]!, z: graph.nodeZ[candidate.node]! };
      if (hasLineOfSight(state.world, eye, { x: point.x, y: point.y + 1, z: point.z })) continue;
      checked += 1;
      if (findNodePath(graph, start, candidate.node) !== null) return point;
      if (checked >= 12) break;
    }
    return null;
  }

  /** The nearest rock face around the tank at gun height: something to blast a way into. */
  private coverPoint(state: MatchState, tank: Tank): Vec3 | null {
    const gun = gunPosition(tank);
    let best: Vec3 | null = null;
    let bestDistance = Infinity;
    for (let step = 0; step < 16; step += 1) {
      const direction = directionFromAim(step * 22.5 - 180, 0);
      const to = {
        x: gun.x + direction.x * this.profile.breachRangeMetres,
        y: gun.y,
        z: gun.z + direction.z * this.profile.breachRangeMetres,
      };
      const hit = raycastTerrain(state.world, gun, to);
      if (!hit) continue;
      const distance = hit.t * this.profile.breachRangeMetres;
      if (distance < 3 || distance >= bestDistance) continue;
      best = { x: hit.x + direction.x * 0.3, y: hit.y, z: hit.z + direction.z * 0.3 };
      bestDistance = distance;
    }
    return best;
  }

  /** The first rock on the line of fire to a target within breach range, if any. */
  private blockingPoint(state: MatchState, tank: Tank, target: Tank): Vec3 | null {
    const from = gunPosition(tank);
    const to = targetCentre(target);
    const distance = detMath.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (distance > this.profile.breachRangeMetres || distance < 1e-6) return null;
    const hit = raycastTerrain(state.world, from, to);
    if (!hit) return null;
    const ux = (to.x - from.x) / distance;
    const uy = (to.y - from.y) / distance;
    const uz = (to.z - from.z) / distance;
    return { x: hit.x + ux * 0.3, y: hit.y + uy * 0.3, z: hit.z + uz * 0.3 };
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
      return { tank: chosen, x: chosen.x, y: chosen.y, z: chosen.z, visible: true };
    }
    const remembered = this.memory.latest();
    if (remembered) {
      return { tank: null, x: remembered.x, y: remembered.y, z: remembered.z, visible: false };
    }
    return null;
  }

  /**
   * Where to go with no enemy known: a patrol. The tank picks a seeded random reachable
   * place at least `AI_PATROL_MIN_METRES` away and drives there; once it arrives (or
   * the leg times out) it picks the next. On a landscape the old "drive to the centre"
   * parked tanks in the cavern under the hill, blind; a patrol sweeps the arena.
   */
  private fallbackPoint(state: MatchState, tank: Tank): NavPoint {
    const current = this.patrolPoint;
    if (
      current &&
      state.tick < this.patrolUntilTick &&
      detMath.hypot(tank.x - current.x, tank.z - current.z) > AI_PATROL_ARRIVED_METRES
    ) {
      return current;
    }
    const graph = navGraphFor(state.world, state.tick);
    const start = nodeNear(graph, tank.x, tank.y, tank.z);
    let next: NavPoint | null = null;
    if (start !== null) {
      const reached = reachableFrom(graph, start);
      const candidates: number[] = [];
      const minSq = AI_PATROL_MIN_METRES * AI_PATROL_MIN_METRES;
      for (let n = 0; n < graph.nodeCount; n += 1) {
        if (!reached[n]) continue;
        const dx = graph.nodeX[n]! - tank.x;
        const dz = graph.nodeZ[n]! - tank.z;
        if (dx * dx + dz * dz >= minSq) candidates.push(n);
      }
      if (candidates.length > 0) {
        // Best of three seeded draws, scored by distance from home: patrols push out
        // into the arena (where enemies come from) instead of circling the own pad.
        this.home ??= { x: tank.x, z: tank.z };
        let node = -1;
        let best = -Infinity;
        for (let draw = 0; draw < 3; draw += 1) {
          const candidate = candidates[this.rng.int(candidates.length)]!;
          const score = detMath.hypot(graph.nodeX[candidate]! - this.home.x, graph.nodeZ[candidate]! - this.home.z);
          if (score > best) {
            best = score;
            node = candidate;
          }
        }
        next = { x: graph.nodeX[node]!, y: graph.nodeY[node]!, z: graph.nodeZ[node]! };
      }
    }
    this.patrolPoint = next ?? {
      x: state.world.widthMetres / 2,
      y: tank.y,
      z: state.world.depthMetres / 2,
    };
    this.patrolUntilTick = state.tick + AI_PATROL_LEG_TICKS;
    return this.patrolPoint;
  }

  private setPath(state: MatchState, tank: Tank, goal: NavPoint): void {
    this.movementGoal = goal;
    const next = this.navigation.findPath(state.world, state.tick, tank, goal, this.forcePath);
    if (next !== this.path) {
      this.path = next;
      this.pathIndex = 0;
    }
    if (this.path) {
      while (this.pathIndex < this.path.length && reached(tank, this.path[this.pathIndex]!)) {
        this.pathIndex += 1;
      }
    }
  }

  private steerAlongPath(world: World, tank: Tank): { throttle: number; steer: number } {
    if (!this.path || this.pathIndex >= this.path.length) {
      if (!this.movementGoal) {
        return { throttle: 0, steer: 0 };
      }
      if (reached(tank, this.movementGoal)) {
        return { throttle: 0, steer: 0 };
      }
      return this.steerToward(tank, this.movementGoal.x, this.movementGoal.z);
    }
    // Steer for the furthest upcoming waypoint within the look-ahead that the hull can
    // see straight: the waypoints are only 1.5 m apart, well inside the tank's turning
    // circle, so chasing the next one makes it orbit instead of drive.
    let aim = this.pathIndex;
    for (let next = this.pathIndex + 1; next < this.path.length; next += 1) {
      const point = this.path[next]!;
      if (detMath.hypot(point.x - tank.x, point.z - tank.z) > AI_PATH_LOOKAHEAD_METRES) break;
      if (!hasClearLine(world, { x: tank.x, y: tank.y + 0.8, z: tank.z }, { x: point.x, y: point.y + 0.8, z: point.z })) break;
      aim = next;
    }
    const waypoint = this.path[aim]!;
    return this.steerToward(tank, waypoint.x, waypoint.z);
  }

  private steerToward(tank: Tank, x: number, z: number): { throttle: number; steer: number } {
    const desiredYaw = yawTo(tank.x, tank.z, x, z);
    const yawError = shortestAngleDelta(tank.hullYawDegrees, desiredYaw);
    const steer = clamp(yawError / (TANK_TURN_RATE_DEGREES_PER_SECOND / 10), -1, 1);
    // Pivot on the spot for a sharp turn rather than circling wide.
    const throttle = Math.abs(yawError) <= 30 ? 0.85 : Math.abs(yawError) <= 75 ? 0.4 : 0;
    return { throttle, steer };
  }
}

/** Turret yaw and pitch from the tank's gun to a point. */
function aimAt(tank: Tank, point: Vec3): { yaw: number; pitch: number } {
  const gun = gunPosition(tank);
  const horizontal = detMath.hypot(point.x - gun.x, point.z - gun.z);
  const pitch = horizontal < 1e-9 ? 0 : (detMath.atan2(point.y - gun.y, horizontal) * 180) / Math.PI;
  return { yaw: normaliseDegrees(yawTo(tank.x, tank.z, point.x, point.z)), pitch };
}

/**
 * Yaw pointing from one point to another in the simulation convention: forward is
 * `(-sin yaw, -cos yaw)`, so yaw = atan2(-dx, -dz).
 */
function yawTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return normaliseDegrees((detMath.atan2(-(toX - fromX), -(toZ - fromZ)) * 180) / Math.PI);
}

function squaredDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** A waypoint is reached when the tank is on it horizontally and on the same level. */
function reached(tank: Tank, point: NavPoint): boolean {
  return detMath.hypot(tank.x - point.x, tank.z - point.z) <= AI_WAYPOINT_REACHED_METRES && Math.abs(tank.y - point.y) < 2;
}
