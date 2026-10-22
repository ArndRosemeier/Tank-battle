import { describe, expect, it } from 'vitest';
import { CELL_SIZE_METRES, cellAt, isSolidAt, type World } from '../core/world.ts';
import { GRID } from './config.ts';
import { createShowcaseScene } from './demoWorld.ts';
import { createGridFloor } from './gridFloor.ts';

/**
 * D6's data half: a hole must be a black void quad in the grid geometry, not an
 * omitted quad that lets the bloom wash through. Whether it LOOKS black is judged in
 * the screenshot; whether the shader is FED a void is judged here.
 */
describe('grid floor holes', () => {
  it('every hole cell is a void quad, and every intact cell is a grid quad', () => {
    const scene = createShowcaseScene();
    const world: World = scene.world;
    const floor = createGridFloor(world);
    const voidAttribute = floor.mesh.geometry.getAttribute('aVoid');

    const probeHeight = Math.max(world.floorSurfaceHeightMetres * 0.5, 1e-3);
    let holeCells = 0;
    for (let z = 0; z < world.rows; z += 1) {
      for (let x = 0; x < world.columns; x += 1) {
        if (!isSolidAt(world, x, z, probeHeight)) {
          holeCells += 1;
          const quadStart = (z * world.columns + x) * 4;
          for (let vertex = 0; vertex < 4; vertex += 1) {
            expect(voidAttribute.getX(quadStart + vertex)).toBe(1);
          }
        }
      }
    }

    expect(holeCells).toBe(8);
    let voidVertices = 0;
    for (let index = 0; index < voidAttribute.count; index += 1) {
      if (voidAttribute.getX(index) > 0.5) {
        voidVertices += 1;
      }
    }
    expect(voidVertices).toBe(holeCells * 4);

    // An intact floor cell is NOT void, so the marker is data, not a global switch.
    const intactStart = (5 * world.columns + 5) * 4;
    const intact = cellAt(world, 5, 5);
    expect(intact.hp).toBeGreaterThan(0);
    expect(voidAttribute.getX(intactStart)).toBe(0);

    // The grid still covers the whole arena at the configured cell size.
    expect(floor.mesh.geometry.getAttribute('position').count).toBe(
      world.columns * world.rows * 4,
    );
    expect(GRID.cellMetres).toBe(CELL_SIZE_METRES);

    floor.dispose();
  });
});
