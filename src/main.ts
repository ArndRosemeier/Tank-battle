import { Vector2 } from 'three';
import {
  WebGLRenderer,
  Scene,
  Color,
  Fog,
  OrthographicCamera,
  ACESFilmicToneMapping,
  SRGBColorSpace,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { requireElement } from './entry/dom.ts';
import { createHud } from './entry/hud.ts';
import { CameraRig } from './render/cameraRig.ts';
import { isCameraPoseName, type CameraPoseName } from './render/cameraMath.ts';
import {
  BLOOM,
  DPR_CAP,
  FOG,
  PALETTE,
  POST,
  SURFACE_DETAIL,
  TANK,
} from './render/config.ts';
import { getSurfaceDetail, setSurfaceDetail } from './render/neonSurface.ts';
import { createPlayableScene } from './render/playableScene.ts';
import { createTopPlan, spawnMarkerColor, TOP_LEGEND_COLORS } from './render/topPlan.ts';
import { measureScene } from './render/sceneStats.ts';
import { createBrowserInput } from './game/browserInput.ts';
import { RELOAD_TICKS } from './core/sim.ts';
import { ARENA, ARENA_BOUNDS } from './game/levels/arena.ts';
import { PlayableSession } from './game/session.ts';

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

type RenderPoseName = CameraPoseName | 'top';

interface LaunchOptions {
  readonly detail: number | null;
  readonly pose: RenderPoseName | null;
  readonly demo: boolean;
  readonly ticks: number;
}

/** `?detail=0…1&pose=…&demo=duel&ticks=122`. Unknown values fail visibly. */
function readLaunchOptions(): LaunchOptions {
  const query = new URLSearchParams(window.location.search);

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
    if (poseText === 'top') {
      pose = 'top';
    } else if (isCameraPoseName(poseText)) {
      pose = poseText;
    } else {
      throw new Error(
        `launch: unknown ?pose "${poseText}" — expected wide, tank, first, combat or top`,
      );
    }
  }

  const demoText = query.get('demo');
  const demo = demoText !== null;
  if (demo && demoText !== 'duel') {
    throw new Error(`launch: unknown ?demo "${demoText}" — expected duel`);
  }

  const ticksText = query.get('ticks');
  let ticks = 122;
  if (ticksText !== null) {
    ticks = Number(ticksText);
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 10000) {
      throw new Error(`launch: ?ticks must be an integer within 0…10000, got "${ticksText}"`);
    }
    if (!demo) {
      throw new Error('launch: ?ticks is only valid with ?demo=duel');
    }
  }

  return { detail, pose, demo, ticks };
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

function boot(): (nowMilliseconds: number) => void {
  const launch = readLaunchOptions();
  if (launch.detail !== null) {
    setSurfaceDetail(launch.detail);
  }
  document.body.style.background = PALETTE.background;

  // The demo is frozen BEFORE the scene/camera is built, so the screenshot pose sees
  // the final deterministic state, not an intermediate tick.
  const session = new PlayableSession({ demo: launch.demo });
  if (launch.demo) {
    session.runDemo(launch.ticks);
  }

  const scene = createPlayableScene(session.state, {
    playerTankId: session.playerTankId,
    dummyTankId: session.dummyTankId,
  });
  const initialPlayer = session.player;
  const sceneStats = measureScene(scene.group);
  console.log(
    `[tank-battle] playable scene: ${sceneStats.drawObjects} draw objects · ` +
      `${sceneStats.triangles} triangles · ${sceneStats.vertices} vertices · ` +
      `hull half-width ${TANK_HALF_WIDTH_METRES.toFixed(2)} m`,
  );

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(new Color(PALETTE.background), 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = POST.exposure;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.info.autoReset = false;

  const threeScene = new Scene();
  threeScene.background = new Color(PALETTE.background);
  threeScene.fog = new Fog(PALETTE.background, FOG.nearMetres, FOG.farMetres);
  threeScene.add(scene.group);

  const isTop = launch.pose === 'top';
  const topPlan = createTopPlan(ARENA);
  topPlan.setVisible(isTop);
  threeScene.add(topPlan.group);

  const rig = new CameraRig({
    arena: ARENA_BOUNDS,
    floorY: session.floorY,
    focus: {
      position: { x: initialPlayer.x, y: session.floorY, z: initialPlayer.z },
      yawDegrees: initialPlayer.hullYawDegrees,
    },
    pose: isTop ? null : launch.pose,
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

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(threeScene, isTop ? topCamera : rig.camera);
  composer.addPass(renderPass);
  const bloomPass = new UnrealBloomPass(
    new Vector2(1, 1),
    BLOOM.strength,
    BLOOM.radius,
    BLOOM.threshold,
  );
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass(VIGNETTE_SHADER));
  composer.addPass(new OutputPass());

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
  const input = createBrowserInput(canvas);

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

  function updateHud(): void {
    const player = session.state.tanks[session.playerTankId];
    const dummy = session.state.tanks[session.dummyTankId];
    if (!player || !dummy) {
      throw new Error('main: the playable session lost a tank');
    }
    hud.update({
      status: session.state.status,
      outcome: session.state.outcome,
      winnerTeamId: session.state.winnerTeamId,
      playerTeamId: player.teamId,
      targetTeamId: dummy.teamId,
      playerHp: player.hp,
      playerMaxHp: player.maxHp,
      targetHp: dummy.hp,
      targetMaxHp: dummy.maxHp,
      reloadTicksRemaining: player.reloadTicksRemaining,
      reloadTicks: RELOAD_TICKS,
      fps: lastFps,
    });
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

      if (!session.demo) {
        session.advance(frameSeconds, input.read());
      }

      const alpha = session.demo ? 1 : session.alpha;
      const frames = session.interpolatedTanks(alpha);
      const playerFrame = frames.find((frame) => frame.id === session.playerTankId);
      if (!playerFrame) {
        throw new Error('main: the interpolated player frame is missing');
      }

      if (isTop) {
        scene.setPlayerHidden(true);
        scene.setTanks(frames);
        // A review plan, not a battle frame: marks the arena, not the live targets.
        scene.setTanksHidden(true);
        scene.setShells(session.state.shells);
        scene.syncWorld();
        scene.updateCamera(topCamera.position);
      } else {
        rig.setFocus({
          position: { x: playerFrame.x, y: session.floorY, z: playerFrame.z },
          yawDegrees: playerFrame.hullYawDegrees,
        });
        rig.update(frameSeconds);
        scene.setPlayerHidden(rig.firstPerson);
        scene.setTanks(frames);
        scene.setShells(session.state.shells);
        scene.syncWorld();
        scene.updateCamera(rig.camera.position);
      }

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
            `pose ${launch.pose ?? 'follow'}`,
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
    ticks: () => session.state.tick,
    pose: () => launch.pose ?? 'follow',
    demo: () => session.demo,
    revision: () => session.state.world.revision,
    shells: () => session.state.shells.length,
    playerHp: () => session.state.tanks[session.playerTankId]?.hp ?? -1,
    dummyHp: () => session.state.tanks[session.dummyTankId]?.hp ?? -1,
    sceneStats: () => sceneStats,
  };
  (window as Window & { __TANK_BATTLE__?: typeof debugApi }).__TANK_BATTLE__ = debugApi;

  resize();
  updateHud();
  return frame;
}

/** Measured from the render geometry constants: hull width / 2. */
const TANK_HALF_WIDTH_METRES = TANK.hullWidthMetres / 2;

try {
  const frame = boot();
  requestAnimationFrame(frame);
} catch (cause) {
  reportError(cause);
}
