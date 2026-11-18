import { isValidCourseId } from '../../../src/shared/course.ts';
import { createInitialSimState, normalizeRoomSettings } from '../../../src/shared/physics.ts';
import { buildMatchSummaryFromSim } from '../../../src/shared/progression.ts';
import type {
  BatchOnlineMatchParticipant,
  CreateRoomHttpRequest,
  JoinRoomHttpRequest,
  PublicRoomListingItem,
  RoomSessionCredentials,
  ServerProtocolMessage,
} from '../../../src/shared/protocol.ts';
import type {
  CourseId,
  ReplayPlayerRosterItem,
  RoundReplayRecord,
  VerifiedMatchRecord,
} from '../../../src/shared/types.ts';
import {
  CLIENT_IP_HEADER_NAME,
  createWebSocketPair,
  createWebSocketUpgradeResponse,
  INTERNAL_HEADER_NAME,
  INTERNAL_HEADER_VALUE,
  type Env,
} from '../env.ts';
import { recordVerifiedMatchInD1, saveRoundReplayInD1 } from '../db/d1Store.ts';
import { logServerEvent } from '../lib/logger.ts';
import {
  consumeDurableTokenBucket,
  HTTP_CHANNEL_LIMITS,
  type HttpRateChannel,
  SessionRateLimiter,
} from '../lib/rateLimit.ts';
import { isValidRoomCode, normalizeRoomCode } from '../lib/roomCode.ts';
import { generateResumeToken, hashToken } from '../lib/tokens.ts';
import { sanitizeCosmeticOrDefault, sanitizePlayerName } from '../lib/validation.ts';
import { ERROR_MESSAGES_AR, makeErrorPayload, ProtocolError } from '../protocol/errors.ts';
import {
  makeGameEventMsg,
  makeGameSnapshotMsg,
  makeRoomErrorMsg,
  makeRoomStateMsg,
} from '../protocol/messages.ts';
import type { SeatSlotOrSpectator, SpectateJoinMode } from '../../../src/shared/protocol.ts';
import { PartyController } from '../party/PartyController.ts';
import { ProgressionController } from '../progression/ProgressionController.ts';
import { opsMetrics } from '../services/metrics.ts';
import { PROGRESSION_DO_NAME, recordOnlineBatchViaService } from '../services/progressionService.ts';
import { verifyMatchResult } from '../services/resultVerifier.ts';
import { applyCoursePreviewToSim } from './courses.ts';
import {
  countActiveSpectators,
  findAvailableSeatSlot,
  getNextAlarmTimestamp,
  reconcileHostLeadership,
  shouldCloseAbandonedRoom,
  syncBotsInRoom,
  transitionRoomLifecycle,
  updateRoomEmptyState,
} from './lifecycle.ts';
import { handleRoomClientMessage } from './messages.ts';
import { RoomPersistence } from './persistence.ts';
import { initRoomSchema } from './schema.ts';
import { SessionManager } from './sessions.ts';
import {
  SNAPSHOT_BROADCAST_INTERVAL_MS,
  STATE_PERSIST_INTERVAL_MS,
  stepRoomSimulation,
} from './simulation.ts';
import { buildPublicRoomListing, buildRoomPublicInfo, issueNextRoomSnapshot } from './snapshots.ts';
import {
  MAX_SPECTATORS,
  ROOM_MAX_TTL_MS,
  type RoomRecord,
  type SocketAttachment,
  type SocketBinding,
  type SqlStorageAdapter,
} from './types.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(err: ProtocolError): Response {
  return jsonResponse({ error: err.toPayload() }, err.httpStatus);
}

function isValidSocketAttachment(raw: unknown): raw is SocketAttachment {
  if (!raw || typeof raw !== 'object') return false;
  const att = raw as Partial<SocketAttachment>;
  if (typeof att.authenticated !== 'boolean') return false;
  if (
    att.authAttempts !== undefined &&
    (typeof att.authAttempts !== 'number' || !Number.isInteger(att.authAttempts) || att.authAttempts < 0)
  ) {
    return false;
  }
  if (att.authenticated) {
    return (
      typeof att.playerId === 'string' &&
      att.playerId.length > 0 &&
      typeof att.sessionId === 'string' &&
      att.sessionId.length > 0 &&
      typeof att.connectionEpoch === 'number' &&
      Number.isInteger(att.connectionEpoch) &&
      att.connectionEpoch > 0
    );
  }
  return att.playerId === null && att.sessionId === null && att.connectionEpoch === 0;
}

function readSocketAttachment(ws: WebSocket): SocketAttachment | null {
  try {
    const carrier = ws as unknown as { deserializeAttachment?: () => unknown };
    const raw = carrier.deserializeAttachment?.();
    return isValidSocketAttachment(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeSocketAttachment(ws: WebSocket, att: SocketAttachment): void {
  try {
    const carrier = ws as unknown as { serializeAttachment?: (value: unknown) => void };
    carrier.serializeAttachment?.(att);
  } catch {
    // Socket may already be closing
  }
}

interface StoredIdempotentSessionRef {
  roomCode: string;
  playerId: string;
  slot: SeatSlotOrSpectator;
}

export class RaftRoom {
  private ctx: DurableObjectState;
  private env: Env;
  private sql: SqlStorageAdapter;
  private persistence: RoomPersistence;
  private partyController: PartyController;
  private progressionController: ProgressionController;
  private sessions = new SessionManager();
  private rateLimiter = new SessionRateLimiter();
  private sockets = new Map<WebSocket, SocketBinding>();
  private reservedJoinSlots = new Set<0 | 1 | 2 | 3>();
  private reservedSpectatorJoins = 0;
  private creatingRoom = false;
  private inFlightCreates = new Map<string, Promise<void>>();
  private inFlightJoins = new Map<string, Promise<void>>();

  private room: RoomRecord | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = Date.now();
  private lastBroadcastMs = Date.now();
  private isClosing = false;
  private readyPromise: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    const baseSql = ctx.storage.sql as unknown as SqlStorageAdapter;
    const storageAny = ctx.storage as unknown as { transactionSync?: <T>(fn: () => T) => T };
    this.sql = {
      exec: baseSql.exec.bind(baseSql),
      transactionSync: storageAny.transactionSync
        ? storageAny.transactionSync.bind(ctx.storage)
        : baseSql.transactionSync?.bind(baseSql),
    };
    this.persistence = new RoomPersistence(this.sql);
    this.partyController = new PartyController(ctx, this.sql);
    this.progressionController = new ProgressionController(this.sql);

    this.readyPromise = this.ctx.blockConcurrencyWhile(async () => {
      const nowMs = Date.now();
      if (this.isProgressionDo()) {
        this.progressionController.initIfNeeded(nowMs);
        return;
      }

      initRoomSchema(this.sql);
      this.persistence.pruneExpiredRequests(nowMs);
      this.partyController.initFromStorage(nowMs);

      if (!this.isPartyDo()) {
        this.room = this.persistence.loadRoom();

        if (this.room) {
          this.restoreHibernatedSockets(this.room, nowMs);
          if (shouldCloseAbandonedRoom(this.room, nowMs)) {
            await this.closeAndPurgeRoom();
          } else {
            this.syncSimulationLoopState();
          }
        }
      }
    });
  }

  private isProgressionDo(): boolean {
    return this.ctx.id?.name === PROGRESSION_DO_NAME;
  }

  private isPartyDo(): boolean {
    return Boolean(this.ctx.id?.name?.startsWith('__PARTY_') || this.partyController.hasActiveParty());
  }

  private restoreHibernatedSockets(room: RoomRecord, nowMs: number): void {
    const ctxAny = this.ctx as unknown as { getWebSockets?: () => WebSocket[] };
    const hibernatedSockets = ctxAny.getWebSockets?.() ?? [];

    for (const ws of hibernatedSockets) {
      const att = readSocketAttachment(ws);
      if (!att || !att.authenticated || !att.playerId || !att.sessionId) {
        const emptyAtt: SocketAttachment = {
          authenticated: false,
          playerId: null,
          sessionId: null,
          connectionEpoch: 0,
          authAttempts: att?.authAttempts ?? 0,
        };
        writeSocketAttachment(ws, emptyAtt);
        this.sockets.set(ws, { ws, ...emptyAtt });
        continue;
      }

      const session = room.sessions.get(att.playerId);
      if (
        !session ||
        session.revoked ||
        session.sessionId !== att.sessionId ||
        session.connectionEpoch !== att.connectionEpoch ||
        nowMs >= session.expiresAt
      ) {
        try {
          ws.close(4001, 'SESSION_EXPIRED');
        } catch {
          // ignore
        }
        continue;
      }

      session.connected = true;
      session.lastSeenAt = nowMs;
      const slot = session.slot;
      if (slot !== -1) {
        const simPlayer = room.sim.players[slot];
        if (simPlayer) {
          simPlayer.connected = true;
          simPlayer.isBot = false;
          simPlayer.ready = session.ready;
        }
      }
      this.sockets.set(ws, {
        ws,
        authenticated: true,
        playerId: session.playerId,
        sessionId: session.sessionId,
        connectionEpoch: session.connectionEpoch,
        kind: 'room',
      });
    }

    syncBotsInRoom(room, nowMs);
    updateRoomEmptyState(room, nowMs);
  }

  public async fetch(request: Request): Promise<Response> {
    await this.readyPromise;

    if (request.headers.get(INTERNAL_HEADER_NAME) !== INTERNAL_HEADER_VALUE) {
      return jsonResponse(
        { error: makeErrorPayload('UNAUTHORIZED', 'المسار الداخلي غير متاح للوصول المباشر.') },
        403,
      );
    }

    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/internal/prog/')) {
        this.progressionController.initIfNeeded();
        return await this.progressionController.handleFetch(request, url);
      }
      if (url.pathname.startsWith('/internal/party/')) {
        return await this.partyController.handleFetch(request, url);
      }
      if (url.pathname === '/internal/idem-claim' && request.method === 'POST') {
        return await this.handleInternalIdemClaim(request);
      }
      if (url.pathname === '/internal/idem-release' && request.method === 'POST') {
        return await this.handleInternalIdemRelease(request);
      }
      if (url.pathname === '/internal/rate-limit' && request.method === 'POST') {
        return await this.handleInternalRateLimit(request);
      }
      if (url.pathname === '/internal/directory/upsert' && request.method === 'POST') {
        const listing = (await request.json()) as PublicRoomListingItem;
        if (!listing || typeof listing.roomCode !== 'string' || !isValidRoomCode(listing.roomCode)) {
          throw new ProtocolError('INVALID_MESSAGE', undefined, 400);
        }
        this.persistence.upsertPublicRoom(listing, Date.now());
        return jsonResponse({ ok: true }, 200);
      }
      if (url.pathname === '/internal/directory/remove' && request.method === 'POST') {
        const body = (await request.json()) as { roomCode?: string };
        const code = normalizeRoomCode(body?.roomCode ?? '');
        if (isValidRoomCode(code)) {
          this.persistence.removePublicRoom(code);
        }
        return jsonResponse({ ok: true }, 200);
      }
      if (url.pathname === '/internal/directory/list' && request.method === 'GET') {
        const nowMs = Date.now();
        const rooms = this.persistence.listPublicRooms(nowMs);
        const spectatableRooms = this.persistence.listSpectatablePublicRooms(nowMs);
        return jsonResponse({ rooms, spectatableRooms, total: rooms.length, timestamp: nowMs }, 200);
      }
      if (url.pathname === '/internal/create' && request.method === 'POST') {
        return await this.handleInternalCreate(request);
      }
      if (url.pathname === '/internal/join' && request.method === 'POST') {
        return await this.handleInternalJoin(request);
      }
      if (url.pathname === '/internal/info' && request.method === 'GET') {
        return this.handleInternalInfo();
      }
      if (url.pathname === '/internal/ws' && request.method === 'GET') {
        return await this.handleInternalWebSocket(request);
      }

      return jsonResponse({ error: makeErrorPayload('INVALID_MESSAGE', 'مسار داخلي غير معروف.') }, 404);
    } catch (err) {
      if (err instanceof ProtocolError) {
        return errorResponse(err);
      }
      return jsonResponse({ error: makeErrorPayload('INTERNAL_ERROR') }, 500);
    }
  }

  public async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.readyPromise;
    if (this.isPartyDo() || readSocketAttachment(ws)?.kind === 'party') {
      await this.partyController.handleWebSocketMessage(ws, message);
      return;
    }
    if (this.isClosing || !this.room || this.room.lifecycleState === 'CLOSED') {
      try {
        ws.close(1000, 'ROOM_CLOSED');
      } catch {
        // ignore
      }
      return;
    }

    const binding = this.ensureBindingForSocket(ws);
    await handleRoomClientMessage(message, {
      room: this.room,
      binding,
      sessions: this.sessions,
      persistence: this.persistence,
      rateLimiter: this.rateLimiter,
      consumeDurableRateLimit: (key, capacity, refillPerMs, ttlMs, nowMs) =>
        consumeDurableTokenBucket(this.sql, key, capacity, refillPerMs, ttlMs, nowMs),
      sendToSocket: (targetWs, msg) => this.sendMsg(targetWs, msg),
      broadcastMsg: (msg) => this.broadcastMsg(msg),
      broadcastState: (requestId) => {
        if (!this.room) return;
        this.broadcastMsg(makeRoomStateMsg(issueNextRoomSnapshot(this.room, Date.now()), requestId));
      },
      closeSocket: (targetWs, code, reason) => {
        try {
          targetWs.close(code, reason);
        } catch {
          // already closed
        }
      },
      findSocketByPlayerId: (playerId, exceptWs) => {
        for (const candidate of this.sockets.values()) {
          if (candidate.ws !== exceptWs && candidate.authenticated && candidate.playerId === playerId) {
            return candidate;
          }
        }
        return null;
      },
      updateAttachment: (targetWs, att) => writeSocketAttachment(targetWs, att),
      onStartLoop: () => this.syncSimulationLoopState(),
      onStopLoop: () => this.stopLoop(),
      onScheduleAlarm: () => {
        void this.scheduleNextAlarm(Date.now());
      },
      onDirectorySync: () => {
        void this.syncRoomDirectory(this.room);
      },
    });
  }

  public async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.readyPromise;
    if (this.isPartyDo() || readSocketAttachment(ws)?.kind === 'party') {
      this.partyController.handleWebSocketClose(ws);
      return;
    }
    if (this.isClosing) return;
    this.handleSocketClosed(ws);
  }

  public async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.readyPromise;
    if (this.isPartyDo() || readSocketAttachment(ws)?.kind === 'party') {
      this.partyController.handleWebSocketClose(ws);
      return;
    }
    if (this.isClosing) return;
    this.handleSocketClosed(ws);
  }

  public async alarm(): Promise<void> {
    await this.readyPromise;
    if (!this.room || this.isClosing) return;
    const nowMs = Date.now();
    this.persistence.pruneExpiredRequests(nowMs);

    const expiredChanged = this.cleanupExpiredSessions(this.room, nowMs);
    if (expiredChanged) {
      const snapshot = issueNextRoomSnapshot(this.room, nowMs);
      this.persistence.saveAll(this.room, nowMs);
      this.broadcastMsg(makeRoomStateMsg(snapshot));
      void this.syncRoomDirectory(this.room);
    }

    if (shouldCloseAbandonedRoom(this.room, nowMs)) {
      await this.closeAndPurgeRoom();
    } else {
      await this.scheduleNextAlarm(nowMs);
    }
  }

  private ensureBindingForSocket(ws: WebSocket): SocketBinding {
    let binding = this.sockets.get(ws);
    if (binding) return binding;

    const att = readSocketAttachment(ws);
    if (att && att.authenticated && att.playerId && att.sessionId && this.room) {
      const session = this.room.sessions.get(att.playerId);
      if (
        session &&
        !session.revoked &&
        session.sessionId === att.sessionId &&
        session.connectionEpoch === att.connectionEpoch
      ) {
        binding = {
          ws,
          authenticated: true,
          playerId: att.playerId,
          sessionId: att.sessionId,
          connectionEpoch: att.connectionEpoch,
        };
        this.sockets.set(ws, binding);
        return binding;
      }
    }

    binding = {
      ws,
      authenticated: false,
      playerId: null,
      sessionId: null,
      connectionEpoch: 0,
      authAttempts: att?.authAttempts ?? 0,
    };
    this.sockets.set(ws, binding);
    return binding;
  }

  private cleanupExpiredSessions(room: RoomRecord, nowMs: number): boolean {
    const expiredIds = this.sessions.expireGraceSessions(room, nowMs);
    if (expiredIds.length === 0) {
      return false;
    }

    for (const id of expiredIds) {
      this.persistence.deleteSession(id);
      room.sessions.delete(id);
      delete room.courseVotes[id];
      this.rateLimiter.clear(id);
      logServerEvent('player_expired', {
        roomCode: room.roomCode,
        playerId: id,
      });
    }

    const hostRes = reconcileHostLeadership(room, nowMs);
    if (hostRes.hostChanged) {
      logServerEvent('host_migrated', {
        roomCode: room.roomCode,
        newHostId: hostRes.newHostId,
      });
    }

    if (room.lifecycleState === 'WAITING') {
      applyCoursePreviewToSim(room);
    }
    syncBotsInRoom(room, nowMs);
    updateRoomEmptyState(room, nowMs);
    return true;
  }

  private async buildIdempotentCredentialReplay(
    room: RoomRecord,
    ref: StoredIdempotentSessionRef,
    nowMs: number,
  ): Promise<RoomSessionCredentials | null> {
    const session = room.sessions.get(ref.playerId);
    if (!session || session.revoked || nowMs >= session.expiresAt) {
      return null;
    }

    // Never return empty or placeholder credentials once the session has activated over WebSocket
    if (session.connected || session.connectionEpoch > 1) {
      throw new ProtocolError('SESSION_ALREADY_ACTIVE', ERROR_MESSAGES_AR.SESSION_ALREADY_ACTIVE, 409);
    }

    // Re-issue a fresh one-time resumeToken only while the session has not completed initial WS activation.
    // Never store plaintext resumeToken in room_requests.
    const resumeToken = generateResumeToken();
    session.resumeTokenHash = await hashToken(resumeToken);
    this.persistence.saveSession(session);

    const snapshot = issueNextRoomSnapshot(room, nowMs);
    return {
      roomCode: room.roomCode,
      playerId: session.playerId,
      resumeToken,
      sessionId: session.sessionId,
      connectionEpoch: session.connectionEpoch,
      role: session.role,
      slot: session.slot,
      snapshot,
    };
  }

  private async handleInternalRateLimit(request: Request): Promise<Response> {
    const body = (await request.json()) as { key?: string; channel?: HttpRateChannel };
    const key = typeof body.key === 'string' ? body.key.trim().slice(0, 128) : '';
    const channel = body.channel;
    if (!key || !channel || !(channel in HTTP_CHANNEL_LIMITS)) {
      throw new ProtocolError('INVALID_MESSAGE', undefined, 400);
    }

    const nowMs = Date.now();
    this.persistence.pruneExpiredRequests(nowMs);
    const cfg = HTTP_CHANNEL_LIMITS[channel];
    const allowed = consumeDurableTokenBucket(this.sql, `rl:${channel}:${key}`, cfg.capacity, cfg.refillPerMs, 5 * 60_000, nowMs);
    if (!allowed) {
      return jsonResponse({ allowed: false, error: makeErrorPayload('RATE_LIMITED') }, 429);
    }
    return jsonResponse({ allowed: true }, 200);
  }

  private async handleInternalIdemClaim(request: Request): Promise<Response> {
    const body = (await request.json()) as { keyHash?: string; candidateRoomCode?: string };
    const keyHash = typeof body.keyHash === 'string' ? body.keyHash.trim() : '';
    const candidateRoomCode = normalizeRoomCode(body.candidateRoomCode ?? '');
    if (!keyHash || !isValidRoomCode(candidateRoomCode)) {
      throw new ProtocolError('INVALID_MESSAGE', undefined, 400);
    }

    const nowMs = Date.now();
    this.persistence.pruneExpiredRequests(nowMs);
    const reqKey = `create_map:${keyHash}`;
    const existing = this.persistence.getRequestRecord<{ roomCode: string }>(reqKey, nowMs);
    if (existing && isValidRoomCode(existing.roomCode)) {
      return jsonResponse({ roomCode: existing.roomCode, claimed: false }, 200);
    }

    this.persistence.saveRequestRecord(
      reqKey,
      'IDEM_INDEX',
      'create_map',
      { roomCode: candidateRoomCode },
      24 * 60 * 60 * 1000,
      nowMs,
    );
    return jsonResponse({ roomCode: candidateRoomCode, claimed: true }, 200);
  }

  private async handleInternalIdemRelease(request: Request): Promise<Response> {
    const body = (await request.json()) as { keyHash?: string; candidateRoomCode?: string };
    const keyHash = typeof body.keyHash === 'string' ? body.keyHash.trim() : '';
    const candidateRoomCode = normalizeRoomCode(body.candidateRoomCode ?? '');
    if (!keyHash || !isValidRoomCode(candidateRoomCode)) {
      return jsonResponse({ released: false }, 200);
    }

    const reqKey = `create_map:${keyHash}`;
    const existing = this.persistence.getRequestRecord<{ roomCode: string }>(reqKey);
    if (existing && existing.roomCode === candidateRoomCode) {
      this.sql.exec(`DELETE FROM room_requests WHERE request_key = ?`, reqKey);
      return jsonResponse({ released: true }, 200);
    }
    return jsonResponse({ released: false }, 200);
  }

  private async handleInternalCreate(request: Request): Promise<Response> {
    const body = (await request.json()) as CreateRoomHttpRequest & {
      roomCode: string;
      accountId?: string;
      playerLevel?: number;
    };
    const roomCode = normalizeRoomCode(body.roomCode ?? '');
    if (!isValidRoomCode(roomCode)) {
      throw new ProtocolError('INVALID_ROOM_CODE', undefined, 400);
    }

    const nowMs = Date.now();
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim().slice(0, 128)
        : null;

    if (idempotencyKey) {
      const inFlight = this.inFlightCreates.get(idempotencyKey);
      if (inFlight) {
        await inFlight;
      }
      const existingRef = this.persistence.getRequestRecord<StoredIdempotentSessionRef>(
        `idem:create:${idempotencyKey}`,
        nowMs,
      );
      if (existingRef && this.room && this.room.lifecycleState !== 'CLOSED') {
        const replayed = await this.buildIdempotentCredentialReplay(this.room, existingRef, nowMs);
        if (replayed) {
          return jsonResponse(replayed, 200);
        }
      }
    }

    if (this.room && shouldCloseAbandonedRoom(this.room, nowMs)) {
      await this.closeAndPurgeRoom();
    }

    if (this.creatingRoom || (this.room && this.room.lifecycleState !== 'CLOSED')) {
      throw new ProtocolError('ROOM_ALREADY_EXISTS', undefined, 409);
    }

    this.creatingRoom = true;
    let resolveInFlight: (() => void) | undefined;
    if (idempotencyKey) {
      const p = new Promise<void>((r) => {
        resolveInFlight = r;
      });
      this.inFlightCreates.set(idempotencyKey, p);
    }

    try {
      const hostName = sanitizePlayerName(body.name, 'قبطان');
      const hostCosmetic = sanitizeCosmeticOrDefault(body.cosmetic, 0);
      const initialCourseId: CourseId = isValidCourseId(body.courseId) ? body.courseId : 'tropical';
      const isPrivate = Boolean(body.isPrivate);
      let passwordHash: string | null = null;
      if (isPrivate) {
        const rawPwd = typeof body.password === 'string' ? body.password.trim() : '';
        if (rawPwd.length < 3 || rawPwd.length > 32) {
          throw new ProtocolError('INVALID_MESSAGE', 'كلمة مرور الغرفة الخاصة يجب أن تكون بين 3 و32 حرفًا.', 400);
        }
        passwordHash = await hashToken(`${roomCode}:pwd:${rawPwd}`);
      }
      const settings = normalizeRoomSettings(body.settings);
      const hostAccountId = typeof body.accountId === 'string' && body.accountId.length > 0 ? body.accountId : undefined;
      const hostLevel = typeof body.playerLevel === 'number' && body.playerLevel > 0 ? body.playerLevel : undefined;

      const sim = createInitialSimState('online', hostName, hostCosmetic, initialCourseId, settings);
      sim.phase = 'waiting';

      const room: RoomRecord = {
        roomCode,
        lifecycleState: 'CREATING',
        roundSeq: 1,
        hostId: '',
        fillBots: true,
        isPrivate,
        passwordHash,
        settings,
        courseId: initialCourseId,
        courseSelectionMode: 'host',
        courseVotes: {},
        playlistQueue: [],
        recentChat: [],
        emoteSeq: 0,
        idempotencyKey,
        createdAt: nowMs,
        updatedAt: nowMs,
        expiresAt: nowMs + ROOM_MAX_TTL_MS,
        emptySinceMs: nowMs,
        snapshotSeq: 1,
        accumulatorSec: 0,
        lastPersistedAtMs: nowMs,
        sim,
        recentEvents: [],
        sessions: new Map(),
      };

      const issued = await this.sessions.createSession({
        roomCode,
        slot: 0,
        role: 'HOST',
        name: hostName,
        cosmetic: hostCosmetic,
        nowMs,
        accountId: hostAccountId,
        playerLevel: hostLevel,
      });

      room.hostId = issued.session.playerId;
      room.sessions.set(issued.session.playerId, issued.session);
      room.sim.players[0].id = issued.session.playerId;
      room.sim.players[0].connected = false;
      room.sim.players[0].ready = true;
      if (hostAccountId) room.sim.players[0].accountId = hostAccountId;
      if (hostLevel) room.sim.players[0].playerLevel = hostLevel;

      syncBotsInRoom(room, nowMs);
      transitionRoomLifecycle(room, 'WAITING');

      this.room = room;
      this.isClosing = false;
      const snapshot = issueNextRoomSnapshot(room, nowMs);
      this.persistence.saveAll(room, nowMs);
      if (idempotencyKey) {
        const ref: StoredIdempotentSessionRef = {
          roomCode,
          playerId: issued.session.playerId,
          slot: issued.session.slot,
        };
        this.persistence.saveRequestRecord(
          `idem:create:${idempotencyKey}`,
          roomCode,
          'room:create',
          ref,
          ROOM_MAX_TTL_MS,
          nowMs,
        );
      }
      await this.scheduleNextAlarm(nowMs);
      await this.syncRoomDirectory(room);

      logServerEvent('room_created', {
        roomCode,
        hostId: issued.session.playerId,
        isPrivate,
        gameMode: settings.gameMode,
      });

      const creds: RoomSessionCredentials = {
        roomCode,
        playerId: issued.session.playerId,
        resumeToken: issued.resumeToken,
        sessionId: issued.session.sessionId,
        connectionEpoch: issued.session.connectionEpoch,
        role: issued.session.role,
        slot: issued.session.slot,
        snapshot,
      };
      return jsonResponse(creds, 201);
    } finally {
      this.creatingRoom = false;
      if (idempotencyKey) {
        this.inFlightCreates.delete(idempotencyKey);
        resolveInFlight?.();
      }
    }
  }

  private async handleInternalJoin(request: Request): Promise<Response> {
    const room = this.requireActiveRoom();
    const nowMs = Date.now();
    const clientIp = request.headers.get(CLIENT_IP_HEADER_NAME)?.trim();
    if (clientIp) {
      const cfg = HTTP_CHANNEL_LIMITS.join;
      if (!consumeDurableTokenBucket(this.sql, `rl:join:${clientIp}`, cfg.capacity, cfg.refillPerMs, 5 * 60_000, nowMs)) {
        throw new ProtocolError('RATE_LIMITED', undefined, 429);
      }
    }
    const body = (await request.json()) as JoinRoomHttpRequest & {
      accountId?: string;
      playerLevel?: number;
    };
    const joinAccountId = typeof body.accountId === 'string' && body.accountId.length > 0 ? body.accountId : undefined;
    const joinLevel = typeof body.playerLevel === 'number' && body.playerLevel > 0 ? body.playerLevel : undefined;
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim().slice(0, 128)
        : null;

    if (room.isPrivate && room.passwordHash) {
      const candidatePwd = typeof body.password === 'string' ? body.password.trim() : '';
      const candidateHash = candidatePwd ? await hashToken(`${room.roomCode}:pwd:${candidatePwd}`) : '';
      if (!candidateHash || candidateHash !== room.passwordHash) {
        throw new ProtocolError('INVALID_PASSWORD', ERROR_MESSAGES_AR.INVALID_PASSWORD, 403);
      }
    }

    const expiredChanged = this.cleanupExpiredSessions(room, nowMs);
    if (expiredChanged) {
      this.persistence.saveAll(room, nowMs);
      void this.syncRoomDirectory(room);
    }

    if (idempotencyKey) {
      const inFlight = this.inFlightJoins.get(idempotencyKey);
      if (inFlight) {
        await inFlight;
      }
      const existingRef = this.persistence.getRequestRecord<StoredIdempotentSessionRef>(
        `idem:join:${idempotencyKey}`,
        nowMs,
      );
      if (existingRef) {
        const replayed = await this.buildIdempotentCredentialReplay(room, existingRef, nowMs);
        if (replayed) {
          if (expiredChanged) {
            this.broadcastMsg(makeRoomStateMsg(replayed.snapshot));
          }
          return jsonResponse(replayed, 200);
        }
      }
    }

    const spectateMode: SpectateJoinMode =
      body.spectate === 'only' || body.spectate === 'auto' ? body.spectate : 'never';

    // Reserve seat OR spectator slot synchronously BEFORE any await so concurrent join requests cannot collide
    let openSlot: SeatSlotOrSpectator | null = null;
    let joiningAsSpectator = false;

    if (spectateMode === 'only') {
      joiningAsSpectator = true;
      openSlot = -1;
    } else {
      const canTakeSeat = spectateMode === 'never' || room.lifecycleState === 'WAITING';
      const seat = canTakeSeat ? findAvailableSeatSlot(room, nowMs, this.reservedJoinSlots) : null;
      if (seat !== null) {
        openSlot = seat;
      } else if (spectateMode === 'auto') {
        joiningAsSpectator = true;
        openSlot = -1;
      } else {
        if (expiredChanged) {
          const snap = issueNextRoomSnapshot(room, nowMs);
          this.broadcastMsg(makeRoomStateMsg(snap));
        }
        throw new ProtocolError('ROOM_FULL', undefined, 409);
      }
    }

    if (joiningAsSpectator) {
      if (countActiveSpectators(room) + this.reservedSpectatorJoins >= MAX_SPECTATORS) {
        throw new ProtocolError('ROOM_FULL', 'وصل عدد المشاهدين في الغرفة إلى الحد الأقصى.', 409);
      }
      this.reservedSpectatorJoins += 1;
    } else if (openSlot !== null && openSlot !== -1) {
      this.reservedJoinSlots.add(openSlot);
    }

    let resolveInFlight: (() => void) | undefined;
    if (idempotencyKey) {
      const p = new Promise<void>((r) => {
        resolveInFlight = r;
      });
      this.inFlightJoins.set(idempotencyKey, p);
    }

    try {
      const seatNum = joiningAsSpectator ? countActiveSpectators(room) + 1 : (openSlot as number) + 1;
      const cleanName = sanitizePlayerName(
        body.name,
        joiningAsSpectator ? `مشاهد ${seatNum}` : `لاعب ${seatNum}`,
      );
      const cleanCosmetic = sanitizeCosmeticOrDefault(
        body.cosmetic,
        joiningAsSpectator ? 0 : (openSlot as number),
      );

      const currentHost = room.sessions.get(room.hostId);
      const hasValidHost = Boolean(currentHost && !currentHost.revoked);
      const assignedRole = joiningAsSpectator ? 'SPECTATOR' : hasValidHost ? 'PLAYER' : 'HOST';

      const issued = await this.sessions.createSession({
        roomCode: room.roomCode,
        slot: openSlot as SeatSlotOrSpectator,
        role: assignedRole,
        name: cleanName,
        cosmetic: cleanCosmetic,
        nowMs,
        accountId: joinAccountId,
        playerLevel: joinLevel,
      });

      if (this.isClosing || this.room !== room || room.lifecycleState === 'CLOSED') {
        throw new ProtocolError('ROOM_CLOSED', undefined, 410);
      }

      room.sessions.set(issued.session.playerId, issued.session);
      if (assignedRole === 'HOST') {
        room.hostId = issued.session.playerId;
      }

      const hostRes = reconcileHostLeadership(room, nowMs);
      if (hostRes.hostChanged) {
        logServerEvent('host_migrated', {
          roomCode: room.roomCode,
          newHostId: hostRes.newHostId,
        });
      }

      syncBotsInRoom(room, nowMs);
      updateRoomEmptyState(room, nowMs);
      const snapshot = issueNextRoomSnapshot(room, nowMs);
      this.persistence.saveAll(room, nowMs);
      if (idempotencyKey) {
        const ref: StoredIdempotentSessionRef = {
          roomCode: room.roomCode,
          playerId: issued.session.playerId,
          slot: issued.session.slot,
        };
        this.persistence.saveRequestRecord(
          `idem:join:${idempotencyKey}`,
          room.roomCode,
          'room:join',
          ref,
          ROOM_MAX_TTL_MS,
          nowMs,
        );
      }
      await this.scheduleNextAlarm(nowMs);
      await this.syncRoomDirectory(room);

      logServerEvent('player_joined', {
        roomCode: room.roomCode,
        playerId: issued.session.playerId,
        slot: issued.session.slot,
      });

      this.broadcastMsg(makeRoomStateMsg(snapshot));

      const creds: RoomSessionCredentials = {
        roomCode: room.roomCode,
        playerId: issued.session.playerId,
        resumeToken: issued.resumeToken,
        sessionId: issued.session.sessionId,
        connectionEpoch: issued.session.connectionEpoch,
        role: issued.session.role,
        slot: issued.session.slot,
        snapshot,
      };
      return jsonResponse(creds, 200);
    } finally {
      if (joiningAsSpectator) {
        this.reservedSpectatorJoins = Math.max(0, this.reservedSpectatorJoins - 1);
      } else if (openSlot !== null && openSlot !== -1) {
        this.reservedJoinSlots.delete(openSlot);
      }
      if (idempotencyKey) {
        this.inFlightJoins.delete(idempotencyKey);
        resolveInFlight?.();
      }
    }
  }

  private handleInternalInfo(): Response {
    const room = this.requireActiveRoom();
    return jsonResponse(buildRoomPublicInfo(room), 200);
  }

  private async handleInternalWebSocket(request: Request): Promise<Response> {
    this.requireActiveRoom();
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      throw new ProtocolError('INVALID_MESSAGE', 'طلب WebSocket غير صالح.', 426);
    }
    const clientIp = request.headers.get(CLIENT_IP_HEADER_NAME)?.trim();
    if (clientIp) {
      const cfg = HTTP_CHANNEL_LIMITS.ws;
      if (!consumeDurableTokenBucket(this.sql, `rl:ws:${clientIp}`, cfg.capacity, cfg.refillPerMs, 5 * 60_000)) {
        throw new ProtocolError('RATE_LIMITED', undefined, 429);
      }
    }

    const [clientSocket, serverSocket] = createWebSocketPair();
    const ctxAny = this.ctx as unknown as { acceptWebSocket?: (ws: WebSocket, tags?: string[]) => void };
    if (ctxAny.acceptWebSocket) {
      ctxAny.acceptWebSocket(serverSocket);
    } else {
      (serverSocket as unknown as { accept?: () => void }).accept?.();
    }

    const initialAttachment: SocketAttachment = {
      authenticated: false,
      playerId: null,
      sessionId: null,
      connectionEpoch: 0,
      authAttempts: 0,
    };
    writeSocketAttachment(serverSocket, initialAttachment);

    const binding: SocketBinding = {
      ws: serverSocket,
      ...initialAttachment,
    };
    this.sockets.set(serverSocket, binding);

    // Hibernation-friendly: do NOT start simulation interval while room is WAITING
    this.syncSimulationLoopState();
    return createWebSocketUpgradeResponse(clientSocket);
  }

  private handleSocketClosed(ws: WebSocket): void {
    if (this.isClosing) {
      this.sockets.delete(ws);
      return;
    }
    const binding = this.sockets.get(ws) ?? this.ensureBindingForSocket(ws);
    this.sockets.delete(ws);

    if (!this.room || !binding.authenticated || !binding.playerId) {
      this.syncSimulationLoopState();
      return;
    }

    const session = this.room.sessions.get(binding.playerId);
    // Ignore stale close events from a superseded socket whose sessionId/connectionEpoch changed
    if (
      session &&
      !session.revoked &&
      session.sessionId === binding.sessionId &&
      session.connectionEpoch === binding.connectionEpoch
    ) {
      const nowMs = Date.now();
      session.connected = false;
      session.lastSeenAt = nowMs;
      opsMetrics.recordDisconnect();

      const slot = session.slot;
      if (slot !== -1) {
        const simPlayer = this.room.sim.players[slot];
        if (simPlayer) {
          simPlayer.connected = false;
          simPlayer.tempBotSubstitute = false;
          simPlayer.farting = false;
          simPlayer.moveDir = 0;
        }
      }

      // Host keeps HOST role during 15s grace window
      syncBotsInRoom(this.room, nowMs);
      updateRoomEmptyState(this.room, nowMs);
      const snapshot = issueNextRoomSnapshot(this.room, nowMs);
      this.persistence.saveAll(this.room, nowMs);

      logServerEvent('player_disconnected', {
        roomCode: this.room.roomCode,
        playerId: session.playerId,
        slot: session.slot,
        reason: 'socket_closed_grace',
      });

      this.broadcastMsg(makeRoomStateMsg(snapshot));
      void this.syncRoomDirectory(this.room);
      void this.scheduleNextAlarm(nowMs);
    }

    this.syncSimulationLoopState();
  }

  private syncSimulationLoopState(): void {
    const needsTick =
      this.room !== null &&
      !this.isClosing &&
      (this.room.lifecycleState === 'PLAYING' || this.room.lifecycleState === 'FALLING') &&
      this.sockets.size > 0;

    if (needsTick) {
      this.ensureLoopRunning();
    } else {
      this.stopLoop();
    }
  }

  private ensureLoopRunning(): void {
    if (this.loopTimer !== null) return;
    this.lastTickMs = Date.now();
    this.lastBroadcastMs = Date.now();

    this.loopTimer = setInterval(() => {
      this.onLoopTick();
    }, 33);
  }

  private stopLoop(): void {
    if (this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private onLoopTick(): void {
    const room = this.room;
    if (!room || this.isClosing) {
      this.stopLoop();
      return;
    }

    if (room.lifecycleState !== 'PLAYING' && room.lifecycleState !== 'FALLING') {
      this.stopLoop();
      return;
    }

    const nowMs = Date.now();
    const rawDt = (nowMs - this.lastTickMs) / 1000;
    this.lastTickMs = nowMs;

    const metaDirty = this.cleanupExpiredSessions(room, nowMs);

    if (shouldCloseAbandonedRoom(room, nowMs)) {
      void this.closeAndPurgeRoom();
      return;
    }

    const { events, lifecycleChanged, tempSubChanged } = stepRoomSimulation(room, rawDt, nowMs);
    const afterStepLifecycle = (room as { lifecycleState: RoomRecord['lifecycleState'] }).lifecycleState;
    if (events.length > 0) {
      const discrete = events.filter((e) => e.type !== 'fart_start' && e.type !== 'fart_stop');
      if (discrete.length > 0) {
        this.broadcastMsg(makeGameEventMsg(discrete));
      }
    }

    if (afterStepLifecycle === 'FINISHED' && lifecycleChanged) {
      logServerEvent('round_finished', {
        roomCode: room.roomCode,
        elapsedTime: room.sim.elapsedTime,
        falls: room.sim.falls,
      });
      this.recordFinishedRoundForParticipants(room);
    }

    const periodicPersistDue = nowMs - (room.lastPersistedAtMs ?? 0) >= STATE_PERSIST_INTERVAL_MS;
    if (metaDirty || lifecycleChanged || tempSubChanged) {
      this.persistence.saveAll(room, nowMs);
      void this.syncRoomDirectory(room);
    } else if (periodicPersistDue) {
      this.persistence.saveSimState(room, nowMs);
    }

    if (metaDirty || lifecycleChanged || tempSubChanged || nowMs - this.lastBroadcastMs >= SNAPSHOT_BROADCAST_INTERVAL_MS) {
      this.lastBroadcastMs = nowMs;
      const snapshot = issueNextRoomSnapshot(room, nowMs);
      this.broadcastMsg(
        metaDirty || lifecycleChanged || tempSubChanged ? makeRoomStateMsg(snapshot) : makeGameSnapshotMsg(snapshot),
      );
    }

    if (afterStepLifecycle !== 'PLAYING' && afterStepLifecycle !== 'FALLING') {
      this.stopLoop();
      void this.scheduleNextAlarm(nowMs);
    }
  }

  private requireActiveRoom(): RoomRecord {
    const nowMs = Date.now();
    if (!this.room || this.room.lifecycleState === 'CLOSED' || nowMs >= this.room.expiresAt) {
      throw new ProtocolError('ROOM_NOT_FOUND', ERROR_MESSAGES_AR.ROOM_NOT_FOUND, 404);
    }
    return this.room;
  }

  private sendMsg(ws: WebSocket, msg: ServerProtocolMessage): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closing
    }
  }

  private broadcastMsg(msg: ServerProtocolMessage): void {
    const raw = JSON.stringify(msg);
    for (const binding of this.sockets.values()) {
      if (binding.authenticated && binding.ws.readyState === 1) {
        try {
          binding.ws.send(raw);
        } catch {
          // ignore closed socket
        }
      }
    }
  }

  private async scheduleNextAlarm(nowMs: number): Promise<void> {
    if (!this.room || this.room.lifecycleState === 'CLOSED' || this.isClosing) return;
    const target = getNextAlarmTimestamp(this.room, nowMs);
    await this.ctx.storage.setAlarm(target);
  }

  private async closeAndPurgeRoom(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;
    this.stopLoop();

    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // ignore alarm delete failures
    }

    const closingRoomCode = this.room?.roomCode;
    const finalError = JSON.stringify(makeRoomErrorMsg('ROOM_CLOSED', ERROR_MESSAGES_AR.ROOM_CLOSED));

    for (const [ws, binding] of Array.from(this.sockets.entries())) {
      if (ws.readyState === 1 && binding.authenticated) {
        try {
          ws.send(finalError);
        } catch {
          // ignore send errors
        }
      }
      try {
        ws.close(1000, 'ROOM_CLOSED');
      } catch {
        // ignore close errors
      }
    }
    this.sockets.clear();

    if (this.room) {
      this.room.lifecycleState = 'CLOSED';
      this.persistence.purgeClosedRoom(this.room.roomCode);
      this.room = null;
    }

    if (closingRoomCode) {
      await this.syncRoomDirectory(null, closingRoomCode);
      logServerEvent('room_closed', { roomCode: closingRoomCode });
    }
  }

  private async syncRoomDirectory(
    room: RoomRecord | null,
    removedRoomCode?: string,
  ): Promise<void> {
    if (this.ctx.id?.name === '__ROOM_DIRECTORY' || this.isPartyDo() || this.isProgressionDo()) return;

    if (!room || room.lifecycleState === 'CLOSED') {
      const deadCode = room?.roomCode ?? removedRoomCode;
      if (deadCode) opsMetrics.removeRoom(deadCode);
    } else {
      let humanCount = 0;
      let botCount = 0;
      let tempSubstituteCount = 0;
      let spectatorCount = 0;
      for (const s of room.sessions.values()) {
        if (s.revoked) continue;
        if (s.slot === -1) {
          if (s.connected) spectatorCount += 1;
        } else if (s.connected) {
          humanCount += 1;
        }
      }
      for (const p of room.sim.players) {
        if (p.tempBotSubstitute) tempSubstituteCount += 1;
        else if (p.isBot && p.connected) botCount += 1;
      }
      if (room.isPrivate) {
        opsMetrics.removeRoom(room.roomCode);
      } else {
        opsMetrics.updateRoomSummary({
          roomCode: room.roomCode,
          courseId: room.courseId,
          gameMode: room.settings.gameMode,
          lifecycleState: room.lifecycleState,
          humanCount,
          botCount,
          tempSubstituteCount,
          spectatorCount,
          updatedAt: Date.now(),
        });
      }
    }

    if (!this.env?.ROOMS) return;
    const code = room?.roomCode ?? removedRoomCode;
    if (!code) return;

    try {
      const dirStub = this.env.ROOMS.get(this.env.ROOMS.idFromName('__ROOM_DIRECTORY'));
      if (!room || room.isPrivate || room.lifecycleState === 'CLOSED') {
        await dirStub.fetch(
          new Request('https://raft-room.internal/internal/directory/remove', {
            method: 'POST',
            headers: {
              [INTERNAL_HEADER_NAME]: INTERNAL_HEADER_VALUE,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ roomCode: code }),
          }),
        );
      } else {
        const listing = buildPublicRoomListing(room);
        await dirStub.fetch(
          new Request('https://raft-room.internal/internal/directory/upsert', {
            method: 'POST',
            headers: {
              [INTERNAL_HEADER_NAME]: INTERNAL_HEADER_VALUE,
              'content-type': 'application/json',
            },
            body: JSON.stringify(listing),
          }),
        );
      }
    } catch {
      // Directory sync is best-effort and must never fail room gameplay
    }
  }

  private recordFinishedRoundForParticipants(room: RoomRecord): void {
    if (this.isProgressionDo() || this.isPartyDo()) return;
    const nowMs = Date.now();
    const roundSeq = room.roundSeq ?? 1;
    const submissionKey = `online:${room.roomCode}:r${roundSeq}`;
    const matchId = submissionKey;

    const participants: BatchOnlineMatchParticipant[] = [];
    const seenAccounts = new Set<string>();

    for (const session of room.sessions.values()) {
      if (session.revoked || session.slot < 0 || !session.accountId) continue;
      if (seenAccounts.has(session.accountId)) continue;
      seenAccounts.add(session.accountId);
      const match = buildMatchSummaryFromSim(room.sim, session.slot as 0 | 1 | 2 | 3, submissionKey);
      participants.push({
        accountId: session.accountId,
        match,
      });
    }

    const baseSummary = buildMatchSummaryFromSim(room.sim, 0, submissionKey);
    const verification = verifyMatchResult(baseSummary, { isAuthoritativeRoom: true });

    const roster: ReplayPlayerRosterItem[] = room.sim.players.map((p) => ({
      slot: p.slot,
      name: p.name,
      isBot: p.isBot,
      botPersonality: p.botPersonality,
      wasTempSubstitute: Boolean(p.tempBotSubstitute),
      colorIndex: p.cosmetic.colorIndex,
      pushContribution: Math.round(p.stats.pushImpulseSum ?? 0),
    }));

    const replayRecord: RoundReplayRecord = {
      matchId,
      roomCode: room.roomCode,
      mode: 'online',
      courseId: room.courseId,
      gameMode: room.settings.gameMode,
      difficulty: room.settings.difficulty,
      botDifficulty: room.settings.botDifficulty,
      outcome: room.sim.runOutcome,
      durationSec: Number((room.sim.elapsedTime ?? 0).toFixed(2)),
      falls: room.sim.falls ?? 0,
      treasureScore: room.sim.treasureScore ?? 0,
      survivalDistance: Math.round(room.sim.survivalDistance ?? 0),
      minRaftHp: Math.round(room.sim.minRaftHp ?? room.sim.raftHp ?? 100),
      createdAt: nowMs,
      players: roster,
      frames: (room.replayFrames ?? []).slice(),
      events: (room.replayEvents ?? []).slice(),
    };

    const jobs: Promise<unknown>[] = [];
    if (verification.ok) {
      const verifiedRecord: VerifiedMatchRecord = {
        matchId,
        submissionKey,
        roomCode: room.roomCode,
        accountId: participants[0]?.accountId ?? null,
        mode: 'online',
        courseId: room.courseId,
        gameMode: room.settings.gameMode,
        difficulty: room.settings.difficulty,
        outcome: room.sim.runOutcome,
        elapsedTimeSec: baseSummary.elapsedTimeSec,
        falls: baseSummary.falls,
        itemsUsed: room.sim.itemsCollectedCount ?? baseSummary.itemsUsed,
        collisionCount: room.sim.collisionCount ?? 0,
        treasureScore: baseSummary.treasureScore,
        survivalDistance: baseSummary.survivalDistance,
        minRaftHp: baseSummary.minRaftHp,
        verifiedAt: nowMs,
      };
      jobs.push(recordVerifiedMatchInD1(this.env?.DB, verifiedRecord));

      if (replayRecord.frames.length > 0) {
        jobs.push(saveRoundReplayInD1(this.env?.DB, replayRecord));
      }

      const verifiedParticipants = participants.filter(
        (p) => verifyMatchResult(p.match, { isAuthoritativeRoom: true }).ok,
      );
      if (this.env?.ROOMS && verifiedParticipants.length > 0) {
        jobs.push(recordOnlineBatchViaService(this.env, verifiedParticipants));
      }
    } else {
      opsMetrics.recordVerificationRejection();
    }

    if (jobs.length === 0) return;
    const allJobs = Promise.allSettled(jobs);
    if (typeof this.ctx.waitUntil === 'function') {
      this.ctx.waitUntil(allJobs);
    } else {
      void allJobs;
    }
  }

  public dispose(): void {
    this.isClosing = true;
    this.stopLoop();
    this.partyController.dispose();
    for (const ws of Array.from(this.sockets.keys())) {
      try {
        ws.close(1000, 'DISPOSED');
      } catch {
        // ignore
      }
    }
    this.sockets.clear();
  }
}
