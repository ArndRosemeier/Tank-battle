/**
 * cued identity — the ONE reader of the pass that cued.de hands a guest game.
 *
 * cued (a private friends' portal, https://cued.de) shows this game full-screen in a sandboxed iframe and appends a
 * pass to the URL: `…#cued=<JWT>`. The JWT is HS256-signed with the per-game key the developer sees on cued's
 * developer page. Its claims (cued `kern/gast.py`):
 *
 *   iss "cued" · aud <game slug> · iat/exp (Unix seconds, valid 6 h) · sub "<member id>" (stable player key)
 *   name, kuerzel (initials), hg/schrift (avatar circle background/text colour), bild (avatar URL or "")
 *   raum (room id when launched from a cued invitation, else null) · cued (portal base URL)
 *
 * TRUST: the browser can only READ the pass. It cannot verify the signature — the key must never ship in the bundle.
 * Use these claims for display only; anything that matters (who is in a room, results) is verified server-side
 * with the key (`jose`: `jwtVerify(token, new TextEncoder().encode(key), { issuer: 'cued', audience: slug })`).
 *
 * Pure and DOM-free (runs in node); the browser glue (URL hash, sessionStorage) is `src/entry/cued.ts`.
 * Malformed passes throw `CuedPassError` — never a silent fallback (AGENTS.md rule 1).
 */

export interface CuedIdentity {
  /** Stable player key from cued (`sub`); never the member's login name. */
  readonly playerId: string;
  readonly name: string;
  readonly initials: string;
  /** The member's avatar circle colours as cued draws them (CSS colour strings from cued). */
  readonly circle: { readonly background: string; readonly text: string };
  /** Small (128 px) avatar image, reachable without a cued login; null when the member has none. */
  readonly avatarUrl: string | null;
  /** The game slug cued registered this game under (`aud`). */
  readonly game: string;
  /** Room id when launched from a cued invitation (multiplayer, later slice); null for a plain launch. */
  readonly room: string | null;
  /** cued's base URL, e.g. https://cued.de/ */
  readonly portalUrl: string;
  /** Expiry, Unix seconds. */
  readonly expiresAt: number;
  /** The raw pass, to hand to a server that verifies it. */
  readonly token: string;
}

export class CuedPassError extends Error {
  override readonly name = 'CuedPassError';
}

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    throw new CuedPassError('cued pass: a segment is not base64url');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CuedPassError('cued pass: a segment is not UTF-8 JSON');
  }
}

function requireString(claims: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = claims[key];
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new CuedPassError(`cued pass: claim "${key}" must be a${allowEmpty ? '' : ' non-empty'} string`);
  }
  return value;
}

/**
 * Parses and schema-checks a cued pass. Does NOT verify the signature (see TRUST above).
 * Throws `CuedPassError` on any malformed field; expiry is reported separately by `isCuedPassExpired`.
 */
export function decodeCuedPass(token: string): CuedIdentity {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new CuedPassError('cued pass: expected a JWT with three segments');
  }
  const header = decodeSegment(parts[0] as string);
  if (typeof header !== 'object' || header === null || (header as Record<string, unknown>).alg !== 'HS256') {
    throw new CuedPassError('cued pass: header must declare alg HS256');
  }
  const claims = decodeSegment(parts[1] as string);
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    throw new CuedPassError('cued pass: claims must be a JSON object');
  }
  const c = claims as Record<string, unknown>;
  if (c.iss !== 'cued') throw new CuedPassError('cued pass: issuer must be "cued"');
  const exp = c.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) throw new CuedPassError('cued pass: claim "exp" must be a number');
  const room = c.raum;
  if (room !== null && room !== undefined && typeof room !== 'string') {
    throw new CuedPassError('cued pass: claim "raum" must be a string or null');
  }
  const avatar = requireString(c, 'bild', true);
  return {
    playerId: requireString(c, 'sub'),
    name: requireString(c, 'name'),
    initials: requireString(c, 'kuerzel'),
    circle: { background: requireString(c, 'hg'), text: requireString(c, 'schrift') },
    avatarUrl: avatar === '' ? null : avatar,
    game: requireString(c, 'aud'),
    room: typeof room === 'string' && room.length > 0 ? room : null,
    portalUrl: requireString(c, 'cued'),
    expiresAt: exp,
    token,
  };
}

/** True once the pass is past its `exp` (the player must reopen the game from cued for a fresh one). */
export function isCuedPassExpired(identity: CuedIdentity, nowSeconds: number): boolean {
  return nowSeconds >= identity.expiresAt;
}

/** The `#cued=<pass>` fragment marker cued appends to the game URL. */
export const CUED_HASH_KEY = 'cued';

/** Extracts the pass from a URL fragment (`#cued=…`, possibly among other `&`-separated keys); null when absent. */
export function cuedPassFromHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === CUED_HASH_KEY) {
      const value = part.slice(eq + 1);
      if (value.length === 0) throw new CuedPassError('cued pass: #cued= is empty');
      return value;
    }
  }
  return null;
}

/** The fragment with the pass removed (so it is not left in the address bar or copied links). */
export function hashWithoutCuedPass(hash: string): string {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const rest = body.split('&').filter((part) => !part.startsWith(`${CUED_HASH_KEY}=`) && part.length > 0);
  return rest.length > 0 ? `#${rest.join('&')}` : '';
}
