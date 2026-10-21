/**
 * The placeholder arena for slice A2 — the real A1 world model, populated by a small
 * hand-authored layout and a seeded breach or two so the floor-grid holes and their
 * rims are visible in the screenshots.
 *
 * This is NOT the authored level: A4 owns level data and the level loader
 * (`docs/DESIGN.md` §8). It exists so the render foundation is judged against world
 * data that came through `createWorld` and `damageCell`, never against ad-hoc meshes.
 * The 16 tanks come from four teams of four, exactly the §9 performance case.
 */

import { createRng } from '../core/rng.ts';
import {
  MATERIAL_PROFILES,
  cellAt,
  createWorld,
  damageCell,
  type CellMaterial,
  type CellPlacement,
  type World,
} from '../core/world.ts';
import type { ArenaBounds } from './cameraMath.ts';
import { GRID } from './config.ts';

/** The arena in cells. One cell is `GRID.cellMetres` square. */
const ARENA = { columns: 32, rows: 24, floorSurfaceHeightMetres: 0.2 } as const;

const HOLE_SEED = 0x5e_ed_11;

/** One team-coloured placeholder tank's spawn. */
export interface TankSpawn {
  readonly teamIndex: number;
  readonly xMetres: number;
  readonly yMetres: number;
  readonly zMetres: number;
  /** The hull's yaw: 0 faces -z; the same convention `cameraMath.forwardFromYaw`. */
  readonly yawDegrees: number;
}

export interface ShowcaseScene {
  readonly world: World;
  readonly spawns: readonly TankSpawn[];
  /** The tank the third-person arm follows, and the `tank`/`first` poses frame. */
  readonly focusSpawnIndex: number;
  readonly bounds: ArenaBounds;
}

/**
 * Builds the showcase: a walled arena with a couple of barriers, pillars, six floor
 * holes carved through the real destruction path, and 16 tanks (4 teams × 4).
 */
export function createShowcaseScene(): ShowcaseScene {
  const placements: CellPlacement[] = [];
  const placed = new Set<string>();

  const place = (
    x: number,
    z: number,
    material: Exclude<CellMaterial, 'floor'>,
    heightMetres: number,
  ): void => {
    if (x < 0 || x >= ARENA.columns || z < 0 || z >= ARENA.rows) {
      throw new Error(`showcase: placement (${x}, ${z}) is outside the ${ARENA.columns}x${ARENA.rows} arena`);
    }
    const key = `${x},${z}`;
    if (placed.has(key)) {
      throw new Error(`showcase: (${x}, ${z}) is placed twice by the layout`);
    }
    placed.add(key);
    placements.push({ x, z, material, heightMetres });
  };

  // The outer wall ring. It gives the arena a silhouette to read against the void.
  for (let x = 0; x < ARENA.columns; x += 1) {
    place(x, 0, 'wall', 2.8);
    place(x, ARENA.rows - 1, 'wall', 2.8);
  }
  for (let z = 1; z < ARENA.rows - 1; z += 1) {
    place(0, z, 'wall', 2.8);
    place(ARENA.columns - 1, z, 'wall', 2.8);
  }

  // Corner pillars, taller than the ring: vertical accents for the wide shot.
  for (const [x, z] of [
    [2, 2],
    [29, 2],
    [2, 21],
    [29, 21],
  ] as const) {
    place(x, z, 'pillar', 5.2);
  }

  // Two low barrier walls, broken into segments so the arena reads as routes. The
  // central gap at x = 9…11 is the corridor the focus tank looks down in the
  // first-person pose (and where the floor breach is), so the shot has a view.
  for (let x = 4; x <= 8; x += 1) {
    place(x, 8, 'wall', 1.4);
    place(x, 15, 'wall', 1.4);
  }
  for (let x = 12; x <= 14; x += 1) {
    place(x, 8, 'wall', 1.4);
    place(x, 15, 'wall', 1.4);
  }
  for (let x = 20; x <= 26; x += 1) {
    place(x, 8, 'wall', 1.4);
    place(x, 15, 'wall', 1.4);
  }

  // Interior walls and the central pair of pillars.
  for (let z = 5; z <= 8; z += 1) {
    place(16, z, 'wall', 2.6);
  }
  for (let z = 15; z <= 18; z += 1) {
    place(16, z, 'wall', 2.6);
  }
  place(15, 11, 'pillar', 4.6);
  place(16, 12, 'pillar', 4.6);
  for (const [x, z, height] of [
    [5, 12, 2.0],
    [26, 12, 2.0],
    [10, 4, 2.0],
    [21, 19, 2.0],
  ] as const) {
    place(x, z, 'wall', height);
  }

  const world = createWorld({
    columns: ARENA.columns,
    rows: ARENA.rows,
    floorSurfaceHeightMetres: ARENA.floorSurfaceHeightMetres,
    placements,
  });

  // Carve the holes through the REAL destruction path, so the screenshot proves the
  // renderer reads a destroyed world rather than a decorative dark patch.
  const rng = createRng(HOLE_SEED);
  for (const [x, z] of [
    [10, 10],
    [11, 10],
    [11, 11],
    [21, 14],
    [22, 14],
    [22, 13],
  ] as const) {
    const cell = cellAt(world, x, z);
    if (cell.material !== 'floor') {
      throw new Error(`showcase: hole (${x}, ${z}) is authored over a ${cell.material}`);
    }
    const result = damageCell(world, x, z, MATERIAL_PROFILES.floor.maxHp, rng);
    if (!result.destroyedNow) {
      throw new Error(`showcase: floor cell (${x}, ${z}) did not become a hole`);
    }
  }

  const spawnCells: readonly {
    teamIndex: number;
    cells: readonly (readonly [number, number])[];
    yawDegrees: number;
  }[] = [
    {
      teamIndex: 0,
      // The focus tank first, then two wingmen a cell ahead so the first-person
      // pose has team-coloured subjects in frame, and one trailing on the right.
      cells: [
        [10, 18],
        [8, 17],
        [12, 17],
        [14, 19],
      ],
      yawDegrees: 0,
    },
    {
      teamIndex: 1,
      cells: [
        [8, 5],
        [10, 5],
        [12, 5],
        [14, 5],
      ],
      yawDegrees: 180,
    },
    {
      teamIndex: 2,
      cells: [
        [2, 7],
        [2, 10],
        [2, 13],
        [2, 16],
      ],
      yawDegrees: -90,
    },
    {
      teamIndex: 3,
      cells: [
        [29, 7],
        [29, 10],
        [29, 13],
        [29, 16],
      ],
      yawDegrees: 90,
    },
  ];

  const cellSize = GRID.cellMetres;
  const spawns: TankSpawn[] = [];
  for (const group of spawnCells) {
    for (const [x, z] of group.cells) {
      const cell = cellAt(world, x, z);
      if (cell.material !== 'floor') {
        throw new Error(`showcase: tank spawn (${x}, ${z}) stands on a ${cell.material}`);
      }
      spawns.push({
        teamIndex: group.teamIndex,
        xMetres: (x + 0.5) * cellSize,
        yMetres: ARENA.floorSurfaceHeightMetres,
        zMetres: (z + 0.5) * cellSize,
        yawDegrees: group.yawDegrees,
      });
    }
  }

  if (spawns.length !== 16) {
    throw new Error(`showcase: expected 16 tanks (4 teams x 4), got ${spawns.length}`);
  }

  return {
    world,
    spawns,
    focusSpawnIndex: 0,
    bounds: {
      minX: 0,
      maxX: ARENA.columns * cellSize,
      minZ: 0,
      maxZ: ARENA.rows * cellSize,
    },
  };
}
