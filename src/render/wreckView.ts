/**
 * P8's tank breakup: ONE instanced neon line system for every wreck piece.
 *
 * The authored slabs in `TANK_WRECK_PARTS` are spawned at the dead tank's pose. Each
 * piece gets a seeded outward/upward velocity (biased along the killing shell's
 * direction when the sim supplies one), spin, gravity, one damped floor bounce, and a
 * monotonic additive alpha fade. Reduced motion freezes the pieces in place and fades
 * them over 0.4 s.
 *
 * The pool is fixed: eight wrecks each own a fixed slice of the piece records. A ninth
 * death overwrites the oldest slice; no array grows and no geometry is rebuilt. All
 * pieces are one `LineSegments` draw with per-instance matrix/color/alpha attributes.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  EdgesGeometry,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { PALETTE } from './config.ts';
import { TANK_WRECK_PARTS, TURRET_MOUNT } from './placeholderTank.ts';

export const WRECK_MAX_WRECKS = 8;
export const WRECK_LIFETIME_SECONDS = 3;
export const WRECK_FADE_START_FRACTION = 0.62;
export const WRECK_REDUCED_LIFETIME_SECONDS = 0.4;
const PART_COUNT = TANK_WRECK_PARTS.length;
const CAPACITY = WRECK_MAX_WRECKS * PART_COUNT;
const GRAVITY = -9.8;
const FLOOR_SKIN_METRES = 0.06;

export interface WreckSpawn {
  readonly x: number;
  /** The hull origin's height on the terrain. */
  readonly y: number;
  readonly z: number;
  readonly hullYawDegrees: number;
  readonly turretYawDegrees: number;
  readonly aimPitchDegrees: number;
  readonly teamId: number;
  readonly seed: number;
  readonly tankId: number;
  readonly tick: number;
  readonly direction?: { readonly x: number; readonly y: number; readonly z: number };
  readonly reducedMotion: boolean;
}

interface WreckPiece {
  active: boolean;
  readonly slotIndex: number;
  readonly position: Vector3;
  readonly baseQuaternion: Quaternion;
  readonly scale: Vector3;
  readonly color: Color;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  spinAngleX: number;
  spinAngleY: number;
  spinAngleZ: number;
  bounced: boolean;
  reduced: boolean;
  alpha: number;
}

interface WreckSlot {
  active: boolean;
  sequence: number;
  age: number;
  reduced: boolean;
  /** The spawn frame writes the intact breakup pose and does not age it yet. */
  fresh: boolean;
}

export interface WreckPieceDebug {
  readonly slotIndex: number;
  readonly position: { x: number; y: number; z: number };
  readonly velocity: { x: number; y: number; z: number };
  readonly alpha: number;
}

export interface WreckDebugState {
  readonly activeWrecks: number;
  readonly activePieces: number;
  readonly allocatedPieces: number;
  readonly spawnCount: number;
  readonly slots: readonly { readonly active: boolean; readonly age: number; readonly sequence: number }[];
  readonly pieces: readonly WreckPieceDebug[];
}

export interface WreckView {
  readonly group: Group;
  spawn(death: WreckSpawn): void;
  update(dtSeconds: number): void;
  setVisible(visible: boolean): void;
  debug(): WreckDebugState;
  dispose(): void;
}

/**
 * The clamped, monotonic piece alpha. It is 1 until the fade starts (62 % by default),
 * then falls linearly to exactly 0 at the lifetime. Reduced motion fades from the first
 * frame so its short in-place beat reads as a fade rather than a pop.
 */
export function wreckAlpha(
  ageSeconds: number,
  lifetimeSeconds = WRECK_LIFETIME_SECONDS,
  reducedMotion = false,
): number {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
    throw new Error(`wreckView: age must be finite and >= 0, got ${String(ageSeconds)}`);
  }
  if (!Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) {
    throw new Error(`wreckView: lifetime must be finite and > 0, got ${String(lifetimeSeconds)}`);
  }
  if (ageSeconds >= lifetimeSeconds) return 0;
  const fadeStart = reducedMotion ? 0 : lifetimeSeconds * WRECK_FADE_START_FRACTION;
  if (ageSeconds <= fadeStart) return 1;
  return Math.max(0, Math.min(1, 1 - (ageSeconds - fadeStart) / (lifetimeSeconds - fadeStart)));
}

/** A small deterministic LCG; no Math.random, no per-death allocation. */
class WreckRandom {
  private state = 1;

  reset(seed: number): void {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

function deriveSeed(seed: number, tankId: number, tick: number): number {
  let value = seed >>> 0;
  value = Math.imul(value ^ (tankId + 0x9e3779b9), 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value ^ (tick + 0x7f4a7c15), 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`wreckView: ${label} must be finite, got ${String(value)}`);
  }
}

/** The ground height under a point, looking down from `fromY` (the terrain's answer). */
export type GroundHeight = (x: number, z: number, fromY: number) => number;

export function createWreckView(groundAt: GroundHeight): WreckView {
  const group = new Group();
  group.name = 'wrecks';

  const localMatrices = TANK_WRECK_PARTS.map((spec) => {
    const matrix = new Matrix4();
    const quaternion = new Quaternion().setFromEuler(
      new Euler(spec.rotX ?? 0, spec.rotY ?? 0, spec.rotZ ?? 0, 'YXZ'),
    );
    matrix.compose(
      new Vector3(spec.x, spec.y, spec.z),
      quaternion,
      new Vector3(spec.width, spec.height, spec.depth),
    );
    return matrix;
  });

  const teamColors = PALETTE.team.map((color) => new Color(color).multiplyScalar(1.35));
  const coreColor = new Color(PALETTE.iceWhite).multiplyScalar(1.55);

  const slots: WreckSlot[] = Array.from({ length: WRECK_MAX_WRECKS }, () => ({
    active: false,
    sequence: 0,
    age: 0,
    reduced: false,
    fresh: false,
  }));
  const pieces: WreckPiece[] = Array.from({ length: CAPACITY }, (_, index) => ({
    active: false,
    slotIndex: Math.floor(index / PART_COUNT),
    position: new Vector3(),
    baseQuaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1),
    color: new Color(),
    vx: 0,
    vy: 0,
    vz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    spinAngleX: 0,
    spinAngleY: 0,
    spinAngleZ: 0,
    bounced: false,
    reduced: false,
    alpha: 0,
  }));

  const matrix0 = new Float32Array(CAPACITY * 4);
  const matrix1 = new Float32Array(CAPACITY * 4);
  const matrix2 = new Float32Array(CAPACITY * 4);
  const matrix3 = new Float32Array(CAPACITY * 4);
  const colorData = new Float32Array(CAPACITY * 3);
  const alphaData = new Float32Array(CAPACITY);

  const unit = new BoxGeometry(1, 1, 1);
  const edgeGeometry = new EdgesGeometry(unit);
  unit.dispose();
  const geometry = new InstancedBufferGeometry();
  const edgePosition = edgeGeometry.getAttribute('position');
  geometry.setAttribute('position', new BufferAttribute(edgePosition.array.slice() as Float32Array, 3));
  const aMatrix0 = new InstancedBufferAttribute(matrix0, 4);
  const aMatrix1 = new InstancedBufferAttribute(matrix1, 4);
  const aMatrix2 = new InstancedBufferAttribute(matrix2, 4);
  const aMatrix3 = new InstancedBufferAttribute(matrix3, 4);
  const aColor = new InstancedBufferAttribute(colorData, 3);
  const aAlpha = new InstancedBufferAttribute(alphaData, 1);
  for (const attribute of [aMatrix0, aMatrix1, aMatrix2, aMatrix3, aColor, aAlpha]) {
    attribute.setUsage(DynamicDrawUsage);
  }
  geometry.setAttribute('aMatrix0', aMatrix0);
  geometry.setAttribute('aMatrix1', aMatrix1);
  geometry.setAttribute('aMatrix2', aMatrix2);
  geometry.setAttribute('aMatrix3', aMatrix3);
  geometry.setAttribute('aColor', aColor);
  geometry.setAttribute('aAlpha', aAlpha);
  geometry.instanceCount = 0;

  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aMatrix0;
      attribute vec4 aMatrix1;
      attribute vec4 aMatrix2;
      attribute vec4 aMatrix3;
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        mat4 pieceMatrix = mat4(aMatrix0, aMatrix1, aMatrix2, aMatrix3);
        vColor = aColor;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * pieceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.name = 'wreck-pieces';
  lines.frustumCulled = false;
  lines.visible = false;
  group.add(lines);

  const rng = new WreckRandom();
  let spawnCount = 0;
  let activeWrecks = 0;
  let visible = true;
  let disposed = false;

  const hullMatrix = new Matrix4();
  const turretMatrix = new Matrix4();
  const offsetMatrix = new Matrix4();
  const rotationMatrix = new Matrix4();
  const worldMatrix = new Matrix4();
  const scratchPosition = new Vector3();
  const scratchQuaternion = new Quaternion();
  const scratchEuler = new Euler();
  const one = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  const shotDirection = new Vector3();

  const spawn = (death: WreckSpawn): void => {
    if (disposed) throw new Error('wreckView: spawn after dispose');
    for (const [value, label] of [
      [death.x, 'x'],
      [death.z, 'z'],
      [death.hullYawDegrees, 'hullYawDegrees'],
      [death.turretYawDegrees, 'turretYawDegrees'],
      [death.aimPitchDegrees, 'aimPitchDegrees'],
      [death.seed, 'seed'],
      [death.tick, 'tick'],
      [death.tankId, 'tankId'],
    ] as const) {
      finite(value, label);
    }
    if (!Number.isInteger(death.teamId) || death.teamId < 0 || death.teamId >= PALETTE.team.length) {
      throw new Error(`wreckView: teamId must be within 0…${PALETTE.team.length - 1}, got ${String(death.teamId)}`);
    }

    let slotIndex = slots.findIndex((slot) => !slot.active);
    if (slotIndex < 0) {
      let oldest = 0;
      for (let index = 1; index < slots.length; index += 1) {
        if (slots[index]!.sequence < slots[oldest]!.sequence) oldest = index;
      }
      slotIndex = oldest;
    } else {
      activeWrecks += 1;
    }
    const slot = slots[slotIndex]!;
    slot.active = true;
    slot.sequence = spawnCount + 1;
    slot.age = 0;
    slot.reduced = death.reducedMotion;
    slot.fresh = true;

    const reduced = death.reducedMotion;
    const hasDirection = death.direction !== undefined;
    if (hasDirection) {
      shotDirection.set(death.direction!.x, death.direction!.y, death.direction!.z);
      if (shotDirection.lengthSq() < 1e-12) {
        throw new Error('wreckView: direction must be non-zero when supplied');
      }
      shotDirection.normalize();
    } else {
      shotDirection.set(0, 0, 0);
    }

    const hullYawRadians = (death.hullYawDegrees * Math.PI) / 180;
    const turretYawRadians = ((death.turretYawDegrees - death.hullYawDegrees) * Math.PI) / 180;
    hullMatrix.compose(
      scratchPosition.set(death.x, death.y, death.z),
      scratchQuaternion.setFromAxisAngle(up, hullYawRadians),
      one,
    );
    offsetMatrix.makeTranslation(TURRET_MOUNT.x, TURRET_MOUNT.y, TURRET_MOUNT.z);
    rotationMatrix.makeRotationFromEuler(
      scratchEuler.set(
        (death.aimPitchDegrees * Math.PI) / 180,
        turretYawRadians,
        0,
        'YXZ',
      ),
    );
    turretMatrix.multiplyMatrices(hullMatrix, offsetMatrix).multiply(rotationMatrix);

    rng.reset(deriveSeed(death.seed, death.tankId, death.tick));
    const start = slotIndex * PART_COUNT;
    for (let pieceIndex = 0; pieceIndex < PART_COUNT; pieceIndex += 1) {
      const piece = pieces[start + pieceIndex]!;
      const spec = TANK_WRECK_PARTS[pieceIndex]!;
      worldMatrix.multiplyMatrices(spec.group === 'hull' ? hullMatrix : turretMatrix, localMatrices[pieceIndex]!);
      worldMatrix.decompose(piece.position, piece.baseQuaternion, piece.scale);
      piece.color.copy(spec.color === 'core' ? coreColor : teamColors[death.teamId]!);
      piece.active = true;
      piece.reduced = reduced;
      piece.bounced = false;
      piece.alpha = 1;
      piece.spinAngleX = 0;
      piece.spinAngleY = 0;
      piece.spinAngleZ = 0;

      if (reduced) {
        piece.vx = 0;
        piece.vy = 0;
        piece.vz = 0;
        piece.spinX = 0;
        piece.spinY = 0;
        piece.spinZ = 0;
        continue;
      }

      const outwardX = piece.position.x - death.x;
      const outwardZ = piece.position.z - death.z;
      const outwardLength = Math.hypot(outwardX, outwardZ);
      const radialAngle = rng.next() * Math.PI * 2;
      const radialSpeed = 1.2 + rng.next() * 2.0;
      const outwardSpeed = outwardLength > 1e-6 ? 0.7 + rng.next() * 1.1 : 0;
      const shotSpeed = hasDirection ? 2.0 + rng.next() * 2.2 : 0;
      piece.vx =
        Math.cos(radialAngle) * radialSpeed +
        (outwardLength > 1e-6 ? (outwardX / outwardLength) * outwardSpeed : 0) +
        shotDirection.x * shotSpeed;
      piece.vz =
        Math.sin(radialAngle) * radialSpeed +
        (outwardLength > 1e-6 ? (outwardZ / outwardLength) * outwardSpeed : 0) +
        shotDirection.z * shotSpeed;
      piece.vy = 2.1 + rng.next() * 2.7 + Math.max(0, shotDirection.y) * 1.5;
      piece.spinX = (rng.next() * 2 - 1) * 5.5;
      piece.spinY = (rng.next() * 2 - 1) * 5.5;
      piece.spinZ = (rng.next() * 2 - 1) * 5.5;
    }

    spawnCount += 1;
    lines.visible = visible;
    // The age is advanced by the host's first updateEffects(dt); the first rendered
    // frame is the spawn pose and the buffer is written on that update.
  };

  const update = (dtSeconds: number): void => {
    if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
      throw new Error(`wreckView: dtSeconds must be finite and >= 0, got ${String(dtSeconds)}`);
    }
    let drawCount = 0;
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex]!;
      if (!slot.active) continue;
      const lifetime = slot.reduced ? WRECK_REDUCED_LIFETIME_SECONDS : WRECK_LIFETIME_SECONDS;
      if (slot.fresh) {
        // The first rendered frame is the same-frame swap at age 0; the breakup starts
        // on the next update. This also makes the t=0 screenshot honest.
        slot.fresh = false;
      } else {
        slot.age += dtSeconds;
      }
      if (slot.age >= lifetime) {
        for (let offset = 0; offset < PART_COUNT; offset += 1) {
          pieces[slotIndex * PART_COUNT + offset]!.active = false;
        }
        slot.active = false;
        activeWrecks = Math.max(0, activeWrecks - 1);
        continue;
      }
      const alpha = wreckAlpha(slot.age, lifetime, slot.reduced);
      for (let offset = 0; offset < PART_COUNT; offset += 1) {
        const piece = pieces[slotIndex * PART_COUNT + offset]!;
        if (!piece.active) continue;
        if (!slot.reduced) {
          piece.vy += GRAVITY * dtSeconds;
          piece.vx *= Math.pow(0.995, dtSeconds * 60);
          piece.vz *= Math.pow(0.995, dtSeconds * 60);
          piece.position.x += piece.vx * dtSeconds;
          piece.position.y += piece.vy * dtSeconds;
          piece.position.z += piece.vz * dtSeconds;
          const floorY = groundAt(piece.position.x, piece.position.z, piece.position.y + 0.5);
          if (piece.position.y <= floorY + FLOOR_SKIN_METRES) {
            piece.position.y = floorY + FLOOR_SKIN_METRES;
            if (!piece.bounced) {
              piece.bounced = true;
              piece.vy = -piece.vy * 0.32;
              piece.vx *= 0.55;
              piece.vz *= 0.55;
            } else {
              piece.vy = 0;
              piece.vx *= 0.9;
              piece.vz *= 0.9;
            }
          }
          piece.spinAngleX += piece.spinX * dtSeconds;
          piece.spinAngleY += piece.spinY * dtSeconds;
          piece.spinAngleZ += piece.spinZ * dtSeconds;
        }
        piece.alpha = alpha;
        scratchEuler.set(piece.spinAngleX, piece.spinAngleY, piece.spinAngleZ, 'XYZ');
        scratchQuaternion.setFromEuler(scratchEuler).multiply(piece.baseQuaternion);
        worldMatrix.compose(piece.position, scratchQuaternion, piece.scale);
        const e = worldMatrix.elements;
        const base = drawCount * 4;
        matrix0[base] = e[0]!;
        matrix0[base + 1] = e[1]!;
        matrix0[base + 2] = e[2]!;
        matrix0[base + 3] = e[3]!;
        matrix1[base] = e[4]!;
        matrix1[base + 1] = e[5]!;
        matrix1[base + 2] = e[6]!;
        matrix1[base + 3] = e[7]!;
        matrix2[base] = e[8]!;
        matrix2[base + 1] = e[9]!;
        matrix2[base + 2] = e[10]!;
        matrix2[base + 3] = e[11]!;
        matrix3[base] = e[12]!;
        matrix3[base + 1] = e[13]!;
        matrix3[base + 2] = e[14]!;
        matrix3[base + 3] = e[15]!;
        colorData[drawCount * 3] = piece.color.r;
        colorData[drawCount * 3 + 1] = piece.color.g;
        colorData[drawCount * 3 + 2] = piece.color.b;
        alphaData[drawCount] = piece.alpha;
        drawCount += 1;
      }
    }
    geometry.instanceCount = drawCount;
    lines.visible = drawCount > 0 && visible;
    aMatrix0.needsUpdate = true;
    aMatrix1.needsUpdate = true;
    aMatrix2.needsUpdate = true;
    aMatrix3.needsUpdate = true;
    aColor.needsUpdate = true;
    aAlpha.needsUpdate = true;
  };

  return {
    group,
    spawn,
    update,
    setVisible(nextVisible: boolean): void {
      visible = nextVisible;
      lines.visible = nextVisible && geometry.instanceCount > 0;
    },
    debug(): WreckDebugState {
      const activePieces = pieces.filter((piece) => piece.active);
      return {
        activeWrecks,
        activePieces: activePieces.length,
        allocatedPieces: CAPACITY,
        spawnCount,
        slots: slots.map((slot) => ({ active: slot.active, age: slot.age, sequence: slot.sequence })),
        pieces: activePieces.map((piece) => ({
          slotIndex: piece.slotIndex,
          position: { x: piece.position.x, y: piece.position.y, z: piece.position.z },
          velocity: { x: piece.vx, y: piece.vy, z: piece.vz },
          alpha: piece.alpha,
        })),
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      geometry.dispose();
      material.dispose();
      edgeGeometry.dispose();
    },
  };
}
