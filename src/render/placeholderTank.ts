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
import { NEON, PALETTE, TANK, teamColor, teamEdgeGainFor } from './config.ts';
import { createNeonSurface, type NeonSurface, type SurfacePart } from './neonSurface.ts';

export interface PlaceholderTank {
  readonly group: Group;
  readonly turret: Group;
  /** Advances the A2 showcase's trivial turret sweep. */
  sweep(elapsedSeconds: number): void;
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
  const muzzleCentre = barrelEnd - TANK.muzzleLengthMetres / 2;

  const turretParts: SurfacePart[] = [
    { geometry: turretGeometry, color, gain },
    // Rear turret bustle: weight at the back, and a second turret line.
    { geometry: box(0.9, 0.28, 0.5, 0, 0.16, 0.65), color, gain },
    // Mantlet, then the gun: a long square barrel with collars and a hot muzzle.
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
    { geometry: box(0.28, 0.28, 0.18, 0, 0.2, -0.9), color, gain },
    { geometry: box(0.28, 0.28, 0.18, 0, 0.2, -1.7), color, gain },
    {
      geometry: box(
        TANK.muzzleDiameterMetres,
        TANK.muzzleDiameterMetres,
        TANK.muzzleLengthMetres,
        0,
        0.2,
        muzzleCentre,
      ),
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
  turret.position.set(0, 0.78, -0.02);
  turret.rotation.order = 'YXZ';
  const turretSurface: NeonSurface = createNeonSurface(turretParts);
  turret.add(turretSurface.group);
  group.add(turret);

  const surfaces = [hullSurface, turretSurface];
  const sweepAngularSpeed = (Math.PI * 2) / TANK.sweepPeriodSeconds;

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
    ): void {
      for (const [value, label] of [
        [x, 'x'],
        [y, 'y'],
        [z, 'z'],
        [hullYawDegrees, 'hullYawDegrees'],
        [turretYawDegrees, 'turretYawDegrees'],
        [aimPitchDegrees, 'aimPitchDegrees'],
      ] as const) {
        if (!Number.isFinite(value)) {
          throw new Error(`placeholderTank: ${label} must be finite, got ${value}`);
        }
      }
      group.position.set(x, y, z);
      group.rotation.y = (hullYawDegrees * Math.PI) / 180;
      const relativeYaw = turretYawDegrees - hullYawDegrees;
      turret.rotation.y = (relativeYaw * Math.PI) / 180;
      turret.rotation.x = (aimPitchDegrees * Math.PI) / 180;
    },
    dispose(): void {
      for (const surface of surfaces) {
        surface.dispose();
      }
      group.clear();
    },
  };
}
