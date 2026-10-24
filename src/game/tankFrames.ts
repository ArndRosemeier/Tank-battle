/**
 * The one render-frame snapshot/interpolation seam shared by the playable and
 * spectator sessions. It is game layer: plain data, no three.js and no clock.
 *
 * Tanks interpolate position, hull tilt, turret and pitch between the previous and current tick; yaw
 * uses the shortest arc. Shells deliberately do not interpolate.
 */

import type { MatchState } from '../core/sim.ts';

/** A tank transform after interpolation. The render layer maps this to a group. */
export interface TankRenderFrame {
  readonly id: number;
  readonly teamId: number;
  readonly x: number;
  /** The hull origin's height on the terrain. */
  readonly y: number;
  readonly z: number;
  readonly hullYawDegrees: number;
  readonly hullPitchDegrees: number;
  readonly hullRollDegrees: number;
  readonly turretYawDegrees: number;
  readonly aimPitchDegrees: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

export function snapshotTanks(state: MatchState): Map<number, TankRenderFrame> {
  const frames = new Map<number, TankRenderFrame>();
  for (const tank of state.tanks) {
    frames.set(tank.id, {
      id: tank.id,
      teamId: tank.teamId,
      x: tank.x,
      y: tank.y,
      z: tank.z,
      hullYawDegrees: tank.hullYawDegrees,
      hullPitchDegrees: tank.hullPitchDegrees,
      hullRollDegrees: tank.hullRollDegrees,
      turretYawDegrees: tank.turretYawDegrees,
      aimPitchDegrees: tank.aimPitchDegrees,
      hp: tank.hp,
      maxHp: tank.maxHp,
      alive: tank.alive,
    });
  }
  return frames;
}

function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function lerpAngle(from: number, to: number, alpha: number): number {
  return from + shortestAngleDelta(from, to) * alpha;
}

export function interpolateTanks(
  previousFrames: ReadonlyMap<number, TankRenderFrame>,
  currentFrames: ReadonlyMap<number, TankRenderFrame>,
  alpha: number,
): readonly TankRenderFrame[] {
  if (!Number.isFinite(alpha)) {
    throw new Error(`tankFrames: alpha must be finite, got ${alpha}`);
  }
  const t = Math.max(0, Math.min(1, alpha));
  const frames: TankRenderFrame[] = [];
  for (const current of currentFrames.values()) {
    const previous = previousFrames.get(current.id) ?? current;
    frames.push({
      ...current,
      x: lerp(previous.x, current.x, t),
      y: lerp(previous.y, current.y, t),
      z: lerp(previous.z, current.z, t),
      hullPitchDegrees: lerp(previous.hullPitchDegrees, current.hullPitchDegrees, t),
      hullRollDegrees: lerp(previous.hullRollDegrees, current.hullRollDegrees, t),
      hullYawDegrees: lerpAngle(previous.hullYawDegrees, current.hullYawDegrees, t),
      turretYawDegrees: lerpAngle(previous.turretYawDegrees, current.turretYawDegrees, t),
      aimPitchDegrees: lerp(previous.aimPitchDegrees, current.aimPitchDegrees, t),
    });
  }
  frames.sort((a, b) => a.id - b.id);
  return frames;
}
