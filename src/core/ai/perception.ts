/**
 * The AI's eyes: a height-aware 3D sightline through the A1 cells and big blocks,
 * plus a short per-enemy memory of the last seen position.
 *
 * This is deliberately NOT the shell resolver. A shell is a moving collision query
 * with shards, tanks and a swept muzzle; perception only asks whether a straight
 * sightline reaches the target centre and is allowed to use the same height rules.
 */

import { CELL_SIZE_METRES, type MatchState, type Tank, type Vec3 } from '../sim.ts';
import { isSolidAt, type World } from '../world.ts';
import {
  AI_EYE_HEIGHT_METRES,
  AI_MEMORY_TICKS,
  AI_PATH_SAMPLE_METRES,
  AI_TARGET_CENTRE_HEIGHT_METRES,
} from './constants.ts';

/** The centre of a tank's body, the point the AI tries to see and hit. */
export function targetCentre(world: World, tank: Tank): Vec3 {
  return {
    x: tank.x,
    y: world.floorSurfaceHeightMetres + AI_TARGET_CENTRE_HEIGHT_METRES,
    z: tank.z,
  };
}

/** The eye, just above the turret roof. */
export function eyePosition(world: World, tank: Tank): Vec3 {
  return {
    x: tank.x,
    y: world.floorSurfaceHeightMetres + AI_EYE_HEIGHT_METRES,
    z: tank.z,
  };
}

/**
 * True when the straight segment from `from` to `to` touches no solid cell or big
 * block at the height it is at. Sampling at 10 cm catches cell faces without inventing
 * a second collision model; a low wall only blocks the parts of the line below its top.
 */
export function hasLineOfSight(world: World, from: Vec3, to: Vec3): boolean {
  requirePoint(from, 'from');
  requirePoint(to, 'to');
  const horizontal = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(horizontal / AI_PATH_SAMPLE_METRES));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (x < 0 || z < 0 || x >= world.columns * CELL_SIZE_METRES || z >= world.rows * CELL_SIZE_METRES) {
      return false;
    }
    const cellX = Math.floor(x / CELL_SIZE_METRES);
    const cellZ = Math.floor(z / CELL_SIZE_METRES);
    if (isSolidAt(world, cellX, cellZ, y)) {
      return false;
    }
  }
  return true;
}

/** Every live enemy of `tank` with a clear eye-to-centre sightline, nearest first. */
export function visibleEnemies(state: MatchState, tank: Tank): readonly Tank[] {
  const eye = eyePosition(state.world, tank);
  const visible: Tank[] = [];
  for (const candidate of state.tanks) {
    if (!candidate.alive || candidate.teamId === tank.teamId || candidate.id === tank.id) {
      continue;
    }
    if (hasLineOfSight(state.world, eye, targetCentre(state.world, candidate))) {
      visible.push(candidate);
    }
  }
  visible.sort((a, b) => {
    const distanceA = squaredDistance(tank, a);
    const distanceB = squaredDistance(tank, b);
    return distanceA - distanceB || a.id - b.id;
  });
  return visible;
}

/** One remembered sighting. The position is the last seen centre, not a live target. */
export interface EnemyMemoryEntry {
  readonly tankId: number;
  readonly x: number;
  readonly z: number;
  readonly seenAtTick: number;
}

/**
 * Short-term memory. It is updated at decision time only; a stale position remains
 * usable for navigation but never for firing (the controller fires on current LOS).
 */
export class PerceptionMemory {
  private readonly entries = new Map<number, EnemyMemoryEntry>();
  private readonly limitTicks: number;

  constructor(limitTicks = AI_MEMORY_TICKS) {
    if (!Number.isInteger(limitTicks) || limitTicks < 1) {
      throw new Error(`PerceptionMemory: limitTicks must be a positive integer, got ${String(limitTicks)}`);
    }
    this.limitTicks = limitTicks;
  }

  /** Replaces visible sightings, prunes old ones and returns the current visible list. */
  update(state: MatchState, tank: Tank): readonly Tank[] {
    const visible = visibleEnemies(state, tank);
    for (const candidate of visible) {
      this.entries.set(candidate.id, {
        tankId: candidate.id,
        x: candidate.x,
        z: candidate.z,
        seenAtTick: state.tick,
      });
    }
    for (const [tankId, entry] of this.entries) {
      const enemy = state.tanks.find((candidate) => candidate.id === tankId);
      if (
        !enemy ||
        !enemy.alive ||
        enemy.teamId === tank.teamId ||
        state.tick - entry.seenAtTick > this.limitTicks
      ) {
        this.entries.delete(tankId);
      }
    }
    return visible;
  }

  /** Most recent remembered sighting, if any. Deterministic tie-break by tank id. */
  latest(): EnemyMemoryEntry | null {
    let best: EnemyMemoryEntry | null = null;
    for (const entry of this.entries.values()) {
      if (
        !best ||
        entry.seenAtTick > best.seenAtTick ||
        (entry.seenAtTick === best.seenAtTick && entry.tankId < best.tankId)
      ) {
        best = entry;
      }
    }
    return best;
  }

  get(tankId: number): EnemyMemoryEntry | null {
    return this.entries.get(tankId) ?? null;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

function squaredDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function requirePoint(point: Vec3, label: string): void {
  if (
    point === null ||
    typeof point !== 'object' ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.z)
  ) {
    throw new Error(`perception: ${label} must be a finite Vec3`);
  }
}
