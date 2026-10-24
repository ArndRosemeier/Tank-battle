/**
 * G1 — the cheesy TRON extras, as ONE view with three parts:
 *
 *  - **light-cycle trails**: a short glowing wall behind every moving tank, in its team
 *    colour, fading over `GLOW.trailSeconds`. All tanks share ONE mesh (one draw call).
 *  - **the horizon**: a huge open cylinder around the arena whose base glows like a
 *    sunset band, so the void has a skyline instead of a flat black edge.
 *  - **triangle mountains**: a ring of distant wireframe peaks (one line draw call),
 *    a first taste of the triangle landscape the owner asked for.
 *
 * Presentation only. The trails read the interpolated render frames, never the sim.
 * The mountains come from a fixed seed so every frame and screenshot is reproducible.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
} from 'three';
import { createRng } from '../core/rng.ts';
import { GLOW, GLOW_PALETTE, teamColor } from './config.ts';
import { GLOW_UNIFORMS } from './glowClock.ts';

/** What a trail needs from a tank each frame. */
export interface TrailSample {
  readonly id: number;
  readonly teamId: number;
  readonly x: number;
  readonly z: number;
  readonly alive: boolean;
}

export interface GlowView {
  readonly group: Group;
  readonly trails: Mesh;
  readonly horizon: Mesh;
  readonly mountains: LineSegments;
  /**
   * Feeds the current tank poses; call once per rendered frame. Trails age in
   * SIMULATION time (`seconds` = the match tick in seconds), so a paused match holds
   * its trails still and a slow frame rate never shortens them.
   */
  setTanks(frames: readonly TrailSample[], seconds: number): void;
  /** Live trail point count (debug/verification). */
  trailPointCount(): number;
  dispose(): void;
}

interface TrailPoint {
  readonly x: number;
  readonly z: number;
  /** When the point was laid, in simulation seconds. */
  readonly born: number;
}

interface Trail {
  readonly color: Color;
  readonly points: TrailPoint[];
  headX: number;
  headZ: number;
  alive: boolean;
  /** False until the first pose arrives, so a spawn never draws a streak from 0,0. */
  seeded: boolean;
}

/** The fixed seed of the mountain ring: the skyline is authored, not random per run. */
const MOUNTAIN_SEED = 7331;

const HORIZON_VERTEX_SHADER = /* glsl */ `
  varying float vHeight;
  void main() {
    vHeight = position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HORIZON_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform float uHalfHeight;
  uniform float uFalloff;
  uniform float uGlowTime;
  uniform float uGlowPulse;
  varying float vHeight;
  void main() {
    float h = vHeight + uHalfHeight;
    float band = exp(-h / uFalloff);
    float line = exp(-h * h / 0.6);
    float breathe = 1.0 + uGlowPulse * 0.12 * sin(uGlowTime * 0.9);
    vec3 color = mix(uColor, uHot, clamp(h / (uFalloff * 2.5), 0.0, 1.0)) * band * breathe;
    color += uColor * line * 1.2;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createGlowView(options: {
  readonly centerX: number;
  readonly centerZ: number;
  readonly floorY: number;
}): GlowView {
  const group = new Group();
  group.name = 'glow';

  // --- trails: one dynamic mesh for every tank ---------------------------------
  const maxTanks = 16;
  const quadsPerTank = GLOW.trailMaxPoints;
  const vertexCapacity = maxTanks * quadsPerTank * 4;
  const positions = new Float32Array(vertexCapacity * 3);
  const colors = new Float32Array(vertexCapacity * 3);
  const indices = new Uint32Array(maxTanks * quadsPerTank * 6);
  for (let quad = 0; quad < maxTanks * quadsPerTank; quad += 1) {
    const v = quad * 4;
    indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], quad * 6);
  }
  const trailGeometry = new BufferGeometry();
  trailGeometry.setAttribute('position', new BufferAttribute(positions, 3));
  trailGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  trailGeometry.setIndex(new BufferAttribute(indices, 1));
  trailGeometry.setDrawRange(0, 0);
  const trailMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
  const trails = new Mesh(trailGeometry, trailMaterial);
  trails.name = 'glow-trails';
  trails.frustumCulled = false;
  group.add(trails);

  const trailMap = new Map<number, Trail>();

  // --- horizon: an open cylinder, glowing at its base ---------------------------
  const horizonGeometry = new CylinderGeometry(
    GLOW.horizonRadiusMetres,
    GLOW.horizonRadiusMetres,
    GLOW.horizonHeightMetres,
    96,
    1,
    true,
  );
  const horizonMaterial = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(GLOW_PALETTE.horizon).multiplyScalar(GLOW.horizonGain) },
      uHot: { value: new Color(GLOW_PALETTE.horizonHot).multiplyScalar(GLOW.horizonGain * 0.7) },
      uHalfHeight: { value: GLOW.horizonHeightMetres / 2 },
      uFalloff: { value: GLOW.horizonFalloffMetres },
      uGlowTime: GLOW_UNIFORMS.uGlowTime,
      uGlowPulse: GLOW_UNIFORMS.uGlowPulse,
    },
    vertexShader: HORIZON_VERTEX_SHADER,
    fragmentShader: HORIZON_FRAGMENT_SHADER,
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const horizon = new Mesh(horizonGeometry, horizonMaterial);
  horizon.name = 'glow-horizon';
  // The base sits a little below the floor so the band reads as the far ground line.
  horizon.position.set(
    options.centerX,
    options.floorY - 1 + GLOW.horizonHeightMetres / 2,
    options.centerZ,
  );
  horizon.renderOrder = -1;
  group.add(horizon);

  // --- triangle mountains: a ring of wireframe peaks ----------------------------
  const rng = createRng(MOUNTAIN_SEED);
  const linePositions: number[] = [];
  const lineColors: number[] = [];
  const mountainA = new Color(GLOW_PALETTE.mountain).multiplyScalar(GLOW.mountainGain);
  const mountainB = new Color(GLOW_PALETTE.mountainAlt).multiplyScalar(GLOW.mountainGain);
  const baseY = options.floorY - 0.5;
  const pushLine = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    color: Color, topFade: number,
  ): void => {
    linePositions.push(ax, ay, az, bx, by, bz);
    lineColors.push(color.r, color.g, color.b, color.r * topFade, color.g * topFade, color.b * topFade);
  };
  for (let index = 0; index < GLOW.mountainCount; index += 1) {
    const angle = ((index + rng.next() * 0.6) / GLOW.mountainCount) * Math.PI * 2;
    const radius =
      GLOW.mountainRadiusMinMetres +
      rng.next() * (GLOW.mountainRadiusMaxMetres - GLOW.mountainRadiusMinMetres);
    const height =
      GLOW.mountainHeightMinMetres +
      rng.next() * (GLOW.mountainHeightMaxMetres - GLOW.mountainHeightMinMetres);
    const halfWidth = height * (1.1 + rng.next() * 0.9);
    const color = index % 3 === 0 ? mountainB : mountainA;
    const cx = options.centerX + Math.cos(angle) * radius;
    const cz = options.centerZ + Math.sin(angle) * radius;
    // Tangent to the ring, so each peak faces the arena.
    const tx = -Math.sin(angle);
    const tz = Math.cos(angle);
    const lx = cx - tx * halfWidth;
    const lz = cz - tz * halfWidth;
    const rx = cx + tx * halfWidth;
    const rz = cz + tz * halfWidth;
    const peakShift = (rng.next() - 0.5) * halfWidth * 0.6;
    const px = cx + tx * peakShift;
    const pz = cz + tz * peakShift;
    const py = baseY + height;
    // Outline.
    pushLine(lx, baseY, lz, px, py, pz, color, 1.35);
    pushLine(rx, baseY, rz, px, py, pz, color, 1.35);
    // Inner triangulation: a mid ridge and two facets, so the peak reads as a mesh.
    const mx = (lx + px) / 2;
    const mz = (lz + pz) / 2;
    const my = (baseY + py) / 2;
    const nx = (rx + px) / 2;
    const nz = (rz + pz) / 2;
    pushLine(mx, my, mz, nx, my, nz, color, 1);
    pushLine(mx, my, mz, cx, baseY, cz, color, 0.6);
    pushLine(nx, my, nz, cx, baseY, cz, color, 0.6);
  }
  const mountainGeometry = new BufferGeometry();
  mountainGeometry.setAttribute('position', new BufferAttribute(new Float32Array(linePositions), 3));
  mountainGeometry.setAttribute('color', new BufferAttribute(new Float32Array(lineColors), 3));
  const mountainMaterial = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const mountains = new LineSegments(mountainGeometry, mountainMaterial);
  mountains.name = 'glow-mountains';
  group.add(mountains);

  let disposed = false;

  const rebuildTrails = (now: number): void => {
    let quad = 0;
    const height = GLOW.trailHeightMetres;
    const floorY = options.floorY + 0.02;
    for (const trail of trailMap.values()) {
      const points = trail.points;
      // The head joins the newest laid point to the tank's current position.
      const chain: TrailPoint[] = [...points];
      if (trail.alive) chain.push({ x: trail.headX, z: trail.headZ, born: now });
      for (let index = 1; index < chain.length && quad < maxTanks * quadsPerTank; index += 1) {
        const a = chain[index - 1]!;
        const b = chain[index]!;
        const fadeA = Math.max(0, 1 - (now - a.born) / GLOW.trailSeconds);
        const fadeB = Math.max(0, 1 - (now - b.born) / GLOW.trailSeconds);
        if (fadeA <= 0 && fadeB <= 0) continue;
        const v = quad * 4;
        positions.set(
          [a.x, floorY, a.z, a.x, floorY + height, a.z, b.x, floorY, b.z, b.x, floorY + height, b.z],
          v * 3,
        );
        const c = trail.color;
        const baseA = fadeA * GLOW.trailBaseGain;
        const baseB = fadeB * GLOW.trailBaseGain;
        const topA = fadeA * GLOW.trailTopGain;
        const topB = fadeB * GLOW.trailTopGain;
        colors.set(
          [
            c.r * baseA, c.g * baseA, c.b * baseA,
            c.r * topA, c.g * topA, c.b * topA,
            c.r * baseB, c.g * baseB, c.b * baseB,
            c.r * topB, c.g * topB, c.b * topB,
          ],
          v * 3,
        );
        quad += 1;
      }
    }
    trailGeometry.setDrawRange(0, quad * 6);
    const position = trailGeometry.getAttribute('position');
    const color = trailGeometry.getAttribute('color');
    position.needsUpdate = true;
    color.needsUpdate = true;
    trails.visible = quad > 0;
  };

  return {
    group,
    trails,
    horizon,
    mountains,
    setTanks(frames: readonly TrailSample[], seconds: number): void {
      if (!Number.isFinite(seconds)) {
        throw new Error(`glowView: trail time must be finite, got ${String(seconds)}`);
      }
      if (frames.length > maxTanks) {
        throw new Error(`glowView: ${frames.length} tanks exceed the trail capacity of ${maxTanks}`);
      }
      for (const frame of frames) {
        let trail = trailMap.get(frame.id);
        if (!trail) {
          trail = {
            color: new Color(teamColor(frame.teamId)),
            points: [],
            headX: frame.x,
            headZ: frame.z,
            alive: frame.alive,
            seeded: false,
          };
          trailMap.set(frame.id, trail);
        }
        trail.alive = frame.alive;
        if (!frame.alive) continue;
        trail.headX = frame.x;
        trail.headZ = frame.z;
        if (!trail.seeded) {
          trail.seeded = true;
          trail.points.push({ x: frame.x, z: frame.z, born: seconds });
          continue;
        }
        const last = trail.points[trail.points.length - 1];
        if (!last || Math.hypot(frame.x - last.x, frame.z - last.z) >= GLOW.trailSpacingMetres) {
          trail.points.push({ x: frame.x, z: frame.z, born: seconds });
          if (trail.points.length > GLOW.trailMaxPoints - 1) trail.points.shift();
        }
      }
      for (const trail of trailMap.values()) {
        while (trail.points.length > 0 && seconds - trail.points[0]!.born >= GLOW.trailSeconds) {
          trail.points.shift();
        }
      }
      rebuildTrails(seconds);
    },
    trailPointCount(): number {
      let count = 0;
      for (const trail of trailMap.values()) count += trail.points.length;
      return count;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      trailGeometry.dispose();
      trailMaterial.dispose();
      horizonGeometry.dispose();
      horizonMaterial.dispose();
      mountainGeometry.dispose();
      mountainMaterial.dispose();
    },
  };
}
