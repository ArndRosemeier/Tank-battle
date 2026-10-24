/**
 * The AI tuning constants. They are data, not policy: a profile can override the
 * range/cone/memory, while the eye height, decision cadence and body-clearance sample
 * are properties of the perception/navigation machinery itself.
 *
 * Units match the simulation: metres, degrees and whole 60 Hz ticks.
 */

import { TANK_HEIGHT_METRES } from '../sim.ts';

/** A decision every six ticks: 10 Hz against the 60 Hz simulation. */
export const AI_DECISION_INTERVAL_TICKS = 6;

/** Ticks of lateral movement after a shot or a hit. */
export const AI_DODGE_TICKS = 60;

/** Seeded aim spread: base plus range-scaled, in degrees. */
export const AI_AIM_ERROR_BASE_DEGREES = 10.0;
export const AI_AIM_ERROR_PER_METRE = 1.8;

/**
 * The AI's eye above its hull origin. The tank body is 1.5 m tall; a sightline from
 * just above the turret can see over a low crest the muzzle alone (1.1 m) cannot.
 */
export const AI_EYE_HEIGHT_METRES = TANK_HEIGHT_METRES + 0.1;

/** The aiming point on the target: the turret centre, 1.0 m above its hull origin. */
export const AI_TARGET_CENTRE_HEIGHT_METRES = 1.0;

/** How long a last-seen position survives; the package uses the profile's value. */
export const AI_MEMORY_TICKS = 180;

/** The default half-angle of the firing cone, in yaw and pitch. */
export const AI_FIRE_CONE_DEGREES = 8;

/** A path waypoint counts as reached inside this horizontal radius. */
export const AI_WAYPOINT_REACHED_METRES = 2.0;

/** The shared navigation graph is rebuilt after terrain changes at most this often. */
export const AI_NAV_REBUILD_TICKS = 60;

/** A patrol leg goes at least this far, so a tank with no enemy in sight sweeps the arena. */
export const AI_PATROL_MIN_METRES = 20;
/** A patrol leg is abandoned for a new one after this many ticks (stuck, or a long detour). */
export const AI_PATROL_LEG_TICKS = 720;
/** Close enough to a patrol point to pick the next. */
export const AI_PATROL_ARRIVED_METRES = 3;
/** How far along its path a tank looks for the waypoint to steer at (> its turning radius). */
export const AI_PATH_LOOKAHEAD_METRES = 5;
