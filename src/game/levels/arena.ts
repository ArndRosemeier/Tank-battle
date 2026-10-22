/**
 * The authored A4 arena: 48 × 48 m (24 × 24 cells), four-fold rotationally symmetric,
 * four corner spawns, concentric square rings with four corner gateways per ring, a
 * breakable central pillar cluster, low shoot-over barriers and ambush pockets.
 *
 * This is DATA. `validateLevel` is called by the playable session before `createMatch`;
 * the top-down `?pose=top` plan is the review surface.
 */

import { CELL_SIZE_METRES, type CellMaterial, type CellPlacement } from '../../core/world.ts';
import type { LevelDefinition, LevelSpawn } from './format.ts';

const N = 24;
const ARENA_NAME = 'Fourfold Crucible';
const FLOOR = 0.2;
const OUTER_START = 5;
const OUTER_END = 18;
const INNER_START = 8;
const INNER_END = 15;
const RING_HEIGHT = 4.8;
const INNER_HEIGHT = 4.2;
const CENTRAL_HEIGHT = 4.8;
const POCKET_HEIGHT = 3.2;
const LOW_COVER_HEIGHT = 1.2;

function rotate(x: number, z: number): { x: number; z: number } {
  return { x: N - 1 - z, z: x };
}

const placements: CellPlacement[] = [];
const placed = new Map<string, { material: CellMaterial; heightMetres: number }>();

function add(x: number, z: number, material: Exclude<CellMaterial, 'floor'>, heightMetres: number): void {
  if (x < 0 || x >= N || z < 0 || z >= N) {
    throw new Error(`arena: placement (${x}, ${z}) is outside the ${N}×${N} grid`);
  }
  const key = `${x},${z}`;
  const existing = placed.get(key);
  if (existing) {
    if (existing.material !== material || existing.heightMetres !== heightMetres) {
      throw new Error(`arena: conflicting placements at (${x}, ${z})`);
    }
    return;
  }
  placed.set(key, { material, heightMetres });
  placements.push({ x, z, material, heightMetres });
}

/** Adds a feature and its three 90° rotations. */
function addSymmetric(x: number, z: number, material: Exclude<CellMaterial, 'floor'>, heightMetres: number): void {
  let current = { x, z };
  for (let quarter = 0; quarter < 4; quarter += 1) {
    add(current.x, current.z, material, heightMetres);
    current = rotate(current.x, current.z);
  }
}

/** A square ring with a 2×2 gateway cut out at each corner. */
function addRing(start: number, end: number, heightMetres: number): void {
  const gate = (x: number, z: number): boolean => {
    const nearX = x <= start + 1 || x >= end - 1;
    const nearZ = z <= start + 1 || z >= end - 1;
    return nearX && nearZ;
  };
  for (let x = start; x <= end; x += 1) {
    for (const z of [start, end]) {
      if (!gate(x, z)) add(x, z, 'wall', heightMetres);
    }
  }
  for (let z = start + 1; z < end; z += 1) {
    for (const x of [start, end]) {
      if (!gate(x, z)) add(x, z, 'wall', heightMetres);
    }
  }
}

// Four corner spawns, zone top-left cells and the initial hull yaw. The hull faces
// the first (eastbound) leg of a screened pinwheel dogleg; the turn takes it into
// the nearest outer gateway, not down the margin at the neighbouring spawn.
const spawns: readonly LevelSpawn[] = [
  { teamId: 0, zoneX: 2, zoneZ: 2, zoneWidth: 2, zoneHeight: 2, yawDegrees: -90 },
  { teamId: 1, zoneX: 20, zoneZ: 2, zoneWidth: 2, zoneHeight: 2, yawDegrees: 180 },
  { teamId: 2, zoneX: 20, zoneZ: 20, zoneWidth: 2, zoneHeight: 2, yawDegrees: 90 },
  { teamId: 3, zoneX: 2, zoneZ: 20, zoneWidth: 2, zoneHeight: 2, yawDegrees: 0 },
];

// Each 2×2 spawn room is walled above and below its exit and opens east into a short
// protected corridor. A screen wall closes the corridor's east end, so the exit is a
// dogleg: it turns south through the outer gateway instead of pointing down the open
// margin at the neighbouring spawn. The side opposite the exit stays open as a camera
// recess, so the follow arm does not start behind a wall. Rotated to all four corners.
const SPAWN_WALL_HEIGHT = 2.4;
const spawnRoomWalls = [
  // North and south sides of the room, the corridor's north wall and its screen.
  [2, 1],
  [3, 1],
  [2, 4],
  [3, 4],
  [4, 1],
  [5, 1],
  [6, 1],
  [7, 1],
  [7, 2],
  [7, 3],
  [7, 4],
] as const;
for (const [x, z] of spawnRoomWalls) {
  addSymmetric(x, z, 'wall', SPAWN_WALL_HEIGHT);
}

// Concentric rings. Both have four corner gateways; the second is rotated only by the
// same square geometry, so the gateways line up into the two diagonal sightlines.
addRing(OUTER_START, OUTER_END, RING_HEIGHT);
addRing(INNER_START, INNER_END, INNER_HEIGHT);

// The central objective: a breakable 2×2 pillar block with four corner pillars and
// open gap ways around it inside the inner ring.
for (let x = 11; x <= 12; x += 1) {
  for (let z = 11; z <= 12; z += 1) {
    add(x, z, 'pillar', CENTRAL_HEIGHT);
  }
}
for (const [x, z] of [
  [10, 10],
  [13, 10],
  [13, 13],
  [10, 13],
] as const) {
  add(x, z, 'pillar', 3.6);
}

// Ambush pockets beside each outer gate: a pillar just inside the gate, with a second
// shadowing the approach but leaving a gap behind it.
addSymmetric(7, 7, 'pillar', POCKET_HEIGHT);
addSymmetric(7, 9, 'pillar', 2.6);
addSymmetric(9, 7, 'pillar', 2.6);

// Low ~1.2 m shoot-over barriers along the cardinal lanes. They block a ground route
// but a high shot (the A1 height model) clears them.
for (const [x, z] of [
  [6, 8],
  [7, 8],
  [9, 10],
  [9, 11],
] as const) {
  addSymmetric(x, z, 'wall', LOW_COVER_HEIGHT);
}

// A few longer low lane segments, kept off the central gap ways so all four spawns
// remain connected at start.
for (const [x, z] of [
  [6, 10],
  [7, 10],
  [10, 6],
  [10, 7],
] as const) {
  addSymmetric(x, z, 'wall', LOW_COVER_HEIGHT);
}

// B2's team mode opens the ring corners wider than the authored 2×2 gate. With a
// 2 m tank body the authored gate graph splits into four disconnected components, so
// sixteen tanks never meet. These windows stay four-fold symmetric; the playable
// arena above deliberately keeps the tighter authored gates.
const TEAM_GATE_CENTRES = [
  [6, 6],
  [6, 17],
  [17, 6],
  [17, 17],
  [9, 9],
  [9, 14],
  [14, 9],
  [14, 14],
] as const;
const teamPlacements = placements.filter(
  (placement) =>
    !TEAM_GATE_CENTRES.some(
      ([centreX, centreZ]) =>
        Math.abs(placement.x - centreX) <= 2 && Math.abs(placement.z - centreZ) <= 2,
    ),
);

const cells = {
  columns: N,
  rows: N,
  floorSurfaceHeightMetres: FLOOR,
  placements,
} as const;

/** The authored arena. `intent` is the sentence the next level author reads first. */
export const ARENA_BOUNDS = {
  minX: 0,
  maxX: N * CELL_SIZE_METRES,
  minZ: 0,
  maxZ: N * CELL_SIZE_METRES,
} as const;

export const TEAM_ARENA: LevelDefinition = {
  name: `${ARENA_NAME} — Team Gate`,
  intent:
    'The same four-fold arena with the ring corners opened to a body-width gate ' +
    'window: four teams of four can reach each other instead of starting in four ' +
    'sealed quadrants. The corner spawns, rings, centre objective and low cover are unchanged.',
  cells: {
    ...cells,
    placements: teamPlacements,
  },
  spawns,
};

export const ARENA: LevelDefinition = {
  name: ARENA_NAME,
  intent:
    'Four corner spawns in a pinwheel, each behind a short screened dogleg exit that turns into its nearest outer gateway, so no spawn looks straight at another; concentric rings whose corner gateways make the diagonals the two long lanes; a breakable centre cluster as the objective; low cover along the cardinal lanes; ambush pockets beside each gate. Every spawn is connected on foot at start.',
  cells,
  spawns,
};

/** The centre of a 2×2 spawn zone, in metres. */
export function spawnCentreMetres(spawn: LevelSpawn): { xMetres: number; zMetres: number } {
  return {
    xMetres: (spawn.zoneX + spawn.zoneWidth / 2) * CELL_SIZE_METRES,
    zMetres: (spawn.zoneZ + spawn.zoneHeight / 2) * CELL_SIZE_METRES,
  };
}
