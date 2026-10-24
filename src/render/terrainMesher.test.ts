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
});
