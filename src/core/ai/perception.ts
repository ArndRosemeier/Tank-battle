/**
 * The AI's eyes: a sightline through the terrain (the same density march a shell
 * uses), plus a short per-enemy memory of the last seen position.
 *
 * This is deliberately NOT the shell resolver. A shell is a moving collision query
 * with tanks and a swept muzzle; perception only asks whether a straight sightline
 * reaches the target centre.
 */

import { MUZZLE_HEIGHT_METRES, type MatchState, type Tank, type Vec3 } from '../sim.ts';
import { hasClearLine, type World } from '../world.ts';
import {
  AI_EYE_HEIGHT_METRES,
  AI_MEMORY_TICKS,
  AI_TARGET_CENTRE_HEIGHT_METRES,
} from './constants.ts';

/** The centre of a tank's body, the point the AI tries to see and hit. */
export function targetCentre(tank: Tank): Vec3 {
  return { x: tank.x, y: tank.y + AI_TARGET_CENTRE_HEIGHT_METRES, z: tank.z };
}

/** The eye, just above the turret roof. */
export function eyePosition(tank: Tank): Vec3 {
  return { x: tank.x, y: tank.y + AI_EYE_HEIGHT_METRES, z: tank.z };
}

/** The muzzle height point above the hull origin (where a shot starts its climb). */
export function gunPosition(tank: Tank): Vec3 {
  return { x: tank.x, y: tank.y + MUZZLE_HEIGHT_METRES, z: tank.z };
}

/** True when the straight segment from `from` to `to` stays out of the terrain. */
export function hasLineOfSight(world: World, from: Vec3, to: Vec3): boolean {
  requirePoint(from, 'from');
  requirePoint(to, 'to');
  return hasClearLine(world, from, to);
}

/** True when a shell from the gun to the target centre would clear the terrain. */
export function hasShotLine(world: World, tank: Tank, target: Tank): boolean {
  return hasLineOfSight(world, gunPosition(tank), targetCentre(target));
}

/** Every live enemy of `tank` with a clear eye-to-centre sightline, nearest first. */
export function visibleEnemies(state: MatchState, tank: Tank): readonly Tank[] {
  const eye = eyePosition(tank);
  const visible: Tank[] = [];
  for (const candidate of state.tanks) {
    if (!candidate.alive || candidate.teamId === tank.teamId || candidate.id === tank.id) {
      continue;
    }
    if (hasLineOfSight(state.world, eye, targetCentre(candidate))) {
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
  readonly y: number;
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
        y: candidate.y,
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
