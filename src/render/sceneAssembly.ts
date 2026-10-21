/**
 * THE assembly of the A2b showcase arena: the A1 world mesh, the 16 placeholder tanks
 * and the gateway dressing, in one place.
 *
 * Why a seam instead of inline wiring in `src/main.ts`: the GPU-independent budget pin
 * must build the SAME scene the app renders, in `node`, and measure it (`sceneStats`).
 * A second "budget copy" of the scene would immediately drift from the rendered one.
 *
 * Draw calls: the world is four objects (grid + fill + rim + one edge buffer), each
 * tank is six (two surfaces × fill/rim/edges), and all four gateways are one merged
 * surface (three objects). Nothing here is per-cell.
 */

import { Group } from 'three';
import { createShowcaseScene, type ShowcaseScene } from './demoWorld.ts';
import { createGatewayArches } from './gateways.ts';
import { measureScene, type SceneStats } from './sceneStats.ts';
import {
  createPlaceholderTank,
  type PlaceholderTank,
} from './placeholderTank.ts';
import { createWorldMesh, type WorldMesh } from './worldMesh.ts';
import type { NeonSurface } from './neonSurface.ts';

export interface ArenaScene {
  readonly showcase: ShowcaseScene;
  readonly group: Group;
  readonly worldMesh: WorldMesh;
  readonly tanks: readonly PlaceholderTank[];
  readonly focusTank: PlaceholderTank;
  readonly gateways: NeonSurface;
  readonly stats: SceneStats;
  dispose(): void;
}

/** Builds the showcase exactly as the app renders it (and as the budget pin measures it). */
export function buildArenaScene(): ArenaScene {
  const showcase = createShowcaseScene();

  const group = new Group();
  group.name = 'arena';

  const worldMesh = createWorldMesh(showcase.world);
  group.add(worldMesh.group);

  const tanks: PlaceholderTank[] = showcase.spawns.map((spawn, index) => {
    const tank = createPlaceholderTank(spawn.teamIndex, index * 0.63);
    tank.group.position.set(spawn.xMetres, spawn.yMetres, spawn.zMetres);
    tank.group.rotation.y = (spawn.yawDegrees * Math.PI) / 180;
    group.add(tank.group);
    return tank;
  });

  const focusCandidate = tanks[showcase.focusSpawnIndex];
  if (!focusCandidate) {
    throw new Error(`sceneAssembly: focus tank ${showcase.focusSpawnIndex} is missing`);
  }
  const focusTank: PlaceholderTank = focusCandidate;

  const gateways = createGatewayArches(showcase.gates);
  group.add(gateways.group);

  const stats = measureScene(group);

  let disposed = false;
  return {
    showcase,
    group,
    worldMesh,
    tanks,
    focusTank,
    gateways,
    stats,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const tank of tanks) {
        tank.dispose();
      }
      gateways.dispose();
      worldMesh.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
