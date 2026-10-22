/**
 * The validated data shape for an AI character. B1a ships ONE profile, "vanguard";
 * the shape already separates the three goals so B1b can add mixes without rewriting
 * the controller.
 *
 * A profile is authored DATA. Unknown goal keys, missing weights and out-of-range
 * numbers are load errors, never a silent default.
 */

export const AI_GOAL_KEYS = [
  'gain-line-of-sight',
  'approach-preferred-range',
  'fire-in-cone',
] as const;

export type AIGoal = (typeof AI_GOAL_KEYS)[number];

export type AIWeights = Readonly<Record<AIGoal, number>>;

export interface AIProfile {
  readonly name: string;
  readonly weights: AIWeights;
  readonly preferredRangeMetres: number;
  readonly fireConeDegrees: number;
  readonly memoryTicks: number;
}

const VANGUARD_WEIGHTS: AIWeights = Object.freeze({
  'gain-line-of-sight': 1,
  'approach-preferred-range': 0.8,
  'fire-in-cone': 1,
});

/** The deliberate simple pilot: see, close to range, fire. No cover or breach play. */
export const VANGUARD_PROFILE: AIProfile = Object.freeze({
  name: 'vanguard',
  weights: VANGUARD_WEIGHTS,
  preferredRangeMetres: 10,
  fireConeDegrees: 8,
  memoryTicks: 180,
});

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
  const weights = candidate.weights;
  if (weights === null || typeof weights !== 'object') {
    throw new Error(`validateAIProfile: ${candidate.name}.weights must be an object`);
  }
  const keys = Object.keys(weights);
  for (const key of keys) {
    if (!(AI_GOAL_KEYS as readonly string[]).includes(key)) {
      throw new Error(`validateAIProfile: ${candidate.name} has unknown goal key "${key}"`);
    }
  }
  const validatedWeights: Record<AIGoal, number> = {
    'gain-line-of-sight': 0,
    'approach-preferred-range': 0,
    'fire-in-cone': 0,
  };
  for (const goal of AI_GOAL_KEYS) {
    if (!(goal in weights)) {
      throw new Error(`validateAIProfile: ${candidate.name} is missing goal weight "${goal}"`);
    }
    const value = (weights as Record<string, unknown>)[goal];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`validateAIProfile: ${candidate.name}.${goal} must be finite, got ${String(value)}`);
    }
    if (value < 0 || value > 1) {
      throw new Error(`validateAIProfile: ${candidate.name}.${goal} must be within 0…1, got ${value}`);
    }
    validatedWeights[goal] = value;
  }
  const preferredRangeMetres = candidate.preferredRangeMetres;
  if (typeof preferredRangeMetres !== 'number' || !Number.isFinite(preferredRangeMetres) || preferredRangeMetres <= 0) {
    throw new Error(`validateAIProfile: ${candidate.name}.preferredRangeMetres must be finite and > 0`);
  }
  const fireConeDegrees = candidate.fireConeDegrees;
  if (typeof fireConeDegrees !== 'number' || !Number.isFinite(fireConeDegrees) || fireConeDegrees <= 0 || fireConeDegrees > 90) {
    throw new Error(`validateAIProfile: ${candidate.name}.fireConeDegrees must be within (0, 90]`);
  }
  const memoryTicks = candidate.memoryTicks;
  if (typeof memoryTicks !== 'number' || !Number.isInteger(memoryTicks) || memoryTicks < 1) {
    throw new Error(`validateAIProfile: ${candidate.name}.memoryTicks must be a positive integer`);
  }
  return Object.freeze({
    name: candidate.name,
    weights: Object.freeze({ ...validatedWeights }),
    preferredRangeMetres,
    fireConeDegrees,
    memoryTicks,
  });
}

/** The one profile registry for B1a. B1b adds entries here, not in the controller. */
export function getAIProfile(name: string): AIProfile {
  if (name !== VANGUARD_PROFILE.name) {
    throw new Error(`getAIProfile: unknown character "${name}"; B1a ships only "vanguard"`);
  }
  return VANGUARD_PROFILE;
}
