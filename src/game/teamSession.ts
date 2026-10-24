/**
 * The player-team session: the human's tank plus up to three AI squadmates (team 0),
 * against one to three AI teams on the authored arena. The default is the authored
 * 4×4; the match setup screen may choose fewer teams or smaller squads.
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
import { createTeamMatch, createTeamAIController } from '../core/ai/teamBatch.ts';
import { FixedStep } from '../core/timestep.ts';
import {
  DEFAULT_MATCH_RULES,
  collectControllerOrders,
  hashMatch,
  normaliseDegrees,
  stepMatch,
  type Controller,
  type MatchRules,
  type MatchState,
  type Tank,
} from '../core/sim.ts';
import { arenaTeamSetup, TEAM_MODE_AIM_ERROR_SCALE } from './aiBatch.ts';
import { ARENA, ARENA_BOUNDS } from './levels/arena.ts';
import { idlePlayerInput, type PlayerInput } from './input.ts';
import { PlayerAimController, type AimCamera } from './aim.ts';
import { interpolateTanks, snapshotTanks, type TankRenderFrame } from './tankFrames.ts';

/** The player's tank id. `createMatch` assigns team 0's tanks first, slot 0 first. */
export const PLAYER_TANK_ID = 0;
/** The player's team id. Team 0 is always the human's side in this mode. */
export const PLAYER_TEAM_ID = 0;
/** Four teams of four is the authored player-team mode, and the default. */
const DEFAULT_TEAM_SIZE = 4;
const DEFAULT_TEAM_COUNT = 4;

export interface TeamSessionOptions {
  /** The match seed; the same seed and input reproduce the same battle. */
  readonly seed: number;
  /** Number of teams, 2…4 (team 0 is the player's). Defaults to 4. */
  readonly teams?: number;
  /** Tanks per team, 1…4, the player included. Defaults to 4. */
  readonly tanksPerTeam?: number;
  /** Profile names by tank slot; slot 0 is the player's unused slot. Defaults the cast. */
  readonly characters?: readonly string[];
  /** Sampled once per simulation tick for the player's controller. */
  readonly readInput?: () => PlayerInput;
  /** The latest render-camera snapshot; the player's world aim is solved from it. */
  readonly readAimCamera?: () => AimCamera | null;
  /**
   * Replaces the input-backed player controller. The screenshot demo and the stand-in
   * batch pass a deterministic AI here; in play mode this is omitted.
   */
  readonly playerController?: Controller;
  readonly rules?: MatchRules;
  /**
   * Online play: the tank slots humans drive, each with its own controller. When given,
   * tank 0 is no longer special: every slot not listed here is AI, and `playerController`
   * and `readInput` are not used.
   */
  readonly seats?: readonly SeatController[];
  /** The slot the local view follows (online: this browser's seat). Defaults to team 0 slot 0. */
  readonly viewSeat?: TankSlot;
}

/** A tank slot: a team and the tank's position in it. */
export interface TankSlot {
  readonly teamId: number;
  readonly teamIndex: number;
}

/** A human-driven tank slot and the controller that drives it. */
export interface SeatController extends TankSlot {
  readonly controller: Controller;
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
  return createTeamAIController(
    { id: PLAYER_TANK_ID, teamId: PLAYER_TEAM_ID, teamIndex: 0 },
    getAIProfile('vanguard'),
    seed,
    aimErrorScale,
  );
}

export class TeamSession {
  readonly state: MatchState;
  readonly fixed: FixedStep;
  readonly playerTankId: number;
  readonly playerTeamId: number;
  readonly characters: readonly string[];
  private readonly seed: number;
  private readonly profiles: readonly AIProfile[];

  private previous: Map<number, TankRenderFrame>;
  private current: Map<number, TankRenderFrame>;
  private readonly controllers = new Map<number, Controller>();
  private frozenState = false;

  constructor(options: TeamSessionOptions) {
    const seed = options.seed;
    if (!Number.isInteger(seed) || seed < 0) {
      throw new Error(`teamSession: seed must be a non-negative integer, got ${String(seed)}`);
    }
    const teamCount = options.teams ?? DEFAULT_TEAM_COUNT;
    const teamSize = options.tanksPerTeam ?? DEFAULT_TEAM_SIZE;
    const requested = [...(options.characters ?? AI_PROFILES.map((profile) => profile.name))];
    if (requested.length < teamSize) {
      throw new Error(
        `teamSession: ${requested.length} characters cannot fill ${teamSize} tanks per team`,
      );
    }
    if (new Set(requested).size !== requested.length) {
      throw new Error('teamSession: character names must be unique');
    }
    this.characters = requested.slice(0, teamSize);
    this.characters.forEach((name) => getAIProfile(name));
    const profiles: readonly AIProfile[] = this.characters.map((name) => getAIProfile(name));

    this.seed = seed;
    this.profiles = profiles;
    this.state = createTeamMatch(arenaTeamSetup(teamCount, teamSize), seed, options.rules ?? DEFAULT_MATCH_RULES).state;
    const playerSpawn = this.state.tanks[PLAYER_TANK_ID];
    if (playerSpawn?.teamId !== PLAYER_TEAM_ID) {
      throw new Error('teamSession: tank id 0 is not on team 0');
    }

    // Which slots are human: the local player's tank 0, or the online seats.
    const humanControllers = new Map<number, Controller>();
    if (options.seats) {
      for (const seat of options.seats) {
        const tank = this.requireSlot(seat);
        if (humanControllers.has(tank.id)) {
          throw new Error(`teamSession: two seats drive team ${seat.teamId} slot ${seat.teamIndex}`);
        }
        humanControllers.set(tank.id, seat.controller);
      }
    } else {
      const readInput = options.readInput ?? idlePlayerInput;
      humanControllers.set(
        PLAYER_TANK_ID,
        options.playerController ??
          new PlayerAimController(readInput, options.readAimCamera ?? (() => null)),
      );
    }
    const view = this.requireSlot(options.viewSeat ?? { teamId: PLAYER_TEAM_ID, teamIndex: 0 });
    this.playerTankId = view.id;
    this.playerTeamId = view.teamId;

    // P2: a human should look at the fight, not at the corner wall. The spawn corner
    // still rotates by seed; only the facing is aimed at the arena centre.
    const centreX = (ARENA_BOUNDS.minX + ARENA_BOUNDS.maxX) / 2;
    const centreZ = (ARENA_BOUNDS.minZ + ARENA_BOUNDS.maxZ) / 2;
    for (const tankId of humanControllers.keys()) {
      const spawn = this.state.tanks[tankId]!;
      const facing = normaliseDegrees(
        (Math.atan2(-(centreX - spawn.x), -(centreZ - spawn.z)) * 180) / Math.PI,
      );
      spawn.hullYawDegrees = facing;
      spawn.turretYawDegrees = facing;
      spawn.aimPitchDegrees = 0;
    }

    for (const tank of this.state.tanks) {
      const human = humanControllers.get(tank.id);
      this.controllers.set(tank.id, human ?? this.createAI(tank));
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
    const team = this.state.teams.find((candidate) => candidate.id === this.playerTeamId);
    if (!team) throw new Error('teamSession: the player team is missing');
    return team.tanks;
  }

  get player(): TankRenderFrame {
    return this.requireCurrent(this.playerTankId);
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

  /** Exactly one simulation tick, outside the frame clock; online play paces ticks itself. */
  stepTick(): void {
    if (this.frozenState) {
      throw new Error('teamSession: stepTick on a frozen session');
    }
    if (this.state.status === 'active') {
      this.stepOnce();
    }
  }

  /**
   * Hands a human tank to the AI from the next tick on (an online player left). The AI
   * is built exactly as a starting AI of that slot, so every peer builds the same one.
   */
  handToAI(tankId: number): void {
    const tank = this.state.tanks[tankId];
    if (!tank) throw new Error(`teamSession: handToAI for unknown tank ${tankId}`);
    this.controllers.set(tankId, this.createAI(tank));
  }

  /** The tank in a slot; throws when the slot is not in this match. */
  tankInSlot(slot: TankSlot): Tank {
    return this.requireSlot(slot);
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
    stepMatch(this.state, collectControllerOrders(this.state, this.controllers, 'teamSession'));
    this.current = snapshotTanks(this.state);
  }

  private createAI(tank: Tank): Controller {
    const profile = this.profiles[tank.teamIndex];
    if (!profile) {
      throw new Error(`teamSession: no profile for team ${tank.teamId} slot ${tank.teamIndex}`);
    }
    return createTeamAIController(tank, profile, this.seed, TEAM_MODE_AIM_ERROR_SCALE);
  }

  private requireSlot(slot: TankSlot): Tank {
    const tank = this.state.tanks.find(
      (candidate) => candidate.teamId === slot.teamId && candidate.teamIndex === slot.teamIndex,
    );
    if (!tank) {
      throw new Error(`teamSession: no tank in team ${slot.teamId} slot ${slot.teamIndex}`);
    }
    return tank;
  }

  private requireCurrent(tankId: number): TankRenderFrame {
    const frame = this.current.get(tankId);
    if (!frame) {
      throw new Error(`teamSession: tank ${tankId} is missing from the current frame`);
    }
    return frame;
  }
}
