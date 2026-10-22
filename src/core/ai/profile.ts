/**
 * The validated data shape for an AI character. One core; profiles choose goal
 * weights and parameters. B1c ships four characters: vanguard (brawl), sniper (hold a
 * long sightline), ambusher (hide, relocate) and brute (breach toward the goal).
 *
 * A profile is authored DATA. Unknown goal keys, missing weights and out-of-range
 * numbers are load errors, never a silent default.
 */

export const AI_GOAL_KEYS = [
  'gain-line-of-sight',
  'approach-preferred-range',
  'fire-in-cone',
  'hold-cover',
  'flank',
  'ambush-chokepoint',
  'breach-wall',
  'wounded-retreat',
] as const;

export type AIGoal = (typeof AI_GOAL_KEYS)[number];

export type AIWeights = Readonly<Record<AIGoal, number>>;

export interface AIProfile {
  readonly name: string;
  readonly weights: AIWeights;
  readonly preferredRangeMetres: number;
  /** At closer range a sniper retreats; zero for characters that brawl. */
  readonly minRangeMetres: number;
  readonly fireConeDegrees: number;
  readonly memoryTicks: number;
  /** Seeded aim spread; high for brawlers, low for a long-range specialist. */
  readonly aimErrorBaseDegrees: number;
  readonly aimErrorPerMetre: number;
  /** How long an ambusher holds a hidden point before it relocates/engages. */
  readonly ambushHoldTicks: number;
  /** How far a brute looks for a wall to breach. */
  readonly breachRangeMetres: number;
}

function weights(values: Partial<Record<AIGoal, number>>): AIWeights {
  const result = {} as Record<AIGoal, number>;
  for (const goal of AI_GOAL_KEYS) {
    result[goal] = values[goal] ?? 0;
  }
  return Object.freeze(result);
}

/** The brawler from B1b: close, strafe, fire. */
export const VANGUARD_PROFILE: AIProfile = Object.freeze({
  name: 'vanguard',
  weights: weights({
    'gain-line-of-sight': 1,
    'approach-preferred-range': 0.8,
    'fire-in-cone': 1,
    flank: 0.7,
  }),
  preferredRangeMetres: 10,
  minRangeMetres: 0,
  fireConeDegrees: 8,
  memoryTicks: 180,
  aimErrorBaseDegrees: 10,
  aimErrorPerMetre: 1.8,
  ambushHoldTicks: 0,
  breachRangeMetres: 0,
});

/** A long-sightline specialist: holds ~36 m and refuses to close inside 26 m. */
export const SNIPER_PROFILE: AIProfile = Object.freeze({
  name: 'sniper',
  weights: weights({
    'gain-line-of-sight': 1,
    'approach-preferred-range': 0.35,
    'fire-in-cone': 1,
    'hold-cover': 0.9,
    flank: 0.35,
    'wounded-retreat': 0.8,
  }),
  preferredRangeMetres: 26,
  minRangeMetres: 22,
  fireConeDegrees: 5,
  memoryTicks: 240,
  aimErrorBaseDegrees: 8,
  aimErrorPerMetre: 1.2,
  ambushHoldTicks: 0,
  breachRangeMetres: 0,
});

/** A chokepoint holder: hides, waits, fires once, then relocates. */
export const AMBUSHER_PROFILE: AIProfile = Object.freeze({
  name: 'ambusher',
  weights: weights({
    'gain-line-of-sight': 1,
    'approach-preferred-range': 0.55,
    'fire-in-cone': 1,
    'hold-cover': 0.9,
    flank: 0.6,
    'ambush-chokepoint': 1,
    'wounded-retreat': 0.9,
  }),
  preferredRangeMetres: 14,
  minRangeMetres: 0,
  fireConeDegrees: 8,
  memoryTicks: 300,
  aimErrorBaseDegrees: 12,
  aimErrorPerMetre: 1.8,
  ambushHoldTicks: 1800,
  breachRangeMetres: 0,
});

/** A wall-breaker: when the route blocks, shoots the blocking cell and advances. */
export const BRUTE_PROFILE: AIProfile = Object.freeze({
  name: 'brute',
  weights: weights({
    'gain-line-of-sight': 0.8,
    'approach-preferred-range': 1,
    'fire-in-cone': 1,
    'breach-wall': 1,
    flank: 0.2,
  }),
  preferredRangeMetres: 12,
  minRangeMetres: 0,
  fireConeDegrees: 10,
  memoryTicks: 120,
  aimErrorBaseDegrees: 4,
  aimErrorPerMetre: 0.6,
  ambushHoldTicks: 0,
  breachRangeMetres: 22,
});

export const AI_PROFILES: readonly AIProfile[] = Object.freeze([
  VANGUARD_PROFILE,
  SNIPER_PROFILE,
  AMBUSHER_PROFILE,
  BRUTE_PROFILE,
]);

/**
 * Validates an unknown profile object and returns a frozen copy. This is the ONE
 * profile boundary: batch CLI, tests and future character data all call it.
 */
export function validateAIProfile(input: unknown): AIProfile {
  if (input === null || typeof input !== 'object') {
    throw new Error(`validateAIProfile: profile must be an object, got ${String(input)}`);
  }
  const candidate = input as Partial<AIProfile>;
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
    throw new Error('validateAIProfile: profile needs a non-empty name');
  }
  const rawWeights = candidate.weights;
  if (rawWeights === null || typeof rawWeights !== 'object') {
    throw new Error(`validateAIProfile: ${candidate.name}.weights must be an object`);
  }
  for (const key of Object.keys(rawWeights)) {
    if (!(AI_GOAL_KEYS as readonly string[]).includes(key)) {
      throw new Error(`validateAIProfile: ${candidate.name} has unknown goal key "${key}"`);
    }
  }
  const validatedWeights = {} as Record<AIGoal, number>;
  for (const goal of AI_GOAL_KEYS) {
    if (!(goal in rawWeights)) {
      throw new Error(`validateAIProfile: ${candidate.name} is missing goal weight "${goal}"`);
    }
    const value = (rawWeights as Record<string, unknown>)[goal];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`validateAIProfile: ${candidate.name}.${goal} must be finite, got ${String(value)}`);
    }
    if (value < 0 || value > 1) {
      throw new Error(`validateAIProfile: ${candidate.name}.${goal} must be within 0…1, got ${value}`);
    }
    validatedWeights[goal] = value;
  }
  const preferredRangeMetres = numberIn(candidate.preferredRangeMetres, `${candidate.name}.preferredRangeMetres`, 0, Infinity);
  const minRangeMetres = numberIn(candidate.minRangeMetres, `${candidate.name}.minRangeMetres`, 0, Infinity);
  const fireConeDegrees = numberIn(candidate.fireConeDegrees, `${candidate.name}.fireConeDegrees`, 0.0001, 90);
  const memoryTicks = integerIn(candidate.memoryTicks, `${candidate.name}.memoryTicks`, 1);
  const aimErrorBaseDegrees = numberIn(candidate.aimErrorBaseDegrees, `${candidate.name}.aimErrorBaseDegrees`, 0, 180);
  const aimErrorPerMetre = numberIn(candidate.aimErrorPerMetre, `${candidate.name}.aimErrorPerMetre`, 0, 180);
  const ambushHoldTicks = integerIn(candidate.ambushHoldTicks, `${candidate.name}.ambushHoldTicks`, 0);
  const breachRangeMetres = numberIn(candidate.breachRangeMetres, `${candidate.name}.breachRangeMetres`, 0, Infinity);
  return Object.freeze({
    name: candidate.name,
    weights: Object.freeze({ ...validatedWeights }),
    preferredRangeMetres,
    minRangeMetres,
    fireConeDegrees,
    memoryTicks,
    aimErrorBaseDegrees,
    aimErrorPerMetre,
    ambushHoldTicks,
    breachRangeMetres,
  });
}

function numberIn(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`validateAIProfile: ${label} must be finite in ${min}…${max}`);
  }
  return value;
}

function integerIn(value: unknown, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`validateAIProfile: ${label} must be an integer >= ${min}`);
  }
  return value;
}

/** The one profile registry. */
export function getAIProfile(name: string): AIProfile {
  const profile = AI_PROFILES.find((candidate) => candidate.name === name);
  if (!profile) {
    throw new Error(`getAIProfile: unknown character "${name}"; expected ${AI_PROFILES.map((p) => p.name).join(', ')}`);
  }
  return profile;
}
