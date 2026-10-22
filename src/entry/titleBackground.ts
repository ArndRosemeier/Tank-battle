/**
 * The title's live, faded AI battle. It is a real `TitleSession` (4 teams of 4 AI
 * tanks) rendered into a SEPARATE canvas behind the title overlay, with a slower
 * director, a gentle deterministic drift and reduced exposure/bloom. The title frame
 * supplies the scrim; this module supplies the fight.
 *
 * Lifecycle: `start()` owns one rAF loop; `dispose()` cancels it, disposes the scene and
 * the WebGL renderer/context, and disposes the match. The shell calls `dispose()` before
 * building a player match, so the process never runs two live simulations. When a
 * background match ends it is disposed and a new one is started with the next seed;
 * that is a replacement, not a second live match.
 *
 * Audio: background SFX are MUTED (the event queue is drained); menu music is owned by
 * the shell. This is deliberate — a cannon blast in a menu is jarring.
 */

import {
  PerspectiveCamera,
} from 'three';
import { BLOOM, CAMERA, DPR_CAP } from '../render/config.ts';
import { createRenderStack } from '../render/renderStack.ts';
import { spectatorPose } from '../render/cameraMath.ts';
import { createPlayableScene, type PlayableScene } from '../render/playableScene.ts';
import { TitleSession } from '../game/titleSession.ts';

/** The background is faded by exposure + bloom, in addition to the CSS scrim. */
export const TITLE_EXPOSURE_SCALE = 0.7;
export const TITLE_BLOOM_SCALE = 0.5;
/** The title renders at 75 % internal resolution; the owner's GPU frame had headroom. */
export const TITLE_RENDER_SCALE = 0.75;

export interface TitleBackgroundOptions {
  readonly canvas: HTMLCanvasElement;
  readonly seed?: number;
  readonly teams?: number;
  readonly tanksPerTeam?: number;
  readonly onError: (error: unknown) => void;
}

export interface TitleBackground {
  readonly seed: number;
  readonly disposed: boolean;
  readonly fps: number;
  readonly drawCalls: number;
  readonly ticks: number;
  start(): void;
  dispose(): void;
}

export function createTitleBackground(options: TitleBackgroundOptions): TitleBackground {
  const canvas = options.canvas;
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('titleBackground: a canvas is required');
  }
  const camera = new PerspectiveCamera(CAMERA.fovDegrees, 1, CAMERA.nearMetres, CAMERA.farMetres);
  camera.name = 'title-background-camera';
  const renderStack = createRenderStack(canvas, camera, {
    exposureScale: TITLE_EXPOSURE_SCALE,
    bloomScale: TITLE_BLOOM_SCALE,
  });
  const { renderer, scene: threeScene, composer, bloomPass } = renderStack;

  let seed = options.seed ?? 7;
  let session = new TitleSession({ seed, teams: options.teams, tanksPerTeam: options.tanksPerTeam });
  let scene: PlayableScene = createPlayableScene(session.state, {
    focusTankId: session.directorShot().focusTankId,
  });
  threeScene.add(scene.group);

  let disposed = false;
  let frameId: number | null = null;
  let lastSeconds: number | null = null;
  let framesInWindow = 0;
  let windowStartMilliseconds = 0;
  let fps = 0;
  let drawCalls = 0;

  const resize = (): void => {
    if (disposed) return;
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP) * TITLE_RENDER_SCALE;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    bloomPass.setSize(
      Math.max(1, Math.floor(width * pixelRatio * BLOOM.resolutionScale)),
      Math.max(1, Math.floor(height * pixelRatio * BLOOM.resolutionScale)),
    );
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const applyCamera = (): void => {
    const shot = session.directorShot();
    const tick = session.state.tick;
    const yaw = shot.yawDegrees + Math.sin(tick / 260) * 1.4;
    const pitch = Math.max(2, Math.min(78, shot.pitchDegrees + Math.sin(tick / 340) * 0.7));
    const distance = shot.distanceMetres * (1 + Math.sin(tick / 300) * 0.025);
    const pose = spectatorPose({
      centerX: shot.centerX,
      centerZ: shot.centerZ,
      floorY: session.floorY,
      yawDegrees: yaw,
      distanceMetres: distance,
      pitchDegrees: pitch,
    });
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
    scene.updateCamera(camera.position);
  };

  const rebuild = (): void => {
    scene.dispose();
    threeScene.remove(scene.group);
    session.dispose();
    seed = (seed + 1) >>> 0;
    session = new TitleSession({ seed, teams: options.teams, tanksPerTeam: options.tanksPerTeam });
    scene = createPlayableScene(session.state, {
      focusTankId: session.directorShot().focusTankId,
    });
    threeScene.add(scene.group);
    applyCamera();
  };

  const frame = (nowMilliseconds: number): void => {
    if (disposed) return;
    try {
      const nowSeconds = nowMilliseconds / 1000;
      if (lastSeconds === null) {
        lastSeconds = nowSeconds;
        windowStartMilliseconds = nowMilliseconds;
      }
      const frameSeconds = nowSeconds - lastSeconds;
      lastSeconds = nowSeconds;
      session.advance(frameSeconds);
      if (session.state.status === 'ended') {
        rebuild();
      }
      const frames = session.interpolatedTanks(session.alpha);
      scene.setTanks(frames);
      scene.setShells(session.state.shells);
      scene.syncWorld();
      scene.updateEffects(frameSeconds);
      // Background SFX are muted: drain the presentation queue without an audio sink.
      scene.takeEvents();
      applyCamera();

      renderer.info.reset();
      composer.render();
      drawCalls = renderer.info.render.calls;

      framesInWindow += 1;
      const windowSeconds = (nowMilliseconds - windowStartMilliseconds) / 1000;
      if (windowSeconds >= 1) {
        fps = framesInWindow / windowSeconds;
        framesInWindow = 0;
        windowStartMilliseconds = nowMilliseconds;
      }
      frameId = requestAnimationFrame(frame);
    } catch (error) {
      // Go through the real cleanup path; setting disposed here would prevent it.
      dispose();
      options.onError(error);
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    window.removeEventListener('resize', resize);
    session.dispose();
    threeScene.remove(scene.group);
    scene.dispose();
    renderStack.dispose();
  };

  resize();
  applyCamera();
  return {
    get seed() {
      return seed;
    },
    get disposed() {
      return disposed;
    },
    get fps() {
      return fps;
    },
    get drawCalls() {
      return drawCalls;
    },
    get ticks() {
      return session.state.tick;
    },
    start(): void {
      if (disposed || frameId !== null) return;
      window.addEventListener('resize', resize);
      frameId = requestAnimationFrame(frame);
    },
    dispose,
  };
}
