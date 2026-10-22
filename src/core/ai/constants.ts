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

/**
 * The AI's eye above the floor. The tank body is 1.5 m tall; a sightline from just
 * above the turret can see over the authored 1.2 m low cover (the muzzle alone, at
 * 1.1 m, cannot).
 */
export const AI_EYE_HEIGHT_METRES = TANK_HEIGHT_METRES + 0.1;

/** The aiming point on the target: the turret centre, 1.0 m above the floor. */
export const AI_TARGET_CENTRE_HEIGHT_METRES = 1.0;

/** How long a last-seen position survives; the package uses the profile's value. */
export const AI_MEMORY_TICKS = 180;

/** The default half-angle of the firing cone, in yaw and pitch. */
export const AI_FIRE_CONE_DEGREES = 8;

/** Metric sample for a body-clear shortcut; one twentieth of a cell. */
export const AI_PATH_SAMPLE_METRES = 0.1;

/** A path waypoint counts as reached inside this radius. */
export const AI_WAYPOINT_REACHED_METRES = 0.8;
