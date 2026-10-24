import { describe, expect, it } from 'vitest';
import {
  DENSITY_ISO,
  DENSITY_MAX,
  MATERIAL_CRYSTAL,
  RUBBLE_DENSITY_FACTOR,
  blastTerrain,
  boxTerrain,
  buildTerrain,
  collapseTerrain,
  createWorld,
  crushDamage,
  densityAt,
  flatTerrain,
  groundBelow,
  hashState,
  isSolidAt,
  raycastTerrain,
  sampleDensity,
  stepWorld,
  type Occupant,
  type World,
  type WorldSpec,
} from './world.ts';

const GROUND = 3;

function flat(): World {
  return createWorld(flatTerrain(16, 16, GROUND));
}

/** Flat ground plus a free-floating block of rock `size` metres on a side, 6 m up. */
function floating(size: number, at = { x: 12, z: 12 }): World {
  return createWorld(
    buildTerrain({
      cellsX: 16,
      cellsY: 10,
      cellsZ: 16,
      sample: (x, y, z) => {
        const half = size / 2;
        const block = Math.min(half - Math.abs(x - at.x), half - Math.abs(z - at.z), half - Math.abs(y - (9 + half)));
        return { solidity: Math.max(GROUND - y, block) };
      },
    }),
  );
}

/** Runs the world until no chunk is falling (or the guard trips). */
function settle(world: World, occupants: readonly Occupant[] = []): ReturnType<typeof stepWorld>[] {
  const results: ReturnType<typeof stepWorld>[] = [];
  for (let tick = 0; tick < 600 && world.chunks.length > 0; tick += 1) results.push(stepWorld(world, occupants));
  expect(world.chunks).toHaveLength(0);
  return results;
}

describe('the terrain lattice', () => {
  it('rejects malformed specs loudly', () => {
    const spec = flatTerrain(4, 4, GROUND);
    expect(() => createWorld({ ...spec, density: spec.density.slice(1) })).toThrow(/density must be a Uint8Array/);
    const noBedrock: WorldSpec = { ...spec, density: spec.density.slice() };
    noBedrock.density[0] = 0;
    expect(() => createWorld(noBedrock)).toThrow(/must be full-density bedrock/);
    expect(() => createWorld({ ...spec, spacingMetres: 0 })).toThrow(/spacingMetres/);
  });

  it('answers solid, ground and density queries on a flat field', () => {
    const world = flat();
    expect(isSolidAt(world, 10, GROUND - 0.2, 10)).toBe(true);
    expect(isSolidAt(world, 10, GROUND + 0.2, 10)).toBe(false);
    expect(groundBelow(world, 10, 10, 10)).toBeCloseTo(GROUND, 1);
    // Below the lattice is solid, beyond its sides and top is air.
    expect(isSolidAt(world, 10, -1, 10)).toBe(true);
    expect(isSolidAt(world, -1, GROUND - 1, 10)).toBe(false);
    expect(densityAt(world, 10, GROUND, 10)).toBeCloseTo(DENSITY_ISO, -1);
  });

  it('a raycast stops at the surface', () => {
    const world = flat();
    const hit = raycastTerrain(world, { x: 5, y: 10, z: 5 }, { x: 15, y: 0, z: 15 });
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(GROUND, 1);
    expect(hit!.x).toBeCloseTo(5 + (10 - GROUND), 1);
    expect(raycastTerrain(world, { x: 5, y: 10, z: 5 }, { x: 15, y: 8, z: 15 })).toBeNull();
  });
});

describe('craters', () => {
  it('a blast carves a crater around its centre and reports what it broke', () => {
    const world = flat();
    const revision = world.revision;
    const blast = blastTerrain(world, 12, GROUND, 12);
    expect(blast.samplesDestroyed).toBeGreaterThan(0);
    expect(blast.samplesDamaged).toBeGreaterThanOrEqual(blast.samplesDestroyed);
    expect(world.revision).toBeGreaterThan(revision);
    expect(isSolidAt(world, 12, GROUND - 0.5, 12)).toBe(false);
    expect(isSolidAt(world, 18, GROUND - 0.5, 18)).toBe(true);
    expect(groundBelow(world, 12, 12, 10)).toBeLessThan(GROUND - 0.8);
  });

  it('never breaks the bedrock layer', () => {
    const world = flat();
    for (let n = 0; n < 6; n += 1) blastTerrain(world, 12, 0, 12, 4, 2000);
    for (let i = 0; i < world.nx; i += 1) {
      for (let k = 0; k < world.nz; k += 1) expect(sampleDensity(world, i, 0, k)).toBe(DENSITY_MAX);
    }
  });

  it('crystal resists a blast that breaks plain rock', () => {
    const rock = createWorld(boxTerrain(16, 16, GROUND, [{ minX: 9, maxX: 15, minZ: 9, maxZ: 15, topMetres: GROUND + 4 }]));
    const crystal = createWorld(
      boxTerrain(16, 16, GROUND, [{ minX: 9, maxX: 15, minZ: 9, maxZ: 15, topMetres: GROUND + 4, material: MATERIAL_CRYSTAL }]),
    );
    const inRock = blastTerrain(rock, 9, GROUND + 2, 12);
    const inCrystal = blastTerrain(crystal, 9, GROUND + 2, 12);
    expect(inCrystal.samplesDestroyed).toBeLessThan(inRock.samplesDestroyed);
  });
});

describe('collapse and falling rock', () => {
  it('a small unsupported piece crumbles to dust', () => {
    const world = floating(1.6);
    const debris = collapseTerrain(world);
    expect(debris.map((event) => event.kind)).toEqual(['dust']);
    expect(world.chunks).toHaveLength(0);
    expect(isSolidAt(world, 12, 9.8, 12)).toBe(false);
  });

  it('a big unsupported piece falls under gravity and lands as rubble', () => {
    const world = floating(4.5);
    const debris = collapseTerrain(world);
    expect(debris.map((event) => event.kind)).toEqual(['break']);
    expect(world.chunks).toHaveLength(1);
    const chunk = world.chunks[0]!;
    // Lifted out of the lattice: the air where it hung is air already.
    expect(isSolidAt(world, 12, 11, 12)).toBe(false);

    stepWorld(world, []);
    expect(chunk.speed).toBeGreaterThan(0);
    const results = settle(world);
    expect(results.some((result) => result.debris.some((event) => event.kind === 'land'))).toBe(true);
    // Rubble now sits on the ground, a little looser than the rock it came from.
    expect(isSolidAt(world, 12, GROUND + 0.75, 12)).toBe(true);
    const rubble = sampleDensity(world, 8, 3, 8);
    expect(rubble).toBeLessThanOrEqual(Math.round(DENSITY_MAX * RUBBLE_DENSITY_FACTOR));
  });

  it('a chunk that falls onto an occupant crushes it instead of landing', () => {
    const world = floating(4.5);
    collapseTerrain(world);
    const samples = world.chunks[0]!.samples.length;
    const tank: Occupant = { id: 7, x: 12, z: 12, radius: 1, bottomY: GROUND, topY: GROUND + 1.5 };
    const results = settle(world, [tank]);
    const crushes = results.flatMap((result) => result.crushes);
    expect(crushes).toEqual([{ occupantId: 7, damage: crushDamage(samples), chunkId: 0 }]);
    expect(crushDamage(samples)).toBeGreaterThan(0);
  });

  it('shooting through a pillar drops what it held', () => {
    // A 2 m pillar under a 6 × 6 m slab.
    const world = createWorld(
      buildTerrain({
        cellsX: 16,
        cellsY: 10,
        cellsZ: 16,
        sample: (x, y, z) => {
          const pillar = Math.min(1 - Math.abs(x - 12), 1 - Math.abs(z - 12));
          const slab = Math.min(3 - Math.abs(x - 12), 3 - Math.abs(z - 12), y - 9, 11 - y);
          return { solidity: Math.max(GROUND - y, Math.min(pillar, 11 - y), slab) };
        },
      }),
    );
    expect(collapseTerrain(world)).toEqual([]);
    const blast = blastTerrain(world, 12, 6, 12, 2.6, 900);
    expect(blast.debris.some((event) => event.kind === 'break')).toBe(true);
  });

  it('crush damage grows with the size of the rock', () => {
    expect(crushDamage(3)).toBe(0);
    expect(crushDamage(6)).toBe(1);
    expect(crushDamage(30)).toBe(2);
    expect(crushDamage(500)).toBe(3);
  });
});

describe('regeneration', () => {
  it('a crater regrows to the authored landscape over time', () => {
    const world = flat();
    const authored = hashState(world);
    blastTerrain(world, 12, GROUND, 12);
    expect(hashState(world)).not.toBe(authored);
    for (let tick = 0; tick < 2400; tick += 1) stepWorld(world, []);
    expect(Array.from(world.density)).toEqual(Array.from(world.target));
  });

  it('never regrows rock into a tank parked in the crater', () => {
    const world = flat();
    blastTerrain(world, 12, GROUND, 12);
    const tank: Occupant = { id: 1, x: 12, z: 12, radius: 1, bottomY: GROUND - 1.5, topY: GROUND };
    for (let tick = 0; tick < 2400; tick += 1) stepWorld(world, [tank]);
    expect(isSolidAt(world, 12, GROUND - 0.75, 12)).toBe(false);
    expect(isSolidAt(world, 18, GROUND - 0.5, 18)).toBe(true);
  });
});

describe('determinism', () => {
  it('the same blasts and steps give the same hash; a different blast does not', () => {
    const run = (x: number): string => {
      const world = floating(4.5);
      collapseTerrain(world);
      blastTerrain(world, x, GROUND, 6);
      for (let tick = 0; tick < 200; tick += 1) stepWorld(world, []);
      return hashState(world);
    };
    expect(run(6)).toBe(run(6));
    expect(run(6)).not.toBe(run(7.5));
  });
});
