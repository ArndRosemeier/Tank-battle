/**
 * The world's equality witness: every sample, every falling chunk and the regeneration
 * clock, folded into one 8-character FNV-1a hex string. Two runs that agree here have
 * the same terrain byte for byte.
 */

import type { World } from './field.ts';

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

function foldBytes(hash: number, bytes: Uint8Array): number {
  let h = hash;
  for (let n = 0; n < bytes.length; n += 1) {
    h ^= bytes[n]!;
    h = Math.imul(h, PRIME);
  }
  return h >>> 0;
}

function foldNumber(hash: number, value: number): number {
  let h = hash;
  const text = String(value);
  for (let n = 0; n < text.length; n += 1) {
    h ^= text.charCodeAt(n);
    h = Math.imul(h, PRIME);
  }
  h ^= 0x7c; // separator
  return Math.imul(h, PRIME) >>> 0;
}

export function hashState(world: World): string {
  let h = OFFSET;
  for (const value of [world.nx, world.ny, world.nz, world.spacing, world.revision, world.nextChunkId, world.regenCountdown]) {
    h = foldNumber(h, value);
  }
  h = foldBytes(h, world.density);
  h = foldBytes(h, world.material);
  for (const chunk of [...world.chunks].sort((a, b) => a.id - b.id)) {
    h = foldNumber(h, chunk.id);
    h = foldNumber(h, Math.round(chunk.fallMetres * 1000));
    h = foldNumber(h, Math.round(chunk.speed * 1000));
    h = foldNumber(h, chunk.drop);
    h = foldBytes(h, new Uint8Array(chunk.samples.buffer, chunk.samples.byteOffset, chunk.samples.byteLength));
    h = foldBytes(h, chunk.densities);
    h = foldBytes(h, chunk.materials);
  }
  return h.toString(16).padStart(8, '0');
}
