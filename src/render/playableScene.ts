/**
 * The playable scene: the REAL match world, two sim tanks, debris, shells and the
 * world mesh. It is deliberately separate from the A2 showcase assembly: the app now
 * renders the simulation, and the world mesh/debris rebuild ONLY when
 * `world.revision` changes.
 */

import { Group, type Vector3 } from 'three';
import { MUZZLE_FORWARD_METRES, forwardFromYaw, type MatchState } from '../core/sim.ts';
import { CELL_SIZE_METRES } from '../core/world.ts';
import { PALETTE, isLowCover, teamColor } from './config.ts';
import { createDebrisView, type DebrisView } from './debrisView.ts';
import { createEffectsView, type EffectsView } from './effectsView.ts';
import { createShellView, type ShellView } from './shellView.ts';
import {
  createPlaceholderTank,
  type PlaceholderTank,
} from './placeholderTank.ts';
import { createWorldMesh, type WorldMesh } from './worldMesh.ts';
import type { TankRenderFrame } from '../game/session.ts';

export interface PlayableSceneOptions {
  /** The player's tank in the playable session; omitted by the spectator. */
  readonly playerTankId?: number;
  /** The training dummy; omitted by the spectator. */
  readonly dummyTankId?: number;
  /** The tank the scene exposes as its focus; defaults to `playerTankId`. */
  readonly focusTankId?: number;
}

export interface PlayableScene {
  readonly group: Group;
  readonly worldMesh: WorldMesh;
  readonly debris: DebrisView;
  readonly shells: ShellView;
  readonly effects: EffectsView;
  readonly tanks: ReadonlyMap<number, PlaceholderTank>;
  readonly focusTank: PlaceholderTank;
  /** Rebuild the merged world/debris only when the world revision changed. */
  syncWorld(): boolean;
  setTanks(frames: readonly TankRenderFrame[]): void;
  setShells(state: MatchState['shells']): void;
  /** Advances the additive VFX. A frozen demo passes 0 so its flash stays alive. */
  updateEffects(dtSeconds: number): void;
  setPlayerHidden(hidden: boolean): void;
  /** Hide every tank for the review plan; the spawn markers carry the plan. */
  setTanksHidden(hidden: boolean): void;
  updateCamera(cameraPosition: Vector3): void;
  dispose(): void;
}

export function createPlayableScene(
  state: MatchState,
  options: PlayableSceneOptions,
): PlayableScene {
  const group = new Group();
  group.name = 'playable-scene';

  const worldMesh = createWorldMesh(state.world);
  const debris = createDebrisView(state.world);
  const shells = createShellView();
  const effects = createEffectsView();
  group.add(worldMesh.group, debris.group, shells.group, effects.group);

  const tanks = new Map<number, PlaceholderTank>();
  for (const tank of state.tanks) {
    const view = createPlaceholderTank(tank.teamId, tank.id * 0.63);
    tanks.set(tank.id, view);
    group.add(view.group);
  }
  const focusId = options.focusTankId ?? options.playerTankId;
  if (focusId === undefined) {
    throw new Error('playableScene: a focusTankId or playerTankId is required');
  }
  const focusTank = tanks.get(focusId);
  if (!focusTank) {
    throw new Error(`playableScene: focus tank ${focusId} has no view`);
  }
  if (options.dummyTankId !== undefined && !tanks.get(options.dummyTankId)) {
    throw new Error(`playableScene: dummy tank ${options.dummyTankId} has no view`);
  }

  let lastRevision = state.world.revision;
  let playerHidden = false;
  let disposed = false;

  // VFX snapshots. They start at the CURRENT state, so a scene built after a demo
  // pre-run does not replay deaths/destruction that happened before it existed.
  const previousShells = new Map<number, { x: number; y: number; z: number; teamId: number }>();
  const previousHp = new Map<number, number>();
  const previousAlive = new Map<number, boolean>();
  for (const tank of state.tanks) {
    previousHp.set(tank.id, tank.hp);
    previousAlive.set(tank.id, tank.alive);
  }
  const previousCellHp = new Int16Array(state.world.cells.length);
  state.world.cells.forEach((cell, index) => {
    previousCellHp[index] = cell.hp;
  });
  const previousBlocks = new Map<number, number>();
  for (const [key, block] of state.world.blocks) {
    previousBlocks.set(key, block.hp);
  }
  const previousShards = new Set<number>(state.world.shards.map((shard) => shard.id));

  const cellColor = (cell: (typeof state.world.cells)[number]): string => {
    if (cell.material === 'floor') return PALETTE.holeRim;
    if (isLowCover(cell.heightMetres)) return PALETTE.lowCoverEdge;
    return cell.material === 'wall' ? PALETTE.wallEdge : PALETTE.pillarEdge;
  };

  return {
    group,
    worldMesh,
    debris,
    shells,
    effects,
    tanks,
    focusTank,
    syncWorld(): boolean {
      if (state.world.revision === lastRevision) {
        return false;
      }
      lastRevision = state.world.revision;
      const floorY = state.world.floorSurfaceHeightMetres;
      state.world.cells.forEach((cell, index) => {
        const before = previousCellHp[index] ?? 0;
        if (before > 0 && cell.hp === 0) {
          effects.breakCell(
            (cell.x + 0.5) * CELL_SIZE_METRES,
            floorY + Math.max(0.2, cell.heightMetres * 0.7),
            (cell.z + 0.5) * CELL_SIZE_METRES,
            cellColor(cell),
          );
        } else if (before === 0 && cell.hp > 0) {
          effects.regen(cell.x, cell.z, cell.heightMetres, cellColor(cell));
        } else if (cell.hp < before) {
          effects.hit(
            (cell.x + 0.5) * CELL_SIZE_METRES,
            floorY + Math.max(0.2, cell.heightMetres * 0.5),
            (cell.z + 0.5) * CELL_SIZE_METRES,
            cellColor(cell),
          );
        }
        previousCellHp[index] = cell.hp;
      });

      for (const [key, block] of state.world.blocks) {
        if (!previousBlocks.has(key)) {
          effects.breakCell(
            (block.x + 0.5) * CELL_SIZE_METRES,
            floorY + block.heightMetres,
            (block.z + 0.5) * CELL_SIZE_METRES,
            PALETTE.holeRim,
          );
        }
      }
      for (const [key] of previousBlocks) {
        if (!state.world.blocks.has(key)) {
          const block = previousBlocks.get(key);
          if (block !== undefined) {
            effects.impact(
              (key % state.world.columns + 0.5) * CELL_SIZE_METRES,
              floorY + 0.4,
              (Math.floor(key / state.world.columns) + 0.5) * CELL_SIZE_METRES,
              PALETTE.holeRim,
            );
          }
        }
      }
      previousBlocks.clear();
      for (const [key, block] of state.world.blocks) previousBlocks.set(key, block.hp);

      for (const shard of state.world.shards) {
        if (!previousShards.has(shard.id)) {
          effects.shard(
            (shard.x + 0.5) * CELL_SIZE_METRES,
            floorY + 0.1,
            (shard.z + 0.5) * CELL_SIZE_METRES,
          );
        }
      }
      previousShards.clear();
      for (const shard of state.world.shards) previousShards.add(shard.id);

      worldMesh.rebuild();
      debris.rebuild();
      return true;
    },
    setTanks(frames: readonly TankRenderFrame[]): void {
      for (const frame of frames) {
        const view = tanks.get(frame.id);
        if (!view) {
          throw new Error(`playableScene: no view for tank ${frame.id}`);
        }
        view.setSimPose(
          frame.x,
          state.world.floorSurfaceHeightMetres,
          frame.z,
          frame.hullYawDegrees,
          frame.turretYawDegrees,
          frame.aimPitchDegrees,
        );
        const previousHpForTank = previousHp.get(frame.id);
        if (previousHpForTank !== undefined && frame.hp < previousHpForTank) {
          if (previousAlive.get(frame.id) === true && !frame.alive) {
            effects.death(
              frame.x,
              state.world.floorSurfaceHeightMetres + 0.8,
              frame.z,
              teamColor(frame.teamId),
            );
          } else {
            effects.hit(
              frame.x,
              state.world.floorSurfaceHeightMetres + 1.1,
              frame.z,
              teamColor(frame.teamId),
            );
          }
        }
        previousHp.set(frame.id, frame.hp);
        previousAlive.set(frame.id, frame.alive);
        const isFocusedPlayer = frame.id === options.playerTankId;
        view.group.visible = frame.alive && !(isFocusedPlayer && playerHidden);
      }
    },
    setShells(shellsState: MatchState['shells']): void {
      const current = new Map<number, { x: number; y: number; z: number; teamId: number }>();
      for (const shell of shellsState) {
        current.set(shell.id, {
          x: shell.x,
          y: shell.y,
          z: shell.z,
          teamId: shell.ownerTeamId,
        });
        if (!previousShells.has(shell.id)) {
          // A scene built after a demo pre-run sees every in-flight shell as "new".
          // Only a shell still at its owner's muzzle is a shot this frame; a shell
          // already downrange must not get a false muzzle flash in mid-air.
          const owner = state.tanks.find((tank) => tank.id === shell.ownerTankId);
          if (owner) {
            const forward = forwardFromYaw(owner.turretYawDegrees);
            const muzzleX = owner.x + forward.x * MUZZLE_FORWARD_METRES;
            const muzzleZ = owner.z + forward.z * MUZZLE_FORWARD_METRES;
            if (Math.hypot(shell.x - muzzleX, shell.z - muzzleZ) <= 1.5) {
              effects.muzzle(
                shell.x,
                shell.y,
                shell.z,
                { x: shell.dx, y: shell.dy, z: shell.dz },
                teamColor(shell.ownerTeamId),
              );
            }
          }
        }
      }
      for (const [id, last] of previousShells) {
        if (!current.has(id)) {
          effects.impact(last.x, last.y, last.z, teamColor(last.teamId));
        }
      }
      previousShells.clear();
      for (const [id, shell] of current) previousShells.set(id, shell);
      shells.update(shellsState);
    },
    updateEffects(dtSeconds: number): void {
      effects.update(dtSeconds);
    },
    setPlayerHidden(hidden: boolean): void {
      playerHidden = hidden;
    },
    setTanksHidden(hidden: boolean): void {
      for (const view of tanks.values()) {
        view.group.visible = !hidden;
      }
    },
    updateCamera(cameraPosition: Vector3): void {
      worldMesh.update(cameraPosition);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      effects.dispose();
      shells.dispose();
      debris.dispose();
      worldMesh.dispose();
      for (const tank of tanks.values()) {
        tank.dispose();
      }
      group.removeFromParent();
      group.clear();
    },
  };
}
