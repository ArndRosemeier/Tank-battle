/**
 * The ONE place a match's arena is chosen: the authored "Fourfold Crucible" or a
 * generated arena from a seed and a size. Sessions, the AI staging, the camera and the
 * top plan all take the resolved `Arena`, so nothing else needs to know which kind it is.
 *
 * Game layer: no DOM, no three.js.
 */

import { ARENA, ARENA_BASE_HEIGHT_METRES, ARENA_BOUNDS } from './arena.ts';
import { generateArena, validateArenaSeed, validateArenaSize, type ArenaSize } from './generator.ts';
import { validateLevel, type LevelDefinition } from './format.ts';

export type ArenaChoice =
  | { readonly kind: 'crucible' }
  | { readonly kind: 'generated'; readonly seed: number; readonly size: ArenaSize };

export interface ArenaBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Arena {
  readonly choice: ArenaChoice;
  readonly level: LevelDefinition;
  readonly bounds: ArenaBounds;
  /** The open ground level (the pads). Cameras and demos frame on it. */
  readonly baseHeightMetres: number;
}

export const CRUCIBLE_CHOICE: ArenaChoice = Object.freeze({ kind: 'crucible' });

export const CRUCIBLE: Arena = Object.freeze({
  choice: CRUCIBLE_CHOICE,
  level: ARENA,
  bounds: ARENA_BOUNDS,
  baseHeightMetres: ARENA_BASE_HEIGHT_METRES,
});

export function validateArenaChoice(choice: ArenaChoice): ArenaChoice {
  if (choice === null || typeof choice !== 'object') {
    throw new Error(`arena: choice must be an object, got ${String(choice)}`);
  }
  if (choice.kind === 'crucible') return choice;
  if (choice.kind === 'generated') {
    validateArenaSeed(choice.seed);
    validateArenaSize(choice.size);
    return choice;
  }
  throw new Error(`arena: unknown arena kind "${String((choice as { kind: unknown }).kind)}"`);
}

/** The last generated arena: a rematch or a second session on the same seed reuses it. */
let lastGenerated: { key: string; arena: Arena } | null = null;

/** Builds (or reuses) the arena for a choice. Throws when the choice is invalid. */
export function resolveArena(choice: ArenaChoice): Arena {
  validateArenaChoice(choice);
  if (choice.kind === 'crucible') {
    validateLevel(ARENA);
    return CRUCIBLE;
  }
  const key = `${choice.seed}:${choice.size}`;
  if (lastGenerated?.key === key) return lastGenerated.arena;
  const generated = generateArena(choice.seed, choice.size);
  const arena: Arena = Object.freeze({
    choice,
    level: generated.level,
    bounds: Object.freeze({ minX: 0, maxX: generated.widthMetres, minZ: 0, maxZ: generated.widthMetres }),
    baseHeightMetres: generated.baseHeightMetres,
  });
  lastGenerated = { key, arena };
  return arena;
}

/** A short label for the setup screen, e.g. `CRUCIBLE` or `#48213 · MEDIUM`. */
export function describeArenaChoice(choice: ArenaChoice): string {
  return choice.kind === 'crucible' ? 'CRUCIBLE' : `#${choice.seed} · ${choice.size.toUpperCase()}`;
}
