/**
 * The A2 placeholder tank: an angular near-black hull and turret with team-coloured
 * neon trim, about 4 m long. It is deliberately NOT a game entity — no gun, no HP, no
 * controller; A3 owns drive/aim/fire. Its only job is to give the camera a subject and
 * to make the 16-tank performance case real.
 *
 * The silhouette is authored, not lit (§9): a low chassis, a chevron nose, side pods
 * and a six-sided turret all draw their edges from `NeonSurface`, with an ice-white
 * muzzle and thruster pods as the only hot cores. Two surfaces per tank (hull, and
 * turret+barrel so the turret can turn) cost six draw calls each.
 */

import { BoxGeometry, CylinderGeometry, Group, type BufferGeometry } from 'three';
import { NEON, PALETTE, TANK, teamColor } from './config.ts';
import { createNeonSurface, type NeonSurface, type SurfacePart } from './neonSurface.ts';

export interface PlaceholderTank {
  readonly group: Group;
  readonly turret: Group;
  /** Advances the trivial turret sweep. `elapsedSeconds` comes from the fixed loop. */
  sweep(elapsedSeconds: number): void;
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
  const gain = NEON.teamEdgeGain;
  const core = { color: PALETTE.iceWhite, gain: NEON.coreGain };

  const hullParts: SurfacePart[] = [
    // Low chassis and the narrower under-skirt below it: two horizontal lines.
    {
      geometry: box(TANK.hullWidthMetres, TANK.hullHeightMetres, TANK.hullLengthMetres, 0, 0.62, 0),
      color,
      gain,
    },
    { geometry: box(1.9, 0.28, 2.8, 0, 0.31, 0.1), color, gain },
    // Chevron nose: two angled blades meeting in front, the tank's signature.
    { geometry: box(0.28, 0.14, 1.6, 0.92, 0.68, -1.55, 0, 0.34), color, gain },
    { geometry: box(0.28, 0.14, 1.6, -0.92, 0.68, -1.55, 0, -0.34), color, gain },
    // Flush side rails and a rear deck line: angular detail without a crate on top.
    { geometry: box(0.18, 0.12, 2.7, 1.05, 0.88, 0.15), color, gain },
    { geometry: box(0.18, 0.12, 2.7, -1.05, 0.88, 0.15), color, gain },
    { geometry: box(1.9, 0.1, 0.85, 0, 0.88, 1.3), color, gain },
    // Outboard pods widen the footprint and add a second vertical line each side.
    { geometry: box(0.34, 0.26, 2.2, 1.28, 0.46, 0.1), color, gain },
    { geometry: box(0.34, 0.26, 2.2, -1.28, 0.46, 0.1), color, gain },
    // Rear thruster slits: small ice-white cores, never a headlight-sized block.
    { geometry: box(0.3, 0.08, 0.2, 0.8, 0.6, 1.79), ...core },
    { geometry: box(0.3, 0.08, 0.2, -0.8, 0.6, 1.79), ...core },
  ];

  const turretGeometry = new CylinderGeometry(
    TANK.turretWidthMetres * 0.42,
    TANK.turretWidthMetres * 0.56,
    TANK.turretHeightMetres,
    6,
    1,
    false,
  );
  turretGeometry.rotateY(Math.PI / 6);
  turretGeometry.translate(0, 0.29, 0.02);

  const turretParts: SurfacePart[] = [
    { geometry: turretGeometry, color, gain },
    // Rear turret bustle: weight at the back, and a second turret line.
    { geometry: box(1.0, 0.3, 0.55, 0, 0.3, 0.75), color, gain },
    // Mantlet, barrel and an ice-white muzzle brake.
    { geometry: box(0.52, 0.36, 0.44, 0, 0.3, -0.55), color, gain },
    {
      geometry: box(0.2, 0.2, TANK.barrelLengthMetres, 0, 0.3, -1.2),
      color,
      gain,
    },
    { geometry: box(0.36, 0.36, 0.3, 0, 0.3, -2.15), ...core },
    // Sensor mast: a thin vertical line above the turret.
    { geometry: box(0.09, 0.34, 0.09, 0.38, 0.62, 0.05), ...core },
  ];

  const group = new Group();
  group.name = `tank-team-${teamIndex}`;

  const hullSurface: NeonSurface = createNeonSurface(hullParts);
  group.add(hullSurface.group);

  const turret = new Group();
  turret.name = 'turret';
  turret.position.set(0, 0.87, -0.12);
  const turretSurface: NeonSurface = createNeonSurface(turretParts);
  turret.add(turretSurface.group);
  group.add(turret);

  const surfaces = [hullSurface, turretSurface];
  const sweepAngularSpeed = (Math.PI * 2) / TANK.sweepPeriodSeconds;

  return {
    group,
    turret,
    sweep(elapsedSeconds: number): void {
      turret.rotation.y = Math.sin(elapsedSeconds * sweepAngularSpeed + phase) * TANK.sweepRadians;
    },
    dispose(): void {
      for (const surface of surfaces) {
        surface.dispose();
      }
      group.clear();
    },
  };
}
