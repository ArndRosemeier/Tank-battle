import { Matrix4, Vector3 } from 'three';
import {
  OrthographicCamera,
  PerspectiveCamera,
} from 'three';
import { requireElement } from './entry/dom.ts';
import { createAimHud, createHud, type HudState } from './entry/hud.ts';
import { AudioEngine } from './entry/audio.ts';
import { createScreens, type Screens } from './entry/screens.ts';
import { createTitleBackground, type TitleBackground } from './entry/titleBackground.ts';
import { loadSettings, saveSettings, type GameSettings } from './entry/settings.ts';
import { CameraRig } from './render/cameraRig.ts';
import { createRenderStack } from './render/renderStack.ts';
import {
  isCameraPoseName,
  spectatorPose,
  type CameraPoseName,
} from './render/cameraMath.ts';
import {
  BLOOM,
  CAMERA,
  DPR_CAP,
  POST,
  PALETTE,
  SURFACE_DETAIL,
  TANK,
  teamColor,
} from './render/config.ts';
import { aimFollowYawDegrees, projectAimPoint } from './render/aimProjection.ts';
import { getSurfaceDetail, setSurfaceDetail } from './render/neonSurface.ts';
import { createPlayableScene, type SceneEvent } from './render/playableScene.ts';
import { createTopPlan, spawnMarkerColor, TOP_LEGEND_COLORS } from './render/topPlan.ts';
import { measureScene } from './render/sceneStats.ts';
import { createBrowserInput } from './game/browserInput.ts';
import {
  RELOAD_TICKS,
  type MatchState,
  type Tank,
  type TankCommand,
} from './core/sim.ts';
import { ARENA, ARENA_BOUNDS } from './game/levels/arena.ts';
import { PlayableSession, type TankRenderFrame } from './game/session.ts';
import { SpectatorSession } from './game/spectator.ts';
import { KillFeedTracker, describeKill, type KillFeedRow } from './game/killFeed.ts';
import { type PlayerInput } from './game/input.ts';
import { TitleAudioGate } from './game/titleAudioGate.ts';
import { TeamSession, createVanguardStandIn } from './game/teamSession.ts';
import { PlayerAimController, solveAim, type AimCamera, type AimSolution } from './game/aim.ts';

/**
 * Slice A3c's wiring: the real MatchState on a fixed 60 Hz bridge, two sim tanks, a
 * pointer/keyboard player controller, shells/debris and the in-style HUD. It holds no
 * gameplay rules of its own: input mapping lives in `src/game/input.ts`, the match and
 * interpolation in `src/game/session.ts`, and every render choice in `src/render/`.
 *
 * Seams kept here:
 *  - `reportError` is the app's ONE visible failure surface;
 *  - `FixedStep` (inside the session) is the ONE frame-delta-to-steps conversion;
 *  - no simulation runs in the render layer;
 *  - the world/debris meshes rebuild only when `world.revision` changes.
 */

const canvas = requireElement('app', HTMLCanvasElement, 'canvas');
const errorBox = requireElement('error', HTMLElement, 'error surface');

function reportError(cause: unknown): void {
  const text = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  errorBox.textContent = text;
  errorBox.style.display = 'block';
  errorBox.style.background = PALETTE.error;
  console.error(cause);
}

window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

type RenderPoseName = CameraPoseName | 'top' | 'spectate';

/**
 * The generated rocket clip has its launch burst at ~2.7 s; play a bounded slice so a
 * 4.75 s reload never stacks an eight-second file. The cannon layer supplies the body.
 */
const ROCKET_SFX = { offsetSeconds: 2.55, durationSeconds: 1.15 } as const;
type LaunchMode = 'play' | 'team' | 'spectate' | 'title';

interface LaunchOptions {
  readonly mode: LaunchMode;
  readonly detail: number | null;
  readonly pose: RenderPoseName | null;
  readonly demo: boolean;
  /** Demo defaults to 571 (play) or 600 (team); spectator has no pre-run unless `?ticks=`. */
  readonly ticks: number | null;
  readonly teams: number;
  readonly tanksPerTeam: number;
  readonly seed: number;
  /** `?settings=1` on the title screen opens the settings panel. */
  readonly settings: boolean;
}

/** `?mode=title`, `?detail=…&pose=…&demo=duel&ticks=571` or `?mode=spectate&…`. Unknown values fail visibly. */
function readLaunchOptions(): LaunchOptions {
  const query = new URLSearchParams(window.location.search);
  const hasGameParameter = ['pose', 'demo', 'ticks', 'teams', 'tanksPerTeam', 'seed'].some((key) =>
    query.has(key),
  );

  const modeText = query.get('mode');
  let mode: LaunchMode = hasGameParameter ? 'play' : 'title';
  if (modeText !== null) {
    if (modeText !== 'play' && modeText !== 'team' && modeText !== 'spectate' && modeText !== 'title') {
      throw new Error(
        `launch: unknown ?mode "${modeText}" — expected play, team, spectate or title`,
      );
    }
    mode = modeText;
  }

  const settingsText = query.get('settings');
  if (settingsText !== null) {
    if (settingsText !== '1') {
      throw new Error(`launch: ?settings must be 1, got "${settingsText}"`);
    }
    if (mode !== 'title') {
      throw new Error('launch: ?settings is only valid on the title screen (?mode=title)');
    }
  }
  const settings = settingsText === '1';

  const detailText = query.get('detail');
  let detail: number | null = null;
  if (detailText !== null) {
    detail = Number(detailText);
    if (!Number.isFinite(detail) || detail < 0 || detail > 1) {
      throw new Error(`launch: ?detail must be a number within 0…1, got "${detailText}"`);
    }
  }

  const poseText = query.get('pose');
  let pose: RenderPoseName | null = null;
  if (poseText !== null) {
    if (mode === 'title') {
      throw new Error('launch: the title screen takes no ?pose; start a match first');
    }
    if (poseText === 'top' && mode === 'play') {
      pose = 'top';
    } else if (poseText === 'spectate' && mode === 'spectate') {
      pose = 'spectate';
    } else if (poseText === 'team' && mode === 'team') {
      pose = 'team';
    } else if (isCameraPoseName(poseText) && mode !== 'spectate') {
      pose = poseText;
    } else {
      const expected =
        mode === 'play'
          ? 'wide, tank, first, combat or top'
          : mode === 'team'
            ? 'wide, tank, first, combat or team'
            : 'spectate';
      throw new Error(
        `launch: unknown ?pose "${poseText}" for mode "${mode}" — expected ${expected}`,
      );
    }
  }

  const demoText = query.get('demo');
  const demo = demoText !== null;
  if (demo) {
    if (mode === 'title') {
      throw new Error('launch: the title screen takes no ?demo');
    }
    if (mode === 'play' && demoText !== 'duel') {
      throw new Error(`launch: ?demo="${demoText}" is only valid as ?demo=duel in play mode`);
    }
    if (mode === 'team' && demoText !== 'team') {
      throw new Error(`launch: ?demo="${demoText}" is only valid as ?demo=team in team mode`);
    }
    if (mode === 'spectate') {
      throw new Error('launch: ?demo is not valid in spectate mode');
    }
  }

  const ticksText = query.get('ticks');
  let ticks: number | null = demo ? (mode === 'team' ? 480 : 571) : null;
  if (ticksText !== null) {
    if (mode === 'title') {
      throw new Error('launch: the title screen takes no ?ticks');
    }
    ticks = Number(ticksText);
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 10000) {
      throw new Error(`launch: ?ticks must be an integer within 0…10000, got "${ticksText}"`);
    }
    if (!demo && mode !== 'spectate') {
      throw new Error('launch: ?ticks is only valid with ?demo=… or ?mode=spectate');
    }
  }

  const teamsText = query.get('teams');
  if (mode === 'title' && (teamsText !== null || query.get('tanksPerTeam') !== null)) {
    throw new Error('launch: the title screen takes no ?teams/?tanksPerTeam');
  }
  if (mode === 'team' && (teamsText !== null || query.get('tanksPerTeam') !== null)) {
    throw new Error(
      'launch: ?teams/?tanksPerTeam are spectator-only; team mode is the player plus three squadmates against three teams of four',
    );
  }
  const teams = teamsText === null ? 4 : Number(teamsText);
  if (!Number.isInteger(teams) || teams < 2 || teams > 4) {
    throw new Error(`launch: ?teams must be an integer 2…4, got "${teamsText ?? teams}"`);
  }
  const tanksText = query.get('tanksPerTeam');
  const tanksPerTeam = tanksText === null ? 4 : Number(tanksText);
  if (!Number.isInteger(tanksPerTeam) || tanksPerTeam < 1 || tanksPerTeam > 4) {
    throw new Error(
      `launch: ?tanksPerTeam must be an integer 1…4, got "${tanksText ?? tanksPerTeam}"`,
    );
  }
  const seedText = query.get('seed');
  const seed = seedText === null ? 1 : Number(seedText);
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`launch: ?seed must be a non-negative integer, got "${seedText ?? seed}"`);
  }

  return { mode, detail, pose, demo, ticks, teams, tanksPerTeam, seed, settings };
}

const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    strength: { value: POST.vignetteStrength },
    radius: { value: POST.vignetteRadius },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float radius;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float distanceFromCenter = length(vUv - 0.5) * 1.41421356;
      float vignette = 1.0 - strength * smoothstep(radius, 1.0, distanceFromCenter);
      gl_FragColor = vec4(color.rgb * vignette, color.a);
    }
  `,
};

/** The all-AI spectator entry: no HUD, no player input, director camera. */
function bootSpectate(launch: LaunchOptions, audio: AudioEngine): (nowMilliseconds: number) => void {
  document.body.style.background = PALETTE.background;
  const spectator = new SpectatorSession({
    teams: launch.teams,
    tanksPerTeam: launch.tanksPerTeam,
    seed: launch.seed,
  });
  if (launch.ticks !== null) {
    spectator.runTicks(launch.ticks);
  }
  const initialFocus = spectator.followedTankId ?? spectator.state.tanks[0]?.id;
  if (initialFocus === undefined) throw new Error('spectate: the match has no tanks');
  const scene = createPlayableScene(spectator.state, { focusTankId: initialFocus });
  const sceneStats = measureScene(scene.group);
  console.log(
    `[tank-battle] spectator scene: ${sceneStats.drawObjects} draw objects · ` +
      `${sceneStats.triangles} triangles · ${sceneStats.vertices} vertices · ` +
      `${spectator.characters.join('/')}`,
  );

  const camera = new PerspectiveCamera(CAMERA.fovDegrees, 1, CAMERA.nearMetres, CAMERA.farMetres);
  camera.name = 'spectator-camera';
  const { renderer, scene: threeScene, composer, bloomPass } = createRenderStack(canvas, camera, {
    exposureScale: CAMERA.spectatorExposureScale,
    vignetteShader: VIGNETTE_SHADER,
  });
  threeScene.add(scene.group);

  activeQuality = (settings) => {
    if (launch.detail === null) setSurfaceDetail(settings.quality);
    bloomPass.strength = BLOOM.strength * (0.7 + settings.quality);
    scene.setEffectsEnabled(!settings.reducedMotion);
  };
  activeQuality(currentSettings);
  if (audio.isUnlocked) audio.playMusic('combat');

  const hud = requireElement('hud', HTMLElement, 'hud');
  hud.style.display = 'none';
  const topLegend = requireElement('top-legend', HTMLElement, 'top legend');
  topLegend.style.display = 'none';

  let lastFps = 0;
  let framesInWindow = 0;
  let windowStartMilliseconds = 0;
  let drawCalls = 0;
  let lastSeconds: number | null = null;
  let pauseOnNextWreck = false;

  function applyCamera(): void {
    const shot = spectator.directorShot();
    const pose = spectatorPose({
      centerX: shot.centerX,
      centerZ: shot.centerZ,
      floorY: spectator.floorY,
      yawDegrees: shot.yawDegrees,
      distanceMetres: shot.distanceMetres,
      pitchDegrees: shot.pitchDegrees,
    });
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
    scene.updateCamera(camera.position);
  }

  function resize(): void {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    bloomPass.setSize(
      Math.max(1, Math.floor(width * pixelRatio * BLOOM.resolutionScale)),
      Math.max(1, Math.floor(height * pixelRatio * BLOOM.resolutionScale)),
    );
  }

  function frame(nowMilliseconds: number): void {
    try {
      const nowSeconds = nowMilliseconds / 1000;
      if (lastSeconds === null) {
        lastSeconds = nowSeconds;
        windowStartMilliseconds = nowMilliseconds;
      }
      const frameSeconds = nowSeconds - lastSeconds;
      lastSeconds = nowSeconds;

      if (!spectator.frozenFrame && !paused) {
        spectator.advance(frameSeconds);
      }
      const frames = spectator.interpolatedTanks(spectator.alpha);
      scene.setTanks(frames);
      scene.setShells(spectator.state.shells);
      if (pauseOnNextWreck && scene.wreck.debug().spawnCount > 0) {
        pauseOnNextWreck = false;
        paused = true;
      }
      scene.syncWorld();
      for (const event of scene.takeEvents()) {
        if (event.type === 'wall-break') audio.playSfx('wall-break', 0.22);
        else if (event.type === 'regen') audio.playSfx('regen', 0.18);
        else if (event.type === 'death') audio.playSfx('death', 0.3);
      }
      scene.updateEffects(paused || spectator.frozenFrame ? 0 : frameSeconds);
      applyCamera();

      renderer.info.reset();
      composer.render();
      drawCalls = renderer.info.render.calls;
      canvas.dataset.drawCalls = String(drawCalls);
      canvas.dataset.spectatorTicks = String(spectator.state.tick);
      canvas.dataset.spectatorFocus = String(spectator.followedTankId ?? -1);

      framesInWindow += 1;
      const windowSeconds = (nowMilliseconds - windowStartMilliseconds) / 1000;
      if (windowSeconds >= 1) {
        lastFps = framesInWindow / windowSeconds;
        framesInWindow = 0;
        windowStartMilliseconds = nowMilliseconds;
        console.log(
          `[tank-battle] spectate ${lastFps.toFixed(1)} fps · ` +
            `${renderer.domElement.width}×${renderer.domElement.height} · ${drawCalls} draw calls · ` +
            `tick ${spectator.state.tick} · focus ${spectator.followedTankId ?? '-'} · ` +
            `auto ${spectator.autoDirector ? 'on' : 'off'}`,
        );
      }
      if (!Number.isFinite(lastFps)) throw new Error('main: spectator fps became non-finite');
      requestAnimationFrame(frame);
    } catch (cause) {
      reportError(cause);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyN') {
      spectator.nextTank();
    } else if (event.code === 'KeyA') {
      spectator.resumeAutoDirector();
    }
  });

  const debugApi = {
    fps: () => lastFps,
    drawCalls: () => drawCalls,
    pixels: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
    ticks: () => spectator.state.tick,
    teams: () => spectator.state.teams.length,
    tanks: () => spectator.state.tanks.length,
    focus: () => spectator.followedTankId,
    auto: () => spectator.autoDirector,
    shot: () => spectator.directorShot(),
    sceneStats: () => sceneStats,
    wreck: () => scene.wreck.debug(),
    pauseOnNextWreck: () => {
      pauseOnNextWreck = true;
    },
    wreckStep: (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error(`wreckStep: seconds must be finite and >= 0, got ${String(seconds)}`);
      }
      paused = true;
      scene.wreck.update(seconds);
      return scene.wreck.debug();
    },
    audio: () => ({
      unlocked: audio.isUnlocked,
      clips: audio.loadedClipCount,
      state: audio.contextState,
      paused,
    }),
  };
  (window as Window & { __TANK_BATTLE__?: typeof debugApi }).__TANK_BATTLE__ = debugApi;

  resize();
  applyCamera();
  return frame;
}

/** What the render loop needs from a running match; both sessions satisfy it. */
interface MatchView {
  readonly state: MatchState;
  readonly playerTankId: number;
  readonly floorY: number;
  readonly alpha: number;
  readonly frozen: boolean;
  readonly player: TankRenderFrame;
  /** Character names for kill-feed victims on the player's team; empty in duel mode. */
  readonly feedNames: readonly string[];
  advance(frameSeconds: number): number;
  interpolatedTanks(alpha: number): readonly TankRenderFrame[];
}

interface AimCameraState {
  camera: AimCamera | null;
}

/** The plain snapshot the aim solver consumes; no three.js object crosses the seam. */
function aimCameraView(camera: PerspectiveCamera, forward: Vector3): AimCamera {
  camera.getWorldDirection(forward);
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: {
      x: camera.position.x + forward.x,
      y: camera.position.y + forward.y,
      z: camera.position.z + forward.z,
    },
    up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
    fovDegrees: camera.fov,
    aspect: camera.aspect,
  };
}

/** Binds the player's command source to the playable session's per-tick advance. */
function playableMatchView(
  session: PlayableSession,
  commandFor: (state: MatchState, player: Tank) => TankCommand,
): MatchView {
  return {
    get state() {
      return session.state;
    },
    get playerTankId() {
      return session.playerTankId;
    },
    get floorY() {
      return session.floorY;
    },
    get alpha() {
      return session.alpha;
    },
    get frozen() {
      return session.demo;
    },
    get player() {
      return session.player;
    },
    feedNames: [],
    advance(frameSeconds: number): number {
      return session.advance(frameSeconds, commandFor);
    },
    interpolatedTanks(alpha: number): readonly TankRenderFrame[] {
      return session.interpolatedTanks(alpha);
    },
  };
}

/** The duel HUD: the player's hull and reload ring plus the training target. */
function playHudState(session: PlayableSession, fps: number): HudState {
  const player = session.state.tanks[session.playerTankId];
  const dummy = session.state.tanks[session.dummyTankId];
  if (!player || !dummy) {
    throw new Error('main: the playable session lost a tank');
  }
  return {
    status: session.state.status,
    outcome: session.state.outcome,
    winnerTeamId: session.state.winnerTeamId,
    playerTeamId: player.teamId,
    playerHp: player.hp,
    playerMaxHp: player.maxHp,
    reloadTicksRemaining: player.reloadTicksRemaining,
    reloadTicks: RELOAD_TICKS,
    fps,
    targetTeamId: dummy.teamId,
    targetHp: dummy.hp,
    targetMaxHp: dummy.maxHp,
  };
}

/** The player team's HUD: the same hull/reload block plus the three squad rows. */
function teamHudState(session: TeamSession, fps: number): HudState {
  const player = session.state.tanks[session.playerTankId];
  if (!player) {
    throw new Error('main: the team session lost the player tank');
  }
  const squad = session.squad.slice(1).map((tank) => {
    const name = session.characters[tank.teamIndex];
    if (!name) {
      throw new Error(`main: no character name for team slot ${tank.teamIndex}`);
    }
    return { name, hp: tank.hp, maxHp: tank.maxHp, alive: tank.alive };
  });
  return {
    status: session.state.status,
    outcome: session.state.outcome,
    winnerTeamId: session.state.winnerTeamId,
    playerTeamId: player.teamId,
    playerHp: player.hp,
    playerMaxHp: player.maxHp,
    reloadTicksRemaining: player.reloadTicksRemaining,
    reloadTicks: RELOAD_TICKS,
    fps,
    squad,
  };
}

/** The single app shell state shared by the title, pause, settings and the match. */
let currentSettings = loadSettings();
let audioEngine: AudioEngine | null = null;
let screensUi: Screens | null = null;
let gameStarted = false;
let paused = false;
let activeQuality: ((settings: GameSettings) => void) | null = null;
let titleBackground: TitleBackground | null = null;
let titleGate: TitleAudioGate | null = null;
let titleGestureCleanup: (() => void) | null = null;

function applySettings(settings: GameSettings): void {
  currentSettings = settings;
  saveSettings(settings);
  audioEngine?.setVolumes({
    master: settings.master,
    music: settings.music,
    sfx: settings.sfx,
  });
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  if (!gameStarted) setSurfaceDetail(settings.quality);
  activeQuality?.(settings);
}

/** Must be called from a user gesture; the browser will not start audio otherwise. */
function ensureAudio(track: 'menu' | 'combat'): void {
  const audio = audioEngine;
  if (!audio) return;
  if (!audio.isUnlocked) {
    audio.unlock();
    screensUi?.setSoundUnlocked(true);
  }
  audio.playMusic(track);
}

function pauseMatch(): void {
  if (!gameStarted || paused || screensUi?.isSettingsOpen()) return;
  paused = true;
  audioEngine?.setDucked(true);
  screensUi?.showPause();
}

function resumeMatch(): void {
  if (!gameStarted) return;
  paused = false;
  screensUi?.hideAll();
  audioEngine?.setDucked(false);
}

function startGame(mode: 'play' | 'team' | 'spectate'): void {
  if (gameStarted) return;
  if (titleBackground) {
    titleBackground.dispose();
    titleBackground = null;
  }
  titleGestureCleanup?.();
  titleGestureCleanup = null;
  const titleCanvas = document.getElementById('title-canvas');
  if (titleCanvas) titleCanvas.style.display = 'none';
  gameStarted = true;
  screensUi?.hideAll();
  document.body.classList.remove('title-mode');
  ensureAudio('combat');
  window.history.replaceState(null, '', `?mode=${mode}`);
  const launch: LaunchOptions = {
    mode,
    detail: null,
    pose: null,
    demo: false,
    ticks: null,
    teams: 4,
    tanksPerTeam: 4,
    seed: 1,
    settings: false,
  };
  const audio = audioEngine;
  if (!audio) throw new Error('main: audio engine is missing');
  const frame = bootGame(launch, audio);
  requestAnimationFrame(frame);
}

/**
 * The ONE scene/render/loop path for both playable modes. The session supplies the
 * current match, the player's tank and per-frame ticks; this function owns the
 * renderer, the follow rig, the screenshot poses and the HUD update.
 */
function bootMatch(
  launch: LaunchOptions,
  session: MatchView,
  hudState: (fps: number) => HudState,
  audio: AudioEngine,
  readInput: () => PlayerInput,
  aimCameraState: AimCameraState,
): (nowMilliseconds: number) => void {
  const scene = createPlayableScene(session.state, {
    playerTankId: session.playerTankId,
    dummyTankId: launch.mode === 'play' ? 1 : undefined,
  });
  const aimHud = createAimHud();
  const killFeed = new KillFeedTracker();
  let feedRows: KillFeedRow[] = killFeed
    .prime(session.state)
    .map((notice) => ({ ...describeKill(notice, session.feedNames), tick: notice.tick }))
    .slice(0, 4);
  let damageFlash = 0;
  let lastPlayerHp = session.state.tanks[session.playerTankId]?.hp ?? 0;
  let endAnnounced = false;
  let lastBreakTick = -999;
  let lastRegenTick = -999;
  let lastAim: AimSolution | null = null;
  let pauseOnNextWreck = false;
  const cameraDirection = new Vector3();
  const initialPlayer = session.player;
  const sceneStats = measureScene(scene.group);
  console.log(
    `[tank-battle] ${launch.mode} scene: ${sceneStats.drawObjects} draw objects · ` +
      `${sceneStats.triangles} triangles · ${sceneStats.vertices} vertices · ` +
      `hull half-width ${TANK_HALF_WIDTH_METRES.toFixed(2)} m`,
  );

  // The renderer is created after the camera, below. The scene owns the rendered contents.

  const isTop = launch.pose === 'top';
  const topPlan = createTopPlan(ARENA);
  topPlan.setVisible(isTop);
  const rigPose: CameraPoseName | null =
    launch.pose !== null && isCameraPoseName(launch.pose) ? launch.pose : null;
  const rig = new CameraRig({
    arena: ARENA_BOUNDS,
    floorY: session.floorY,
    focus: {
      position: { x: initialPlayer.x, y: session.floorY, z: initialPlayer.z },
      yawDegrees: aimFollowYawDegrees(
        initialPlayer.hullYawDegrees,
        initialPlayer.turretYawDegrees,
      ),
    },
    pose: isTop ? null : rigPose,
  });

  const topCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const topCenterX = (ARENA_BOUNDS.minX + ARENA_BOUNDS.maxX) / 2;
  const topCenterZ = (ARENA_BOUNDS.minZ + ARENA_BOUNDS.maxZ) / 2;
  const TOP_HALF_HEIGHT_METRES = 26;
  topCamera.position.set(topCenterX, 60, topCenterZ);
  topCamera.up.set(0, 0, -1);
  topCamera.lookAt(topCenterX, session.floorY, topCenterZ);
  topCamera.name = 'top-orthographic-camera';
  topCamera.updateMatrixWorld();

  const { renderer, scene: threeScene, composer, bloomPass } = createRenderStack(canvas, isTop ? topCamera : rig.camera, {
    vignetteShader: VIGNETTE_SHADER,
  });
  threeScene.add(scene.group);
  threeScene.add(topPlan.group);

  activeQuality = (settings) => {
    if (launch.detail === null) setSurfaceDetail(settings.quality);
    bloomPass.strength = BLOOM.strength * (0.7 + settings.quality);
    scene.setEffectsEnabled(!settings.reducedMotion);
  };
  activeQuality(currentSettings);
  if (audio.isUnlocked) audio.playMusic('combat');

  const hud = createHud();
  const hudRoot = requireElement('hud', HTMLElement, 'hud');
  const topLegend = requireElement('top-legend', HTMLElement, 'top legend');
  const topTitle = requireElement('top-title', HTMLElement, 'top title');
  const topIntent = requireElement('top-intent', HTMLElement, 'top intent');
  const topSwatches = requireElement('top-swatches', HTMLElement, 'top spawn swatches');
  const legendWall = requireElement('legend-wall', HTMLElement, 'wall legend swatch');
  const legendLow = requireElement('legend-low', HTMLElement, 'low-cover legend swatch');
  const legendObjective = requireElement('legend-objective', HTMLElement, 'objective legend swatch');
  const legendExit = requireElement('legend-exit', HTMLElement, 'exit legend swatch');
  topLegend.style.display = 'none';
  if (isTop) {
    hudRoot.style.display = 'none';
    topLegend.style.display = 'block';
    topLegend.style.color = PALETTE.debugText;
    topTitle.textContent = ARENA.name;
    topIntent.textContent = ARENA.intent;
    legendWall.style.background = TOP_LEGEND_COLORS.wall;
    legendLow.style.background = TOP_LEGEND_COLORS.lowCover;
    legendObjective.style.background = TOP_LEGEND_COLORS.objective;
    legendExit.style.background = TOP_LEGEND_COLORS.exit;
    for (const spawn of ARENA.spawns) {
      const swatch = document.createElement('span');
      swatch.className = 'spawn-swatch';
      swatch.style.color = spawnMarkerColor(spawn.teamId);
      swatch.style.marginLeft = '5px';
      swatch.title = `team ${spawn.teamId} spawn`;
      topSwatches.append(swatch);
    }
  }

  let lastFps = 0;
  let framesInWindow = 0;
  let windowStartMilliseconds = 0;
  let drawCalls = 0;
  let lastSeconds: number | null = null;

  function resize(): void {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    const aspect = width / height;
    rig.resize(aspect);
    topCamera.left = -TOP_HALF_HEIGHT_METRES * aspect;
    topCamera.right = TOP_HALF_HEIGHT_METRES * aspect;
    topCamera.top = TOP_HALF_HEIGHT_METRES;
    topCamera.bottom = -TOP_HALF_HEIGHT_METRES;
    topCamera.updateProjectionMatrix();

    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    bloomPass.setSize(
      Math.max(1, Math.floor(width * pixelRatio * BLOOM.resolutionScale)),
      Math.max(1, Math.floor(height * pixelRatio * BLOOM.resolutionScale)),
    );
  }

  function playEvent(event: SceneEvent): void {
    const player = session.state.tanks[session.playerTankId];
    const playerTeam = player?.teamId ?? 0;
    const near = (x: number, z: number): number =>
      player === undefined ? Number.POSITIVE_INFINITY : Math.hypot(x - player.x, z - player.z);
    switch (event.type) {
      case 'fire': {
        if (event.tankId === session.playerTankId) {
          audio.playSfx('cannon', 0.55);
          audio.playSfx('rocket', 0.9, ROCKET_SFX);
          // Blowback is presentation only: the sim position/velocity never changes.
          if (!currentSettings.reducedMotion) rig.kick(1);
        } else if (event.teamId === playerTeam) {
          audio.playSfx('cannon', 0.3);
          audio.playSfx('rocket', 0.35, ROCKET_SFX);
        } else if (near(event.x, event.z) < 20) {
          audio.playSfx('cannon', 0.2);
          audio.playSfx('rocket', 0.18, ROCKET_SFX);
        }
        break;
      }
      case 'reload':
        if (event.tankId === session.playerTankId) audio.playSfx('reload', 0.55);
        break;
      case 'hit':
        if (event.teamId === playerTeam) audio.playSfx('hit', 1);
        else if (near(event.x, event.z) < 20) audio.playSfx('hit', 0.45);
        break;
      case 'death':
        if (event.teamId === playerTeam) audio.playSfx('death', 1);
        else if (near(event.x, event.z) < 24) audio.playSfx('death', 0.5);
        break;
      case 'wall-break':
        if (session.state.tick - lastBreakTick >= 6) {
          lastBreakTick = session.state.tick;
          audio.playSfx('wall-break', 0.5);
        }
        break;
      case 'regen':
        if (session.state.tick - lastRegenTick >= 30) {
          lastRegenTick = session.state.tick;
          audio.playSfx('regen', 0.3);
        }
        break;
      case 'impact':
        break;
    }
  }

  function updateHud(): void {
    const feed = feedRows.map((row) => ({
      killerTeamId: row.killerTeamId,
      killerLabel: row.killerLabel,
      victimTeamId: row.victimTeamId,
      victimLabel: row.victimLabel,
      cause: row.cause,
    }));
    hud.update({ ...hudState(lastFps), feed, damageFlash });
  }

  function frame(nowMilliseconds: number): void {
    try {
      const nowSeconds = nowMilliseconds / 1000;
      if (lastSeconds === null) {
        lastSeconds = nowSeconds;
        windowStartMilliseconds = nowMilliseconds;
      }
      const frameSeconds = nowSeconds - lastSeconds;
      lastSeconds = nowSeconds;

      if (!paused) {
        session.advance(frameSeconds);
      }

      const alpha = session.alpha;
      const frames = session.interpolatedTanks(alpha);
      const playerFrame = frames.find((candidate) => candidate.id === session.playerTankId);
      if (!playerFrame) {
        throw new Error('main: the interpolated player frame is missing');
      }

      const playerState = session.state.tanks[session.playerTankId];
      const playerHp = playerState?.hp ?? 0;
      if (playerHp < lastPlayerHp) {
        damageFlash = 1;
      }
      lastPlayerHp = playerHp;
      damageFlash = Math.max(
        0,
        damageFlash - Math.min(Math.max(frameSeconds, 0), 0.12) * 2.6,
      );
      for (const notice of killFeed.update(session.state)) {
        feedRows.unshift({
          ...describeKill(notice, session.feedNames),
          tick: notice.tick,
        });
      }
      const feedTick = session.state.tick;
      feedRows = feedRows.filter((row) => feedTick - row.tick <= 420).slice(0, 4);

      if (isTop) {
        scene.setPlayerHidden(true);
        scene.setTanks(frames);
        // A review plan, not a battle frame: marks the arena, not the live targets.
        scene.setTanksHidden(true);
        scene.setShells(session.state.shells);
        scene.syncWorld();
        scene.updateCamera(topCamera.position);
        aimHud.update(null, window.innerWidth, window.innerHeight, PALETTE.debugText);
      } else {
        rig.setFocus({
          position: { x: playerFrame.x, y: session.floorY, z: playerFrame.z },
          yawDegrees: aimFollowYawDegrees(
            playerFrame.hullYawDegrees,
            playerFrame.turretYawDegrees,
          ),
        });
        rig.update(frameSeconds);
        aimCameraState.camera = aimCameraView(rig.camera, cameraDirection);
        scene.setPlayerHidden(rig.firstPerson);
        scene.setTanks(frames);
        scene.setShells(session.state.shells);
        if (pauseOnNextWreck && scene.wreck.debug().spawnCount > 0) {
          // Verification hook: freeze this frame BEFORE the first wreck update so the
          // t=0 breakup pose can be stepped exactly. Never active in normal play.
          pauseOnNextWreck = false;
          paused = true;
        }
        scene.syncWorld();
        scene.updateCamera(rig.camera.position);

        // The reticle is the WORLD point under the pointer, projected from the
        // current camera. It is deliberately solved from the live tank state and the
        // camera, not from an angular offset or the screen centre.
        const currentPlayer = session.state.tanks[session.playerTankId];
        const aimCamera = aimCameraState.camera;
        let aim = null;
        lastAim = null;
        if (playerFrame.alive && currentPlayer?.alive && aimCamera) {
          const input = readInput();
          lastAim = solveAim(
            session.state,
            currentPlayer,
            aimCamera,
            input.pointerX,
            input.pointerY,
          );
          aim = projectAimPoint(
            {
              cameraPosition: aimCamera.position,
              cameraTarget: aimCamera.target,
              cameraUp: aimCamera.up,
              fovDegrees: aimCamera.fovDegrees,
              aspect: aimCamera.aspect,
            },
            lastAim.impactPoint,
          );
        }
        aimHud.update(
          aim
            ? {
                ...aim,
                outOfRange: lastAim?.outOfRange ?? false,
                targetTeamId: lastAim?.targetTeamId ?? null,
              }
            : null,
          window.innerWidth,
          window.innerHeight,
          teamColor(playerFrame.teamId),
        );

        // Recoil is applied AFTER the aim snapshot and HUD projection: the jolt is a
        // presentation shake, not a change to the world point under the pointer.
        if (!currentSettings.reducedMotion) rig.applyRecoil();
        scene.updateCamera(rig.camera.position);
      }

      for (const event of scene.takeEvents()) {
        playEvent(event);
      }
      if (!endAnnounced && session.state.status === 'ended') {
        endAnnounced = true;
        const playerTeam = session.state.tanks[session.playerTankId]?.teamId ?? 0;
        if (session.state.winnerTeamId === playerTeam) audio.playSfx('victory', 0.9);
        else if (session.state.winnerTeamId !== null) audio.playSfx('defeat', 0.9);
      }
      scene.updateEffects(paused || session.frozen ? 0 : frameSeconds);

      renderer.info.reset();
      composer.render();
      drawCalls = renderer.info.render.calls;

      framesInWindow += 1;
      const windowSeconds = (nowMilliseconds - windowStartMilliseconds) / 1000;
      if (windowSeconds >= 1) {
        lastFps = framesInWindow / windowSeconds;
        framesInWindow = 0;
        windowStartMilliseconds = nowMilliseconds;
        updateHud();
        console.log(
          `[tank-battle] ${lastFps.toFixed(1)} fps · ${renderer.domElement.width}×${renderer.domElement.height} · ` +
            `${drawCalls} draw calls · tick ${session.state.tick} · ` +
            `revision ${session.state.world.revision} · detail ${getSurfaceDetail().toFixed(2)} · ` +
            `mode ${launch.mode} · pose ${launch.pose ?? 'follow'}`,
        );
      }
      updateHud();

      if (!Number.isFinite(lastFps)) {
        throw new Error('main: fps became non-finite');
      }
      requestAnimationFrame(frame);
    } catch (cause) {
      reportError(cause);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyL' || event.repeat) {
      return;
    }
    // The documented detail toggle: zero, then back to the configured default.
    setSurfaceDetail(getSurfaceDetail() > 0 ? 0 : SURFACE_DETAIL);
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      rig.zoom(event.deltaY);
    },
    { passive: false },
  );

  const debugApi = {
    fps: () => lastFps,
    drawCalls: () => drawCalls,
    detail: () => getSurfaceDetail(),
    pixels: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
    mode: () => launch.mode,
    ticks: () => session.state.tick,
    pose: () => launch.pose ?? 'follow',
    demo: () => launch.demo,
    revision: () => session.state.world.revision,
    shells: () => session.state.shells.length,
    shotsFired: () => session.state.stats.shotsFired,
    shellView: () => {
      const rockets = scene.shells.rockets;
      const matrix = new Matrix4();
      if (rockets.count > 0) rockets.getMatrixAt(0, matrix);
      return {
        visible: rockets.visible,
        count: rockets.count,
        parentVisible: rockets.parent?.visible ?? false,
        matrix: matrix.elements.slice(),
      };
    },
    shellList: () =>
      session.state.shells.map((shell) => ({
        id: shell.id,
        x: shell.x,
        y: shell.y,
        z: shell.z,
        dx: shell.dx,
        dy: shell.dy,
        dz: shell.dz,
        travelled: shell.travelledMetres,
      })),
    playerHp: () => session.state.tanks[session.playerTankId]?.hp ?? -1,
    dummyHp: () => (launch.mode === 'play' ? (session.state.tanks[1]?.hp ?? -1) : -1),
    squadHp: () => session.state.teams[0]?.tanks.map((tank) => tank.hp) ?? [],
    winnerTeam: () => session.state.winnerTeamId,
    outcome: () => session.state.outcome,
    sceneStats: () => sceneStats,
    wreck: () => scene.wreck.debug(),
    pauseOnNextWreck: () => {
      pauseOnNextWreck = true;
    },
    // Verification hook: pause the live match and advance ONLY the presentation wreck
    // clock, so the four death-sequence frames are reproducible. Not used by gameplay.
    wreckStep: (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error(`wreckStep: seconds must be finite and >= 0, got ${String(seconds)}`);
      }
      paused = true;
      scene.wreck.update(seconds);
      return scene.wreck.debug();
    },
    audio: () => ({
      unlocked: audio.isUnlocked,
      clips: audio.loadedClipCount,
      state: audio.contextState,
      paused,
    }),
    aim: () =>
      lastAim === null
        ? null
        : {
            aimYaw: lastAim.aimYaw,
            aimPitch: lastAim.aimPitch,
            desiredPoint: lastAim.desiredPoint,
            impactPoint: lastAim.impactPoint,
            outOfRange: lastAim.outOfRange,
            clamped: lastAim.clamped,
            targetTankId: lastAim.targetTankId,
            targetTeamId: lastAim.targetTeamId,
            impactKind: lastAim.impactKind,
          },
    cameraYaw: () => rig.yawDegrees,
    camera: () => ({
      x: rig.camera.position.x,
      y: rig.camera.position.y,
      z: rig.camera.position.z,
      yawDegrees: rig.yawDegrees,
      fovDegrees: rig.camera.fov,
      aspect: rig.camera.aspect,
    }),
    pointer: () => {
      const current = readInput();
      return { x: current.pointerX, y: current.pointerY };
    },
    player: () => {
      const tank = session.state.tanks[session.playerTankId];
      return tank === undefined
        ? null
        : {
            x: tank.x,
            z: tank.z,
            hullYawDegrees: tank.hullYawDegrees,
            turretYawDegrees: tank.turretYawDegrees,
            aimPitchDegrees: tank.aimPitchDegrees,
            teamId: tank.teamId,
            hp: tank.hp,
            alive: tank.alive,
          };
    },
    targets: () => {
      const player = session.state.tanks[session.playerTankId];
      const playerTeam = player?.teamId ?? -1;
      return session.state.tanks
        .filter((tank) => tank.alive && tank.teamId !== playerTeam)
        .map((tank) => ({
          id: tank.id,
          teamId: tank.teamId,
          x: tank.x,
          y: session.floorY + 1.1,
          z: tank.z,
        }));
    },
    screenPoint: (x: number, y: number, z: number) => {
      const projected = new Vector3(x, y, z).project(rig.camera);
      return {
        x: (projected.x * 0.5 + 0.5) * window.innerWidth,
        y: (-projected.y * 0.5 + 0.5) * window.innerHeight,
        z: projected.z,
      };
    },
  };
  (window as Window & { __TANK_BATTLE__?: typeof debugApi }).__TANK_BATTLE__ = debugApi;

  resize();
  aimCameraState.camera = aimCameraView(rig.camera, cameraDirection);
  updateHud();
  return frame;
}

function bootGame(launch: LaunchOptions, audio: AudioEngine): (nowMilliseconds: number) => void {
  if (launch.mode === 'spectate') {
    return bootSpectate(launch, audio);
  }
  setSurfaceDetail(launch.detail ?? currentSettings.quality);
  document.body.style.background = PALETTE.background;

  const input = createBrowserInput(canvas);
  const readInput = (): PlayerInput => input.read();
  const aimCameraState: AimCameraState = { camera: null };
  const aimController = new PlayerAimController(readInput, () => aimCameraState.camera);

  // The demo is frozen BEFORE the scene/camera is built, so the screenshot pose sees
  // the final deterministic state, not an intermediate tick.
  if (launch.mode === 'team') {
    const session = launch.demo
      ? new TeamSession({
          seed: launch.seed,
          playerController: createVanguardStandIn(launch.seed),
        })
      : new TeamSession({ seed: launch.seed, playerController: aimController });
    if (launch.demo) {
      session.runTicks(launch.ticks ?? 480);
    }
    return bootMatch(
      launch,
      session,
      (fps) => teamHudState(session, fps),
      audio,
      readInput,
      aimCameraState,
    );
  }

  const session = new PlayableSession({ demo: launch.demo });
  if (launch.demo) {
    session.runDemo(launch.ticks ?? 571);
  }
  return bootMatch(
    launch,
    playableMatchView(session, (state, player) => aimController.commandFor(state, player.id)),
    (fps) => playHudState(session, fps),
    audio,
    readInput,
    aimCameraState,
  );
}

/** Measured from the render geometry constants: hull width / 2. */
const TANK_HALF_WIDTH_METRES = TANK.hullWidthMetres / 2;

try {
  const launch = readLaunchOptions();
  currentSettings = loadSettings();
  audioEngine = new AudioEngine({
    onError: reportError,
    volumes: {
      master: currentSettings.master,
      music: currentSettings.music,
      sfx: currentSettings.sfx,
    },
  });
  screensUi = createScreens(currentSettings, {
    onPlay: () => startGame('play'),
    onTeam: () => startGame('team'),
    onSpectate: () => startGame('spectate'),
    onResume: resumeMatch,
    onQuit: () => window.location.assign('?mode=title'),
    onGesture: () => {
      ensureAudio('menu');
      audioEngine?.playSfx('ui-click', 0.7);
    },
    onSettingsChange: (next) => applySettings(next),
    onSettingsOpened: (origin) => {
      if (origin === 'pause') audioEngine?.setDucked(true);
    },
    onSettingsClosed: (origin) => {
      if (origin === 'title') audioEngine?.setDucked(false);
    },
  });
  applySettings(currentSettings);

  if (launch.mode === 'title') {
    gameStarted = false;
    document.body.classList.add('title-mode');
    const titleCanvas = requireElement('title-canvas', HTMLCanvasElement, 'title background canvas');
    try {
      titleBackground = createTitleBackground({
        canvas: titleCanvas,
        seed: launch.seed,
        onError: reportError,
      });
      titleBackground.start();
    } catch (error) {
      reportError(error);
    }
    (window as Window & { __TITLE_BATTLE__?: Record<string, () => number | boolean> }).__TITLE_BATTLE__ = {
      disposed: () => titleBackground === null || titleBackground.disposed,
      fps: () => titleBackground?.fps ?? 0,
      drawCalls: () => titleBackground?.drawCalls ?? 0,
      ticks: () => titleBackground?.ticks ?? 0,
      seed: () => titleBackground?.seed ?? -1,
    };
    titleGate = new TitleAudioGate();
    const onPointer = (): void => {
      const track = titleGate?.pointerDown() ?? null;
      if (track) ensureAudio(track);
    };
    const onKey = (): void => {
      const track = titleGate?.keyDown() ?? null;
      if (track) ensureAudio(track);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    titleGestureCleanup = () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
    screensUi.showTitle();
    if (launch.settings) screensUi.showSettings('title');
  } else {
    screensUi.hideAll();
    gameStarted = true;
    const audio = audioEngine;
    const frame = bootGame(launch, audio);
    requestAnimationFrame(frame);
    const unlock = (): void => {
      ensureAudio('combat');
    };
    canvas.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape' || !gameStarted) return;
    if (screensUi?.isSettingsOpen()) return;
    if (paused) resumeMatch();
    else pauseMatch();
  });
} catch (cause) {
  reportError(cause);
}
