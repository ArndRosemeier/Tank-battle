/**
 * FNV-1a over canonical state text — the ONE hash function in the core.
 *
 * The world hash (`src/core/world/hash.ts`) and the match hash (`src/core/sim/hash.ts`)
 * both feed a canonical text into this, so a hash is comparable across the two layers
 * and a second copy of the constants cannot drift. 8 hex characters: a witness, not a
 * cryptographic digest.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** An 8-character hex FNV-1a hash of `text`. */
export function fnv1a(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
