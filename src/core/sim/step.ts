/**
 * One deterministic simulation tick.
 *
 * Phase order (fixed, and part of the contract):
 *  1. commands are validated; hull steering, turret slew, drive over the terrain and
 *     the vertical settle (ground following, falling, landing) happen per tank;
 *  2. the world advances one tick: falling chunks drop, land or crush tanks, and the
 *     regeneration clock runs;
 *  3. the wound clock bleeds already-wounded tanks (a tank damaged in phase 5 starts
 *     its clock next tick);
 *  4. shells already in flight advance and resolve collisions; a terrain hit carves a
 *     crater, which can break rock loose; the last-team check happens AFTER those
 *     shells, so a clock death and a shell in flight in the same tick are resolved in
 *     one deterministic order;
 *  5. if the match is still active, live tanks fire: the barrel segment from the
 *     turret origin to the muzzle is swept first; a muzzle hit resolves immediately
 *     (and can end the match if it removes the last team), otherwise a shell is spawned;
 *  6. the tick cap is checked.
 *
 * The usual last-team check happens ONCE per tick, after phase 4 and before the fire
 * phase: a shell-in-flight kill does not give the winning team a gratuitous extra shot.
 * A muzzle hit during phase 5 is an immediate hit and may finish the match right there,
 * before any later tank fires; that is the one fire-phase exception.
 * A dead tank's shells already in flight keep flying (their `ownerTankId` is inert data).
 */

import { STEP_SECONDS } from '../timestep.ts';
import {
  GRAVITY_METRES_PER_SECOND_SQUARED,
  blastTerrain,
  groundBelow,
  raycastTerrain,
  stepWorld,
  type DebrisEvent,
  type Occupant,
} from '../world.ts';
import {
  MUZZLE_FORWARD_METRES,
  MUZZLE_HEIGHT_METRES,
  RELOAD_TICKS,
  SHELL_DAMAGE,
  SHELL_METRES_PER_TICK,
  SHELL_RANGE_METRES,
  TANK_FALL_DAMAGE_SPEEDS,
  TANK_HEIGHT_METRES,
  TANK_MAX_SLOPE_DEGREES,
  TANK_RADIUS_METRES,
  TANK_SNAP_DOWN_SLOPE,
  TANK_SPEED_METRES_PER_SECOND,
  TANK_STEP_METRES,
  TANK_TURN_RATE_DEGREES_PER_SECOND,
  TANK_UPHILL_SPEED_FLOOR,
  TURRET_RATE_DEGREES_PER_SECOND,
} from './constants.ts';
import {
  normaliseTankCommand,
  type TankCommand,
  type TankCommandOrder,
} from './commands.ts';
import {
  directionFromAim,
  forwardFromYaw,
  moveTowards,
  normaliseDegrees,
  pointAt,
  rotateTowards,
  segmentCircleIntersection,
  segmentCylinderIntersection,
  type Vec3,
} from './geometry.ts';
import type { MatchState, Shell, Tank, PresentationEvent } from './match.ts';
import type { DeathCause, MatchOutcome } from './stats.ts';
import { bodyHeadroomClear, footprintInsideArena, hullPoseAt, type HullPose } from './terrainBody.ts';
import { teamTurnOrder } from './turnOrder.ts';

const EPSILON = 1e-9;
const MAX_SLOPE_TAN = Math.tan((TANK_MAX_SLOPE_DEGREES * Math.PI) / 180);
/** A tank resting within this of the ground counts as on it. */
const GROUND_TOLERANCE_METRES = 0.05;

function emit(state: MatchState, event: PresentationEvent): void {
  if (state.capturePresentationEvents) (state.presentationEvents ??= []).push(event);
}
function impact(state: MatchState, shell: Shell): void {
  emit(state, { type: 'impact', teamId: shell.ownerTeamId, x: shell.x, y: shell.y, z: shell.z });
}

/** Advances the match exactly one tick. Mutates and returns `state`. */
export function stepMatch(state: MatchState, orders: readonly TankCommandOrder[]): MatchState {
  if (state.status !== 'active') {
    throw new Error(`sim.stepMatch: the match is already ended (${state.outcome ?? 'unknown'})`);
  }
  const commands = validateOrders(state, orders);

  state.tick += 1;
  state.stats.ticks = state.tick;
  const turnOrder = teamTurnOrder(state.seed, state.tick, state.teams.map((team) => team.id));

  for (const tank of orderedTanks(state, turnOrder)) {
    if (!tank.alive) {
      continue;
    }
    const command = commands.get(tank.id);
    if (!command) {
      throw new Error(`sim.stepMatch: alive tank ${tank.id} has no command`);
    }
    applyCommand(state, tank, command, turnOrder);
  }

  advanceWorld(state, turnOrder);
  bleedWoundedTanks(state, turnOrder);
  advanceShells(state, turnOrder);

  if (checkLastTeam(state)) {
    return state;
  }

  if (fireShells(state, commands, turnOrder)) {
    return state;
  }

  if (state.tick >= state.rules.tickCap) {
    finishAtTickCap(state);
  }

  return state;
}

/**
 * Validates the command set: exactly one valid command for every tank alive at the
 * start of the tick, no duplicate or unknown tank ids. Commands for tanks that are
 * already dead are allowed (a controller may not know yet) and are ignored, but they
 * are still validated.
 */
function validateOrders(
  state: MatchState,
  orders: readonly TankCommandOrder[],
): Map<number, TankCommand> {
  if (!Array.isArray(orders)) {
    throw new Error(`sim.stepMatch: commands must be an array, got ${String(orders)}`);
  }
  const known = new Map<number, Tank>();
  for (const tank of state.tanks) {
    known.set(tank.id, tank);
  }

  const commands = new Map<number, TankCommand>();
  for (const order of orders) {
    if (order === null || typeof order !== 'object') {
      throw new Error(`sim.stepMatch: a command order must be an object, got ${String(order)}`);
    }
    if (!Number.isInteger(order.tankId)) {
      throw new Error(`sim.stepMatch: command tankId must be an integer, got ${order.tankId}`);
    }
    if (!known.has(order.tankId)) {
      throw new Error(`sim.stepMatch: command for unknown tank ${order.tankId}`);
    }
    if (commands.has(order.tankId)) {
      throw new Error(`sim.stepMatch: tank ${order.tankId} has two commands`);
    }
    commands.set(
      order.tankId,
      normaliseTankCommand(order.command, `sim.stepMatch tank ${order.tankId} command`),
    );
  }

  for (const tank of state.tanks) {
    if (tank.alive && !commands.has(tank.id)) {
      throw new Error(`sim.stepMatch: alive tank ${tank.id} is missing a command`);
    }
  }
  return commands;
}

/** Hull turn, turret/pitch slew, drive, settle, and the reload countdown for one tank. */
function applyCommand(state: MatchState, tank: Tank, command: TankCommand, turnOrder: readonly number[]): void {
  tank.hullYawDegrees = normaliseDegrees(
    tank.hullYawDegrees + command.steer * TANK_TURN_RATE_DEGREES_PER_SECOND * STEP_SECONDS,
  );
  const turretStep = TURRET_RATE_DEGREES_PER_SECOND * STEP_SECONDS;
  tank.turretYawDegrees = rotateTowards(tank.turretYawDegrees, command.aimYaw, turretStep);
  tank.aimPitchDegrees = moveTowards(tank.aimPitchDegrees, command.aimPitch, turretStep);

  let moved = 0;
  // Tracks only push while they touch the ground: a falling tank keeps its x/z.
  if (command.throttle !== 0 && tank.verticalSpeed === 0) {
    const climb = Math.tan((tank.hullPitchDegrees * Math.PI) / 180) * Math.sign(command.throttle);
    const uphill = Math.max(0, Math.min(1, climb / MAX_SLOPE_TAN));
    const speedScale = 1 - (1 - TANK_UPHILL_SPEED_FLOOR) * uphill;
    const distance = command.throttle * TANK_SPEED_METRES_PER_SECOND * STEP_SECONDS * speedScale;
    const forward = forwardFromYaw(tank.hullYawDegrees);
    moved = moveTank(state, tank, forward.x * distance, forward.z * distance, turnOrder);
  }
  settleTank(state, tank, moved);

  if (tank.reloadTicksRemaining > 0) {
    tank.reloadTicksRemaining -= 1;
  }
}

/**
 * Tanks in the ONE order body collision resolves in: team rank from the seeded turn
 * order, then tank id. A later tank sees the positions of earlier movers, so the order
 * is deterministic and fair over ticks, not fixed at team 0.
 */
function orderedTanks(state: MatchState, turnOrder: readonly number[]): readonly Tank[] {
  const rank = new Map(turnOrder.map((teamId, index) => [teamId, index]));
  return [...state.tanks].sort(
    (a, b) => (rank.get(a.teamId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.teamId) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
  );
}

/**
 * Tries the full move, then the x-only slide, then the z-only slide. A candidate is
 * allowed when the terrain lets the hull stand there (`terrainMove`) AND the swept
 * circle does not pass through a live tank. Returns the horizontal distance moved.
 */
function moveTank(state: MatchState, tank: Tank, dx: number, dz: number, turnOrder: readonly number[]): number {
  const candidates: readonly (readonly [number, number])[] = [[dx, dz], [dx, 0], [0, dz]];
  for (const [cx, cz] of candidates) {
    if (cx === 0 && cz === 0) continue;
    const x = tank.x + cx;
    const z = tank.z + cz;
    const pose = terrainMove(state, tank, x, z, Math.hypot(cx, cz));
    if (!pose || tankBodyBlocksMove(state, tank, x, z, turnOrder)) continue;
    tank.x = x;
    tank.z = z;
    if (pose.y > tank.y) {
      // Climbing: the hull rises onto the new ground at once.
      tank.y = pose.y;
    }
    return Math.hypot(cx, cz);
  }
  return 0;
}

/**
 * The terrain half of a move. The ground ahead may rise by the slope allowance for
 * this distance, or by up to a small ledge if the hull's pitch stays climbable; rock in
 * the body's headroom (a wall, a low cave ceiling) blocks.
 */
function terrainMove(state: MatchState, tank: Tank, x: number, z: number, distance: number): HullPose | null {
  const world = state.world;
  if (!footprintInsideArena(world, x, z)) return null;
  const fromY = tank.y + TANK_STEP_METRES + distance * MAX_SLOPE_TAN;
  const pose = hullPoseAt(world, x, z, tank.hullYawDegrees, fromY);
  if (pose.y >= fromY - EPSILON) return null;
  const rise = pose.y - tank.y;
  if (rise > distance * MAX_SLOPE_TAN + 0.02) {
    // Steeper than a slope: only a ledge the hull can pitch over.
    if (rise > TANK_STEP_METRES || Math.abs(pose.pitchDegrees) > TANK_MAX_SLOPE_DEGREES) return null;
  }
  if (!bodyHeadroomClear(world, x, Math.max(pose.y, tank.y), z)) return null;
  return pose;
}

/**
 * Ground following and gravity. A tank on the ground follows it down a slope; when the
 * ground falls away faster than a slope (a cliff, a crater opening under it, a
 * collapsing bridge) the tank falls and lands with damage if the fall was hard.
 */
function settleTank(state: MatchState, tank: Tank, movedMetres: number): void {
  const world = state.world;
  const pose = hullPoseAt(world, tank.x, tank.z, tank.hullYawDegrees, tank.y + GROUND_TOLERANCE_METRES);
  if (pose.y >= tank.y + GROUND_TOLERANCE_METRES - EPSILON) {
    // A probe is inside rock: the hull turned on a slope, or rock arrived under it.
    // Rise onto the lowest ground above with room for the body; never through a roof.
    const lifted = liftedPose(state, tank);
    if (lifted) {
      applyPose(tank, lifted);
      tank.verticalSpeed = 0;
    }
    return;
  }
  const snap = GROUND_TOLERANCE_METRES + movedMetres * TANK_SNAP_DOWN_SLOPE;
  if (tank.verticalSpeed === 0 && pose.y >= tank.y - snap) {
    applyPose(tank, pose);
    return;
  }
  tank.verticalSpeed -= GRAVITY_METRES_PER_SECOND_SQUARED * STEP_SECONDS;
  const nextY = tank.y + tank.verticalSpeed * STEP_SECONDS;
  if (nextY > pose.y) {
    tank.y = nextY;
    return;
  }
  const impactSpeed = -tank.verticalSpeed;
  applyPose(tank, pose);
  tank.verticalSpeed = 0;
  let damage = 0;
  for (const speed of TANK_FALL_DAMAGE_SPEEDS) {
    if (impactSpeed >= speed) damage += 1;
  }
  if (damage > 0) {
    damageTank(state, tank, damage, null, 'terrain');
  }
}

function liftedPose(state: MatchState, tank: Tank): HullPose | null {
  for (let rise = TANK_STEP_METRES; rise <= TANK_HEIGHT_METRES * 2; rise += 0.25) {
    const fromY = tank.y + rise;
    const pose = hullPoseAt(state.world, tank.x, tank.z, tank.hullYawDegrees, fromY);
    if (pose.y < fromY - EPSILON && bodyHeadroomClear(state.world, tank.x, pose.y, tank.z)) return pose;
  }
  return null;
}

function applyPose(tank: Tank, pose: HullPose): void {
  tank.y = pose.y;
  tank.hullPitchDegrees = pose.pitchDegrees;
  tank.hullRollDegrees = pose.rollDegrees;
}

/**
 * The swept circle-vs-circle test against every other live tank at an overlapping
 * height. The sum of the two radii is the contact distance. Starting exactly on contact
 * is allowed when the move does not end inside; a candidate that would pass through is
 * blocked even if its endpoint is clear.
 */
function tankBodyBlocksMove(state: MatchState, tank: Tank, toX: number, toZ: number, turnOrder: readonly number[]): boolean {
  const contact = TANK_RADIUS_METRES * 2;
  const contactSq = contact * contact;
  for (const other of orderedTanks(state, turnOrder)) {
    if (other.id === tank.id || !other.alive) {
      continue;
    }
    if (Math.abs(other.y - tank.y) >= TANK_HEIGHT_METRES) {
      continue;
    }
    const startDx = tank.x - other.x;
    const startDz = tank.z - other.z;
    const startDistSq = startDx * startDx + startDz * startDz;
    if (startDistSq < EPSILON) {
      // Coincident centres (a rejected spawn can never reach here); block all movement.
      return true;
    }
    const endDx = toX - other.x;
    const endDz = toZ - other.z;
    const endDistSq = endDx * endDx + endDz * endDz;
    const t = segmentCircleIntersection(tank.x, tank.z, toX, toZ, other.x, other.z, contact);
    if (t === null) {
      continue;
    }
    if (t <= EPSILON) {
      // Already touching (or overlapping): moving out is allowed, moving in is not.
      if (endDistSq < contactSq - EPSILON) {
        return true;
      }
      continue;
    }
    if (t >= 1 - EPSILON && endDistSq >= contactSq - EPSILON) {
      // The move ends exactly at contact; touching is legal.
      continue;
    }
    return true;
  }
  return false;
}

/** The world's tick: falling rock lands or crushes tanks; regeneration runs. */
function advanceWorld(state: MatchState, turnOrder: readonly number[]): void {
  const occupants: Occupant[] = state.tanks
    .filter((tank) => tank.alive)
    .map((tank) => ({
      id: tank.id,
      x: tank.x,
      z: tank.z,
      radius: TANK_RADIUS_METRES,
      bottomY: tank.y,
      topY: tank.y + TANK_HEIGHT_METRES,
    }));
  const result = stepWorld(state.world, occupants);
  const rank = new Map(turnOrder.map((teamId, index) => [teamId, index]));
  const crushes = [...result.crushes].sort((a, b) => {
    const tankA = state.tanks[a.occupantId]!;
    const tankB = state.tanks[b.occupantId]!;
    return (rank.get(tankA.teamId) ?? 0) - (rank.get(tankB.teamId) ?? 0) || a.occupantId - b.occupantId || a.chunkId - b.chunkId;
  });
  for (const crush of crushes) {
    const tank = state.tanks.find((candidate) => candidate.id === crush.occupantId);
    if (!tank || !tank.alive || crush.damage <= 0) continue;
    damageTank(state, tank, crush.damage, state.chunkCauses.get(crush.chunkId) ?? null, 'terrain');
  }
  recordDebris(state, result.debris, null);
}

/** Emits presentation events for terrain debris and tracks who broke each chunk loose. */
function recordDebris(state: MatchState, debris: readonly DebrisEvent[], causeTeamId: number | null): void {
  for (const event of debris) {
    if (event.chunkId !== null) {
      if (event.kind === 'break' && causeTeamId !== null) {
        state.chunkCauses.set(event.chunkId, causeTeamId);
      } else if (event.kind === 'land' || event.kind === 'crush') {
        state.chunkCauses.delete(event.chunkId);
      }
    }
    emit(state, { type: 'terrain', kind: event.kind, x: event.x, y: event.y, z: event.z, samples: event.samples });
  }
}

/** A wounded tank loses one HP when its countdown expires; at zero the clock kills. */
function bleedWoundedTanks(state: MatchState, turnOrder: readonly number[]): void {
  for (const tank of orderedTanks(state, turnOrder)) {
    if (!tank.alive || tank.hp >= tank.maxHp || tank.bleedTicksRemaining <= 0) {
      continue;
    }
    tank.bleedTicksRemaining -= 1;
    if (tank.bleedTicksRemaining > 0) {
      continue;
    }
    tank.hp -= 1;
    if (tank.hp <= 0) {
      killTank(state, tank, 'clock', null);
    } else {
      tank.bleedTicksRemaining = state.rules.bleedIntervalTicks;
    }
  }
}

/** Advances every shell one tick of travel, removing the ones that hit or expire. */
function advanceShells(state: MatchState, turnOrder: readonly number[]): void {
  const survivors: Shell[] = [];
  const rank = new Map(turnOrder.map((teamId, index) => [teamId, index]));
  const shells = [...state.shells].sort(
    (a, b) => (rank.get(a.ownerTeamId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.ownerTeamId) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
  );
  for (const shell of shells) {
    if (advanceShell(state, shell)) {
      survivors.push(shell);
    } else {
      impact(state, shell);
    }
  }
  state.shells.splice(0, state.shells.length, ...survivors);
}

/** Moves one shell through one tick of distance. Returns true while it stays in flight. */
function advanceShell(state: MatchState, shell: Shell): boolean {
  const from: Vec3 = { x: shell.x, y: shell.y, z: shell.z };
  if (outsideArena(state, from.x, from.z)) {
    return false;
  }
  const remaining = Math.min(SHELL_METRES_PER_TICK, SHELL_RANGE_METRES - shell.travelledMetres);
  if (remaining <= EPSILON) {
    return false;
  }
  const to: Vec3 = {
    x: from.x + shell.dx * remaining,
    y: from.y + shell.dy * remaining,
    z: from.z + shell.dz * remaining,
  };
  const hit = earliestCollision(state, from, to);
  if (!hit) {
    shell.x = to.x;
    shell.y = to.y;
    shell.z = to.z;
    shell.travelledMetres += remaining;
    if (outsideArena(state, shell.x, shell.z)) {
      return false;
    }
    return shell.travelledMetres < SHELL_RANGE_METRES - EPSILON;
  }

  const point = pointAt(from, to, hit.t);
  shell.x = point.x;
  shell.y = point.y;
  shell.z = point.z;
  shell.travelledMetres += hit.t * remaining;
  resolveHit(state, shell.ownerTeamId, hit, point, { x: shell.dx, y: shell.dy, z: shell.dz });
  return false;
}

interface ShellHit {
  readonly t: number;
  readonly kind: 'terrain' | 'tank';
  readonly tank: Tank | null;
}

/**
 * The earliest collision along the segment: the terrain, then live tank bodies. On an
 * exact tie the terrain wins, then the lower tank id. The earliest POSITION always wins.
 */
function earliestCollision(state: MatchState, from: Vec3, to: Vec3, ignoredTankId?: number): ShellHit | null {
  let best: ShellHit | null = null;
  const terrain = raycastTerrain(state.world, from, to);
  if (terrain) {
    best = { t: terrain.t, kind: 'terrain', tank: null };
  }
  for (const tank of state.tanks) {
    if (!tank.alive || tank.id === ignoredTankId) {
      continue;
    }
    const t = segmentCylinderIntersection(from, to, tank.x, tank.z, TANK_RADIUS_METRES, tank.y, tank.y + TANK_HEIGHT_METRES);
    if (t === null) {
      continue;
    }
    if (!best || t < best.t - EPSILON || (best.kind === 'tank' && Math.abs(t - best.t) <= EPSILON && tank.id < best.tank!.id)) {
      best = { t, kind: 'tank', tank };
    }
  }
  return best;
}

/** Applies a shell's (or a barrel's) hit: a crater in the terrain or damage to a tank. */
function resolveHit(state: MatchState, ownerTeamId: number, hit: ShellHit, point: Vec3, direction: Vec3): void {
  if (hit.kind === 'terrain') {
    const blast = blastTerrain(state.world, point.x, point.y, point.z);
    state.stats.worldDamageByTeam[ownerTeamId] = (state.stats.worldDamageByTeam[ownerTeamId] ?? 0) + blast.samplesDamaged;
    state.stats.worldDestructionByTeam[ownerTeamId] = (state.stats.worldDestructionByTeam[ownerTeamId] ?? 0) + blast.samplesDestroyed;
    emit(state, { type: 'terrain', kind: 'crater', x: point.x, y: point.y, z: point.z, samples: blast.samplesDestroyed });
    recordDebris(state, blast.debris, ownerTeamId);
    return;
  }
  const target = hit.tank;
  if (!target) {
    throw new Error('sim: a tank hit lost its tank');
  }
  if (target.teamId === ownerTeamId) {
    // Q2: a teammate's body stops the shell and takes no damage.
    return;
  }
  emit(state, { type: 'hit', tankId: target.id, teamId: target.teamId, x: target.x, y: target.y + 1.1, z: target.z });
  state.stats.hits += 1;
  const applied = Math.min(SHELL_DAMAGE, target.hp);
  state.stats.damageDealt += applied;
  state.stats.damageByTeam[ownerTeamId] = (state.stats.damageByTeam[ownerTeamId] ?? 0) + applied;
  damageTank(state, target, SHELL_DAMAGE, ownerTeamId, 'shell', direction);
}

/** Removes HP from a live tank; starts its wound clock or kills it. */
function damageTank(
  state: MatchState,
  tank: Tank,
  damage: number,
  creditTeamId: number | null,
  cause: DeathCause,
  shotDirection?: Vec3,
): void {
  if (!tank.alive) {
    throw new Error(`sim: tried to damage dead tank ${tank.id}`);
  }
  tank.hp -= Math.min(damage, tank.hp);
  if (tank.hp <= 0) {
    killTank(state, tank, cause, creditTeamId, shotDirection);
  } else if (tank.bleedTicksRemaining === 0) {
    tank.bleedTicksRemaining = state.rules.bleedIntervalTicks;
  }
}

function killTank(
  state: MatchState,
  tank: Tank,
  cause: DeathCause,
  killerTeamId: number | null,
  shotDirection?: Vec3,
): void {
  emit(state, {
    type: 'death',
    tankId: tank.id,
    teamId: tank.teamId,
    tick: state.tick,
    x: tank.x,
    y: tank.y + 0.8,
    z: tank.z,
    ...(shotDirection
      ? { dx: shotDirection.x, dy: shotDirection.y, dz: shotDirection.z }
      : {}),
  });
  tank.alive = false;
  tank.hp = 0;
  tank.bleedTicksRemaining = 0;
  tank.reloadTicksRemaining = 0;
  tank.verticalSpeed = 0;
  tank.deathCause = cause;
  tank.diedAtTick = state.tick;
  tank.killedByTeamId = killerTeamId === tank.teamId ? null : killerTeamId;
  state.stats.causes[cause] += 1;
  if (cause === 'shell') {
    state.stats.kills += 1;
  }
}

/** The muzzle point: `MUZZLE_FORWARD_METRES` ahead of the hull origin, at muzzle height. */
export function muzzlePosition(tank: Tank): Vec3 {
  const forward = forwardFromYaw(tank.turretYawDegrees);
  return {
    x: tank.x + forward.x * MUZZLE_FORWARD_METRES,
    y: tank.y + MUZZLE_HEIGHT_METRES,
    z: tank.z + forward.z * MUZZLE_FORWARD_METRES,
  };
}

/**
 * Fires every live tank that held `fire` with a clear reload. Before a shell can enter
 * flight, the barrel segment from the turret origin to the muzzle is traced: the first
 * rock or live tank in that segment resolves the shot immediately. The shot still
 * counts and still spends the reload, so a blocked barrel is not a free trigger. The
 * owner tank is excluded from its own barrel trace.
 *
 * Returns true when a barrel hit ended the match immediately (last team or draw); the
 * caller must not apply the tick cap in that case.
 */
function fireShells(state: MatchState, commands: ReadonlyMap<number, TankCommand>, turnOrder: readonly number[]): boolean {
  for (const tank of orderedTanks(state, turnOrder)) {
    if (!tank.alive) {
      continue;
    }
    const command = commands.get(tank.id);
    if (!command || !command.fire || tank.reloadTicksRemaining > 0) {
      continue;
    }
    const direction = directionFromAim(tank.turretYawDegrees, tank.aimPitchDegrees);
    const muzzle = muzzlePosition(tank);
    const origin: Vec3 = { x: tank.x, y: muzzle.y, z: tank.z };

    state.stats.shotsFired += 1;
    tank.reloadTicksRemaining = RELOAD_TICKS;
    emit(state, {
      type: 'fire', tankId: tank.id, teamId: tank.teamId,
      x: muzzle.x, y: muzzle.y, z: muzzle.z,
      dx: direction.x, dy: direction.y, dz: direction.z,
    });

    const obstruction = earliestCollision(state, origin, muzzle, tank.id);
    if (obstruction) {
      resolveHit(state, tank.teamId, obstruction, pointAt(origin, muzzle, obstruction.t), direction);
      if (checkLastTeam(state)) {
        return true;
      }
      continue;
    }

    state.shells.push({
      id: state.nextShellId,
      ownerTankId: tank.id,
      ownerTeamId: tank.teamId,
      x: muzzle.x,
      y: muzzle.y,
      z: muzzle.z,
      dx: direction.x,
      dy: direction.y,
      dz: direction.z,
      travelledMetres: 0,
    });
    state.nextShellId += 1;
  }
  return false;
}

/** A shell exists over the arena; past the four sides it is gone. */
function outsideArena(state: MatchState, x: number, z: number): boolean {
  return x < 0 || z < 0 || x > state.world.widthMetres || z > state.world.depthMetres;
}

/** True when the match has ended because at most one team remains. */
function checkLastTeam(state: MatchState): boolean {
  const liveTeams = state.teams.filter((team) => team.tanks.some((tank) => tank.alive));
  if (liveTeams.length === 0) {
    finish(state, null, 'draw');
    return true;
  }
  if (liveTeams.length === 1) {
    finish(state, liveTeams[0]?.id ?? null, 'last-team');
    return true;
  }
  return false;
}

/** Tick cap: greatest total team HP, then most tanks alive, else a draw. */
function finishAtTickCap(state: MatchState): void {
  const totals = state.teams.map((team) => {
    let hp = 0;
    let alive = 0;
    for (const tank of team.tanks) {
      if (tank.alive) {
        hp += tank.hp;
        alive += 1;
      }
    }
    return { id: team.id, hp, alive };
  });

  const maxHp = Math.max(...totals.map((total) => total.hp));
  const hpLeaders = totals.filter((total) => total.hp === maxHp);
  if (hpLeaders.length === 1) {
    finish(state, hpLeaders[0]?.id ?? null, 'tick-cap');
    return;
  }

  const maxAlive = Math.max(...hpLeaders.map((total) => total.alive));
  const aliveLeaders = hpLeaders.filter((total) => total.alive === maxAlive);
  if (aliveLeaders.length === 1) {
    finish(state, aliveLeaders[0]?.id ?? null, 'tick-cap');
    return;
  }

  finish(state, null, 'draw');
}

function finish(state: MatchState, winnerTeamId: number | null, outcome: MatchOutcome): void {
  state.status = 'ended';
  state.outcome = outcome;
  state.winnerTeamId = winnerTeamId;
  state.stats.winnerTeamId = winnerTeamId;
  state.stats.outcome = outcome;
}

/**
 * A renderer-free segment cast for the player's pointer aim: the first live enemy tank
 * or terrain surface along the ray, using the same terrain march and tank cylinders as
 * shells. `direction` need not be unit length. A null result means nothing was hit
 * inside the range.
 */
export interface AimRayHit {
  readonly distanceMetres: number;
  readonly point: Vec3;
  readonly kind: 'tank' | 'terrain';
  readonly tankId: number | null;
  readonly teamId: number | null;
}

export function castAimRay(
  state: MatchState,
  from: Vec3,
  direction: Vec3,
  maxDistanceMetres: number,
  ownerTeamId: number,
): AimRayHit | null {
  for (const [value, label] of [
    [from.x, 'from.x'], [from.y, 'from.y'], [from.z, 'from.z'],
    [direction.x, 'direction.x'], [direction.y, 'direction.y'], [direction.z, 'direction.z'],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new Error(`sim.castAimRay: ${label} must be finite, got ${String(value)}`);
    }
  }
  if (!Number.isFinite(maxDistanceMetres) || maxDistanceMetres <= 0) {
    throw new Error(`sim.castAimRay: maxDistanceMetres must be finite and > 0, got ${String(maxDistanceMetres)}`);
  }
  if (!Number.isInteger(ownerTeamId) || ownerTeamId < 0) {
    throw new Error(`sim.castAimRay: ownerTeamId must be a non-negative integer, got ${String(ownerTeamId)}`);
  }
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (magnitude < EPSILON) {
    throw new Error('sim.castAimRay: direction must be non-zero');
  }
  const unit: Vec3 = { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude };
  const to: Vec3 = {
    x: from.x + unit.x * maxDistanceMetres,
    y: from.y + unit.y * maxDistanceMetres,
    z: from.z + unit.z * maxDistanceMetres,
  };

  let best: AimRayHit | null = null;
  const terrain = raycastTerrain(state.world, from, to);
  if (terrain) {
    best = {
      distanceMetres: terrain.t * maxDistanceMetres,
      point: { x: terrain.x, y: terrain.y, z: terrain.z },
      kind: 'terrain',
      tankId: null,
      teamId: null,
    };
  }
  for (const tank of state.tanks) {
    if (!tank.alive || tank.teamId === ownerTeamId) continue;
    const t = segmentCylinderIntersection(from, to, tank.x, tank.z, TANK_RADIUS_METRES, tank.y, tank.y + TANK_HEIGHT_METRES);
    if (t === null) continue;
    const distanceMetres = t * maxDistanceMetres;
    if (best && (distanceMetres > best.distanceMetres + EPSILON || (Math.abs(distanceMetres - best.distanceMetres) <= EPSILON && (best.kind === 'terrain' || (best.tankId ?? Infinity) < tank.id)))) {
      continue;
    }
    best = {
      distanceMetres,
      point: pointAt(from, to, t),
      kind: 'tank',
      tankId: tank.id,
      teamId: tank.teamId,
    };
  }
  return best;
}

/** The ground height under a point, for callers that only need "how high is it here". */
export function terrainHeightAt(state: MatchState, x: number, z: number, fromY = Infinity): number {
  return groundBelow(state.world, x, z, Math.min(fromY, state.world.heightMetres + 1));
}
