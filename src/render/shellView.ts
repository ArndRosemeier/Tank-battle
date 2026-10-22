/**
 * The shells in flight as ONE merged line-streak buffer. A shell is short-lived and
 * thin: a line from its current position back along its direction reads as a tracer,
 * and bloom supplies the glow. Shells render at the LATEST simulation position (no
 * interpolation); tanks are the only interpolated objects.
 *
 * The buffer is rewritten each frame and drawn in one call; empty shells hide it.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import type { Shell } from '../core/sim.ts';
import { NEON, PALETTE } from './config.ts';

const MAX_SHELLS = 64;
const STREAK_METRES = 1.8;

export interface ShellView {
  readonly group: Group;
  update(shells: readonly Shell[]): void;
  dispose(): void;
}

export function createShellView(): ShellView {
  if (MAX_SHELLS <= 0) {
    throw new Error('shellView: MAX_SHELLS must be positive');
  }
  const positions = new Float32Array(MAX_SHELLS * 2 * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);

  const material = new LineBasicMaterial({
    color: new Color(PALETTE.iceWhite).multiplyScalar(NEON.coreGain),
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.name = 'shells';
  lines.frustumCulled = false;
  lines.visible = false;

  const group = new Group();
  group.name = 'shells-group';
  group.add(lines);

  let disposed = false;
  return {
    group,
    update(shells: readonly Shell[]): void {
      if (shells.length > MAX_SHELLS) {
        throw new Error(`shellView: ${shells.length} shells exceed the ${MAX_SHELLS}-streak buffer`);
      }
      let offset = 0;
      for (const shell of shells) {
        const tailX = shell.x - shell.dx * STREAK_METRES;
        const tailY = shell.y - shell.dy * STREAK_METRES;
        const tailZ = shell.z - shell.dz * STREAK_METRES;
        positions[offset] = tailX;
        positions[offset + 1] = tailY;
        positions[offset + 2] = tailZ;
        positions[offset + 3] = shell.x;
        positions[offset + 4] = shell.y;
        positions[offset + 5] = shell.z;
        offset += 6;
      }
      geometry.setDrawRange(0, shells.length * 2);
      geometry.getAttribute('position').needsUpdate = true;
      lines.visible = shells.length > 0;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      geometry.dispose();
      material.dispose();
    },
  };
}
