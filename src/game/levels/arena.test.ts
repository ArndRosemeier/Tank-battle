import { describe, expect, it } from 'vitest';
import { ARENA, ARENA_BASE_HEIGHT_METRES, ARENA_BOUNDS } from './arena.ts';
import { DENSITY_MAX, createWorld, hasClearLine, type WorldSpec } from '../../core/world.ts';
import { findPath } from '../../core/ai/navigation.ts';
import { standingPoseAt } from '../../core/sim/terrainBody.ts';
import { validateLevel, type LevelDefinition, type LevelSpawn, type SpawnSlot } from './format.ts';

type MutableSpawn = Omit<{ -readonly [K in keyof LevelSpawn]: LevelSpawn[K] }, 'slots'> & { slots: SpawnSlot[] };

/** A deep copy of the arena that a test may break. */
function cloneArena(): { level: LevelDefinition; terrain: WorldSpec; spawns: MutableSpawn[] } {
  const terrain: WorldSpec = {
    ...ARENA.terrain,
    density: ARENA.terrain.density.slice(),
    material: ARENA.terrain.material.slice(),
  };
  const spawns: MutableSpawn[] = ARENA.spawns.map((spawn) => ({ ...spawn, slots: spawn.slots.map((slot) => ({ ...slot })) }));
  return { level: { name: ARENA.name, intent: ARENA.intent, terrain, spawns }, terrain, spawns };
}

/** Makes every sample whose horizontal distance from (cx, cz) is within [inner, outer] solid. */
function solidRing(terrain: WorldSpec, cx: number, cz: number, inner: number, outer: number): void {
  const { samplesX: nx, samplesY: ny, samplesZ: nz, spacingMetres: s } = terrain;
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const d = Math.hypot(i * s - cx, k * s - cz);
      if (d < inner || d > outer) continue;
      for (let j = 0; j < ny; j += 1) terrain.density[j + ny * (i + nx * k)] = DENSITY_MAX;
    }
  }
}

describe('the authored arena', () => {
  it('passes every load-time check', () => {
    expect(() => validateLevel(ARENA)).not.toThrow();
    expect(ARENA.spawns).toHaveLength(4);
    const world = createWorld(ARENA.terrain);
    expect(world.widthMetres).toBe(ARENA_BOUNDS.maxX);
    for (const spawn of ARENA.spawns) {
      expect(spawn.slots).toHaveLength(4);
      for (const slot of spawn.slots) {
        const pose = standingPoseAt(world, slot.xMetres, slot.zMetres, spawn.yawDegrees, world.heightMetres);
        expect(pose).not.toBeNull();
        expect(pose!.y).toBeCloseTo(ARENA_BASE_HEIGHT_METRES, 0);
      }
    }
  });

  it('has hills, caves and crystal: real relief, not a flat floor', () => {
    const world = createWorld(ARENA.terrain);
    const centre = world.widthMetres / 2;
    // The summit stands well above the pads, and the cavern under it is open air.
    const summit = standingPoseAt(world, centre, centre, 0, world.heightMetres);
    expect(summit).not.toBeNull();
    expect(summit!.y).toBeGreaterThan(ARENA_BASE_HEIGHT_METRES + 5);
    const cavern = standingPoseAt(world, centre, centre, 0, ARENA_BASE_HEIGHT_METRES + 2);
    expect(cavern).not.toBeNull();
    expect(cavern!.y).toBeLessThan(ARENA_BASE_HEIGHT_METRES + 1);
    expect(Array.from(ARENA.terrain.material).some((material) => material === 1)).toBe(true);
  });

  it('rejects overlapping spawn slots', () => {
    const { level, spawns } = cloneArena();
    spawns[1]!.slots[0] = { ...spawns[0]!.slots[0]! };
    expect(() => validateLevel(level)).toThrow(/overlaps a slot of spawn 0/);
  });

  it('rejects a slot with no room for a tank', () => {
    const { level, spawns } = cloneArena();
    spawns[0]!.slots[0] = { xMetres: -5, zMetres: 10 };
    expect(() => validateLevel(level)).toThrow(/spawn 0 slot 0 .* has no room for a tank/);
  });

  it('rejects a slot on a slope', () => {
    const { level, spawns } = cloneArena();
    spawns[0]!.slots[0] = { xMetres: 25, zMetres: 25 };
    expect(() => validateLevel(level)).toThrow(/spawn 0 slot 0/);
  });

  it('names a single asymmetric sample', () => {
    const { level, terrain } = cloneArena();
    const index = 5 + terrain.samplesY * (3 + terrain.samplesX * 10);
    terrain.density[index] = terrain.density[index] === 0 ? 255 : 0;
    expect(() => validateLevel(level)).toThrow(/symmetry break at sample/);
  });

  it('rejects pads that do not rotate onto each other', () => {
    const { level, spawns } = cloneArena();
    spawns[1] = { ...spawns[1]!, xMetres: spawns[1]!.xMetres + 1 };
    expect(() => validateLevel(level)).toThrow(/spawn symmetry break/);
  });

  it('rejects spawns that are walled off from each other', () => {
    const { level, terrain } = cloneArena();
    for (const spawn of ARENA.spawns) solidRing(terrain, spawn.xMetres, spawn.zMetres, 7, 9);
    expect(() => validateLevel(level)).toThrow(/is not connected on foot/);
  });

  it('rejects a sealed-off centre', () => {
    const { level, terrain } = cloneArena();
    const centre = (terrain.samplesX - 1) * terrain.spacingMetres / 2;
    solidRing(terrain, centre, centre, 20, 22);
    expect(() => validateLevel(level)).toThrow(/arena centre is not reachable/);
  });

  it('no pad has a clear straight line to another pad', () => {
    const world = createWorld(ARENA.terrain);
    const eye = ARENA_BASE_HEIGHT_METRES + 1.6;
    for (const a of ARENA.spawns) {
      for (const b of ARENA.spawns) {
        if (a === b) continue;
        expect(hasClearLine(world, { x: a.xMetres, y: eye, z: a.zMetres }, { x: b.xMetres, y: eye, z: b.zMetres })).toBe(false);
      }
    }
  });

  it('every pad reaches every other pad and the summit on foot', () => {
    const world = createWorld(ARENA.terrain);
    const point = (spawn: LevelSpawn) => ({ x: spawn.slots[0]!.xMetres, y: ARENA_BASE_HEIGHT_METRES, z: spawn.slots[0]!.zMetres });
    const centre = world.widthMetres / 2;
    const summit = { x: centre, y: world.heightMetres, z: centre };
    for (const from of ARENA.spawns) {
      for (const to of ARENA.spawns) {
        if (from === to) continue;
        expect(findPath(world, 0, point(from), point(to))).not.toBeNull();
      }
      expect(findPath(world, 0, point(from), summit)).not.toBeNull();
    }
  });
});
