/**
 * Builds the scene from the REAL A1 world — `cellAt` for material and height, and the
 * core's height-aware `isSolidAt` for "is this still material?" — and collapses it
 * into a handful of draw calls:
 *
 *  - every wall/pillar box is merged into ONE fill geometry (one draw call), ONE rim
 *    drawing of that geometry (one draw call) and ONE edge-line buffer (one draw call);
 *  - every hole rim is merged into the SAME edge-line buffer, so the world's whole
 *    edge identity costs one line draw;
 *  - the floor is the single shader grid from `gridFloor.ts`.
 *
 * Hundreds of cells must never become hundreds of meshes. A3 rebuilds this after
 * destruction/regeneration; that is why `rebuild()` is the ONE rebuild path and every
 * buffer is re-derived from the world, never patched in place.
 *
 * Big blocks are NOT drawn here: their two debris tiers are A3's destruction VFX
 * (`docs/DESIGN.md` §8). A hole with a block over it is a floor hole for this slice.
 */

import { BoxGeometry, Group, Vector3 } from 'three';
import { cellAt, cellState, isSolidAt, type World } from '../core/world.ts';
import { GRID, PALETTE } from './config.ts';
import { createGridFloor, type GridFloor } from './gridFloor.ts';
import {
  createNeonSurface,
  type LineSegmentBatch,
  type NeonSurface,
  type SurfacePart,
} from './neonSurface.ts';

export interface WorldMesh {
  readonly group: Group;
  /**
   * THE rebuild path. Re-reads every cell and rebuilds the merged buffers — A3 calls
   * this once after a breach or a regeneration, never per frame.
   */
  rebuild(): void;
  /** Feeds the floor grid's distance falloff. Call once per frame with the camera. */
  update(cameraPosition: Vector3): void;
  dispose(): void;
}

/** Builds the mesh for the world's current state. */
export function createWorldMesh(world: World): WorldMesh {
  const group = new Group();
  group.name = 'world';

  let surface: NeonSurface | null = null;
  let floor: GridFloor | null = null;

  const clear = (): void => {
    surface?.dispose();
    surface = null;
    floor?.dispose();
    floor = null;
    group.clear();
  };

  const rebuild = (): void => {
    clear();

    const parts: SurfacePart[] = [];
    const rimSegments: number[] = [];
    const holes = new Set<string>();
    const cellSize = GRID.cellMetres;
    const holeRimHeight = world.floorSurfaceHeightMetres + 0.012;
    const floorProbeHeight = Math.max(world.floorSurfaceHeightMetres * 0.5, 1e-3);

    for (let z = 0; z < world.rows; z += 1) {
      for (let x = 0; x < world.columns; x += 1) {
        const cell = cellAt(world, x, z);
        if (cellState(cell) === 'hole') {
          holes.add(`${x},${z}`);
          continue;
        }

        if (cell.material === 'floor') {
          // The grid draws the floor; the height-aware query is the authority on
          // whether the slab survived, so a floor cell missing here is a real hole.
          if (!isSolidAt(world, x, z, floorProbeHeight)) {
            holes.add(`${x},${z}`);
          }
          continue;
        }

        // A wall/pillar still stands only while the core reports material below its
        // authored top. The height IS level data; the box extrudes to it unchanged.
        const topMetres = cell.heightMetres;
        if (!isSolidAt(world, x, z, topMetres - 1e-3)) {
          continue;
        }
        const geometry = new BoxGeometry(cellSize, topMetres, cellSize);
        geometry.translate((x + 0.5) * cellSize, topMetres / 2, (z + 0.5) * cellSize);
        parts.push({
          geometry,
          color: cell.material === 'wall' ? PALETTE.wallEdge : PALETTE.pillarEdge,
        });
      }
    }

    // A hole's rim is only its BOUNDARY: neighbouring holes share no line, so a
    // cluster reads as one wound instead of a grid of little squares.
    for (const key of holes) {
      const [xText, zText] = key.split(',');
      const x = Number(xText);
      const z = Number(zText);
      const x0 = x * cellSize;
      const z0 = z * cellSize;
      const x1 = x0 + cellSize;
      const z1 = z0 + cellSize;
      const sides = [
        { neighbour: `${x},${z - 1}`, from: [x0, z0], to: [x1, z0] },
        { neighbour: `${x},${z + 1}`, from: [x0, z1], to: [x1, z1] },
        { neighbour: `${x - 1},${z}`, from: [x0, z0], to: [x0, z1] },
        { neighbour: `${x + 1},${z}`, from: [x1, z0], to: [x1, z1] },
      ] as const;
      for (const side of sides) {
        // A side is a boundary when the neighbour is outside the arena (its key is
        // not in the set) or is not itself a hole. Neighbouring holes share no line.
        if (holes.has(side.neighbour)) {
          continue;
        }
        rimSegments.push(
          side.from[0],
          holeRimHeight,
          side.from[1],
          side.to[0],
          holeRimHeight,
          side.to[1],
        );
      }
    }

    const extraLineSegments: LineSegmentBatch[] = [];
    if (rimSegments.length > 0) {
      extraLineSegments.push({
        positions: new Float32Array(rimSegments),
        color: PALETTE.holeRim,
      });
    }

    floor = createGridFloor(world);
    group.add(floor.group);

    // Even with every wall destroyed, the hole rims still own the edge buffer: the
    // factory accepts an edge-only surface precisely so a rebuild cannot fall over.
    if (parts.length > 0 || extraLineSegments.length > 0) {
      surface = createNeonSurface(parts, { extraLineSegments });
      group.add(surface.group);
    }
  };

  rebuild();

  let disposed = false;
  return {
    group,
    rebuild,
    update(cameraPosition: Vector3): void {
      floor?.update(cameraPosition);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
