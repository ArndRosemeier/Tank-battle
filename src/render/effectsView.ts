/**
 * Additive combat VFX: muzzle flashes, impact/hit sparks, cell-break shards, a
 * regeneration grow-in cage and death bursts. Every effect is LIGHT — point sprites and
 * thin additive lines — never a bright flat surface, so the §9 surface budget and the
 * look-budget tile p90 keep measuring architecture, not effects.
 *
 * The view is render-only and deterministic: a seeded RNG gives the particle spread, so
 * a frozen demo frame is reproducible. The demo path updates with `dt = 0`, which keeps
 * the first frame's flash alive for the screenshot instead of decaying before Chrome
 * takes it.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  RGBAFormat,
  type ColorRepresentation,
} from 'three';
import { createRng, type Rng } from '../core/rng.ts';
import { CELL_SIZE_METRES } from '../core/world.ts';
import { PALETTE } from './config.ts';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  r: number;
  g: number;
  b: number;
  gain: number;
}

interface PoolOptions {
  readonly capacity: number;
  readonly sizeMetres: number;
  readonly name: string;
  readonly map: DataTexture;
}

class ParticlePool {
  readonly points: Points;
  private readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly material: PointsMaterial;

  constructor(options: PoolOptions) {
    this.positions = new Float32Array(options.capacity * 3);
    this.colors = new Float32Array(options.capacity * 3);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    this.material = new PointsMaterial({
      size: options.sizeMetres,
      sizeAttenuation: true,
      vertexColors: true,
      map: options.map,
      alphaTest: 0.01,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.name = options.name;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  spawn(particle: Particle): void {
    if (this.particles.length >= this.positions.length / 3) {
      this.particles.shift();
    }
    this.particles.push(particle);
  }

  update(dtSeconds: number): void {
    if (dtSeconds > 0) {
      for (let index = this.particles.length - 1; index >= 0; index -= 1) {
        const particle = this.particles[index]!;
        particle.life -= dtSeconds;
        if (particle.life <= 0) {
          this.particles.splice(index, 1);
          continue;
        }
        const drag = Math.pow(particle.drag, dtSeconds * 60);
        particle.vx *= drag;
        particle.vz *= drag;
        particle.vy = particle.vy * drag + particle.gravity * dtSeconds;
        particle.x += particle.vx * dtSeconds;
        particle.y += particle.vy * dtSeconds;
        particle.z += particle.vz * dtSeconds;
      }
    }

    let offset = 0;
    for (const particle of this.particles) {
      const fade = Math.max(0, Math.min(1, particle.life / particle.maxLife));
      const intensity = fade * fade * particle.gain;
      this.positions[offset] = particle.x;
      this.positions[offset + 1] = particle.y;
      this.positions[offset + 2] = particle.z;
      this.colors[offset] = particle.r * intensity;
      this.colors[offset + 1] = particle.g * intensity;
      this.colors[offset + 2] = particle.b * intensity;
      offset += 3;
    }
    this.geometry.setDrawRange(0, this.particles.length);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.points.visible = this.particles.length > 0;
  }

  clear(): void {
    this.particles.length = 0;
    this.update(0);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface RegenGhost {
  readonly lines: LineSegments;
  readonly material: LineBasicMaterial;
  life: number;
  maxLife: number;
  height: number;
  baseY: number;
}

export interface EffectsView {
  readonly group: Group;
  muzzle(x: number, y: number, z: number, direction: { x: number; y: number; z: number }, color: ColorRepresentation): void;
  impact(x: number, y: number, z: number, color: ColorRepresentation): void;
  hit(x: number, y: number, z: number, color: ColorRepresentation): void;
  death(x: number, y: number, z: number, color: ColorRepresentation): void;
  breakCell(x: number, y: number, z: number, color: ColorRepresentation): void;
  regen(x: number, z: number, heightMetres: number, color: ColorRepresentation): void;
  shard(x: number, y: number, z: number): void;
  update(dtSeconds: number): void;
  dispose(): void;
}

const ICE = new Color(PALETTE.iceWhite);
const HOLE = new Color(PALETTE.holeRim);
const REGEN = new Color(PALETTE.gridMajor);

function rgb(color: ColorRepresentation, gain: number): { r: number; g: number; b: number } {
  const value = color instanceof Color ? color : new Color(color);
  return { r: value.r * gain, g: value.g * gain, b: value.b * gain };
}

/**
 * A soft round point sprite, generated as data so the render layer needs no DOM and
 * no image loader. The old square point read as a white pixel at the muzzle.
 */
function glowTexture(size = 32): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const radius = Math.min(1, Math.hypot(nx, ny));
      const alpha = Math.round(255 * (1 - radius) * (1 - radius));
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export function createEffectsView(): EffectsView {
  const rng: Rng = createRng(0x51f15e55);
  const glow = glowTexture();
  const sparks = new ParticlePool({ capacity: 420, sizeMetres: 0.14, name: 'vfx-sparks', map: glow });
  const flashes = new ParticlePool({ capacity: 96, sizeMetres: 0.14, name: 'vfx-flashes', map: glow });
  const debris = new ParticlePool({ capacity: 220, sizeMetres: 0.2, name: 'vfx-debris', map: glow });

  const group = new Group();
  group.name = 'effects';
  group.add(sparks.points, flashes.points, debris.points);

  const ghostGeometry = new BoxGeometry(1, 1, 1);
  ghostGeometry.translate(0, 0.5, 0);
  const ghostEdges = new EdgesGeometry(ghostGeometry);
  ghostGeometry.dispose();
  const ghosts: RegenGhost[] = [];
  for (let index = 0; index < 8; index += 1) {
    const material = new LineBasicMaterial({
      color: new Color(PALETTE.gridMajor),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const lines = new LineSegments(ghostEdges, material);
    lines.visible = false;
    lines.name = `vfx-regen-${index}`;
    group.add(lines);
    ghosts.push({ lines, material, life: 0, maxLife: 0.42, height: 0, baseY: 0 });
  }

  const spawnSpark = (
    x: number,
    y: number,
    z: number,
    color: { r: number; g: number; b: number },
    speed: number,
    life: number,
    gravity: number,
    pool: ParticlePool = sparks,
  ): void => {
    const angle = rng.next() * Math.PI * 2;
    const up = rng.next() * 2 - 0.4;
    const radial = Math.sqrt(rng.next()) * speed;
    pool.spawn({
      x,
      y,
      z,
      vx: Math.cos(angle) * radial,
      vy: up * speed,
      vz: Math.sin(angle) * radial,
      life: life * (0.6 + rng.next() * 0.5),
      maxLife: life,
      gravity,
      drag: 0.94,
      r: color.r,
      g: color.g,
      b: color.b,
      gain: 1.8 + rng.next(),
    });
  };

  const spawnFlash = (
    x: number,
    y: number,
    z: number,
    color: { r: number; g: number; b: number },
    life: number,
  ): void => {
    flashes.spawn({
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      life,
      maxLife: life,
      gravity: 0,
      drag: 1,
      r: color.r,
      g: color.g,
      b: color.b,
      gain: 2.0,
    });
  };

  const spawnRegen = (x: number, z: number, heightMetres: number, baseY: number): void => {
    let ghost = ghosts.find((candidate) => candidate.life <= 0);
    if (!ghost) {
      ghost = ghosts.reduce((oldest, candidate) =>
        candidate.life < oldest.life ? candidate : oldest,
      );
    }
    ghost.life = ghost.maxLife;
    ghost.height = Math.max(0.12, heightMetres);
    ghost.baseY = baseY;
    ghost.lines.position.set((x + 0.5) * CELL_SIZE_METRES, baseY, (z + 0.5) * CELL_SIZE_METRES);
    ghost.lines.scale.set(CELL_SIZE_METRES, 0.01, CELL_SIZE_METRES);
    ghost.lines.visible = true;
    ghost.material.opacity = 0.75;
    const color = rgb(REGEN, 1.5);
    for (let index = 0; index < 6; index += 1) {
      spawnSpark(
        (x + 0.2 + rng.next() * 0.6) * CELL_SIZE_METRES,
        baseY + 0.05,
        (z + 0.2 + rng.next() * 0.6) * CELL_SIZE_METRES,
        color,
        1.2,
        0.5,
        2.2,
      );
    }
  };

  let disposed = false;
  return {
    group,
    muzzle(x, y, z, direction, color) {
      const tint = rgb(color, 1.1);
      const white = rgb(ICE, 1.7);
      // Lift the flash off the bore axis: the follow camera looks straight down the
      // barrel, so a point exactly on the axis is hidden behind the muzzle brake.
      spawnFlash(
        x + direction.x * 0.26,
        y + direction.y * 0.26 + 0.26,
        z + direction.z * 0.26,
        white,
        0.12,
      );
      for (let index = 0; index < 4; index += 1) {
        const spread = 0.7;
        sparks.spawn({
          x,
          y,
          z,
          vx: direction.x * 4.5 + (rng.next() * 2 - 1) * spread,
          vy: direction.y * 4.5 + (rng.next() * 2 - 1) * spread + 0.3,
          vz: direction.z * 4.5 + (rng.next() * 2 - 1) * spread,
          life: 0.08 + rng.next() * 0.08,
          maxLife: 0.16,
          gravity: -1,
          drag: 0.9,
          ...tint,
          gain: 1.4 + rng.next() * 0.6,
        });
      }
    },
    impact(x, y, z, color) {
      const tint = rgb(color, 1.0);
      spawnFlash(x, y, z, rgb(ICE, 1.4), 0.18);
      for (let index = 0; index < 9; index += 1) {
        spawnSpark(x, y, z, tint, 4.5, 0.24, -7);
      }
    },
    hit(x, y, z, color) {
      const tint = rgb(color, 1.2);
      for (let index = 0; index < 6; index += 1) {
        spawnSpark(x, y, z, tint, 3, 0.22, -9);
      }
    },
    death(x, y, z, color) {
      const tint = rgb(color, 1.4);
      spawnFlash(x, y, z, rgb(ICE, 1.6), 0.24);
      for (let index = 0; index < 22; index += 1) {
        spawnSpark(x, y, z, tint, 6, 0.5, -10);
      }
      for (let index = 0; index < 8; index += 1) {
        spawnSpark(x, y, z, rgb(HOLE, 1.0), 4, 0.7, -14, debris);
      }
    },
    breakCell(x, y, z, color) {
      spawnFlash(x, y, z, rgb(ICE, 1.2), 0.16);
      const tint = rgb(color, 1.2);
      for (let index = 0; index < 10; index += 1) {
        spawnSpark(x, y, z, tint, 3.5, 0.42, -13, debris);
      }
    },
    regen,
    shard(x, y, z) {
      for (let index = 0; index < 2; index += 1) {
        spawnSpark(x, y, z, rgb(HOLE, 1.1), 1.5, 0.3, -4);
      }
    },
    update(dtSeconds) {
      if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
        throw new Error(`effectsView: dtSeconds must be finite and >= 0, got ${String(dtSeconds)}`);
      }
      sparks.update(dtSeconds);
      flashes.update(dtSeconds);
      debris.update(dtSeconds);
      for (const ghost of ghosts) {
        if (ghost.life <= 0) {
          continue;
        }
        ghost.life = Math.max(0, ghost.life - dtSeconds);
        const progress = 1 - ghost.life / ghost.maxLife;
        const ease = 1 - (1 - progress) * (1 - progress);
        ghost.lines.scale.y = Math.max(0.01, ghost.height * ease);
        ghost.material.opacity = 0.75 * (1 - progress);
        if (ghost.life <= 0) {
          ghost.lines.visible = false;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      sparks.dispose();
      flashes.dispose();
      debris.dispose();
      glow.dispose();
      for (const ghost of ghosts) {
        ghost.material.dispose();
      }
      ghostEdges.dispose();
    },
  };

  function regen(x: number, z: number, heightMetres: number, color: ColorRepresentation): void {
    // The floor's regen is a thin slab; a wall's is its full authored height. The
    // source colour is the architecture's identity; the ghost is the cell cage.
    const isFloor = heightMetres <= CELL_SIZE_METRES * 0.25;
    const ghostHeight = isFloor ? Math.max(0.12, heightMetres) : heightMetres;
    spawnRegen(x, z, ghostHeight, 0);
    const tint = rgb(color, 1.2);
    for (let index = 0; index < 4; index += 1) {
      spawnSpark(
        (x + 0.5) * CELL_SIZE_METRES,
        (isFloor ? 0.22 : 0.3) + rng.next() * 0.4,
        (z + 0.5) * CELL_SIZE_METRES,
        tint,
        1.4,
        0.4,
        1.8,
      );
    }
  }
}
