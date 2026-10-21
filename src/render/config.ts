/**
 * The ONE render tuning module.
 *
 * Every colour, bloom number, camera distance, grid size and post number lives here,
 * and NOTHING under `src/render/` (or anywhere else) hardcodes one. A source-scanning
 * pin in `src/render/purity.test.ts` fails the suite on a hex colour outside this
 * file, so the palette cannot fork the way an unowned render config does.
 *
 * The values express the presentation contract in `docs/DESIGN.md` §9: a near-black
 * field, four emissive team identities, an ice-white for the hottest cores, lines
 * that dominate the surfaces, and a bloom that is part of the budget rather than a
 * coat of paint. The colour budget is a contract, not a mood: surfaces sit in the
 * 2–10 % luminance band, neon lines run bright, and the fresnel rim keeps dark
 * silhouettes readable against the void.
 *
 * `docs/DESIGN.md` §7 makes these vetoable defaults. Tuning happens HERE, once.
 */

/** The arena palette: black field, emissive hues, nothing in between. */
export const PALETTE = {
  /** The void behind and beneath everything. */
  background: '#010306',
  /** The hottest cores only — hole rims, pillar highlights, never a fill. */
  iceWhite: '#eaffff',
  /** Four team identities, in team order: cyan, orange, magenta, lime. */
  team: ['#00e5ff', '#ff7a00', '#ff2fd6', '#b6ff00'] as const,
  /**
   * The unlit fill every `NeonSurface` starts from. It is deliberately IN §9's
   * 2–10 % linear-luminance band (2.07 % here), because the A2b verdict was that
   * wall volumes read flat: below the band, a side face is a silhouette, not a box.
   */
  surfaceFill: '#0c1011',
  /** The fill's top edge of the vertical gradient: still inside the band (8.4 %). */
  surfaceFillTop: '#121819',
  /** The floor's surface tint; the grid lines are drawn on top by a shader. */
  gridSurface: '#0c1112',
  /** A hole is a black void, not a floor tint — it must read darker than the grid. */
  void: '#000000',
  /** The luminous floor grid: minor cell lines, then every fifth cell. */
  gridMinor: '#0b6f8a',
  gridMajor: '#2ae4ff',
  /** Structural trim. Walls and pillars carry their identity in these edge colours. */
  wallEdge: '#18c4ff',
  pillarEdge: '#8eeeff',
  /** A destroyed floor cell's rim; the hole itself is missing floor, not a fill. */
  holeRim: '#eaffff',
  /** The vertical corner accent on perimeter architecture (and tall pillars). */
  verticalEdge: '#45d8ef',
  /** Faint horizontal panel seams on wall volumes. */
  panelSeam: '#2b8aa3',
  /** Gateway arch trim: architecture, not team identity. */
  gatewayEdge: '#40cfe8',
  /** The rim is NEUTRAL on purpose: hue lives in the lines and small lights only. */
  rimTint: '#8d9a9c',
  /** Debug readout — legible, on-palette, and not an interface control. */
  debugText: '#8ff4ff',
  /** The one error surface. Still the palette's home, so no other file names a colour. */
  error: '#ff2f4a',
} as const;

/**
 * HDR gains applied when an edge colour becomes a vertex-colour attribute. The scene
 * renders into a half-float composer target, so values above 1 are legal and are what
 * makes UnrealBloom bloom instead of merely brighten. Team identity is the hue; the
 * gain is the brightness of the line, and bloom pushes the cores towards white.
 */
export const NEON = {
  structureEdgeGain: 1.25,
  teamEdgeGain: 1.8,
  coreGain: 1.9,
  /** Hole rims are deliberately the hottest structural line: a mechanic must read. */
  holeRimGain: 2.2,
  holeRimInnerGain: 1.0,
  verticalEdgeGain: 1.3,
  panelSeamGain: 0.45,
  gatewayEdgeGain: 0.9,
  gridMinorGain: 0.65,
  gridMajorGain: 1.35,
} as const;

/**
 * Team edge luminance normalisation (D5). The four owner hues are not equal in
 * Rec.709 luminance — lime is the brightest and magenta the darkest — so a raw
 * colour would visually advantage a team. The hue stays exactly as configured; only
 * the HDR gain is normalised, and the pin in `src/render/config.test.ts` holds all
 * four rendered edges inside ±10 % of the same luma.
 */
export const TEAM_LUMA_TARGET = 0.4;

/**
 * §9's surface band as the A2c look-budget measures it: ITU-R 601 luma of the
 * sRGB hex, 0…1 of white. This is NOT the linear-light Rec.709 measure used for
 * team luma; the dispatcher's table (15.7 % wall, 31.7 % lime) is this measure.
 */
export const SURFACE_LUMA_BAND = { min: 0.02, max: 0.1 } as const;

/** sRGB channel → linear. Kept local so the config never needs three.js. */
function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Rec.709 relative luminance of a hex colour, in linear light (D5 team luma). */
export function rec709Luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    throw new Error(`config: rec709Luminance expects a six-digit hex colour, got "${hex}"`);
  }
  const value = Number.parseInt(match[1]!, 16);
  const red = srgbToLinear(((value >> 16) & 0xff) / 255);
  const green = srgbToLinear(((value >> 8) & 0xff) / 255);
  const blue = srgbToLinear((value & 0xff) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** ITU-R 601 luma of an sRGB hex, 0…1 of white — the A2c look-budget's L. */
export function srgbLuma(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    throw new Error(`config: srgbLuma expects a six-digit hex colour, got "${hex}"`);
  }
  const value = Number.parseInt(match[1]!, 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

/**
 * A small render correction inside D5's ±10 % allowance. ACES tone mapping and the
 * clipping of the saturated orange/magenta HDR edges lift lime's green relative to
 * the others, so a 9 % lime reduction keeps the MEASURED trim within A2c's ±25 %
 * band while the linear Rec.709 check stays inside its own ±10 % tolerance.
 */
export const TEAM_RENDER_CORRECTION: readonly number[] = [1, 1, 1, 0.91] as const;

/** One gain per team that pulls its raw hue to `TEAM_LUMA_TARGET` (within rounding). */
export const TEAM_LUMA_GAIN: readonly number[] = PALETTE.team.map(
  (hex, index) =>
    (TEAM_LUMA_TARGET / rec709Luminance(hex)) * (TEAM_RENDER_CORRECTION[index] ?? 1),
);

/** The HDR gain a team's edge/rim identity receives: base gain × its luma correction. */
export function teamEdgeGainFor(index: number): number {
  const correction = TEAM_LUMA_GAIN[index];
  if (correction === undefined) {
    throw new Error(`config: team index ${index} is outside the team palette`);
  }
  return NEON.teamEdgeGain * correction;
}

/**
 * UnrealBloom, tuned once. Threshold is in tone-mapped linear luminance: the dark
 * fills (2–10 %) sit far below it, so only the edges bloom. `resolutionScale` is the
 * quality knob the performance budget is allowed to move — never correctness.
 */
export const BLOOM = {
  threshold: 0.6,
  strength: 0.62,
  radius: 0.4,
  resolutionScale: 1,
} as const;

/** The post pipeline's global look. ACES and a vignette are §9 requirements. */
export const POST = {
  exposure: 0.95,
  vignetteStrength: 0.34,
  vignetteRadius: 0.82,
} as const;

/**
 * The global surface-detail scalar's default (0…1). The RUNNING value lives in
 * `neonSurface.ts` and is changed by `setSurfaceDetail`; this is the documented
 * starting point the L key toggles back to. It scales the fresnel rim and the
 * (unused-this-slice) detail map, never the edges.
 */
export const SURFACE_DETAIL = 0.3;

/** Detail-map budget (§9: tileable greyscale, multiplied at ≤ 15 %). Unused in A2. */
export const DETAIL_MAP_MAX_STRENGTH = 0.15;

/** The rim's opacity at `SURFACE_DETAIL = 1`; the running value is scaled by detail. */
export const RIM_OPACITY_AT_FULL_DETAIL = 0.75;

/** The fresnel exponent: higher is a tighter rim, lower wraps further around. */
export const RIM_FRESNEL_POWER = 4.2;

/** A broader sheen on vertical faces, so a wall side reads as a volume (D2). */
export const RIM_WALL_SHEEN = 0.45;
/** The vertical sheen's own exponent: lower than the rim's, so it spreads inward. */
export const RIM_WALL_SHEEN_POWER = 2.0;
/** A faint additive band on upward-facing surfaces (wall tops, hull decks). */
export const RIM_TOP_BAND = 0.04;

/**
 * Procedural horizontal panel seams on vertical faces, scaled by `SURFACE_DETAIL`.
 * Low frequency, no texture; the default state should add richness, and zero should
 * leave only the edge lines and the albedo.
 */
export const SURFACE_SEAMS = {
  spacingMetres: 1.8,
  offsetMetres: 0.45,
  halfWidthMetres: 0.012,
  strength: 0.9,
} as const;

/** A hole's rim is a band: the boundary plus an inner loop offset into the void. */
export const HOLE_RIM = {
  insetMetres: 0.16,
} as const;

/** Linear distance fog: the arena fades into the void instead of floating (D4). */
export const FOG = {
  nearMetres: 30,
  farMetres: 100,
} as const;

/** Device-pixel-ratio cap. A 2× retina display renders 4× the pixels; 2 is the cap. */
export const DPR_CAP = 2;

/** The floor grid's cell size and the interval of its brighter major lines. */
export const GRID = {
  /** One cell is 2 m square — the same unit the world model uses. */
  cellMetres: 2,
  /** Every fifth cell line is a major line. */
  majorEvery: 5,
  /**
   * Distance falloff is TWO ranges: the fine cell lines fade early (they are detail
   * for the near floor), while the major lanes carry the arena's shape to the far
   * edge. A single range made the wide shot a wash of fine lines.
   */
  minorFadeStartMetres: 10,
  minorFadeEndMetres: 58,
  majorFadeStartMetres: 30,
  majorFadeEndMetres: 140,
} as const;

/**
 * Camera numbers. The default follow is the documented third-person arm: ~8 m back
 * and ~3.5 m up from a turret-height focus, which this pitch/distance/focus height
 * produces exactly (8.2·cos 14° ≈ 7.96 back, 1.55 + 8.2·sin 14° ≈ 3.53 up).
 *
 * First person is entered CONTINUOUSLY as the wheel brings the arm inside
 * `firstPersonDistanceMetres`; from there the hull is hidden and the camera looks
 * ahead instead of at its own focus point.
 */
export const CAMERA = {
  fovDegrees: 50,
  nearMetres: 0.1,
  farMetres: 400,
  /** The focus point the arm orbits: turret/eye height above the hull's base. */
  focusHeightMetres: 1.55,
  defaultDistanceMetres: 8.2,
  defaultPitchDegrees: 14,
  /** The `tank` screenshot pose is an over-the-shoulder 3/4 view, not straight behind. */
  tankPoseYawOffsetDegrees: 22,
  /** One wheel notch is `exp(zoomSensitivity × deltaY)` of arm length. */
  zoomSensitivity: 0.0016,
  minDistanceMetres: 0.55,
  maxDistanceMetres: 16,
  /** Inside this arm length the camera is first person and the hull is hidden. */
  firstPersonDistanceMetres: 2,
  /** How far ahead the first-person camera looks as the arm collapses (in metres). */
  firstPersonLookAheadMetres: 8,
  /** The fixed `first` screenshot pose's eye height above the floor. */
  eyeHeightMetres: 1.6,
  /** The wide pose frames a little higher: the perimeter architecture now has a top. */
  wideTargetHeightMetres: 1.4,
  /** The `first` pose aims slightly down so the arena, not the void, fills the frame. */
  firstPersonPitchDegrees: -7,
  /** Spring-arm focus smoothing, in half-lives per second. */
  followHalfLifeSeconds: 0.07,
  /** How fast the arm itself follows a zoom, in half-lives per second. */
  zoomHalfLifeSeconds: 0.12,
  /**
   * The `wide` screenshot pose: camera offset as a fraction of the arena's span.
   * A2c pulls it back/up from the A2b inside arm so all four team clusters and both
   * visible gate arches fit without cropping the nearest lime tank. The arena is
   * smaller, but the perimeter architecture and the deep black void now do the
   * composition work instead of a cropped foreground tank.
   */
  wideOffsetFractions: { x: 0.36, y: 0.56, z: 0.55 },
} as const;

/** The placeholder tanks: dimensions in metres, and the sweep of the debug animation. */
export const TANK = {
  hullWidthMetres: 2.5,
  hullHeightMetres: 0.5,
  hullLengthMetres: 3.4,
  turretWidthMetres: 2.0,
  turretHeightMetres: 0.56,
  turretLengthMetres: 1.7,
  barrelLengthMetres: 2.0,
  /** The barrel tube and its muzzle brake. */
  barrelDiameterMetres: 0.32,
  muzzleDiameterMetres: 0.55,
  muzzleLengthMetres: 0.46,
  /** A small rest yaw so the gun reads from the follow pose. */
  turretRestYawRadians: -0.8,
  /** The trivial animation: turret yaw sweep amplitude, in radians. */
  sweepRadians: 0.12,
  sweepPeriodSeconds: 11,
} as const;

/**
 * The GPU-independent scene budget (ledger row 31/33). The headroom is 20 % over the
 * measured showcase and the pin in `src/render/sceneBudget.test.ts` is the performance
 * gate on a host without a GPU. Draw calls also have the DoD's absolute ceiling of 200.
 */
export const SCENE_BUDGET = {
  // Measured A2b showcase: 103 draw objects, 13,344 triangles, 39,232 vertices.
  // These are ceil(measured × 1.2): ~20 % headroom, not a resting target.
  maxDrawObjects: 124,
  maxTriangles: 16100,
  maxVertices: 47100,
  absoluteMaxDrawObjects: 200,
} as const;

/** Validates a team index and returns its identity colour. */
export function teamColor(index: number): string {
  const color = PALETTE.team[index];
  if (color === undefined) {
    throw new Error(
      `config: team index ${index} is outside the four-team palette (0…${PALETTE.team.length - 1})`,
    );
  }
  return color;
}
