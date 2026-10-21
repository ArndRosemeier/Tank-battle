/**
 * Scene-build statistics for the GPU-independent budget (ledger row 31).
 *
 * This host has no reachable GPU, so a frame-rate number cannot gate a landing. The
 * proxy is the scene the renderer is asked to draw: the number of draw objects, the
 * triangle total and the vertex total. `sceneBudget.test.ts` builds the SAME showcase
 * scene the app builds and pins these numbers with 20 % headroom.
 *
 * This module is pure geometry — no renderer, no DOM — so it runs in `node`.
 */

import { LineSegments, Mesh, Points, type Object3D } from 'three';

export interface SceneStats {
  /** Mesh + line + point draw objects; one `renderer.render` call each, before culling. */
  readonly drawObjects: number;
  readonly meshObjects: number;
  readonly lineObjects: number;
  readonly triangles: number;
  /** Mesh vertices + line vertices. */
  readonly vertices: number;
}

/** Counts what the renderer would be asked to draw under `root`. */
export function measureScene(root: Object3D): SceneStats {
  let drawObjects = 0;
  let meshObjects = 0;
  let lineObjects = 0;
  let triangles = 0;
  let vertices = 0;

  root.traverse((object) => {
    if (!isVisibleInTree(object)) {
      return;
    }
    if (object instanceof Mesh) {
      drawObjects += 1;
      meshObjects += 1;
      const position = object.geometry.getAttribute('position');
      const index = object.geometry.getIndex();
      if (position) {
        vertices += position.count;
        triangles += index ? index.count / 3 : position.count / 3;
      }
      return;
    }
    if (object instanceof LineSegments || object instanceof Points) {
      drawObjects += 1;
      if (object instanceof LineSegments) {
        lineObjects += 1;
      }
      const position = object.geometry.getAttribute('position');
      if (position) {
        vertices += position.count;
      }
    }
  });

  return { drawObjects, meshObjects, lineObjects, triangles, vertices };
}

function isVisibleInTree(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }
  return true;
}
