/**
 * The AI — the ONE public entrance to `src/core/ai/`.
 *
 * Renderer-free, DOM-free and clock-free like the rest of the core. A concrete pilot
 * implements the simulation's `Controller` seam; the profile data is validated at its
 * boundary; navigation and perception are testable pure functions over an A1 world.
 */

export * from './ai/constants.ts';
export * from './ai/perception.ts';
export * from './ai/navigation.ts';
export * from './ai/profile.ts';
export * from './ai/controller.ts';
export * from './ai/batch.ts';
export * from './ai/batchStats.ts';
export * from './ai/teamBatch.ts';
