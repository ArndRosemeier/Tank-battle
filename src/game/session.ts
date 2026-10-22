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
  DEMO_BREACH_CELLS,
  DUMMY_SPAWN,
  INITIAL_FLOOR_HOLES,
  PLAYABLE_FLOOR_Y,
  PLAYABLE_LEVEL,
  PLAYER_SPAWN,
} from './level.ts';

/** A tank transform after interpolation. The render layer maps this to a group. */
export interface TankRenderFrame {
  readonly id: number;
  readonly teamId: number;
  readonly x: number;
  readonly z: number;
  readonly hullYawDegrees: number;
  readonly turretYawDegrees: number;
  readonly aimPitchDegrees: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

export interface PlayableSessionOptions {
  /** Build the deterministic combat screenshot scenario: a demo breach and no input. */
  readonly demo?: boolean;
}

const PLAYER_TANK_ID = 0;
const DUMMY_TANK_ID = 1;
const LEVEL_SEED = 0xa3c_d0e1;

function snapshot(state: MatchState): Map<number, TankRenderFrame> {
  const frames = new Map<number, TankRenderFrame>();
  for (const tank of state.tanks) {
    frames.set(tank.id, {
      id: tank.id,
      teamId: tank.teamId,
      x: tank.x,
      z: tank.z,
      hullYawDegrees: tank.hullYawDegrees,
      turretYawDegrees: tank.turretYawDegrees,
      aimPitchDegrees: tank.aimPitchDegrees,
      hp: tank.hp,
      maxHp: tank.maxHp,
      alive: tank.alive,
    });
  }
  return frames;
}

function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function lerpAngle(from: number, to: number, alpha: number): number {
  return from + shortestAngleDelta(from, to) * alpha;
}

/** Carves the demo's visible wall breach through the real destruction seams. */
function carveDemoBreach(world: World): void {
  const rng = createRng(LEVEL_SEED);
  for (const cell of DEMO_BREACH_CELLS) {
    damageCell(world, cell.x, cell.z, 2, rng);
    if (!blockAt(world, cell.x, cell.z)) {
      throw new Error(`session: demo breach (${cell.x}, ${cell.z}) did not leave a block`);
    }
    damageBlock(world, cell.x, cell.z, 2);
  }
}

function carveInitialFloorHoles(world: World): void {
  const rng = createRng(LEVEL_SEED ^ 0x51ed);
  for (const cell of INITIAL_FLOOR_HOLES) {
    damageCell(world, cell.x, cell.z, 1, rng);
  }
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
    this.state = createMatch({
      level: PLAYABLE_LEVEL,
      teams: [
        { id: 0, tanks: [PLAYER_SPAWN] },
        { id: 1, tanks: [DUMMY_SPAWN] },
      ],
      seed: LEVEL_SEED,
      rules: DEFAULT_MATCH_RULES,
    });
    carveInitialFloorHoles(this.state.world);
    if (options.demo === true) {
      carveDemoBreach(this.state.world);
    }
    this.current = snapshot(this.state);
    this.previous = snapshot(this.state);
    this.fixed = new FixedStep();
  }

  get demo(): boolean {
    return this.demoFrozen;
  }

  get alpha(): number {
    return this.demoFrozen ? 1 : this.fixed.alpha;
  }

  get floorY(): number {
    return PLAYABLE_FLOOR_Y;
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
    this.current = snapshot(this.state);
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
    this.previous = snapshot(this.state);
  }

  interpolatedTanks(alpha: number): readonly TankRenderFrame[] {
    if (!Number.isFinite(alpha)) {
      throw new Error(`session: alpha must be finite, got ${alpha}`);
    }
    const t = Math.max(0, Math.min(1, alpha));
    const frames: TankRenderFrame[] = [];
    for (const current of this.current.values()) {
      const previous = this.previous.get(current.id) ?? current;
      frames.push({
        ...current,
        x: lerp(previous.x, current.x, t),
        z: lerp(previous.z, current.z, t),
        hullYawDegrees: lerpAngle(previous.hullYawDegrees, current.hullYawDegrees, t),
        turretYawDegrees: lerpAngle(previous.turretYawDegrees, current.turretYawDegrees, t),
        aimPitchDegrees: lerp(previous.aimPitchDegrees, current.aimPitchDegrees, t),
      });
    }
    // A stable id order keeps the view/dispose order independent of Map insertion.
    frames.sort((a, b) => a.id - b.id);
    return frames;
  }

  private requireCurrent(tankId: number): TankRenderFrame {
    const frame = this.current.get(tankId);
    if (!frame) {
      throw new Error(`session: tank ${tankId} is missing from the current frame`);
    }
    return frame;
  }
}
