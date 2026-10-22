/**
 * The playable scene: the REAL match world, two sim tanks, debris, shells and the
 * world mesh. It is deliberately separate from the A2 showcase assembly: the app now
 * renders the simulation, and the world mesh/debris rebuild ONLY when
 * `world.revision` changes.
 */

import { Group, type Vector3 } from 'three';
import type { MatchState } from '../core/sim.ts';
import { createDebrisView, type DebrisView } from './debrisView.ts';
import { createShellView, type ShellView } from './shellView.ts';
import {
  createPlaceholderTank,
  type PlaceholderTank,
} from './placeholderTank.ts';
import { createWorldMesh, type WorldMesh } from './worldMesh.ts';
import type { TankRenderFrame } from '../game/session.ts';

export interface PlayableSceneOptions {
  readonly playerTankId: number;
  readonly dummyTankId: number;
}

export interface PlayableScene {
  readonly group: Group;
  readonly worldMesh: WorldMesh;
  readonly debris: DebrisView;
  readonly shells: ShellView;
  readonly tanks: ReadonlyMap<number, PlaceholderTank>;
  readonly focusTank: PlaceholderTank;
  /** Rebuild the merged world/debris only when the world revision changed. */
  syncWorld(): boolean;
  setTanks(frames: readonly TankRenderFrame[]): void;
  setShells(state: MatchState['shells']): void;
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
  group.add(worldMesh.group, debris.group, shells.group);

  const tanks = new Map<number, PlaceholderTank>();
  for (const tank of state.tanks) {
    const view = createPlaceholderTank(tank.teamId, tank.id * 0.63);
    tanks.set(tank.id, view);
    group.add(view.group);
  }
  const focusTank = tanks.get(options.playerTankId);
  if (!focusTank) {
    throw new Error(`playableScene: player tank ${options.playerTankId} has no view`);
  }
  if (!tanks.get(options.dummyTankId)) {
    throw new Error(`playableScene: dummy tank ${options.dummyTankId} has no view`);
  }

  let lastRevision = state.world.revision;
  let playerHidden = false;
  let disposed = false;

  return {
    group,
    worldMesh,
    debris,
    shells,
    tanks,
    focusTank,
    syncWorld(): boolean {
      if (state.world.revision === lastRevision) {
        return false;
      }
      lastRevision = state.world.revision;
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
        const isFocusedPlayer = frame.id === options.playerTankId;
        view.group.visible = frame.alive && !(isFocusedPlayer && playerHidden);
      }
    },
    setShells(shellsState: MatchState['shells']): void {
      shells.update(shellsState);
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
