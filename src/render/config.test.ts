import { describe, expect, it } from 'vitest';
import {
  PALETTE,
  SURFACE_LUMA_BAND,
  rec709Luminance,
  srgbLuma,
  teamEdgeGainFor,
} from './config.ts';

/**
 * D5's equality rule and §9's surface band, pinned as DATA rather than judged from a
 * screenshot. The team hexes are the owner's; only the HDR gain is normalised.
 */
describe('render palette', () => {
  it('the four team hues render at equal Rec.709 luminance within ±10 %', () => {
    const renderLumas = PALETTE.team.map(
      (hex, index) => rec709Luminance(hex) * teamEdgeGainFor(index),
    );
    const darkest = Math.min(...renderLumas);
    const brightest = Math.max(...renderLumas);
    expect(darkest).toBeGreaterThan(0);
    expect(brightest / darkest).toBeLessThanOrEqual(1.1);

    // Each one is also inside ±10 % of the mean, which is the brief's actual band.
    const mean = renderLumas.reduce((sum, luma) => sum + luma, 0) / renderLumas.length;
    for (const luma of renderLumas) {
      expect(Math.abs(luma - mean) / mean).toBeLessThanOrEqual(0.1);
    }

    // Four distinct identities remain (normalisation must not collapse the hues).
    expect(new Set(PALETTE.team).size).toBe(4);
  });

  it('surface albedos sit inside §9’s 2–10 % sRGB-luminance band', () => {
    for (const hex of [PALETTE.surfaceFill, PALETTE.surfaceFillTop, PALETTE.gridSurface]) {
      const luma = srgbLuma(hex);
      expect(luma).toBeGreaterThanOrEqual(SURFACE_LUMA_BAND.min);
      expect(luma).toBeLessThanOrEqual(SURFACE_LUMA_BAND.max);
    }
    // A hole is the exception on purpose: it must be void-black.
    expect(srgbLuma(PALETTE.void)).toBe(0);
  });
});
