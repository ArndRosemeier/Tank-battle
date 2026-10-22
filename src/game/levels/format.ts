/**
 * The authored-level FORMAT and its load-time validation. A level is data: a name, an
 * intent sentence, an A1 `WorldSpec` grid and four 2×2 spawn zones. Nothing here draws;
 * every failure names the offending cell.
 */

import type { CellMaterial, WorldSpec } from '../../core/world.ts';

export interface LevelSpawn {
  readonly teamId: number;
  /** Top-left cell of the 2×2 free zone. */
  readonly zoneX: number;
  readonly zoneZ: number;
  readonly zoneWidth: number;
  readonly zoneHeight: number;
  /** The protected exit direction: the hull yaw the tank starts with. */
  readonly yawDegrees: number;
}

export interface LevelDefinition {
  readonly name: string;
  readonly intent: string;
  readonly cells: WorldSpec;
  readonly spawns: readonly LevelSpawn[];
}

interface GridCell {
  readonly material: CellMaterial;
  readonly heightMetres: number;
}

function fail(message: string): never {
  throw new Error(`validateLevel: ${message}`);
}

function cellText(x: number, z: number): string {
  return `(${x}, ${z})`;
}

function gridFor(cells: WorldSpec): {
  readonly grid: readonly GridCell[];
  readonly columns: number;
  readonly rows: number;
  readonly floor: number;
} {
  if (cells === null || typeof cells !== 'object') {
    fail(`cells must be an object, got ${String(cells)}`);
  }
  const { columns, rows, floorSurfaceHeightMetres: floor } = cells;
  if (!Number.isInteger(columns) || columns <= 0) {
    fail(`columns must be a positive integer, got ${String(columns)}`);
  }
  if (!Number.isInteger(rows) || rows <= 0) {
    fail(`rows must be a positive integer, got ${String(rows)}`);
  }
  if (columns !== rows) {
    fail(`the 24×24/4-fold format requires a square grid, got ${columns}×${rows}`);
  }
  if (!Number.isFinite(floor) || floor < 0) {
    fail(`floor height must be finite and >= 0, got ${String(floor)}`);
  }

  const grid: GridCell[] = new Array(columns * rows);
  for (let index = 0; index < grid.length; index += 1) {
    grid[index] = { material: 'floor', heightMetres: floor };
  }

  const seen = new Set<number>();
  for (const placement of cells.placements ?? []) {
    if (!Number.isInteger(placement.x) || !Number.isInteger(placement.z)) {
      fail(`placement ${cellText(placement.x, placement.z)} is not an integer cell`);
    }
    if (placement.x < 0 || placement.x >= columns || placement.z < 0 || placement.z >= rows) {
      fail(`placement ${cellText(placement.x, placement.z)} is outside the ${columns}×${rows} grid`);
    }
    if (placement.material !== 'wall' && placement.material !== 'pillar') {
      fail(`placement ${cellText(placement.x, placement.z)} has illegal material ${String(placement.material)}`);
    }
    if (!Number.isFinite(placement.heightMetres) || placement.heightMetres <= floor) {
      fail(
        `placement ${cellText(placement.x, placement.z)} height ${String(placement.heightMetres)} must be above the floor ${floor}`,
      );
    }
    const index = placement.z * columns + placement.x;
    if (seen.has(index)) {
      fail(`placement ${cellText(placement.x, placement.z)} appears twice`);
    }
    seen.add(index);
    grid[index] = { material: placement.material, heightMetres: placement.heightMetres };
  }

  return { grid, columns, rows, floor };
}

function zoneCells(spawn: LevelSpawn): readonly { x: number; z: number }[] {
  const result: { x: number; z: number }[] = [];
  for (let z = spawn.zoneZ; z < spawn.zoneZ + spawn.zoneHeight; z += 1) {
    for (let x = spawn.zoneX; x < spawn.zoneX + spawn.zoneWidth; x += 1) {
      result.push({ x, z });
    }
  }
  return result;
}

/** The full load-time validation: bounds, materials, spawns, connectivity, symmetry. */
export function validateLevel(level: LevelDefinition): void {
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
    fail(`the arena needs exactly four spawn zones (four teams), got ${Array.isArray(level.spawns) ? level.spawns.length : String(level.spawns)}`);
  }

  const { grid, columns, rows, floor } = gridFor(level.cells);
  const teams = new Set<number>();
  const occupied = new Set<string>();

  for (const spawn of level.spawns) {
    if (!Number.isInteger(spawn.teamId) || spawn.teamId < 0 || spawn.teamId > 3) {
      fail(`spawn teamId must be an integer 0…3, got ${String(spawn.teamId)}`);
    }
    if (teams.has(spawn.teamId)) {
      fail(`spawn teamId ${spawn.teamId} appears twice`);
    }
    teams.add(spawn.teamId);
    if (!Number.isInteger(spawn.zoneWidth) || spawn.zoneWidth < 2 || spawn.zoneWidth > 4 ||
        !Number.isInteger(spawn.zoneHeight) || spawn.zoneHeight < 2 || spawn.zoneHeight > 4) {
      fail(`spawn ${spawn.teamId} must have a 2…4 cell free zone, got ${spawn.zoneWidth}×${spawn.zoneHeight}`);
    }
    if (!Number.isFinite(spawn.yawDegrees)) {
      fail(`spawn ${spawn.teamId} yaw must be finite, got ${String(spawn.yawDegrees)}`);
    }
    if (spawn.zoneX < 0 || spawn.zoneZ < 0 ||
        spawn.zoneX + spawn.zoneWidth > columns || spawn.zoneZ + spawn.zoneHeight > rows) {
      fail(`spawn ${spawn.teamId} zone ${cellText(spawn.zoneX, spawn.zoneZ)} is outside the grid`);
    }
    for (const cell of zoneCells(spawn)) {
      const key = `${cell.x},${cell.z}`;
      if (occupied.has(key)) {
        fail(`spawn ${spawn.teamId} overlaps another spawn at ${cellText(cell.x, cell.z)}`);
      }
      occupied.add(key);
      const value = grid[cell.z * columns + cell.x];
      if (!value || value.material !== 'floor' || value.heightMetres !== floor) {
        fail(
          `spawn ${spawn.teamId} zone cell ${cellText(cell.x, cell.z)} is not free floor (${value?.material ?? 'missing'}, ${value?.heightMetres ?? 'missing'} m)`,
        );
      }
    }
  }

  // Connectivity: flood fill from the first spawn zone; every spawn cell must be seen.
  const passable = (x: number, z: number): boolean => {
    if (x < 0 || x >= columns || z < 0 || z >= rows) return false;
    const cell = grid[z * columns + x];
    return cell?.material === 'floor' && cell.heightMetres === floor;
  };
  const firstSpawnCell = zoneCells(level.spawns[0]!)[0]!;
  const seen = new Set<number>();
  const queue: { x: number; z: number }[] = [firstSpawnCell];
  seen.add(firstSpawnCell.z * columns + firstSpawnCell.x);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = current.x + dx;
      const z = current.z + dz;
      if (!passable(x, z)) continue;
      const index = z * columns + x;
      if (seen.has(index)) continue;
      seen.add(index);
      queue.push({ x, z });
    }
  }
  for (const spawn of level.spawns) {
    for (const cell of zoneCells(spawn)) {
      if (!seen.has(cell.z * columns + cell.x)) {
        fail(`spawn ${spawn.teamId} is not connected on foot to spawn ${level.spawns[0]!.teamId} at ${cellText(cell.x, cell.z)}`);
      }
    }
  }

  // The centre is the objective area: every passable cell in the central window
  // (4×4 on an even grid, 3×3 on an odd grid) must be reachable from the spawn
  // component. Spawn-to-spawn connectivity alone would let a sealed objective ship.
  const centreX = (columns - 1) / 2;
  const centreZ = (rows - 1) / 2;
  const centreMinX = Math.ceil(centreX - 1.5);
  const centreMaxX = Math.floor(centreX + 1.5);
  const centreMinZ = Math.ceil(centreZ - 1.5);
  const centreMaxZ = Math.floor(centreZ + 1.5);
  let centreTargets = 0;
  for (let z = centreMinZ; z <= centreMaxZ; z += 1) {
    for (let x = centreMinX; x <= centreMaxX; x += 1) {
      if (!passable(x, z)) continue;
      centreTargets += 1;
      if (!seen.has(z * columns + x)) {
        fail(
          `arena centre cell ${cellText(x, z)} is not reachable on foot from spawn ${level.spawns[0]!.teamId}`,
        );
      }
    }
  }
  if (centreTargets === 0) {
    fail('the arena centre has no passable objective cell; a sealed objective cannot be verified');
  }

  // 90° rotation symmetry of the complete material/height grid.
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < columns; x += 1) {
      const rotatedX = rows - 1 - z;
      const rotatedZ = x;
      const a = grid[z * columns + x]!;
      const b = grid[rotatedZ * columns + rotatedX]!;
      if (a.material !== b.material || a.heightMetres !== b.heightMetres) {
        fail(
          `symmetry break at ${cellText(x, z)} (${a.material}/${a.heightMetres} m) vs rotated ${cellText(rotatedX, rotatedZ)} (${b.material}/${b.heightMetres} m)`,
        );
      }
    }
  }

  // The four spawn zones must rotate into one another too.
  const spawnByTeam = new Map(level.spawns.map((spawn) => [spawn.teamId, spawn]));
  for (const spawn of level.spawns) {
    const rotated = spawnByTeam.get((spawn.teamId + 1) % 4);
    if (!rotated) continue;
    const expectedX = rows - spawn.zoneZ - spawn.zoneHeight;
    const expectedZ = spawn.zoneX;
    if (rotated.zoneX !== expectedX || rotated.zoneZ !== expectedZ) {
      fail(
        `spawn symmetry break: team ${spawn.teamId} zone ${cellText(spawn.zoneX, spawn.zoneZ)} rotates to ${cellText(expectedX, expectedZ)}, but team ${rotated.teamId} is at ${cellText(rotated.zoneX, rotated.zoneZ)}`,
      );
    }
  }
}
