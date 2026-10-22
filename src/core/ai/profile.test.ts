import { describe, expect, it } from 'vitest';
import { VANGUARD_PROFILE, getAIProfile, validateAIProfile } from './profile.ts';

describe('AI profile data', () => {
  it('validates vanguard and rejects unknown goals and out-of-range weights', () => {
    expect(validateAIProfile(VANGUARD_PROFILE).name).toBe('vanguard');
    expect(getAIProfile('vanguard')).toBe(VANGUARD_PROFILE);
    expect(() =>
      validateAIProfile({
        ...VANGUARD_PROFILE,
        weights: { ...VANGUARD_PROFILE.weights, marksman: 0.5 },
      }),
    ).toThrow(/unknown goal key/);
    expect(() =>
      validateAIProfile({
        ...VANGUARD_PROFILE,
        weights: { ...VANGUARD_PROFILE.weights, 'fire-in-cone': 1.2 },
      }),
    ).toThrow(/within 0.*1/);
  });
});
