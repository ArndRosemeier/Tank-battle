/**
 * The luminous ground grid: ONE shader-driven mesh over exactly the intact floor
 * cells, aligned to the world's cell coordinates (2 m lines, a brighter major line
 * every fifth cell), with distance falloff so the far field dissolves into the void.
 *
 * It is not a texture and not a baked image (`docs/DESIGN.md` §9): the lines come from
 * the fragment shader's world position, so a rebuild after a breach simply omits the
 * destroyed cells and the grid follows the world model. Holes are MISSING quads — the
 * void shows through — and `worldMesh` draws their glowing rims on the shared edge
 * buffer.
 *
 * The quad winding is irrelevant (the material is double-sided) but the surface is
 * deliberately opaque: world geometry is never see-through in this style.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector2,
  type Vector3,
} from 'three';
import { isSolidAt, type World } from '../core/world.ts';
import { GRID, NEON, PALETTE } from './config.ts';

export interface GridFloor {
  readonly group: Group;
  readonly mesh: Mesh;
  /** Feeds the fragment shader the camera position its distance falloff needs. */
  update(cameraPosition: Vector3): void;
  dispose(): void;
}

const GRID_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorldXZ;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uSurface;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  uniform float uCell;
  uniform float uMajorEvery;
  uniform vec2 uCameraXZ;
  uniform float uMinorFadeStart;
  uniform float uMinorFadeEnd;
  uniform float uMajorFadeStart;
  uniform float uMajorFadeEnd;

  varying vec2 vWorldXZ;

  // One-pixel-ish anti-aliased line mask in a repeating grid, using screen-space
  // derivatives so it neither aliases on the horizon nor turns into a solid band.
  // widthPixels lets the major lanes read a little heavier without drawing twice.
  float gridLine(vec2 worldXZ, float spacing, float widthPixels) {
    vec2 coord = worldXZ / spacing;
    vec2 distanceToLine = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    return 1.0 - smoothstep(0.0, widthPixels, min(distanceToLine.x, distanceToLine.y));
  }

  void main() {
    float distanceToCamera = distance(vWorldXZ, uCameraXZ);
    float minorFade = 1.0 - smoothstep(uMinorFadeStart, uMinorFadeEnd, distanceToCamera);
    float majorFade = 1.0 - smoothstep(uMajorFadeStart, uMajorFadeEnd, distanceToCamera);

    float minor = gridLine(vWorldXZ, uCell, 1.0);
    float major = gridLine(vWorldXZ, uCell * uMajorEvery, 1.15);

    vec3 color = uSurface;
    color += uMinor * (minor * minorFade);
    color += uMajor * (major * majorFade);

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Builds the grid for the world's CURRENT floor. Call it again (through
 * `WorldMesh.rebuild`) after cells are destroyed or regenerated.
 */
export function createGridFloor(world: World): GridFloor {
  const cell = GRID.cellMetres;
  const y = world.floorSurfaceHeightMetres;
  // The core's height-aware solidity query is the authority on whether the slab is
  // still there; a hole answers false at every height.
  const probeHeight = Math.max(y * 0.5, 1e-3);

  const positions: number[] = [];
  const indices: number[] = [];
  let vertices = 0;

  for (let z = 0; z < world.rows; z += 1) {
    for (let x = 0; x < world.columns; x += 1) {
      if (!isSolidAt(world, x, z, probeHeight)) {
        continue; // a hole: no quad, so the void shows through
      }
      const x0 = x * cell;
      const z0 = z * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      positions.push(
        x0, y, z0,
        x0, y, z1,
        x1, y, z1,
        x1, y, z0,
      );
      indices.push(vertices, vertices + 1, vertices + 2, vertices, vertices + 2, vertices + 3);
      vertices += 4;
    }
  }

  // A fully destroyed floor is a legal world state (A3 can rebuild into it): the
  // grid then has nothing to draw. This is not an error to swallow — there is simply
  // no surface left, and `worldMesh.rebuild` still succeeds.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);

  const material = new ShaderMaterial({
    uniforms: {
      uSurface: { value: new Color(PALETTE.gridSurface) },
      uMinor: {
        value: new Color(PALETTE.gridMinor).multiplyScalar(NEON.gridMinorGain),
      },
      uMajor: {
        value: new Color(PALETTE.gridMajor).multiplyScalar(NEON.gridMajorGain),
      },
      uCell: { value: cell },
      uMajorEvery: { value: GRID.majorEvery },
      uCameraXZ: { value: new Vector2(0, 0) },
      uMinorFadeStart: { value: GRID.minorFadeStartMetres },
      uMinorFadeEnd: { value: GRID.minorFadeEndMetres },
      uMajorFadeStart: { value: GRID.majorFadeStartMetres },
      uMajorFadeEnd: { value: GRID.majorFadeEndMetres },
    },
    vertexShader: GRID_VERTEX_SHADER,
    fragmentShader: GRID_FRAGMENT_SHADER,
    side: DoubleSide,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'grid-floor';
  mesh.visible = vertices > 0;
  const group = new Group();
  group.name = 'grid-floor-group';
  group.add(mesh);

  let disposed = false;
  return {
    group,
    mesh,
    update(cameraPosition: Vector3): void {
      material.uniforms.uCameraXZ!.value.set(cameraPosition.x, cameraPosition.z);
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
