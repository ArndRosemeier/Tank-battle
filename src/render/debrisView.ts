/**
 * The A1 debris the world mesh does not own: static big blocks (rubble) and small
 * floor shards. Rebuilt only when `world.revision` changes; merged into ONE
 * `NeonSurface` so even dozens of shards cost the usual fill/rim/edge draw calls.
 */

import { BoxGeometry, Group } from 'three';
import {
  CELL_SIZE_METRES,
  listBlocks,
  listShards,
  type World,
} from '../core/world.ts';
import { NEON, PALETTE } from './config.ts';
import { createNeonSurface, type NeonSurface, type SurfacePart } from './neonSurface.ts';

export interface DebrisView {
  readonly group: Group;
  /** Re-derives the merged buffers from the world's CURRENT blocks/shards. */
  rebuild(): void;
  dispose(): void;
}

export function createDebrisView(world: World): DebrisView {
  const group = new Group();
  group.name = 'debris';
  let surface: NeonSurface | null = null;

  const clear = (): void => {
    surface?.dispose();
    surface = null;
    group.clear();
  };

  const rebuild = (): void => {
    clear();
    const parts: SurfacePart[] = [];
    const cell = CELL_SIZE_METRES;

    for (const block of listBlocks(world)) {
      const geometry = new BoxGeometry(cell, block.heightMetres, cell);
      geometry.translate((block.x + 0.5) * cell, block.heightMetres / 2, (block.z + 0.5) * cell);
      parts.push({
        geometry,
        color: block.material === 'wall' ? PALETTE.wallEdge : PALETTE.pillarEdge,
      });
    }

    for (const shard of listShards(world)) {
      const angle = (shard.mirrorAngleDegrees * Math.PI) / 180;
      const geometry = new BoxGeometry(0.42, 0.08, 0.18);
      geometry.rotateY(angle);
      geometry.translate(
        (shard.x + 0.5) * cell + Math.cos(angle) * 0.28,
        world.floorSurfaceHeightMetres + 0.06,
        (shard.z + 0.5) * cell + Math.sin(angle) * 0.28,
      );
      parts.push({ geometry, color: PALETTE.holeRim, gain: NEON.holeRimInnerGain });
    }

    if (parts.length > 0) {
      surface = createNeonSurface(parts);
      group.add(surface.group);
    }
  };

  rebuild();
  let disposed = false;
  return {
    group,
    rebuild,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
