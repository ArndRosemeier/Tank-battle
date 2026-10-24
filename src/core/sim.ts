/**
 * The simulation — the ONE public entrance to `src/core/sim/`.
 *
 * Everything below this file is renderer-free, DOM-free and clock-free: the same match
 * runs headless in `node`, in a browser frame loop (A3b) and in the future authoritative
 * server (§5.11). Import from here, not from the internal modules, so the seams stay
 * movable.
 *
 * Quick start:
 *
 *     const match = createMatch({ level, teams, seed, rules: DEFAULT_MATCH_RULES });
 *     stepMatch(match, [{ tankId: 0, command: { throttle: 1, steer: 0, aimYaw: 0,
 *                                             aimPitch: 0, fire: false } }]);
 *     hashMatch(match);
 */

export * from './sim/constants.ts';
export * from './sim/geometry.ts';
export * from './sim/commands.ts';
export * from './sim/stats.ts';
export * from './sim/match.ts';
export * from './sim/terrainBody.ts';
export * from './sim/step.ts';
export * from './sim/turnOrder.ts';
export * from './sim/hash.ts';
export * from './sim/controller.ts';
