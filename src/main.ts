import { FixedStep } from './core/timestep.ts';
import { requireContext2d, requireElement } from './entry/dom.ts';

/**
 * Day-1 skeleton: mounts the canvas, owns the frame loop, and proves the fixed
 * timestep runs. It deliberately holds NO gameplay — the game's direction is the
 * owner's decision, and a placeholder battle here would pre-empt it.
 *
 * The loop is the seam everything later hangs off: input, simulation and rendering
 * all join it here, so keep it small and keep it in one place.
 */

const canvas = requireElement('app', HTMLCanvasElement, 'canvas');
const context = requireContext2d(canvas);
const errorBox = requireElement('error', HTMLElement, 'error surface');

/** The app's ONE error surface: a visible banner plus the console. */
function reportError(cause: unknown): void {
  const text = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  errorBox.textContent = text;
  errorBox.style.display = 'block';
  console.error(cause);
}

window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

const sim = { elapsed: 0, ticks: 0 };

let cssWidth = 0;
let cssHeight = 0;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssWidth = Math.max(window.innerWidth, 1);
  cssHeight = Math.max(window.innerHeight, 1);
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function step(stepSeconds: number): void {
  sim.elapsed += stepSeconds;
  sim.ticks += 1;
}

function draw(): void {
  context.fillStyle = '#0d1117';
  context.fillRect(0, 0, cssWidth, cssHeight);

  const cell = 48;
  context.strokeStyle = 'rgba(110, 130, 160, 0.18)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= cssWidth; x += cell) {
    context.moveTo(Math.floor(x) + 0.5, 0);
    context.lineTo(Math.floor(x) + 0.5, cssHeight);
  }
  for (let y = 0; y <= cssHeight; y += cell) {
    context.moveTo(0, Math.floor(y) + 0.5);
    context.lineTo(cssWidth, Math.floor(y) + 0.5);
  }
  context.stroke();

  const pulse = 0.5 + 0.5 * Math.sin(sim.elapsed * 1.6);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = `rgba(230, 237, 243, ${(0.55 + 0.45 * pulse).toFixed(3)})`;
  context.font = '600 40px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillText('TANK BATTLE', cssWidth / 2, cssHeight / 2 - 12);

  context.fillStyle = 'rgba(148, 163, 184, 0.75)';
  context.font = '400 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillText('day-1 skeleton — no gameplay yet', cssWidth / 2, cssHeight / 2 + 30);
}

const fixed = new FixedStep();
let lastSeconds: number | null = null;

function frame(nowMilliseconds: number): void {
  try {
    const nowSeconds = nowMilliseconds / 1000;
    if (lastSeconds === null) {
      lastSeconds = nowSeconds;
    }
    const frameSeconds = nowSeconds - lastSeconds;
    lastSeconds = nowSeconds;

    fixed.advance(frameSeconds, step);
    draw();
    requestAnimationFrame(frame);
  } catch (cause) {
    reportError(cause);
  }
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
