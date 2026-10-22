/**
 * A* navigation over the A1 passability grid, with a cached path invalidated by
 * `world.revision` or a changed goal CELL.
 *
 * The path is a sequence of CELL CENTRES. Because the tank's body is a circle, every
 * node is checked with the simulation's `isTankPositionFree` and the smoothed
 * shortcut samples the same query, so a shortcut cannot clip a wall corner.
 *
 * The optional `SpatialFrame` runs the search in a canonical D4 frame. A tank spawned
 * in a rotated or mirrored copy of the arena therefore sees the same canonical grid;
 * paths transform back exactly. This is the fairness seam: no spawn-specific A* tie
 * break and no random averaging.
 *
 * No diagonal moves: four-neighbour A* stays deterministic and the smoothing pass
 * supplies the diagonal shortcuts when the body is actually clear. The open set is a
 * small linear scan (a 24×24 arena has at most 576 nodes); no hidden ordering.
 */

import { CELL_SIZE_METRES, TANK_RADIUS_METRES, isTankPositionFree } from '../sim.ts';
import type { World } from '../world.ts';
import { AI_PATH_SAMPLE_METRES } from './constants.ts';
import {
  IDENTITY_FRAME,
  frameToWorld,
  worldToFrame,
  type SpatialFrame,
} from './spatial.ts';

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
  frame: SpatialFrame = IDENTITY_FRAME,
): readonly GridPoint[] | null {
  const raw = findCanonicalPath(world, startXMetres, startZMetres, goalXMetres, goalZMetres, frame);
  return raw ? canonicalPathToWorld(world, frame, raw) : null;
}

function findCanonicalPath(
  world: World,
  startXMetres: number,
  startZMetres: number,
  goalXMetres: number,
  goalZMetres: number,
  frame: SpatialFrame,
): readonly GridPoint[] | null {
  const start = cellForWorldPoint(world, frame, startXMetres, startZMetres);
  const goal = cellForWorldPoint(world, frame, goalXMetres, goalZMetres);
  if (!cellIsFreeForBody(world, start, frame) || !cellIsFreeForBody(world, goal, frame)) {
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
      if (closed.has(neighbour) || !cellIsFreeForBody(world, { x, z }, frame)) {
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

/** The nearest body-free cell centre to an arbitrary point. */
export function nearestBodyFreePoint(
  world: World,
  xMetres: number,
  zMetres: number,
  frame: SpatialFrame = IDENTITY_FRAME,
): { readonly x: number; readonly z: number } | null {
  const target = worldToFrame(world, frame, xMetres, zMetres);
  const start = cellForPoint(world, target.x, target.z);
  const visited = new Set<number>([indexOf(world, start.x, start.z)]);
  const queue: GridPoint[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (cellIsFreeForBody(world, current, frame)) {
      const point = frameToWorld(world, frame, centreX(current.x), centreZ(current.z));
      return { x: point.x, z: point.z };
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
  frame: SpatialFrame = IDENTITY_FRAME,
): { readonly x: number; readonly z: number } | null {
  const canonicalStart = worldToFrame(world, frame, startXMetres, startZMetres);
  const canonicalTarget = worldToFrame(world, frame, targetXMetres, targetZMetres);
  const start = cellForPoint(world, canonicalStart.x, canonicalStart.z);
  if (!cellIsFreeForBody(world, start, frame)) return null;
  const visited = new Set<number>([indexOf(world, start.x, start.z)]);
  const queue: GridPoint[] = [start];
  let best: GridPoint | null = null;
  let bestDistance = Infinity;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const centre = { x: centreX(current.x), z: centreZ(current.z) };
    const distance =
      (centre.x - canonicalTarget.x) ** 2 + (centre.z - canonicalTarget.z) ** 2;
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        best &&
        indexOf(world, current.x, current.z) < indexOf(world, best.x, best.z))
    ) {
      best = current;
      bestDistance = distance;
    }
    for (const step of NEIGHBOURS) {
      const x = current.x + step.x;
      const z = current.z + step.z;
      if (x < 0 || z < 0 || x >= world.columns || z >= world.rows) continue;
      const index = indexOf(world, x, z);
      if (visited.has(index) || !cellIsFreeForBody(world, { x, z }, frame)) continue;
      visited.add(index);
      queue.push({ x, z });
    }
  }
  if (!best) return null;
  const worldPoint = frameToWorld(world, frame, centreX(best.x), centreZ(best.z));
  return { x: worldPoint.x, z: worldPoint.z };
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
  private frame: SpatialFrame = IDENTITY_FRAME;

  /** Sets the canonical frame; changing it invalidates the cached path. */
  setFrame(frame: SpatialFrame): void {
    if (this.frame.reflected === frame.reflected && this.frame.turns === frame.turns) {
      return;
    }
    this.frame = frame;
    this.clear();
  }

  findPath(
    world: World,
    startXMetres: number,
    startZMetres: number,
    goalXMetres: number,
    goalZMetres: number,
    force = false,
  ): readonly GridPoint[] | null {
    const goal = cellForWorldPoint(world, this.frame, goalXMetres, goalZMetres);
    const goalKey = `${goal.x},${goal.z}`;
    if (!force && world.revision === this.cachedRevision && goalKey === this.cachedGoal) {
      return this.path;
    }
    this.computations += 1;
    this.cachedRevision = world.revision;
    this.cachedGoal = goalKey;
    const raw = findPath(
      world,
      startXMetres,
      startZMetres,
      goalXMetres,
      goalZMetres,
      this.frame,
    );
    this.path = raw ? smoothPath(world, raw, this.frame) : null;
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

  get spatialFrame(): SpatialFrame {
    return this.frame;
  }

  clear(): void {
    this.cachedRevision = -1;
    this.cachedGoal = '';
    this.path = null;
  }
}

/** Shortcut a cell-centre path with body-clear straight segments. */
export function smoothPath(
  world: World,
  path: readonly GridPoint[],
  frame: SpatialFrame = IDENTITY_FRAME,
): readonly GridPoint[] {
  if (path.length <= 2) {
    return path;
  }
  const canonical = path.map((point) => {
    const centre = frameToWorld(world, frame, centreX(point.x), centreZ(point.z));
    return cellForPoint(world, centre.x, centre.z);
  });
  const result: GridPoint[] = [canonical[0]!];
  let anchor = 0;
  while (anchor < canonical.length - 1) {
    let next = anchor + 1;
    for (let candidate = canonical.length - 1; candidate > anchor + 1; candidate -= 1) {
      if (bodyClearCanonicalLine(world, canonical[anchor]!, canonical[candidate]!, frame)) {
        next = candidate;
        break;
      }
    }
    result.push(canonical[next]!);
    anchor = next;
  }
  return canonicalPathToWorld(world, frame, result);
}

/** Sample the tank's circular footprint along a centre-to-centre segment. */
export function bodyClearLine(
  world: World,
  from: GridPoint,
  to: GridPoint,
  frame: SpatialFrame = IDENTITY_FRAME,
): boolean {
  const fromWorld = frameToWorld(world, frame, centreX(from.x), centreZ(from.z));
  const toWorld = frameToWorld(world, frame, centreX(to.x), centreZ(to.z));
  const fromCanonical = worldToFrame(world, frame, fromWorld.x, fromWorld.z);
  const toCanonical = worldToFrame(world, frame, toWorld.x, toWorld.z);
  const fromPoint = cellForPoint(world, fromCanonical.x, fromCanonical.z);
  const toPoint = cellForPoint(world, toCanonical.x, toCanonical.z);
  return bodyClearCanonicalLine(world, fromPoint, toPoint, frame);
}

function bodyClearCanonicalLine(
  world: World,
  from: GridPoint,
  to: GridPoint,
  frame: SpatialFrame,
): boolean {
  const fromX = centreX(from.x);
  const fromZ = centreZ(from.z);
  const toX = centreX(to.x);
  const toZ = centreZ(to.z);
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(distance / AI_PATH_SAMPLE_METRES));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const canonical = { x: fromX + (toX - fromX) * t, z: fromZ + (toZ - fromZ) * t };
    const worldPoint = frameToWorld(world, frame, canonical.x, canonical.z);
    if (!isTankPositionFree(world, worldPoint.x, worldPoint.z)) {
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

function cellForWorldPoint(
  world: World,
  frame: SpatialFrame,
  xMetres: number,
  zMetres: number,
): GridPoint {
  const point = worldToFrame(world, frame, xMetres, zMetres);
  return cellForPoint(world, point.x, point.z);
}

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

function cellIsFreeForBody(world: World, point: GridPoint, frame: SpatialFrame): boolean {
  const worldPoint = frameToWorld(world, frame, centreX(point.x), centreZ(point.z));
  const x = worldPoint.x;
  const z = worldPoint.z;
  const width = world.columns * CELL_SIZE_METRES;
  const height = world.rows * CELL_SIZE_METRES;
  // A cell centre exactly on the arena edge leaves the body touching the boundary with
  // zero margin. The AI prefers an interior lane; the simulation still owns the body.
  if (
    x <= TANK_RADIUS_METRES ||
    z <= TANK_RADIUS_METRES ||
    x >= width - TANK_RADIUS_METRES ||
    z >= height - TANK_RADIUS_METRES
  ) {
    return false;
  }
  return isTankPositionFree(world, x, z);
}

function canonicalPathToWorld(
  world: World,
  frame: SpatialFrame,
  canonical: readonly GridPoint[],
): readonly GridPoint[] {
  return canonical.map((point) => {
    const centre = frameToWorld(world, frame, centreX(point.x), centreZ(point.z));
    return cellForWorldCentre(world, centre.x, centre.z);
  });
}

function cellForWorldCentre(world: World, x: number, z: number): GridPoint {
  const cellX = Math.floor(x / CELL_SIZE_METRES);
  const cellZ = Math.floor(z / CELL_SIZE_METRES);
  if (cellX < 0 || cellZ < 0 || cellX >= world.columns || cellZ >= world.rows) {
    throw new Error(`navigation: canonical path left the ${world.columns}x${world.rows} grid`);
  }
  return { x: cellX, z: cellZ };
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
