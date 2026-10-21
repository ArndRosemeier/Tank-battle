/**
 * The gateway arches at the arena's four entries (D4).
 *
 * They are PRESENTATION-ONLY architecture: the world model has no beam concept, and
 * A4 owns the authored level's collision. A2b adds them so the arena reads as a place
 * with entrances rather than a board on a table — the world still owns the opening
 * (the perimeter cells there are floor), and the arches frame it.
 *
 * All four arches are merged into ONE `NeonSurface` (fill + rim + one edge buffer),
 * so the whole perimeter dressing costs three draw calls.
 */

import { BoxGeometry, type BufferGeometry } from 'three';
import { NEON, PALETTE } from './config.ts';
import { createNeonSurface, type NeonSurface, type SurfacePart } from './neonSurface.ts';

export interface GatewaySpec {
  /** Centre of the opening, in metres. */
  readonly centerXMetres: number;
  readonly centerZMetres: number;
  /** Clear opening width, in metres. */
  readonly spanMetres: number;
  /** The underside of the beam, in metres. */
  readonly heightMetres: number;
  /** Wall thickness along the gate's normal, in metres. */
  readonly depthMetres: number;
  /** The beam runs along this axis; the gate's normal is the other one. */
  readonly axis: 'x' | 'z';
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

/** Builds one merged `NeonSurface` for all gateways. */
export function createGatewayArches(gates: readonly GatewaySpec[]): NeonSurface {
  if (gates.length === 0) {
    throw new Error('gateways: at least one gateway is required');
  }

  const postWidth = 0.9;
  const beamHeight = 0.9;
  const capHeight = 0.3;
  const parts: SurfacePart[] = [];

  for (const gate of gates) {
    if (!(gate.spanMetres > 0) || !(gate.heightMetres > 0) || !(gate.depthMetres > 0)) {
      throw new Error(`gateways: gateway at (${gate.centerXMetres}, ${gate.centerZMetres}) has non-positive dimensions`);
    }
    const along = gate.axis === 'x' ? 'x' : 'z';
    const postOffset = gate.spanMetres / 2 + postWidth / 2;

    const place = (
      alongSize: number,
      height: number,
      acrossSize: number,
      alongOffset: number,
      y: number,
    ): BufferGeometry => {
      const x = along === 'x' ? gate.centerXMetres + alongOffset : gate.centerXMetres;
      const z = along === 'x' ? gate.centerZMetres : gate.centerZMetres + alongOffset;
      const width = along === 'x' ? alongSize : acrossSize;
      const depth = along === 'x' ? acrossSize : alongSize;
      return box(width, height, depth, x, y, z);
    };

    // Two posts just outside the clear opening, the beam they carry, and a top cap.
    parts.push(
      {
        geometry: place(postWidth, gate.heightMetres + beamHeight, gate.depthMetres, -postOffset, (gate.heightMetres + beamHeight) / 2),
        color: PALETTE.gatewayEdge,
        gain: NEON.gatewayEdgeGain,
      },
      {
        geometry: place(postWidth, gate.heightMetres + beamHeight, gate.depthMetres, postOffset, (gate.heightMetres + beamHeight) / 2),
        color: PALETTE.gatewayEdge,
        gain: NEON.gatewayEdgeGain,
      },
      {
        geometry: place(
          gate.spanMetres + 2 * postWidth,
          beamHeight,
          gate.depthMetres,
          0,
          gate.heightMetres + beamHeight / 2,
        ),
        color: PALETTE.verticalEdge,
        gain: NEON.verticalEdgeGain,
      },
      {
        geometry: place(
          gate.spanMetres + 2 * postWidth + 0.5,
          capHeight,
          gate.depthMetres + 0.25,
          0,
          gate.heightMetres + beamHeight + capHeight / 2,
        ),
        color: PALETTE.iceWhite,
        gain: NEON.coreGain,
      },
    );
  }

  return createNeonSurface(parts);
}
