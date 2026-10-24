/**
 * The sim↔render bridge's stateful half: owns the MatchState, the one FixedStep and
 * the two transforms a frame needs (the state before the last tick and after it).
 *
 * This module is game layer, not render layer: no three.js, no DOM, no wall clock. It
 * runs in `node`, so the demo scenario and the interpolation are testable without a
 * browser.
 */

import { FixedStep } from '../core/timestep.ts';
import {
  DEFAULT_MATCH_RULES,
  createMatch,
  idleTankCommand,
  stepMatch,
  type MatchState,
  type Tank,
  type TankCommand,
  type TankCommandOrder,
} from '../core/sim.ts';
import { blastTerrain, type World } from '../core/world.ts';
import { getAIProfile } from '../core/ai.ts';
import { createTeamAIController } from '../core/ai/teamBatch.ts';
import { collectControllerOrders, type Controller } from '../core/sim/controller.ts';
import { TEAM_MODE_AIM_ERROR_SCALE } from './aiBatch.ts';
import {
  interpolateTanks,
  snapshotTanks,
  type TankRenderFrame,
} from './tankFrames.ts';

export type { TankRenderFrame } from './tankFrames.ts';
import { ARENA, ARENA_BASE_HEIGHT_METRES } from './levels/arena.ts';
import { validateLevel } from './levels/format.ts';

/**
 * The demo stage: the player on the NW pad's front slot looking down the diagonal at
 * a training target just past the NW ridge's arch, with a fresh crater in the ridge.
 */
const DEMO_PLAYER = { xMetres: 13.4, zMetres: 13.4, hullYawDegrees: -135 } as const;
const DEMO_DUMMY = { xMetres: 21, zMetres: 21, hullYawDegrees: 45 } as const;
const DEMO_CRATER = { x: 19.5, y: 8.5, z: 15.5 } as const;

export interface PlayableSessionOptions {
  /** Build the deterministic combat screenshot scenario: a demo breach and no input. */
  readonly demo?: boolean;
}

const PLAYER_TANK_ID = 0;
const DUMMY_TANK_ID = 1;
const LEVEL_SEED = 0xa3c_d0e1;

/** Carves the demo's visible crater through the real destruction seam. */
function carveDemoBreach(world: World): void {
  const result = blastTerrain(world, DEMO_CRATER.x, DEMO_CRATER.y, DEMO_CRATER.z);
  if (result.samplesDestroyed === 0) {
    throw new Error('session: the demo crater did not break any rock');
  }
}

function levelSpawn(teamId: number): { xMetres: number; zMetres: number; hullYawDegrees: number } {
  const spawn = ARENA.spawns.find((candidate) => candidate.teamId === teamId);
  if (!spawn) throw new Error(`session: arena has no spawn for team ${teamId}`);
  const slot = spawn.slots[0]!;
  return { xMetres: slot.xMetres, zMetres: slot.zMetres, hullYawDegrees: spawn.yawDegrees };
}

/**
 * Owns a playable match. `step` is called from `FixedStep`'s callback once per tick;
 * `advance` is the only place a frame delta becomes ticks.
 */
export class PlayableSession {
  readonly state: MatchState;
  readonly fixed: FixedStep;
  readonly playerTankId = PLAYER_TANK_ID;
  readonly dummyTankId = DUMMY_TANK_ID;

  /** The opponent's character name, for the HUD (the demo fixture has no character). */
  readonly opponentName: string;

  private previous: Map<number, TankRenderFrame>;
  private current: Map<number, TankRenderFrame>;
  private readonly controllers = new Map<number, Controller>();
  private demoFrozen = false;

  constructor(options: PlayableSessionOptions = {}) {
    validateLevel(ARENA);
    const demo = options.demo === true;
    // The playable 1v1 is a real duel: the opponent spawns in the OPPOSITE corner and is
    // driven by the same AI controller the team mode uses. The old fixture put a static
    // training target 6 m in front of the player, which read as an opponent "sitting right
    // next to me" and never fought. The demo keeps that fixture for deterministic screenshots.
    const opponentSpawn = demo ? DEMO_DUMMY : levelSpawn(2);
    this.state = createMatch({
      level: ARENA.terrain,
      teams: [
        { id: 0, tanks: [demo ? DEMO_PLAYER : levelSpawn(0)] },
        { id: 1, tanks: [opponentSpawn] },
      ],
      seed: LEVEL_SEED,
      rules: DEFAULT_MATCH_RULES,
    });
    if (demo) {
      carveDemoBreach(this.state.world);
    }
    this.opponentName = demo ? 'TRAINING' : getAIProfile('vanguard').name;
    if (!demo) {
      const opponent = this.state.tanks[DUMMY_TANK_ID];
      if (!opponent) {
        throw new Error('session: the opponent tank is missing');
      }
      this.controllers.set(
        DUMMY_TANK_ID,
        createTeamAIController(opponent, getAIProfile('vanguard'), LEVEL_SEED, TEAM_MODE_AIM_ERROR_SCALE),
      );
    }
    this.current = snapshotTanks(this.state);
    this.previous = snapshotTanks(this.state);
    this.fixed = new FixedStep();
  }

  get demo(): boolean {
    return this.demoFrozen;
  }

  get alpha(): number {
    return this.demoFrozen ? 1 : this.fixed.alpha;
  }

  get floorY(): number {
    return ARENA_BASE_HEIGHT_METRES;
  }

  get player(): TankRenderFrame {
    return this.requireCurrent(this.playerTankId);
  }

  get dummy(): TankRenderFrame {
    return this.requireCurrent(this.dummyTankId);
  }

  /**
   * One frame delta → zero or more simulation ticks. The command source is sampled per
   * tick, so a world aim point can be re-solved as the hull and targets move.
   */
  advance(
    frameSeconds: number,
    commandFor: (state: MatchState, player: Tank) => TankCommand,
  ): number {
    if (this.demoFrozen) {
      return 0;
    }
    return this.fixed.advance(frameSeconds, () => {
      if (this.state.status !== 'active') {
        return;
      }
      const player = this.state.tanks[this.playerTankId];
      if (!player) {
        throw new Error(`session: player tank ${this.playerTankId} is missing`);
      }
      this.step(commandFor(this.state, player));
    });
  }

  /** One simulation tick with the player's command; the opponent runs its AI controller. */
  step(playerCommand: TankCommand): void {
    if (this.state.status !== 'active') {
      return;
    }
    this.previous = this.current;
    if (this.controllers.size === 0) {
      // Demo fixture: the target is static, so there is no controller for it.
      const orders: TankCommandOrder[] = this.state.tanks
        .filter((tank) => tank.alive)
        .map((tank) => ({
          tankId: tank.id,
          command:
            tank.id === this.playerTankId
              ? playerCommand
              : idleTankCommand(tank.turretYawDegrees, tank.aimPitchDegrees),
        }));
      stepMatch(this.state, orders);
    } else {
      const controllers = new Map(this.controllers);
      controllers.set(this.playerTankId, { commandFor: () => playerCommand });
      stepMatch(this.state, collectControllerOrders(this.state, controllers, 'playSession'));
    }
    this.current = snapshotTanks(this.state);
  }

  /**
   * Runs the deterministic combat demo for exactly `ticks` ticks and freezes. The
   * player fires straight down the corridor under the one 285-tick reload; by tick 571
   * the dummy is at 1 HP, the demo wall is breached, and the third shell is in flight.
   * The win lands at tick 574.
   */
  runDemo(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(`session: demo ticks must be a non-negative integer, got ${ticks}`);
    }
    if (this.demoFrozen) {
      return;
    }
    for (let tick = 0; tick < ticks && this.state.status === 'active'; tick += 1) {
      const player = this.state.tanks[this.playerTankId];
      if (!player) {
        throw new Error(`session: player tank ${this.playerTankId} is missing`);
      }
      this.step({
        throttle: 0,
        steer: 0,
        aimYaw: player.turretYawDegrees,
        aimPitch: player.aimPitchDegrees,
        fire: true,
      });
    }
    this.demoFrozen = true;
    this.fixed.reset();
    this.previous = snapshotTanks(this.state);
  }

  interpolatedTanks(alpha: number): readonly TankRenderFrame[] {
    return interpolateTanks(this.previous, this.current, alpha);
  }

  private requireCurrent(tankId: number): TankRenderFrame {
    const frame = this.current.get(tankId);
    if (!frame) {
      throw new Error(`session: tank ${tankId} is missing from the current frame`);
    }
    return frame;
  }
}
