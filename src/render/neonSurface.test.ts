import { BoxGeometry, LineSegments, Mesh, MeshBasicMaterial, ShaderMaterial } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PALETTE,
  RIM_OPACITY_AT_FULL_DETAIL,
  SURFACE_DETAIL,
} from './config.ts';
import { createNeonSurface, getSurfaceDetail, setSurfaceDetail } from './neonSurface.ts';

// The scalar is module-global on purpose; each test restores the documented default.
afterEach(() => {
  setSurfaceDetail(SURFACE_DETAIL);
});

describe('neonSurface', () => {
  it('SURFACE_DETAIL defaults to 0.3 and can be set to 0 and back by one function', () => {
    expect(SURFACE_DETAIL).toBe(0.3);
    expect(getSurfaceDetail()).toBe(SURFACE_DETAIL);

    const surface = createNeonSurface([
      { geometry: new BoxGeometry(1, 1, 1), color: PALETTE.team[0] },
    ]);
    const material = surface.rim?.material;
    expect(material).toBeInstanceOf(ShaderMaterial);
    const uniforms = (material as ShaderMaterial).uniforms;
    expect(uniforms.uOpacity!.value).toBeCloseTo(RIM_OPACITY_AT_FULL_DETAIL * SURFACE_DETAIL);

    // One function moves the global scalar, and the rim material follows it.
    setSurfaceDetail(0);
    expect(getSurfaceDetail()).toBe(0);
    expect(uniforms.uOpacity!.value).toBe(0);
    expect(uniforms.uDetailStrength!.value).toBe(0);

    setSurfaceDetail(SURFACE_DETAIL);
    expect(getSurfaceDetail()).toBe(SURFACE_DETAIL);
    expect(uniforms.uOpacity!.value).toBeCloseTo(RIM_OPACITY_AT_FULL_DETAIL * SURFACE_DETAIL);

    // Out-of-range values are rejected, never silently clamped.
    expect(() => setSurfaceDetail(-0.001)).toThrow(/0…1/);
    expect(() => setSurfaceDetail(1.001)).toThrow(/0…1/);
    expect(() => setSurfaceDetail(Number.NaN)).toThrow(/0…1/);

    surface.dispose();
  });

  it('the fill is polygon-offset so a coincident edge line cannot be depth-rejected (D1)', () => {
    const surface = createNeonSurface([
      { geometry: new BoxGeometry(1, 1, 1), color: PALETTE.team[0] },
    ]);
    const fill = surface.fill?.material;
    expect(fill).toBeInstanceOf(MeshBasicMaterial);
    const material = fill as MeshBasicMaterial;
    // Without this the line fragments and the fill triangles have equal depth and the
    // line loses in a dotted pattern (the A2 defect D1). Positive units push the fill
    // AWAY from the camera, so the line always wins.
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeGreaterThan(0);
    expect(material.polygonOffsetUnits).toBeGreaterThan(0);
    surface.dispose();
  });

  it('a surface merges its parts into one fill geometry and one edge buffer', () => {
    const surface = createNeonSurface([
      { geometry: new BoxGeometry(1, 1, 1), color: PALETTE.team[1] },
      { geometry: new BoxGeometry(1, 2, 1), color: PALETTE.team[2] },
      { geometry: new BoxGeometry(2, 1, 3), color: PALETTE.team[3] },
    ]);

    const fill = surface.fill;
    const rim = surface.rim;
    expect(fill).not.toBeNull();
    expect(rim).not.toBeNull();
    // Three boxes at 24 vertices each, merged into one buffer.
    expect(fill!.geometry.getAttribute('position').count).toBe(3 * 24);
    // The rim reuses the fill geometry: one upload, two draw calls.
    expect(rim!.geometry).toBe(fill!.geometry);

    const meshes = surface.group.children.filter((child) => child instanceof Mesh);
    const lines = surface.group.children.filter((child) => child instanceof LineSegments);
    expect(meshes).toHaveLength(2);
    expect(lines).toHaveLength(1);

    // Every vertex carries its part's identity, so identity is data in the buffer.
    const colors = fill!.geometry.getAttribute('color');
    expect(colors).toBeDefined();
    expect(colors.count).toBe(fill!.geometry.getAttribute('position').count);

    surface.dispose();
  });
});
