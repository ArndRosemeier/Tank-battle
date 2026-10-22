import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';
import {
  BLOCK_HEIGHT_METRES,
  MATERIAL_PROFILES,
  MIRROR_ANGLE_STEP_DEGREES,
  SHARD_CAP,
  blockAt,
  cellAt,
  cellState,
  createWorld,
  damageBlock,
  damageCell,
  floorSurfaceHeightAt,
  hashState,
  isCellPassable,
  isSolidAt,
  listBlocks,
  listShards,
  secondsToTicks,
  shardAt,
  shardDeflection,
  shatterShard,
  shoveShard,
  stepWorld,
  type Occupant,
  type Shard,
  type World,
} from './world.ts';

/** The floor plane every test world shares, unless it is testing a wall's height. */
const FLOOR = 0.25;

/** The tick count of one regeneration interval: 20 s at the 60 Hz tick. */
const REGEN_TICKS = 1200;

function flatWorld(columns = 4, rows = 4): World {
  return createWorld({ columns, rows, floorSurfaceHeightMetres: FLOOR });
}

function requireShard(world: World, index = 0): Shard {
  const shard = listShards(world)[index];
  if (!shard) {
    throw new Error(`expected at least ${index + 1} shards, found ${listShards(world).length}`);
  }
  return shard;
}

describe('the world model', () => {
  it("a shell's damage destroys a wall cell and yields exactly one big block", () => {
    const world = createWorld({
      columns: 4,
      rows: 4,
      floorSurfaceHeightMetres: FLOOR,
      placements: [{ x: 1, z: 1, material: 'wall', heightMetres: 3 }],
    });

    const result = damageCell(world, 1, 1, 2, createRng(7));

    expect(result).toMatchObject({ damageApplied: 2, destroyedNow: true, blocksSpawned: 1, shardsSpawned: 0 });
    expect(cellState(cellAt(world, 1, 1))).toBe('hole');
    expect(listBlocks(world)).toHaveLength(1);
    expect(blockAt(world, 1, 1)).toMatchObject({ x: 1, z: 1, material: 'wall', hp: 2 });
    expect(listShards(world)).toHaveLength(0);
    // Rubble blocks both a ground unit and a shell, but only up to its own top.
    expect(isCellPassable(world, 1, 1)).toBe(false);
    expect(isSolidAt(world, 1, 1, 1)).toBe(true);
    expect(isSolidAt(world, 1, 1, BLOCK_HEIGHT_METRES)).toBe(false);
  });

  it('a destroyed floor cell becomes a drivable hole, not an obstacle', () => {
    const world = flatWorld();
    // Before: the slab is material at 0.1 m, and the floor is drivable anyway — solid
    // and passable are two different questions, and this pin holds both.
    expect(isSolidAt(world, 1, 2, 0.1)).toBe(true);
    expect(isCellPassable(world, 1, 2)).toBe(true);
    const surface = floorSurfaceHeightAt(world, 1, 2);

    damageCell(world, 1, 2, 1, createRng(3));

    expect(cellState(cellAt(world, 1, 2))).toBe('hole');
    expect(isSolidAt(world, 1, 2, 0.1)).toBe(false); // a hole is not an obstacle
    expect(isCellPassable(world, 1, 2)).toBe(true); // and a tank still drives over it
    expect(floorSurfaceHeightAt(world, 1, 2)).toBe(surface); // the surface contract survives the hole
  });

  it('a wall stops a shell at its own height and never above it', () => {
    const world = createWorld({
      columns: 4,
      rows: 4,
      floorSurfaceHeightMetres: FLOOR,
      placements: [{ x: 2, z: 2, material: 'wall', heightMetres: 3 }],
    });

    expect(isSolidAt(world, 2, 2, 0)).toBe(true);
    expect(isSolidAt(world, 2, 2, 2.9)).toBe(true);
    expect(isSolidAt(world, 2, 2, 3)).toBe(false); // the top is a surface, not material
    expect(isSolidAt(world, 2, 2, 5)).toBe(false); // a high shot flies over
    expect(isCellPassable(world, 2, 2)).toBe(false); // but nothing drives through it
  });

  it("a large block occupying a cell blocks that cell's regeneration until the block is destroyed", () => {
    const world = createWorld({
      columns: 4,
      rows: 4,
      floorSurfaceHeightMetres: FLOOR,
      placements: [{ x: 1, z: 1, material: 'wall', heightMetres: 3 }],
    });
    damageCell(world, 1, 1, 2, createRng(11));
    expect(listBlocks(world)).toHaveLength(1);

    stepWorld(world, REGEN_TICKS * 3, []);

    expect(cellState(cellAt(world, 1, 1))).toBe('hole'); // three delays passed, nothing healed
    expect(listBlocks(world)).toHaveLength(1);

    const cleared = damageBlock(world, 1, 1, 2);
    expect(cleared.destroyedNow).toBe(true);
    expect(listBlocks(world)).toHaveLength(0);

    stepWorld(world, REGEN_TICKS - 1, []);
    expect(cellState(cellAt(world, 1, 1))).toBe('hole'); // still never before the delay
    stepWorld(world, 1, []);
    expect(cellState(cellAt(world, 1, 1))).toBe('intact');
    expect(cellAt(world, 1, 1).hp).toBe(1);
  });

  it('a cell regenerates only after its delay has elapsed, never before', () => {
    const world = flatWorld();
    expect(secondsToTicks(MATERIAL_PROFILES.floor.regenDelaySeconds)).toBe(REGEN_TICKS);

    damageCell(world, 1, 1, 1, createRng(5));
    stepWorld(world, REGEN_TICKS - 1, []);
    expect(cellState(cellAt(world, 1, 1))).toBe('hole');

    stepWorld(world, 1, []);
    expect(cellState(cellAt(world, 1, 1))).toBe('intact');
  });

  it('a healing cell absorbs the shards lying in it', () => {
    const world = flatWorld();
    damageCell(world, 1, 1, 1, createRng(9));
    expect(listShards(world)).toHaveLength(3);

    // One shard leaves the healing cell, so the pin can tell absorption from a blanket clear.
    const leaving = requireShard(world);
    expect(shoveShard(world, leaving.id, { x: 1, z: 0 })).toEqual({ x: 2, z: 1, moved: true });

    stepWorld(world, REGEN_TICKS, []);

    expect(cellState(cellAt(world, 1, 1))).toBe('intact');
    expect(listShards(world)).toHaveLength(1);
    expect(listShards(world)[0]).toMatchObject({ x: 2, z: 1 });
    expect(shardAt(world, 2, 1)).toMatchObject({ id: leaving.id });
  });

  it('a tank standing in a cell that regenerates is displaced to the nearest free cell and takes no damage', () => {
    const world = flatWorld(5, 5);
    damageCell(world, 2, 2, 1, createRng(13));
    const tank: Occupant = { id: 7, x: 2, z: 2 };
    const bystander: Occupant = { id: 9, x: 4, z: 4 };

    stepWorld(world, REGEN_TICKS - 1, [tank, bystander]);
    expect(cellState(cellAt(world, 2, 2))).toBe('hole');

    const result = stepWorld(world, 1, [tank, bystander]);

    expect(cellState(cellAt(world, 2, 2))).toBe('intact');
    expect(result.displacements).toEqual([{ id: 7, fromX: 2, fromZ: 2, toX: 3, toZ: 2 }]);
    // The world has no damage channel for occupants at all: the caller's object is
    // untouched, and the listed move is the only effect on it.
    expect(tank).toEqual({ id: 7, x: 2, z: 2 });
    expect(isCellPassable(world, 3, 2)).toBe(true);
    expect(result.displacements.some((displacement) => displacement.id === 9)).toBe(false);
  });

  it('displacement is deterministic: the same world state and the same occupants produce the same result', () => {
    // Two tanks share the healing cell, so the id order and the occupied-cell set both
    // matter: id 2 takes the nearest cell and id 5 must take the next one.
    const run = (): { displacements: unknown; hash: string } => {
      const world = flatWorld(5, 5);
      damageCell(world, 1, 1, 1, createRng(1979));
      const occupants: Occupant[] = [
        { id: 5, x: 1, z: 1 },
        { id: 2, x: 1, z: 1 },
      ];
      const result = stepWorld(world, REGEN_TICKS, occupants);
      return { displacements: result.displacements, hash: hashState(world) };
    };

    const first = run();
    const second = run();

    expect(first.displacements).toEqual(second.displacements);
    expect(first.hash).toBe(second.hash);
    expect(first.displacements).toEqual([
      { id: 2, fromX: 1, fromZ: 1, toX: 2, toZ: 1 },
      { id: 5, fromX: 1, fromZ: 1, toX: 0, toZ: 1 },
    ]);
  });

  it('shards are capped; when the cap is exceeded the oldest despawns first', () => {
    const world = flatWorld(6, 4);
    const rng = createRng(17);
    for (let index = 0; index < 22; index += 1) {
      damageCell(world, index % 6, Math.floor(index / 6), 1, rng); // 22 x 3 = 66 shards
    }

    const shards = listShards(world);
    expect(shards).toHaveLength(SHARD_CAP);
    expect(shards[0]?.id).toBe(2); // ids 0 and 1 were the oldest and are gone
    expect(shards.map((shard) => shard.id)).not.toContain(0);
    expect(shards.map((shard) => shard.id)).not.toContain(1);

    // Big blocks are NOT part of that budget: they persist until they are destroyed.
    const placements = [];
    for (let x = 0; x < 10; x += 1) {
      for (let z = 0; z < 7; z += 1) {
        placements.push({ x, z, material: 'wall' as const, heightMetres: 3 });
      }
    }
    const walled = createWorld({ columns: 10, rows: 7, floorSurfaceHeightMetres: FLOOR, placements });
    const wallRng = createRng(19);
    for (const placement of placements) {
      damageCell(walled, placement.x, placement.z, 2, wallRng);
    }
    expect(listBlocks(walled)).toHaveLength(70);
    expect(listShards(walled)).toHaveLength(0);
  });

  it('a shard deflects a shell at its stored mirror angle', () => {
    const world = flatWorld();
    damageCell(world, 1, 1, 1, createRng(23));
    const shard = requireShard(world);

    // The angle is data from the seeded RNG, and it is always a table step.
    expect(Number.isInteger(shard.mirrorAngleDegrees / MIRROR_ANGLE_STEP_DEGREES)).toBe(true);

    // Independent route: rebuild the mirror from the stored ANGLE with trigonometry and
    // reflect d - 2(d.n)n. The implementation uses literal normals instead, so the two
    // routes disagree if the stored angle and the applied mirror ever drift apart.
    const radians = (shard.mirrorAngleDegrees * Math.PI) / 180;
    const normal = { x: Math.cos(radians), z: Math.sin(radians) };
    const incoming = { x: 1, z: 0 };
    const projection = incoming.x * normal.x + incoming.z * normal.z;
    const expected = {
      x: incoming.x - 2 * projection * normal.x,
      z: incoming.z - 2 * projection * normal.z,
    };

    const actual = shardDeflection(shard, incoming);
    expect(actual.x).toBeCloseTo(expected.x, 12);
    expect(actual.z).toBeCloseTo(expected.z, 12);

    // A mirror reflects twice back to where it started — a property independent of the
    // table values, so a sign error cannot pass both assertions.
    const twice = shardDeflection(shard, actual);
    expect(twice.x).toBeCloseTo(incoming.x, 12);
    expect(twice.z).toBeCloseTo(incoming.z, 12);
  });

  it('the revision counter increments on visible changes and never on a timer-only tick', () => {
    const world = createWorld({
      columns: 4,
      rows: 4,
      floorSurfaceHeightMetres: FLOOR,
      placements: [{ x: 1, z: 1, material: 'wall', heightMetres: 3 }],
    });
    expect(world.revision).toBe(0);

    // No wound yet: a bare tick must not bump the renderer's version.
    stepWorld(world, 1, []);
    expect(world.revision).toBe(0);

    damageCell(world, 1, 1, 1, createRng(101));
    expect(world.revision).toBe(1);
    damageCell(world, 1, 1, 1, createRng(101));
    expect(world.revision).toBe(2); // destroyed: hole + big block
    const afterDestroy = world.revision;
    damageCell(world, 1, 1, 1, createRng(101));
    expect(world.revision).toBe(afterDestroy); // a hole is a reported no-op

    damageBlock(world, 1, 1, 1);
    expect(world.revision).toBe(3);
    damageBlock(world, 1, 1, 1);
    expect(world.revision).toBe(4);

    // The regeneration timer ticks down every step; only the actual heal is visible.
    stepWorld(world, 1, []);
    expect(world.revision).toBe(4);
    stepWorld(world, REGEN_TICKS - 1, []);
    expect(world.revision).toBe(5);

    const floor = flatWorld();
    damageCell(floor, 1, 1, 1, createRng(102));
    const shard = requireShard(floor);
    const beforeShove = floor.revision;
    shoveShard(floor, shard.id, { x: 1, z: 0 });
    expect(floor.revision).toBe(beforeShove + 1);
    const beforeShatter = floor.revision;
    shatterShard(floor, shard.id);
    expect(floor.revision).toBe(beforeShatter + 1);

    // A displacement is a visible change even when the displacement itself is the
    // only thing the tick did.
    const displaced = flatWorld(5, 5);
    damageCell(displaced, 2, 2, 1, createRng(103));
    const beforeDisplacement = displaced.revision;
    const result = stepWorld(displaced, REGEN_TICKS, [{ id: 7, x: 2, z: 2 }]);
    expect(result.displacements).toHaveLength(1);
    expect(displaced.revision).toBeGreaterThan(beforeDisplacement);
  });

  it('a shell hit shatters the shard, so it is gone and a stale id fails loudly', () => {
    const world = flatWorld();
    damageCell(world, 1, 1, 1, createRng(37));
    const [first, second] = listShards(world);
    if (!first || !second) {
      throw new Error(`expected two shards, found ${listShards(world).length}`);
    }

    const shattered = shatterShard(world, first.id);

    expect(shattered).toMatchObject({ id: first.id });
    expect(listShards(world)).toHaveLength(2);
    expect(listShards(world).map((shard) => shard.id)).not.toContain(first.id);
    expect(shardAt(world, 1, 1)).toMatchObject({ id: second.id });
    // A second hit on the same id is a caller bug, not a silent no-op.
    expect(() => shatterShard(world, first.id)).toThrow(/does not exist/);
  });

  it('shoving a shard moves it one cell, and slides it to a free side when the way is blocked', () => {
    const world = createWorld({
      columns: 4,
      rows: 4,
      floorSurfaceHeightMetres: FLOOR,
      placements: [{ x: 2, z: 1, material: 'wall', heightMetres: 3 }],
    });
    damageCell(world, 1, 1, 1, createRng(29));
    const shard = requireShard(world);

    // +x is a wall, so the shove may not pass through it; the fixed side order picks +z.
    expect(shoveShard(world, shard.id, { x: 1, z: 0 })).toEqual({ x: 1, z: 2, moved: true });
    expect(shoveShard(world, shard.id, { x: 0, z: -1 })).toEqual({ x: 1, z: 1, moved: true });

    // Trapped in a corner by two walls: the shard stays, and the result says so.
    const trapped = createWorld({
      columns: 2,
      rows: 2,
      floorSurfaceHeightMetres: FLOOR,
      placements: [
        { x: 1, z: 0, material: 'wall', heightMetres: 3 },
        { x: 0, z: 1, material: 'wall', heightMetres: 3 },
      ],
    });
    damageCell(trapped, 0, 0, 1, createRng(31));
    const stuck = requireShard(trapped);
    expect(shoveShard(trapped, stuck.id, { x: 1, z: 0 })).toEqual({ x: 0, z: 0, moved: false });
    expect(stuck).toMatchObject({ x: 0, z: 0 });
  });

  it('the same seed and the same operations produce an identical state hash', () => {
    const hashedRun = (seed: number, extraTick: boolean): string => {
      const world = createWorld({
        columns: 4,
        rows: 4,
        floorSurfaceHeightMetres: FLOOR,
        placements: [{ x: 2, z: 2, material: 'pillar', heightMetres: 4 }],
      });
      const rng = createRng(seed);
      damageCell(world, 1, 1, 1, rng);
      damageCell(world, 0, 3, 1, rng);
      damageCell(world, 2, 2, 3, rng);
      shoveShard(world, requireShard(world).id, { x: 1, z: 1 });
      stepWorld(world, 30, [{ id: 1, x: 3, z: 0 }]);
      if (extraTick) {
        stepWorld(world, 1, [{ id: 1, x: 3, z: 0 }]);
      }
      return hashState(world);
    };

    expect(hashedRun(2026, false)).toBe(hashedRun(2026, false));
    // The hash tracks the state, so it is not a constant that would pass the pin above.
    expect(hashedRun(2026, true)).not.toBe(hashedRun(2026, false));
    // ... including the shard mirror angles the seed chose: a different seed is a
    // different world, and the hash says so.
    expect(hashedRun(1, false)).not.toBe(hashedRun(2026, false));
  });

  it('an out-of-bounds cell or an occupant outside the grid is rejected loudly', () => {
    const world = flatWorld(4, 4);

    expect(() => cellAt(world, 4, 0)).toThrow(/outside the 4x4 grid/);
    expect(() => cellAt(world, -1, 0)).toThrow(/outside the 4x4 grid/);
    expect(() => cellAt(world, 1.5, 0)).toThrow(/integers/);
    expect(() => damageCell(world, 9, 9, 1, createRng(1))).toThrow(/outside the 4x4 grid/);
    expect(() => stepWorld(world, 1, [{ id: 1, x: 9, z: 0 }])).toThrow(/outside the 4x4 grid/);
    expect(() => stepWorld(world, -1, [])).toThrow(/non-negative integer/);
  });
});
