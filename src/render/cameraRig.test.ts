import { describe, expect, it } from 'vitest';
import { CameraRig } from './cameraRig.ts';

const ARENA = { minX: 0, maxX: 48, minZ: 0, maxZ: 48 } as const;
const FOCUS = { position: { x: 24, y: 0.2, z: 24 }, yawDegrees: 0 } as const;

function liveRig(): CameraRig {
  const rig = new CameraRig({ arena: ARENA, floorY: 0.2, focus: FOCUS, pose: null });
  rig.update(0.016);
  return rig;
}

describe('firing blowback', () => {
  it('kicks the live camera back, then returns it to the spring pose', () => {
    const rig = liveRig();
    const before = rig.camera.position.clone();
    rig.kick();
    expect(rig.recoil).toBe(1);
    rig.update(0.016);
    expect(rig.recoil).toBeLessThan(1);
    rig.applyRecoil();
    expect(rig.camera.position.distanceTo(before)).toBeGreaterThan(0.05);

    rig.update(1);
    rig.update(0.016);
    rig.applyRecoil();
    expect(rig.recoil).toBe(0);
    expect(rig.camera.position.distanceTo(before)).toBeLessThan(1e-6);
  });

  it('never shakes a frozen screenshot pose and rejects a bad impulse', () => {
    const rig = new CameraRig({ arena: ARENA, floorY: 0.2, focus: FOCUS, pose: 'wide' });
    const before = rig.camera.position.clone();
    rig.kick(1);
    rig.update(0.016);
    rig.applyRecoil();
    expect(rig.camera.position.distanceTo(before)).toBe(0);
    expect(() => rig.kick(-1)).toThrow(/kick strength/);
    expect(() => rig.kick(Number.NaN)).toThrow(/kick strength/);
  });
});
