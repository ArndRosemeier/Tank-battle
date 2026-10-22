import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_RULES,
  createMatch,
  forwardFromYaw,
  idleTankCommand,
  stepMatch,
  MUZZLE_HEIGHT_METRES,
  type MatchState,
  type Vec3,
} from '../core/sim.ts';
import type { CellPlacement } from '../core/world.ts';
import { projectAimPoint } from '../render/aimProjection.ts';
import { cameraRayFromPointer, solveAim, type AimCamera } from './aim.ts';
import { commandFromAim, idlePlayerInput } from './input.ts';

const FLOOR = 0.2;

function flatMatch(placements: readonly CellPlacement[] = [], playerZ = 12): MatchState {
  return createMatch({
    level: { columns: 32, rows: 32, floorSurfaceHeightMetres: FLOOR, placements },
    teams: [
      {
        id: 0,
        tanks: [
          { xMetres: 12, zMetres: playerZ, hullYawDegrees: 0, turretYawDegrees: 0, aimPitchDegrees: 0 },
        ],
      },
      {
        id: 1,
        tanks: [{ xMetres: 2, zMetres: 2, hullYawDegrees: 0, turretYawDegrees: 0, aimPitchDegrees: 0 }],
      },
    ],
    seed: 5,
    rules: DEFAULT_MATCH_RULES,
  });
}

function cameraLookingAt(target: Vec3): AimCamera {
  return {
    position: { x: 12, y: 4, z: 20 },
    target,
    up: { x: 0, y: 1, z: 0 },
    fovDegrees: 50,
    aspect: 16 / 9,
  };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('world-point aiming', () => {
  it('a camera ray at open ground solves a YAW+PITCH whose real shell lands there', () => {
    const state = flatMatch();
    state.capturePresentationEvents = true;
    const player = state.tanks[0]!;
    const groundPoint = { x: 12, y: FLOOR, z: 6 };
    const camera = cameraLookingAt(groundPoint);
    const solution = solveAim(state, player, camera, 0, 0);

    expect(solution.outOfRange).toBe(false);
    expect(solution.clamped).toBe(false);
    expect(solution.aimYaw).toBeCloseTo(0, 6);

    // Set the turret to the solved command, then let the REAL simulation fire one shot.
    // The impact event is the shell's own collision point; this is not an angle-only
    // comparison, and it would catch a muzzle/aim convention mismatch.
    player.turretYawDegrees = solution.aimYaw;
    player.aimPitchDegrees = solution.aimPitch;
    let impact: Vec3 | null = null;
    for (let tick = 0; tick < 120 && state.status === 'active' && impact === null; tick += 1) {
      stepMatch(state, [
        {
          tankId: 0,
          command: {
            throttle: 0,
            steer: 0,
            aimYaw: solution.aimYaw,
            aimPitch: solution.aimPitch,
            fire: tick === 0,
          },
        },
        { tankId: 1, command: idleTankCommand(state.tanks[1]!.turretYawDegrees) },
      ]);
      const event = state.presentationEvents?.find((candidate) => candidate.type === 'impact');
      if (event && event.type === 'impact') impact = { x: event.x, y: event.y, z: event.z };
    }

    expect(impact).not.toBeNull();
    expect(distance(impact!, groundPoint)).toBeLessThanOrEqual(0.5);
    expect(distance(impact!, solution.impactPoint)).toBeLessThanOrEqual(0.5);
  });

  it('aims at a wall, not through it, when the camera ray is blocked', () => {
    // Player at z=20, muzzle at z=17; the wall cell covers z=12..14, well in front.
    const state = flatMatch([{ x: 6, z: 6, material: 'wall', heightMetres: 3.2 }], 20);
    const player = state.tanks[0]!;
    const solution = solveAim(
      state,
      player,
      { ...cameraLookingAt({ x: 12, y: FLOOR, z: 6 }), position: { x: 12, y: 4, z: 28 } },
      0,
      0,
    );

    expect(solution.desiredPoint.z).toBeGreaterThan(12);
    expect(solution.desiredPoint.z).toBeLessThanOrEqual(14);
    expect(solution.impactPoint.z).toBeCloseTo(solution.desiredPoint.z, 1);
    expect(solution.desiredPoint.z).toBeLessThan(20);
    expect(solution.targetTankId).toBeNull();
    expect(solution.outOfRange).toBe(false);
  });

  it('marks empty sky out of range and still produces a valid command', () => {
    const state = flatMatch();
    const player = state.tanks[0]!;
    const solution = solveAim(
      state,
      player,
      cameraLookingAt({ x: 12, y: 20, z: 0 }),
      0,
      0,
    );

    expect(solution.outOfRange).toBe(true);
    expect(Number.isFinite(solution.aimYaw)).toBe(true);
    expect(Number.isFinite(solution.aimPitch)).toBe(true);
    expect(solution.aimPitch).toBeLessThanOrEqual(25);
    expect(solution.aimPitch).toBeGreaterThanOrEqual(-30);
    const command = commandFromAim(idlePlayerInput(), solution.aimYaw, solution.aimPitch);
    expect(Number.isFinite(command.aimYaw)).toBe(true);
    expect(Number.isFinite(command.aimPitch)).toBe(true);
    const dist = Math.hypot(
      solution.impactPoint.x - player.x,
      solution.impactPoint.y - (FLOOR + MUZZLE_HEIGHT_METRES),
      solution.impactPoint.z - player.z,
    );
    expect(dist).toBeGreaterThan(70);
  });

  it('pointer RIGHT still aims RIGHT, and the reticle projects at the impact point', () => {
    const state = flatMatch();
    const player = state.tanks[0]!;
    const camera = cameraLookingAt({ x: 12, y: FLOOR, z: 6 });
    const ray = cameraRayFromPointer(camera, 0.6, 0);
    expect(ray.x).toBeGreaterThan(0);

    const solution = solveAim(state, player, camera, 0.6, 0);
    const forward = forwardFromYaw(solution.aimYaw);
    expect(forward.x).toBeGreaterThan(0);
    expect(solution.desiredPoint.x).toBeGreaterThan(12);

    // The HUD projects the IMPACT point, so for a ground hit it must return to the
    // pointer that selected it (not to the screen centre).
    const projected = projectAimPoint(
      {
        cameraPosition: camera.position,
        cameraTarget: camera.target,
        cameraUp: camera.up,
        fovDegrees: camera.fovDegrees,
        aspect: camera.aspect,
      },
      solution.impactPoint,
    );
    expect(Math.abs(projected.x - 0.6)).toBeLessThan(0.03);
    expect(Math.abs(projected.y)).toBeLessThan(0.05);
  });

  it('aims at a point BEHIND the hull (full turret rotation), not clamped to ±60°', () => {
    const state = flatMatch();
    const player = state.tanks[0]!;
    // A camera looking due EAST from a hull whose forward is -z asks for a 90° turret turn.
    // The owner's intent is "fire at whatever the mouse points at", so this must NOT clamp.
    const camera: AimCamera = {
      position: { x: 12, y: 4, z: 20 },
      target: { x: 40, y: FLOOR, z: 20 },
      up: { x: 0, y: 1, z: 0 },
      fovDegrees: 50,
      aspect: 16 / 9,
    };
    const solution = solveAim(state, player, camera, 0, 0);
    expect(solution.clamped).toBe(false);
    expect(Math.abs(solution.aimYaw - player.hullYawDegrees)).toBeGreaterThan(60);
    expect(distance(solution.impactPoint, solution.desiredPoint)).toBeLessThan(0.5);
  });

  it('clamps PITCH, and says so', () => {
    const state = flatMatch();
    const player = state.tanks[0]!;
    // Ground 1 m in front of the muzzle (the muzzle sits 3 m ahead of the hull): the
    // required depression is ~58 degrees, beyond the gun's -30 limit.
    const camera: AimCamera = {
      // Offset a little in x: a camera looking exactly straight down has no valid right vector.
      position: { x: player.x + 0.5, y: 10, z: player.z - 4 },
      target: { x: player.x, y: FLOOR, z: player.z - 4 },
      up: { x: 0, y: 1, z: 0 },
      fovDegrees: 50,
      aspect: 16 / 9,
    };
    const solution = solveAim(state, player, camera, 0, 0);
    expect(solution.clamped).toBe(true);
    expect(solution.aimPitch).toBeLessThanOrEqual(-29.9);
  });
});
