/**
 * The command contract between a controller and the simulation.
 *
 * A command is DATA, not a method call: the same shape arrives from a keyboard, an AI
 * profile or (later) a network socket. The player/AI distinction does not exist here.
 *
 * Validation is loud (AGENTS.md rule 1). A throttle of 1.5 is an author bug, not a
 * request to drive 50 % faster: it throws, rather than being silently clamped. Aim YAW
 * is an angle, not a range, so it is wrapped to `[-180, 180)`; aim PITCH is a real
 * range and throws outside its documented clamp.
 */

import { AIM_PITCH_MAX_DEGREES, AIM_PITCH_MIN_DEGREES } from './constants.ts';
import { normaliseDegrees } from './geometry.ts';

/** One tick's request for one tank. All fields are required. */
export interface TankCommand {
  /** -1…1; positive drives forward along the hull yaw. */
  readonly throttle: number;
  /** -1…1; positive turns the hull left. */
  readonly steer: number;
  /** Absolute turret yaw in degrees. Wrapped, never clamped. */
  readonly aimYaw: number;
  /** Absolute pitch in degrees, positive up; within the documented clamp. */
  readonly aimPitch: number;
  /** Fire this tick if the reload has elapsed. Holding it does not bypass the reload. */
  readonly fire: boolean;
}

/** A command paired with the tank it is for. */
export interface TankCommandOrder {
  readonly tankId: number;
  readonly command: TankCommand;
}

/** Throws loudly on any malformed field. */
export function validateTankCommand(command: TankCommand, label = 'tank command'): void {
  if (command === null || typeof command !== 'object') {
    throw new Error(`${label}: command must be an object, got ${String(command)}`);
  }
  requireFinite(command.throttle, `${label}.throttle`);
  requireFinite(command.steer, `${label}.steer`);
  requireFinite(command.aimYaw, `${label}.aimYaw`);
  requireFinite(command.aimPitch, `${label}.aimPitch`);
  if (command.throttle < -1 || command.throttle > 1) {
    throw new Error(`${label}.throttle must be within -1…1, got ${command.throttle}`);
  }
  if (command.steer < -1 || command.steer > 1) {
    throw new Error(`${label}.steer must be within -1…1, got ${command.steer}`);
  }
  if (command.aimPitch < AIM_PITCH_MIN_DEGREES || command.aimPitch > AIM_PITCH_MAX_DEGREES) {
    throw new Error(
      `${label}.aimPitch must be within ${AIM_PITCH_MIN_DEGREES}…${AIM_PITCH_MAX_DEGREES} degrees, got ${command.aimPitch}`,
    );
  }
  if (typeof command.fire !== 'boolean') {
    throw new Error(`${label}.fire must be a boolean, got ${String(command.fire)}`);
  }
}

/** Validates and returns a canonical command with its yaw wrapped. */
export function normaliseTankCommand(command: TankCommand, label = 'tank command'): TankCommand {
  validateTankCommand(command, label);
  return {
    throttle: command.throttle,
    steer: command.steer,
    aimYaw: normaliseDegrees(command.aimYaw),
    aimPitch: command.aimPitch,
    fire: command.fire,
  };
}

/** A command that does not ask for anything: useful in scripts and tests. */
export function idleTankCommand(targetYawDegrees = 0, targetPitchDegrees = 0): TankCommand {
  return normaliseTankCommand(
    {
      throttle: 0,
      steer: 0,
      aimYaw: targetYawDegrees,
      aimPitch: targetPitchDegrees,
      fire: false,
    },
    'sim.idleTankCommand',
  );
}

function requireFinite(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite, got ${String(value)}`);
  }
}
