import type { RoomPublicInfoResponse } from '../../../src/shared/protocol.ts';
import type { RoomSnapshot, SimEvent } from '../../../src/shared/types.ts';
import { MAX_PLAYERS, type RoomRecord } from './types.ts';

/**
 * Builds a public-safe RoomSnapshot.
 * Never includes resumeToken, resumeTokenHash, sessionId, or idempotencyKey.
 */
export function buildRoomSnapshot(room: RoomRecord, nowMs = Date.now()): RoomSnapshot {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    fillBots: room.fillBots,
    lifecycleState: room.lifecycleState,
    snapshotSeq: Math.max(1, room.snapshotSeq),
    serverTime: nowMs,
    sim: {
      ...room.sim,
      events: room.recentEvents.slice(),
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
  let activeHumans = 0;
  for (const session of room.sessions.values()) {
    if (!session.revoked) {
      activeHumans += 1;
    }
  }

  return {
    roomCode: room.roomCode,
    lifecycleState: room.lifecycleState,
    playerCount: activeHumans,
    maxPlayers: MAX_PLAYERS,
    fillBots: room.fillBots,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
  };
}
