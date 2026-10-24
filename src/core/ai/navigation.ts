/**
 * Navigation over the terrain: a layered graph and A*.
 *
 * Nodes: every lattice cell column is probed for STANDABLE surfaces — a ground surface
 * with headroom above it where the simulation itself (`standingPoseAt`) lets a tank
 * stand on a climbable slope. A column under the hill has two: the tunnel floor and the
 * hilltop; an open column has one. Edges join nodes in the eight neighbouring columns
 * when the height step is climbable and a tank fits at the midpoint.
 *
 * The graph is a pure function of the terrain. The AI shares one graph per world and
 * updates it where the terrain has changed (craters, collapses, regrowth), at most every
 * `AI_NAV_REBUILD_TICKS`, so a path never routes through a fresh hole for long. Node
 * slots are stable (`column · NAV_MAX_LAYERS + layer`), so an update rebuilds only the
 * changed columns. Every loop is ordered by node index, so the search is deterministic.
 */

import {
  TANK_HEIGHT_METRES,
  TANK_MAX_SLOPE_DEGREES,
  standingPoseAt,
} from '../sim.ts';
import { columnSurfaces, groundBelow, isSolidAt, type World } from '../world.ts';
import { AI_NAV_REBUILD_TICKS } from './constants.ts';

export interface NavPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface NavGraph {
  /** Bumped on every update that changed nodes or edges. */
  version: number;
  readonly columns: number;
  readonly rows: number;
  readonly spacing: number;
  /** Node slots: `column · NAV_MAX_LAYERS + layer`. Only `nodeValid` slots exist. */
  readonly nodeCount: number;
  readonly nodeValid: Uint8Array;
  readonly nodeX: Float64Array;
  readonly nodeY: Float64Array;
  readonly nodeZ: Float64Array;
  /** Outgoing edges per node slot, sorted by target. */
  readonly edgeTargets: number[][];
  readonly edgeCosts: number[][];
  /** The terrain revisions this graph reflects. */
  worldRevision: number;
  readonly blockRevisions: Uint32Array;
}

/** At most this many stacked standable surfaces per column (ground, tunnel, ledge, top). */
export const NAV_MAX_LAYERS = 4;
/** Air above a standable surface: the body plus a little clearance. */
const NAV_HEADROOM_METRES = TANK_HEIGHT_METRES + 0.3;
const MAX_SLOPE_TAN = Math.tan((TANK_MAX_SLOPE_DEGREES * Math.PI) / 180);
/** How far above a surface the standing probe starts (covers a 40° rise over 1 m). */
const PROBE_LIFT_METRES = 1.0;
/** Uphill metres cost this much extra: the planner prefers going around a hill. */
const CLIMB_COST = 1.5;

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** Builds the graph for the world as it is now. */
export function buildNavGraph(world: World): NavGraph {
  const columns = world.nx - 1;
  const rows = world.nz - 1;
  const slots = columns * rows * NAV_MAX_LAYERS;
  const graph: NavGraph = {
    version: 0,
    columns,
    rows,
    spacing: world.spacing,
    nodeCount: slots,
    nodeValid: new Uint8Array(slots),
    nodeX: new Float64Array(slots),
    nodeY: new Float64Array(slots),
    nodeZ: new Float64Array(slots),
    edgeTargets: Array.from({ length: slots }, () => []),
    edgeCosts: Array.from({ length: slots }, () => []),
    worldRevision: world.revision,
    blockRevisions: world.blockRevisions.slice(),
  };
  const all: number[] = [];
  for (let c = 0; c < columns * rows; c += 1) all.push(c);
  for (const c of all) buildColumnNodes(world, graph, c);
  for (const c of all) buildColumnEdges(world, graph, c);
  return graph;
}

/**
 * Brings the graph up to date with the terrain, rebuilding only the columns whose
 * render blocks changed (plus a margin for the probes) and the edges around them.
 * Returns true when anything was rebuilt.
 */
export function updateNavGraph(world: World, graph: NavGraph): boolean {
  if (graph.worldRevision === world.revision) return false;
  graph.worldRevision = world.revision;
  const blockCells = Math.ceil((world.nx - 1) / world.blocksX);
  const dirty = new Uint8Array(graph.columns * graph.rows);
  let any = false;
  for (let bz = 0; bz < world.blocksZ; bz += 1) {
    for (let bx = 0; bx < world.blocksX; bx += 1) {
      let changed = false;
      for (let by = 0; by < world.blocksY; by += 1) {
        const index = bx + world.blocksX * (by + world.blocksY * bz);
        if (world.blockRevisions[index] !== graph.blockRevisions[index]) {
          graph.blockRevisions[index] = world.blockRevisions[index]!;
          changed = true;
        }
      }
      if (!changed) continue;
      any = true;
      // The block's cells, widened by one column for the hull probes.
      const minC = Math.max(0, bx * blockCells - 1);
      const maxC = Math.min(graph.columns - 1, (bx + 1) * blockCells);
      const minR = Math.max(0, bz * blockCells - 1);
      const maxR = Math.min(graph.rows - 1, (bz + 1) * blockCells);
      for (let row = minR; row <= maxR; row += 1) {
        for (let column = minC; column <= maxC; column += 1) dirty[column + graph.columns * row] = 1;
      }
    }
  }
  if (!any) return false;
  const nodesChanged: number[] = [];
  for (let c = 0; c < dirty.length; c += 1) if (dirty[c]) nodesChanged.push(c);
  for (const c of nodesChanged) buildColumnNodes(world, graph, c);
  // Edges of the rebuilt columns and of their neighbours (which point into them).
  const edgeColumns = new Uint8Array(dirty.length);
  for (const c of nodesChanged) {
    const column = c % graph.columns;
    const row = (c - column) / graph.columns;
    edgeColumns[c] = 1;
    for (const [dx, dz] of NEIGHBOURS) {
      const nc = column + dx;
      const nr = row + dz;
      if (nc < 0 || nr < 0 || nc >= graph.columns || nr >= graph.rows) continue;
      edgeColumns[nc + graph.columns * nr] = 1;
    }
  }
  for (let c = 0; c < edgeColumns.length; c += 1) if (edgeColumns[c]) buildColumnEdges(world, graph, c);
  graph.version += 1;
  return true;
}

function buildColumnNodes(world: World, graph: NavGraph, c: number): void {
  const column = c % graph.columns;
  const row = (c - column) / graph.columns;
  const s = graph.spacing;
  const x = (column + 0.5) * s;
  const z = (row + 0.5) * s;
  const base = c * NAV_MAX_LAYERS;
  for (let layer = 0; layer < NAV_MAX_LAYERS; layer += 1) graph.nodeValid[base + layer] = 0;
  let layer = 0;
  let lastY = -Infinity;
  for (const surface of columnSurfaces(world, x, z, NAV_HEADROOM_METRES)) {
    if (layer >= NAV_MAX_LAYERS) break;
    // Probe from above the steepest climbable rise over the probe reach, so a node on
    // a hillside is found; a cave ceiling is far higher than this.
    const pose = standingPoseAt(world, x, z, 0, surface + PROBE_LIFT_METRES);
    if (!pose || pose.y < surface - 0.3 || pose.y > surface + PROBE_LIFT_METRES - 0.05) continue;
    if (Math.abs(pose.pitchDegrees) > TANK_MAX_SLOPE_DEGREES || Math.abs(pose.rollDegrees) > TANK_MAX_SLOPE_DEGREES) continue;
    if (pose.y - lastY < NAV_HEADROOM_METRES) continue;
    const node = base + layer;
    graph.nodeValid[node] = 1;
    graph.nodeX[node] = x;
    graph.nodeY[node] = pose.y;
    graph.nodeZ[node] = z;
    lastY = pose.y;
    layer += 1;
  }
}

function buildColumnEdges(world: World, graph: NavGraph, c: number): void {
  const column = c % graph.columns;
  const row = (c - column) / graph.columns;
  const s = graph.spacing;
  for (let layer = 0; layer < NAV_MAX_LAYERS; layer += 1) {
    const a = c * NAV_MAX_LAYERS + layer;
    const targets: { target: number; cost: number }[] = [];
    if (graph.nodeValid[a]) {
      const ya = graph.nodeY[a]!;
      for (const [dx, dz] of NEIGHBOURS) {
        const nc = column + dx;
        const nr = row + dz;
        if (nc < 0 || nr < 0 || nc >= graph.columns || nr >= graph.rows) continue;
        const other = nc + graph.columns * nr;
        const run = Math.hypot(dx, dz) * s;
        for (let otherLayer = 0; otherLayer < NAV_MAX_LAYERS; otherLayer += 1) {
          const b = other * NAV_MAX_LAYERS + otherLayer;
          if (!graph.nodeValid[b]) continue;
          const yb = graph.nodeY[b]!;
          const rise = yb - ya;
          if (Math.abs(rise) > run * MAX_SLOPE_TAN * 0.95) continue;
          if (dx !== 0 && dz !== 0 && !(sideOpen(graph, column + dx, row, ya, yb) && sideOpen(graph, column, row + dz, ya, yb))) continue;
          const high = Math.max(ya, yb);
          const low = Math.min(ya, yb);
          const midX = (graph.nodeX[a]! + graph.nodeX[b]!) / 2;
          const midZ = (graph.nodeZ[a]! + graph.nodeZ[b]!) / 2;
          // The midpoint: ground between the two heights and room for the hull.
          const midGround = groundBelow(world, midX, midZ, high + PROBE_LIFT_METRES);
          if (midGround < low - 0.5 || midGround > high + 0.5) continue;
          if (isSolidAt(world, midX, midGround + 0.8, midZ) || isSolidAt(world, midX, midGround + 1.4, midZ)) continue;
          targets.push({ target: b, cost: run + Math.max(0, rise) * CLIMB_COST });
        }
      }
    }
    targets.sort((p, q) => p.target - q.target);
    graph.edgeTargets[a] = targets.map((edge) => edge.target);
    graph.edgeCosts[a] = targets.map((edge) => edge.cost);
  }
}

/** A diagonal step needs a node at a similar height in both side columns (no corner cutting). */
function sideOpen(graph: NavGraph, column: number, row: number, ya: number, yb: number): boolean {
  const low = Math.min(ya, yb) - 1.2;
  const high = Math.max(ya, yb) + 1.2;
  const base = (column + graph.columns * row) * NAV_MAX_LAYERS;
  for (let layer = 0; layer < NAV_MAX_LAYERS; layer += 1) {
    const n = base + layer;
    if (graph.nodeValid[n] && graph.nodeY[n]! >= low && graph.nodeY[n]! <= high) return true;
  }
  return false;
}

/**
 * The node a point stands on: in its own column, the highest node not more than a
 * metre above the point; otherwise the nearest node within two columns. Null when
 * there is none.
 */
export function nodeNear(graph: NavGraph, x: number, y: number, z: number): number | null {
  const column = Math.floor(x / graph.spacing);
  const row = Math.floor(z / graph.spacing);
  if (column >= 0 && row >= 0 && column < graph.columns && row < graph.rows) {
    const base = (column + graph.columns * row) * NAV_MAX_LAYERS;
    let best = -1;
    for (let n = base; n < base + NAV_MAX_LAYERS; n += 1) {
      if (graph.nodeValid[n] && graph.nodeY[n]! <= y + 1) best = n;
    }
    if (best >= 0) return best;
  }
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      const nc = column + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= graph.columns || nr >= graph.rows) continue;
      const base = (nc + graph.columns * nr) * NAV_MAX_LAYERS;
      for (let n = base; n < base + NAV_MAX_LAYERS; n += 1) {
        if (!graph.nodeValid[n]) continue;
        const distance = Math.hypot(graph.nodeX[n]! - x, (graph.nodeY[n]! - y) * 2, graph.nodeZ[n]! - z);
        if (distance < bestDistance) {
          best = n;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

export function nodePoint(graph: NavGraph, node: number): NavPoint {
  return { x: graph.nodeX[node]!, y: graph.nodeY[node]!, z: graph.nodeZ[node]! };
}

/** Every node reachable from `start` (1 = reached). */
export function reachableFrom(graph: NavGraph, start: number): Uint8Array {
  const reached = new Uint8Array(graph.nodeCount);
  const queue = new Int32Array(graph.nodeCount);
  let head = 0;
  let tail = 0;
  reached[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const node = queue[head++]!;
    for (const next of graph.edgeTargets[node]!) {
      if (reached[next] === 0) {
        reached[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return reached;
}

/** A* from node to node. Returns the node sequence, or null when disconnected. */
export function findNodePath(graph: NavGraph, start: number, goal: number): number[] | null {
  if (start === goal) return [start];
  const count = graph.nodeCount;
  const g = new Float64Array(count).fill(Infinity);
  const parent = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const heap = new MinHeap();
  const gx = graph.nodeX[goal]!;
  const gy = graph.nodeY[goal]!;
  const gz = graph.nodeZ[goal]!;
  const heuristic = (n: number): number => Math.hypot(graph.nodeX[n]! - gx, graph.nodeZ[n]! - gz) + Math.max(0, gy - graph.nodeY[n]!) * CLIMB_COST * 0.5;
  g[start] = 0;
  heap.push(heuristic(start), start);
  while (heap.size > 0) {
    const node = heap.pop();
    if (closed[node]) continue;
    if (node === goal) {
      const path: number[] = [];
      for (let n = goal; n !== -1; n = parent[n]!) path.push(n);
      return path.reverse();
    }
    closed[node] = 1;
    const targets = graph.edgeTargets[node]!;
    const costs = graph.edgeCosts[node]!;
    for (let e = 0; e < targets.length; e += 1) {
      const next = targets[e]!;
      if (closed[next]) continue;
      const tentative = g[node]! + costs[e]!;
      if (tentative < g[next]! - 1e-9) {
        g[next] = tentative;
        parent[next] = node;
        heap.push(tentative + heuristic(next), next);
      }
    }
  }
  return null;
}

/** A binary min-heap of (priority, node) with node index as the deterministic tie-break. */
class MinHeap {
  private readonly priorities: number[] = [];
  private readonly nodes: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(priority: number, node: number): void {
    this.priorities.push(priority);
    this.nodes.push(node);
    let index = this.nodes.length - 1;
    while (index > 0) {
      const up = (index - 1) >> 1;
      if (!this.less(index, up)) break;
      this.swap(index, up);
      index = up;
    }
  }

  pop(): number {
    const top = this.nodes[0]!;
    const lastPriority = this.priorities.pop()!;
    const lastNode = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.priorities[0] = lastPriority;
      this.nodes[0] = lastNode;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.nodes.length && this.less(left, smallest)) smallest = left;
        if (right < this.nodes.length && this.less(right, smallest)) smallest = right;
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const pa = this.priorities[a]!;
    const pb = this.priorities[b]!;
    return pa < pb - 1e-12 || (Math.abs(pa - pb) <= 1e-12 && this.nodes[a]! < this.nodes[b]!);
  }

  private swap(a: number, b: number): void {
    const p = this.priorities[a]!;
    this.priorities[a] = this.priorities[b]!;
    this.priorities[b] = p;
    const n = this.nodes[a]!;
    this.nodes[a] = this.nodes[b]!;
    this.nodes[b] = n;
  }
}

interface SharedGraph {
  readonly graph: NavGraph;
  lastUpdateTick: number;
}
const sharedGraphs = new WeakMap<World, SharedGraph>();

/**
 * The world's shared navigation graph. Updated (only where the terrain changed) at most
 * every `AI_NAV_REBUILD_TICKS`; every AI in a match sees the same one.
 */
export function navGraphFor(world: World, tick: number): NavGraph {
  let shared = sharedGraphs.get(world);
  if (!shared) {
    shared = { graph: buildNavGraph(world), lastUpdateTick: tick };
    sharedGraphs.set(world, shared);
    return shared.graph;
  }
  if (shared.graph.worldRevision !== world.revision && tick - shared.lastUpdateTick >= AI_NAV_REBUILD_TICKS) {
    updateNavGraph(world, shared.graph);
    shared.lastUpdateTick = tick;
  }
  return shared.graph;
}

/** A path as world points, start excluded. */
export function findPath(world: World, tick: number, from: NavPoint, to: NavPoint): readonly NavPoint[] | null {
  const graph = navGraphFor(world, tick);
  const start = nodeNear(graph, from.x, from.y, from.z);
  const goal = nodeNear(graph, to.x, to.y, to.z);
  if (start === null || goal === null) return null;
  const nodes = findNodePath(graph, start, goal);
  return nodes ? nodes.slice(1).map((node) => nodePoint(graph, node)) : null;
}

/**
 * The reachable node closest (horizontally) to a target point: a goal on a sealed
 * ledge or inside rock becomes the nearest place the tank can actually get to.
 */
export function reachablePointNear(world: World, tick: number, from: NavPoint, target: { x: number; z: number }): NavPoint | null {
  const graph = navGraphFor(world, tick);
  const start = nodeNear(graph, from.x, from.y, from.z);
  if (start === null) return null;
  const reached = reachableFrom(graph, start);
  let best = -1;
  let bestDistance = Infinity;
  for (let n = 0; n < graph.nodeCount; n += 1) {
    if (!reached[n]) continue;
    const distance = (graph.nodeX[n]! - target.x) ** 2 + (graph.nodeZ[n]! - target.z) ** 2;
    if (distance < bestDistance - 1e-9) {
      best = n;
      bestDistance = distance;
    }
  }
  return best >= 0 ? nodePoint(graph, best) : null;
}

/**
 * The cached path seam. A new path is computed only when the graph was rebuilt or the
 * goal node changed (or the caller forces it, e.g. when stuck); the start is
 * deliberately not part of the key, so a tank keeps following the same path.
 */
export class NavigationCache {
  private cachedGraph: NavGraph | null = null;
  private cachedVersion = -1;
  private cachedGoal = -1;
  private path: readonly NavPoint[] | null = null;
  private computations = 0;

  findPath(world: World, tick: number, from: NavPoint, to: NavPoint, force = false): readonly NavPoint[] | null {
    const graph = navGraphFor(world, tick);
    const goal = nodeNear(graph, to.x, to.y, to.z);
    if (!force && graph === this.cachedGraph && graph.version === this.cachedVersion && goal === this.cachedGoal) {
      return this.path;
    }
    this.computations += 1;
    this.cachedGraph = graph;
    this.cachedVersion = graph.version;
    this.cachedGoal = goal ?? -1;
    const start = nodeNear(graph, from.x, from.y, from.z);
    if (start === null || goal === null) {
      this.path = null;
      return null;
    }
    const nodes = findNodePath(graph, start, goal);
    this.path = nodes ? nodes.slice(1).map((node) => nodePoint(graph, node)) : null;
    return this.path;
  }

  /** How many real A* runs this cache has performed (tests/diagnostics). */
  get computationCount(): number {
    return this.computations;
  }

  get pathRevision(): number {
    return this.cachedVersion;
  }

  get goalKey(): string {
    return String(this.cachedGoal);
  }

  clear(): void {
    this.cachedGraph = null;
    this.cachedVersion = -1;
    this.cachedGoal = -1;
    this.path = null;
  }
}
