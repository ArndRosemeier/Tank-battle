import { createHmac } from 'node:crypto';
import {
  CuedPassError,
  cuedPassFromHash,
  decodeCuedPass,
  hashWithoutCuedPass,
  isCuedPassExpired,
} from './identity.ts';

/** Builds a pass exactly as cued's `kern/gast.py` does (HS256, compact JSON, base64url without padding). */
function makePass(claims: Record<string, unknown>, key = 'test-key', header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }): string {
  const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
  const head = b64(JSON.stringify(header));
  const body = b64(JSON.stringify(claims));
  const sig = createHmac('sha256', key).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const CLAIMS = {
  iss: 'cued', aud: 'tank-battle', iat: 1000, exp: 1000 + 6 * 3600, sub: '7',
  name: 'Arnd Ü', kuerzel: 'A', hg: 'rgb(31, 58, 50)', schrift: 'rgb(124, 240, 208)', bild: '', raum: null,
  cued: 'https://cued.de/',
};

describe('cued pass', () => {
  it('reads every claim cued sends, including non-ASCII names and a missing avatar', () => {
    const identity = decodeCuedPass(makePass(CLAIMS));
    expect(identity.playerId).toBe('7');
    expect(identity.name).toBe('Arnd Ü');
    expect(identity.initials).toBe('A');
    expect(identity.circle).toEqual({ background: 'rgb(31, 58, 50)', text: 'rgb(124, 240, 208)' });
    expect(identity.avatarUrl).toBeNull();
    expect(identity.game).toBe('tank-battle');
    expect(identity.room).toBeNull();
    expect(identity.portalUrl).toBe('https://cued.de/');
  });

  it('keeps an avatar URL and a room id when cued sends them', () => {
    const identity = decodeCuedPass(makePass({ ...CLAIMS, bild: 'https://cued.de/gast/bild/x/', raum: 'r1' }));
    expect(identity.avatarUrl).toBe('https://cued.de/gast/bild/x/');
    expect(identity.room).toBe('r1');
  });

  it('fails loudly on malformed passes instead of inventing a player', () => {
    expect(() => decodeCuedPass('not-a-jwt')).toThrow(CuedPassError);
    expect(() => decodeCuedPass('a.b.c')).toThrow(CuedPassError);
    expect(() => decodeCuedPass(makePass({ ...CLAIMS, iss: 'elsewhere' }))).toThrow(/issuer/);
    expect(() => decodeCuedPass(makePass({ ...CLAIMS, name: '' }))).toThrow(/"name"/);
    expect(() => decodeCuedPass(makePass({ ...CLAIMS, exp: 'soon' }))).toThrow(/"exp"/);
    expect(() => decodeCuedPass(makePass(CLAIMS, 'k', { alg: 'none' }))).toThrow(/HS256/);
  });

  it('reports expiry at exp, not one second later', () => {
    const identity = decodeCuedPass(makePass(CLAIMS));
    expect(isCuedPassExpired(identity, CLAIMS.exp - 1)).toBe(false);
    expect(isCuedPassExpired(identity, CLAIMS.exp)).toBe(true);
  });

  it('finds the pass among other fragment keys and strips only it', () => {
    expect(cuedPassFromHash('')).toBeNull();
    expect(cuedPassFromHash('#detail=1')).toBeNull();
    expect(cuedPassFromHash('#detail=1&cued=abc.def.ghi')).toBe('abc.def.ghi');
    expect(() => cuedPassFromHash('#cued=')).toThrow(CuedPassError);
    expect(hashWithoutCuedPass('#cued=abc.def.ghi')).toBe('');
    expect(hashWithoutCuedPass('#detail=1&cued=abc.def.ghi')).toBe('#detail=1');
  });
});
