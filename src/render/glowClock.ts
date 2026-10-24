/**
 * The ONE presentation clock the glow shaders share (G1). Every shader that pulses
 * puts THESE uniform objects in its `uniforms`, so one `advanceGlowClock` per frame
 * moves all of them; a material rebuilt after a world revision picks up the same
 * objects and never restarts its pulse.
 *
 * Presentation only: the simulation never reads it, and a paused or frozen frame
 * passes `dt = 0` so the pulse holds still. Reduced motion sets the pulse to 0.
 */

export interface GlowUniforms {
  readonly uGlowTime: { value: number };
  /** 1 = pulses on, 0 = reduced motion (static lines). */
  readonly uGlowPulse: { value: number };
}

export const GLOW_UNIFORMS: GlowUniforms = {
  uGlowTime: { value: 0 },
  uGlowPulse: { value: 1 },
};

export function advanceGlowClock(dtSeconds: number): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new Error(`glowClock: dt must be finite and >= 0, got ${String(dtSeconds)}`);
  }
  // Wrapped so float precision in the shaders never degrades over a long session.
  GLOW_UNIFORMS.uGlowTime.value = (GLOW_UNIFORMS.uGlowTime.value + dtSeconds) % 3600;
}

export function setGlowPulseEnabled(enabled: boolean): void {
  GLOW_UNIFORMS.uGlowPulse.value = enabled ? 1 : 0;
}
