import { describe, expect, it } from 'vitest';
import { AI_PROFILES, VANGUARD_PROFILE, getAIProfile, validateAIProfile } from './profile.ts';

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

  it('validates every shipped profile at module load', () => {
    expect(AI_PROFILES.map((profile) => profile.name)).toEqual([
      'vanguard',
      'sniper',
      'ambusher',
      'brute',
    ]);
    for (const profile of AI_PROFILES) {
      expect(validateAIProfile(profile)).toEqual(profile);
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.weights)).toBe(true);
    }
  });
});
