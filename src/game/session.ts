/**
 * The sim↔render bridge's stateful half: owns the MatchState, the one FixedStep and
 * the two transforms a frame needs (the state before the last tick and after it).
 *
 * This module is game layer, not render layer: no three.js, no DOM, no wall clock. It
 * runs in `node`, so the demo scenario and the interpolation are testable without a
 * browser.
 */

import { createRng } from '../core/rng.ts';
import { FixedStep } from '../core/timestep.ts';
import {
  DEFAULT_MATCH_RULES,
  createMatch,
  idleTankCommand,
  stepMatch,
  type MatchState,
  type TankCommand,
  type TankCommandOrder,
} from '../core/sim.ts';
import {
  blockAt,
  damageBlock,
  damageCell,
  type World,
} from '../core/world.ts';
import { commandFromInput, type PlayerInput } from './input.ts';
import {
  interpolateTanks,
  snapshotTanks,
  type TankRenderFrame,
} from './tankFrames.ts';

export type { TankRenderFrame } from './tankFrames.ts';
import { ARENA, spawnCentreMetres } from './levels/arena.ts';
import { validateLevel } from './levels/format.ts';

/** The demo stage sits on the NW diagonal gates, with the ambush pillar opened. */
const DEMO_PLAYER = { xMetres: 12, zMetres: 12, hullYawDegrees: -135 } as const;
const DEMO_DUMMY = { xMetres: 18, zMetres: 18, hullYawDegrees: 45 } as const;
/** One-vs-dummy training starts the target close to the player's protected exit. */
const TRAINING_DUMMY = { xMetres: 12, zMetres: 6, hullYawDegrees: 90 } as const;
const DEMO_BREACH_CELL = { x: 7, z: 7 } as const;

export interface PlayableSessionOptions {
  /** Build the deterministic combat screenshot scenario: a demo breach and no input. */
  readonly demo?: boolean;
}

const PLAYER_TANK_ID = 0;
const DUMMY_TANK_ID = 1;
const LEVEL_SEED = 0xa3c_d0e1;

/** Opens the demo's visible ambush-pillar breach through the real destruction seams. */
function carveDemoBreach(world: World): void {
  const rng = createRng(LEVEL_SEED);
  damageCell(world, DEMO_BREACH_CELL.x, DEMO_BREACH_CELL.z, 3, rng);
  if (!blockAt(world, DEMO_BREACH_CELL.x, DEMO_BREACH_CELL.z)) {
    throw new Error(`session: demo breach (${DEMO_BREACH_CELL.x}, ${DEMO_BREACH_CELL.z}) did not leave a block`);
  }
  damageBlock(world, DEMO_BREACH_CELL.x, DEMO_BREACH_CELL.z, 2);
}

function levelSpawn(teamId: number): { xMetres: number; zMetres: number; hullYawDegrees: number } {
  const spawn = ARENA.spawns.find((candidate) => candidate.teamId === teamId);
  if (!spawn) throw new Error(`session: arena has no spawn for team ${teamId}`);
  const centre = spawnCentreMetres(spawn);
  return { ...centre, hullYawDegrees: spawn.yawDegrees };
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

  private previous: Map<number, TankRenderFrame>;
  private current: Map<number, TankRenderFrame>;
  private demoFrozen = false;

  constructor(options: PlayableSessionOptions = {}) {
    validateLevel(ARENA);
    const demo = options.demo === true;
    this.state = createMatch({
      level: ARENA.cells,
      teams: [
        { id: 0, tanks: [demo ? DEMO_PLAYER : levelSpawn(0)] },
        { id: 1, tanks: [demo ? DEMO_DUMMY : TRAINING_DUMMY] },
      ],
      seed: LEVEL_SEED,
      rules: DEFAULT_MATCH_RULES,
    });
    if (demo) {
      carveDemoBreach(this.state.world);
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
    return ARENA.cells.floorSurfaceHeightMetres;
  }

  get player(): TankRenderFrame {
    return this.requireCurrent(this.playerTankId);
  }

  get dummy(): TankRenderFrame {
    return this.requireCurrent(this.dummyTankId);
  }

  /** One frame delta → zero or more simulation ticks. Input is sampled per tick. */
  advance(frameSeconds: number, input: PlayerInput): number {
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
      const command = commandFromInput(input, player.hullYawDegrees);
      this.step(command);
    });
  }

  /** One simulation tick with the player's command; the dummy idles. */
  step(playerCommand: TankCommand): void {
    if (this.state.status !== 'active') {
      return;
    }
    this.previous = this.current;
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
    this.current = snapshotTanks(this.state);
  }

  /**
   * Runs the deterministic combat demo for exactly `ticks` ticks and freezes. The
   * player fires straight down the corridor; by tick 122 the dummy is at 1 HP, the
   * demo wall is breached, and the third shell is in flight.
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
