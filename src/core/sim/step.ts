/**
 * One deterministic simulation tick.
 *
 * Phase order (fixed, and part of the contract):
 *  1. commands are validated; hull steering, turret slew and drive happen;
 *  2. the A1 world advances one tick (regeneration + occupant displacement);
 *  3. the wound clock bleeds already-wounded tanks (a tank damaged in phase 5 starts
 *     its clock next tick);
 *  4. shells already in flight advance and resolve collisions; the last-team check
 *     happens AFTER those shells, so a clock death and a shell in flight in the same
 *     tick are resolved in one deterministic order;
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
  blockAt,
  cellAt,
  damageBlock,
  damageCell,
  shardDeflection,
  shatterShard,
  shoveShard,
  stepWorld,
  type Cell,
  type Shard,
} from '../world.ts';
import {
  CELL_SIZE_METRES,
  MUZZLE_FORWARD_METRES,
  MUZZLE_HEIGHT_METRES,
  RELOAD_TICKS,
  SHELL_DAMAGE,
  SHELL_METRES_PER_TICK,
  SHELL_RANGE_METRES,
  SHARD_HIT_HEIGHT_METRES,
  TANK_HEIGHT_METRES,
  TANK_RADIUS_METRES,
  TANK_SPEED_METRES_PER_SECOND,
  TANK_TURN_RATE_DEGREES_PER_SECOND,
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
  segmentAabbIntersection,
  segmentCircleIntersection,
  segmentCylinderIntersection,
  type Vec3,
} from './geometry.ts';
import { isTankPositionFree, type MatchState, type Shell, type Tank } from './match.ts';
import type { MatchOutcome } from './stats.ts';

const EPSILON = 1e-9;

/** Advances the match exactly one tick. Mutates and returns `state`. */
export function stepMatch(state: MatchState, orders: readonly TankCommandOrder[]): MatchState {
  if (state.status !== 'active') {
    throw new Error(`sim.stepMatch: the match is already ended (${state.outcome ?? 'unknown'})`);
  }
  const commands = validateOrders(state, orders);

  state.tick += 1;
  state.stats.ticks = state.tick;

  for (const tank of orderedTanks(state)) {
    if (!tank.alive) {
      continue;
    }
    const command = commands.get(tank.id);
    if (!command) {
      throw new Error(`sim.stepMatch: alive tank ${tank.id} has no command`);
    }
    applyCommand(state, tank, command);
  }

  advanceWorld(state);
  bleedWoundedTanks(state);
  advanceShells(state);

  if (checkLastTeam(state)) {
    return state;
  }

  if (fireShells(state, commands)) {
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

/** Hull turn, turret/pitch slew, drive, and the reload countdown for one tank. */
function applyCommand(state: MatchState, tank: Tank, command: TankCommand): void {
  tank.hullYawDegrees = normaliseDegrees(
    tank.hullYawDegrees + command.steer * TANK_TURN_RATE_DEGREES_PER_SECOND * STEP_SECONDS,
  );
  const turretStep = TURRET_RATE_DEGREES_PER_SECOND * STEP_SECONDS;
  tank.turretYawDegrees = rotateTowards(tank.turretYawDegrees, command.aimYaw, turretStep);
  tank.aimPitchDegrees = moveTowards(tank.aimPitchDegrees, command.aimPitch, turretStep);

  const distance = command.throttle * TANK_SPEED_METRES_PER_SECOND * STEP_SECONDS;
  if (distance !== 0) {
    const forward = forwardFromYaw(tank.hullYawDegrees);
    const moved = moveTank(state, tank, forward.x * distance, forward.z * distance);
    if (moved.x !== 0 || moved.z !== 0) {
      shoveShardsUnderTank(state, tank, moved.x, moved.z);
    }
  }

  if (tank.reloadTicksRemaining > 0) {
    tank.reloadTicksRemaining -= 1;
  }
}

/**
 * Tanks in the ONE order body collision resolves in: ascending tank id, never the
 * order of the caller's `tanks` array. A later tank sees the positions of earlier
 * movers, so a two-tank closing move is deterministic and id-ordered, not random.
 */
function orderedTanks(state: MatchState): readonly Tank[] {
  return [...state.tanks].sort((a, b) => a.id - b.id);
}

/**
 * Tries the full move, then the x-only slide, then the z-only slide. A candidate is
 * allowed only when the world is free at its endpoint AND the swept circle does not
 * pass through a live tank before that endpoint. A hard stop is the last resort.
 */
function moveTank(state: MatchState, tank: Tank, dx: number, dz: number): { x: number; z: number } {
  const full = canTankMoveTo(state, tank, tank.x + dx, tank.z + dz);
  if (full) {
    tank.x += dx;
    tank.z += dz;
    return { x: dx, z: dz };
  }
  if (canTankMoveTo(state, tank, tank.x + dx, tank.z)) {
    tank.x += dx;
    return { x: dx, z: 0 };
  }
  if (canTankMoveTo(state, tank, tank.x, tank.z + dz)) {
    tank.z += dz;
    return { x: 0, z: dz };
  }
  return { x: 0, z: 0 };
}

function canTankMoveTo(state: MatchState, tank: Tank, x: number, z: number): boolean {
  if (!isTankPositionFree(state.world, x, z)) {
    return false;
  }
  return !tankBodyBlocksMove(state, tank, x, z);
}

/**
 * The swept circle-vs-circle test against every other live tank. The sum of the two
 * radii is the contact distance. Starting exactly on contact is allowed when the move
 * does not end inside; a candidate that would pass through is blocked even if its
 * endpoint is clear. Max speed moves 0.1 m/tick, well below the 2 m body diameter, so
 * the sweep also makes the no-tunnelling property explicit rather than incidental.
 */
function tankBodyBlocksMove(state: MatchState, tank: Tank, toX: number, toZ: number): boolean {
  const contact = TANK_RADIUS_METRES * 2;
  const contactSq = contact * contact;
  for (const other of orderedTanks(state)) {
    if (other.id === tank.id || !other.alive) {
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
    const t = segmentCircleIntersection(
      tank.x,
      tank.z,
      toX,
      toZ,
      other.x,
      other.z,
      contact,
    );
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

/** One A1 world tick; any displacement the world decided is applied to live tanks. */
function advanceWorld(state: MatchState): void {
  const occupants = state.tanks
    .filter((tank) => tank.alive)
    .map((tank) => ({
      id: tank.id,
      x: cellCoordinate(tank.x, state.world.columns, 'x'),
      z: cellCoordinate(tank.z, state.world.rows, 'z'),
    }));

  const result = stepWorld(state.world, 1, occupants);
  for (const displacement of result.displacements) {
    const tank = state.tanks.find((candidate) => candidate.id === displacement.id);
    if (!tank || !tank.alive) {
      continue;
    }
    const fromX = tank.x;
    const fromZ = tank.z;
    tank.x = (displacement.toX + 0.5) * CELL_SIZE_METRES;
    tank.z = (displacement.toZ + 0.5) * CELL_SIZE_METRES;
    shoveShardsUnderTank(state, tank, tank.x - fromX, tank.z - fromZ);
  }
}

/**
 * A tank entering a cell shoves any floor shards in that cell one cell along its
 * movement (A1's `shoveShard` owns the destination and the fixed side order). Shards
 * never block a tank; a trapped shard may legally stay put.
 */
function shoveShardsUnderTank(state: MatchState, tank: Tank, movedX: number, movedZ: number): void {
  if (movedX === 0 && movedZ === 0) {
    return;
  }
  const cellX = Math.floor(tank.x / CELL_SIZE_METRES);
  const cellZ = Math.floor(tank.z / CELL_SIZE_METRES);
  const direction = { x: movedX, z: movedZ };
  for (const shard of [...state.world.shards]) {
    if (shard.x !== cellX || shard.z !== cellZ) {
      continue;
    }
    shoveShard(state.world, shard.id, direction);
  }
}

/** A wounded tank loses one HP when its countdown expires; at zero the clock kills. */
function bleedWoundedTanks(state: MatchState): void {
  for (const tank of state.tanks) {
    if (!tank.alive || tank.hp >= tank.maxHp || tank.bleedTicksRemaining <= 0) {
      continue;
    }
    tank.bleedTicksRemaining -= 1;
    if (tank.bleedTicksRemaining > 0) {
      continue;
    }
    tank.hp -= 1;
    if (tank.hp <= 0) {
      killTank(state, tank, 'clock');
    } else {
      tank.bleedTicksRemaining = state.rules.bleedIntervalTicks;
    }
  }
}

/** Advances every shell one tick of travel, removing the ones that hit or expire. */
function advanceShells(state: MatchState): void {
  const survivors: Shell[] = [];
  for (const shell of state.shells) {
    if (advanceShell(state, shell)) {
      survivors.push(shell);
    }
  }
  state.shells.splice(0, state.shells.length, ...survivors);
}

/**
 * Moves one shell through at most one tick of distance. Returns true when it should
 * remain in flight. A shard hit bounces it and the remaining distance continues in the
 * same tick (so a shell cannot teleport through a second obstacle).
 */
function advanceShell(state: MatchState, shell: Shell): boolean {
  let from: Vec3 = { x: shell.x, y: shell.y, z: shell.z };
  if (outsideArena(state, from.x, from.z)) {
    return false;
  }

  let remaining = Math.min(
    SHELL_METRES_PER_TICK,
    SHELL_RANGE_METRES - shell.travelledMetres,
  );
  if (remaining <= EPSILON) {
    return false;
  }

  while (remaining > EPSILON) {
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

    const distance = hit.t * remaining;
    const impact = pointAt(from, to, hit.t);
    shell.x = impact.x;
    shell.y = impact.y;
    shell.z = impact.z;
    shell.travelledMetres += distance;

    if (hit.kind === 'world') {
      if (hit.block) {
        const result = damageBlock(state.world, hit.cellX, hit.cellZ, SHELL_DAMAGE);
        state.stats.worldDamageByTeam[shell.ownerTeamId] = (state.stats.worldDamageByTeam[shell.ownerTeamId] ?? 0) + result.damageApplied;
        if (result.destroyedNow) state.stats.worldDestructionByTeam[shell.ownerTeamId] = (state.stats.worldDestructionByTeam[shell.ownerTeamId] ?? 0) + 1;
      } else {
        const result = damageCell(state.world, hit.cellX, hit.cellZ, SHELL_DAMAGE, state.rng);
        state.stats.worldDamageByTeam[shell.ownerTeamId] = (state.stats.worldDamageByTeam[shell.ownerTeamId] ?? 0) + result.damageApplied;
        if (result.destroyedNow) state.stats.worldDestructionByTeam[shell.ownerTeamId] = (state.stats.worldDestructionByTeam[shell.ownerTeamId] ?? 0) + 1;
      }
      return false;
    }

    if (hit.kind === 'tank') {
      const target = hit.tank;
      if (!target) {
        throw new Error('sim: a tank hit lost its tank');
      }
      if (target.teamId === shell.ownerTeamId) {
        // Q2: a teammate's body stops the shell and takes no damage.
        return false;
      }
      damageEnemyTank(state, target, shell.ownerTeamId);
      return false;
    }

    if (hit.kind === 'shard') {
      const shard = hit.shard;
      if (!shard) {
        throw new Error('sim: a shard hit lost its shard');
      }
      const horizontal = Math.hypot(shell.dx, shell.dz);
      if (horizontal < 1e-12) {
        throw new Error(`sim: shell ${shell.id} is vertical and cannot reflect off a shard`);
      }
      const reflected = shardDeflection(shard, {
        x: shell.dx / horizontal,
        z: shell.dz / horizontal,
      });
      shatterShard(state.world, shard.id);
      shell.dx = reflected.x * horizontal;
      shell.dz = reflected.z * horizontal;
      shell.travelledMetres += 0;

      from = { x: shell.x, y: shell.y, z: shell.z };
      remaining -= distance;
      if (shell.travelledMetres >= SHELL_RANGE_METRES - EPSILON) {
        return false;
      }
      if (remaining <= EPSILON) {
        return true;
      }
      continue;
    }

    throw new Error(`sim: unknown shell collision kind ${String((hit as { kind: string }).kind)}`);
  }

  return true;
}

interface ShellHit {
  readonly t: number;
  readonly kind: 'world' | 'shard' | 'tank';
  readonly cellX: number;
  readonly cellZ: number;
  readonly block: boolean;
  readonly shard: Shard | null;
  readonly tank: Tank | null;
}

/**
 * The earliest collision along the segment, with a fixed tie-break: world geometry
 * first, then a shard, then a tank (the brief's list), and then cell index / shard id /
 * tank id. The earliest POSITION always wins; the tie-break only settles equal `t`.
 */
function earliestCollision(
  state: MatchState,
  from: Vec3,
  to: Vec3,
  ignoredTankId?: number,
): ShellHit | null {
  let best: ShellHit | null = null;

  // Include the cells adjacent to the segment's endpoints. A segment that touches a
  // cell face exactly (the muzzle flush with a wall, a shell grazing a boundary) must
  // still test that cell; the AABB intersection rejects the extra cells honestly.
  const minCellX = Math.max(0, Math.floor(Math.min(from.x, to.x) / CELL_SIZE_METRES) - 1);
  const maxCellX = Math.min(
    state.world.columns - 1,
    Math.floor(Math.max(from.x, to.x) / CELL_SIZE_METRES) + 1,
  );
  const minCellZ = Math.max(0, Math.floor(Math.min(from.z, to.z) / CELL_SIZE_METRES) - 1);
  const maxCellZ = Math.min(
    state.world.rows - 1,
    Math.floor(Math.max(from.z, to.z) / CELL_SIZE_METRES) + 1,
  );

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const block = blockAt(state.world, cellX, cellZ);
      const cell: Cell = cellAt(state.world, cellX, cellZ);
      let topMetres = 0;
      if (block) {
        topMetres = block.heightMetres;
      } else if (cell.hp > 0) {
        topMetres = cell.heightMetres;
      }
      if (topMetres <= 0) {
        continue;
      }
      const t = segmentAabbIntersection(
        from,
        to,
        { x: cellX * CELL_SIZE_METRES, y: 0, z: cellZ * CELL_SIZE_METRES },
        {
          x: (cellX + 1) * CELL_SIZE_METRES,
          y: topMetres,
          z: (cellZ + 1) * CELL_SIZE_METRES,
        },
      );
      if (t === null) {
        continue;
      }
      const candidate: ShellHit = {
        t,
        kind: 'world',
        cellX,
        cellZ,
        block: block !== null,
        shard: null,
        tank: null,
      };
      if (isBetter(candidate, best, state.world.columns)) {
        best = candidate;
      }
    }
  }

  const floorY = state.world.floorSurfaceHeightMetres;
  for (const shard of state.world.shards) {
    const t = segmentAabbIntersection(
      from,
      to,
      { x: shard.x * CELL_SIZE_METRES, y: floorY, z: shard.z * CELL_SIZE_METRES },
      {
        x: (shard.x + 1) * CELL_SIZE_METRES,
        y: floorY + SHARD_HIT_HEIGHT_METRES,
        z: (shard.z + 1) * CELL_SIZE_METRES,
      },
    );
    if (t === null) {
      continue;
    }
    const candidate: ShellHit = {
      t,
      kind: 'shard',
      cellX: shard.x,
      cellZ: shard.z,
      block: false,
      shard,
      tank: null,
    };
    if (isBetter(candidate, best, state.world.columns)) {
      best = candidate;
    }
  }

  for (const tank of state.tanks) {
    if (!tank.alive || tank.id === ignoredTankId) {
      continue;
    }
    const t = segmentCylinderIntersection(
      from,
      to,
      tank.x,
      tank.z,
      TANK_RADIUS_METRES,
      floorY,
      floorY + TANK_HEIGHT_METRES,
    );
    if (t === null) {
      continue;
    }
    const candidate: ShellHit = {
      t,
      kind: 'tank',
      cellX: -1,
      cellZ: -1,
      block: false,
      shard: null,
      tank,
    };
    if (isBetter(candidate, best, state.world.columns)) {
      best = candidate;
    }
  }

  return best;
}

function isBetter(candidate: ShellHit, best: ShellHit | null, columns: number): boolean {
  if (!best) {
    return true;
  }
  if (candidate.t < best.t - EPSILON) {
    return true;
  }
  if (candidate.t > best.t + EPSILON) {
    return false;
  }
  const candidateRank = rank(candidate);
  const bestRank = rank(best);
  if (candidateRank !== bestRank) {
    return candidateRank < bestRank;
  }
  return tieKey(candidate, columns) < tieKey(best, columns);
}

function rank(hit: ShellHit): number {
  if (hit.kind === 'world') return 0;
  if (hit.kind === 'shard') return 1;
  return 2;
}

function tieKey(hit: ShellHit, columns: number): number {
  if (hit.kind === 'tank') return hit.tank?.id ?? Number.MAX_SAFE_INTEGER;
  if (hit.kind === 'shard') return hit.shard?.id ?? Number.MAX_SAFE_INTEGER;
  return hit.cellZ * columns + hit.cellX;
}

/** One shell's damage to an enemy tank. */
function damageEnemyTank(state: MatchState, tank: Tank, ownerTeamId: number): void {
  if (!tank.alive) {
    throw new Error(`sim: a shell tried to damage dead tank ${tank.id}`);
  }
  state.stats.hits += 1;
  const applied = Math.min(SHELL_DAMAGE, tank.hp);
  tank.hp -= applied;
  state.stats.damageDealt += applied;
  state.stats.damageByTeam[ownerTeamId] = (state.stats.damageByTeam[ownerTeamId] ?? 0) + applied;
  if (tank.hp <= 0) {
    killTank(state, tank, 'shell');
  } else if (tank.bleedTicksRemaining === 0) {
    tank.bleedTicksRemaining = state.rules.bleedIntervalTicks;
  }
}

function killTank(state: MatchState, tank: Tank, cause: 'shell' | 'clock'): void {
  tank.alive = false;
  tank.hp = 0;
  tank.bleedTicksRemaining = 0;
  tank.reloadTicksRemaining = 0;
  tank.deathCause = cause;
  tank.diedAtTick = state.tick;
  state.stats.causes[cause] += 1;
  if (cause === 'shell') {
    state.stats.kills += 1;
  }
}

/**
 * Fires every live tank that held `fire` with a clear reload. Before a shell can enter
 * flight, the barrel segment from the turret origin to the muzzle is traced: the first
 * wall, big block, shard or live tank in that segment resolves the shot immediately.
 * The shot still counts and still spends the reload, so a blocked barrel is not a free
 * trigger. The owner tank is excluded from its own barrel trace.
 *
 * Returns true when a barrel hit ended the match immediately (last team or draw); the
 * caller must not apply the tick cap in that case.
 */
function fireShells(state: MatchState, commands: ReadonlyMap<number, TankCommand>): boolean {
  for (const tank of orderedTanks(state)) {
    if (!tank.alive) {
      continue;
    }
    const command = commands.get(tank.id);
    if (!command || !command.fire || tank.reloadTicksRemaining > 0) {
      continue;
    }
    const forward = forwardFromYaw(tank.turretYawDegrees);
    const direction = directionFromAim(tank.turretYawDegrees, tank.aimPitchDegrees);
    const muzzleY = state.world.floorSurfaceHeightMetres + MUZZLE_HEIGHT_METRES;
    const origin: Vec3 = { x: tank.x, y: muzzleY, z: tank.z };
    const muzzle: Vec3 = {
      x: tank.x + forward.x * MUZZLE_FORWARD_METRES,
      y: muzzleY,
      z: tank.z + forward.z * MUZZLE_FORWARD_METRES,
    };

    state.stats.shotsFired += 1;
    tank.reloadTicksRemaining = RELOAD_TICKS;

    const obstruction = earliestCollision(state, origin, muzzle, tank.id);
    if (obstruction) {
      resolveMuzzleHit(state, tank, obstruction);
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

/**
 * The damage/stop side of the barrel sweep. A shard in the barrel is shattered and
 * consumes the shot; the current shard band (floor to 0.5 m) is below the muzzle
 * height, so this is a defensive branch rather than a common path. The shell never
 * enters `state.shells`, which is what makes a muzzle-cell hit count exactly once.
 */
function resolveMuzzleHit(state: MatchState, owner: Tank, hit: ShellHit): void {
  if (hit.kind === 'world') {
    if (hit.block) {
      const result = damageBlock(state.world, hit.cellX, hit.cellZ, SHELL_DAMAGE);
      state.stats.worldDamageByTeam[owner.teamId] = (state.stats.worldDamageByTeam[owner.teamId] ?? 0) + result.damageApplied;
      if (result.destroyedNow) state.stats.worldDestructionByTeam[owner.teamId] = (state.stats.worldDestructionByTeam[owner.teamId] ?? 0) + 1;
    } else {
      const result = damageCell(state.world, hit.cellX, hit.cellZ, SHELL_DAMAGE, state.rng);
      state.stats.worldDamageByTeam[owner.teamId] = (state.stats.worldDamageByTeam[owner.teamId] ?? 0) + result.damageApplied;
      if (result.destroyedNow) state.stats.worldDestructionByTeam[owner.teamId] = (state.stats.worldDestructionByTeam[owner.teamId] ?? 0) + 1;
    }
    return;
  }
  if (hit.kind === 'tank') {
    const target = hit.tank;
    if (!target) {
      throw new Error('sim: a muzzle tank hit lost its tank');
    }
    if (target.teamId === owner.teamId) {
      return;
    }
    damageEnemyTank(state, target, owner.teamId);
    return;
  }
  if (hit.kind === 'shard') {
    const shard = hit.shard;
    if (!shard) {
      throw new Error('sim: a muzzle shard hit lost its shard');
    }
    shatterShard(state.world, shard.id);
    return;
  }
  throw new Error(`sim: unknown muzzle collision kind ${String((hit as { kind: string }).kind)}`);
}

/** A shell exists in the horizontal arena; below the floor is allowed (bedrock). */
function outsideArena(state: MatchState, x: number, z: number): boolean {
  return (
    x < 0 ||
    z < 0 ||
    x > state.world.columns * CELL_SIZE_METRES ||
    z > state.world.rows * CELL_SIZE_METRES
  );
}

function cellCoordinate(value: number, cells: number, axis: 'x' | 'z'): number {
  const coordinate = Math.floor(value / CELL_SIZE_METRES);
  if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate >= cells) {
    throw new Error(`sim: tank ${axis} ${value} maps outside its ${cells}-cell arena`);
  }
  return coordinate;
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
