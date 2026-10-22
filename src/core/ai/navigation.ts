/**
 * A* navigation over the A1 passability grid, with a cached path invalidated by
 * `world.revision` or a changed goal CELL.
 *
 * The path is a sequence of CELL CENTRES. Because the tank's body is a circle, every
 * node is checked with the simulation's `isTankPositionFree` and the smoothed
 * shortcut samples the same query, so a shortcut cannot clip a wall corner.
 *
 * No diagonal moves: four-neighbour A* stays deterministic and the smoothing pass
 * supplies the diagonal shortcuts when the body is actually clear. The open set is a
 * small linear scan (a 24×24 arena has at most 576 nodes); no hidden ordering.
 */

import { CELL_SIZE_METRES, TANK_RADIUS_METRES, isTankPositionFree } from '../sim.ts';
import type { World } from '../world.ts';
import { AI_PATH_SAMPLE_METRES } from './constants.ts';

export interface GridPoint {
  readonly x: number;
  readonly z: number;
}

/** The raw A* path from a start cell to a goal cell, or null when disconnected. */
export function findPath(
  world: World,
  startXMetres: number,
  startZMetres: number,
  goalXMetres: number,
  goalZMetres: number,
): readonly GridPoint[] | null {
  const start = cellForPoint(world, startXMetres, startZMetres);
  const goal = cellForPoint(world, goalXMetres, goalZMetres);
  if (!cellIsFreeForBody(world, start) || !cellIsFreeForBody(world, goal)) {
    return null;
  }
  if (start.x === goal.x && start.z === goal.z) {
    return [{ x: start.x, z: start.z }];
  }

  const startIndex = indexOf(world, start.x, start.z);
  const goalIndex = indexOf(world, goal.x, goal.z);
  const gScore = new Map<number, number>([[startIndex, 0]]);
  const cameFrom = new Map<number, number>();
  const open = new Set<number>([startIndex]);
  const closed = new Set<number>();

  while (open.size > 0) {
    let current = -1;
    let bestF = Infinity;
    let bestH = Infinity;
    for (const candidate of open) {
      const g = gScore.get(candidate) ?? Infinity;
      const x = candidate % world.columns;
      const z = Math.floor(candidate / world.columns);
      const h = Math.abs(x - goal.x) + Math.abs(z - goal.z);
      const f = g + h;
      if (
        f < bestF ||
        (f === bestF && h < bestH) ||
        (f === bestF && h === bestH && (current === -1 || candidate < current))
      ) {
        current = candidate;
        bestF = f;
        bestH = h;
      }
    }
    if (current === -1) {
      return null;
    }
    if (current === goalIndex) {
      return reconstruct(world, cameFrom, startIndex, goalIndex);
    }
    open.delete(current);
    closed.add(current);

    const currentX = current % world.columns;
    const currentZ = Math.floor(current / world.columns);
    for (const step of NEIGHBOURS) {
      const x = currentX + step.x;
      const z = currentZ + step.z;
      if (x < 0 || z < 0 || x >= world.columns || z >= world.rows) {
        continue;
      }
      const neighbour = indexOf(world, x, z);
      if (closed.has(neighbour) || !cellIsFreeForBody(world, { x, z })) {
        continue;
      }
      const tentative = (gScore.get(current) ?? Infinity) + 1;
      const existing = gScore.get(neighbour);
      if (existing !== undefined && tentative >= existing) {
        continue;
      }
      gScore.set(neighbour, tentative);
      cameFrom.set(neighbour, current);
      open.add(neighbour);
    }
  }
  return null;
}

/**
 * The nearest body-free cell centre to an arbitrary point. Used for the vanguard's
 * fallback patrol goal: the geometric centre of the arena can be occupied by the
 * central objective, and a path to a solid goal cell is not a path at all.
 */
export function nearestBodyFreePoint(
  world: World,
  xMetres: number,
  zMetres: number,
): { readonly x: number; readonly z: number } | null {
  const start = cellForPoint(world, xMetres, zMetres);
  const visited = new Set<number>([indexOf(world, start.x, start.z)]);
  const queue: GridPoint[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (cellIsFreeForBody(world, current)) {
      return { x: centreX(current.x), z: centreZ(current.z) };
    }
    for (const step of NEIGHBOURS) {
      const x = current.x + step.x;
      const z = current.z + step.z;
      if (x < 0 || z < 0 || x >= world.columns || z >= world.rows) continue;
      const index = indexOf(world, x, z);
      if (visited.has(index)) continue;
      visited.add(index);
      queue.push({ x, z });
    }
  }
  return null;
}

/**
 * The reachable body-free cell closest to a target point. The fallback patrol goal
 * must not be a free-looking cell in a sealed central pocket (the alignment of the
 * central pillars/low cover can create one), so this floods from the tank's start
 * first and only then ranks the component's cells against the target.
 */
export function reachablePointNear(
  world: World,
  startXMetres: number,
  startZMetres: number,
  targetXMetres: number,
  targetZMetres: number,
): { readonly x: number; readonly z: number } | null {
  const start = cellForPoint(world, startXMetres, startZMetres);
  if (!cellIsFreeForBody(world, start)) return null;
  const visited = new Set<number>([indexOf(world, start.x, start.z)]);
  const queue: GridPoint[] = [start];
  let best: GridPoint | null = null;
  let bestDistance = Infinity;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const centre = { x: centreX(current.x), z: centreZ(current.z) };
    const distance = (centre.x - targetXMetres) ** 2 + (centre.z - targetZMetres) ** 2;
    if (distance < bestDistance || (distance === bestDistance && best && indexOf(world, current.x, current.z) < indexOf(world, best.x, best.z))) {
      best = current;
      bestDistance = distance;
    }
    for (const step of NEIGHBOURS) {
      const x = current.x + step.x;
      const z = current.z + step.z;
      if (x < 0 || z < 0 || x >= world.columns || z >= world.rows) continue;
      const index = indexOf(world, x, z);
      if (visited.has(index) || !cellIsFreeForBody(world, { x, z })) continue;
      visited.add(index);
      queue.push({ x, z });
    }
  }
  return best ? { x: centreX(best.x), z: centreZ(best.z) } : null;
}

/**
 * The cached path seam. A new path is computed only when the world revision or the
 * goal cell changes; the start cell is deliberately not part of the cache key, because
 * a tank moving inside the same arena should keep following the same path.
 */
export class NavigationCache {
  private cachedRevision = -1;
  private cachedGoal = '';
  private path: readonly GridPoint[] | null = null;
  private computations = 0;

  findPath(
    world: World,
    startXMetres: number,
    startZMetres: number,
    goalXMetres: number,
    goalZMetres: number,
  ): readonly GridPoint[] | null {
    const goal = cellForPoint(world, goalXMetres, goalZMetres);
    const goalKey = `${goal.x},${goal.z}`;
    if (world.revision === this.cachedRevision && goalKey === this.cachedGoal) {
      return this.path;
    }
    this.computations += 1;
    this.cachedRevision = world.revision;
    this.cachedGoal = goalKey;
    const raw = findPath(world, startXMetres, startZMetres, goalXMetres, goalZMetres);
    this.path = raw ? smoothPath(world, raw) : null;
    return this.path;
  }

  /** How many real A* + smoothing runs this cache has performed (tests/diagnostics). */
  get computationCount(): number {
    return this.computations;
  }

  get pathRevision(): number {
    return this.cachedRevision;
  }

  get goalKey(): string {
    return this.cachedGoal;
  }

  clear(): void {
    this.cachedRevision = -1;
    this.cachedGoal = '';
    this.path = null;
  }
}

/** Shortcut a cell-centre path with body-clear straight segments. */
export function smoothPath(world: World, path: readonly GridPoint[]): readonly GridPoint[] {
  if (path.length <= 2) {
    return path;
  }
  const result: GridPoint[] = [path[0]!];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let next = anchor + 1;
    for (let candidate = path.length - 1; candidate > anchor + 1; candidate -= 1) {
      if (bodyClearLine(world, path[anchor]!, path[candidate]!)) {
        next = candidate;
        break;
      }
    }
    result.push(path[next]!);
    anchor = next;
  }
  return result;
}

/** Sample the tank's circular footprint along a centre-to-centre segment. */
export function bodyClearLine(world: World, from: GridPoint, to: GridPoint): boolean {
  const fromX = centreX(from.x);
  const fromZ = centreZ(from.z);
  const toX = centreX(to.x);
  const toZ = centreZ(to.z);
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(distance / AI_PATH_SAMPLE_METRES));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (!isTankPositionFree(world, fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t)) {
      return false;
    }
  }
  return true;
}

const NEIGHBOURS = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
] as const;

function cellForPoint(world: World, xMetres: number, zMetres: number): GridPoint {
  if (!Number.isFinite(xMetres) || !Number.isFinite(zMetres)) {
    throw new Error(`navigation: position must be finite, got (${xMetres}, ${zMetres})`);
  }
  const x = Math.floor(xMetres / CELL_SIZE_METRES);
  const z = Math.floor(zMetres / CELL_SIZE_METRES);
  if (x < 0 || z < 0 || x >= world.columns || z >= world.rows) {
    throw new Error(
      `navigation: position (${xMetres}, ${zMetres}) is outside the ${world.columns}x${world.rows} grid`,
    );
  }
  return { x, z };
}

function cellIsFreeForBody(world: World, point: GridPoint): boolean {
  const x = centreX(point.x);
  const z = centreZ(point.z);
  const width = world.columns * CELL_SIZE_METRES;
  const height = world.rows * CELL_SIZE_METRES;
  // A cell centre exactly on the arena edge leaves the body touching the boundary with
  // zero margin. The AI prefers an interior lane; the simulation still owns the body.
  if (x <= TANK_RADIUS_METRES || z <= TANK_RADIUS_METRES || x >= width - TANK_RADIUS_METRES || z >= height - TANK_RADIUS_METRES) {
    return false;
  }
  return isTankPositionFree(world, x, z);
}

function centreX(cellX: number): number {
  return (cellX + 0.5) * CELL_SIZE_METRES;
}

function centreZ(cellZ: number): number {
  return (cellZ + 0.5) * CELL_SIZE_METRES;
}

function indexOf(world: World, x: number, z: number): number {
  return z * world.columns + x;
}

function reconstruct(
  world: World,
  cameFrom: ReadonlyMap<number, number>,
  startIndex: number,
  goalIndex: number,
): readonly GridPoint[] {
  const reversed: GridPoint[] = [];
  let current = goalIndex;
  while (true) {
    reversed.push({ x: current % world.columns, z: Math.floor(current / world.columns) });
    if (current === startIndex) {
      break;
    }
    const parent = cameFrom.get(current);
    if (parent === undefined) {
      throw new Error('navigation: the A* parent chain is incomplete');
    }
    current = parent;
  }
  reversed.reverse();
  return reversed;
}
