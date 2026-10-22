import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.ts';
import { createWorld, damageBlock, damageCell, stepWorld } from '../world.ts';
import { isTankPositionFree } from '../sim.ts';
import { NavigationCache, findPath, bodyClearLine } from './navigation.ts';

const FLOOR = 0.2;

function walledWorld() {
  const placements = [];
  for (let z = 0; z < 16; z += 1) {
    placements.push({ x: 8, z, material: 'wall' as const, heightMetres: 3 });
  }
  return createWorld({ columns: 16, rows: 16, floorSurfaceHeightMetres: FLOOR, placements });
}

describe('AI navigation', () => {
  it('invalidates a cached path when a wall is destroyed and routes again', () => {
    const world = walledWorld();
    const cache = new NavigationCache();
    const start = { x: 5, z: 5 };
    const goal = { x: 27, z: 5 };
    expect(cache.findPath(world, start.x, start.z, goal.x, goal.z)).toBeNull();
    const before = world.revision;
    const rng = createRng(7);
    damageCell(world, 8, 2, 2, rng);
    damageBlock(world, 8, 2, 2);
    expect(world.revision).toBeGreaterThan(before);
    const opened = cache.findPath(world, start.x, start.z, goal.x, goal.z);
    expect(opened).not.toBeNull();

    // A healed wall closes the same route again; regeneration is the real seam.
    stepWorld(world, 1200, []);
    expect(cache.findPath(world, start.x, start.z, goal.x, goal.z)).toBeNull();
  });

  it('only recomputes for a new revision or a new goal cell', () => {
    const world = walledWorld();
    const cache = new NavigationCache();
    expect(cache.findPath(world, 5, 5, 27, 5)).toBeNull();
    const computations = cache.computationCount;
    cache.findPath(world, 7, 5, 27, 5);
    expect(cache.computationCount).toBe(computations);
    cache.findPath(world, 5, 5, 27, 9);
    expect(cache.computationCount).toBe(computations + 1);
  });

  it('keeps the body clear of walls on every smoothed waypoint', () => {
    const world = walledWorld();
    const rng = createRng(7);
    damageCell(world, 8, 2, 2, rng);
    damageBlock(world, 8, 2, 2);
    const path = findPath(world, 5, 5, 27, 5);
    expect(path).not.toBeNull();
    for (const point of path ?? []) {
      expect(isTankPositionFree(world, (point.x + 0.5) * 2, (point.z + 0.5) * 2)).toBe(true);
    }
    for (let index = 1; index < (path?.length ?? 0); index += 1) {
      expect(bodyClearLine(world, path![index - 1]!, path![index]!)).toBe(true);
    }
  });
});
