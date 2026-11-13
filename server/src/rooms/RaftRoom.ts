import { createInitialSimState } from '../../../src/shared/physics.ts';
import type {
  CreateRoomHttpRequest,
  JoinRoomHttpRequest,
  RoomSessionCredentials,
  ServerProtocolMessage,
} from '../../../src/shared/protocol.ts';
import {
  createWebSocketPair,
  createWebSocketUpgradeResponse,
  INTERNAL_HEADER_NAME,
  INTERNAL_HEADER_VALUE,
  type Env,
} from '../env.ts';
import { logServerEvent } from '../lib/logger.ts';
import { SessionRateLimiter } from '../lib/rateLimit.ts';
import { isValidRoomCode, normalizeRoomCode } from '../lib/roomCode.ts';
import { sanitizeCosmeticOrDefault, sanitizePlayerName } from '../lib/validation.ts';
import { ERROR_MESSAGES_AR, makeErrorPayload, ProtocolError } from '../protocol/errors.ts';
import {
  makeGameEventMsg,
  makeGameSnapshotMsg,
  makeRoomErrorMsg,
  makeRoomStateMsg,
} from '../protocol/messages.ts';
import {
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
import { buildRoomPublicInfo, issueNextRoomSnapshot } from './snapshots.ts';
import {
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

export class RaftRoom {
  private ctx: DurableObjectState;
  private sql: SqlStorageAdapter;
  private persistence: RoomPersistence;
  private sessions = new SessionManager();
  private rateLimiter = new SessionRateLimiter();
  private sockets = new Map<WebSocket, SocketBinding>();

  private room: RoomRecord | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = Date.now();
  private lastBroadcastMs = Date.now();
  private isClosing = false;
  private readyPromise: Promise<void>;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
    const baseSql = ctx.storage.sql as unknown as SqlStorageAdapter;
    const storageAny = ctx.storage as unknown as { transactionSync?: <T>(fn: () => T) => T };
    this.sql = {
      exec: baseSql.exec.bind(baseSql),
      transactionSync: storageAny.transactionSync
        ? storageAny.transactionSync.bind(ctx.storage)
        : baseSql.transactionSync?.bind(baseSql),
    };
    this.persistence = new RoomPersistence(this.sql);

    this.readyPromise = this.ctx.blockConcurrencyWhile(async () => {
      initRoomSchema(this.sql);
      const nowMs = Date.now();
      this.persistence.pruneExpiredRequests(nowMs);
      this.room = this.persistence.loadRoom();

      if (this.room) {
        this.restoreHibernatedSockets(this.room, nowMs);
        if (shouldCloseAbandonedRoom(this.room, nowMs)) {
          await this.closeAndPurgeRoom();
        } else {
          this.syncSimulationLoopState();
        }
      }
    });
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
      const simPlayer = room.sim.players[session.slot];
      if (simPlayer) {
        simPlayer.connected = true;
        simPlayer.isBot = false;
        simPlayer.ready = session.ready;
      }
      this.sockets.set(ws, {
        ws,
        authenticated: true,
        playerId: session.playerId,
        sessionId: session.sessionId,
        connectionEpoch: session.connectionEpoch,
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
      sendToSocket: (targetWs, msg) => this.sendMsg(targetWs, msg),
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
    });
  }

  public async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.readyPromise;
    if (this.isClosing) return;
    this.handleSocketClosed(ws);
  }

  public async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.readyPromise;
    if (this.isClosing) return;
    this.handleSocketClosed(ws);
  }

  public async alarm(): Promise<void> {
    await this.readyPromise;
    if (!this.room || this.isClosing) return;
    const nowMs = Date.now();
    this.persistence.pruneExpiredRequests(nowMs);

    const expiredIds = this.sessions.expireGraceSessions(this.room, nowMs);
    if (expiredIds.length > 0) {
      for (const id of expiredIds) {
        this.persistence.deleteSession(id);
        this.room.sessions.delete(id);
        this.rateLimiter.clear(id);
        logServerEvent('player_expired', {
          roomCode: this.room.roomCode,
          playerId: id,
        });
      }
      const hostRes = reconcileHostLeadership(this.room, nowMs);
      if (hostRes.hostChanged) {
        logServerEvent('host_migrated', {
          roomCode: this.room.roomCode,
          newHostId: hostRes.newHostId,
        });
      }
      syncBotsInRoom(this.room, nowMs);
      updateRoomEmptyState(this.room, nowMs);
      const snapshot = issueNextRoomSnapshot(this.room, nowMs);
      this.persistence.saveAll(this.room, nowMs);
      this.broadcastMsg(makeRoomStateMsg(snapshot));
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
    };
    this.sockets.set(ws, binding);
    return binding;
  }

  private async handleInternalCreate(request: Request): Promise<Response> {
    const body = (await request.json()) as CreateRoomHttpRequest & { roomCode: string };
    const roomCode = normalizeRoomCode(body.roomCode ?? '');
    if (!isValidRoomCode(roomCode)) {
      throw new ProtocolError('INVALID_ROOM_CODE', undefined, 400);
    }

    const nowMs = Date.now();
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim().slice(0, 128)
        : null;

    if (this.room && shouldCloseAbandonedRoom(this.room, nowMs)) {
      await this.closeAndPurgeRoom();
    }

    if (this.room && this.room.lifecycleState !== 'CLOSED') {
      throw new ProtocolError('ROOM_ALREADY_EXISTS', undefined, 409);
    }

    const hostName = sanitizePlayerName(body.name, 'قبطان');
    const hostCosmetic = sanitizeCosmeticOrDefault(body.cosmetic, 0);

    const sim = createInitialSimState('online', hostName, hostCosmetic);
    sim.phase = 'waiting';

    const room: RoomRecord = {
      roomCode,
      lifecycleState: 'CREATING',
      hostId: '',
      fillBots: true,
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
    });

    room.hostId = issued.session.playerId;
    room.sessions.set(issued.session.playerId, issued.session);
    room.sim.players[0].id = issued.session.playerId;
    room.sim.players[0].connected = false;
    room.sim.players[0].ready = true;

    syncBotsInRoom(room, nowMs);
    transitionRoomLifecycle(room, 'WAITING');

    this.room = room;
    this.isClosing = false;
    const snapshot = issueNextRoomSnapshot(room, nowMs);
    this.persistence.saveAll(room, nowMs);
    await this.scheduleNextAlarm(nowMs);

    logServerEvent('room_created', {
      roomCode,
      hostId: issued.session.playerId,
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
  }

  private async handleInternalJoin(request: Request): Promise<Response> {
    const room = this.requireActiveRoom();
    const nowMs = Date.now();

    const expiredIds = this.sessions.expireGraceSessions(room, nowMs);
    for (const id of expiredIds) {
      this.persistence.deleteSession(id);
      room.sessions.delete(id);
    }

    const body = (await request.json()) as JoinRoomHttpRequest;
    const openSlot = findAvailableSeatSlot(room, nowMs);
    if (openSlot === null) {
      throw new ProtocolError('ROOM_FULL', undefined, 409);
    }

    const cleanName = sanitizePlayerName(body.name, `لاعب ${openSlot + 1}`);
    const cleanCosmetic = sanitizeCosmeticOrDefault(body.cosmetic, openSlot);

    const issued = await this.sessions.createSession({
      roomCode: room.roomCode,
      slot: openSlot,
      role: 'PLAYER',
      name: cleanName,
      cosmetic: cleanCosmetic,
      nowMs,
    });

    room.sessions.set(issued.session.playerId, issued.session);
    syncBotsInRoom(room, nowMs);
    const snapshot = issueNextRoomSnapshot(room, nowMs);
    this.persistence.saveAll(room, nowMs);
    await this.scheduleNextAlarm(nowMs);

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

      const simPlayer = this.room.sim.players[session.slot];
      if (simPlayer) {
        simPlayer.connected = false;
        simPlayer.farting = false;
        simPlayer.moveDir = 0;
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

    const expiredIds = this.sessions.expireGraceSessions(room, nowMs);
    let metaDirty = false;
    if (expiredIds.length > 0) {
      for (const id of expiredIds) {
        this.persistence.deleteSession(id);
        room.sessions.delete(id);
        this.rateLimiter.clear(id);
        logServerEvent('player_expired', { roomCode: room.roomCode, playerId: id });
      }
      const hostRes = reconcileHostLeadership(room, nowMs);
      if (hostRes.hostChanged) {
        logServerEvent('host_migrated', { roomCode: room.roomCode, newHostId: hostRes.newHostId });
      }
      syncBotsInRoom(room, nowMs);
      updateRoomEmptyState(room, nowMs);
      metaDirty = true;
    }

    if (shouldCloseAbandonedRoom(room, nowMs)) {
      void this.closeAndPurgeRoom();
      return;
    }

    const { events, lifecycleChanged } = stepRoomSimulation(room, rawDt, nowMs);
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
    }

    const periodicPersistDue = nowMs - (room.lastPersistedAtMs ?? 0) >= STATE_PERSIST_INTERVAL_MS;
    if (metaDirty || lifecycleChanged) {
      this.persistence.saveAll(room, nowMs);
    } else if (periodicPersistDue) {
      this.persistence.saveSimState(room, nowMs);
    }

    if (metaDirty || lifecycleChanged || nowMs - this.lastBroadcastMs >= SNAPSHOT_BROADCAST_INTERVAL_MS) {
      this.lastBroadcastMs = nowMs;
      const snapshot = issueNextRoomSnapshot(room, nowMs);
      this.broadcastMsg(
        metaDirty || lifecycleChanged ? makeRoomStateMsg(snapshot) : makeGameSnapshotMsg(snapshot),
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
      logServerEvent('room_closed', { roomCode: closingRoomCode });
    }
  }

  public dispose(): void {
    this.isClosing = true;
    this.stopLoop();
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
