/** Shared Three.js renderer and post-processing bootstrap across all game modes. */
import { Color, Fog, Scene, WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace, Vector2, type Camera } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM, FOG, PALETTE, POST } from './config.ts';

export interface RenderStack {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;
  readonly renderPass: RenderPass;
  dispose(): void;
}
export function createRenderStack(canvas: HTMLCanvasElement, camera: Camera, options: {
  readonly exposureScale?: number;
  readonly bloomScale?: number;
  readonly vignetteShader?: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string };
} = {}): RenderStack {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.setClearColor(new Color(PALETTE.background), 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = POST.exposure * (options.exposureScale ?? 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.info.autoReset = false;
  const scene = new Scene();
  scene.background = new Color(PALETTE.background);
  scene.fog = new Fog(PALETTE.background, FOG.nearMetres, FOG.farMetres);
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloomPass = new UnrealBloomPass(new Vector2(1, 1), BLOOM.strength * (options.bloomScale ?? 1), BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloomPass);
  if (options.vignetteShader) composer.addPass(new ShaderPass(options.vignetteShader));
  composer.addPass(new OutputPass());
  let disposed = false;
  return { renderer, scene, composer, bloomPass, renderPass, dispose() {
    if (disposed) return;
    disposed = true;
    composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  } };
}
