/**
 * Regeneration and displacement — the tick loop, and the one rule the owner asked for
 * when a cell heals under something:
 *
 *   "The real question is what happens to a tank in an area that self heals? I vote
 *    that it gets shoved away." (ledger row 19)
 *
 *  - A cell heals ONE frame of damage every `regenDelaySeconds`; a hole closed by that
 *    frame is intact again, and an occupant standing there is moved to the nearest free
 *    cell. It is never damaged: the world has no damage channel for occupants at all.
 *  - A big block standing in the cell FREEZES the timer (no progress while it stands),
 *    so the breach stays open until the rubble is destroyed.
 *  - A shard lying in a cell that heals is absorbed.
 *
 * Every choice below is ordered by data (cell row-major, occupant id, fixed neighbour
 * order), so two runs over the same state produce the same displacements.
 */

import { MATERIAL_PROFILES, secondsToTicks } from './constants.ts';
import { absorbShardsIn } from './debris.ts';
import { blockAt, cellAt, cellIndex, isCellPassable, type Cell, type World } from './state.ts';

/**
 * A caller-supplied position. Tanks arrive as this, and nothing else — the world has no
 * tank, shell or AI concept. Positions are validated as ADDRESSES (integer, in bounds);
 * whether a tank may legally be there is the moving slice's rule, not the world's.
 */
export interface Occupant {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

/** One occupant pushed out of a cell that healed under it. The CALLER applies it. */
export interface Displacement {
  readonly id: number;
  readonly fromX: number;
  readonly fromZ: number;
  readonly toX: number;
  readonly toZ: number;
}

/** What a step produced. Displacements are the only world→entity effect there is. */
export interface WorldStepResult {
  readonly displacements: readonly Displacement[];
}

/** The fixed neighbour order: +x, -x, +z, -z. The tie-break of every nearest-cell search. */
const NEIGHBOUR_STEPS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
] as const;

/**
 * Advances the world by `ticks` fixed simulation ticks.
 *
 * `occupants` are read-only positions the caller owns; the world returns the moves it
 * decided and never writes to them. A multi-tick step keeps its working positions
 * across ticks, so a tank displaced on tick 3 is in its new cell on tick 4.
 */
export function stepWorld(world: World, ticks: number, occupants: readonly Occupant[]): WorldStepResult {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(`world.stepWorld: ticks must be a non-negative integer, got ${ticks}`);
  }
  validateOccupants(world, occupants);

  const positions = new Map<number, CellAddress>();
  const occupied = new Set<number>();
  for (const occupant of occupants) {
    positions.set(occupant.id, { x: occupant.x, z: occupant.z });
    occupied.add(cellIndex(world, occupant.x, occupant.z));
  }
  const occupantOrder = [...positions.keys()].sort((a, b) => a - b);
  const displacements: Displacement[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    world.tick += 1;
    for (const cell of world.cells) {
      if (cell.hp >= cell.maxHp) {
        continue;
      }
      if (blockAt(world, cell.x, cell.z)) {
        // A big block holds the cell open: regeneration makes no progress at all.
        continue;
      }
      cell.regenTicksRemaining -= 1;
      if (cell.regenTicksRemaining > 0) {
        continue;
      }

      cell.hp += 1;
      absorbShardsIn(world, cell.x, cell.z);
      cell.regenTicksRemaining =
        cell.hp < cell.maxHp ? secondsToTicks(MATERIAL_PROFILES[cell.material].regenDelaySeconds) : 0;

      if (cell.hp === 1) {
        // The hole just closed, so the cell is solid again under whoever stands there.
        displaceOccupantsOf(world, cell, positions, occupantOrder, occupied, displacements);
      }
    }
  }

  return { displacements };
}

interface CellAddress {
  readonly x: number;
  readonly z: number;
}

function displaceOccupantsOf(
  world: World,
  cell: Cell,
  positions: Map<number, CellAddress>,
  occupantOrder: readonly number[],
  occupied: Set<number>,
  displacements: Displacement[],
): void {
  for (const id of occupantOrder) {
    const position = positions.get(id);
    if (!position || position.x !== cell.x || position.z !== cell.z) {
      continue;
    }
    const target = findNearestFreeCell(world, position, occupied);
    positions.set(id, target);
    // The healed cell itself can never be a destination again (it is not passable),
    // so the set only needs the new destination added.
    occupied.add(cellIndex(world, target.x, target.z));
    displacements.push({
      id,
      fromX: position.x,
      fromZ: position.z,
      toX: target.x,
      toZ: target.z,
    });
  }
}

/**
 * The nearest cell an occupant can be shoved to: breadth-first over PASSABLE cells
 * (never through rock), first unoccupied cell in the fixed neighbour order. Occupied
 * cells are expanded through but not chosen, so a shove never stacks two tanks.
 */
function findNearestFreeCell(world: World, from: CellAddress, occupied: ReadonlySet<number>): CellAddress {
  const queue: CellAddress[] = [{ x: from.x, z: from.z }];
  const visited = new Set<number>([cellIndex(world, from.x, from.z)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      throw new Error('world: the displacement queue lost an element it just held');
    }
    for (const step of NEIGHBOUR_STEPS) {
      const x = current.x + step.x;
      const z = current.z + step.z;
      if (x < 0 || x >= world.columns || z < 0 || z >= world.rows) {
        continue;
      }
      const index = z * world.columns + x;
      if (visited.has(index)) {
        continue;
      }
      if (!isCellPassable(world, x, z)) {
        continue;
      }
      visited.add(index);
      if (occupied.has(index)) {
        queue.push({ x, z });
        continue;
      }
      return { x, z };
    }
  }

  throw new Error(
    `world: no free cell is reachable from (${from.x}, ${from.z}) to displace an occupant — the level has nowhere to push`,
  );
}

function validateOccupants(world: World, occupants: readonly Occupant[]): void {
  const ids = new Set<number>();
  for (const occupant of occupants) {
    if (!Number.isInteger(occupant.id)) {
      throw new Error(`world.stepWorld: occupant id must be an integer, got ${occupant.id}`);
    }
    if (ids.has(occupant.id)) {
      throw new Error(`world.stepWorld: occupant id ${occupant.id} appears twice`);
    }
    ids.add(occupant.id);
    cellAt(world, occupant.x, occupant.z);
  }
}
