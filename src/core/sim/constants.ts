/**
 * The ONE tuning module for the simulation (`src/core/sim/`).
 *
 * World numbers (materials, heights, regen delays, mirror steps and the shared cell
 * size) stay in `src/core/world/constants.ts`; this file owns the combat layer's
 * numbers. The cell size is re-exported here so sim callers keep one import path, but
 * the ONE definition lives in the world module. A3b renders these values; it does not
 * invent its own.
 *
 * Units: metres, seconds, degrees, and whole simulation ticks. A tick IS
 * `STEP_SECONDS` (`src/core/timestep.ts`), so a speed in m/s becomes a per-tick move
 * by multiplying by that one constant. Angles are degrees; yaw 0 faces -z and positive
 * yaw turns towards -x (the convention `docs/ARCHITECTURE.md` records for the renderer).
 *
 * The values are vetoable defaults (`docs/DESIGN.md` §7), not design decisions.
 */

import { STEP_SECONDS } from '../timestep.ts';
import { CELL_SIZE_METRES } from '../world.ts';

/** Re-exported from `src/core/world/constants.ts`, the ONE cell-size definition. */
export { CELL_SIZE_METRES };

/** One tank's full health. Three shell hits kill (owner, §4). */
export const TANK_MAX_HP = 3;

/** Forward speed at full throttle, in metres per second. Reverse uses the same scale. */
export const TANK_SPEED_METRES_PER_SECOND = 6;

/** Hull turn rate at full steer, in degrees per second. Positive steer turns left. */
export const TANK_TURN_RATE_DEGREES_PER_SECOND = 60;

/** Turret yaw and pitch slew rate, in degrees per second. Independent of the hull. */
export const TURRET_RATE_DEGREES_PER_SECOND = 120;

/** Aim pitch: positive is UP from the horizon. */
export const AIM_PITCH_MIN_DEGREES = -30;
export const AIM_PITCH_MAX_DEGREES = 25;

/** Tank collision footprint. The simulation is not the renderer's 4 m hull model. */
export const TANK_RADIUS_METRES = 1;
export const TANK_HEIGHT_METRES = 1.5;
/** The height at which a cell counts as blocking a ground tank (floor is below it). */
export const TANK_COLLISION_HEIGHT_METRES = 0.8;

/** The gun's muzzle: 3 m forward of the hull origin at this height above the floor. */
export const MUZZLE_FORWARD_METRES = 3;
export const MUZZLE_HEIGHT_METRES = 1.1;

/** Ticks from one shot to the next. The first shot is available immediately. */
export const RELOAD_TICKS = 60;

/** Shell speed and the distance one tick advances it. */
export const SHELL_SPEED_METRES_PER_SECOND = 90;
export const SHELL_METRES_PER_TICK = SHELL_SPEED_METRES_PER_SECOND * STEP_SECONDS;
/** Range is the total path length, including a shard bounce. */
export const SHELL_RANGE_METRES = 120;
/** One shell removes one HP from a tank, a cell or a big block. */
export const SHELL_DAMAGE = 1;

/**
 * A shard is floor debris; it only intercepts a shell within this height above the
 * floor. A high shot flies over floor shards, a low/downward shot is deflected.
 */
export const SHARD_HIT_HEIGHT_METRES = 0.5;

/**
 * The lethal wound clock: a damaged tank loses 1 HP every this many ticks (15 s at
 * 60 Hz in B1b; the A3c default was 10 s). A healthy tank never bleeds. The first
 * wound starts the clock; later hits do not reset it.
 */
export const BLEED_INTERVAL_TICKS = 900;

/** The match cap: 5 minutes at 60 Hz. A batch run must terminate by construction. */
export const MATCH_TICK_CAP = 18000;

/** The design's limits: up to four teams of up to four tanks. */
export const MAX_TEAMS = 4;
export const MAX_TANKS_PER_TEAM = 4;

/** Per-match rules. Tests may shorten the cap/clock; the defaults live above. */
export interface MatchRules {
  /** End by HP/alive tie-break at this tick, if more than one team is still alive. */
  readonly tickCap: number;
  /** Ticks between clock damage on a wounded tank. */
  readonly bleedIntervalTicks: number;
}

/** The app's default rules. Read-only; a match never mutates its rules. */
export const DEFAULT_MATCH_RULES: MatchRules = Object.freeze({
  tickCap: MATCH_TICK_CAP,
  bleedIntervalTicks: BLEED_INTERVAL_TICKS,
});
