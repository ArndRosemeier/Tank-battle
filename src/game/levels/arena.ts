/**
 * The authored arena, "Fourfold Crucible": a 72 × 72 m landscape of glowing triangles,
 * four-fold rotationally symmetric, with four corner spawn pads.
 *
 *  - Rolling ground rising into a steep rim at the arena edge.
 *  - A central hill you can drive over, hollowed by two crossing tunnels that meet in a
 *    cavern under the summit. Shoot the summit and the cavern roof caves in.
 *  - On each diagonal, a curved ridge between the pad and the hill, pierced by an arch:
 *    cover from the centre, a chokepoint through it, open ends around it. Its crown is
 *    hard crystal.
 *  - On each cardinal lane, a mushroom spire with a crystal cap in front of a tunnel
 *    mouth. Cut the stem and the cap comes down on whoever sheltered beneath.
 *
 * The landscape is a signed solidity function sampled by `buildTerrain`; the shape is
 * evaluated once per rotation orbit, so the four quarters are identical byte for byte.
 */

import { MATERIAL_CRYSTAL, MATERIAL_ROCK, buildTerrain, type TerrainSample } from '../../core/world.ts';
import type { LevelDefinition, LevelSpawn, SpawnSlot } from './format.ts';

const CELLS = 48;
const CELLS_Y = 16;
const SPACING = 1.5;
const SIZE = CELLS * SPACING; // 72 m
const CENTRE = SIZE / 2;
const BASE = 4.5;

const RIM_WIDTH = 7;
const RIM_HEIGHT = 7;

const HILL_RADIUS = 19;
const HILL_HEIGHT = 8;
const TUNNEL_RADIUS = 3;
const CAVERN_RADIUS = 5.5;

const RIDGE_RADIUS = 26;
const RIDGE_HALF_THICKNESS = 1.6;
const RIDGE_HEIGHT = 6;
const RIDGE_HALF_ANGLE = (28 * Math.PI) / 180;
const RIDGE_CRYSTAL_FROM = 4.6;
const ARCH_RADIUS = 2.8;

const SPIRE_DISTANCE = 27;
const SPIRE_STEM_RADIUS = 1.7;
const SPIRE_STEM_TOP = 7.5;
const SPIRE_CAP_CENTRE = 8.3;
const SPIRE_CAP_RADIUS = 4.2;
const SPIRE_CAP_HALF_HEIGHT = 1.6;

const PAD = 11;
const PAD_FLAT_RADIUS = 6;
const PAD_BLEND = 4;
const SLOT_OFFSET = 2.4;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const PAD_CENTRES: readonly (readonly [number, number])[] = [
  [PAD, PAD],
  [SIZE - PAD, PAD],
  [SIZE - PAD, SIZE - PAD],
  [PAD, SIZE - PAD],
];

/** Ground height of the open landscape (without hill, ridges or spires). */
function groundHeight(x: number, z: number): number {
  const u = x - CENTRE;
  const v = z - CENTRE;
  const r = Math.hypot(u, v);
  let padDistance = Infinity;
  for (const [px, pz] of PAD_CENTRES) {
    padDistance = Math.min(padDistance, Math.hypot(x - px, z - pz));
  }
  const rolling = 1 - smoothstep(PAD_FLAT_RADIUS, PAD_FLAT_RADIUS + PAD_BLEND, padDistance);
  const underHill = smoothstep(HILL_RADIUS - 6, HILL_RADIUS + 2, r);
  const bumps =
    (0.45 * (Math.cos(u * 0.42) + Math.cos(v * 0.42)) + 0.3 * Math.cos(r * 0.55)) * (1 - rolling) * underHill;
  const edge = Math.min(x, z, SIZE - x, SIZE - z);
  const rim = RIM_HEIGHT * (1 - smoothstep(0, RIM_WIDTH, edge));
  return BASE + bumps + rim;
}

/** The hill, with its tunnels and cavern carved out (positive inside rock). */
function hillSolidity(x: number, y: number, z: number): number {
  const u = x - CENTRE;
  const v = z - CENTRE;
  const r = Math.hypot(u, v);
  if (r >= HILL_RADIUS) return -Infinity;
  const top = BASE + HILL_HEIGHT * 0.5 * (1 + Math.cos((Math.PI * r) / HILL_RADIUS));
  const above = Math.max(0, y - BASE);
  const tunnelX = TUNNEL_RADIUS - Math.hypot(v, above);
  const tunnelZ = TUNNEL_RADIUS - Math.hypot(u, above);
  const cavern = CAVERN_RADIUS - Math.hypot(r, above * 0.9);
  return Math.min(top - y, -tunnelX, -tunnelZ, -cavern);
}

/** The four arched ridges on the diagonals. Returns solidity and whether it is the crown. */
function ridgeSolidity(x: number, y: number, z: number): number {
  const u = x - CENTRE;
  const v = z - CENTRE;
  const r = Math.hypot(u, v);
  if (Math.abs(r - RIDGE_RADIUS) > RIDGE_HALF_THICKNESS + 3) return -Infinity;
  const angle = Math.atan2(v, u);
  let best = -Infinity;
  for (const diagonal of [Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, -Math.PI / 4]) {
    let delta = angle - diagonal;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const along = (RIDGE_HALF_ANGLE - Math.abs(delta)) * r;
    const wall = Math.min(RIDGE_HALF_THICKNESS - Math.abs(r - RIDGE_RADIUS), BASE + RIDGE_HEIGHT - y, along);
    // The arch: a round tunnel along the diagonal through the ridge.
    const lateral = Math.abs(u * Math.sin(diagonal) - v * Math.cos(diagonal));
    const arch = ARCH_RADIUS - Math.hypot(lateral, Math.max(0, y - BASE));
    best = Math.max(best, Math.min(wall, -arch));
  }
  return best;
}

const SPIRES: readonly (readonly [number, number])[] = [
  [CENTRE, CENTRE - SPIRE_DISTANCE],
  [CENTRE + SPIRE_DISTANCE, CENTRE],
  [CENTRE, CENTRE + SPIRE_DISTANCE],
  [CENTRE - SPIRE_DISTANCE, CENTRE],
];

function spireSolidity(x: number, y: number, z: number): { stem: number; cap: number } {
  let stem = -Infinity;
  let cap = -Infinity;
  for (const [sx, sz] of SPIRES) {
    const d = Math.hypot(x - sx, z - sz);
    if (d > SPIRE_CAP_RADIUS + 3) continue;
    const flare = 1.5 * (1 - smoothstep(BASE, BASE + 2.5, y));
    stem = Math.max(stem, Math.min(SPIRE_STEM_RADIUS + flare - d, BASE + SPIRE_STEM_TOP - y));
    const e = Math.hypot(d / SPIRE_CAP_RADIUS, (y - BASE - SPIRE_CAP_CENTRE) / SPIRE_CAP_HALF_HEIGHT);
    cap = Math.max(cap, (1 - e) * SPIRE_CAP_HALF_HEIGHT);
  }
  return { stem, cap };
}

function arenaSample(x: number, y: number, z: number): TerrainSample {
  const ground = groundHeight(x, z) - y;
  const hill = hillSolidity(x, y, z);
  const ridge = ridgeSolidity(x, y, z);
  const spire = spireSolidity(x, y, z);
  const solidity = Math.max(ground, hill, ridge, spire.stem, spire.cap);
  const crystal =
    (spire.cap > 0 && spire.cap >= spire.stem - 0.4) || (ridge > 0 && y >= BASE + RIDGE_CRYSTAL_FROM && ridge >= ground);
  return { solidity, material: crystal ? MATERIAL_CRYSTAL : MATERIAL_ROCK };
}

const terrain = buildTerrain({
  cellsX: CELLS,
  cellsY: CELLS_Y,
  cellsZ: CELLS,
  spacingMetres: SPACING,
  fourFold: true,
  sample: arenaSample,
});

/** One 90° turn in the arena's rotation (the same turn `buildTerrain` uses). */
function rotatePoint(x: number, z: number): { x: number; z: number } {
  return { x: SIZE - z, z: x };
}

/** Team 0's pad slots, front first; the other teams' are its rotations. */
const TEAM_ZERO_SLOTS: readonly SpawnSlot[] = [
  { xMetres: PAD + SLOT_OFFSET, zMetres: PAD + SLOT_OFFSET },
  { xMetres: PAD + SLOT_OFFSET, zMetres: PAD - SLOT_OFFSET },
  { xMetres: PAD - SLOT_OFFSET, zMetres: PAD + SLOT_OFFSET },
  { xMetres: PAD - SLOT_OFFSET, zMetres: PAD - SLOT_OFFSET },
];

/** Team 0 faces the centre: forward (+1, +1) is yaw −135° in the sim convention. */
const TEAM_ZERO_YAW = -135;

function buildSpawns(): readonly LevelSpawn[] {
  const spawns: LevelSpawn[] = [];
  let centre = { x: PAD, z: PAD };
  let slots = TEAM_ZERO_SLOTS.map((slot) => ({ x: slot.xMetres, z: slot.zMetres }));
  for (let teamId = 0; teamId < 4; teamId += 1) {
    let yaw = TEAM_ZERO_YAW - 90 * teamId;
    while (yaw < -180) yaw += 360;
    spawns.push({
      teamId,
      xMetres: centre.x,
      zMetres: centre.z,
      yawDegrees: yaw,
      slots: slots.map((slot) => ({ xMetres: slot.x, zMetres: slot.z })),
    });
    centre = rotatePoint(centre.x, centre.z);
    slots = slots.map((slot) => rotatePoint(slot.x, slot.z));
  }
  return spawns;
}

/** The arena's horizontal extent in metres. */
export const ARENA_BOUNDS = {
  minX: 0,
  maxX: SIZE,
  minZ: 0,
  maxZ: SIZE,
} as const;

/** The open ground level (spawn pads, tunnel floors). Cameras and demos frame on it. */
export const ARENA_BASE_HEIGHT_METRES = BASE;

export const ARENA: LevelDefinition = {
  name: 'Fourfold Crucible',
  intent:
    'Four corner pads facing a central hill you can drive over or through: two crossing tunnels meet in a cavern under the summit, and the summit can be shot in. A curved crystal-crowned ridge on each diagonal screens the pad from the hill and is pierced by an arch; a mushroom spire stands in front of each tunnel mouth, its crystal cap ready to fall. A steep rim closes the arena.',
  terrain,
  spawns: buildSpawns(),
};

/** A pad's centre, in metres. */
export function spawnCentreMetres(spawn: LevelSpawn): { xMetres: number; zMetres: number } {
  return { xMetres: spawn.xMetres, zMetres: spawn.zMetres };
}
