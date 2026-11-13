import type { ClientProtocolMessage, ServerProtocolMessage } from '../../../src/shared/protocol.ts';
import { logServerEvent } from '../lib/logger.ts';
import type { SessionRateLimiter } from '../lib/rateLimit.ts';
import { ProtocolError } from '../protocol/errors.ts';
import {
  makeGameEventMsg,
  makePongMsg,
  makeRoomErrorMsg,
  makeRoomJoinedMsg,
  makeRoomStateMsg,
  makeSessionRenewedMsg,
} from '../protocol/messages.ts';
import { parseAndValidateClientEnvelope } from '../protocol/validators.ts';
import {
  canTransitionLifecycle,
  reconcileHostLeadership,
  syncBotsInRoom,
  updateRoomEmptyState,
  validateAllHumansReady,
} from './lifecycle.ts';
import type { RoomPersistence } from './persistence.ts';
import type { SessionManager } from './sessions.ts';
import { prepareSimForStart, restartRoomToWaiting } from './simulation.ts';
import { getEventsSince, issueNextRoomSnapshot } from './snapshots.ts';
import type { RoomRecord, SocketAttachment, SocketBinding } from './types.ts';

export interface MessageDispatchContext {
  room: RoomRecord;
  binding: SocketBinding;
  sessions: SessionManager;
  persistence: RoomPersistence;
  rateLimiter: SessionRateLimiter;
  sendToSocket: (ws: WebSocket, msg: ServerProtocolMessage) => void;
  broadcastState: (requestId?: string) => void;
  closeSocket: (ws: WebSocket, code: number, reason: string) => void;
  findSocketByPlayerId: (playerId: string, exceptWs?: WebSocket) => SocketBinding | null;
  updateAttachment?: (ws: WebSocket, attachment: SocketAttachment) => void;
  onStartLoop: () => void;
  onStopLoop?: () => void;
  onScheduleAlarm?: () => void;
  nowMs?: number;
}

export async function handleRoomClientMessage(
  rawData: string | ArrayBuffer | ArrayBufferView,
  ctx: MessageDispatchContext,
): Promise<void> {
  const nowMs = ctx.nowMs ?? Date.now();
  const parsed = parseAndValidateClientEnvelope(rawData);

  if (!parsed.ok) {
    ctx.sendToSocket(
      ctx.binding.ws,
      makeRoomErrorMsg(parsed.error.code, parsed.error.message, parsed.requestId, parsed.error.command),
    );
    return;
  }

  const msg: ClientProtocolMessage = parsed.message;
  const reqId = msg.requestId;

  if (msg.type === 'ping') {
    const rateKey = ctx.binding.playerId ?? `anon:${ctx.binding.sessionId ?? 'ws'}`;
    if (!ctx.rateLimiter.consume(rateKey, 'ping', nowMs)) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('RATE_LIMITED', undefined, reqId, 'ping'));
      return;
    }
    if (ctx.binding.authenticated && ctx.binding.playerId) {
      const session = ctx.room.sessions.get(ctx.binding.playerId);
      if (session && !session.revoked) {
        session.lastSeenAt = nowMs;
      }
    }
    ctx.sendToSocket(ctx.binding.ws, makePongMsg(nowMs, msg.payload?.clientTime, reqId));
    return;
  }

  if (msg.type === 'session:authenticate') {
    try {
      const { playerId, resumeToken } = msg.payload!;
      const existing = ctx.room.sessions.get(playerId);
      const isReconnect = Boolean(existing && existing.connectionEpoch > 1);

      const { session, newResumeToken } = await ctx.sessions.authenticateAndRotate({
        room: ctx.room,
        playerId,
        resumeToken,
        nowMs,
      });

      const oldBinding = ctx.findSocketByPlayerId(session.playerId, ctx.binding.ws);
      if (oldBinding) {
        const cleared: SocketAttachment = {
          authenticated: false,
          playerId: null,
          sessionId: null,
          connectionEpoch: 0,
        };
        oldBinding.authenticated = false;
        oldBinding.playerId = null;
        oldBinding.sessionId = null;
        oldBinding.connectionEpoch = 0;
        ctx.updateAttachment?.(oldBinding.ws, cleared);
        ctx.sendToSocket(
          oldBinding.ws,
          makeRoomErrorMsg('SESSION_REPLACED', undefined, undefined, 'session:authenticate'),
        );
        ctx.closeSocket(oldBinding.ws, 4001, 'SESSION_REPLACED');
      }

      ctx.binding.authenticated = true;
      ctx.binding.playerId = session.playerId;
      ctx.binding.sessionId = session.sessionId;
      ctx.binding.connectionEpoch = session.connectionEpoch;
      ctx.updateAttachment?.(ctx.binding.ws, {
        authenticated: true,
        playerId: session.playerId,
        sessionId: session.sessionId,
        connectionEpoch: session.connectionEpoch,
      });

      const simPlayer = ctx.room.sim.players[session.slot];
      simPlayer.id = session.playerId;
      simPlayer.name = session.name;
      simPlayer.cosmetic = session.cosmetic;
      simPlayer.connected = true;
      simPlayer.isBot = false;
      simPlayer.ready = session.ready;
      simPlayer.lastInputAt = nowMs;

      syncBotsInRoom(ctx.room, nowMs);
      updateRoomEmptyState(ctx.room, nowMs);

      const snapshot = issueNextRoomSnapshot(ctx.room, nowMs);
      ctx.persistence.saveAll(ctx.room, nowMs);

      ctx.sendToSocket(
        ctx.binding.ws,
        makeSessionRenewedMsg(
          {
            roomCode: ctx.room.roomCode,
            playerId: session.playerId,
            sessionId: session.sessionId,
            resumeToken: newResumeToken,
            connectionEpoch: session.connectionEpoch,
            role: session.role,
            slot: session.slot,
          },
          reqId,
        ),
      );

      ctx.sendToSocket(
        ctx.binding.ws,
        makeRoomJoinedMsg(
          {
            roomCode: ctx.room.roomCode,
            playerId: session.playerId,
            sessionId: session.sessionId,
            connectionEpoch: session.connectionEpoch,
            role: session.role,
            slot: session.slot,
            snapshot,
          },
          reqId,
        ),
      );

      if (isReconnect) {
        logServerEvent('player_reconnected', {
          roomCode: ctx.room.roomCode,
          playerId: session.playerId,
          slot: session.slot,
          connectionEpoch: session.connectionEpoch,
        });
      }

      ctx.broadcastState();
      if (ctx.room.lifecycleState === 'PLAYING' || ctx.room.lifecycleState === 'FALLING') {
        ctx.onStartLoop();
      }
      ctx.onScheduleAlarm?.();
    } catch (err) {
      logServerEvent('security_rejected', {
        roomCode: ctx.room.roomCode,
        command: 'session:authenticate',
        code: err instanceof ProtocolError ? err.code : 'INTERNAL_ERROR',
      });
      if (err instanceof ProtocolError) {
        ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg(err.code, err.message, reqId, 'session:authenticate'));
      } else {
        ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('INTERNAL_ERROR', undefined, reqId, 'session:authenticate'));
      }
    }
    return;
  }

  let session;
  try {
    session = ctx.sessions.assertActiveSessionBinding(ctx.room, ctx.binding);
  } catch (err) {
    if (err instanceof ProtocolError) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg(err.code, err.message, reqId, msg.type));
    } else {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('UNAUTHORIZED', undefined, reqId, msg.type));
    }
    return;
  }

  session.lastSeenAt = nowMs;

  if (msg.type === 'input:state') {
    if (!ctx.rateLimiter.consume(session.playerId, 'input', nowMs)) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('RATE_LIMITED', undefined, reqId, 'input:state'));
      return;
    }

    const { moveDir, farting, seq } = msg.payload!;
    if (!ctx.sessions.validateAndConsumeInputSeq(session, seq)) {
      return;
    }

    if (ctx.room.lifecycleState !== 'PLAYING' && ctx.room.lifecycleState !== 'FALLING') {
      return;
    }

    const player = ctx.room.sim.players[session.slot];
    if (!player || player.id !== session.playerId) return;
    player.moveDir = moveDir;
    player.farting = farting;
    player.lastInputAt = nowMs;
    return;
  }

  if (!ctx.rateLimiter.consume(session.playerId, 'control', nowMs)) {
    ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('RATE_LIMITED', undefined, reqId, msg.type));
    return;
  }

  try {
    switch (msg.type) {
      case 'game:resync': {
        const snap = issueNextRoomSnapshot(ctx.room, nowMs);
        ctx.sendToSocket(ctx.binding.ws, makeRoomStateMsg(snap, reqId));
        const afterEventId = msg.payload?.lastEventId ?? 0;
        const missedEvents = getEventsSince(ctx.room, afterEventId);
        if (missedEvents.length > 0) {
          ctx.sendToSocket(ctx.binding.ws, makeGameEventMsg(missedEvents));
        }
        break;
      }

      case 'room:ready': {
        if (ctx.room.lifecycleState !== 'WAITING') {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'لا يمكن تغيير الجاهزية أثناء الجولة.', 409, msg.type);
        }
        const readyVal = session.role === 'HOST' ? true : msg.payload!.ready;
        session.ready = readyVal;
        ctx.room.sim.players[session.slot].ready = readyVal;
        ctx.persistence.saveSession(session);
        ctx.persistence.saveRoomMeta(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        break;
      }

      case 'room:cosmetic': {
        const cosmetic = msg.payload!.cosmetic;
        session.cosmetic = cosmetic;
        ctx.room.sim.players[session.slot].cosmetic = cosmetic;
        ctx.persistence.saveSession(session);
        ctx.persistence.saveRoomMeta(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        break;
      }

      case 'room:toggleBots': {
        ctx.sessions.assertHostPermission(session, ctx.room, msg.type);
        if (ctx.room.lifecycleState !== 'WAITING') {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'يمكن تعديل المساعدين الآليين في غرفة الانتظار فقط.', 409, msg.type);
        }
        ctx.room.fillBots = msg.payload!.fillBots;
        syncBotsInRoom(ctx.room, nowMs);
        ctx.persistence.saveAll(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        break;
      }

      case 'room:start': {
        ctx.sessions.assertHostPermission(session, ctx.room, msg.type);
        const dedupKey = reqId ? `cmd:${session.playerId}:${reqId}:room:start` : null;
        if (dedupKey && ctx.persistence.getRequestRecord(dedupKey, nowMs)) {
          return;
        }
        if (ctx.room.lifecycleState !== 'WAITING' || !canTransitionLifecycle(ctx.room.lifecycleState, 'PLAYING')) {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'لا يمكن بدء الجولة إلا من غرفة الانتظار.', 409, msg.type);
        }
        const readiness = validateAllHumansReady(ctx.room);
        if (!readiness.ok) {
          throw new ProtocolError(
            'PLAYERS_NOT_READY',
            `لا يمكن بدء الجولة قبل جاهزية: ${readiness.unreadyNames.join('، ')}`,
            409,
            msg.type,
          );
        }

        prepareSimForStart(ctx.room, nowMs);
        if (dedupKey) {
          ctx.persistence.saveRequestRecord(dedupKey, ctx.room.roomCode, 'room:start', { ok: true }, 60_000, nowMs);
        }
        ctx.persistence.saveAll(ctx.room, nowMs);
        logServerEvent('round_started', {
          roomCode: ctx.room.roomCode,
          hostId: ctx.room.hostId,
          fillBots: ctx.room.fillBots,
        });
        ctx.broadcastState(reqId);
        ctx.onStartLoop();
        break;
      }

      case 'room:restart': {
        ctx.sessions.assertHostPermission(session, ctx.room, msg.type);
        const dedupKey = reqId ? `cmd:${session.playerId}:${reqId}:room:restart` : null;
        if (dedupKey && ctx.persistence.getRequestRecord(dedupKey, nowMs)) {
          return;
        }
        if (
          ctx.room.lifecycleState === 'RESTARTING' ||
          ctx.room.lifecycleState === 'CLOSED' ||
          !canTransitionLifecycle(ctx.room.lifecycleState, 'RESTARTING')
        ) {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'لا يمكن إعادة الجولة في هذه الحالة.', 409, msg.type);
        }

        restartRoomToWaiting(ctx.room, nowMs);
        if (dedupKey) {
          ctx.persistence.saveRequestRecord(dedupKey, ctx.room.roomCode, 'room:restart', { ok: true }, 60_000, nowMs);
        }
        ctx.persistence.saveAll(ctx.room, nowMs);
        ctx.onStopLoop?.();
        logServerEvent('room_restarted', {
          roomCode: ctx.room.roomCode,
          hostId: ctx.room.hostId,
        });
        ctx.broadcastState(reqId);
        ctx.onScheduleAlarm?.();
        break;
      }

      case 'room:leave': {
        session.revoked = true;
        session.connected = false;
        const simPlayer = ctx.room.sim.players[session.slot];
        if (simPlayer) {
          simPlayer.farting = false;
          simPlayer.moveDir = 0;
          simPlayer.connected = false;
        }
        const cleared: SocketAttachment = {
          authenticated: false,
          playerId: null,
          sessionId: null,
          connectionEpoch: 0,
        };
        ctx.binding.authenticated = false;
        ctx.binding.playerId = null;
        ctx.binding.sessionId = null;
        ctx.binding.connectionEpoch = 0;
        ctx.updateAttachment?.(ctx.binding.ws, cleared);

        ctx.persistence.deleteSession(session.playerId);
        ctx.room.sessions.delete(session.playerId);
        ctx.rateLimiter.clear(session.playerId);

        const hostResult = reconcileHostLeadership(ctx.room, nowMs);
        if (hostResult.hostChanged) {
          logServerEvent('host_migrated', {
            roomCode: ctx.room.roomCode,
            newHostId: hostResult.newHostId,
          });
        }
        syncBotsInRoom(ctx.room, nowMs);
        updateRoomEmptyState(ctx.room, nowMs);
        ctx.persistence.saveAll(ctx.room, nowMs);
        logServerEvent('player_disconnected', {
          roomCode: ctx.room.roomCode,
          playerId: session.playerId,
          slot: session.slot,
          reason: 'left_room',
        });
        ctx.broadcastState();
        ctx.onScheduleAlarm?.();
        ctx.closeSocket(ctx.binding.ws, 1000, 'LEFT_ROOM');
        break;
      }
    }
  } catch (err) {
    if (err instanceof ProtocolError) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg(err.code, err.message, reqId, err.command ?? msg.type));
    } else {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('INTERNAL_ERROR', undefined, reqId, msg.type));
    }
  }
}
