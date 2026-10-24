/**
 * Marching tetrahedra: the density lattice becomes glowing triangles.
 *
 * Every lattice cell is split into six tetrahedra around its main diagonal (corner 0 →
 * corner 6). The split is the same in every cell, so neighbouring cells agree on their
 * shared face diagonals and the surface is watertight without the ambiguity tables of
 * marching cubes. Each tetrahedron yields zero, one or two triangles; every triangle
 * is wound to face from rock into air and carries a flat normal, which is the faceted
 * look the TRON style wants.
 *
 * Pure TypeScript: no three.js, so the mesher is testable in node.
 */

/** Reads the density of sample `(i, j, k)`, with the caller's outside rules applied. */
export type DensitySampler = (i: number, j: number, k: number) => number;

/** Per-triangle shading the mesher asks the caller for. */
export interface TriangleShade {
  /** 1 for crystal, 0 for rock. */
  readonly crystal: number;
  /** 0…1: how far this surface is from the authored landscape (craters, rubble). */
  readonly damage: number;
}

export interface MeshRegion {
  /** Inclusive-exclusive cell ranges. A cell `(i, j, k)` spans samples `i…i+1`, etc. */
  readonly minI: number;
  readonly maxI: number;
  readonly minJ: number;
  readonly maxJ: number;
  readonly minK: number;
  readonly maxK: number;
}

export interface TerrainMeshData {
  /** xyz per vertex, three vertices per triangle (non-indexed). */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Barycentric corner per vertex: (1,0,0), (0,1,0), (0,0,1). */
  readonly barycentric: Float32Array;
  /** (crystal, damage) per vertex. */
  readonly shade: Float32Array;
  readonly triangleCount: number;
}

const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
  [0, 1, 0],
  [1, 1, 0],
  [1, 1, 1],
  [0, 1, 1],
];

const TETRAHEDRA: readonly (readonly [number, number, number, number])[] = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];

/**
 * Meshes the cells of `region`. `spacing` scales sample coordinates to metres and
 * `offset` is added to every vertex (a falling chunk's drop). `shadeAt` is asked once
 * per triangle with the triangle's centroid in metres.
 */
export function meshTerrain(
  sample: DensitySampler,
  region: MeshRegion,
  spacing: number,
  iso: number,
  shadeAt: (x: number, y: number, z: number) => TriangleShade,
  offset: { readonly x: number; readonly y: number; readonly z: number } = { x: 0, y: 0, z: 0 },
): TerrainMeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const shades: number[] = [];
  const values = new Float64Array(8);
  const px = new Float64Array(8);
  const py = new Float64Array(8);
  const pz = new Float64Array(8);
  // Scratch for one tetrahedron's crossing points.
  const cross: number[] = [];

  const emit = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    outX: number, outY: number, outZ: number,
  ): void => {
    // Face normal from the winding; flip the winding if it points into the rock.
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) return;
    nx /= length;
    ny /= length;
    nz /= length;
    if (nx * outX + ny * outY + nz * outZ < 0) {
      const tx = bx;
      const ty = by;
      const tz = bz;
      bx = cx;
      by = cy;
      bz = cz;
      cx = tx;
      cy = ty;
      cz = tz;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    positions.push(
      ax + offset.x, ay + offset.y, az + offset.z,
      bx + offset.x, by + offset.y, bz + offset.z,
      cx + offset.x, cy + offset.y, cz + offset.z,
    );
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const shade = shadeAt((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    shades.push(shade.crystal, shade.damage, shade.crystal, shade.damage, shade.crystal, shade.damage);
  };

  for (let k = region.minK; k < region.maxK; k += 1) {
    for (let i = region.minI; i < region.maxI; i += 1) {
      for (let j = region.minJ; j < region.maxJ; j += 1) {
        let inside = 0;
        for (let corner = 0; corner < 8; corner += 1) {
          const [ci, cj, ck] = CORNERS[corner]!;
          const value = sample(i + ci, j + cj, k + ck);
          values[corner] = value;
          if (value >= iso) inside += 1;
          px[corner] = (i + ci) * spacing;
          py[corner] = (j + cj) * spacing;
          pz[corner] = (k + ck) * spacing;
        }
        if (inside === 0 || inside === 8) continue;
        for (const tet of TETRAHEDRA) {
          const solid: number[] = [];
          const air: number[] = [];
          for (const corner of tet) {
            if (values[corner]! >= iso) solid.push(corner);
            else air.push(corner);
          }
          if (solid.length === 0 || air.length === 0) continue;
          // "Out" points from the rock corners towards the air corners.
          let outX = 0;
          let outY = 0;
          let outZ = 0;
          for (const corner of air) {
            outX += px[corner]!;
            outY += py[corner]!;
            outZ += pz[corner]!;
          }
          outX /= air.length;
          outY /= air.length;
          outZ /= air.length;
          let inX = 0;
          let inY = 0;
          let inZ = 0;
          for (const corner of solid) {
            inX += px[corner]!;
            inY += py[corner]!;
            inZ += pz[corner]!;
          }
          inX /= solid.length;
          inY /= solid.length;
          inZ /= solid.length;
          outX -= inX;
          outY -= inY;
          outZ -= inZ;

          cross.length = 0;
          const edge = (a: number, b: number): void => {
            const va = values[a]!;
            const vb = values[b]!;
            const t = (iso - va) / (vb - va);
            cross.push(
              px[a]! + (px[b]! - px[a]!) * t,
              py[a]! + (py[b]! - py[a]!) * t,
              pz[a]! + (pz[b]! - pz[a]!) * t,
            );
          };
          if (solid.length === 1 || air.length === 1) {
            const lone = solid.length === 1 ? solid[0]! : air[0]!;
            const others = solid.length === 1 ? air : solid;
            for (const other of others) edge(lone, other);
            emit(cross[0]!, cross[1]!, cross[2]!, cross[3]!, cross[4]!, cross[5]!, cross[6]!, cross[7]!, cross[8]!, outX, outY, outZ);
          } else {
            const [a, b] = solid as [number, number];
            const [c, d] = air as [number, number];
            edge(a, c); // 0
            edge(a, d); // 1
            edge(b, d); // 2
            edge(b, c); // 3
            emit(cross[0]!, cross[1]!, cross[2]!, cross[3]!, cross[4]!, cross[5]!, cross[6]!, cross[7]!, cross[8]!, outX, outY, outZ);
            emit(cross[0]!, cross[1]!, cross[2]!, cross[6]!, cross[7]!, cross[8]!, cross[9]!, cross[10]!, cross[11]!, outX, outY, outZ);
          }
        }
      }
    }
  }

  const triangleCount = positions.length / 9;
  const barycentric = new Float32Array(triangleCount * 9);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 9;
    barycentric[base] = 1;
    barycentric[base + 4] = 1;
    barycentric[base + 8] = 1;
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    barycentric,
    shade: Float32Array.from(shades),
    triangleCount,
  };
}
