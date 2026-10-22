/**
 * The deterministic state hash: the pin that tells two runs apart when a test (or a
 * future batch rig) must prove they are the same run.
 *
 * It hashes the WHOLE mutable state — cells, blocks, shards, the tick, the id counter —
 * in a canonical order, so two worlds that only differ by a shard's mirror angle hash
 * differently. Floats (heights) are quantised to millimetres: they are level data, not
 * arithmetic, and a hash is an equality check, not a measurement.
 */

import { fnv1a } from '../fnv1a.ts';
import { listBlocks, type World } from './state.ts';

/** An 8-character hex FNV-1a hash of the world's canonical state text. */
export function hashState(world: World): string {
  const lines: string[] = [
    `world ${world.columns}x${world.rows} floor=${millimetres(world.floorSurfaceHeightMetres)} tick=${world.tick} nextShard=${world.nextShardId} revision=${world.revision}`,
  ];
  for (const cell of world.cells) {
    lines.push(
      `cell ${cell.x},${cell.z} ${cell.material} hp=${cell.hp}/${cell.maxHp} regen=${cell.regenTicksRemaining} top=${millimetres(cell.heightMetres)}`,
    );
  }
  for (const block of listBlocks(world)) {
    lines.push(
      `block ${block.x},${block.z} ${block.material} hp=${block.hp}/${block.maxHp} top=${millimetres(block.heightMetres)}`,
    );
  }
  for (const shard of world.shards) {
    lines.push(
      `shard ${shard.id} ${shard.x},${shard.z} mirror=${shard.mirrorAngleDegrees} born=${shard.bornTick}`,
    );
  }
  return fnv1a(lines.join('\n'));
}

function millimetres(metres: number): number {
  return Math.round(metres * 1000);
}
