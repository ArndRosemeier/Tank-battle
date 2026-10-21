import { Group, LineSegments, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng.ts';
import {
  MATERIAL_PROFILES,
  cellAt,
  damageCell,
} from '../core/world.ts';
import { createShowcaseScene } from './demoWorld.ts';
import { createWorldMesh } from './worldMesh.ts';

describe('worldMesh', () => {
  it("the world's cells collapse into ONE fill mesh and ONE edge buffer, and a rebuild re-derives them from the world", () => {
    const scene = createShowcaseScene();
    const world = scene.world;
    const worldMesh = createWorldMesh(world);

    const neonGroup = worldMesh.group.getObjectByName('neon-surface');
    expect(neonGroup).toBeInstanceOf(Group);
    if (!(neonGroup instanceof Group)) {
      throw new Error('worldMesh test: the merged surface group is missing');
    }

    const fills = neonGroup.children.filter((child) => child instanceof Mesh);
    const lines = neonGroup.children.filter((child) => child instanceof LineSegments);
    expect(fills).toHaveLength(2); // the fill and the rim drawing of it
    expect(lines).toHaveLength(1); // every structural edge plus every hole rim

    const meshCount = countDrawables(worldMesh.group, Mesh);
    const lineCount = countDrawables(worldMesh.group, LineSegments);
    expect(meshCount).toBe(3); // one grid floor, one fill, one rim
    expect(lineCount).toBe(1);

    const before = lineVertexCount(worldMesh.group);

    // Destroy one intact floor cell through the core's only damage path, then rebuild.
    const cell = cellAt(world, 5, 5);
    expect(cell.material).toBe('floor');
    expect(cell.hp).toBeGreaterThan(0);
    const result = damageCell(world, 5, 5, MATERIAL_PROFILES.floor.maxHp, createRng(7));
    expect(result.destroyedNow).toBe(true);

    worldMesh.rebuild();

    // The new hole contributes a four-sided rim: 4 segments × 2 vertices.
    expect(lineVertexCount(worldMesh.group)).toBe(before + 8);
    expect(countDrawables(worldMesh.group, Mesh)).toBe(3);
    expect(countDrawables(worldMesh.group, LineSegments)).toBe(1);

    worldMesh.dispose();
  });
});

function countDrawables(root: Group, kind: abstract new (...args: never[]) => object): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof kind) {
      count += 1;
    }
  });
  return count;
}

function lineVertexCount(root: Group): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof LineSegments) {
      count += object.geometry.getAttribute('position').count;
    }
  });
  return count;
}
