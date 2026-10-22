/**
 * The player-team session: the human's tank plus three AI squadmates (team 0), against
 * three AI teams of four on the authored arena.
 *
 * This module is game layer: no three.js, no DOM, no wall clock. The player is ONE
 * `Controller` among the AI's `Controller`s — there is no `isPlayer` in the core and
 * none is added here; the only thing the session knows is which tank id receives the
 * input-backed controller.
 *
 * The team-mode aim scale, the seeded slot controller seeds and the team decision
 * phase are the SAME values the spectator and the 4×4 table use, so the player team's
 * stand-in measurement is comparable with the all-AI table.
 */

import {
  AIController,
  AI_PROFILES,
  getAIProfile,
  type AIProfile,
} from '../core/ai.ts';
import { rotateTeamAssignments, teamControllerSeed, teamDecisionPhase } from '../core/ai/teamBatch.ts';
import { FixedStep } from '../core/timestep.ts';
import {
  DEFAULT_MATCH_RULES,
  createMatch,
  hashMatch,
  normaliseDegrees,
  stepMatch,
  type Controller,
  type MatchRules,
  type MatchState,
  type Tank,
  type TankCommand,
  type TankCommandOrder,
} from '../core/sim.ts';
import { arenaTeamSetup, TEAM_MODE_AIM_ERROR_SCALE } from './aiBatch.ts';
import { ARENA, ARENA_BOUNDS } from './levels/arena.ts';
import { commandFromInput, idlePlayerInput, type PlayerInput } from './input.ts';
import { interpolateTanks, snapshotTanks, type TankRenderFrame } from './tankFrames.ts';

/** The player's tank id. `createMatch` assigns team 0's tanks first, slot 0 first. */
export const PLAYER_TANK_ID = 0;
/** The player's team id. Team 0 is always the human's side in this mode. */
export const PLAYER_TEAM_ID = 0;
/** Four tanks per team is the authored player-team mode. */
const TEAM_SIZE = 4;
const TEAM_COUNT = 4;

export interface TeamSessionOptions {
  /** The match seed; the same seed and input reproduce the same battle. */
  readonly seed: number;
  /** Profile names by tank slot; slot 0 is the player's unused slot. Defaults the cast. */
  readonly characters?: readonly string[];
  /** Sampled once per simulation tick for the player's controller. */
  readonly readInput?: () => PlayerInput;
  /**
   * Replaces the input-backed player controller. The screenshot demo and the stand-in
   * batch pass a deterministic AI here; in play mode this is omitted.
   */
  readonly playerController?: Controller;
  readonly rules?: MatchRules;
}

/**
 * The input-to-command adapter. It reads the current hull yaw from the live state, so
 * mouse aim stays a relative turret offset as the hull turns.
 */
export class PlayerInputController implements Controller {
  private readonly readInput: () => PlayerInput;

  constructor(readInput: () => PlayerInput) {
    this.readInput = readInput;
  }

  commandFor(state: MatchState, tankId: number): TankCommand {
    const tank = state.tanks.find((candidate) => candidate.id === tankId);
    if (!tank) {
      throw new Error(`teamSession: the player controller lost tank ${tankId}`);
    }
    return commandFromInput(this.readInput(), tank.hullYawDegrees);
  }
}

/**
 * A scripted vanguard for the player's tank: the stand-in for a human in the batch and
 * the deterministic pilot for the `?mode=team&demo=team` screenshot. It is exactly the
 * AI vanguard a teammate or an opponent uses, with the player slot's seed and phase.
 */
export function createVanguardStandIn(
  seed: number,
  aimErrorScale = TEAM_MODE_AIM_ERROR_SCALE,
): AIController {
  return new AIController({
    tankId: PLAYER_TANK_ID,
    profile: getAIProfile('vanguard'),
    seed: teamControllerSeed(seed, 0),
    decisionPhaseTicks: teamDecisionPhase(seed, PLAYER_TEAM_ID, 0),
    aimErrorScale,
  });
}

export class TeamSession {
  readonly state: MatchState;
  readonly fixed: FixedStep;
  readonly playerTankId = PLAYER_TANK_ID;
  readonly playerTeamId = PLAYER_TEAM_ID;
  readonly characters: readonly string[];

  private previous: Map<number, TankRenderFrame>;
  private current: Map<number, TankRenderFrame>;
  private readonly controllers = new Map<number, Controller>();
  private frozenState = false;

  constructor(options: TeamSessionOptions) {
    const seed = options.seed;
    if (!Number.isInteger(seed) || seed < 0) {
      throw new Error(`teamSession: seed must be a non-negative integer, got ${String(seed)}`);
    }
    const requested = [...(options.characters ?? AI_PROFILES.map((profile) => profile.name))];
    if (requested.length < TEAM_SIZE) {
      throw new Error(
        `teamSession: ${requested.length} characters cannot fill ${TEAM_SIZE} tanks per team`,
      );
    }
    if (new Set(requested).size !== requested.length) {
      throw new Error('teamSession: character names must be unique');
    }
    this.characters = requested.slice(0, TEAM_SIZE);
    this.characters.forEach((name) => getAIProfile(name));
    const profiles: readonly AIProfile[] = this.characters.map((name) => getAIProfile(name));

    const setup = arenaTeamSetup(TEAM_COUNT, TEAM_SIZE);
    const groups = [...setup.teams].sort((a, b) => a.teamId - b.teamId);
    const assignments = rotateTeamAssignments(groups, seed);
    const yawPattern = setup.cornerYawPatterns?.[seed % setup.cornerYawPatterns.length];
    this.state = createMatch({
      level: setup.level,
      teams: assignments.map((assignment) => ({
        id: assignment.teamId,
        tanks: assignment.corner.spawns.map((spawn) => ({
          ...spawn,
          hullYawDegrees: yawPattern?.[assignment.corner.teamId] ?? spawn.hullYawDegrees,
        })),
      })),
      seed,
      rules: options.rules ?? DEFAULT_MATCH_RULES,
    });
    const playerSpawn = this.state.tanks[PLAYER_TANK_ID];
    if (playerSpawn?.teamId !== PLAYER_TEAM_ID) {
      throw new Error('teamSession: tank id 0 is not on team 0');
    }
    // P2: a human should look at the fight, not at the corner wall. The spawn corner
    // still rotates by seed; only the facing is aimed at the arena centre.
    const centreX = (ARENA_BOUNDS.minX + ARENA_BOUNDS.maxX) / 2;
    const centreZ = (ARENA_BOUNDS.minZ + ARENA_BOUNDS.maxZ) / 2;
    const facing = normaliseDegrees(
      (Math.atan2(-(centreX - playerSpawn.x), -(centreZ - playerSpawn.z)) * 180) / Math.PI,
    );
    playerSpawn.hullYawDegrees = facing;
    playerSpawn.turretYawDegrees = facing;
    playerSpawn.aimPitchDegrees = 0;

    const readInput = options.readInput ?? idlePlayerInput;
    const playerController = options.playerController ?? new PlayerInputController(readInput);
    for (const tank of this.state.tanks) {
      if (tank.id === PLAYER_TANK_ID) {
        this.controllers.set(tank.id, playerController);
        continue;
      }
      const profile = profiles[tank.teamIndex];
      if (!profile) {
        throw new Error(`teamSession: no profile for team ${tank.teamId} slot ${tank.teamIndex}`);
      }
      this.controllers.set(
        tank.id,
        new AIController({
          tankId: tank.id,
          profile,
          seed: teamControllerSeed(seed, tank.teamIndex),
          decisionPhaseTicks: teamDecisionPhase(seed, tank.teamId, tank.teamIndex),
          aimErrorScale: TEAM_MODE_AIM_ERROR_SCALE,
        }),
      );
    }

    this.previous = snapshotTanks(this.state);
    this.current = snapshotTanks(this.state);
    this.fixed = new FixedStep();
  }

  get floorY(): number {
    return ARENA.cells.floorSurfaceHeightMetres;
  }

  get frozenFrame(): boolean {
    return this.frozenState;
  }

  get frozen(): boolean {
    return this.frozenState;
  }

  get alpha(): number {
    return this.frozenState ? 1 : this.fixed.alpha;
  }

  /** The player's team, slot 0 first: the player and the three squadmates. */
  /** Character names for the HUD kill feed, in slot order. */
  get feedNames(): readonly string[] {
    return this.characters;
  }

  get squad(): readonly Tank[] {
    const team = this.state.teams.find((candidate) => candidate.id === PLAYER_TEAM_ID);
    if (!team) throw new Error('teamSession: the player team is missing');
    return team.tanks;
  }

  get player(): TankRenderFrame {
    return this.requireCurrent(PLAYER_TANK_ID);
  }

  /** One frame delta → zero or more simulation ticks. Input is sampled per tick. */
  advance(frameSeconds: number): number {
    if (this.frozenState) {
      return 0;
    }
    return this.fixed.advance(frameSeconds, () => {
      if (this.state.status === 'active') {
        this.stepOnce();
      }
    });
  }

  /** Advances exactly `ticks` ticks and freezes; used by the demo and the stand-in. */
  runTicks(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(`teamSession: ticks must be a non-negative integer, got ${String(ticks)}`);
    }
    if (this.frozenState) {
      return;
    }
    for (let tick = 0; tick < ticks && this.state.status === 'active'; tick += 1) {
      this.stepOnce();
    }
    this.frozenState = true;
    this.fixed.reset();
    this.previous = this.current;
  }

  /** The state hash a determinism pin compares. */
  hash(): string {
    return hashMatch(this.state);
  }

  interpolatedTanks(alpha: number): readonly TankRenderFrame[] {
    return interpolateTanks(this.previous, this.current, alpha);
  }

  private stepOnce(): void {
    this.previous = this.current;
    const orders: TankCommandOrder[] = [];
    for (const tank of this.state.tanks) {
      if (!tank.alive) {
        continue;
      }
      const controller = this.controllers.get(tank.id);
      if (!controller) {
        throw new Error(`teamSession: no controller for tank ${tank.id}`);
      }
      orders.push({ tankId: tank.id, command: controller.commandFor(this.state, tank.id) });
    }
    stepMatch(this.state, orders);
    this.current = snapshotTanks(this.state);
  }

  private requireCurrent(tankId: number): TankRenderFrame {
    const frame = this.current.get(tankId);
    if (!frame) {
      throw new Error(`teamSession: tank ${tankId} is missing from the current frame`);
    }
    return frame;
  }
}
