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
 * ### Which edges glow
 *
 * Most triangle edges are bookkeeping, not shape: the cuts of the six tetrahedra
 * through a cell's interior and the diagonal that splits a four-crossing quad. Drawn,
 * they are lines that wander with the surface height (a flat floor gets a star of
 * diagonals in every cell) and they double up as near-parallel slivers. So an edge
 * glows only when it lies on a cell face, where neighbouring cells agree and the lines
 * form one steady lattice, or when the surface really bends across it (a crease
 * sharper than `CREASE_DEGREES`). Crossings within a small fraction of a lattice
 * corner are snapped onto it, which removes the hair-thin sliver triangles.
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
  /**
   * Which of the triangle's edges glow, per vertex (the same on all three): component
   * `n` is 1 when the edge opposite corner `n` is drawn, 0 when it is hidden.
   */
  readonly edgeMask: Float32Array;
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

/** An interior edge glows only when its two faces meet at more than this angle. */
export const CREASE_DEGREES = 28;
const CREASE_COS = Math.cos((CREASE_DEGREES * Math.PI) / 180);

/** Crossings this close to a lattice corner (as a fraction of the edge) snap onto it. */
export const SNAP_FRACTION = 0.08;

/** True when the three cube corners share a coordinate, i.e. lie on one cell face. */
function onCellFace(a: number, b: number, c: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    const value = CORNERS[a]![axis]!;
    if (CORNERS[b]![axis] === value && CORNERS[c]![axis] === value) return true;
  }
  return false;
}

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
  /** Per triangle: is the edge opposite corner 0/1/2 on a cell face (1) or interior (0)? */
  const faceEdges: number[] = [];
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
    // Edges a→b, b→c, c→a: on a cell face?
    faceAB: boolean, faceBC: boolean, faceCA: boolean,
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
      // b and c swapped: a→b is now a→c, and c→a is now b→a.
      const t = faceAB;
      faceAB = faceCA;
      faceCA = t;
    }
    // Opposite corner a is edge b→c, opposite b is c→a, opposite c is a→b.
    faceEdges.push(faceBC ? 1 : 0, faceCA ? 1 : 0, faceAB ? 1 : 0);
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
            let t = (iso - va) / (vb - va);
            if (t < SNAP_FRACTION) t = 0;
            else if (t > 1 - SNAP_FRACTION) t = 1;
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
            const [o0, o1, o2] = others as [number, number, number];
            emit(
              cross[0]!, cross[1]!, cross[2]!, cross[3]!, cross[4]!, cross[5]!, cross[6]!, cross[7]!, cross[8]!,
              outX, outY, outZ,
              onCellFace(lone, o0, o1), onCellFace(lone, o1, o2), onCellFace(lone, o2, o0),
            );
          } else {
            const [a, b] = solid as [number, number];
            const [c, d] = air as [number, number];
            edge(a, c); // 0
            edge(a, d); // 1
            edge(b, d); // 2
            edge(b, c); // 3
            // Crossing 0 (a-c) and 2 (b-d) span the quad's diagonal: never a cell face.
            emit(
              cross[0]!, cross[1]!, cross[2]!, cross[3]!, cross[4]!, cross[5]!, cross[6]!, cross[7]!, cross[8]!,
              outX, outY, outZ,
              onCellFace(a, c, d), onCellFace(a, b, d), false,
            );
            emit(
              cross[0]!, cross[1]!, cross[2]!, cross[6]!, cross[7]!, cross[8]!, cross[9]!, cross[10]!, cross[11]!,
              outX, outY, outZ,
              false, onCellFace(b, c, d), onCellFace(a, b, c),
            );
          }
        }
      }
    }
  }

  const triangleCount = positions.length / 9;
  const edgeMask = edgeMaskFor(positions, normals, faceEdges, triangleCount);
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
    edgeMask,
    triangleCount,
  };
}

/** Rounds a coordinate so the two triangles sharing an edge agree on its key. */
function quantize(value: number): number {
  return Math.round(value * 1e4);
}

/**
 * Decides which edges glow: cell-face edges always; interior edges only where the two
 * triangles sharing them meet at a crease. Interior edges never cross a cell face, so
 * their neighbour is always in the same mesh.
 */
function edgeMaskFor(
  positions: readonly number[],
  normals: readonly number[],
  faceEdges: readonly number[],
  triangleCount: number,
): Float32Array {
  const mask = new Float32Array(triangleCount * 9);
  const pending = new Map<string, number>();
  const vertexKey = (vertex: number): string =>
    `${quantize(positions[vertex * 3]!)},${quantize(positions[vertex * 3 + 1]!)},${quantize(positions[vertex * 3 + 2]!)}`;
  const set = (triangle: number, corner: number, value: number): void => {
    for (let vertex = 0; vertex < 3; vertex += 1) mask[triangle * 9 + vertex * 3 + corner] = value;
  };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      if (faceEdges[triangle * 3 + corner] === 1) {
        set(triangle, corner, 1);
        continue;
      }
      const a = vertexKey(triangle * 3 + ((corner + 1) % 3));
      const b = vertexKey(triangle * 3 + ((corner + 2) % 3));
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = pending.get(key);
      if (other === undefined) {
        pending.set(key, triangle * 3 + corner);
        continue;
      }
      pending.delete(key);
      const otherTriangle = Math.floor(other / 3);
      const n = triangle * 9;
      const m = otherTriangle * 9;
      const cos = normals[n]! * normals[m]! + normals[n + 1]! * normals[m + 1]! + normals[n + 2]! * normals[m + 2]!;
      const value = cos < CREASE_COS ? 1 : 0;
      set(triangle, corner, value);
      set(otherTriangle, other % 3, value);
    }
  }
  // An interior edge with no partner is an open border: keep it visible.
  for (const entry of pending.values()) set(Math.floor(entry / 3), entry % 3, 1);
  return mask;
}
