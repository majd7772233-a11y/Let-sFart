import { getDefaultBotPersonality } from '../../../src/shared/bots.ts';
import { createPlayerState } from '../../../src/shared/physics.ts';
import type { RoomLifecycleState, SeatStatus } from '../../../src/shared/types.ts';
import { ProtocolError } from '../protocol/errors.ts';
import { opsMetrics } from '../services/metrics.ts';
import { isSpectatorSession } from './sessions.ts';
import {
  BOT_SUBSTITUTE_DELAY_MS,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  ROOM_EMPTY_CLOSE_MS,
  type PlayerSessionRecord,
  type RoomRecord,
  type SeatKind,
} from './types.ts';

const ALLOWED_TRANSITIONS: Record<RoomLifecycleState, readonly RoomLifecycleState[]> = {
  CREATING: ['WAITING', 'CLOSED'],
  WAITING: ['PLAYING', 'RESTARTING', 'CLOSED'],
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

export function getSpectatorSessions(room: RoomRecord): PlayerSessionRecord[] {
  return Array.from(room.sessions.values())
    .filter((s) => !s.revoked && isSpectatorSession(s))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

export function countActiveSpectators(room: RoomRecord): number {
  let count = 0;
  for (const session of room.sessions.values()) {
    if (!session.revoked && isSpectatorSession(session)) {
      count += 1;
    }
  }
  return count;
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

export function getSeatStatusSnapshot(
  room: RoomRecord,
  slot: 0 | 1 | 2 | 3,
  nowMs = Date.now(),
): SeatStatus {
  const kind = getSeatKind(room, slot, nowMs);
  switch (kind) {
    case 'HUMAN_CONNECTED':
      return 'CONNECTED';
    case 'HUMAN_DISCONNECTED_GRACE':
      return 'RECONNECTING';
    case 'BOT':
      return 'BOT';
    default:
      return 'EMPTY';
  }
}

export function getEffectiveMaxPlayers(room: RoomRecord): number {
  const configured = room.settings?.maxPlayers ?? MAX_PLAYERS;
  return Math.max(2, Math.min(MAX_PLAYERS, configured));
}

/**
 * Finds an open seat slot (prefers genuinely EMPTY or BOT slots; never steals a seat in grace period or reserved in-flight).
 */
export function findAvailableSeatSlot(
  room: RoomRecord,
  nowMs = Date.now(),
  reservedSlots?: ReadonlySet<number>,
): 0 | 1 | 2 | 3 | null {
  const limit = getEffectiveMaxPlayers(room);
  for (let i = 0; i < limit; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    if (reservedSlots?.has(slot)) continue;
    const kind = getSeatKind(room, slot, nowMs);
    if (kind === 'EMPTY' || kind === 'BOT') {
      return slot;
    }
  }
  return null;
}

/**
 * ONLINE-07: Promotes queued spectators (earliest joined connected spectators first)
 * into any open player seats up to maxPlayers when entering WAITING / next round.
 */
export function promoteWaitingSpectators(
  room: RoomRecord,
  nowMs = Date.now(),
  reservedSlots?: ReadonlySet<number>,
): string[] {
  const spectators = getSpectatorSessions(room).sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.joinedAt - b.joinedAt;
  });

  const promotedIds: string[] = [];
  const hasValidHost = (() => {
    const host = room.sessions.get(room.hostId);
    return Boolean(
      host &&
        !host.revoked &&
        !isSpectatorSession(host) &&
        (host.connected || (nowMs - host.lastSeenAt <= RECONNECT_GRACE_MS && nowMs < host.expiresAt)),
    );
  })();

  let assignedHostAlready = hasValidHost;

  for (const spec of spectators) {
    const openSlot = findAvailableSeatSlot(room, nowMs, reservedSlots);
    if (openSlot === null) break;

    spec.slot = openSlot;
    spec.role = assignedHostAlready ? 'PLAYER' : 'HOST';
    if (!assignedHostAlready) {
      room.hostId = spec.playerId;
      assignedHostAlready = true;
    }
    spec.ready = spec.role === 'HOST';

    const p = room.sim.players[openSlot];
    p.id = spec.playerId;
    p.name = spec.name;
    p.cosmetic = spec.cosmetic;
    p.isBot = false;
    p.connected = spec.connected;
    p.ready = spec.ready;
    p.seatStatus = spec.connected ? 'CONNECTED' : 'RECONNECTING';
    if (spec.accountId) p.accountId = spec.accountId;
    if (spec.playerLevel) p.playerLevel = spec.playerLevel;
    promotedIds.push(spec.playerId);
  }

  return promotedIds;
}

/**
 * BOT-04: During active gameplay (PLAYING / FALLING), if a seated human player remains disconnected
 * for >= BOT_SUBSTITUTE_DELAY_MS inside the 15s grace window, activate temporary AI takeover
 * while keeping their seat, identity, cosmetic, and reconnect rights intact.
 */
export function activateTempBotSubstitutesIfNeeded(
  room: RoomRecord,
  nowMs = Date.now(),
): boolean {
  if (room.lifecycleState !== 'PLAYING' && room.lifecycleState !== 'FALLING') {
    return false;
  }

  let changed = false;
  let newlyActivated = 0;

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    const session = getActiveSessionForSlot(room, slot);
    const p = room.sim.players[slot];
    if (!session || !p) continue;

    if (session.connected) {
      if (p.tempBotSubstitute) {
        p.tempBotSubstitute = false;
        p.isBot = false;
        p.connected = true;
        p.seatStatus = 'CONNECTED';
        changed = true;
      }
      continue;
    }

    const elapsedDisconnected = nowMs - session.lastSeenAt;
    const inGrace = elapsedDisconnected <= RECONNECT_GRACE_MS && nowMs < session.expiresAt;
    if (inGrace && elapsedDisconnected >= BOT_SUBSTITUTE_DELAY_MS && !p.tempBotSubstitute) {
      p.tempBotSubstitute = true;
      p.isBot = true;
      p.connected = true;
      p.seatStatus = 'RECONNECTING';
      p.botPersonality = room.settings?.botPersonalities?.[slot] ?? getDefaultBotPersonality(slot);
      changed = true;
      newlyActivated += 1;
    }
  }

  if (newlyActivated > 0) {
    opsMetrics.recordTempSubstituteActivated(newlyActivated);
  }
  return changed;
}

/**
 * Synchronizes the 4 raft seats cleanly:
 * - HUMAN_CONNECTED: human stays connected, isBot=false
 * - HUMAN_DISCONNECTED_GRACE: human keeps their seat/cosmetic/name; if active gameplay >= 6s, tempBotSubstitute assists
 * - Slot >= maxPlayers: forced to EMPTY unless an active session holds it
 * - EMPTY or expired within maxPlayers: replaced by Bot if fillBots=true, or Empty placeholder if fillBots=false
 */
export function syncBotsInRoom(room: RoomRecord, nowMs = Date.now()): void {
  const limit = getEffectiveMaxPlayers(room);
  room.sim.botDifficulty = room.settings?.botDifficulty ?? 'normal';
  const isActiveGame = room.lifecycleState === 'PLAYING' || room.lifecycleState === 'FALLING';

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    const session = getActiveSessionForSlot(room, slot);
    const personality = room.settings?.botPersonalities?.[slot] ?? getDefaultBotPersonality(slot);

    if (session) {
      const elapsedDisconnected = nowMs - session.lastSeenAt;
      const inGrace =
        session.connected || (elapsedDisconnected <= RECONNECT_GRACE_MS && nowMs < session.expiresAt);
      if (inGrace) {
        const p = room.sim.players[slot];
        p.id = session.playerId;
        p.name = session.name;
        p.cosmetic = session.cosmetic;
        p.ready = session.ready;
        p.botPersonality = personality;
        if (session.accountId) p.accountId = session.accountId;
        if (session.playerLevel) p.playerLevel = session.playerLevel;

        if (session.connected) {
          p.tempBotSubstitute = false;
          p.isBot = false;
          p.connected = true;
          p.seatStatus = 'CONNECTED';
        } else if (isActiveGame && elapsedDisconnected >= BOT_SUBSTITUTE_DELAY_MS) {
          p.tempBotSubstitute = true;
          p.isBot = true;
          p.connected = true;
          p.seatStatus = 'RECONNECTING';
        } else {
          p.tempBotSubstitute = false;
          p.isBot = false;
          p.connected = false;
          p.seatStatus = 'RECONNECTING';
          p.farting = false;
          p.moveDir = 0;
        }
        continue;
      }
    }

    if (i < limit && room.fillBots) {
      const existing = room.sim.players[slot];
      if (!existing || !existing.isBot || !existing.connected || existing.tempBotSubstitute) {
        const bot = createPlayerState(slot, { isBot: true, connected: true });
        bot.ready = true;
        bot.seatStatus = 'BOT';
        bot.tempBotSubstitute = false;
        bot.botPersonality = personality;
        room.sim.players[slot] = bot;
      } else {
        existing.ready = true;
        existing.seatStatus = 'BOT';
        existing.tempBotSubstitute = false;
        existing.botPersonality = personality;
      }
    } else {
      const empty = createPlayerState(slot, {
        id: `empty-${slot}`,
        name: `مقعد ${slot + 1}`,
        isBot: false,
        connected: false,
      });
      empty.seatStatus = 'EMPTY';
      empty.tempBotSubstitute = false;
      empty.botPersonality = personality;
      room.sim.players[slot] = empty;
    }
  }
}

/**
 * Checks whether all active seated human players are ready before starting a round.
 * Spectators never block the host from starting!
 */
export function validateAllHumansReady(room: RoomRecord): { ok: true } | { ok: false; unreadyNames: string[] } {
  const unreadyNames: string[] = [];
  for (const session of room.sessions.values()) {
    if (session.revoked || isSpectatorSession(session)) continue;
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
 * Spectators are never elected host unless all seated players are gone (then earliest spectator is promoted).
 */
export function reconcileHostLeadership(
  room: RoomRecord,
  nowMs = Date.now(),
): { hostChanged: boolean; newHostId: string } {
  const currentHostSession = room.sessions.get(room.hostId);
  if (currentHostSession && !currentHostSession.revoked && !isSpectatorSession(currentHostSession)) {
    const hostStillValid =
      currentHostSession.connected ||
      (nowMs - currentHostSession.lastSeenAt <= RECONNECT_GRACE_MS && nowMs < currentHostSession.expiresAt);
    if (hostStillValid) {
      return { hostChanged: false, newHostId: room.hostId };
    }
  }

  // Pick next connected seated human player in slot order (0..3), or remaining seated session
  const seatedCandidates = Array.from(room.sessions.values())
    .filter((s) => !s.revoked && !isSpectatorSession(s))
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.slot - b.slot;
    });

  if (seatedCandidates.length === 0) {
    // If only spectators remain and room is WAITING/FINISHED, promote first spectator into slot 0 & HOST
    if (room.lifecycleState === 'WAITING' || room.lifecycleState === 'FINISHED') {
      const specCandidates = getSpectatorSessions(room).sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        return a.joinedAt - b.joinedAt;
      });
      if (specCandidates.length > 0) {
        const nextHost = specCandidates[0];
        nextHost.slot = 0;
        nextHost.role = 'HOST';
        nextHost.ready = true;
        room.hostId = nextHost.playerId;
        const p = room.sim.players[0];
        p.id = nextHost.playerId;
        p.name = nextHost.name;
        p.cosmetic = nextHost.cosmetic;
        p.isBot = false;
        p.connected = nextHost.connected;
        p.ready = true;
        p.seatStatus = nextHost.connected ? 'CONNECTED' : 'RECONNECTING';
        return { hostChanged: true, newHostId: nextHost.playerId };
      }
    }
    return { hostChanged: false, newHostId: room.hostId };
  }

  const nextHost = seatedCandidates[0];
  const prevHostId = room.hostId;
  for (const s of room.sessions.values()) {
    if (isSpectatorSession(s)) {
      s.role = 'SPECTATOR';
      continue;
    }
    s.role = s.playerId === nextHost.playerId ? 'HOST' : 'PLAYER';
  }
  nextHost.ready = true;
  const nextSlot = nextHost.slot;
  if (nextSlot !== -1) {
    room.sim.players[nextSlot].ready = true;
  }
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
