import { COURSE_LIST } from '../../../src/shared/course.ts';
import { normalizeRoomSettings } from '../../../src/shared/physics.ts';
import {
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type ClientProtocolMessage,
  type ServerProtocolMessage,
} from '../../../src/shared/protocol.ts';
import {
  getEmoteDefinition,
  getQuickChatPreset,
  popNextPlaylistItem,
  sanitizeChatText,
} from '../../../src/shared/social.ts';
import type { ChatMessage } from '../../../src/shared/types.ts';
import { logServerEvent } from '../lib/logger.ts';
import type { SessionRateLimiter } from '../lib/rateLimit.ts';
import { ProtocolError } from '../protocol/errors.ts';
import { opsMetrics } from '../services/metrics.ts';
import {
  makeChatMessageMsg,
  makeGameEmoteMsg,
  makeGameEventMsg,
  makePongMsg,
  makeRoomErrorMsg,
  makeRoomJoinedMsg,
  makeRoomStateMsg,
  makeSessionRenewedMsg,
} from '../protocol/messages.ts';
import { parseAndValidateClientEnvelope } from '../protocol/validators.ts';
import { applyCoursePreviewToSim } from './courses.ts';
import {
  canTransitionLifecycle,
  reconcileHostLeadership,
  syncBotsInRoom,
  updateRoomEmptyState,
  validateAllHumansReady,
} from './lifecycle.ts';
import type { RoomPersistence } from './persistence.ts';
import { isSpectatorSession, type SessionManager } from './sessions.ts';
import { prepareSimForStart, restartRoomToWaiting } from './simulation.ts';
import { getEventsSince, issueNextRoomSnapshot } from './snapshots.ts';
import {
  MAX_WS_AUTH_ATTEMPTS,
  type RoomRecord,
  type SocketAttachment,
  type SocketBinding,
} from './types.ts';

export interface MessageDispatchContext {
  room: RoomRecord;
  binding: SocketBinding;
  sessions: SessionManager;
  persistence: RoomPersistence;
  rateLimiter: SessionRateLimiter;
  consumeDurableRateLimit?: (
    key: string,
    capacity: number,
    refillPerMs: number,
    ttlMs?: number,
    nowMs?: number,
  ) => boolean;
  sendToSocket: (ws: WebSocket, msg: ServerProtocolMessage) => void;
  broadcastMsg: (msg: ServerProtocolMessage) => void;
  broadcastState: (requestId?: string) => void;
  closeSocket: (ws: WebSocket, code: number, reason: string) => void;
  findSocketByPlayerId: (playerId: string, exceptWs?: WebSocket) => SocketBinding | null;
  updateAttachment?: (ws: WebSocket, attachment: SocketAttachment) => void;
  onStartLoop: () => void;
  onStopLoop?: () => void;
  onScheduleAlarm?: () => void;
  onDirectorySync?: () => void;
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
    if (!ctx.binding.authenticated && parsed.error.command === 'session:authenticate') {
      const nextAttempts = (ctx.binding.authAttempts ?? 0) + 1;
      ctx.binding.authAttempts = nextAttempts;
      ctx.updateAttachment?.(ctx.binding.ws, {
        authenticated: false,
        playerId: null,
        sessionId: null,
        connectionEpoch: 0,
        authAttempts: nextAttempts,
        kind: 'room',
      });
      if (nextAttempts >= MAX_WS_AUTH_ATTEMPTS) {
        ctx.closeSocket(ctx.binding.ws, 4003, 'AUTH_FAILED_LIMIT');
      }
    }
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
    const nextAttempts = (ctx.binding.authAttempts ?? 0) + 1;
    ctx.binding.authAttempts = nextAttempts;
    ctx.updateAttachment?.(ctx.binding.ws, {
      authenticated: ctx.binding.authenticated,
      playerId: ctx.binding.playerId,
      sessionId: ctx.binding.sessionId,
      connectionEpoch: ctx.binding.connectionEpoch,
      authAttempts: nextAttempts,
      kind: 'room',
    });

    if (nextAttempts > MAX_WS_AUTH_ATTEMPTS) {
      logServerEvent('security_rejected', {
        roomCode: ctx.room.roomCode,
        command: 'session:authenticate',
        code: 'RATE_LIMITED',
      });
      ctx.sendToSocket(
        ctx.binding.ws,
        makeRoomErrorMsg(
          'RATE_LIMITED',
          'تم تجاوز الحد المسموح لمحاولات المصادقة على هذا الاتصال.',
          reqId,
          'session:authenticate',
        ),
      );
      ctx.closeSocket(ctx.binding.ws, 4003, 'AUTH_ATTEMPTS_EXCEEDED');
      return;
    }

    const { playerId, resumeToken, protocolVersion } = msg.payload!;
    if (
      protocolVersion !== undefined &&
      (protocolVersion < MIN_COMPATIBLE_PROTOCOL_VERSION || protocolVersion > PROTOCOL_VERSION)
    ) {
      ctx.sendToSocket(
        ctx.binding.ws,
        makeRoomErrorMsg('PROTOCOL_MISMATCH', undefined, reqId, 'session:authenticate'),
      );
      ctx.closeSocket(ctx.binding.ws, 4002, 'PROTOCOL_MISMATCH');
      return;
    }
    const durableAllowed = ctx.consumeDurableRateLimit
      ? ctx.consumeDurableRateLimit(`rl:wsauth:${playerId}`, 10, 10 / 60_000, 5 * 60_000, nowMs)
      : true;
    if (!ctx.rateLimiter.consume(playerId, 'auth', nowMs) || !durableAllowed) {
      logServerEvent('security_rejected', {
        roomCode: ctx.room.roomCode,
        command: 'session:authenticate',
        code: 'RATE_LIMITED',
      });
      ctx.sendToSocket(
        ctx.binding.ws,
        makeRoomErrorMsg('RATE_LIMITED', undefined, reqId, 'session:authenticate'),
      );
      ctx.closeSocket(ctx.binding.ws, 4003, 'AUTH_RATE_LIMITED');
      return;
    }

    try {
      const existing = ctx.room.sessions.get(playerId);
      const isReconnect = Boolean(existing && existing.connectionEpoch > 1);

      const { session, newResumeToken } = await ctx.sessions.authenticateAndRotate({
        room: ctx.room,
        playerId,
        resumeToken,
        nowMs,
      });

      let oldBinding = ctx.findSocketByPlayerId(session.playerId, ctx.binding.ws);
      while (oldBinding) {
        const cleared: SocketAttachment = {
          authenticated: false,
          playerId: null,
          sessionId: null,
          connectionEpoch: 0,
          authAttempts: 0,
          kind: 'room',
        };
        oldBinding.authenticated = false;
        oldBinding.playerId = null;
        oldBinding.sessionId = null;
        oldBinding.connectionEpoch = 0;
        oldBinding.authAttempts = 0;
        ctx.updateAttachment?.(oldBinding.ws, cleared);
        ctx.sendToSocket(
          oldBinding.ws,
          makeRoomErrorMsg('SESSION_REPLACED', undefined, undefined, 'session:authenticate'),
        );
        ctx.closeSocket(oldBinding.ws, 4001, 'SESSION_REPLACED');
        oldBinding = ctx.findSocketByPlayerId(session.playerId, ctx.binding.ws);
      }

      ctx.binding.authenticated = true;
      ctx.binding.playerId = session.playerId;
      ctx.binding.sessionId = session.sessionId;
      ctx.binding.connectionEpoch = session.connectionEpoch;
      ctx.binding.authAttempts = 0;
      ctx.updateAttachment?.(ctx.binding.ws, {
        authenticated: true,
        playerId: session.playerId,
        sessionId: session.sessionId,
        connectionEpoch: session.connectionEpoch,
        authAttempts: 0,
        kind: 'room',
      });

      const authSlot = session.slot;
      if (authSlot !== -1) {
        const simPlayer = ctx.room.sim.players[authSlot];
        simPlayer.id = session.playerId;
        simPlayer.name = session.name;
        simPlayer.cosmetic = session.cosmetic;
        simPlayer.connected = true;
        simPlayer.isBot = false;
        simPlayer.tempBotSubstitute = false;
        simPlayer.ready = session.ready;
        simPlayer.seatStatus = 'CONNECTED';
        simPlayer.lastInputAt = nowMs;
      }

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
        opsMetrics.recordReconnect();
        logServerEvent('player_reconnected', {
          roomCode: ctx.room.roomCode,
          playerId: session.playerId,
          slot: session.slot,
          connectionEpoch: session.connectionEpoch,
        });
      }

      ctx.broadcastState();
      ctx.onDirectorySync?.();
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
      if ((ctx.binding.authAttempts ?? 0) >= MAX_WS_AUTH_ATTEMPTS) {
        ctx.closeSocket(ctx.binding.ws, 4003, 'AUTH_FAILED_LIMIT');
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
    if (isSpectatorSession(session) || session.slot < 0) {
      ctx.sendToSocket(
        ctx.binding.ws,
        makeRoomErrorMsg('SPECTATOR_FORBIDDEN', undefined, reqId, 'input:state'),
      );
      return;
    }
    if (!ctx.rateLimiter.consume(session.playerId, 'input', nowMs)) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('RATE_LIMITED', undefined, reqId, 'input:state'));
      return;
    }

    const { moveDir, farting, anchor, useItem, seq } = msg.payload!;
    if (!ctx.sessions.validateAndConsumeInputSeq(session, seq)) {
      return;
    }

    if (ctx.room.lifecycleState !== 'PLAYING' && ctx.room.lifecycleState !== 'FALLING') {
      return;
    }

    const inputSlot = session.slot;
    if (inputSlot === -1) return;
    const player = ctx.room.sim.players[inputSlot];
    if (!player || player.id !== session.playerId) return;
    player.moveDir = moveDir;
    player.farting = farting;
    if (anchor !== undefined) player.anchorRequested = anchor;
    if (useItem) player.useItemRequested = true;
    player.lastInputAt = nowMs;
    return;
  }

  if (msg.type === 'chat:send') {
    if (!ctx.rateLimiter.consume(session.playerId, 'chat', nowMs)) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('RATE_LIMITED', undefined, reqId, 'chat:send'));
      return;
    }
    const preset = msg.payload?.presetId ? getQuickChatPreset(msg.payload.presetId) : null;
    const text = preset ? preset.text : sanitizeChatText(msg.payload?.text);
    if (!text) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('INVALID_MESSAGE', undefined, reqId, 'chat:send'));
      return;
    }

    const chatMessage: ChatMessage = {
      id: `msg-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: session.playerId,
      senderName: session.name,
      senderSlot: session.slot,
      isSpectator: isSpectatorSession(session),
      colorIndex: session.cosmetic.colorIndex,
      text,
      ...(preset ? { presetId: preset.id } : {}),
      createdAt: nowMs,
    };
    ctx.room.recentChat.push(chatMessage);
    if (ctx.room.recentChat.length > 40) {
      ctx.room.recentChat.splice(0, ctx.room.recentChat.length - 40);
    }
    ctx.persistence.saveSimState(ctx.room, nowMs);
    ctx.broadcastMsg(makeChatMessageMsg({ message: chatMessage }, reqId));
    return;
  }

  if (msg.type === 'emote:trigger') {
    if (!ctx.rateLimiter.consume(session.playerId, 'emote', nowMs)) {
      ctx.sendToSocket(ctx.binding.ws, makeRoomErrorMsg('RATE_LIMITED', undefined, reqId, 'emote:trigger'));
      return;
    }
    const def = getEmoteDefinition(msg.payload!.emoteId);
    ctx.room.emoteSeq = (ctx.room.emoteSeq ?? 0) + 1;
    const emoteSlot = session.slot;
    if (emoteSlot !== -1) {
      const simPlayer = ctx.room.sim.players[emoteSlot];
      if (simPlayer) {
        simPlayer.activeEmote = {
          id: def.id,
          seq: ctx.room.emoteSeq,
          expiresAtMs: nowMs + def.durationMs,
        };
      }
    }
    ctx.broadcastMsg(
      makeGameEmoteMsg(
        {
          playerId: session.playerId,
          slot: session.slot,
          name: session.name,
          emoteId: def.id,
          colorIndex: session.cosmetic.colorIndex,
          durationMs: def.durationMs,
          serverTime: nowMs,
        },
        reqId,
      ),
    );
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
        const readySlot = session.slot;
        if (isSpectatorSession(session) || readySlot === -1) {
          throw new ProtocolError('SPECTATOR_FORBIDDEN', undefined, 403, msg.type);
        }
        if (ctx.room.lifecycleState !== 'WAITING') {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'لا يمكن تغيير الجاهزية أثناء الجولة.', 409, msg.type);
        }
        const readyVal = session.role === 'HOST' ? true : msg.payload!.ready;
        session.ready = readyVal;
        ctx.room.sim.players[readySlot].ready = readyVal;
        ctx.persistence.saveSession(session);
        ctx.persistence.saveRoomMeta(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        break;
      }

      case 'room:cosmetic': {
        const cosmetic = msg.payload!.cosmetic;
        session.cosmetic = cosmetic;
        const cosSlot = session.slot;
        if (cosSlot !== -1) {
          ctx.room.sim.players[cosSlot].cosmetic = cosmetic;
        }
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
        ctx.onDirectorySync?.();
        break;
      }

      case 'room:selectCourse': {
        ctx.sessions.assertHostPermission(session, ctx.room, msg.type);
        if (ctx.room.lifecycleState !== 'WAITING') {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'يمكن تغيير المسار في غرفة الانتظار فقط.', 409, msg.type);
        }
        const nextMode = msg.payload!.courseSelectionMode ?? ctx.room.courseSelectionMode;
        ctx.room.courseSelectionMode = nextMode;
        ctx.room.courseId = msg.payload!.courseId;
        if (nextMode === 'host') {
          ctx.room.courseVotes = {};
        } else {
          if (!ctx.room.courseVotes[session.playerId]) {
            ctx.room.courseVotes[session.playerId] = msg.payload!.courseId;
          }
        }
        applyCoursePreviewToSim(ctx.room);
        ctx.persistence.saveAll(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        ctx.onDirectorySync?.();
        break;
      }

      case 'room:voteCourse': {
        if (isSpectatorSession(session) || session.slot < 0) {
          throw new ProtocolError('SPECTATOR_FORBIDDEN', undefined, 403, msg.type);
        }
        if (ctx.room.lifecycleState !== 'WAITING') {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'التصويت متاح في غرفة الانتظار فقط.', 409, msg.type);
        }
        if (ctx.room.courseSelectionMode !== 'vote') {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'التصويت غير مفعّل حاليًا من قِبل المضيف.', 409, msg.type);
        }
        ctx.room.courseVotes[session.playerId] = msg.payload!.courseId;
        applyCoursePreviewToSim(ctx.room);
        ctx.persistence.saveAll(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        ctx.onDirectorySync?.();
        break;
      }

      case 'room:updateSettings': {
        ctx.sessions.assertHostPermission(session, ctx.room, msg.type);
        if (ctx.room.lifecycleState !== 'WAITING') {
          throw new ProtocolError('INVALID_LIFECYCLE_STATE', 'يمكن تعديل إعدادات الغرفة في غرفة الانتظار فقط.', 409, msg.type);
        }
        const nextSettings = normalizeRoomSettings(msg.payload!.settings, ctx.room.settings);
        let activeHumanCount = 0;
        let maxOccupiedSlot = 0;
        for (const s of ctx.room.sessions.values()) {
          if (s.revoked || isSpectatorSession(s) || s.slot < 0) continue;
          activeHumanCount += 1;
          if (s.slot + 1 > maxOccupiedSlot) {
            maxOccupiedSlot = s.slot + 1;
          }
        }
        if (nextSettings.maxPlayers < activeHumanCount || nextSettings.maxPlayers < maxOccupiedSlot) {
          throw new ProtocolError(
            'INVALID_MESSAGE',
            'لا يمكن تقليص الحد الأقصى للاعبين أقل من عدد المقاعد المشغولة حاليًا.',
            409,
            msg.type,
          );
        }
        ctx.room.settings = nextSettings;
        applyCoursePreviewToSim(ctx.room);
        syncBotsInRoom(ctx.room, nowMs);
        ctx.persistence.saveAll(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        ctx.onDirectorySync?.();
        break;
      }

      case 'room:setPlaylist': {
        ctx.sessions.assertHostPermission(session, ctx.room, msg.type);
        if (ctx.room.lifecycleState !== 'WAITING' && ctx.room.lifecycleState !== 'FINISHED') {
          throw new ProtocolError(
            'INVALID_LIFECYCLE_STATE',
            'يمكن تعديل قائمة الجولات في الردهة أو بعد نهاية الجولة فقط.',
            409,
            msg.type,
          );
        }
        ctx.room.playlistQueue = msg.payload!.playlist;
        ctx.persistence.saveRoomMeta(ctx.room, nowMs);
        ctx.broadcastState(reqId);
        break;
      }

      case 'room:nextRound': {
        ctx.sessions.assertHostPermission(session, ctx.room, msg.type);
        if (ctx.room.lifecycleState !== 'FINISHED' && ctx.room.lifecycleState !== 'WAITING') {
          throw new ProtocolError(
            'INVALID_LIFECYCLE_STATE',
            'يمكن الانتقال للجولة التالية في الردهة أو بعد نهاية الجولة فقط.',
            409,
            msg.type,
          );
        }

        const { action, courseId, settings, immediate } = msg.payload!;

        if (action === 'lobby') {
          restartRoomToWaiting(ctx.room, nowMs);
          ctx.persistence.saveAll(ctx.room, nowMs);
          ctx.onStopLoop?.();
          ctx.broadcastState(reqId);
          ctx.onDirectorySync?.();
          ctx.onScheduleAlarm?.();
          break;
        }

        if (action === 'course' && courseId) {
          ctx.room.courseSelectionMode = 'host';
          ctx.room.courseVotes = {};
          ctx.room.courseId = courseId;
          if (settings) {
            ctx.room.settings = normalizeRoomSettings(settings, ctx.room.settings);
          }
        } else if (action === 'next') {
          const { next, remaining } = popNextPlaylistItem(ctx.room.playlistQueue);
          ctx.room.courseSelectionMode = 'host';
          ctx.room.courseVotes = {};
          if (next) {
            ctx.room.playlistQueue = remaining;
            ctx.room.courseId = next.courseId;
            ctx.room.settings = normalizeRoomSettings(
              {
                gameMode: next.gameMode,
                difficulty: next.difficulty,
                ...(settings ?? {}),
              },
              ctx.room.settings,
            );
          } else {
            const idx = COURSE_LIST.findIndex((c) => c.id === ctx.room.courseId);
            const nextCourse = COURSE_LIST[(idx + 1) % COURSE_LIST.length];
            ctx.room.courseId = nextCourse.id;
            if (settings) {
              ctx.room.settings = normalizeRoomSettings(settings, ctx.room.settings);
            }
          }
        } else if (action === 'replay' && settings) {
          ctx.room.settings = normalizeRoomSettings(settings, ctx.room.settings);
        }

        restartRoomToWaiting(ctx.room, nowMs);
        applyCoursePreviewToSim(ctx.room);

        if (immediate !== false) {
          prepareSimForStart(ctx.room, nowMs);
          ctx.persistence.saveAll(ctx.room, nowMs);
          ctx.broadcastState(reqId);
          ctx.onDirectorySync?.();
          ctx.onStartLoop();
        } else {
          ctx.persistence.saveAll(ctx.room, nowMs);
          ctx.onStopLoop?.();
          ctx.broadcastState(reqId);
          ctx.onDirectorySync?.();
          ctx.onScheduleAlarm?.();
        }
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

        applyCoursePreviewToSim(ctx.room);
        prepareSimForStart(ctx.room, nowMs);
        if (dedupKey) {
          ctx.persistence.saveRequestRecord(dedupKey, ctx.room.roomCode, 'room:start', { ok: true }, 60_000, nowMs);
        }
        ctx.persistence.saveAll(ctx.room, nowMs);
        logServerEvent('round_started', {
          roomCode: ctx.room.roomCode,
          hostId: ctx.room.hostId,
          fillBots: ctx.room.fillBots,
          courseId: ctx.room.courseId,
        });
        ctx.broadcastState(reqId);
        ctx.onDirectorySync?.();
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
        ctx.onDirectorySync?.();
        ctx.onScheduleAlarm?.();
        break;
      }

      case 'room:leave': {
        session.revoked = true;
        session.connected = false;
        const leaveSlot = session.slot;
        if (leaveSlot !== -1) {
          const simPlayer = ctx.room.sim.players[leaveSlot];
          if (simPlayer) {
            simPlayer.farting = false;
            simPlayer.moveDir = 0;
            simPlayer.anchorRequested = false;
            simPlayer.useItemRequested = false;
            simPlayer.connected = false;
          }
        }
        const cleared: SocketAttachment = {
          authenticated: false,
          playerId: null,
          sessionId: null,
          connectionEpoch: 0,
          kind: 'room',
        };
        ctx.binding.authenticated = false;
        ctx.binding.playerId = null;
        ctx.binding.sessionId = null;
        ctx.binding.connectionEpoch = 0;
        ctx.updateAttachment?.(ctx.binding.ws, cleared);

        ctx.persistence.deleteSession(session.playerId);
        ctx.room.sessions.delete(session.playerId);
        delete ctx.room.courseVotes[session.playerId];
        ctx.rateLimiter.clear(session.playerId);

        const hostResult = reconcileHostLeadership(ctx.room, nowMs);
        if (hostResult.hostChanged) {
          logServerEvent('host_migrated', {
            roomCode: ctx.room.roomCode,
            newHostId: hostResult.newHostId,
          });
        }
        if (ctx.room.lifecycleState === 'WAITING') {
          applyCoursePreviewToSim(ctx.room);
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
        ctx.onDirectorySync?.();
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
