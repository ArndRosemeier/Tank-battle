/**
 * The authored-level FORMAT and its load-time validation. A level is data: a name, an
 * intent sentence, a terrain spec (the density lattice) and four spawn pads. Nothing
 * here draws; every failure names what is wrong and where.
 */

import { createWorld, type World, type WorldSpec } from '../../core/world.ts';
import { TANK_RADIUS_METRES } from '../../core/sim/constants.ts';
import { standingPoseAt } from '../../core/sim/terrainBody.ts';
import { buildNavGraph, nodeNear, reachableFrom } from '../../core/ai/navigation.ts';
import * as detMath from '../../core/detMath.ts';

export interface SpawnSlot {
  readonly xMetres: number;
  readonly zMetres: number;
}

export interface LevelSpawn {
  readonly teamId: number;
  /** The pad's centre. */
  readonly xMetres: number;
  readonly zMetres: number;
  /** The hull yaw every tank on this pad starts with. */
  readonly yawDegrees: number;
  /** Four tank slots, front first; a team of n uses the first n. */
  readonly slots: readonly SpawnSlot[];
}

export interface LevelDefinition {
  readonly name: string;
  readonly intent: string;
  readonly terrain: WorldSpec;
  readonly spawns: readonly LevelSpawn[];
}

function fail(message: string): never {
  throw new Error(`validateLevel: ${message}`);
}

const validated = new WeakSet<LevelDefinition>();

/**
 * The full load-time validation: terrain, spawn pads, four-fold symmetry and
 * connectivity on foot. A level that passed once is remembered (it is immutable data).
 */
export function validateLevel(level: LevelDefinition): void {
  if (validated.has(level)) return;
  if (level === null || typeof level !== 'object') {
    fail(`level must be an object, got ${String(level)}`);
  }
  if (typeof level.name !== 'string' || level.name.length === 0) {
    fail('level needs a non-empty name');
  }
  if (typeof level.intent !== 'string' || level.intent.length === 0) {
    fail('level needs a non-empty intent');
  }
  if (!Array.isArray(level.spawns) || level.spawns.length !== 4) {
    fail(`the arena needs exactly four spawn pads (four teams), got ${Array.isArray(level.spawns) ? level.spawns.length : String(level.spawns)}`);
  }
  const world = createWorld(level.terrain);
  if (world.nx !== world.nz) {
    fail(`a four-fold arena must be square, got ${world.nx}×${world.nz} samples`);
  }

  const teams = new Set<number>();
  const allSlots: { teamId: number; x: number; z: number }[] = [];
  for (const spawn of level.spawns) {
    if (!Number.isInteger(spawn.teamId) || spawn.teamId < 0 || spawn.teamId > 3) {
      fail(`spawn teamId must be an integer 0…3, got ${String(spawn.teamId)}`);
    }
    if (teams.has(spawn.teamId)) {
      fail(`spawn teamId ${spawn.teamId} appears twice`);
    }
    teams.add(spawn.teamId);
    if (!Number.isFinite(spawn.yawDegrees)) {
      fail(`spawn ${spawn.teamId} yaw must be finite, got ${String(spawn.yawDegrees)}`);
    }
    if (!Array.isArray(spawn.slots) || spawn.slots.length !== 4) {
      fail(`spawn ${spawn.teamId} needs four tank slots`);
    }
    for (const [index, slot] of spawn.slots.entries()) {
      const pose = standingPoseAt(world, slot.xMetres, slot.zMetres, spawn.yawDegrees, world.heightMetres + 1);
      if (!pose) {
        fail(`spawn ${spawn.teamId} slot ${index} (${slot.xMetres}, ${slot.zMetres}) has no room for a tank`);
      }
      if (Math.abs(pose.pitchDegrees) > 4 || Math.abs(pose.rollDegrees) > 4) {
        fail(`spawn ${spawn.teamId} slot ${index} is not on flat ground (pitch ${pose.pitchDegrees.toFixed(1)}°, roll ${pose.rollDegrees.toFixed(1)}°)`);
      }
      for (const other of allSlots) {
        if (detMath.hypot(other.x - slot.xMetres, other.z - slot.zMetres) < TANK_RADIUS_METRES * 2.4) {
          fail(`spawn ${spawn.teamId} slot ${index} overlaps a slot of spawn ${other.teamId}`);
        }
      }
      allSlots.push({ teamId: spawn.teamId, x: slot.xMetres, z: slot.zMetres });
    }
  }

  assertFourFold(world);
  assertSpawnsRotate(world, level.spawns);
  assertConnected(world, level.spawns);
  validated.add(level);
}

/** The terrain must map onto itself under a 90° turn about its vertical centre line. */
function assertFourFold(world: World): void {
  const { nx, ny } = world;
  const last = nx - 1;
  for (let k = 0; k < nx; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = ny * (i + nx * k);
      const b = ny * (last - k + nx * i);
      for (let j = 0; j < ny; j += 1) {
        if (world.density[a + j] !== world.density[b + j] || world.material[a + j] !== world.material[b + j]) {
          fail(`symmetry break at sample (${i}, ${j}, ${k}) vs rotated (${last - k}, ${j}, ${i})`);
        }
      }
    }
  }
}

function assertSpawnsRotate(world: World, spawns: readonly LevelSpawn[]): void {
  const size = world.widthMetres;
  const byTeam = new Map(spawns.map((spawn) => [spawn.teamId, spawn]));
  for (const spawn of spawns) {
    const rotated = byTeam.get((spawn.teamId + 1) % 4);
    if (!rotated) continue;
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
    if (!near(rotated.xMetres, size - spawn.zMetres) || !near(rotated.zMetres, spawn.xMetres)) {
      fail(`spawn symmetry break: team ${spawn.teamId}'s pad does not rotate onto team ${rotated.teamId}'s`);
    }
    for (const [index, slot] of spawn.slots.entries()) {
      const other = rotated.slots[index]!;
      if (!near(other.xMetres, size - slot.zMetres) || !near(other.zMetres, slot.xMetres)) {
        fail(`spawn symmetry break: team ${spawn.teamId} slot ${index} does not rotate onto team ${rotated.teamId} slot ${index}`);
      }
    }
  }
}

/** Every slot, and the arena centre, must be reachable on foot from team 0's first slot. */
function assertConnected(world: World, spawns: readonly LevelSpawn[]): void {
  const graph = buildNavGraph(world);
  const first = spawns[0]!.slots[0]!;
  const start = nodeNear(graph, first.xMetres, world.heightMetres, first.zMetres);
  if (start === null) fail(`spawn ${spawns[0]!.teamId} slot 0 has no navigation node`);
  const reached = reachableFrom(graph, start);
  for (const spawn of spawns) {
    for (const [index, slot] of spawn.slots.entries()) {
      const node = nodeNear(graph, slot.xMetres, world.heightMetres, slot.zMetres);
      if (node === null || !reached[node]) {
        fail(`spawn ${spawn.teamId} slot ${index} is not connected on foot to spawn ${spawns[0]!.teamId}`);
      }
    }
  }
  const centre = world.widthMetres / 2;
  const objective = nodeNear(graph, centre, world.heightMetres, centre);
  if (objective === null || !reached[objective]) {
    fail('the arena centre is not reachable on foot from the spawns');
  }
}
