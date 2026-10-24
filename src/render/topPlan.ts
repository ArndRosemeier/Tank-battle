/**
 * The top-down debug plan markers. The terrain already shows the landscape; this layer
 * adds the four spawn pads in team colours and their facing arrows above the highest
 * terrain, so the orthographic `?pose=top` frame can be read as a plan without
 * projecting HTML labels.
 *
 * Visible only in the top pose; one LineSegments draw, vertex colours from the palette.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import type { LevelDefinition } from '../game/levels/format.ts';
import { PALETTE, TERRAIN_PALETTE, teamColor } from './config.ts';

/** Above the highest terrain, so the markers read over the hill and the spires. */
const MARKER_Y = 18;
const PAD_MARGIN = 1.6;
const ARROW_METRES = 6;

export interface TopPlan {
  readonly group: Group;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createTopPlan(level: LevelDefinition): TopPlan {
  const positions: number[] = [];
  const colors: number[] = [];
  const y = MARKER_Y;
  const push = (ax: number, az: number, bx: number, bz: number, color: Color): void => {
    positions.push(ax, y, az, bx, y, bz);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  };

  for (const spawn of level.spawns) {
    const color = new Color(teamColor(spawn.teamId));
    // The pad: a square around its four tank slots, and a centre cross.
    const xs = spawn.slots.map((slot) => slot.xMetres);
    const zs = spawn.slots.map((slot) => slot.zMetres);
    const x0 = Math.min(...xs) - PAD_MARGIN;
    const x1 = Math.max(...xs) + PAD_MARGIN;
    const z0 = Math.min(...zs) - PAD_MARGIN;
    const z1 = Math.max(...zs) + PAD_MARGIN;
    push(x0, z0, x1, z0, color);
    push(x1, z0, x1, z1, color);
    push(x1, z1, x0, z1, color);
    push(x0, z1, x0, z0, color);
    push(x0, spawn.zMetres, x1, spawn.zMetres, color);
    push(spawn.xMetres, z0, spawn.xMetres, z1, color);
    // The facing arrow: where every tank on the pad starts looking.
    const exitColor = new Color(PALETTE.iceWhite);
    const yaw = (spawn.yawDegrees * Math.PI) / 180;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const tipX = spawn.xMetres + fx * ARROW_METRES;
    const tipZ = spawn.zMetres + fz * ARROW_METRES;
    push(spawn.xMetres, spawn.zMetres, tipX, tipZ, exitColor);
    push(tipX, tipZ, tipX - fx * 1.2 + fz * 0.9, tipZ - fz * 1.2 - fx * 0.9, exitColor);
    push(tipX, tipZ, tipX - fx * 1.2 - fz * 0.9, tipZ - fz * 1.2 + fx * 0.9, exitColor);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  const material = new LineBasicMaterial({
    vertexColors: true,
    depthTest: false,
    fog: false,
    transparent: true,
    opacity: 0.95,
  });
  const lines = new LineSegments(geometry, material);
  lines.name = 'top-plan-spawns';
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  const group = new Group();
  group.name = 'top-plan';
  group.add(lines);
  group.visible = false;

  let disposed = false;
  return {
    group,
    setVisible(visible: boolean): void {
      group.visible = visible;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Palette hook for the top legend; the same colour a spawn zone is drawn in. */
export function spawnMarkerColor(teamId: number): string {
  return teamColor(teamId);
}

/** Palette hook for the legend's structural rows. */
export const TOP_LEGEND_COLORS = {
  ground: TERRAIN_PALETTE.edgeLow,
  heights: TERRAIN_PALETTE.edgeHigh,
  crystal: TERRAIN_PALETTE.crystal,
  exit: PALETTE.iceWhite,
} as const;
