import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  decodeCommand,
  encodeCommand,
  isCompatibleRoomMeta,
  parseIntent,
  parseRoomState,
  parseTickBatch,
} from './protocol.ts';
import { changeRoomSetup, createRoomState, addMember, roomMeta, setMemberTeam, startRoomMatch } from './room.ts';

describe('protocol parsing', () => {
  it('quantises a command once, so encode → JSON → decode is exact', () => {
    const wire = encodeCommand({ throttle: 0.33333, steer: -1, aimYaw: 190.123, aimPitch: 24.999, fire: true });
    expect(wire).toEqual([0.333, -1, -169.88, 25, 1, 0]);
    const back = encodeCommand(decodeCommand(JSON.parse(JSON.stringify(wire)), 'c'));
    expect(back).toEqual(wire);
    // A host-set fire lag survives the round trip; without fire it is dropped.
    const lagged = [0, 0, 0, 0, 1, 7];
    expect(encodeCommand(decodeCommand(JSON.parse(JSON.stringify(lagged)), 'c'))).toEqual(lagged);
    expect(encodeCommand(decodeCommand([0, 0, 0, 0, 0, 7], 'c'))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('rejects malformed commands loudly', () => {
    expect(() => decodeCommand([2, 0, 0, 0, 0, 0], 'c')).toThrow(/throttle/);
    expect(() => decodeCommand([0, 0, 0, 0, 1, 21], 'c')).toThrow(/fireLagTicks/);
    expect(() => decodeCommand([0, 0, 0, 0, true, 0], 'c')).toThrow(/fire/);
    expect(() => decodeCommand([0, 0, 0], 'c')).toThrow(/6-element/);
  });

  it('refuses a room of another protocol version with a reload hint', () => {
    const room = createRoomState({ teams: 2, tanksPerTeam: 2, minutes: 5 }, { playerId: 1, name: 'A' });
    expect(parseRoomState(JSON.parse(JSON.stringify(room)))).toEqual(room);
    expect(() => parseRoomState({ ...room, v: PROTOCOL_VERSION + 1 })).toThrow(/reload/);
  });

  it('checks a tick batch row against the seat count', () => {
    expect(() => parseTickBatch({ k: 'ticks', matchNo: 1, from: 0, c: [[[0, 0, 0, 0, 0, 0]]] }, 2)).toThrow(/1 commands for 2 seats/);
  });

  it('rejects unknown intents', () => {
    expect(() => parseIntent({ type: 'teleport' }, 0, 2)).toThrow(/unknown intent/);
    expect(() => parseIntent({ type: 'team', teamId: 3 }, 0, 2)).toThrow(/teamId/);
  });

  it('lists only this game and protocol in the lobby', () => {
    const room = createRoomState({ teams: 2, tanksPerTeam: 2, minutes: 5 }, { playerId: 1, name: 'A' });
    expect(isCompatibleRoomMeta(roomMeta(room))).toBe(true);
    expect(isCompatibleRoomMeta({ ...roomMeta(room), v: 0 })).toBe(false);
    expect(isCompatibleRoomMeta({ mode: 'arena' })).toBe(false);
  });
});

describe('room rules', () => {
  it('a full team refuses a player, and a smaller setup moves players to free seats', () => {
    let room = createRoomState({ teams: 3, tanksPerTeam: 1, minutes: 5 }, { playerId: 1, name: 'A' });
    room = addMember(room, 2, 'B');
    room = addMember(room, 3, 'C');
    expect(room.members.map((m) => m.teamId)).toEqual([0, 1, 2]);
    expect(() => setMemberTeam(room, 3, 0)).toThrow(/full/);
    room = changeRoomSetup(room, { teams: 2, tanksPerTeam: 2, minutes: 5 });
    expect(room.members.map((m) => m.teamId)).toEqual([0, 1, 0]);
  });

  it('START seats players in join order and leaves overflow for the next match', () => {
    let room = createRoomState({ teams: 2, tanksPerTeam: 2, minutes: 5 }, { playerId: 1, name: 'A' });
    room = addMember(room, 2, 'B');
    room = addMember(room, 3, 'C');
    room = changeRoomSetup(room, { teams: 2, tanksPerTeam: 1, minutes: 5 });
    const started = startRoomMatch(room, 7);
    expect(started.match?.seats.map((s) => [s.playerId, s.teamId, s.teamIndex])).toEqual([
      [1, 0, 0],
      [2, 1, 0],
    ]);
    expect(started.match?.matchNo).toBe(1);
  });
});
