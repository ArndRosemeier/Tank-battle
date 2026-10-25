/**
 * The triangle landscape on screen: the terrain lattice meshed by marching tetrahedra
 * (`terrainMesher.ts`) into one mesh per column of render blocks, plus one mesh per
 * falling chunk.
 *
 * A block column is re-meshed only when the world bumped one of its block revisions,
 * so a crater costs a handful of small re-meshes, never the whole arena. Every mesh
 * shares ONE shader: a dark facet, an anti-aliased glowing edge on every drawn triangle edge
 * (barycentric distance with screen-space derivatives), a height ramp from cyan to
 * magenta, hot crystal, amber wounds where the rock differs from the authored
 * landscape, the glow clock's pulse ring and breathing, and distance fog.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three';
import {
  DENSITY_ISO,
  DENSITY_MAX,
  MATERIAL_CRYSTAL,
  RENDER_BLOCK_CELLS,
  sampleCoordinates,
  type FallingChunk,
  type World,
} from '../core/world.ts';
import { FOG, GLOW, PALETTE, TERRAIN, TERRAIN_PALETTE } from './config.ts';
import { GLOW_UNIFORMS } from './glowClock.ts';
import { meshTerrain, type TerrainMeshData, type TriangleShade } from './terrainMesher.ts';

export interface TerrainView {
  readonly group: Group;
  /** Re-meshes changed block columns and syncs falling chunks. Returns columns re-meshed. */
  sync(): number;
  /** Triangles currently drawn (static terrain + chunks). */
  triangleCount(): number;
  dispose(): void;
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aBary;
  attribute vec2 aShade;
  attribute vec3 aEdgeMask;
  varying vec3 vBary;
  varying vec3 vEdgeMask;
  varying vec2 vShade;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;

  void main() {
    vBary = aBary;
    vEdgeMask = aEdgeMask;
    vShade = aShade;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uFill;
  uniform vec3 uEdgeLow;
  uniform vec3 uEdgeHigh;
  uniform vec3 uCrystal;
  uniform vec3 uDamage;
  uniform vec3 uFogColor;
  uniform float uLowY;
  uniform float uHighY;
  uniform float uEdgeWidth;
  uniform float uEdgeGain;
  uniform float uCrystalGain;
  uniform float uDamageGain;
  uniform float uFillTint;
  uniform float uRim;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uGlowTime;
  uniform float uGlowPulse;
  uniform vec2 uCentreXZ;
  uniform float uPulseSpeed;
  uniform float uPulsePeriod;
  uniform float uPulseWidth;
  uniform float uPulseGain;
  uniform float uBreathePeriod;
  uniform float uBreatheDepth;
  uniform float uSpacing;

  varying vec3 vBary;
  varying vec3 vEdgeMask;
  varying vec2 vShade;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;

  void main() {
    // Distance to the nearest triangle edge, in pixels.
    vec3 width = fwidth(vBary);
    vec3 edgeDistance = vBary / max(width, vec3(1e-6));
    // Hidden edges (the mesher's internal cuts) are pushed out of reach.
    edgeDistance += (1.0 - step(0.5, vEdgeMask)) * 1e6;
    float nearest = min(min(edgeDistance.x, edgeDistance.y), edgeDistance.z);

    // Flat floors and walls show the lattice as squares; one diagonal per square, drawn
    // in world space through the lattice corners, turns them into a steady triangle grid.
    vec3 axisNormal = abs(normalize(vNormal));
    vec3 diagonal = vec3(
      vWorldPosition.y - vWorldPosition.z,
      vWorldPosition.x - vWorldPosition.z,
      vWorldPosition.y - vWorldPosition.x
    ) / uSpacing;
    vec3 diagonalDistance = abs(fract(diagonal + 0.5) - 0.5) / max(fwidth(diagonal), vec3(1e-6));
    diagonalDistance += (1.0 - smoothstep(0.75, 0.9, axisNormal)) * 1e6;
    nearest = min(nearest, min(min(diagonalDistance.x, diagonalDistance.y), diagonalDistance.z));
    float edge = 1.0 - smoothstep(0.0, uEdgeWidth, nearest);

    float heightT = clamp((vWorldPosition.y - uLowY) / (uHighY - uLowY), 0.0, 1.0);
    vec3 hue = mix(uEdgeLow, uEdgeHigh, heightT) * uEdgeGain;
    hue = mix(hue, uCrystal * uCrystalGain, vShade.x);
    hue = mix(hue, uDamage * uDamageGain, clamp(vShade.y, 0.0, 1.0));

    float breathe = 1.0 + uGlowPulse * uBreatheDepth * sin(6.2831853 * uGlowTime / uBreathePeriod);
    float ringRadius = mod(uGlowTime, uPulsePeriod) * uPulseSpeed;
    float ringOffset = (distance(vWorldPosition.xz, uCentreXZ) - ringRadius) / uPulseWidth;
    float ring = uGlowPulse * exp(-ringOffset * ringOffset);

    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float grazing = 1.0 - clamp(abs(dot(normal, viewDirection)), 0.0, 1.0);

    vec3 color = uFill + hue * uFillTint * (0.6 + 0.4 * normal.y);
    color += hue * pow(grazing, 3.0) * uRim;
    color += hue * edge * breathe * (1.0 + ring * uPulseGain);
    color += hue * ring * 0.04;

    float distanceToCamera = distance(vWorldPosition, cameraPosition);
    color = mix(color, uFogColor, smoothstep(uFogNear, uFogFar, distanceToCamera));
    gl_FragColor = vec4(color, 1.0);
  }
`;

function createTerrainMaterial(centreX: number, centreZ: number, spacing: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uFill: { value: new Color(TERRAIN_PALETTE.fill) },
      uEdgeLow: { value: new Color(TERRAIN_PALETTE.edgeLow) },
      uEdgeHigh: { value: new Color(TERRAIN_PALETTE.edgeHigh) },
      uCrystal: { value: new Color(TERRAIN_PALETTE.crystal) },
      uDamage: { value: new Color(TERRAIN_PALETTE.damage) },
      uFogColor: { value: new Color(PALETTE.background) },
      uLowY: { value: TERRAIN.lowHeightMetres },
      uHighY: { value: TERRAIN.highHeightMetres },
      uEdgeWidth: { value: TERRAIN.edgeWidthPixels },
      uSpacing: { value: spacing },
      uEdgeGain: { value: TERRAIN.edgeGain },
      uCrystalGain: { value: TERRAIN.crystalEdgeGain },
      uDamageGain: { value: TERRAIN.damageEdgeGain },
      uFillTint: { value: TERRAIN.fillTint },
      uRim: { value: TERRAIN.rimStrength },
      uFogNear: { value: FOG.nearMetres },
      uFogFar: { value: FOG.farMetres },
      uGlowTime: GLOW_UNIFORMS.uGlowTime,
      uGlowPulse: GLOW_UNIFORMS.uGlowPulse,
      uCentreXZ: { value: new Vector2(centreX, centreZ) },
      uPulseSpeed: { value: GLOW.pulseSpeedMetresPerSecond },
      uPulsePeriod: { value: GLOW.pulsePeriodSeconds },
      uPulseWidth: { value: GLOW.pulseWidthMetres },
      uPulseGain: { value: GLOW.pulseGain },
      uBreathePeriod: { value: GLOW.breathePeriodSeconds },
      uBreatheDepth: { value: GLOW.breatheDepth },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
}

function geometryFrom(data: TerrainMeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geometry.setAttribute('aBary', new BufferAttribute(data.barycentric, 3));
  geometry.setAttribute('aShade', new BufferAttribute(data.shade, 2));
  geometry.setAttribute('aEdgeMask', new BufferAttribute(data.edgeMask, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** World density with the lattice's outside rules (solid below, air above and around). */
function worldSampler(world: World): (i: number, j: number, k: number) => number {
  const { nx, ny, nz, density } = world;
  return (i, j, k) => {
    if (j < 0) return DENSITY_MAX;
    if (j >= ny || i < 0 || k < 0 || i >= nx || k >= nz) return 0;
    return density[j + ny * (i + nx * k)]!;
  };
}

/** Shading for a static triangle: crystal if a solid corner of its cell is crystal; damage from the regen target. */
function worldShade(world: World): (x: number, y: number, z: number) => TriangleShade {
  const { nx, ny, nz, density, target, material } = world;
  const s = world.spacing;
  return (x, y, z) => {
    const fi = x / s;
    const fj = y / s;
    const fk = z / s;
    const i0 = Math.max(0, Math.min(nx - 2, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(ny - 2, Math.floor(fj)));
    const k0 = Math.max(0, Math.min(nz - 2, Math.floor(fk)));
    let crystal = 0;
    let difference = 0;
    let weightSum = 0;
    for (let dk = 0; dk <= 1; dk += 1) {
      for (let di = 0; di <= 1; di += 1) {
        for (let dj = 0; dj <= 1; dj += 1) {
          const index = j0 + dj + ny * (i0 + di + nx * (k0 + dk));
          if (density[index]! >= DENSITY_ISO && material[index] === MATERIAL_CRYSTAL) crystal = 1;
          const weight =
            (di ? fi - i0 : 1 - (fi - i0)) * (dj ? fj - j0 : 1 - (fj - j0)) * (dk ? fk - k0 : 1 - (fk - k0));
          const w = Math.max(0, weight);
          difference += Math.abs(target[index]! - density[index]!) * w;
          weightSum += w;
        }
      }
    }
    const damage = Math.min(1, (weightSum > 0 ? difference / weightSum : 0) / 110);
    return { crystal, damage };
  };
}

export function createTerrainView(world: World): TerrainView {
  const group = new Group();
  group.name = 'terrain';
  const material = createTerrainMaterial(world.widthMetres / 2, world.depthMetres / 2, world.spacing);
  const sample = worldSampler(world);
  const shade = worldShade(world);
  const cellsX = world.nx - 1;
  const cellsY = world.ny - 1;
  const cellsZ = world.nz - 1;

  interface ColumnMesh {
    mesh: Mesh | null;
    revisions: number[];
    triangles: number;
  }
  const columns: ColumnMesh[] = [];
  for (let index = 0; index < world.blocksX * world.blocksZ; index += 1) {
    columns.push({ mesh: null, revisions: [], triangles: 0 });
  }

  const columnRevisions = (bx: number, bz: number): number[] => {
    const result: number[] = [];
    for (let by = 0; by < world.blocksY; by += 1) {
      result.push(world.blockRevisions[bx + world.blocksX * (by + world.blocksY * bz)]!);
    }
    return result;
  };

  const meshColumn = (bx: number, bz: number): void => {
    const column = columns[bx + world.blocksX * bz]!;
    if (column.mesh) {
      column.mesh.geometry.dispose();
      group.remove(column.mesh);
      column.mesh = null;
    }
    // The outermost block columns also mesh the padding cell beyond the lattice, which
    // closes the arena's sides.
    const region = {
      minI: bx === 0 ? -1 : bx * RENDER_BLOCK_CELLS,
      maxI: bx === world.blocksX - 1 ? cellsX + 1 : Math.min(cellsX, (bx + 1) * RENDER_BLOCK_CELLS),
      minJ: 0,
      maxJ: cellsY + 1,
      minK: bz === 0 ? -1 : bz * RENDER_BLOCK_CELLS,
      maxK: bz === world.blocksZ - 1 ? cellsZ + 1 : Math.min(cellsZ, (bz + 1) * RENDER_BLOCK_CELLS),
    };
    const data = meshTerrain(sample, region, world.spacing, DENSITY_ISO, shade);
    column.revisions = columnRevisions(bx, bz);
    column.triangles = data.triangleCount;
    if (data.triangleCount === 0) return;
    const mesh = new Mesh(geometryFrom(data), material);
    mesh.name = `terrain-${bx}-${bz}`;
    group.add(mesh);
    column.mesh = mesh;
  };

  interface ChunkMesh {
    readonly mesh: Mesh;
    readonly chunk: FallingChunk;
    readonly triangles: number;
  }
  const chunkMeshes = new Map<number, ChunkMesh>();

  const meshChunk = (chunk: FallingChunk): ChunkMesh | null => {
    const width = chunk.maxI - chunk.minI + 3;
    const height = chunk.maxJ - chunk.minJ + 3;
    const depth = chunk.maxK - chunk.minK + 3;
    const local = new Uint8Array(width * height * depth);
    for (let n = 0; n < chunk.samples.length; n += 1) {
      const { i, j, k } = sampleCoordinates(world, chunk.samples[n]!);
      local[j - chunk.minJ + 1 + height * (i - chunk.minI + 1 + width * (k - chunk.minK + 1))] = chunk.densities[n]!;
    }
    const localSample = (i: number, j: number, k: number): number =>
      i < 0 || j < 0 || k < 0 || i >= width || j >= height || k >= depth ? 0 : local[j + height * (i + width * k)]!;
    const s = world.spacing;
    const crystal = chunk.materials.some((value) => value === MATERIAL_CRYSTAL) ? 1 : 0;
    const data = meshTerrain(
      localSample,
      { minI: 0, maxI: width - 1, minJ: 0, maxJ: height - 1, minK: 0, maxK: depth - 1 },
      s,
      DENSITY_ISO,
      () => ({ crystal, damage: TERRAIN.chunkDamage }),
      { x: (chunk.minI - 1) * s, y: (chunk.minJ - 1) * s, z: (chunk.minK - 1) * s },
    );
    if (data.triangleCount === 0) return null;
    const mesh = new Mesh(geometryFrom(data), material);
    mesh.name = `chunk-${chunk.id}`;
    return { mesh, chunk, triangles: data.triangleCount };
  };

  const sync = (): number => {
    let remeshed = 0;
    for (let bz = 0; bz < world.blocksZ; bz += 1) {
      for (let bx = 0; bx < world.blocksX; bx += 1) {
        const column = columns[bx + world.blocksX * bz]!;
        const now = columnRevisions(bx, bz);
        if (column.revisions.length === now.length && column.revisions.every((value, index) => value === now[index])) continue;
        meshColumn(bx, bz);
        remeshed += 1;
      }
    }
    const live = new Set<number>();
    for (const chunk of world.chunks) {
      live.add(chunk.id);
      let entry = chunkMeshes.get(chunk.id);
      if (!entry) {
        const created = meshChunk(chunk);
        if (!created) continue;
        entry = created;
        chunkMeshes.set(chunk.id, entry);
        group.add(entry.mesh);
      }
      entry.mesh.position.y = -chunk.fallMetres;
    }
    for (const [id, entry] of chunkMeshes) {
      if (live.has(id)) continue;
      entry.mesh.geometry.dispose();
      group.remove(entry.mesh);
      chunkMeshes.delete(id);
    }
    return remeshed;
  };

  sync();

  let disposed = false;
  return {
    group,
    sync,
    triangleCount(): number {
      let total = 0;
      for (const column of columns) total += column.triangles;
      for (const entry of chunkMeshes.values()) total += entry.triangles;
      return total;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const column of columns) column.mesh?.geometry.dispose();
      for (const entry of chunkMeshes.values()) entry.mesh.geometry.dispose();
      material.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
