import { createPlayerState } from '../../../src/shared/physics.ts';
import type { RoomLifecycleState } from '../../../src/shared/types.ts';
import { ProtocolError } from '../protocol/errors.ts';
import {
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  ROOM_EMPTY_CLOSE_MS,
  type PlayerSessionRecord,
  type RoomRecord,
  type SeatKind,
} from './types.ts';

const ALLOWED_TRANSITIONS: Record<RoomLifecycleState, readonly RoomLifecycleState[]> = {
  CREATING: ['WAITING', 'CLOSED'],
  WAITING: ['PLAYING', 'CLOSED'],
  PLAYING: ['FALLING', 'FINISHED', 'RESTARTING', 'CLOSED'],
  FALLING: ['PLAYING', 'FINISHED', 'RESTARTING', 'CLOSED'],
  FINISHED: ['RESTARTING', 'CLOSED'],
  RESTARTING: ['WAITING', 'PLAYING', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionLifecycle(from: RoomLifecycleState, to: RoomLifecycleState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionRoomLifecycle(room: RoomRecord, to: RoomLifecycleState): void {
  if (!canTransitionLifecycle(room.lifecycleState, to)) {
    throw new ProtocolError(
      'INVALID_LIFECYCLE_STATE',
      `انتقال حالة غير صالح من ${room.lifecycleState} إلى ${to}.`,
      409,
    );
  }
  room.lifecycleState = to;
}

export function getActiveSessionForSlot(
  room: RoomRecord,
  slot: 0 | 1 | 2 | 3,
): PlayerSessionRecord | null {
  for (const session of room.sessions.values()) {
    if (!session.revoked && session.slot === slot) {
      return session;
    }
  }
  return null;
}

export function getSeatKind(
  room: RoomRecord,
  slot: 0 | 1 | 2 | 3,
  nowMs = Date.now(),
): SeatKind {
  const session = getActiveSessionForSlot(room, slot);
  if (session) {
    if (session.connected) {
      return 'HUMAN_CONNECTED';
    }
    if (nowMs - session.lastSeenAt <= RECONNECT_GRACE_MS && nowMs < session.expiresAt) {
      return 'HUMAN_DISCONNECTED_GRACE';
    }
  }

  const simPlayer = room.sim.players[slot];
  if (simPlayer && simPlayer.isBot && simPlayer.connected) {
    return 'BOT';
  }
  return 'EMPTY';
}

/**
 * Finds an open seat slot (prefers genuinely EMPTY or BOT slots; never steals a seat in grace period).
 */
export function findAvailableSeatSlot(room: RoomRecord, nowMs = Date.now()): 0 | 1 | 2 | 3 | null {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    const kind = getSeatKind(room, slot, nowMs);
    if (kind === 'EMPTY' || kind === 'BOT') {
      return slot;
    }
  }
  return null;
}

/**
 * Synchronizes the 4 raft seats cleanly:
 * - HUMAN_CONNECTED: human stays connected, isBot=false
 * - HUMAN_DISCONNECTED_GRACE: human keeps their seat/cosmetic/name with connected=false, isBot=false (NOT replaced by bot!)
 * - EMPTY or expired: replaced by Bot if fillBots=true, or Empty placeholder if fillBots=false
 */
export function syncBotsInRoom(room: RoomRecord, nowMs = Date.now()): void {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    const session = getActiveSessionForSlot(room, slot);

    if (session) {
      const inGrace = session.connected || (nowMs - session.lastSeenAt <= RECONNECT_GRACE_MS && nowMs < session.expiresAt);
      if (inGrace) {
        const p = room.sim.players[slot];
        p.id = session.playerId;
        p.name = session.name;
        p.cosmetic = session.cosmetic;
        p.isBot = false;
        p.connected = session.connected;
        p.ready = session.ready;
        if (!session.connected) {
          p.farting = false;
          p.moveDir = 0;
        }
        continue;
      }
    }

    if (room.fillBots) {
      const existing = room.sim.players[slot];
      if (!existing || !existing.isBot || !existing.connected) {
        const bot = createPlayerState(slot, { isBot: true, connected: true });
        bot.ready = true;
        room.sim.players[slot] = bot;
      } else {
        existing.ready = true;
      }
    } else {
      room.sim.players[slot] = createPlayerState(slot, {
        id: `empty-${slot}`,
        name: `مقعد ${slot + 1}`,
        isBot: false,
        connected: false,
      });
    }
  }
}

/**
 * Checks whether all active human players are ready before starting a round.
 * Bots are automatically ready; Host is ready by policy; disconnected-in-grace humans block start until ready or expired.
 */
export function validateAllHumansReady(room: RoomRecord): { ok: true } | { ok: false; unreadyNames: string[] } {
  const unreadyNames: string[] = [];
  for (const session of room.sessions.values()) {
    if (session.revoked) continue;
    if (!session.ready) {
      unreadyNames.push(session.name);
    }
  }
  if (unreadyNames.length > 0) {
    return { ok: false, unreadyNames };
  }
  return { ok: true };
}

/**
 * Elects a new host only when the current host permanently left or their 15s reconnect grace expired.
 * If the host is temporarily disconnected within grace, they retain HOST role!
 */
export function reconcileHostLeadership(
  room: RoomRecord,
  nowMs = Date.now(),
): { hostChanged: boolean; newHostId: string } {
  const currentHostSession = room.sessions.get(room.hostId);
  if (currentHostSession && !currentHostSession.revoked) {
    const hostStillValid =
      currentHostSession.connected ||
      (nowMs - currentHostSession.lastSeenAt <= RECONNECT_GRACE_MS && nowMs < currentHostSession.expiresAt);
    if (hostStillValid) {
      return { hostChanged: false, newHostId: room.hostId };
    }
  }

  // Pick next connected human player in slot order (0..3), or remaining active session
  const candidates = Array.from(room.sessions.values())
    .filter((s) => !s.revoked)
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.slot - b.slot;
    });

  if (candidates.length === 0) {
    return { hostChanged: false, newHostId: room.hostId };
  }

  const nextHost = candidates[0];
  const prevHostId = room.hostId;
  for (const s of room.sessions.values()) {
    s.role = s.playerId === nextHost.playerId ? 'HOST' : 'PLAYER';
  }
  nextHost.ready = true;
  room.sim.players[nextHost.slot].ready = true;
  room.hostId = nextHost.playerId;

  return { hostChanged: prevHostId !== nextHost.playerId, newHostId: nextHost.playerId };
}

export function updateRoomEmptyState(room: RoomRecord, nowMs = Date.now()): void {
  const anyConnected = Array.from(room.sessions.values()).some((s) => !s.revoked && s.connected);
  const anyReserved = Array.from(room.sessions.values()).some((s) => !s.revoked);

  if (anyConnected) {
    room.emptySinceMs = null;
  } else if (!anyReserved) {
    room.emptySinceMs = room.emptySinceMs ?? nowMs;
  } else {
    // Disconnected humans still inside grace window -> mark emptySinceMs so abandoned rooms still close eventually
    room.emptySinceMs = room.emptySinceMs ?? nowMs;
  }
}

export function shouldCloseAbandonedRoom(room: RoomRecord, nowMs = Date.now()): boolean {
  if (room.lifecycleState === 'CLOSED') return true;
  if (nowMs >= room.expiresAt) return true;
  const anyActiveHuman = Array.from(room.sessions.values()).some((s) => !s.revoked && s.connected);
  if (anyActiveHuman) return false;

  const anyInGrace = Array.from(room.sessions.values()).some(
    (s) => !s.revoked && nowMs - s.lastSeenAt <= RECONNECT_GRACE_MS,
  );
  if (anyInGrace) return false;

  if (room.emptySinceMs !== null && nowMs - room.emptySinceMs >= ROOM_EMPTY_CLOSE_MS) {
    return true;
  }
  return false;
}

export function getNextAlarmTimestamp(room: RoomRecord, nowMs = Date.now()): number {
  let earliest = room.expiresAt;

  for (const session of room.sessions.values()) {
    if (!session.revoked && !session.connected) {
      const graceExpiry = session.lastSeenAt + RECONNECT_GRACE_MS + 100;
      earliest = Math.min(earliest, graceExpiry, session.expiresAt);
    }
  }

  if (room.emptySinceMs !== null) {
    const emptyCloseAt = room.emptySinceMs + ROOM_EMPTY_CLOSE_MS + 100;
    earliest = Math.min(earliest, emptyCloseAt);
  }

  return Math.max(nowMs + 50, earliest);
}
