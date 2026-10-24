import { describe, expect, it } from 'vitest';
import { blastTerrain, boxTerrain, buildTerrain, createWorld, stepWorld, type World } from '../world.ts';
import { isTankPositionFree } from '../sim.ts';
import {
  NAV_MAX_LAYERS,
  NavigationCache,
  buildNavGraph,
  findPath,
  nodeNear,
  updateNavGraph,
} from './navigation.ts';
import { AI_NAV_REBUILD_TICKS } from './constants.ts';

const GROUND = 1.5;
const START = { x: 5, y: GROUND, z: 5 };
const GOAL = { x: 30, y: GROUND, z: 5 };

/** A wall across the whole field at x 15…18: east and west are cut off. */
function walledWorld(): World {
  return createWorld(boxTerrain(24, 24, GROUND, [{ minX: 15, maxX: 18, minZ: -3, maxZ: 40, topMetres: GROUND + 3 }]));
}

/** Blasts a tank-wide breach through the wall around z = 5. */
function breach(world: World): void {
  for (const z of [3, 5, 7]) {
    for (const y of [GROUND + 0.8, GROUND + 2.4]) blastTerrain(world, 16.5, y, z, 3, 900);
  }
}

describe('AI navigation', () => {
  it('routes through a fresh breach and closes the route once the wall regrows', () => {
    const world = walledWorld();
    const cache = new NavigationCache();
    expect(cache.findPath(world, 0, START, GOAL)).toBeNull();
    const before = world.revision;
    breach(world);
    expect(world.revision).toBeGreaterThan(before);
    const opened = cache.findPath(world, AI_NAV_REBUILD_TICKS, START, GOAL);
    expect(opened).not.toBeNull();

    // Regeneration is the real seam: run it until the authored wall is back.
    for (let tick = 0; tick < 4000; tick += 1) stepWorld(world, []);
    expect(cache.findPath(world, AI_NAV_REBUILD_TICKS * 2, START, GOAL)).toBeNull();
  });

  it('only recomputes for a new graph version or a new goal node', () => {
    const world = walledWorld();
    const cache = new NavigationCache();
    expect(cache.findPath(world, 0, START, GOAL)).toBeNull();
    const computations = cache.computationCount;
    cache.findPath(world, 1, { ...START, x: 7 }, GOAL);
    expect(cache.computationCount).toBe(computations);
    cache.findPath(world, 2, START, { ...GOAL, z: 12 });
    expect(cache.computationCount).toBe(computations + 1);
  });

  it('only rebuilds the graph after the refresh interval', () => {
    const world = walledWorld();
    expect(findPath(world, 0, START, GOAL)).toBeNull();
    breach(world);
    expect(findPath(world, AI_NAV_REBUILD_TICKS - 1, START, GOAL)).toBeNull();
    expect(findPath(world, AI_NAV_REBUILD_TICKS, START, GOAL)).not.toBeNull();
  });

  it('puts every waypoint where the tank can stand', () => {
    const world = walledWorld();
    breach(world);
    const path = findPath(world, 0, START, GOAL);
    expect(path).not.toBeNull();
    for (const point of path ?? []) {
      expect(isTankPositionFree(world, point.x, point.z, point.y + 0.5)).toBe(true);
    }
  });

  it('an incremental update matches a fresh build', () => {
    const world = walledWorld();
    const graph = buildNavGraph(world);
    breach(world);
    expect(updateNavGraph(world, graph)).toBe(true);
    const fresh = buildNavGraph(world);
    expect(Array.from(graph.nodeValid)).toEqual(Array.from(fresh.nodeValid));
    for (let n = 0; n < graph.nodeCount; n += 1) {
      if (!graph.nodeValid[n]) continue;
      expect(graph.nodeY[n]).toBeCloseTo(fresh.nodeY[n]!, 9);
      expect(graph.edgeTargets[n]).toEqual(fresh.edgeTargets[n]);
    }
  });

  it('stacks a tunnel floor and the ground above it in one column', () => {
    // A 6 m mesa with a 5 m-wide, 4 m-tall tunnel through it along x.
    const world = createWorld(
      buildTerrain({
        cellsX: 24,
        cellsY: 10,
        cellsZ: 24,
        sample: (x, y, z) => {
          const mesa = Math.min(x - 9, 27 - x, z - 9, 27 - z, GROUND + 6 - y);
          const tunnel = Math.min(2.5 - Math.abs(z - 18), y - GROUND, GROUND + 4 - y);
          return { solidity: Math.max(GROUND - y, Math.min(mesa, -tunnel)) };
        },
      }),
    );
    const graph = buildNavGraph(world);
    const inside = nodeNear(graph, 18, GROUND, 18);
    const top = nodeNear(graph, 18, GROUND + 6, 18);
    expect(inside).not.toBeNull();
    expect(top).not.toBeNull();
    expect(inside).not.toBe(top);
    expect(Math.floor(inside! / NAV_MAX_LAYERS)).toBe(Math.floor(top! / NAV_MAX_LAYERS));
    expect(graph.nodeY[inside!]).toBeCloseTo(GROUND, 0);
    expect(graph.nodeY[top!]).toBeCloseTo(GROUND + 6, 0);
  });
});
