/**
 * The top-down debug plan markers. The world mesh already shows walls and the grid
 * floor shows cells; this layer adds the four 2×2 spawn zones in team colours at a
 * height above the architecture, so the orthographic `?pose=top` frame can be read as
 * a plan without projecting HTML labels.
 *
 * Visible only in the top pose; one LineSegments draw, vertex colours from the palette.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { CELL_SIZE_METRES } from '../core/world.ts';
import type { LevelDefinition } from '../game/levels/format.ts';
import { PALETTE, teamColor } from './config.ts';

const MARKER_Y = 12;

export interface TopPlan {
  readonly group: Group;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createTopPlan(level: LevelDefinition): TopPlan {
  const spawns = level.spawns;
  const positions: number[] = [];
  const colors: number[] = [];
  const y = MARKER_Y;

  for (const spawn of spawns) {
    const color = new Color(teamColor(spawn.teamId));
    const x0 = spawn.zoneX * CELL_SIZE_METRES;
    const z0 = spawn.zoneZ * CELL_SIZE_METRES;
    const x1 = (spawn.zoneX + spawn.zoneWidth) * CELL_SIZE_METRES;
    const z1 = (spawn.zoneZ + spawn.zoneHeight) * CELL_SIZE_METRES;
    const corners = [
      [x0, z0, x1, z0],
      [x1, z0, x1, z1],
      [x1, z1, x0, z1],
      [x0, z1, x0, z0],
    ] as const;
    for (const [ax, az, bx, bz] of corners) {
      positions.push(ax, y, az, bx, y, bz);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    // A short centre cross makes the spawn readable even when the outline is over a
    // wall. The L-shaped arrow is the protected exit: east out of the room, then
    // south through the outer gateway. It never points at the neighbouring spawn.
    positions.push(x0, y, z0 + (z1 - z0) / 2, x1, y, z0 + (z1 - z0) / 2);
    positions.push(x0 + (x1 - x0) / 2, y, z0, x0 + (x1 - x0) / 2, y, z1);
    for (let index = 0; index < 4; index += 1) {
      colors.push(color.r, color.g, color.b);
    }

    const route = [
      [spawn.zoneX + spawn.zoneWidth / 2, spawn.zoneZ + spawn.zoneHeight / 2],
      [6.3, spawn.zoneZ + spawn.zoneHeight / 2],
      [6.3, 6.3],
      [7.6, 6.3],
    ] as const;
    const arrow = [
      [7.15, 6.05],
      [7.6, 6.3],
      [7.15, 6.55],
    ] as const;
    const turn = (point: readonly [number, number], quarter: number): [number, number] => {
      let [px, pz] = point;
      for (let step = 0; step < quarter; step += 1) {
        const nextX = level.cells.rows - pz;
        pz = px;
        px = nextX;
      }
      return [px, pz];
    };
    const exitColor = new Color(PALETTE.iceWhite);
    for (let index = 0; index < route.length - 1; index += 1) {
      const a = turn(route[index]!, spawn.teamId);
      const b = turn(route[index + 1]!, spawn.teamId);
      positions.push(a[0] * CELL_SIZE_METRES, y, a[1] * CELL_SIZE_METRES);
      positions.push(b[0] * CELL_SIZE_METRES, y, b[1] * CELL_SIZE_METRES);
      colors.push(exitColor.r, exitColor.g, exitColor.b, exitColor.r, exitColor.g, exitColor.b);
    }
    for (let index = 0; index < arrow.length - 1; index += 1) {
      const a = turn(arrow[index]!, spawn.teamId);
      const b = turn(arrow[index + 1]!, spawn.teamId);
      positions.push(a[0] * CELL_SIZE_METRES, y, a[1] * CELL_SIZE_METRES);
      positions.push(b[0] * CELL_SIZE_METRES, y, b[1] * CELL_SIZE_METRES);
      colors.push(exitColor.r, exitColor.g, exitColor.b, exitColor.r, exitColor.g, exitColor.b);
    }
  }

  const fillPositions: number[] = [];
  const fillColors: number[] = [];
  const pushQuad = (x0: number, z0: number, x1: number, z1: number, color: Color): void => {
    const inset = 0.12;
    const ax = x0 + inset;
    const az = z0 + inset;
    const bx = x1 - inset;
    const bz = z1 - inset;
    const y = 9.8;
    fillPositions.push(
      ax, y, az, bx, y, az, bx, y, bz,
      ax, y, az, bx, y, bz, ax, y, bz,
    );
    for (let index = 0; index < 6; index += 1) {
      fillColors.push(color.r, color.g, color.b);
    }
  };
  for (const placement of level.cells.placements ?? []) {
    const x0 = placement.x * CELL_SIZE_METRES;
    const z0 = placement.z * CELL_SIZE_METRES;
    const x1 = x0 + CELL_SIZE_METRES;
    const z1 = z0 + CELL_SIZE_METRES;
    const central = placement.x >= 11 && placement.x <= 12 && placement.z >= 11 && placement.z <= 12;
    const color = new Color(
      central
        ? PALETTE.topObjectiveFill
        : placement.heightMetres <= 1.5
          ? PALETTE.topLowFill
          : PALETTE.topWallFill,
    );
    pushQuad(x0, z0, x1, z1, color);
  }
  // Dark team-tinted spawn zone fill under the bright outlines.
  for (const spawn of spawns) {
    const x0 = spawn.zoneX * CELL_SIZE_METRES;
    const z0 = spawn.zoneZ * CELL_SIZE_METRES;
    const x1 = (spawn.zoneX + spawn.zoneWidth) * CELL_SIZE_METRES;
    const z1 = (spawn.zoneZ + spawn.zoneHeight) * CELL_SIZE_METRES;
    const color = new Color(teamColor(spawn.teamId)).multiplyScalar(PALETTE.topSpawnFillAlpha);
    pushQuad(x0, z0, x1, z1, color);
  }
  const fillGeometry = new BufferGeometry();
  fillGeometry.setAttribute('position', new BufferAttribute(new Float32Array(fillPositions), 3));
  fillGeometry.setAttribute('color', new BufferAttribute(new Float32Array(fillColors), 3));
  const fillMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    fog: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const fill = new Mesh(fillGeometry, fillMaterial);
  fill.name = 'top-plan-fill';
  fill.frustumCulled = false;
  fill.renderOrder = 15;

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
  group.add(fill, lines);
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
      fillGeometry.dispose();
      fillMaterial.dispose();
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
  wall: PALETTE.wallEdge,
  lowCover: PALETTE.lowCoverEdge,
  objective: PALETTE.iceWhite,
  exit: PALETTE.iceWhite,
} as const;
