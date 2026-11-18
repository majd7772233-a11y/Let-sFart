import type { PublicRoomListingItem, RoomPublicInfoResponse } from '../../../src/shared/protocol.ts';
import type {
  PlayerSimState,
  RoomSnapshot,
  SeatStatus,
  SimEvent,
  SpectatorInfo,
} from '../../../src/shared/types.ts';
import {
  countActiveSpectators,
  getEffectiveMaxPlayers,
  getSeatStatusSnapshot,
  getSpectatorSessions,
} from './lifecycle.ts';
import { isSpectatorSession } from './sessions.ts';
import type { RoomRecord } from './types.ts';

function resolveHostName(room: RoomRecord): string {
  const hostSession = room.sessions.get(room.hostId);
  if (hostSession && !hostSession.revoked) {
    return hostSession.name;
  }
  const firstActive = Array.from(room.sessions.values()).find((s) => !s.revoked && !isSpectatorSession(s));
  return firstActive?.name ?? room.sim.players[0]?.name ?? 'قبطان';
}

function countActiveHumans(room: RoomRecord): number {
  let activeHumans = 0;
  for (const session of room.sessions.values()) {
    if (!session.revoked && !isSpectatorSession(session)) {
      activeHumans += 1;
    }
  }
  return activeHumans;
}

/**
 * Builds a public-safe RoomSnapshot.
 * Never includes resumeToken, resumeTokenHash, passwordHash, sessionId, or idempotencyKey.
 */
export function buildRoomSnapshot(room: RoomRecord, nowMs = Date.now()): RoomSnapshot {
  const seats: [SeatStatus, SeatStatus, SeatStatus, SeatStatus] = [
    getSeatStatusSnapshot(room, 0, nowMs),
    getSeatStatusSnapshot(room, 1, nowMs),
    getSeatStatusSnapshot(room, 2, nowMs),
    getSeatStatusSnapshot(room, 3, nowMs),
  ];

  const players = room.sim.players.map((p, idx) => {
    const activeEmote =
      p.activeEmote && nowMs < p.activeEmote.expiresAtMs ? p.activeEmote : null;
    return {
      ...p,
      activeEmote,
      seatStatus: seats[idx],
    };
  }) as [PlayerSimState, PlayerSimState, PlayerSimState, PlayerSimState];

  const spectators: SpectatorInfo[] = getSpectatorSessions(room).map((s) => ({
    id: s.playerId,
    name: s.name,
    connected: s.connected,
    cosmetic: s.cosmetic,
    joinedAt: s.joinedAt,
  }));

  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    fillBots: room.fillBots,
    isPrivate: room.isPrivate,
    maxPlayers: getEffectiveMaxPlayers(room),
    settings: { ...room.settings },
    courseId: room.courseId,
    courseSelectionMode: room.courseSelectionMode,
    courseVotes: { ...room.courseVotes },
    lifecycleState: room.lifecycleState,
    roundSeq: room.roundSeq ?? 1,
    snapshotSeq: Math.max(1, room.snapshotSeq),
    serverTime: nowMs,
    seats,
    spectators,
    spectatorCount: spectators.length,
    playlistQueue: (room.playlistQueue ?? []).slice(),
    recentChat: (room.recentChat ?? []).slice(-25),
    sim: {
      ...room.sim,
      players,
      events: (room.recentEvents ?? []).slice(),
    },
  };
}

export function issueNextRoomSnapshot(room: RoomRecord, nowMs = Date.now()): RoomSnapshot {
  room.snapshotSeq = Math.max(0, room.snapshotSeq) + 1;
  return buildRoomSnapshot(room, nowMs);
}

export function getEventsSince(room: RoomRecord, afterEventId = 0): SimEvent[] {
  if (afterEventId <= 0) {
    return room.recentEvents.slice();
  }
  return room.recentEvents.filter((ev) => ev.id > afterEventId);
}

export function buildRoomPublicInfo(room: RoomRecord): RoomPublicInfoResponse {
  return {
    roomCode: room.roomCode,
    hostName: resolveHostName(room),
    lifecycleState: room.lifecycleState,
    playerCount: countActiveHumans(room),
    maxPlayers: getEffectiveMaxPlayers(room),
    spectatorCount: countActiveSpectators(room),
    fillBots: room.fillBots,
    isPrivate: room.isPrivate,
    courseId: room.courseId,
    gameMode: room.settings.gameMode,
    difficulty: room.settings.difficulty,
    enableItems: room.settings.enableItems,
    roundTimeLimitSec: room.settings.roundTimeLimitSec,
    settings: { ...room.settings },
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
  };
}

export function buildPublicRoomListing(room: RoomRecord): PublicRoomListingItem {
  return {
    roomCode: room.roomCode,
    hostName: resolveHostName(room),
    lifecycleState: room.lifecycleState,
    playerCount: countActiveHumans(room),
    maxPlayers: getEffectiveMaxPlayers(room),
    spectatorCount: countActiveSpectators(room),
    fillBots: room.fillBots,
    courseId: room.courseId,
    gameMode: room.settings.gameMode,
    difficulty: room.settings.difficulty,
    enableItems: room.settings.enableItems,
    roundTimeLimitSec: room.settings.roundTimeLimitSec,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
  };
}
