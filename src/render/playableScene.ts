/**
 * The playable scene: the REAL match terrain, the sim tanks, shells, wrecks and the
 * glow dressing. The terrain re-meshes only the block columns the world marked as
 * changed, and falling chunks follow the simulation's fall every frame.
 */

import { Group } from 'three';
import { MUZZLE_FORWARD_METRES, forwardFromYaw, type MatchState, type Tank } from '../core/sim.ts';
import { STEP_SECONDS } from '../core/timestep.ts';
import { groundBelow } from '../core/world.ts';
import { TERRAIN_PALETTE, teamColor } from './config.ts';
import { createEffectsView, type EffectsView } from './effectsView.ts';
import { advanceGlowClock, setGlowPulseEnabled } from './glowClock.ts';
import { createGlowView, type GlowView } from './glowView.ts';
import { createShellView, type ShellView } from './shellView.ts';
import { createWreckView, type WreckView } from './wreckView.ts';
import {
  createPlaceholderTank,
  type PlaceholderTank,
} from './placeholderTank.ts';
import { createTerrainView, type TerrainView } from './terrainView.ts';
import type { TankRenderFrame } from '../game/session.ts';

/** A presentation event for the audio seam; positions are world metres. */
export type SceneEvent =
  | { readonly type: 'fire'; readonly tankId: number; readonly teamId: number; readonly x: number; readonly y: number; readonly z: number }
  | { readonly type: 'reload'; readonly tankId: number; readonly teamId: number }
  | { readonly type: 'impact'; readonly teamId: number; readonly x: number; readonly y: number; readonly z: number }
  | { readonly type: 'hit'; readonly tankId: number; readonly teamId: number; readonly x: number; readonly y: number; readonly z: number }
  | { readonly type: 'death'; readonly tankId: number; readonly teamId: number; readonly tick: number; readonly x: number; readonly y: number; readonly z: number; readonly dx?: number; readonly dy?: number; readonly dz?: number }
  | { readonly type: 'wall-break'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly type: 'rockfall'; readonly x: number; readonly y: number; readonly z: number; readonly samples: number };

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
  readonly terrain: TerrainView;
  readonly shells: ShellView;
  readonly effects: EffectsView;
  readonly wreck: WreckView;
  readonly glow: GlowView;
  readonly tanks: ReadonlyMap<number, PlaceholderTank>;
  readonly focusTank: PlaceholderTank;
  /** Re-mesh changed terrain and move falling chunks. True when anything was re-meshed. */
  syncWorld(): boolean;
  setTanks(frames: readonly TankRenderFrame[]): void;
  setShells(state: MatchState['shells']): void;
  /** Advances the additive VFX. A frozen demo passes 0 so its flash stays alive. */
  updateEffects(dtSeconds: number): void;
  /** Drains the presentation events collected since the last call. */
  takeEvents(): readonly SceneEvent[];
  /** Reduced motion: hide the additive VFX without stopping the simulation. */
  setEffectsEnabled(enabled: boolean): void;
  setPlayerHidden(hidden: boolean): void;
  /** Hide every tank for the review plan; the spawn markers carry the plan. */
  setTanksHidden(hidden: boolean): void;
  dispose(): void;
}

export function createPlayableScene(
  state: MatchState,
  options: PlayableSceneOptions,
): PlayableScene {
  const group = new Group();
  group.name = 'playable-scene';

  const terrain = createTerrainView(state.world);
  const shells = createShellView();
  const effects = createEffectsView();
  const wreck = createWreckView((x, z, fromY) => groundBelow(state.world, x, z, fromY));
  const glow = createGlowView({
    centerX: state.world.widthMetres / 2,
    centerZ: state.world.depthMetres / 2,
    floorY: 0,
  });
  group.add(terrain.group, shells.group, effects.group, wreck.group, glow.group);

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
  let chunksShown = state.world.chunks.length;
  let playerHidden = false;
  let vfxEnabled = true;
  let disposed = false;
  const events: SceneEvent[] = [];
  // A live renderer observes every sim tick, including shots that last < one frame.
  // Headless batch runs never enable capture and therefore allocate no event queue.
  state.capturePresentationEvents = true;
  state.presentationEvents = [];

  // VFX snapshots. They start at the CURRENT state, so a scene built after a demo
  // pre-run does not replay deaths/destruction that happened before it existed.
  let shellInitialized = false;
  const previousHp = new Map<number, number>();
  const previousAlive = new Map<number, boolean>();
  for (const tank of state.tanks) {
    previousHp.set(tank.id, tank.hp);
    previousAlive.set(tank.id, tank.alive);
  }
  const onDeath = (
    tank: Tank,
    tick: number,
    direction?: { readonly x: number; readonly y: number; readonly z: number },
  ): void => {
    const view = tanks.get(tank.id);
    if (!view) throw new Error(`playableScene: death for missing tank ${tank.id}`);
    view.group.visible = false;
    // Use the SIMULATION pose, not the interpolated render frame: the wreck seed is
    // (seed, tank, tick), so the breakup must not depend on when the frame was drawn.
    wreck.spawn({
      x: tank.x,
      y: tank.y,
      z: tank.z,
      hullYawDegrees: tank.hullYawDegrees,
      turretYawDegrees: tank.turretYawDegrees,
      aimPitchDegrees: tank.aimPitchDegrees,
      teamId: tank.teamId,
      seed: state.seed,
      tankId: tank.id,
      tick,
      direction,
      reducedMotion: !vfxEnabled,
    });
  };

  /** Craters, rockfalls and landings: sparks in the wound colour and an audio cue. */
  const presentTerrain = (event: Extract<NonNullable<MatchState['presentationEvents']>[number], { type: 'terrain' }>): void => {
    if (event.kind === 'crater') {
      if (event.samples > 0) {
        effects.breakCell(event.x, event.y, event.z, TERRAIN_PALETTE.damage);
        events.push({ type: 'wall-break', x: event.x, y: event.y, z: event.z });
      }
    } else if (event.kind === 'dust') {
      effects.impact(event.x, event.y, event.z, TERRAIN_PALETTE.damage);
    } else if (event.kind === 'break') {
      effects.breakCell(event.x, event.y, event.z, TERRAIN_PALETTE.damage);
      events.push({ type: 'rockfall', x: event.x, y: event.y, z: event.z, samples: event.samples });
    } else {
      // A landing or a chunk shattering on a tank.
      effects.breakCell(event.x, event.y, event.z, TERRAIN_PALETTE.damage);
      effects.impact(event.x, event.y, event.z, TERRAIN_PALETTE.crystal);
      events.push({ type: 'wall-break', x: event.x, y: event.y, z: event.z });
    }
  };

  return {
    group,
    terrain,
    shells,
    effects,
    wreck,
    glow,
    tanks,
    focusTank,
    syncWorld(): boolean {
      // Falling chunks move every tick without a revision bump; follow them too.
      if (state.world.revision === lastRevision && state.world.chunks.length === 0 && chunksShown === 0) {
        return false;
      }
      lastRevision = state.world.revision;
      chunksShown = state.world.chunks.length;
      return terrain.sync() > 0;
    },
    setTanks(frames: readonly TankRenderFrame[]): void {
      for (const frame of frames) {
        const view = tanks.get(frame.id);
        if (!view) {
          throw new Error(`playableScene: no view for tank ${frame.id}`);
        }
        view.setSimPose(
          frame.x,
          frame.y,
          frame.z,
          frame.hullYawDegrees,
          frame.turretYawDegrees,
          frame.aimPitchDegrees,
          frame.hullPitchDegrees,
          frame.hullRollDegrees,
        );
        const previousHpForTank = previousHp.get(frame.id);
        if (!state.capturePresentationEvents && previousHpForTank !== undefined && frame.hp < previousHpForTank) {
          if (previousAlive.get(frame.id) === true && !frame.alive) {
            effects.death(
              frame.x,
              frame.y + 0.8,
              frame.z,
              teamColor(frame.teamId),
            );
            const deadTank = state.tanks.find((tank) => tank.id === frame.id);
            if (!deadTank) throw new Error(`playableScene: death for missing tank ${frame.id}`);
            onDeath(deadTank, state.tick);
            events.push({
              type: 'death',
              tankId: frame.id,
              teamId: frame.teamId,
              tick: state.tick,
              x: frame.x,
              y: frame.y + 0.8,
              z: frame.z,
            });
          } else {
            effects.hit(
              frame.x,
              frame.y + 1.1,
              frame.z,
              teamColor(frame.teamId),
            );
            events.push({
              type: 'hit',
              tankId: frame.id,
              teamId: frame.teamId,
              x: frame.x,
              y: frame.y + 1.1,
              z: frame.z,
            });
          }
        }
        previousHp.set(frame.id, frame.hp);
        previousAlive.set(frame.id, frame.alive);
        const isFocusedPlayer = frame.id === options.playerTankId;
        view.group.visible = frame.alive && !(isFocusedPlayer && playerHidden);
      }
      glow.setTanks(frames, state.tick * STEP_SECONDS);
    },
    setShells(shellsState: MatchState['shells']): void {
      const pending = state.presentationEvents?.splice(0) ?? [];
      for (const event of pending) {
        if (event.type === 'fire') {
          events.push({ type: 'fire', tankId: event.tankId, teamId: event.teamId, x: event.x, y: event.y, z: event.z });
          events.push({ type: 'reload', tankId: event.tankId, teamId: event.teamId });
          effects.muzzle(event.x, event.y, event.z, { x: event.dx, y: event.dy, z: event.dz }, teamColor(event.teamId));
          tanks.get(event.tankId)?.kick();
        } else if (event.type === 'impact') {
          effects.impact(event.x, event.y, event.z, teamColor(event.teamId));
          events.push(event);
        } else if (event.type === 'hit') {
          effects.hit(event.x, event.y, event.z, teamColor(event.teamId));
          events.push(event);
        } else if (event.type === 'terrain') {
          presentTerrain(event);
        } else if (event.type === 'death') {
          effects.death(event.x, event.y, event.z, teamColor(event.teamId));
          const deadTank = state.tanks.find((tank) => tank.id === event.tankId);
          if (!deadTank) {
            throw new Error(`playableScene: death for missing tank ${event.tankId}`);
          }
          onDeath(
            deadTank,
            event.tick,
            event.dx === undefined || event.dy === undefined || event.dz === undefined
              ? undefined
              : { x: event.dx, y: event.dy, z: event.dz },
          );
          events.push(event);
        }
      }
      // When the scene starts AFTER a pre-run demo, no events were captured.
      // Seed the first frame's existing muzzle shells only in that case.
      if (!shellInitialized) {
        shellInitialized = true;
        for (const shell of shellsState) {
          if (pending.length !== 0) break;
          const owner = state.tanks.find((tank) => tank.id === shell.ownerTankId);
          if (!owner) continue;
          const forward = forwardFromYaw(owner.turretYawDegrees);
          const x = owner.x + forward.x * MUZZLE_FORWARD_METRES;
          const z = owner.z + forward.z * MUZZLE_FORWARD_METRES;
          if (Math.hypot(shell.x - x, shell.z - z) > 4.5) continue;
          events.push({ type: 'fire', tankId: owner.id, teamId: owner.teamId, x: shell.x, y: shell.y, z: shell.z });
          events.push({ type: 'reload', tankId: owner.id, teamId: owner.teamId });
          effects.muzzle(shell.x, shell.y, shell.z, { x: shell.dx, y: shell.dy, z: shell.dz }, teamColor(owner.teamId));
        }
      }
      shells.update(shellsState);
    },
    updateEffects(dtSeconds: number): void {
      effects.update(dtSeconds);
      wreck.update(dtSeconds);
      advanceGlowClock(dtSeconds);
      for (const tank of tanks.values()) tank.updateRecoil(dtSeconds);
    },
    takeEvents(): readonly SceneEvent[] {
      const result = [...events];
      events.length = 0;
      return result;
    },
    setEffectsEnabled(enabled: boolean): void {
      vfxEnabled = enabled;
      effects.group.visible = enabled;
      setGlowPulseEnabled(enabled);
    },
    setPlayerHidden(hidden: boolean): void {
      playerHidden = hidden;
    },
    setTanksHidden(hidden: boolean): void {
      for (const view of tanks.values()) {
        view.group.visible = !hidden;
      }
      wreck.setVisible(!hidden);
      glow.trails.visible = !hidden;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      state.capturePresentationEvents = false;
      state.presentationEvents = [];
      effects.dispose();
      wreck.dispose();
      glow.dispose();
      shells.dispose();
      terrain.dispose();
      for (const tank of tanks.values()) {
        tank.dispose();
      }
      group.removeFromParent();
      group.clear();
    },
  };
}
