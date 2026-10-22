import { describe, expect, it } from 'vitest';
import { ARENA, spawnCentreMetres } from './arena.ts';
import { createWorld, type CellPlacement, type WorldSpec } from '../../core/world.ts';
import { findPath } from '../../core/ai/navigation.ts';
import { isTankPositionFree } from '../../core/sim/match.ts';
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
    // The connected arena is deliberately open at the ring corners; to seal the
    // objective this pin closes the WHOLE ring, not only the authored gate cells.
    const closeRing = (start: number, end: number, heightMetres: number): void => {
      for (let x = start; x <= end; x += 1) {
        for (const z of [start, end]) {
          if (!occupied.has(`${x},${z}`)) {
            level.cells.placements!.push({ x, z, material: 'wall', heightMetres });
            occupied.add(`${x},${z}`);
          }
        }
      }
      for (let z = start + 1; z < end; z += 1) {
        for (const x of [start, end]) {
          if (!occupied.has(`${x},${z}`)) {
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

  it('all four corner spawns and the centre objective are body-reachable', () => {
    const world = createWorld(ARENA.cells);
    const centres = ARENA.spawns.map((spawn) => spawnCentreMetres(spawn));
    // A body-free cell on the central objective ring; the exact 2×2 pillar centre is
    // solid, so the objective is the open gap way beside it.
    const objective = { xMetres: 10 * 2 + 1, zMetres: 11 * 2 + 1 };
    for (const point of [...centres, objective]) {
      expect(isTankPositionFree(world, point.xMetres, point.zMetres)).toBe(true);
    }
    for (let from = 0; from < centres.length; from += 1) {
      const start = centres[from]!;
      for (let to = 0; to < centres.length; to += 1) {
        if (from === to) continue;
        const target = centres[to]!;
        expect(findPath(world, start.xMetres, start.zMetres, target.xMetres, target.zMetres)).not.toBeNull();
      }
      expect(
        findPath(world, start.xMetres, start.zMetres, objective.xMetres, objective.zMetres),
      ).not.toBeNull();
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
