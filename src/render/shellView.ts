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
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shell } from '../core/sim.ts';
import { NEON, PALETTE } from './config.ts';

const MAX_SHELLS = 64;
const TRAIL_SEGMENTS = 3;
const TRAIL_METRES = 2.6;
/** The exhaust trail begins behind the ~1 m rocket body, never through it. */
const TRAIL_START_METRES = 1.05;
const VERTICES_PER_SHELL = TRAIL_SEGMENTS * 2;
const SEGMENT_FADE = [1.0, 0.4, 0.14] as const;
/** The nose sits at the sim's shell point; the body/fins trail behind it. */
const ROCKET_NOSE_OFFSET = 0.22;

/**
 * A small rocket, nose on local -Z, 52 triangles:
 * open 4-sided body (8), 4-sided nose cone (8), three box fins (36). The old shell was
 * a pure line streak; this is the visible object the line now trails behind.
 */
function paintGeometry(geometry: BufferGeometry, color: Color): void {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function createRocketGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // A dark body keeps the rocket's silhouette separate from its own white trail; the
  // nose/fins and the exhaust are the HDR parts that bloom.
  const bodyColor = new Color(PALETTE.gridMinor).multiplyScalar(0.55);
  const trimColor = new Color(PALETTE.iceWhite).multiplyScalar(1.5);
  const exhaustColor = new Color(PALETTE.lowCoverEdge).multiplyScalar(2.0);
  const body = new CylinderGeometry(0.09, 0.11, 0.44, 4, 1, true);
  body.rotateX(Math.PI / 2);
  body.translate(0, 0, 0.21);
  paintGeometry(body, bodyColor);
  parts.push(body);

  const nose = new ConeGeometry(0.11, 0.2, 4, 1, false);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0, -0.12);
  paintGeometry(nose, trimColor);
  parts.push(nose);

  for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const fin = new BoxGeometry(0.025, 0.26, 0.3);
    fin.translate(0.14, 0, 0.28);
    fin.rotateZ(angle);
    paintGeometry(fin, trimColor);
    parts.push(fin);
  }

  // A hot exhaust cone trailing behind the body; it is what makes an end-on shot read
  // as a rocket rather than a moving dot. Adds 8 triangles, total 60.
  const exhaust = new ConeGeometry(0.12, 0.4, 4, 1, true);
  exhaust.rotateX(Math.PI / 2);
  exhaust.translate(0, 0, 0.63);
  paintGeometry(exhaust, exhaustColor);
  parts.push(exhaust);

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('shellView: the rocket geometry merge failed');
  merged.computeBoundingSphere();
  return merged;
}

export interface ShellView {
  readonly group: Group;
  readonly rockets: InstancedMesh;
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

  const rocketGeometry = createRocketGeometry();
  const rocketMaterial = new MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
  });
  const rockets = new InstancedMesh(rocketGeometry, rocketMaterial, MAX_SHELLS);
  rockets.name = 'shell-rockets';
  rockets.instanceMatrix.setUsage(DynamicDrawUsage);
  rockets.frustumCulled = false;
  rockets.visible = false;
  const rocketForward = new Vector3(0, 0, -1);
  const rocketDirection = new Vector3();
  const rocketDummy = new Object3D();
  const rocketRotation = new Quaternion();

  const group = new Group();
  group.name = 'shells-group';
  group.add(lines, rockets);

  const baseColor = new Color(PALETTE.iceWhite).multiplyScalar(NEON.coreGain);
  let disposed = false;
  return {
    group,
    rockets,
    update(shells: readonly Shell[]): void {
      if (shells.length > MAX_SHELLS) {
        throw new Error(`shellView: ${shells.length} shells exceed the ${MAX_SHELLS}-streak buffer`);
      }
      let offset = 0;
      for (const shell of shells) {
        // The trail may not begin behind the muzzle: a freshly spawned shell has not
        // travelled yet, and drawing 4 m back would paint the tank with the tracer.
        const trail = Math.min(TRAIL_METRES, Math.max(0.6, shell.travelledMetres));
        const trailStart = Math.min(TRAIL_START_METRES, trail * 0.8);
        for (let segment = 0; segment < TRAIL_SEGMENTS; segment += 1) {
          const far = trailStart + ((trail - trailStart) * (segment + 1)) / TRAIL_SEGMENTS;
          const near = trailStart + ((trail - trailStart) * segment) / TRAIL_SEGMENTS;
          const fade = (SEGMENT_FADE[segment] ?? 1) * ((trail - trailStart) / TRAIL_METRES);
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
      for (let index = 0; index < shells.length; index += 1) {
        const shell = shells[index]!;
        rocketDirection.set(shell.dx, shell.dy, shell.dz);
        if (rocketDirection.lengthSq() < 1e-12) {
          rocketDirection.set(0, 0, -1);
        } else {
          rocketDirection.normalize();
        }
        rocketRotation.setFromUnitVectors(rocketForward, rocketDirection);
        rocketDummy.position.set(
          shell.x + rocketDirection.x * ROCKET_NOSE_OFFSET,
          shell.y + rocketDirection.y * ROCKET_NOSE_OFFSET,
          shell.z + rocketDirection.z * ROCKET_NOSE_OFFSET,
        );
        rocketDummy.quaternion.copy(rocketRotation);
        rocketDummy.scale.setScalar(1);
        rocketDummy.updateMatrix();
        rockets.setMatrixAt(index, rocketDummy.matrix);
      }
      rockets.count = shells.length;
      rockets.instanceMatrix.needsUpdate = true;
      rockets.visible = shells.length > 0;

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
      rocketGeometry.dispose();
      rocketMaterial.dispose();
    },
  };
}
