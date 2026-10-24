/**
 * The all-AI spectator session: four teams of AI tanks on the team arena, a fixed
 * step, no player input, an auto-director and a manual next-tank follow.
 *
 * This module is game layer: no three.js, no DOM, no wall clock. The director chooses
 * WHAT the camera should look at (a point, a yaw and an arm length); the render layer
 * turns that into a camera pose.
 */

import {
  AIController,
  AI_PROFILES,
  getAIProfile,
  hasLineOfSight,
  eyePosition,
  targetCentre,
} from '../core/ai.ts';
import { FixedStep } from '../core/timestep.ts';
import {
  DEFAULT_MATCH_RULES,
  collectControllerOrders,
  stepMatch,
  type MatchRules,
  type MatchState,
  type Tank,
} from '../core/sim.ts';
import {
  createTeamMatch,
  createTeamAIController,
} from '../core/ai/teamBatch.ts';
import { arenaTeamSetup, TEAM_MODE_AIM_ERROR_SCALE } from './aiBatch.ts';
import { ARENA } from './levels/arena.ts';
import { interpolateTanks, snapshotTanks, type TankRenderFrame } from './tankFrames.ts';

export const SPECTATOR_TEAM_AIM_ERROR_SCALE = TEAM_MODE_AIM_ERROR_SCALE;
export const DIRECTOR_INTERVAL_TICKS = 180;
const DIRECTOR_SHELL_RADIUS_METRES = 12;
const DIRECTOR_NEAR_RADIUS_METRES = 24;

export interface SpectatorOptions {
  readonly teams?: number;
  readonly tanksPerTeam?: number;
  readonly seed?: number;
  /** Profile names by team slot; defaults to the four-character cast. */
  readonly characters?: readonly string[];
  /** Ticks between director cuts; defaults to the spectator's 180 (3 s). */
  readonly directorIntervalTicks?: number;
  /** Match rules (the time limit); defaults to the app's rules. */
  readonly rules?: MatchRules;
}

/** What the director wants the renderer to frame. */
export interface DirectorShot {
  readonly focusTankId: number;
  readonly targetTankId: number | null;
  readonly centerX: number;
  readonly centerZ: number;
  readonly yawDegrees: number;
  readonly distanceMetres: number;
  readonly pitchDegrees: number;
  readonly reason: 'engagement' | 'shells' | 'overview' | 'follow';
  readonly hasShells: boolean;
}

interface Engagement {
  readonly a: Tank;
  readonly b: Tank;
  readonly distance: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly shells: number;
  readonly nearTeams: number;
  readonly injured: number;
  readonly score: number;
}

/**
 * Owns the live spectator match. `advance` is the only frame-delta-to-ticks seam; the
 * AI decisions are made by real `AIController`s, one per tank, using the team-mode
 * seed/phase and the team-mode aim tuning.
 */
export class SpectatorSession {
  readonly state: MatchState;
  readonly fixed: FixedStep;
  readonly characters: readonly string[];
  readonly directorIntervalTicks: number;

  private previous: Map<number, TankRenderFrame>;
  private current: Map<number, TankRenderFrame>;
  private controllers = new Map<number, AIController>();
  private frozen = false;
  private manualTankId: number | null = null;
  private directorDirty = true;
  private lastDirectorTick = -1;
  private shot: DirectorShot | null = null;

  constructor(options: SpectatorOptions = {}) {
    const teams = options.teams ?? 4;
    const tanksPerTeam = options.tanksPerTeam ?? 4;
    const seed = options.seed ?? 1;
    if (!Number.isInteger(seed) || seed < 0) {
      throw new Error(`spectator: seed must be a non-negative integer, got ${String(seed)}`);
    }
    if (!Number.isInteger(teams) || teams < 2 || teams > 4) {
      throw new Error(`spectator: teams must be 2…4, got ${String(teams)}`);
    }
    if (!Number.isInteger(tanksPerTeam) || tanksPerTeam < 1 || tanksPerTeam > 4) {
      throw new Error(`spectator: tanksPerTeam must be 1…4, got ${String(tanksPerTeam)}`);
    }
    const requested = [...(options.characters ?? AI_PROFILES.map((profile) => profile.name))];
    if (requested.length < tanksPerTeam) {
      throw new Error(
        `spectator: ${requested.length} characters cannot fill ${tanksPerTeam} tanks per team`,
      );
    }
    this.characters = requested.slice(0, tanksPerTeam);
    const directorIntervalTicks = options.directorIntervalTicks ?? DIRECTOR_INTERVAL_TICKS;
    if (!Number.isInteger(directorIntervalTicks) || directorIntervalTicks < 1) {
      throw new Error(
        `spectator: directorIntervalTicks must be a positive integer, got ${String(directorIntervalTicks)}`,
      );
    }
    this.directorIntervalTicks = directorIntervalTicks;
    const profiles = this.characters.map((name) => getAIProfile(name));

    this.state = createTeamMatch(arenaTeamSetup(teams, tanksPerTeam), seed, options.rules ?? DEFAULT_MATCH_RULES).state;
    for (const tank of this.state.tanks) {
      const profile = profiles[tank.teamIndex];
      if (!profile) {
        throw new Error(`spectator: no profile for team ${tank.teamId} slot ${tank.teamIndex}`);
      }
      this.controllers.set(
        tank.id,
        createTeamAIController(tank, profile, seed, SPECTATOR_TEAM_AIM_ERROR_SCALE),
      );
    }
    this.previous = snapshotTanks(this.state);
    this.current = snapshotTanks(this.state);
    this.fixed = new FixedStep();
    this.updateDirector(true);
  }

  get floorY(): number {
    return ARENA.cells.floorSurfaceHeightMetres;
  }

  get frozenFrame(): boolean {
    return this.frozen;
  }

  get alpha(): number {
    return this.frozen ? 1 : this.fixed.alpha;
  }

  get followedTankId(): number | null {
    return this.manualTankId ?? this.shot?.focusTankId ?? null;
  }

  get autoDirector(): boolean {
    return this.manualTankId === null;
  }

  /** One frame delta → zero or more simulation ticks. No player input exists. */
  advance(frameSeconds: number): number {
    if (this.frozen) return 0;
    return this.fixed.advance(frameSeconds, () => {
      if (this.state.status === 'active') this.stepOnce();
    });
  }

  /** Advances exactly `ticks` ticks and freezes. Used by the screenshot pose. */
  runTicks(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(`spectator: ticks must be a non-negative integer, got ${String(ticks)}`);
    }
    if (this.frozen) return;
    for (let tick = 0; tick < ticks && this.state.status === 'active'; tick += 1) {
      this.stepOnce();
    }
    this.frozen = true;
    this.fixed.reset();
    this.previous = this.current;
    this.updateDirector(true);
  }

  /** N cycles to the next living tank and locks the camera onto it. */
  nextTank(): number | null {
    const alive = this.state.tanks
      .filter((tank) => tank.alive)
      .map((tank) => tank.id)
      .sort((a, b) => a - b);
    if (alive.length === 0) return null;
    const current = this.followedTankId;
    const index = current === null ? -1 : alive.indexOf(current);
    const next = alive[(index + 1) % alive.length] ?? alive[0]!;
    this.manualTankId = next;
    this.directorDirty = true;
    this.updateDirector(true);
    return next;
  }

  /** Returns to the auto-director after a manual follow. */
  resumeAutoDirector(): void {
    this.manualTankId = null;
    this.directorDirty = true;
    this.updateDirector(true);
  }

  /** The current shot; recomputed only on a cut or a manual request. */
  directorShot(): DirectorShot {
    if (!this.shot) this.updateDirector(true);
    if (!this.shot) throw new Error('spectator: the director has no shot');
    return this.shot;
  }

  interpolatedTanks(alpha: number): readonly TankRenderFrame[] {
    return interpolateTanks(this.previous, this.current, alpha);
  }

  private stepOnce(): void {
    this.previous = this.current;
    stepMatch(this.state, collectControllerOrders(this.state, this.controllers, 'spectator'));
    this.current = snapshotTanks(this.state);
    this.updateDirector(false);
  }

  private updateDirector(force: boolean): void {
    if (this.manualTankId !== null) {
      const manual = this.state.tanks.find((tank) => tank.id === this.manualTankId);
      if (!manual || !manual.alive) {
        this.manualTankId = null;
        this.directorDirty = true;
      }
    }
    const shellsNow = this.state.shells.length > 0;
    const shellCut = shellsNow && !this.shot?.hasShells;
    if (
      !force &&
      !this.directorDirty &&
      this.state.tick - this.lastDirectorTick < this.directorIntervalTicks &&
      !shellCut
    ) {
      return;
    }
    this.shot = this.pickShot();
    this.lastDirectorTick = this.state.tick;
    this.directorDirty = false;
  }

  private pickShot(): DirectorShot {
    const alive = this.state.tanks.filter((tank) => tank.alive).sort((a, b) => a.id - b.id);
    if (alive.length === 0) {
      return {
        focusTankId: 0,
        targetTankId: null,
        centerX: 24,
        centerZ: 24,
        yawDegrees: 0,
        distanceMetres: 26,
        pitchDegrees: 35,
        reason: 'overview',
        hasShells: false,
      };
    }
    if (this.manualTankId !== null) {
      const manual = alive.find((tank) => tank.id === this.manualTankId);
      if (manual) return this.followShot(manual);
    }

    // Early in a four-team battle the teams are spread around the arena; a close
    // two-tank cut would hide half the cast. The director opens on a four-team
    // overview, then cuts closer as the field collapses.
    const liveTeams = new Set(alive.map((tank) => tank.teamId)).size;
    if (alive.length >= 10 && liveTeams === 4) {
      return this.overviewShot(alive);
    }

    const engagements = this.engagements();
    const best = engagements.reduce<Engagement | null>(
      (winner, candidate) =>
        winner === null ||
        candidate.score > winner.score ||
        (candidate.score === winner.score && candidate.a.id < winner.a.id)
          ? candidate
          : winner,
      null,
    );
    if (best) {
      return this.engagementShot(best);
    }

    // No visible engagement: frame the largest nearby cluster so the live view keeps
    // four teams on screen, and prefer shells if any remain in flight.
    const shells = this.state.shells;
    if (shells.length > 0) {
      const shell = shells[0]!;
      const nearest = alive.reduce((a, b) =>
        Math.hypot(shell.x - a.x, shell.z - a.z) <= Math.hypot(shell.x - b.x, shell.z - b.z) ? a : b,
      );
      return {
        focusTankId: nearest.id,
        targetTankId: null,
        centerX: (shell.x + nearest.x) / 2,
        centerZ: (shell.z + nearest.z) / 2,
        yawDegrees: nearest.hullYawDegrees,
        distanceMetres: 22,
        pitchDegrees: 32,
        reason: 'shells',
        hasShells: true,
      };
    }
    const centerX = mean(alive.map((tank) => tank.x));
    const centerZ = mean(alive.map((tank) => tank.z));
    const focus = alive.reduce((a, b) =>
      Math.hypot(centerX - a.x, centerZ - a.z) <= Math.hypot(centerX - b.x, centerZ - b.z) ? a : b,
    );
    return {
      focusTankId: focus.id,
      targetTankId: null,
      centerX,
      centerZ,
      yawDegrees: focus.hullYawDegrees,
      distanceMetres: 30,
      pitchDegrees: 36,
      reason: 'overview',
      hasShells: false,
    };
  }

  private overviewShot(alive: readonly Tank[]): DirectorShot {
    const focus = alive.reduce((a, b) =>
      Math.hypot(24 - a.x, 24 - a.z) <= Math.hypot(24 - b.x, 24 - b.z) ? a : b,
    );
    return {
      focusTankId: focus.id,
      targetTankId: null,
      centerX: 24,
      centerZ: 24,
      yawDegrees: -135,
      distanceMetres: 40,
      pitchDegrees: 55,
      reason: 'overview',
      hasShells: this.state.shells.length > 0,
    };
  }

  private followShot(tank: Tank): DirectorShot {
    const visible = this.visibleEnemiesFor(tank);
    const target = visible[0] ?? this.nearestEnemy(tank);
    return {
      focusTankId: tank.id,
      targetTankId: target?.id ?? null,
      centerX: tank.x,
      centerZ: tank.z,
      yawDegrees: tank.hullYawDegrees,
      distanceMetres: 14,
      pitchDegrees: 24,
      reason: 'follow',
      hasShells: this.state.shells.length > 0,
    };
  }

  private engagementShot(engagement: Engagement): DirectorShot {
    const { a, b } = engagement;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    let px = -dz / length;
    let pz = dx / length;
    // Choose the side that does not put the camera outside the 48 m arena if one side
    // is clearly better. Both are deterministic; the tie goes to the first.
    // If only two teams are near the fight, pull back far enough to keep the other
    // teams in the shot; a four-team scrum can be framed tighter.
    const distance = engagement.nearTeams >= 4 ? 24 : 34;
    const sideA = { x: engagement.centerX - px * distance, z: engagement.centerZ - pz * distance };
    const sideB = { x: engagement.centerX + px * distance, z: engagement.centerZ + pz * distance };
    const inside = (point: { x: number; z: number }): boolean =>
      point.x > 2 && point.x < 46 && point.z > 2 && point.z < 46;
    if (!inside(sideA) && inside(sideB)) {
      px = -px;
      pz = -pz;
    }
    return {
      focusTankId: a.id,
      targetTankId: b.id,
      centerX: engagement.centerX,
      centerZ: engagement.centerZ,
      yawDegrees: (Math.atan2(-px, -pz) * 180) / Math.PI,
      distanceMetres: distance,
      pitchDegrees: engagement.nearTeams >= 4 ? 34 : 45,
      reason: engagement.shells > 0 ? 'shells' : 'engagement',
      hasShells: engagement.shells > 0,
    };
  }

  private engagements(): Engagement[] {
    const alive = this.state.tanks.filter((tank) => tank.alive);
    const result: Engagement[] = [];
    for (let first = 0; first < alive.length; first += 1) {
      for (let second = first + 1; second < alive.length; second += 1) {
        const a = alive[first]!;
        const b = alive[second]!;
        if (a.teamId === b.teamId) continue;
        if (!this.hasSight(a, b)) continue;
        result.push(this.scoreEngagement(a, b));
      }
    }
    return result;
  }

  private scoreEngagement(a: Tank, b: Tank): Engagement {
    const centerX = (a.x + b.x) / 2;
    const centerZ = (a.z + b.z) / 2;
    const distance = Math.hypot(a.x - b.x, a.z - b.z);
    const shells = this.state.shells.filter(
      (shell) => Math.hypot(shell.x - centerX, shell.z - centerZ) <= DIRECTOR_SHELL_RADIUS_METRES,
    ).length;
    const teams = new Set<number>();
    let injured = 0;
    for (const tank of this.state.tanks) {
      if (!tank.alive) continue;
      if (Math.hypot(tank.x - centerX, tank.z - centerZ) <= DIRECTOR_NEAR_RADIUS_METRES) {
        teams.add(tank.teamId);
      }
      if (tank.hp < tank.maxHp && Math.hypot(tank.x - centerX, tank.z - centerZ) <= DIRECTOR_NEAR_RADIUS_METRES) {
        injured += 1;
      }
    }
    const score =
      shells * 6 +
      teams.size * 3 +
      injured * 2 +
      (distance <= 30 ? 2 : 0) +
      1 / (1 + Math.abs(distance - 18));
    return {
      a,
      b,
      distance,
      centerX,
      centerZ,
      shells,
      nearTeams: teams.size,
      injured,
      score,
    };
  }

  private hasSight(a: Tank, b: Tank): boolean {
    return hasLineOfSight(this.state.world, eyePosition(this.state.world, a), targetCentre(this.state.world, b));
  }

  private visibleEnemiesFor(tank: Tank): Tank[] {
    const visible = this.state.tanks
      .filter((candidate) => candidate.alive && candidate.teamId !== tank.teamId)
      .filter((candidate) =>
        hasLineOfSight(
          this.state.world,
          eyePosition(this.state.world, tank),
          targetCentre(this.state.world, candidate),
        ),
      );
    visible.sort((a, b) => Math.hypot(tank.x - a.x, tank.z - a.z) - Math.hypot(tank.x - b.x, tank.z - b.z) || a.id - b.id);
    return visible;
  }

  private nearestEnemy(tank: Tank): Tank | null {
    let best: Tank | null = null;
    let bestDistance = Infinity;
    for (const candidate of this.state.tanks) {
      if (!candidate.alive || candidate.teamId === tank.teamId) continue;
      const distance = Math.hypot(tank.x - candidate.x, tank.z - candidate.z);
      if (distance < bestDistance || (distance === bestDistance && best !== null && candidate.id < best.id)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('spectator: mean of an empty list');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
