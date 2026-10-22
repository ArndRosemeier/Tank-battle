/**
 * The A3c playable arena: a compact, purely DATA level for the duel that proves the
 * sim↔render bridge. A4 owns the authored level and its loader; this slice needs a
 * real A1 world with cover, a dummy target and enough room for a third-person camera.
 */

import { CELL_SIZE_METRES, type CellPlacement, type WorldSpec } from '../core/world.ts';

const COLUMNS = 20;
const ROWS = 14;
const FLOOR = 0.2;
const RING_HEIGHT = 6.2;
const PYLON_HEIGHT = 9.2;
const LOW_WALL_HEIGHT = 1.4;
const COVER_HEIGHT = 2.6;

function place(
  placements: CellPlacement[],
  x: number,
  z: number,
  material: Exclude<CellPlacement['material'], 'floor'>,
  heightMetres: number,
): void {
  if (x < 0 || x >= COLUMNS || z < 0 || z >= ROWS) {
    throw new Error(`playableLevel: (${x}, ${z}) is outside the ${COLUMNS}x${ROWS} arena`);
  }
  placements.push({ x, z, material, heightMetres });
}

const placements: CellPlacement[] = [];

// Full perimeter, with four taller corner pylons for the wide pose's vertical rhythm.
for (let x = 0; x < COLUMNS; x += 1) {
  place(placements, x, 0, 'wall', RING_HEIGHT);
  place(placements, x, ROWS - 1, 'wall', RING_HEIGHT);
}
for (let z = 1; z < ROWS - 1; z += 1) {
  place(placements, 0, z, 'wall', RING_HEIGHT);
  place(placements, COLUMNS - 1, z, 'wall', RING_HEIGHT);
}
for (const [x, z] of [
  [2, 2],
  [17, 2],
  [2, 11],
  [17, 11],
] as const) {
  place(placements, x, z, 'pillar', PYLON_HEIGHT);
}

// Low barriers flank the duel corridor; the centre (x = 8…12) stays open.
for (const x of [3, 4, 5, 6, 13, 14, 15, 16]) {
  place(placements, x, 6, 'wall', LOW_WALL_HEIGHT);
}

// The demo-only breach wall (left of the player) consists of these two cover cells.
export const DEMO_BREACH_CELLS = [
  { x: 7, z: 6 },
] as const;
for (const cell of DEMO_BREACH_CELLS) {
  place(placements, cell.x, cell.z, 'wall', COVER_HEIGHT);
}

/** Cells, the drivable floor plane and the authored cover. */
export const PLAYABLE_LEVEL: WorldSpec = {
  columns: COLUMNS,
  rows: ROWS,
  floorSurfaceHeightMetres: FLOOR,
  placements,
};

/** One spawn on a cell centre, facing the other tank down the x = 10 corridor. */
export interface PlayableSpawn {
  readonly xMetres: number;
  readonly zMetres: number;
  readonly hullYawDegrees: number;
}

function centre(cellX: number, cellZ: number): { xMetres: number; zMetres: number } {
  return {
    xMetres: (cellX + 0.5) * CELL_SIZE_METRES,
    zMetres: (cellZ + 0.5) * CELL_SIZE_METRES,
  };
}

/** Player faces -z (yaw 0) at the south end of the corridor. */
export const PLAYER_SPAWN: PlayableSpawn = {
  ...centre(10, 8),
  hullYawDegrees: 0,
};

/** The static dummy target faces +z (yaw 180) at the north end. */
export const DUMMY_SPAWN: PlayableSpawn = {
  ...centre(10, 5),
  hullYawDegrees: 180,
};

/** Floor holes carved through the real A1 destruction path in every session. */
export const INITIAL_FLOOR_HOLES = [
  { x: 2, z: 7 },
  { x: 17, z: 8 },
] as const;

export const PLAYABLE_BOUNDS = {
  minX: 0,
  maxX: COLUMNS * CELL_SIZE_METRES,
  minZ: 0,
  maxZ: ROWS * CELL_SIZE_METRES,
} as const;

export const PLAYABLE_FLOOR_Y = FLOOR;
