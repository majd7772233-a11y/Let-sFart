import type { PlayerCosmetic, PlayerRole } from '../../../src/shared/types.ts';
import { generatePlayerId, generateSessionId } from '../lib/ids.ts';
import { generateResumeToken, hashToken, verifyTokenHash } from '../lib/tokens.ts';
import { ProtocolError } from '../protocol/errors.ts';
import {
  RECONNECT_GRACE_MS,
  SESSION_TTL_MS,
  type PlayerSessionRecord,
  type RoomRecord,
  type SocketBinding,
} from './types.ts';

export interface IssuedSessionCredentials {
  session: PlayerSessionRecord;
  resumeToken: string;
}

export class SessionManager {
  private rotatingPlayers = new Set<string>();

  public async createSession(opts: {
    roomCode: string;
    slot: 0 | 1 | 2 | 3;
    role: PlayerRole;
    name: string;
    cosmetic: PlayerCosmetic;
    nowMs?: number;
  }): Promise<IssuedSessionCredentials> {
    const nowMs = opts.nowMs ?? Date.now();
    const playerId = generatePlayerId();
    const sessionId = generateSessionId();
    const resumeToken = generateResumeToken();
    const resumeTokenHash = await hashToken(resumeToken);

    const session: PlayerSessionRecord = {
      playerId,
      roomCode: opts.roomCode,
      slot: opts.slot,
      role: opts.role,
      name: opts.name,
      cosmetic: opts.cosmetic,
      resumeTokenHash,
      sessionId,
      connectionEpoch: 1,
      connected: false,
      ready: opts.role === 'HOST', // Host starts ready; non-host joins as unready per SRV-08
      revoked: false,
      lastSeenAt: nowMs,
      expiresAt: nowMs + SESSION_TTL_MS,
      lastInputSeq: 0,
    };

    return { session, resumeToken };
  }

  /**
   * Authenticates a WebSocket using (playerId + resumeToken), rejects playerId-only or concurrent race attempts,
   * verifies CAS before committing, enforces single-active-socket replacement, and rotates resumeToken atomically.
   */
  public async authenticateAndRotate(opts: {
    room: RoomRecord;
    playerId: string;
    resumeToken: string;
    nowMs?: number;
  }): Promise<{ session: PlayerSessionRecord; newResumeToken: string; replacedOldEpoch: boolean }> {
    const nowMs = opts.nowMs ?? Date.now();
    const lockKey = `${opts.room.roomCode}:${opts.playerId}`;

    if (this.rotatingPlayers.has(lockKey)) {
      throw new ProtocolError('UNAUTHORIZED', 'عملية المصادقة قيد التنفيذ بالفعل، يرجى المحاولة مجدداً.', 401);
    }

    const session = opts.room.sessions.get(opts.playerId);

    if (!session || session.revoked || session.roomCode !== opts.room.roomCode) {
      throw new ProtocolError('UNAUTHORIZED', 'الجلسة غير صالحة أو لا تنتمي لهذه الغرفة.', 401);
    }

    if (nowMs >= session.expiresAt) {
      throw new ProtocolError('SESSION_EXPIRED', 'انتهت صلاحية الجلسة.', 401);
    }

    // If disconnected longer than grace period (when not initial pre-connect), expire session
    if (!session.connected && nowMs - session.lastSeenAt > RECONNECT_GRACE_MS && session.connectionEpoch > 1) {
      session.revoked = true;
      throw new ProtocolError('SESSION_EXPIRED', 'انتهت مهلة إعادة الاتصال الخاصة بهذه الجلسة.', 401);
    }

    const expectedHash = session.resumeTokenHash;
    const expectedEpoch = session.connectionEpoch;
    this.rotatingPlayers.add(lockKey);

    try {
      const valid = await verifyTokenHash(opts.resumeToken, expectedHash);
      if (!valid) {
        throw new ProtocolError('UNAUTHORIZED', 'رمز استعادة الجلسة غير صحيح.', 401);
      }

      const newResumeToken = generateResumeToken();
      const newResumeTokenHash = await hashToken(newResumeToken);

      // Atomic Compare-And-Swap guard: reject if state mutated across await boundaries
      if (
        session.revoked ||
        session.resumeTokenHash !== expectedHash ||
        session.connectionEpoch !== expectedEpoch
      ) {
        throw new ProtocolError('UNAUTHORIZED', 'انتهت صلاحية رمز الاستعادة أو تم استبداله.', 401);
      }

      const replacedOldEpoch = session.connected;
      session.resumeTokenHash = newResumeTokenHash;
      session.connectionEpoch += 1;
      session.sessionId = generateSessionId();
      session.connected = true;
      session.lastSeenAt = nowMs;
      session.expiresAt = nowMs + SESSION_TTL_MS;
      session.lastInputSeq = 0; // Fresh sequence window bound to new connectionEpoch

      return { session, newResumeToken, replacedOldEpoch };
    } finally {
      this.rotatingPlayers.delete(lockKey);
    }
  }

  public assertActiveSessionBinding(
    room: RoomRecord,
    binding: SocketBinding,
  ): PlayerSessionRecord {
    if (!binding.authenticated || !binding.playerId || !binding.sessionId) {
      throw new ProtocolError('UNAUTHORIZED', undefined, 401);
    }

    const session = room.sessions.get(binding.playerId);
    if (!session || session.revoked) {
      throw new ProtocolError('SESSION_EXPIRED', undefined, 401);
    }

    if (session.sessionId !== binding.sessionId || session.connectionEpoch !== binding.connectionEpoch) {
      throw new ProtocolError('SESSION_REPLACED', undefined, 409);
    }

    return session;
  }

  public assertHostPermission(session: PlayerSessionRecord, room: RoomRecord, command: string): void {
    if (session.role !== 'HOST' || room.hostId !== session.playerId) {
      throw new ProtocolError('FORBIDDEN_HOST_ONLY', undefined, 403, command);
    }
  }

  public validateAndConsumeInputSeq(session: PlayerSessionRecord, seq: number): boolean {
    if (seq <= session.lastInputSeq) {
      return false;
    }
    session.lastInputSeq = seq;
    return true;
  }

  public expireGraceSessions(room: RoomRecord, nowMs = Date.now()): string[] {
    const expiredIds: string[] = [];
    for (const [playerId, session] of room.sessions.entries()) {
      if (session.revoked) continue;
      if (!session.connected && (nowMs - session.lastSeenAt > RECONNECT_GRACE_MS || nowMs >= session.expiresAt)) {
        session.revoked = true;
        expiredIds.push(playerId);
      }
    }
    return expiredIds;
  }
}
