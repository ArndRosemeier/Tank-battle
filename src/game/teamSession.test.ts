import { describe, expect, it } from 'vitest';
import { idleTankCommand, normaliseDegrees, type TankCommand } from '../core/sim.ts';
import { ScriptedController } from '../core/sim/controller.ts';
import type { PlayerInput } from './input.ts';
import { ARENA_BOUNDS } from './levels/arena.ts';
import { TeamSession, createVanguardStandIn } from './teamSession.ts';
import type { AimCamera } from './aim.ts';

const TEST_CAMERA: AimCamera = {
  position: { x: 0, y: 6, z: 18 },
  target: { x: 0, y: 0.2, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovDegrees: 50,
  aspect: 16 / 9,
};

function heldInput(): PlayerInput {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    pointerX: 0,
    pointerY: 0,
    fire: false,
  };
}

describe('the player team', () => {
  it('starts with the player plus three AI squadmates, against three teams of four', () => {
    const session = new TeamSession({ seed: 5 });
    expect(session.state.teams).toHaveLength(4);
    expect(session.playerTankId).toBe(0);
    expect(session.playerTeamId).toBe(0);

    const squad = session.squad;
    expect(squad).toHaveLength(4);
    expect(squad[0]?.id).toBe(session.playerTankId);
    expect(squad[0]?.teamId).toBe(session.playerTeamId);
    expect(squad.slice(1).every((tank) => tank.teamId === session.playerTeamId)).toBe(true);
    expect(squad.slice(1).every((tank) => tank.alive)).toBe(true);
    expect(squad.map((tank) => tank.teamIndex)).toEqual([0, 1, 2, 3]);

    for (const team of session.state.teams) {
      expect(team.tanks).toHaveLength(4);
    }
    expect(session.state.tanks.filter((tank) => tank.teamId !== 0)).toHaveLength(12);
  });

  it('points the player at the arena centre while the seeded corner rotation remains', () => {
    const centres = new Set<string>();
    for (const seed of [0, 1, 2, 3]) {
      const session = new TeamSession({ seed });
      const player = session.squad[0]!;
      const centreX = (ARENA_BOUNDS.minX + ARENA_BOUNDS.maxX) / 2;
      const centreZ = (ARENA_BOUNDS.minZ + ARENA_BOUNDS.maxZ) / 2;
      const expected = normaliseDegrees(
        (Math.atan2(-(centreX - player.x), -(centreZ - player.z)) * 180) / Math.PI,
      );
      expect(player.hullYawDegrees).toBeCloseTo(expected, 10);
      expect(player.turretYawDegrees).toBeCloseTo(expected, 10);
      expect(player.aimPitchDegrees).toBe(0);
      // A corner spawn is preserved: the four seeds use four different pads.
      centres.add(`${player.x.toFixed(1)},${player.z.toFixed(1)}`);
    }
    expect(centres.size).toBe(4);
  });

  it('is deterministic for a seed and a scripted player', () => {
    let firstTick = 0;
    const firstInput = (): PlayerInput => {
      firstTick += 1;
      return heldInput();
    };
    let secondTick = 0;
    const secondInput = (): PlayerInput => {
      secondTick += 1;
      return heldInput();
    };
    const first = new TeamSession({ seed: 11, readInput: firstInput, readAimCamera: () => TEST_CAMERA });
    const second = new TeamSession({ seed: 11, readInput: secondInput, readAimCamera: () => TEST_CAMERA });
    first.runTicks(360);
    second.runTicks(360);
    expect(first.hash()).toBe(second.hash());
    expect(first.state.tick).toBe(360);
    expect(firstTick).toBe(360);
    expect(secondTick).toBe(360);

    const other = new TeamSession({ seed: 12, readInput: () => heldInput(), readAimCamera: () => TEST_CAMERA });
    other.runTicks(360);
    expect(other.hash()).not.toBe(first.hash());
  });

  it('the player can spawn a shell and a squadmate is immune to it', () => {
    const fire: TankCommand = {
      throttle: 0,
      steer: 0,
      aimYaw: -90,
      aimPitch: 0,
      fire: true,
    };
    const commands: TankCommand[] = [fire];
    for (let index = 1; index < 8; index += 1) {
      commands.push(idleTankCommand(-90));
    }
    const session = new TeamSession({
      seed: 2,
      playerController: new ScriptedController(new Map([[0, commands]])),
    });
    const [player, squadmate] = session.squad;
    if (!player || !squadmate) throw new Error('test: the squad is incomplete');
    // Stage an open north-margin line: the muzzle is 3 m ahead of the player, the
    // squadmate's body is 5 m ahead. Q2 says the shell stops and does no damage.
    player.x = 18;
    player.z = 6;
    player.hullYawDegrees = -90;
    player.turretYawDegrees = -90;
    player.aimPitchDegrees = 0;
    squadmate.x = 23;
    squadmate.z = 6;
    squadmate.hullYawDegrees = -90;
    squadmate.turretYawDegrees = -90;
    squadmate.aimPitchDegrees = 0;

    session.runTicks(5);
    expect(session.state.stats.shotsFired).toBeGreaterThanOrEqual(1);
    expect(session.state.shells).toHaveLength(0);
    expect(session.state.stats.hits).toBe(0);
    expect(squadmate.hp).toBe(3);
    expect(squadmate.alive).toBe(true);
  });

  it('the stand-in is an ordinary controller on the player tank', () => {
    const session = new TeamSession({
      seed: 7,
      playerController: createVanguardStandIn(7),
    });
    const inputSession = new TeamSession({ seed: 7, readInput: heldInput, readAimCamera: () => TEST_CAMERA });
    expect(session.playerTankId).toBe(inputSession.playerTankId);
    session.runTicks(600);
    inputSession.runTicks(600);
    // The vanguard drives the player's tank; the idle player does not. Same seed and
    // same staging, different controller: the match must differ.
    expect(session.hash()).not.toBe(inputSession.hash());
    expect(session.state.tick).toBe(600);
  });
});
