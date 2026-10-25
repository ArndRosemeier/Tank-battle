import { describe, expect, it } from 'vitest';
import { meshTerrain, type DensitySampler } from './terrainMesher.ts';

const ISO = 128;
const SPACING = 1.5;
const N = 12;

/** A ball of rock floating in air: a closed surface with no lattice boundary. */
function ball(radius: number): DensitySampler {
  const c = (N / 2) * SPACING;
  return (i, j, k) => {
    const d = Math.hypot(i * SPACING - c, j * SPACING - c, k * SPACING - c);
    return Math.max(0, Math.min(255, Math.round(ISO + ((radius - d) * ISO) / SPACING)));
  };
}

const ALL = { minI: 0, maxI: N, minJ: 0, maxJ: N, minK: 0, maxK: N };
const plain = () => ({ crystal: 0, damage: 0 });

function key(p: Float32Array, v: number): string {
  return `${p[v * 3]!.toFixed(4)},${p[v * 3 + 1]!.toFixed(4)},${p[v * 3 + 2]!.toFixed(4)}`;
}

describe('the marching-tetrahedra mesher', () => {
  it('meshes a closed body watertight: every edge is shared by exactly two triangles', () => {
    const mesh = meshTerrain(ball(5), ALL, SPACING, ISO, plain);
    expect(mesh.triangleCount).toBeGreaterThan(100);
    const edges = new Map<string, number>();
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      const corners = [key(mesh.positions, t * 3), key(mesh.positions, t * 3 + 1), key(mesh.positions, t * 3 + 2)];
      for (let e = 0; e < 3; e += 1) {
        const a = corners[e]!;
        const b = corners[(e + 1) % 3]!;
        if (a === b) continue;
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    const counts = new Set(edges.values());
    expect([...counts]).toEqual([2]);
  });

  it('winds every face outwards, from rock into air', () => {
    const mesh = meshTerrain(ball(5), ALL, SPACING, ISO, plain);
    const c = (N / 2) * SPACING;
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      const v = t * 9;
      const cx = (mesh.positions[v]! + mesh.positions[v + 3]! + mesh.positions[v + 6]!) / 3 - c;
      const cy = (mesh.positions[v + 1]! + mesh.positions[v + 4]! + mesh.positions[v + 7]!) / 3 - c;
      const cz = (mesh.positions[v + 2]! + mesh.positions[v + 5]! + mesh.positions[v + 8]!) / 3 - c;
      const dot = cx * mesh.normals[v]! + cy * mesh.normals[v + 1]! + cz * mesh.normals[v + 2]!;
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('carries per-vertex barycentric corners and the shading the caller asked for', () => {
    const mesh = meshTerrain(ball(4), ALL, SPACING, ISO, () => ({ crystal: 1, damage: 0.5 }), { x: 0, y: -2, z: 0 });
    expect(mesh.barycentric.length).toBe(mesh.triangleCount * 9);
    expect(Array.from(mesh.barycentric.slice(0, 9))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(mesh.shade.slice(0, 2))).toEqual([1, 0.5]);
    const unshifted = meshTerrain(ball(4), ALL, SPACING, ISO, plain);
    expect(mesh.positions[1]! - unshifted.positions[1]!).toBeCloseTo(-2, 5);
  });

  it('emits nothing for solid rock or open air', () => {
    expect(meshTerrain(() => 255, ALL, SPACING, ISO, plain).triangleCount).toBe(0);
    expect(meshTerrain(() => 0, ALL, SPACING, ISO, plain).triangleCount).toBe(0);
  });

  /** Every drawn edge of `mesh` as a pair of endpoints. */
  function drawnEdges(mesh: ReturnType<typeof meshTerrain>): [number[], number[]][] {
    const result: [number[], number[]][] = [];
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        if (mesh.edgeMask[t * 9 + corner] !== 1) continue;
        const a = (t * 3 + ((corner + 1) % 3)) * 3;
        const b = (t * 3 + ((corner + 2) % 3)) * 3;
        result.push([
          [mesh.positions[a]!, mesh.positions[a + 1]!, mesh.positions[a + 2]!],
          [mesh.positions[b]!, mesh.positions[b + 1]!, mesh.positions[b + 2]!],
        ]);
      }
    }
    return result;
  }

  it('draws a flat floor as a steady lattice: every drawn edge runs along a cell face', () => {
    // A floor at 4.1 m, between two sample rows: the height a star of interior cuts would show.
    for (const height of [4.1, 4.5, 5.2]) {
      const floor: DensitySampler = (_i, j) =>
        Math.max(0, Math.min(255, Math.round(ISO + ((height - j * SPACING) * ISO) / SPACING)));
      const mesh = meshTerrain(floor, { minI: 1, maxI: N - 1, minJ: 0, maxJ: N - 1, minK: 1, maxK: N - 1 }, SPACING, ISO, plain);
      const edges = drawnEdges(mesh);
      expect(edges.length).toBeGreaterThan(0);
      for (const [a, b] of edges) {
        const onX = Math.abs(a[0]! - b[0]!) < 1e-4 && Math.abs(a[0]! / SPACING - Math.round(a[0]! / SPACING)) < 1e-4;
        const onZ = Math.abs(a[2]! - b[2]!) < 1e-4 && Math.abs(a[2]! / SPACING - Math.round(a[2]! / SPACING)) < 1e-4;
        expect(onX || onZ).toBe(true);
      }
    }
  });

  it('hides the internal cuts but keeps sharp creases', () => {
    const mesh = meshTerrain(ball(5), ALL, SPACING, ISO, plain);
    let hidden = 0;
    let shown = 0;
    for (let t = 0; t < mesh.triangleCount; t += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const value = mesh.edgeMask[t * 9 + corner]!;
        // The mask is the same on all three vertices of a triangle.
        expect(mesh.edgeMask[t * 9 + 3 + corner]).toBe(value);
        expect(mesh.edgeMask[t * 9 + 6 + corner]).toBe(value);
        if (value === 1) shown += 1;
        else hidden += 1;
      }
    }
    expect(hidden).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(0);

    // A box with a sharp 90° edge keeps every crease edge lit.
    const box: DensitySampler = (i, j, k) => (i >= 3 && i <= 8 && j >= 3 && j <= 8 && k >= 3 && k <= 8 ? 200 : 40);
    const boxMesh = meshTerrain(box, ALL, SPACING, ISO, plain);
    for (let t = 0; t < boxMesh.triangleCount; t += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        if (boxMesh.edgeMask[t * 9 + corner] === 1) continue;
        // A hidden edge must sit between two nearly coplanar faces; find its partner.
        const a = (t * 3 + ((corner + 1) % 3)) * 3;
        const b = (t * 3 + ((corner + 2) % 3)) * 3;
        let partnerFound = false;
        for (let u = 0; u < boxMesh.triangleCount && !partnerFound; u += 1) {
          if (u === t) continue;
          const vs = [0, 1, 2].map((v) => (u * 3 + v) * 3);
          const has = (p: number) =>
            vs.some((q) => Math.abs(boxMesh.positions[q]! - boxMesh.positions[p]!) + Math.abs(boxMesh.positions[q + 1]! - boxMesh.positions[p + 1]!) + Math.abs(boxMesh.positions[q + 2]! - boxMesh.positions[p + 2]!) < 1e-4);
          if (!has(a) || !has(b)) continue;
          partnerFound = true;
          const dot =
            boxMesh.normals[t * 9]! * boxMesh.normals[u * 9]! +
            boxMesh.normals[t * 9 + 1]! * boxMesh.normals[u * 9 + 1]! +
            boxMesh.normals[t * 9 + 2]! * boxMesh.normals[u * 9 + 2]!;
          expect(dot).toBeGreaterThan(Math.cos((30 * Math.PI) / 180));
        }
        expect(partnerFound).toBe(true);
      }
    }
  });
});
