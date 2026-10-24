/**
 * The online room as plain data: who is in it, which team each player asked for, the
 * setup, and the seats of the match once the host presses START.
 *
 * Only the host runs these transitions; everyone else receives the result as room
 * state. Pure functions, no network and no DOM, so the rules are unit-tested.
 */

import { MAX_TANKS_PER_TEAM, MAX_TEAMS } from '../core/sim.ts';
import { DEFAULT_MATCH_MINUTES } from '../game/matchSetup.ts';
import {
  PROTOCOL_VERSION,
  ROOM_GAME_TAG,
  validateRoomSetup,
  type MatchSeat,
  type MatchSpec,
  type RoomMember,
  type RoomMeta,
  type RoomSetup,
  type RoomState,
} from './protocol.ts';

export const DEFAULT_ROOM_SETUP: RoomSetup = Object.freeze({
  teams: 2,
  tanksPerTeam: MAX_TANKS_PER_TEAM,
  minutes: DEFAULT_MATCH_MINUTES,
});

/** The most humans a room can seat: one per tank. */
export const MAX_ROOM_PLAYERS = MAX_TEAMS * MAX_TANKS_PER_TEAM;

export function createRoomState(setup: RoomSetup, host: { playerId: number; name: string }): RoomState {
  return {
    v: PROTOCOL_VERSION,
    phase: 'room',
    setup: validateRoomSetup(setup),
    members: [{ playerId: host.playerId, name: host.name, teamId: 0 }],
    match: null,
  };
}

/** How many members asked for each team. */
export function teamCounts(state: RoomState): number[] {
  const counts = new Array<number>(state.setup.teams).fill(0);
  for (const member of state.members) counts[member.teamId] = (counts[member.teamId] ?? 0) + 1;
  return counts;
}

/** The team with the fewest members (lowest id on a tie): where a newcomer goes. */
function emptiestTeam(state: RoomState): number {
  const counts = teamCounts(state);
  let best = 0;
  for (let team = 1; team < counts.length; team += 1) {
    if (counts[team]! < counts[best]!) best = team;
  }
  return best;
}

export function addMember(state: RoomState, playerId: number, name: string): RoomState {
  if (state.members.some((member) => member.playerId === playerId)) return state;
  const member: RoomMember = { playerId, name, teamId: emptiestTeam(state) };
  return { ...state, members: [...state.members, member] };
}

export function removeMember(state: RoomState, playerId: number): RoomState {
  return { ...state, members: state.members.filter((member) => member.playerId !== playerId) };
}

/** Moves a member to a team. A full team refuses with a reason the UI shows. */
export function setMemberTeam(state: RoomState, playerId: number, teamId: number): RoomState {
  if (!Number.isInteger(teamId) || teamId < 0 || teamId >= state.setup.teams) {
    throw new Error(`room: team ${teamId} is not in this ${state.setup.teams}-team setup`);
  }
  const member = state.members.find((candidate) => candidate.playerId === playerId);
  if (!member) throw new Error(`room: player ${playerId} is not in the room`);
  if (member.teamId === teamId) return state;
  if (teamCounts(state)[teamId]! >= state.setup.tanksPerTeam) {
    throw new Error(`room: team ${teamId + 1} is full`);
  }
  return {
    ...state,
    members: state.members.map((candidate) => (candidate.playerId === playerId ? { ...candidate, teamId } : candidate)),
  };
}

/**
 * Changes the setup. Members on a team that no longer exists, or beyond a smaller
 * squad size, are moved to the emptiest team that still has room.
 */
export function changeRoomSetup(state: RoomState, setup: RoomSetup): RoomState {
  const next: RoomState = { ...state, setup: validateRoomSetup(setup), members: [] };
  let result = next;
  for (const member of state.members) {
    const counts = teamCounts(result);
    const keep = member.teamId < setup.teams && counts[member.teamId]! < setup.tanksPerTeam;
    const teamId = keep ? member.teamId : emptiestTeam(result);
    result = { ...result, members: [...result.members, { ...member, teamId }] };
  }
  return result;
}

/**
 * START: every member who fits gets a seat on the team they chose, in join order;
 * members beyond a team's squad size watch this match and play the next.
 */
export function startRoomMatch(state: RoomState, seed: number): RoomState {
  const used = new Array<number>(state.setup.teams).fill(0);
  const seats: MatchSeat[] = [];
  for (const member of state.members) {
    const teamIndex = used[member.teamId]!;
    if (teamIndex >= state.setup.tanksPerTeam) continue;
    used[member.teamId] = teamIndex + 1;
    seats.push({ playerId: member.playerId, name: member.name, teamId: member.teamId, teamIndex });
  }
  if (seats.length === 0) throw new Error('room: START needs at least one player');
  const match: MatchSpec = {
    matchNo: (state.match?.matchNo ?? 0) + 1,
    seed,
    setup: state.setup,
    seats,
  };
  return { ...state, phase: 'match', match };
}

/** After a match, the host brings everyone back to the room screen. */
export function returnToRoom(state: RoomState): RoomState {
  return { ...state, phase: 'room' };
}

export function roomMeta(state: RoomState): RoomMeta {
  return { game: ROOM_GAME_TAG, v: PROTOCOL_VERSION, phase: state.phase, setup: state.setup };
}

/** The seat index of a player in a match, or null when they are watching. */
export function seatIndexOf(match: MatchSpec, playerId: number): number | null {
  const index = match.seats.findIndex((seat) => seat.playerId === playerId);
  return index < 0 ? null : index;
}
