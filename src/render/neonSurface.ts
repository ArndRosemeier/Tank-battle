/**
 * THE one surface seam: a dark unlit fill, emissive edge lines, a faint fresnel rim,
 * and a detail-map slot — all scaled by ONE global `SURFACE_DETAIL` scalar.
 *
 * Why a fill AND a rim at all: a `MeshBasicMaterial` in near-black has no shading, so
 * against the near-black void a wall's silhouette would disappear. The rim is a
 * fresnel term on the same geometry: almost nothing face-on, a faint identity-tinted
 * line at grazing angles. It scales with `SURFACE_DETAIL`, never with a light — this
 * is an edge-lit world, not a lit one (`docs/DESIGN.md` §9).
 *
 * ### The line-width rule
 *
 * `LineBasicMaterial.linewidth` is ignored by every current WebGL implementation
 * (the GL spec allows only 1 px for lines, and ANGLE follows it). This slice
 * deliberately keeps 1 px lines and lets UnrealBloom do the glow; a screen-space
 * line-width shader is NOT built here. Faking width by drawing several offset lines
 * would multiply draw calls and still alias. Bloom is the seam.
 *
 * ### Ownership and performance
 *
 * `createNeonSurface(parts)` TAKES OWNERSHIP of the part geometries, merges all their
 * fills into ONE `BufferGeometry` (one draw call, shared by the fill and the rim) and
 * all their edges into ONE `LineSegments` buffer. That is what makes hundreds of
 * world cells affordable: one surface call per world, not one mesh per cell.
 *
 * ### The detail budget
 *
 * The detail-map slot is UNUSED in slice A2 — no texture is loaded anywhere yet. It
 * exists so A3/A5 can add a tileable greyscale map inside §9's budget (≤ 512²,
 * multiplied at ≤ 15 %); `setSurfaceDetail` is the ONE knob that scales it. An image
 * map is never allowed to compete with the lines.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  type ColorRepresentation,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DETAIL_MAP_MAX_STRENGTH,
  NEON,
  PALETTE,
  RIM_FRESNEL_POWER,
  RIM_OPACITY_AT_FULL_DETAIL,
  SURFACE_DETAIL,
} from './config.ts';

/** One box/part of a surface: the geometry (already transformed) and its identity. */
export interface SurfacePart {
  readonly geometry: BufferGeometry;
  /** The emissive identity of this part's edges and rim. */
  readonly color: ColorRepresentation;
  /** HDR multiplier for the identity; defaults to the structural edge gain. */
  readonly gain?: number;
}

/** A loose batch of line segments merged into the surface's ONE edge buffer. */
export interface LineSegmentBatch {
  /** Interleaved `xyz` pairs — two vertices per segment. */
  readonly positions: Float32Array;
  readonly color: ColorRepresentation;
  /** HDR multiplier for the identity; defaults to the structural edge gain. */
  readonly gain?: number;
}

export interface NeonSurfaceOptions {
  /**
   * Extra line geometry that belongs to the same object's edge identity — the world's
   * hole rims are merged into the same buffer this way, so the scene pays ONE line
   * draw call for every edge in it.
   */
  readonly extraLineSegments?: readonly LineSegmentBatch[];
}

export interface NeonSurface {
  /** Fill, rim and edges. Add this to the scene. */
  readonly group: Group;
  /** `null` only for an edge-only surface (e.g. a world whose walls are all gone). */
  readonly fill: Mesh | null;
  readonly rim: Mesh | null;
  readonly edges: LineSegments;
  /** Sets the ONE global detail-map slot (unused in A2). `null` clears it. */
  setDetailTexture(texture: Texture | null): void;
  /** Frees the merged geometries. Shared materials are NEVER disposed here. */
  dispose(): void;
}

/** Shared dark fill: one material for every surface in the scene. */
const fillMaterial = new MeshBasicMaterial({ vertexColors: true });

/**
 * Shared edge material. Identity rides in the per-vertex colour attribute, so every
 * surface in the scene shares one material and one program.
 */
const edgeMaterial = new LineBasicMaterial({ vertexColors: true, linewidth: 1 });

/**
 * The fresnel rim's shader. View-space normals keep the rim independent of camera
 * roll; the vertex colour carries the identity, so the material is shared too.
 */
const rimMaterial = new ShaderMaterial({
  uniforms: {
    uOpacity: { value: RIM_OPACITY_AT_FULL_DETAIL * SURFACE_DETAIL },
    uFresnelPower: { value: RIM_FRESNEL_POWER },
    uDetailMap: { value: null as Texture | null },
    uDetailStrength: { value: DETAIL_MAP_MAX_STRENGTH * SURFACE_DETAIL },
    uHasDetail: { value: 0 },
  },
  vertexShader: /* glsl */ `
    attribute vec3 aIdentity;
    varying vec3 vIdentity;
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;
    varying vec2 vUv;

    void main() {
      vIdentity = aIdentity;
      vUv = uv;
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = viewPosition.xyz;
      vViewNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * viewPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    uniform float uFresnelPower;
    uniform sampler2D uDetailMap;
    uniform float uDetailStrength;
    uniform float uHasDetail;

    varying vec3 vIdentity;
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;
    varying vec2 vUv;

    void main() {
      vec3 normal = normalize(vViewNormal);
      vec3 viewDirection = normalize(-vViewPosition);
      float fresnel = pow(1.0 - clamp(abs(dot(normal, viewDirection)), 0.0, 1.0), uFresnelPower);

      vec3 tint = vIdentity;
      if (uHasDetail > 0.5) {
        // Greyscale, low frequency, multiplied at a budgeted strength (§9).
        float detail = texture2D(uDetailMap, vUv).r;
        tint *= mix(1.0, detail, uDetailStrength);
      }

      float rim = fresnel * uOpacity;
      // Additive, depth-tested, depth-write-off: a silhouette brightener, no fill.
      gl_FragColor = vec4(tint * rim, 1.0);
    }
  `,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
});

/** The running global surface-detail scalar. */
let surfaceDetail = SURFACE_DETAIL;

/**
 * THE one function that moves the global surface-detail scalar. It scales the fresnel
 * rim (c) and the detail-map slot (d), never the edge lines — lines dominate, always.
 * Out-of-range values throw instead of clamping silently.
 */
export function setSurfaceDetail(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`neonSurface: surface detail must be finite and within 0…1, got ${value}`);
  }
  surfaceDetail = value;
  rimMaterial.uniforms.uOpacity!.value = RIM_OPACITY_AT_FULL_DETAIL * value;
  rimMaterial.uniforms.uDetailStrength!.value = DETAIL_MAP_MAX_STRENGTH * value;
}

/** The running scalar (`SURFACE_DETAIL` until `setSurfaceDetail` is called). */
export function getSurfaceDetail(): number {
  return surfaceDetail;
}

/** Sets the ONE global detail-map slot. Reserved for the §9-budgeted texture pass. */
export function setDetailTexture(texture: Texture | null): void {
  rimMaterial.uniforms.uDetailMap!.value = texture;
  rimMaterial.uniforms.uHasDetail!.value = texture ? 1 : 0;
}

/** The gradient's height scale: a 4 m rise reaches the top of the fill band. */
const FILL_GRADIENT_HEIGHT_METRES = 4;

/** The linear fill colours for the vertical surface gradient (bottom → top). */
const fillBottom = new Color(PALETTE.surfaceFill);
const fillTop = new Color(PALETTE.surfaceFillTop);

/**
 * A near-black vertical gradient in the fill's `color` attribute. This is §9's
 * "procedural first" hint of surface detail: no texture, low frequency, and it keeps
 * a tall dark wall from being a flat silhouette between its edge lines.
 */
function applyFillGradient(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position');
  if (!position) {
    throw new Error('neonSurface: a part geometry has no position attribute');
  }
  const values = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const height = position.getY(index);
    const t = Math.min(1, Math.max(0, height / FILL_GRADIENT_HEIGHT_METRES));
    values[index * 3] = fillBottom.r + (fillTop.r - fillBottom.r) * t;
    values[index * 3 + 1] = fillBottom.g + (fillTop.g - fillBottom.g) * t;
    values[index * 3 + 2] = fillBottom.b + (fillTop.b - fillBottom.b) * t;
  }
  geometry.setAttribute('color', new BufferAttribute(values, 3));
  return geometry;
}

/** Fills a geometry's colour attribute with one linear identity, scaled by `gain`. */
function colorize(
  geometry: BufferGeometry,
  color: ColorRepresentation,
  gain: number,
): BufferGeometry {
  const position = geometry.getAttribute('position');
  if (!position) {
    throw new Error('neonSurface: a part geometry has no position attribute');
  }
  const linear = new Color(color).multiplyScalar(gain);
  const values = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    values[index * 3] = linear.r;
    values[index * 3 + 1] = linear.g;
    values[index * 3 + 2] = linear.b;
  }
  geometry.setAttribute('color', new BufferAttribute(values, 3));
  return geometry;
}

const EDGE_THRESHOLD_DEGREES = 1;

/**
 * The factory. Merges every part into ONE fill geometry, ONE rim drawing of it and
 * ONE edge buffer; returns the group plus the three objects for the scene.
 *
 * The caller gives up ownership of `parts[].geometry`; the returned surface disposes
 * the merged buffers and leaves the shared materials alone.
 */
export function createNeonSurface(
  parts: readonly SurfacePart[],
  options: NeonSurfaceOptions = {},
): NeonSurface {
  const hasLines = (options.extraLineSegments ?? []).length > 0;
  if (parts.length === 0 && !hasLines) {
    throw new Error('neonSurface: a surface needs a part geometry or at least one line batch');
  }

  const bodyParts: BufferGeometry[] = [];
  const edgeParts: BufferGeometry[] = [];
  for (const part of parts) {
    const gain = part.gain ?? NEON.structureEdgeGain;
    // The fill carries a dark gradient in `color`; the rim and edges carry the
    // identity in `aIdentity`/`color` respectively, so all three can share one buffer.
    const body = applyFillGradient(part.geometry);
    const identity = new Float32Array(body.getAttribute('position').count * 3);
    const linear = new Color(part.color).multiplyScalar(gain);
    for (let index = 0; index < identity.length; index += 3) {
      identity[index] = linear.r;
      identity[index + 1] = linear.g;
      identity[index + 2] = linear.b;
    }
    body.setAttribute('aIdentity', new BufferAttribute(identity, 3));

    const edge = colorize(new EdgesGeometry(body, EDGE_THRESHOLD_DEGREES), part.color, gain);
    bodyParts.push(body);
    edgeParts.push(edge);
  }

  for (const batch of options.extraLineSegments ?? []) {
    if (batch.positions.length === 0 || batch.positions.length % 6 !== 0) {
      throw new Error(
        `neonSurface: a line batch must hold whole xyz pairs (length % 6 === 0), got ${batch.positions.length}`,
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(batch.positions.slice(), 3));
    colorize(geometry, batch.color, batch.gain ?? NEON.structureEdgeGain);
    edgeParts.push(geometry);
  }

  const bodyGeometry = bodyParts.length > 0 ? mergeGeometries(bodyParts, false) : null;
  const edgeGeometry = edgeParts.length > 0 ? mergeGeometries(edgeParts, false) : null;
  if (edgeGeometry === null) {
    throw new Error('neonSurface: merging the surface edge geometries failed');
  }
  if (bodyParts.length > 0 && bodyGeometry === null) {
    throw new Error('neonSurface: merging the surface body geometries failed');
  }

  // The source geometries only existed to build the merged buffers.
  for (const geometry of bodyParts) geometry.dispose();
  for (const geometry of edgeParts) geometry.dispose();

  let fill: Mesh | null = null;
  let rim: Mesh | null = null;
  if (bodyGeometry) {
    fill = new Mesh(bodyGeometry, fillMaterial);
    fill.name = 'neon-fill';
    // The rim reuses the fill's geometry: one uploaded vertex buffer, two draw calls.
    rim = new Mesh(bodyGeometry, rimMaterial);
    rim.name = 'neon-rim';
  }
  const edges = new LineSegments(edgeGeometry, edgeMaterial);
  edges.name = 'neon-edges';

  const group = new Group();
  group.name = 'neon-surface';
  if (fill) group.add(fill);
  if (rim) group.add(rim);
  group.add(edges);

  let disposed = false;
  return {
    group,
    fill,
    rim,
    edges,
    setDetailTexture,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      bodyGeometry?.dispose();
      edgeGeometry.dispose();
    },
  };
}
