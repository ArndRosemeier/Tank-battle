/**
 * Where online play connects. GameHub app keys are NOT secrets (a browser game ships
 * its key in the bundle; see the gameserver README), so the key may be committed here
 * or provided at build time as `VITE_GAMEHUB_KEY`.
 */

export const GAMEHUB_URL: string = import.meta.env.VITE_GAMEHUB_URL || 'https://games.futuremagic.de';
export const GAMEHUB_APP: string = import.meta.env.VITE_GAMEHUB_APP || 'tank-battle';
/** Filled in once the app is registered on the server (`npm run apps -- mint-key tank-battle`). */
const COMMITTED_KEY = '';
export const GAMEHUB_KEY: string = import.meta.env.VITE_GAMEHUB_KEY || COMMITTED_KEY;

/** Why online play cannot start in this build, or null when it can. */
export function onlineUnavailableReason(): string | null {
  if (GAMEHUB_KEY.length === 0) {
    return 'Online play is not set up in this build yet: the game has no GameHub app key.';
  }
  return null;
}
