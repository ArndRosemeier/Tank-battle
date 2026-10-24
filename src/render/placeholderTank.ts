/**
 * The compact tank view: an angular near-black hull and turret with team-coloured
 * neon trim, 2.0 × 2.6 m. The hull half-width is 1.0 m, inside the A3b 1 m-radius
 * collision circle (×1.05 allowance). It is a VIEW, not a game entity: `setSimPose`
 * receives hull/turret/pitch from the session; the sweep is retained for the A2
 * showcase budget fixture.
 *
 * The silhouette is authored, not lit (§9): a low chassis, a chevron nose, side pods
 * and a six-sided turret all draw their edges from `NeonSurface`, with an ice-white
 * muzzle and thruster pods as the only hot cores. Two surfaces per tank (hull, and
 * turret+barrel so the turret can turn) cost six draw calls each.
 */

import { BoxGeometry, CylinderGeometry, Group, type BufferGeometry } from 'three';
import { CAMERA, NEON, PALETTE, TANK, teamColor, teamEdgeGainFor } from './config.ts';
import { createNeonSurface, type NeonSurface, type SurfacePart } from './neonSurface.ts';

/** The turret group's mount relative to the hull; the wreck uses the same seam. */
export const TURRET_MOUNT = { x: 0, y: 0.78, z: -0.02 } as const;

/** One slab in the authored tank breakup: a box, its local transform and its hue. */
export interface WreckPartSpec {
  readonly group: 'hull' | 'turret';
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotX?: number;
  readonly rotY?: number;
  readonly rotZ?: number;
  readonly color: 'team' | 'core';
}

/**
 * THE tank breakup list. These are the authored hull halves, skirt, nose blades,
 * rails, rear deck, outboard pods, turret body/bustle, mantlet, barrel, muzzle brake,
 * cupola and mast. They are slabs for the one instanced neon wreck system, not generic
 * sparks; the names/dimensions mirror the parts assembled below.
 *
 * Why this is a separate data list: the visual assembly below still merges its source
 * geometries through `createNeonSurface`, which takes ownership and disposes them, so
 * there is no reusable mesh list to read back. The turret and barrel are cylinders in
 * the visual; the wreck uses their bounding slabs because the one-draw budget requires
 * one unit-box edge geometry. Keep these dimensions in sync with the assembly.
 */
export const TANK_WRECK_PARTS: readonly WreckPartSpec[] = [
  { group: 'hull', width: 0.98, height: TANK.hullHeightMetres, depth: TANK.hullLengthMetres, x: -0.51, y: 0.55, z: 0, color: 'team' },
  { group: 'hull', width: 0.98, height: TANK.hullHeightMetres, depth: TANK.hullLengthMetres, x: 0.51, y: 0.55, z: 0, color: 'team' },
  { group: 'hull', width: 1.6, height: 0.22, depth: 2.2, x: 0, y: 0.28, z: 0.08, color: 'team' },
  { group: 'hull', width: 0.16, height: 0.12, depth: 1.1, x: 0.70, y: 0.62, z: -1.12, rotY: 0.30, color: 'team' },
  { group: 'hull', width: 0.16, height: 0.12, depth: 1.1, x: -0.70, y: 0.62, z: -1.12, rotY: -0.30, color: 'team' },
  { group: 'hull', width: 0.12, height: 0.1, depth: 2.2, x: 0.84, y: 0.76, z: 0.1, color: 'team' },
  { group: 'hull', width: 0.12, height: 0.1, depth: 2.2, x: -0.84, y: 0.76, z: 0.1, color: 'team' },
  { group: 'hull', width: 1.5, height: 0.08, depth: 0.6, x: 0, y: 0.76, z: 1.0, color: 'team' },
  { group: 'hull', width: 0.14, height: 0.2, depth: 1.8, x: 0.9, y: 0.42, z: 0.1, color: 'team' },
  { group: 'hull', width: 0.14, height: 0.2, depth: 1.8, x: -0.9, y: 0.42, z: 0.1, color: 'team' },
  { group: 'turret', width: TANK.turretWidthMetres, height: TANK.turretHeightMetres, depth: TANK.turretLengthMetres, x: 0, y: 0.16, z: 0.02, color: 'team' },
  { group: 'turret', width: 0.9, height: 0.28, depth: 0.5, x: 0, y: 0.16, z: 0.65, color: 'team' },
  { group: 'turret', width: 0.6, height: 0.36, depth: 0.4, x: 0, y: 0.18, z: -0.55, color: 'team' },
  { group: 'turret', width: TANK.barrelDiameterMetres, height: TANK.barrelDiameterMetres, depth: TANK.barrelLengthMetres, x: 0, y: 0.2, z: -0.5 - TANK.barrelLengthMetres / 2, color: 'team' },
  { group: 'turret', width: TANK.muzzleDiameterMetres, height: TANK.muzzleDiameterMetres, depth: TANK.muzzleLengthMetres, x: 0, y: 0.2, z: -0.5 - TANK.barrelLengthMetres - TANK.muzzleLengthMetres / 2, color: 'core' },
  { group: 'turret', width: 0.45, height: 0.18, depth: 0.45, x: 0, y: 0.5, z: 0.08, color: 'team' },
  { group: 'turret', width: 0.08, height: 0.28, depth: 0.08, x: 0.28, y: 0.64, z: 0.04, color: 'core' },
];

export interface PlaceholderTank {
  readonly group: Group;
  readonly turret: Group;
  /** Advances the A2 showcase's trivial turret sweep. */
  sweep(elapsedSeconds: number): void;
  /** One firing blowback: slide the whole turret/barrel assembly back, then recover. */
  kick(): void;
  updateRecoil(dtSeconds: number): void;
  /**
   * Places the A3c sim state on the model. The hull group carries hull yaw; the turret
   * carries the RELATIVE yaw and the gun pitch (the turret is the pitch pivot).
   */
  setSimPose(
    x: number,
    y: number,
    z: number,
    hullYawDegrees: number,
    turretYawDegrees: number,
    aimPitchDegrees: number,
    hullPitchDegrees?: number,
    hullRollDegrees?: number,
  ): void;
  dispose(): void;
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  rotateX = 0,
  rotateY = 0,
): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  if (rotateX !== 0) geometry.rotateX(rotateX);
  if (rotateY !== 0) geometry.rotateY(rotateY);
  geometry.translate(x, y, z);
  return geometry;
}

/** A cylinder whose axis runs along the barrel's -z, centred at (x, y, z). */
function cylinderAlongZ(
  radiusTop: number,
  radiusBottom: number,
  length: number,
  x: number,
  y: number,
  z: number,
): BufferGeometry {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, length, 6, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * Builds one tank facing -z at the origin. The caller positions and yaws the group; a
 * unique `phase` gives each turret sweep a different offset without any randomness.
 */
export function createPlaceholderTank(teamIndex: number, phase: number): PlaceholderTank {
  if (!Number.isFinite(phase)) {
    throw new Error(`placeholderTank: phase must be finite, got ${phase}`);
  }
  const color = teamColor(teamIndex);
  // D5: the hue is the owner's, the BRIGHTNESS is normalised across teams.
  const gain = teamEdgeGainFor(teamIndex);
  // The gun is a slimmer, quieter surface than the hull: a full-gain 2.15 m barrel
  // reads as a neon bar in the follow arm and pushes the frame's tile p90.
  const gunGain = gain * 0.5;
  const core = { color: PALETTE.iceWhite, gain: NEON.coreGain };

  const hullParts: SurfacePart[] = [
    // Low chassis and the narrower under-skirt below it: two horizontal lines.
    {
      geometry: box(TANK.hullWidthMetres, TANK.hullHeightMetres, TANK.hullLengthMetres, 0, 0.55, 0),
      color,
      gain,
    },
    { geometry: box(1.6, 0.22, 2.2, 0, 0.28, 0.08), color, gain },
    // Chevron nose: two angled blades meeting in front, the tank's signature.
    { geometry: box(0.16, 0.12, 1.1, 0.70, 0.62, -1.12, 0, 0.30), color, gain },
    { geometry: box(0.16, 0.12, 1.1, -0.70, 0.62, -1.12, 0, -0.30), color, gain },
    // Flush side rails and a rear deck line: angular detail without a crate on top.
    { geometry: box(0.12, 0.1, 2.2, 0.84, 0.76, 0.1), color, gain },
    { geometry: box(0.12, 0.1, 2.2, -0.84, 0.76, 0.1), color, gain },
    { geometry: box(1.5, 0.08, 0.6, 0, 0.76, 1.0), color, gain },
    // Outboard pods widen the footprint but stay inside the 1 m body radius.
    { geometry: box(0.14, 0.2, 1.8, 0.9, 0.42, 0.1), color, gain },
    { geometry: box(0.14, 0.2, 1.8, -0.9, 0.42, 0.1), color, gain },
    // Rear thruster slits: small ice-white cores, never a headlight-sized block.
    { geometry: box(0.22, 0.06, 0.16, 0.58, 0.52, 1.32), ...core },
    { geometry: box(0.22, 0.06, 0.16, -0.58, 0.52, 1.32), ...core },
  ];

  // A distinct hexagonal turret so the silhouette is a tank, not a slab.
  const turretGeometry = new CylinderGeometry(
    TANK.turretWidthMetres * 0.4,
    TANK.turretWidthMetres * 0.52,
    TANK.turretHeightMetres,
    6,
    1,
    false,
  );
  turretGeometry.rotateY(Math.PI / 6);
  turretGeometry.translate(0, 0.16, 0.02);

  const barrelStart = -0.5;
  const barrelCentre = barrelStart - TANK.barrelLengthMetres / 2;
  const barrelEnd = barrelStart - TANK.barrelLengthMetres;
  // The sim's muzzle is 3 m forward of the hull origin; keep the brake's tip at that
  // reach instead of ending the barrel short of the shell spawn.
  const muzzleTip = barrelEnd - TANK.muzzleLengthMetres;
  const brakeCentre = barrelEnd - TANK.muzzleLengthMetres / 2;

  const turretParts: SurfacePart[] = [
    { geometry: turretGeometry, color, gain },
    // Rear turret bustle: weight at the back, and a second turret line.
    { geometry: box(0.9, 0.28, 0.5, 0, 0.16, 0.65), color, gain },
    // Mantlet, then the gun: a long square barrel with a thick sleeve, collars and a
    // hexagonal muzzle brake at the tip (the old muzzle was a floating grey cube).
    { geometry: box(0.6, 0.36, 0.4, 0, 0.18, -0.55), color, gain },
    {
      geometry: box(
        TANK.barrelDiameterMetres,
        TANK.barrelDiameterMetres,
        TANK.barrelLengthMetres,
        0,
        0.2,
        barrelCentre,
      ),
      color,
      gain,
    },
    { geometry: box(0.42, 0.38, 0.8, 0, 0.2, -1.55), color, gain },
    { geometry: box(0.36, 0.34, 0.16, 0, 0.2, -1.15), color, gain },
    {
      geometry: cylinderAlongZ(0.22, 0.2, TANK.muzzleLengthMetres, 0, 0.2, brakeCentre),
      color,
      gain: gunGain,
    },
    {
      geometry: cylinderAlongZ(0.26, 0.26, 0.07, 0, 0.2, barrelEnd - 0.04),
      color,
      gain: gunGain,
    },
    {
      geometry: cylinderAlongZ(0.24, 0.24, 0.05, 0, 0.2, muzzleTip + 0.03),
      ...core,
    },
    // The bore cap: the hottest small point, exactly on the shell's origin line.
    {
      geometry: cylinderAlongZ(0.09, 0.09, 0.03, 0, 0.2, muzzleTip + 0.012),
      ...core,
    },
    // Cupola and sensor mast above the turret: the second silhouette step.
    { geometry: box(0.45, 0.18, 0.45, 0, 0.5, 0.08), color, gain },
    { geometry: box(0.08, 0.28, 0.08, 0.28, 0.64, 0.04), ...core },
  ];

  const group = new Group();
  group.name = `tank-team-${teamIndex}`;

  const hullSurface: NeonSurface = createNeonSurface(hullParts);
  group.add(hullSurface.group);

  const turret = new Group();
  turret.name = 'turret';
  turret.position.set(TURRET_MOUNT.x, TURRET_MOUNT.y, TURRET_MOUNT.z);
  turret.rotation.order = 'YXZ';
  const turretSurface: NeonSurface = createNeonSurface(turretParts);
  turret.add(turretSurface.group);
  group.add(turret);

  const surfaces = [hullSurface, turretSurface];
  const sweepAngularSpeed = (Math.PI * 2) / TANK.sweepPeriodSeconds;
  const turretRestZ = turret.position.z;
  let recoilAmount = 0;

  return {
    group,
    turret,
    sweep(elapsedSeconds: number): void {
      // A small rest yaw keeps the gun visible from the 3/4 follow pose; the sweep
      // only wiggles it, so a screenshot never catches a barrel hidden dead ahead.
      turret.rotation.y =
        TANK.turretRestYawRadians + Math.sin(elapsedSeconds * sweepAngularSpeed + phase) * TANK.sweepRadians;
    },
    setSimPose(
      x: number,
      y: number,
      z: number,
      hullYawDegrees: number,
      turretYawDegrees: number,
      aimPitchDegrees: number,
      hullPitchDegrees = 0,
      hullRollDegrees = 0,
    ): void {
      for (const [value, label] of [
        [x, 'x'],
        [y, 'y'],
        [z, 'z'],
        [hullYawDegrees, 'hullYawDegrees'],
        [turretYawDegrees, 'turretYawDegrees'],
        [aimPitchDegrees, 'aimPitchDegrees'],
        [hullPitchDegrees, 'hullPitchDegrees'],
        [hullRollDegrees, 'hullRollDegrees'],
      ] as const) {
        if (!Number.isFinite(value)) {
          throw new Error(`placeholderTank: ${label} must be finite, got ${value}`);
        }
      }
      group.position.set(x, y, z);
      // The hull sits on the terrain: yaw, then nose pitch, then roll (left side up
      // is a negative z rotation for a hull facing -z).
      group.rotation.set(
        (hullPitchDegrees * Math.PI) / 180,
        (hullYawDegrees * Math.PI) / 180,
        (-hullRollDegrees * Math.PI) / 180,
        'YXZ',
      );
      const relativeYaw = turretYawDegrees - hullYawDegrees;
      turret.rotation.y = (relativeYaw * Math.PI) / 180;
      // The aim pitch is absolute; take out the hull's tilt along the gun's direction.
      const relativeRadians = (relativeYaw * Math.PI) / 180;
      const tiltAlongGun = hullPitchDegrees * Math.cos(relativeRadians) - hullRollDegrees * Math.sin(relativeRadians);
      turret.rotation.x = ((aimPitchDegrees - tiltAlongGun) * Math.PI) / 180;
      turret.position.z = turretRestZ + recoilAmount * CAMERA.barrelRecoilMetres;
    },
    kick(): void {
      recoilAmount = 1;
    },
    updateRecoil(dtSeconds: number): void {
      if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
        throw new Error(`placeholderTank: recoil dt must be finite and >= 0, got ${String(dtSeconds)}`);
      }
      recoilAmount = Math.max(0, recoilAmount - dtSeconds / CAMERA.recoilSeconds);
    },
    dispose(): void {
      for (const surface of surfaces) {
        surface.dispose();
      }
      group.clear();
    },
  };
}
