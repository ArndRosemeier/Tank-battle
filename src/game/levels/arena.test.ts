import { describe, expect, it } from 'vitest';
import { ARENA, spawnCentreMetres } from './arena.ts';
import type { CellPlacement, WorldSpec } from '../../core/world.ts';
import { validateLevel, type LevelSpawn } from './format.ts';

type MutableSpawn = { -readonly [K in keyof LevelSpawn]: LevelSpawn[K] };
type MutableLevel = {
  name: string;
  intent: string;
  cells: WorldSpec & { readonly columns: number; readonly rows: number; readonly floorSurfaceHeightMetres: number; placements: CellPlacement[] };
  spawns: MutableSpawn[];
};

function cloneArena(): MutableLevel {
  return {
    name: ARENA.name,
    intent: ARENA.intent,
    cells: {
      columns: ARENA.cells.columns,
      rows: ARENA.cells.rows,
      floorSurfaceHeightMetres: ARENA.cells.floorSurfaceHeightMetres,
      placements: (ARENA.cells.placements ?? []).map((placement) => ({ ...placement })),
    },
    spawns: ARENA.spawns.map((spawn) => ({ ...spawn })),
  };
}

describe('the authored arena', () => {
  it('the authored arena passes every load-time check', () => {
    expect(() => validateLevel(ARENA)).not.toThrow();
    expect(ARENA.spawns).toHaveLength(4);
    for (const spawn of ARENA.spawns) {
      expect(spawn.zoneWidth).toBe(2);
      expect(spawn.zoneHeight).toBe(2);
      const centre = spawnCentreMetres(spawn);
      expect(Number.isFinite(centre.xMetres)).toBe(true);
      expect(Number.isFinite(centre.zMetres)).toBe(true);
    }
  });

  it('a level with an overlapping spawn is rejected', () => {
    const level = cloneArena();
    level.spawns[1]!.zoneX = 3; // overlaps team 0's 2×2 zone at (2,2)
    expect(() => validateLevel(level)).toThrow(/overlaps another spawn at \(3, 2\)/);
  });

  it('a level whose spawns are not all connected on foot is rejected', () => {
    const level = cloneArena();
    // Seal the NW spawn: the room is walled north/south and its screened corridor
    // is east; close the corridor mouth AND the camera recess west of the zone, and
    // the 2×2 zone is an island. These four cells are deliberately free in the arena.
    for (const x of [1, 4]) {
      level.cells.placements!.push({ x, z: 2, material: 'wall', heightMetres: 3 });
      level.cells.placements!.push({ x, z: 3, material: 'wall', heightMetres: 3 });
    }
    expect(() => validateLevel(level)).toThrow(/spawn \d+ is not connected on foot/);
  });

  it('rejects a level whose centre objective is sealed off', () => {
    const level = cloneArena();
    const occupied = new Set(level.cells.placements!.map((placement) => `${placement.x},${placement.z}`));
    const closeRing = (start: number, end: number, heightMetres: number): void => {
      const isGate = (x: number, z: number): boolean => {
        const nearX = x <= start + 1 || x >= end - 1;
        const nearZ = z <= start + 1 || z >= end - 1;
        return nearX && nearZ;
      };
      for (let x = start; x <= end; x += 1) {
        for (const z of [start, end]) {
          if (isGate(x, z) && !occupied.has(`${x},${z}`)) {
            level.cells.placements!.push({ x, z, material: 'wall', heightMetres });
            occupied.add(`${x},${z}`);
          }
        }
      }
      for (let z = start + 1; z < end; z += 1) {
        for (const x of [start, end]) {
          if (isGate(x, z) && !occupied.has(`${x},${z}`)) {
            level.cells.placements!.push({ x, z, material: 'wall', heightMetres });
            occupied.add(`${x},${z}`);
          }
        }
      }
    };
    closeRing(5, 18, 4.8);
    closeRing(8, 15, 4.2);
    expect(() => validateLevel(level)).toThrow(/arena centre cell .* is not reachable/);
  });

  it('the arena grid is invariant under 90° rotation', () => {
    // The validator's symmetry branch is the direct check; a single asymmetric cell
    // must be named by cell.
    expect(() => validateLevel(ARENA)).not.toThrow();
    const broken = cloneArena();
    broken.cells.placements!.push({ x: 1, z: 10, material: 'pillar', heightMetres: 2.2 });
    expect(() => validateLevel(broken)).toThrow(/symmetry break at \(1, 10\)/);
  });

  it('no spawn has a clear straight line to another spawn', () => {
    // The brief's spawn rule: the protected exit must not face an enemy spawn
    // directly. A conservative sample of the centre line checks both cells on a
    // boundary, so a screen wall that merely touches the line still blocks it.
    const solid = new Set((ARENA.cells.placements ?? []).map((placement) => `${placement.x},${placement.z}`));
    const centres = ARENA.spawns.map((spawn) => ({
      x: spawn.zoneX + spawn.zoneWidth / 2,
      z: spawn.zoneZ + spawn.zoneHeight / 2,
    }));
    const blocked = (a: { x: number; z: number }, b: { x: number; z: number }): boolean => {
      const steps = 600;
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        for (const cx of [Math.floor(x), Math.ceil(x)]) {
          for (const cz of [Math.floor(z), Math.ceil(z)]) {
            if (solid.has(`${cx},${cz}`)) return true;
          }
        }
      }
      return false;
    };
    for (let a = 0; a < centres.length; a += 1) {
      for (let b = a + 1; b < centres.length; b += 1) {
        expect(blocked(centres[a]!, centres[b]!)).toBe(true);
      }
    }
  });

  it('every spawn zone is free of solid cells', () => {
    const broken = cloneArena();
    broken.cells.placements!.push({ x: 2, z: 2, material: 'wall', heightMetres: 2 });
    expect(() => validateLevel(broken)).toThrow(/spawn 0 zone cell \(2, 2\) is not free floor/);
  });

  it('rejects an off-grid or illegal material before a world is built', () => {
    const offGrid = cloneArena();
    offGrid.cells.placements!.push({ x: 24, z: 2, material: 'wall', heightMetres: 2 });
    expect(() => validateLevel(offGrid)).toThrow(/outside the 24×24 grid/);

    const low = cloneArena();
    low.cells.placements!.push({ x: 1, z: 10, material: 'wall', heightMetres: 0.1 });
    expect(() => validateLevel(low)).toThrow(/must be above the floor/);
  });
});
