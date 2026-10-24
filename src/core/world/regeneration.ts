/**
 * The world's own clock: falling chunks every tick, regeneration every
 * `REGEN_INTERVAL_TICKS`.
 *
 * Regeneration heals the authored landscape slowly. A sample below its target grows
 * only when a 6-neighbour was already solid at the start of the pass (the crater heals
 * from its walls inward; a hole in mid-air does not reappear out of nothing). A sample
 * above its target (rubble) erodes. No sample grows inside or right next to a tank, so
 * healing rock never traps one.
 */

import {
  DENSITY_ISO,
  REGEN_INTERVAL_TICKS,
  REGEN_STEP,
} from './constants.ts';
import {
  collapseTerrain,
  insideOccupant,
  stepChunks,
  type Crush,
  type DebrisEvent,
  type Occupant,
} from './destruction.ts';
import { writeSample, type World } from './field.ts';

export interface WorldStepResult {
  readonly debris: readonly DebrisEvent[];
  readonly crushes: readonly Crush[];
  /** Samples that regenerated past solid this tick (for a presentation cue). */
  readonly regrown: number;
}

/** Advances the world one tick. */
export function stepWorld(world: World, occupants: readonly Occupant[]): WorldStepResult {
  const chunkResult = stepChunks(world, occupants);
  const debris = [...chunkResult.debris];
  let regrown = 0;
  if (world.regenCountdown > 0) {
    world.regenCountdown -= 1;
  } else {
    world.regenCountdown = REGEN_INTERVAL_TICKS - 1;
    const pass = regenerate(world, occupants);
    regrown = pass.regrown;
    if (pass.eroded) {
      debris.push(...collapseTerrain(world));
    }
  }
  return { debris, crushes: chunkResult.crushes, regrown };
}

function regenerate(world: World, occupants: readonly Occupant[]): { regrown: number; eroded: boolean } {
  const { nx, ny, nz, density, target } = world;
  const s = world.spacing;
  const snapshot = density.slice();
  const strideI = ny;
  const strideK = ny * nx;
  let regrown = 0;
  let eroded = false;
  let changed = false;
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const base = ny * (i + nx * k);
      for (let j = 1; j < ny; j += 1) {
        const index = base + j;
        const current = snapshot[index]!;
        const goal = target[index]!;
        if (current === goal) continue;
        if (current < goal) {
          if (current < DENSITY_ISO) {
            const supported =
              snapshot[index - 1]! >= DENSITY_ISO ||
              (j + 1 < ny && snapshot[index + 1]! >= DENSITY_ISO) ||
              (i > 0 && snapshot[index - strideI]! >= DENSITY_ISO) ||
              (i + 1 < nx && snapshot[index + strideI]! >= DENSITY_ISO) ||
              (k > 0 && snapshot[index - strideK]! >= DENSITY_ISO) ||
              (k + 1 < nz && snapshot[index + strideK]! >= DENSITY_ISO);
            if (!supported) continue;
          }
          if (insideOccupant(i * s, j * s, k * s, s, occupants)) continue;
          const next = Math.min(goal, current + REGEN_STEP);
          writeSample(world, index, next, world.targetMaterial[index]!);
          if (current < DENSITY_ISO && next >= DENSITY_ISO) regrown += 1;
          changed = true;
        } else {
          const next = Math.max(goal, current - REGEN_STEP);
          writeSample(world, index, next, next <= goal ? world.targetMaterial[index]! : world.material[index]!);
          if (current >= DENSITY_ISO && next < DENSITY_ISO) eroded = true;
          changed = true;
        }
      }
    }
  }
  if (changed) world.revision += 1;
  return { regrown, eroded };
}
