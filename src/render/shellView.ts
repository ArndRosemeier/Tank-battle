/**
 * The shells in flight as ONE merged line-streak buffer. Each shell draws three short
 * fading segments from its current position back along its direction: a tail that
 * reads as motion, not a single 1.8 m tick. Bloom supplies the glow.
 *
 * Shells render at the LATEST simulation position (no interpolation); tanks are the
 * only interpolated objects. The buffer is rewritten each frame and drawn in one call;
 * empty shells hide it.
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
const TRAIL_SEGMENTS = 3;
const TRAIL_METRES = 4.2;
const VERTICES_PER_SHELL = TRAIL_SEGMENTS * 2;
const SEGMENT_FADE = [0.9, 0.32, 0.1] as const;

export interface ShellView {
  readonly group: Group;
  update(shells: readonly Shell[]): void;
  dispose(): void;
}

export function createShellView(): ShellView {
  if (MAX_SHELLS <= 0) {
    throw new Error('shellView: MAX_SHELLS must be positive');
  }
  const positions = new Float32Array(MAX_SHELLS * VERTICES_PER_SHELL * 3);
  const colors = new Float32Array(MAX_SHELLS * VERTICES_PER_SHELL * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setDrawRange(0, 0);

  const material = new LineBasicMaterial({
    vertexColors: true,
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

  const baseColor = new Color(PALETTE.iceWhite).multiplyScalar(NEON.coreGain);
  let disposed = false;
  return {
    group,
    update(shells: readonly Shell[]): void {
      if (shells.length > MAX_SHELLS) {
        throw new Error(`shellView: ${shells.length} shells exceed the ${MAX_SHELLS}-streak buffer`);
      }
      let offset = 0;
      for (const shell of shells) {
        // The trail may not begin behind the muzzle: a freshly spawned shell has not
        // travelled yet, and drawing 4 m back would paint the tank with the tracer.
        const trail = Math.min(TRAIL_METRES, Math.max(0.6, shell.travelledMetres));
        for (let segment = 0; segment < TRAIL_SEGMENTS; segment += 1) {
          const far = (trail * (segment + 1)) / TRAIL_SEGMENTS;
          const near = (trail * segment) / TRAIL_SEGMENTS;
          const fade = (SEGMENT_FADE[segment] ?? 1) * (trail / TRAIL_METRES);
          // Two vertices per segment: the far (dim) end then the near (bright) end.
          positions[offset] = shell.x - shell.dx * far;
          positions[offset + 1] = shell.y - shell.dy * far;
          positions[offset + 2] = shell.z - shell.dz * far;
          positions[offset + 3] = shell.x - shell.dx * near;
          positions[offset + 4] = shell.y - shell.dy * near;
          positions[offset + 5] = shell.z - shell.dz * near;
          for (let vertex = 0; vertex < 2; vertex += 1) {
            const boost = vertex === 0 ? fade * 0.55 : fade;
            colors[offset + vertex * 3] = baseColor.r * boost;
            colors[offset + vertex * 3 + 1] = baseColor.g * boost;
            colors[offset + vertex * 3 + 2] = baseColor.b * boost;
          }
          offset += 6;
        }
      }
      geometry.setDrawRange(0, shells.length * VERTICES_PER_SHELL);
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('color').needsUpdate = true;
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
