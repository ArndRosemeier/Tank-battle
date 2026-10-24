import {
  CuedPassError,
  cuedPassFromHash,
  decodeCuedPass,
  hashWithoutCuedPass,
  isCuedPassExpired,
  type CuedIdentity,
} from '../cued/identity.ts';
import { requireElement } from './dom.ts';

/**
 * Browser glue for the cued pass (`src/cued/identity.ts` is the pure reader).
 *
 * cued appends `#cued=<pass>` only to the FIRST URL it opens. The game's own navigations (`?mode=…` via
 * `location.assign`) drop the fragment, so the pass is kept in this tab's sessionStorage and the fragment is removed
 * from the address bar at once (it must not end up in copied links or screenshots).
 */

const STORAGE_KEY = 'tank-battle.cued-pass';

export interface CuedSession {
  readonly identity: CuedIdentity;
  /** True once the pass's 6 h are over: the player has to reopen the game from cued. */
  readonly expired: boolean;
}

/** The pass of this tab, or null when the game was not launched from cued. Malformed passes throw (and are dropped). */
export function loadCuedSession(nowSeconds: number = Date.now() / 1000): CuedSession | null {
  const fromHash = cuedPassFromHash(window.location.hash);
  if (fromHash !== null) {
    window.sessionStorage.setItem(STORAGE_KEY, fromHash);
    const { pathname, search, hash } = window.location;
    window.history.replaceState(window.history.state, '', pathname + search + hashWithoutCuedPass(hash));
  }
  const token = fromHash ?? window.sessionStorage.getItem(STORAGE_KEY);
  if (token === null) return null;
  try {
    const identity = decodeCuedPass(token);
    return { identity, expired: isCuedPassExpired(identity, nowSeconds) };
  } catch (cause) {
    // Drop the bad pass so the NEXT load is not stuck on it; the error itself still reaches the error surface.
    if (cause instanceof CuedPassError) window.sessionStorage.removeItem(STORAGE_KEY);
    throw cause;
  }
}

/** Title-screen badge: the cued player's avatar circle and name (or a reopen hint when the pass has expired). */
export function showCuedBadge(session: CuedSession): void {
  const badge = requireElement('cued-badge', HTMLElement, 'cued badge');
  const { identity } = session;
  let circle: HTMLElement;
  if (identity.avatarUrl !== null) {
    const img = document.createElement('img');
    img.src = identity.avatarUrl;
    img.alt = '';
    circle = img;
  } else {
    circle = document.createElement('span');
    circle.textContent = identity.initials;
    circle.style.background = identity.circle.background;
    circle.style.color = identity.circle.text;
  }
  circle.className = 'cued-badge-circle';
  const label = document.createElement('span');
  label.textContent = session.expired
    ? 'CUED PASS EXPIRED · REOPEN THE GAME FROM CUED'
    : `CUED · ${identity.name.toUpperCase()}`;
  badge.replaceChildren(circle, label);
  badge.classList.toggle('expired', session.expired);
  badge.hidden = false;
}
