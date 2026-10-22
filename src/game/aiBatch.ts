/**
 * The game-layer adapter between the authored arena and the pure AI batch runner.
 * It is the ONE place that turns spawn data into `BatchSetup`; the batch runner itself
 * stays in `src/core/ai/` and knows nothing about `ARENA` or the game layer.
 */

import { spawnCentreMetres, ARENA } from './levels/arena.ts';
import { validateLevel } from './levels/format.ts';
import type { BatchSetup } from '../core/ai.ts';

/** Validates the arena and returns one one-tank spawn per authored team. */
export function arenaBatchSetup(): BatchSetup {
  validateLevel(ARENA);
  return {
    level: ARENA.cells,
    spawns: ARENA.spawns.map((spawn) => {
      const centre = spawnCentreMetres(spawn);
      return {
        teamId: spawn.teamId,
        spawn: {
          xMetres: centre.xMetres,
          zMetres: centre.zMetres,
          hullYawDegrees: spawn.yawDegrees,
        },
      };
    }),
  };
}
