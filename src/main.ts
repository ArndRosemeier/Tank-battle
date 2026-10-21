import { Vector2 } from 'three';
import { WebGLRenderer, Scene, Color, Fog, ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FixedStep } from './core/timestep.ts';
import { requireElement } from './entry/dom.ts';
import { CameraRig } from './render/cameraRig.ts';
import { isCameraPoseName, type CameraPoseName } from './render/cameraMath.ts';
import {
  BLOOM,
  DPR_CAP,
  FOG,
  PALETTE,
  POST,
  SURFACE_DETAIL,
} from './render/config.ts';
import { getSurfaceDetail, setSurfaceDetail } from './render/neonSurface.ts';
import { buildArenaScene } from './render/sceneAssembly.ts';

/**
 * Slice A2's wiring: the three.js renderer, the post pipeline, the real A1 world, the
 * placeholder tanks and the fixed-step loop. It deliberately holds NO gameplay —
 * drive/aim/fire is A3 (`docs/DESIGN.md` §8). The one animation is the turret sweep,
 * so the loop's honesty (a fixed step feeding the renderer) is visible.
 *
 * Seams this file must keep:
 *  - `reportError` is still the app's ONE visible failure surface;
 *  - `FixedStep.advance` is still the ONE frame-delta-to-steps conversion;
 *  - every colour/bloom/camera number comes from `src/render/config.ts`;
 *  - `requestAnimationFrame` still appears here and nowhere else.
 */

const canvas = requireElement('app', HTMLCanvasElement, 'canvas');
const errorBox = requireElement('error', HTMLElement, 'error surface');
const debugBox = requireElement('debug', HTMLElement, 'debug readout');

/** The app's ONE error surface: a visible banner plus the console. */
function reportError(cause: unknown): void {
  const text = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  errorBox.textContent = text;
  errorBox.style.display = 'block';
  errorBox.style.background = PALETTE.error;
  console.error(cause);
}

window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

interface LaunchOptions {
  /** `null` leaves `SURFACE_DETAIL` at its configured default. */
  readonly detail: number | null;
  /** A frozen screenshot pose, or `null` for the follow arm. */
  readonly pose: CameraPoseName | null;
}

/**
 * `?detail=0…1&pose=wide|tank|first` — validated loudly: an unknown pose or a
 * malformed detail must fail visibly, never silently fall back to the default.
 */
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
  let pose: CameraPoseName | null = null;
  if (poseText !== null) {
    if (!isCameraPoseName(poseText)) {
      throw new Error(`launch: unknown ?pose "${poseText}" — expected wide, tank or first`);
    }
    pose = poseText;
  }

  return { detail, pose };
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

/** Boots the renderer and returns the frame function for the one rAF chain. */
function boot(): (nowMilliseconds: number) => void {
  const launch = readLaunchOptions();
  if (launch.detail !== null) {
    setSurfaceDetail(launch.detail);
  }

  document.body.style.background = PALETTE.background;

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
  // We read the TOTAL draw calls of a composed frame, not just the last pass's.
  renderer.info.autoReset = false;

  const scene = new Scene();
  scene.background = new Color(PALETTE.background);
  // D4's horizon falloff. Standard materials take the fog from the scene; the two
  // custom ShaderMaterials (grid floor, rim) carry the same range in their uniforms.
  scene.fog = new Fog(PALETTE.background, FOG.nearMetres, FOG.farMetres);

  // The ONE scene assembly: the same call the budget pin measures in node.
  const arena = buildArenaScene();
  scene.add(arena.group);
  const { showcase, worldMesh, tanks, focusTank, stats } = arena;

  const focusSpawn = showcase.spawns[showcase.focusSpawnIndex];
  if (!focusSpawn) {
    throw new Error(`main: focus spawn ${showcase.focusSpawnIndex} is missing`);
  }
  console.log(
    `[tank-battle] scene: ${stats.drawObjects} draw objects · ${stats.triangles} triangles · ` +
      `${stats.vertices} vertices · budget pinned in sceneBudget.test.ts`,
  );

  const rig = new CameraRig({
    arena: showcase.bounds,
    floorY: showcase.world.floorSurfaceHeightMetres,
    focus: {
      position: { x: focusSpawn.xMetres, y: focusSpawn.yMetres, z: focusSpawn.zMetres },
      yawDegrees: focusSpawn.yawDegrees,
    },
    pose: launch.pose,
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, rig.camera));

  const bloomPass = new UnrealBloomPass(
    new Vector2(1, 1),
    BLOOM.strength,
    BLOOM.radius,
    BLOOM.threshold,
  );
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass(VIGNETTE_SHADER));
  composer.addPass(new OutputPass());

  const sim = { elapsed: 0, ticks: 0 };
  const fixed = new FixedStep();

  let lastFps = 0;
  let framesInWindow = 0;
  let windowStartMilliseconds = 0;
  let readoutDirty = true;

  function resize(): void {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    rig.resize(width / height);

    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    // The bloom is the quality knob: it may render at a lower internal resolution,
    // never at a different world resolution (§9's performance budget).
    bloomPass.setSize(
      Math.max(1, Math.floor(width * pixelRatio * BLOOM.resolutionScale)),
      Math.max(1, Math.floor(height * pixelRatio * BLOOM.resolutionScale)),
    );
    readoutDirty = true;
  }

  function updateReadout(): void {
    const pixelWidth = renderer.domElement.width;
    const pixelHeight = renderer.domElement.height;
    debugBox.textContent =
      `${pixelWidth}×${pixelHeight} · ${lastFps.toFixed(0)} fps · ` +
      `detail ${getSurfaceDetail().toFixed(2)} · ${renderer.info.render.calls} calls · ` +
      `${stats.drawObjects} obj · ${Math.round(stats.triangles)} tri · ` +
      `pose ${launch.pose ?? 'follow'} · L detail`;
    debugBox.style.color = PALETTE.debugText;
  }

  function step(stepSeconds: number): void {
    sim.elapsed += stepSeconds;
    sim.ticks += 1;
  }

  let lastSeconds: number | null = null;

  function frame(nowMilliseconds: number): void {
    try {
      const nowSeconds = nowMilliseconds / 1000;
      if (lastSeconds === null) {
        lastSeconds = nowSeconds;
        windowStartMilliseconds = nowMilliseconds;
      }
      const frameSeconds = nowSeconds - lastSeconds;
      lastSeconds = nowSeconds;

      fixed.advance(frameSeconds, step);

      for (const tank of tanks) {
        tank.sweep(sim.elapsed);
      }

      rig.update(frameSeconds);
      focusTank.group.visible = !rig.firstPerson;
      worldMesh.update(rig.camera.position);

      renderer.info.reset();
      composer.render();

      framesInWindow += 1;
      const windowSeconds = (nowMilliseconds - windowStartMilliseconds) / 1000;
      if (windowSeconds >= 1) {
        lastFps = framesInWindow / windowSeconds;
        framesInWindow = 0;
        windowStartMilliseconds = nowMilliseconds;
        console.log(
          `[tank-battle] ${lastFps.toFixed(1)} fps · ${renderer.domElement.width}×${renderer.domElement.height} · ` +
            `${renderer.info.render.calls} draw calls · ${stats.drawObjects} draw objects · ` +
            `${stats.triangles} triangles · ${stats.vertices} vertices · ` +
            `detail ${getSurfaceDetail().toFixed(2)} · pose ${launch.pose ?? 'follow'} · tick ${sim.ticks}`,
        );
        readoutDirty = true;
      }
      if (readoutDirty) {
        updateReadout();
        readoutDirty = false;
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
    // The documented toggle: zero, then back to the configured default.
    setSurfaceDetail(getSurfaceDetail() > 0 ? 0 : SURFACE_DETAIL);
    readoutDirty = true;
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      rig.zoom(event.deltaY);
      readoutDirty = true;
    },
    { passive: false },
  );

  // Exposed for the measurement harness only (fps + draw calls). It is not gameplay
  // state and nothing in the app reads it back.
  const debugApi = {
    fps: () => lastFps,
    drawCalls: () => renderer.info.render.calls,
    detail: () => getSurfaceDetail(),
    pixels: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
    ticks: () => sim.ticks,
    pose: () => launch.pose ?? 'follow',
    sceneStats: () => stats,
  };
  (window as Window & { __TANK_BATTLE__?: typeof debugApi }).__TANK_BATTLE__ = debugApi;

  resize();
  updateReadout();
  debugBox.style.display = 'block';

  return frame;
}

try {
  const frame = boot();
  requestAnimationFrame(frame);
} catch (cause) {
  reportError(cause);
}
