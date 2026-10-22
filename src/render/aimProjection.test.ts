import { describe, expect, it } from 'vitest';
import { CAMERA } from './config.ts';
import { aimFollowYawDegrees, projectAimDirection, projectAimPoint } from './aimProjection.ts';

const ASPECT = 16 / 9;
const VIEW = {
  cameraPosition: { x: 0, y: 2, z: 10 },
  cameraTarget: { x: 0, y: 2, z: 0 },
  cameraUp: { x: 0, y: 1, z: 0 },
  fovDegrees: CAMERA.fovDegrees,
  aspect: ASPECT,
} as const;

function horizontalHalfFovDegrees(): number {
  return (Math.atan(Math.tan((CAMERA.fovDegrees * Math.PI) / 360) * ASPECT) * 180) / Math.PI;
}

describe('the aiming loop', () => {
  it('projects the gun direction into the frame, not a fixed centre', () => {
    const straight = projectAimDirection(VIEW, { x: 0, y: 0, z: -1 });
    expect(straight.onScreen).toBe(true);
    expect(straight.x).toBeCloseTo(0, 10);
    expect(straight.y).toBeCloseTo(0, 10);

    // The camera follows the hull + 55 % of a 30° turret offset; the remaining 13.5°
    // puts the reticle off centre (positive yaw turns left, so the sign is negative).
    // A fixed crosshair would report 0.
    const cameraYaw = aimFollowYawDegrees(0, 30);
    expect(cameraYaw).toBeCloseTo(16.5, 10);
    const aimYaw = (30 * Math.PI) / 180;
    const cameraYawRad = (cameraYaw * Math.PI) / 180;
    const aim = { x: -Math.sin(aimYaw), y: 0, z: -Math.cos(aimYaw) };
    const moving = projectAimDirection(
      {
        ...VIEW,
        cameraPosition: { x: 0, y: 2, z: 0 },
        cameraTarget: {
          x: -Math.sin(cameraYawRad) * 10,
          y: 2,
          z: -Math.cos(cameraYawRad) * 10,
        },
      },
      aim,
    );
    expect(moving.onScreen).toBe(true);
    expect(Math.abs(moving.x)).toBeGreaterThan(0.15);
  });

  it('turns the camera only part of the turret offset and wraps correctly', () => {
    expect(aimFollowYawDegrees(0, 60, 0.55)).toBeCloseTo(33, 10);
    expect(aimFollowYawDegrees(0, -60, 0.55)).toBeCloseTo(-33, 10);
    expect(aimFollowYawDegrees(350, 10, 0.55)).toBeCloseTo(1, 10);
    expect(aimFollowYawDegrees(10, 350, 0.55)).toBeCloseTo(-1, 10);
    expect(() => aimFollowYawDegrees(0, 0, 1.1)).toThrow(/aimFollowFraction/);
    expect(() => aimFollowYawDegrees(Number.NaN, 0)).toThrow(/finite/);
  });

  it('keeps the full ±60° turret aim inside the horizontal frame at 16:9', () => {
    // The design invariant behind the 0.55 choice: the un-followed remainder must be
    // smaller than the horizontal half-frame, with room for the reticle's body.
    const remainder = (1 - CAMERA.aimFollowFraction) * 60;
    expect(remainder).toBeLessThan(horizontalHalfFovDegrees() - 6);
    expect(horizontalHalfFovDegrees()).toBeGreaterThan(38);
    expect(CAMERA.aimEdgeMargin).toBeGreaterThan(0.8);
    expect(CAMERA.aimEdgeMargin).toBeLessThan(1);
  });

  it('clamps an off-screen aim to the edge and returns the screen direction', () => {
    const right = projectAimDirection(VIEW, { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 });
    expect(right.onScreen).toBe(false);
    expect(right.edgeX).toBe(CAMERA.aimEdgeMargin);
    expect(right.edgeY).toBe(0);
    expect(right.angleRadians).toBeCloseTo(0, 10);

    const up = projectAimDirection(VIEW, { x: 0, y: 0.5, z: -Math.sqrt(0.75) });
    expect(up.onScreen).toBe(false);
    expect(up.edgeY).toBe(CAMERA.aimEdgeMargin);
    expect(up.angleRadians).toBeCloseTo(Math.PI / 2, 10);

    // A corner aim is clamped on both axes, so the arrow sits on the frame corner.
    const corner = projectAimDirection(VIEW, { x: 0.8, y: 0.4, z: -0.45 });
    expect(corner.onScreen).toBe(false);
    expect(corner.edgeX).toBe(CAMERA.aimEdgeMargin);
    expect(corner.edgeY).toBe(CAMERA.aimEdgeMargin);
  });

  it('projects a point on the shell path, not the direction at infinity', () => {
    // A point one metre off the camera axis is much further off-centre when it is
    // NEAR than when it is 100 m away. A direction-at-infinity reticle would report
    // the same NDC for both, which is the parallax error P2 fixes.
    const near = projectAimPoint(VIEW, { x: 1, y: 2, z: 5 });
    const far = projectAimPoint(VIEW, { x: 1, y: 2, z: -90 });
    expect(near.onScreen).toBe(true);
    expect(far.onScreen).toBe(true);
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x) * 10);
    expect(() => projectAimPoint(VIEW, { x: Number.NaN, y: 0, z: 0 })).toThrow(/point/);
  });

  it('handles a direction behind the camera without inventing a screen point', () => {
    const behind = projectAimDirection(VIEW, { x: 0.2, y: 0, z: 1 });
    expect(behind.behind).toBe(true);
    expect(behind.onScreen).toBe(false);
    expect(behind.edgeX).toBeGreaterThan(0);
    expect(() => projectAimDirection(VIEW, { x: 0, y: 0, z: 0 })).toThrow(/non-zero/);
    expect(() =>
      projectAimDirection({ ...VIEW, fovDegrees: 0 }, { x: 0, y: 0, z: -1 }),
    ).toThrow(/fovDegrees/);
    expect(() =>
      projectAimDirection({ ...VIEW, aspect: 0 }, { x: 0, y: 0, z: -1 }),
    ).toThrow(/aspect/);
  });
});
