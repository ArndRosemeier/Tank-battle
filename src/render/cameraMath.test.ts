import { describe, expect, it } from 'vitest';
import { CAMERA } from './config.ts';
import {
  cameraPose,
  clampDistance,
  isFirstPerson,
  orbitPose,
  spectatorPose,
  zoomDistance,
} from './cameraMath.ts';

const ARENA = { minX: 0, maxX: 64, minZ: 0, maxZ: 48 };
const FOCUS = { x: 21, y: 0.2, z: 37 };

describe('cameraMath', () => {
  it('frames the spectator action from a wider arm and rejects an out-of-range distance', () => {
    const pose = spectatorPose({
      centerX: 24,
      centerZ: 24,
      floorY: 0.2,
      yawDegrees: 0,
      distanceMetres: 24,
      pitchDegrees: 34,
    });
    expect(pose.target).toEqual({ x: 24, y: 0.2 + CAMERA.focusHeightMetres, z: 24 });
    expect(pose.position.z).toBeGreaterThan(24);
    expect(() =>
      spectatorPose({
        centerX: 24,
        centerZ: 24,
        floorY: 0.2,
        yawDegrees: 0,
        distanceMetres: CAMERA.spectatorMaxDistanceMetres + 1,
        pitchDegrees: 34,
      }),
    ).toThrow(/spectator distance/);
  });

  it('the camera zoom is clamped and first person is entered at the documented distance', () => {
    // The clamp is the document: one wheel event cannot leave the arm outside it.
    expect(clampDistance(-1000)).toBe(CAMERA.minDistanceMetres);
    expect(clampDistance(1e6)).toBe(CAMERA.maxDistanceMetres);
    expect(zoomDistance(CAMERA.defaultDistanceMetres, -100000)).toBe(CAMERA.minDistanceMetres);
    expect(zoomDistance(CAMERA.defaultDistanceMetres, 100000)).toBe(CAMERA.maxDistanceMetres);

    // The first-person boundary is exclusive and documented: 2 m is still third
    // person; 1.999 m is inside the hull.
    expect(isFirstPerson(CAMERA.firstPersonDistanceMetres)).toBe(false);
    expect(isFirstPerson(CAMERA.firstPersonDistanceMetres - 1e-6)).toBe(true);
    expect(isFirstPerson(CAMERA.minDistanceMetres)).toBe(true);
    expect(isFirstPerson(CAMERA.maxDistanceMetres)).toBe(false);

    // Zoom is continuous, not a jump between modes.
    const halfway = zoomDistance(CAMERA.defaultDistanceMetres, -400);
    expect(halfway).toBeLessThan(CAMERA.defaultDistanceMetres);
    expect(halfway).toBeGreaterThan(CAMERA.minDistanceMetres);

    // Malformed numbers fail loudly instead of clamping into a silent default.
    expect(() => clampDistance(Number.NaN)).toThrow(/finite/);
    expect(() => zoomDistance(Number.POSITIVE_INFINITY, 0)).toThrow(/finite/);
    expect(() => isFirstPerson(Number.NaN)).toThrow(/finite/);
  });

  it('a camera pose reproduces the same position and target for the same inputs', () => {
    const request = {
      arena: ARENA,
      floorY: 0.2,
      focus: FOCUS,
      focusYawDegrees: 0,
    } as const;

    for (const name of ['wide', 'tank', 'first', 'combat', 'team'] as const) {
      const firstRun = cameraPose({ name, ...request });
      const secondRun = cameraPose({ name, ...request });
      expect(secondRun).toEqual(firstRun);
      expect(Number.isFinite(firstRun.position.x)).toBe(true);
      expect(Number.isFinite(firstRun.position.y)).toBe(true);
      expect(Number.isFinite(firstRun.position.z)).toBe(true);
    }

    // The team pose is deliberately pulled back past the live follow arm so the
    // player and three squadmates can share one legible frame.
    const teamPose = cameraPose({ name: 'team', ...request });
    const teamHorizontal = Math.hypot(teamPose.position.x - FOCUS.x, teamPose.position.z - FOCUS.z);
    expect(teamHorizontal).toBeGreaterThan(CAMERA.defaultDistanceMetres);

    // The orbit conversion is pure too: same inputs, same numbers.
    const orbit = {
      focus: { x: 21, y: 1.75, z: 37 },
      forward: { x: 0, y: 0, z: -1 },
      distance: CAMERA.defaultDistanceMetres,
      pitchDegrees: CAMERA.defaultPitchDegrees,
    } as const;
    expect(orbitPose(orbit)).toEqual(orbitPose(orbit));

    // The follow arm sits behind (+z for a -z facing tank) and above its focus.
    const follow = orbitPose(orbit);
    expect(follow.position.z).toBeGreaterThan(orbit.focus.z);
    expect(follow.position.y).toBeGreaterThan(orbit.focus.y);
  });

  it('collapsing the arm turns the target forward and hides the hull boundary', () => {
    const firstPerson = orbitPose({
      focus: { x: 0, y: 1.55, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      distance: CAMERA.minDistanceMetres,
      pitchDegrees: CAMERA.defaultPitchDegrees,
    });
    expect(firstPerson.target.z).toBeLessThan(0);
    expect(isFirstPerson(CAMERA.minDistanceMetres)).toBe(true);

    // At the boundary the look-ahead is exactly zero, so entering first person
    // cannot jump the view direction.
    const atBoundary = orbitPose({
      focus: { x: 0, y: 1.55, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      distance: CAMERA.firstPersonDistanceMetres,
      pitchDegrees: CAMERA.defaultPitchDegrees,
    });
    expect(atBoundary.target).toEqual({ x: 0, y: 1.55, z: 0 });
  });
});
