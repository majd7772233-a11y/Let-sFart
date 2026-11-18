import {
  MAX_WS_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  makeEnvelope,
  type CreatePartyHttpRequest,
  type JoinPartyHttpRequest,
  type PartyClientMessage,
  type PartyServerMessage,
  type PartySessionCredentials,
} from '../../../src/shared/protocol.ts';
import { getQuickChatPreset, sanitizeChatText } from '../../../src/shared/social.ts';
import type { ChatMessage, PlayerCosmetic, PartyMember, PartyState } from '../../../src/shared/types.ts';
import {
  createWebSocketPair,
  createWebSocketUpgradeResponse,
} from '../env.ts';
import { SessionRateLimiter } from '../lib/rateLimit.ts';
import { isValidRoomCode, normalizeRoomCode } from '../lib/roomCode.ts';
import { generateResumeToken, hashToken, verifyTokenHash } from '../lib/tokens.ts';
import { isBoolean, isRecord, sanitizeCosmeticOrDefault, sanitizePlayerName } from '../lib/validation.ts';
import { ERROR_MESSAGES_AR, makeErrorPayload, ProtocolError } from '../protocol/errors.ts';
import { decodeRawMessageToString, getMessageByteLength } from '../protocol/validators.ts';
import {
  MAX_WS_AUTH_ATTEMPTS,
  type SocketAttachment,
  type SocketBinding,
  type SqlStorageAdapter,
} from '../rooms/types.ts';

const MAX_PARTY_MEMBERS = 4;
const PARTY_TTL_MS = 4 * 60 * 60 * 1000;

interface PartyMetaRow {
  party_code: string;
  leader_member_id: string;
  active_room_code: string | null;
  active_room_password: string | null;
  room_follow_seq: number;
  recent_chat_json: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

interface PartyMemberRow {
  member_id: string;
  party_code: string;
  name: string;
  cosmetic_json: string;
  resume_token_hash: string;
  session_id: string;
  connection_epoch: number;
  connected: number;
  revoked: number;
  joined_at: number;
  last_seen_at: number;
  expires_at: number;
}

interface PartyMemberRecord {
  memberId: string;
  partyCode: string;
  name: string;
  cosmetic: PlayerCosmetic;
  resumeTokenHash: string;
  sessionId: string;
  connectionEpoch: number;
  connected: boolean;
  revoked: boolean;
  joinedAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface PartyRecord {
  partyCode: string;
  leaderId: string;
  activeRoomCode: string | null;
  activeRoomPassword: string | null;
  followSeq: number;
  recentChat: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  members: Map<string, PartyMemberRecord>;
}

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readAttachment(ws: WebSocket): SocketAttachment | null {
  try {
    const carrier = ws as unknown as { deserializeAttachment?: () => unknown };
    const raw = carrier.deserializeAttachment?.();
    if (!raw || typeof raw !== 'object') return null;
    return raw as SocketAttachment;
  } catch {
    return null;
  }
}

function writeAttachment(ws: WebSocket, att: SocketAttachment): void {
  try {
    const carrier = ws as unknown as { serializeAttachment?: (val: unknown) => void };
    carrier.serializeAttachment?.(att);
  } catch {
    // ignore
  }
}

function parsePartyChat(rawJson: string | undefined): ChatMessage[] {
  if (!rawJson) return [];
  try {
    const arr = JSON.parse(rawJson);
    if (!Array.isArray(arr)) return [];
    const out: ChatMessage[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Partial<ChatMessage>;
      const text = sanitizeChatText(m.text);
      if (!m.id || !m.senderId || !m.senderName || !text || typeof m.createdAt !== 'number') continue;
      out.push({
        id: String(m.id).slice(0, 64),
        senderId: String(m.senderId).slice(0, 64),
        senderName: String(m.senderName).slice(0, 20),
        senderSlot: -1,
        isSpectator: false,
        colorIndex: typeof m.colorIndex === 'number' ? m.colorIndex : 0,
        text,
        ...(typeof m.presetId === 'string' ? { presetId: m.presetId } : {}),
        createdAt: m.createdAt,
      });
    }
    return out.slice(-40);
  } catch {
    return [];
  }
}

export class PartyController {
  private ctx: DurableObjectState;
  private sql: SqlStorageAdapter;
  private party: PartyRecord | null = null;
  private sockets = new Map<WebSocket, SocketBinding>();
  private rateLimiter = new SessionRateLimiter();
  private inFlightJoinCount = 0;

  constructor(ctx: DurableObjectState, sql: SqlStorageAdapter) {
    this.ctx = ctx;
    this.sql = sql;
  }

  public initFromStorage(nowMs = Date.now()): void {
    this.party = this.loadParty();
    if (this.party && nowMs >= this.party.expiresAt) {
      this.purgeParty(this.party.partyCode);
      this.party = null;
      return;
    }

    if (!this.party) return;

    const ctxAny = this.ctx as unknown as { getWebSockets?: () => WebSocket[] };
    const hibernated = ctxAny.getWebSockets?.() ?? [];
    for (const ws of hibernated) {
      const att = readAttachment(ws);
      if (!att || !att.authenticated || !att.playerId || !att.sessionId) {
        const empty: SocketAttachment = {
          authenticated: false,
          playerId: null,
          sessionId: null,
          connectionEpoch: 0,
          authAttempts: att?.authAttempts ?? 0,
          kind: 'party',
        };
        writeAttachment(ws, empty);
        this.sockets.set(ws, { ws, ...empty });
        continue;
      }

      const member = this.party.members.get(att.playerId);
      if (
        !member ||
        member.revoked ||
        member.sessionId !== att.sessionId ||
        member.connectionEpoch !== att.connectionEpoch ||
        nowMs >= member.expiresAt
      ) {
        try {
          ws.close(4001, 'SESSION_EXPIRED');
        } catch {
          // ignore
        }
        continue;
      }

      member.connected = true;
      member.lastSeenAt = nowMs;
      this.sockets.set(ws, {
        ws,
        authenticated: true,
        playerId: member.memberId,
        sessionId: member.sessionId,
        connectionEpoch: member.connectionEpoch,
        kind: 'party',
      });
    }
  }

  public hasActiveParty(): boolean {
    return this.party !== null;
  }

  private loadParty(): PartyRecord | null {
    const metaRows = this.sql
      .exec<PartyMetaRow>(
        `SELECT party_code, leader_member_id, active_room_code, active_room_password,
                room_follow_seq, recent_chat_json, created_at, updated_at, expires_at
         FROM party_meta
         LIMIT 1`,
      )
      .toArray();
    if (metaRows.length === 0) return null;
    const row = metaRows[0];

    const memberRows = this.sql
      .exec<PartyMemberRow>(
        `SELECT member_id, party_code, name, cosmetic_json, resume_token_hash,
                session_id, connection_epoch, connected, revoked, joined_at, last_seen_at, expires_at
         FROM party_members
         WHERE party_code = ?`,
        row.party_code,
      )
      .toArray();

    const members = new Map<string, PartyMemberRecord>();
    for (const mr of memberRows) {
      let cosmetic: PlayerCosmetic;
      try {
        cosmetic = JSON.parse(mr.cosmetic_json) as PlayerCosmetic;
      } catch {
        cosmetic = sanitizeCosmeticOrDefault(undefined, 0);
      }
      members.set(mr.member_id, {
        memberId: mr.member_id,
        partyCode: mr.party_code,
        name: mr.name,
        cosmetic,
        resumeTokenHash: mr.resume_token_hash,
        sessionId: mr.session_id,
        connectionEpoch: mr.connection_epoch,
        connected: false,
        revoked: Boolean(mr.revoked),
        joinedAt: mr.joined_at,
        lastSeenAt: mr.last_seen_at,
        expiresAt: mr.expires_at,
      });
    }

    return {
      partyCode: row.party_code,
      leaderId: row.leader_member_id,
      activeRoomCode: row.active_room_code ?? null,
      activeRoomPassword: row.active_room_password ?? null,
      followSeq: row.room_follow_seq ?? 0,
      recentChat: parsePartyChat(row.recent_chat_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      members,
    };
  }

  private saveMeta(party: PartyRecord, nowMs = Date.now()): void {
    party.updatedAt = nowMs;
    this.sql.exec(
      `INSERT INTO party_meta (
        party_code, leader_member_id, active_room_code, active_room_password,
        room_follow_seq, recent_chat_json, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(party_code) DO UPDATE SET
        leader_member_id = excluded.leader_member_id,
        active_room_code = excluded.active_room_code,
        active_room_password = excluded.active_room_password,
        room_follow_seq = excluded.room_follow_seq,
        recent_chat_json = excluded.recent_chat_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at`,
      party.partyCode,
      party.leaderId,
      party.activeRoomCode,
      party.activeRoomPassword,
      party.followSeq,
      JSON.stringify(party.recentChat.slice(-40)),
      party.createdAt,
      nowMs,
      party.expiresAt,
    );
  }

  private saveMember(m: PartyMemberRecord): void {
    this.sql.exec(
      `INSERT INTO party_members (
        member_id, party_code, name, cosmetic_json, resume_token_hash,
        session_id, connection_epoch, connected, revoked, joined_at, last_seen_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id) DO UPDATE SET
        name = excluded.name,
        cosmetic_json = excluded.cosmetic_json,
        resume_token_hash = excluded.resume_token_hash,
        session_id = excluded.session_id,
        connection_epoch = excluded.connection_epoch,
        connected = excluded.connected,
        revoked = excluded.revoked,
        joined_at = excluded.joined_at,
        last_seen_at = excluded.last_seen_at,
        expires_at = excluded.expires_at`,
      m.memberId,
      m.partyCode,
      m.name,
      JSON.stringify(m.cosmetic),
      m.resumeTokenHash,
      m.sessionId,
      m.connectionEpoch,
      m.connected ? 1 : 0,
      m.revoked ? 1 : 0,
      m.joinedAt,
      m.lastSeenAt,
      m.expiresAt,
    );
  }

  private deleteMemberRow(memberId: string): void {
    this.sql.exec(`DELETE FROM party_members WHERE member_id = ?`, memberId);
  }

  private purgeParty(partyCode: string): void {
    this.sql.exec(`DELETE FROM party_members WHERE party_code = ?`, partyCode);
    this.sql.exec(`DELETE FROM party_meta WHERE party_code = ?`, partyCode);
  }

  private buildState(party: PartyRecord): PartyState {
    const members: PartyMember[] = Array.from(party.members.values())
      .filter((m) => !m.revoked)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({
        memberId: m.memberId,
        name: m.name,
        cosmetic: m.cosmetic,
        isLeader: m.memberId === party.leaderId,
        connected: m.connected,
        joinedAt: m.joinedAt,
      }));

    return {
      partyCode: party.partyCode,
      leaderId: party.leaderId,
      activeRoomCode: party.activeRoomCode,
      roomFollowSeq: party.followSeq,
      members,
      recentChat: party.recentChat.slice(-25),
      createdAt: party.createdAt,
      expiresAt: party.expiresAt,
    };
  }

  public async handleFetch(request: Request, url: URL): Promise<Response> {
    const nowMs = Date.now();
    if (this.party && nowMs >= this.party.expiresAt) {
      this.purgeParty(this.party.partyCode);
      this.party = null;
    }

    if (url.pathname === '/internal/party/create' && request.method === 'POST') {
      if (this.party) {
        throw new ProtocolError('ROOM_ALREADY_EXISTS', 'رمز المجموعة مستخدم بالفعل.', 409);
      }
      const body = (await request.json()) as CreatePartyHttpRequest & { partyCode: string };
      const partyCode = normalizeRoomCode(body.partyCode ?? '');
      if (!isValidRoomCode(partyCode)) {
        throw new ProtocolError('INVALID_ROOM_CODE', 'رمز المجموعة غير صالح.', 400);
      }

      const memberId = makeUuid();
      const sessionId = makeUuid();
      const resumeToken = generateResumeToken();
      const resumeTokenHash = await hashToken(resumeToken);
      const name = sanitizePlayerName(body.name, 'قائد المجموعة');
      const cosmetic = sanitizeCosmeticOrDefault(body.cosmetic, 0);

      const member: PartyMemberRecord = {
        memberId,
        partyCode,
        name,
        cosmetic,
        resumeTokenHash,
        sessionId,
        connectionEpoch: 1,
        connected: false,
        revoked: false,
        joinedAt: nowMs,
        lastSeenAt: nowMs,
        expiresAt: nowMs + PARTY_TTL_MS,
      };

      const party: PartyRecord = {
        partyCode,
        leaderId: memberId,
        activeRoomCode: null,
        activeRoomPassword: null,
        followSeq: 0,
        recentChat: [],
        createdAt: nowMs,
        updatedAt: nowMs,
        expiresAt: nowMs + PARTY_TTL_MS,
        members: new Map([[memberId, member]]),
      };

      this.saveMeta(party, nowMs);
      this.saveMember(member);
      this.party = party;

      const creds: PartySessionCredentials = {
        partyCode,
        memberId,
        resumeToken,
        sessionId,
        connectionEpoch: 1,
        isLeader: true,
        party: this.buildState(party),
      };
      return new Response(JSON.stringify(creds), {
        status: 201,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    if (url.pathname === '/internal/party/join' && request.method === 'POST') {
      const party = this.requireActiveParty();
      const body = (await request.json()) as JoinPartyHttpRequest;
      const activeCount = Array.from(party.members.values()).filter((m) => !m.revoked).length;
      if (activeCount + this.inFlightJoinCount >= MAX_PARTY_MEMBERS) {
        throw new ProtocolError('PARTY_FULL', ERROR_MESSAGES_AR.PARTY_FULL, 409);
      }

      this.inFlightJoinCount += 1;
      try {
        const memberId = makeUuid();
        const sessionId = makeUuid();
        const resumeToken = generateResumeToken();
        const resumeTokenHash = await hashToken(resumeToken);
        const name = sanitizePlayerName(body.name, `عضو ${activeCount + 1}`);
        const cosmetic = sanitizeCosmeticOrDefault(body.cosmetic, activeCount);

        const member: PartyMemberRecord = {
          memberId,
          partyCode: party.partyCode,
          name,
          cosmetic,
          resumeTokenHash,
          sessionId,
          connectionEpoch: 1,
          connected: false,
          revoked: false,
          joinedAt: nowMs,
          lastSeenAt: nowMs,
          expiresAt: party.expiresAt,
        };

        party.members.set(memberId, member);
        this.saveMember(member);
        this.saveMeta(party, nowMs);

        const state = this.buildState(party);
        this.broadcastMsg(makeEnvelope('party:state', { party: state }));

        const creds: PartySessionCredentials = {
          partyCode: party.partyCode,
          memberId,
          resumeToken,
          sessionId,
          connectionEpoch: 1,
          isLeader: memberId === party.leaderId,
          party: state,
        };
        return new Response(JSON.stringify(creds), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      } finally {
        this.inFlightJoinCount = Math.max(0, this.inFlightJoinCount - 1);
      }
    }

    if (url.pathname === '/internal/party/info' && request.method === 'GET') {
      const party = this.requireActiveParty();
      return new Response(JSON.stringify({ party: this.buildState(party) }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    if (url.pathname === '/internal/party/ws' && request.method === 'GET') {
      this.requireActiveParty();
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        throw new ProtocolError('INVALID_MESSAGE', 'طلب WebSocket غير صالح.', 426);
      }

      const [clientSocket, serverSocket] = createWebSocketPair();
      const ctxAny = this.ctx as unknown as { acceptWebSocket?: (ws: WebSocket, tags?: string[]) => void };
      if (ctxAny.acceptWebSocket) {
        ctxAny.acceptWebSocket(serverSocket, ['party']);
      } else {
        (serverSocket as unknown as { accept?: () => void }).accept?.();
      }

      const initial: SocketAttachment = {
        authenticated: false,
        playerId: null,
        sessionId: null,
        connectionEpoch: 0,
        authAttempts: 0,
        kind: 'party',
      };
      writeAttachment(serverSocket, initial);
      this.sockets.set(serverSocket, { ws: serverSocket, ...initial });
      return createWebSocketUpgradeResponse(clientSocket);
    }

    return new Response(JSON.stringify({ error: makeErrorPayload('INVALID_MESSAGE') }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  public async handleWebSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.party) {
      try {
        ws.close(1000, 'PARTY_CLOSED');
      } catch {
        // ignore
      }
      return;
    }

    const nowMs = Date.now();
    const binding = this.ensureBinding(ws);

    if (getMessageByteLength(raw) > MAX_WS_MESSAGE_BYTES) {
      this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('PAYLOAD_TOO_LARGE')));
      return;
    }

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(decodeRawMessageToString(raw));
    } catch {
      this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('INVALID_MESSAGE')));
      return;
    }

    if (!isRecord(parsedRaw) || parsedRaw.version !== PROTOCOL_VERSION || typeof parsedRaw.type !== 'string') {
      this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('INVALID_MESSAGE')));
      return;
    }

    const reqId = typeof parsedRaw.requestId === 'string' ? parsedRaw.requestId : undefined;
    const msg = parsedRaw as unknown as PartyClientMessage;
    const payload = isRecord(parsedRaw.payload) ? parsedRaw.payload : {};

    if (msg.type === 'party:ping') {
      const ct = typeof payload.clientTime === 'number' ? payload.clientTime : undefined;
      this.sendMsg(ws, makeEnvelope('party:pong', { serverTime: nowMs, clientTime: ct }, reqId));
      return;
    }

    if (msg.type === 'party:authenticate') {
      const nextAttempts = (binding.authAttempts ?? 0) + 1;
      binding.authAttempts = nextAttempts;
      writeAttachment(ws, { ...this.toAttachment(binding), authAttempts: nextAttempts });

      if (nextAttempts > MAX_WS_AUTH_ATTEMPTS) {
        this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('RATE_LIMITED', undefined, 'party:authenticate'), reqId));
        try {
          ws.close(4003, 'AUTH_ATTEMPTS_EXCEEDED');
        } catch {
          // ignore
        }
        return;
      }

      const memberId = typeof payload.memberId === 'string' ? payload.memberId : '';
      const resumeToken = typeof payload.resumeToken === 'string' ? payload.resumeToken : '';
      const member = this.party.members.get(memberId);
      if (!member || member.revoked || nowMs >= member.expiresAt || !resumeToken) {
        this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('UNAUTHORIZED', undefined, 'party:authenticate'), reqId));
        return;
      }

      if (!(await verifyTokenHash(resumeToken, member.resumeTokenHash))) {
        this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('UNAUTHORIZED', undefined, 'party:authenticate'), reqId));
        return;
      }

      // Close previous socket for same member cleanly
      for (const candidate of this.sockets.values()) {
        if (candidate.ws !== ws && candidate.authenticated && candidate.playerId === member.memberId) {
          candidate.authenticated = false;
          candidate.playerId = null;
          writeAttachment(candidate.ws, {
            authenticated: false,
            playerId: null,
            sessionId: null,
            connectionEpoch: 0,
            kind: 'party',
          });
          try {
            candidate.ws.close(4001, 'SESSION_REPLACED');
          } catch {
            // ignore
          }
        }
      }

      const newToken = generateResumeToken();
      member.resumeTokenHash = await hashToken(newToken);
      member.connectionEpoch += 1;
      member.connected = true;
      member.lastSeenAt = nowMs;

      binding.authenticated = true;
      binding.playerId = member.memberId;
      binding.sessionId = member.sessionId;
      binding.connectionEpoch = member.connectionEpoch;
      binding.authAttempts = 0;
      writeAttachment(ws, this.toAttachment(binding));

      this.saveMember(member);

      this.sendMsg(
        ws,
        makeEnvelope(
          'party:renewed',
          {
            partyCode: this.party.partyCode,
            memberId: member.memberId,
            sessionId: member.sessionId,
            resumeToken: newToken,
            connectionEpoch: member.connectionEpoch,
            isLeader: member.memberId === this.party.leaderId,
          },
          reqId,
        ),
      );

      this.broadcastMsg(makeEnvelope('party:state', { party: this.buildState(this.party) }));
      return;
    }

    if (!binding.authenticated || !binding.playerId) {
      this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('UNAUTHORIZED', undefined, msg.type), reqId));
      return;
    }

    const member = this.party.members.get(binding.playerId);
    if (!member || member.revoked || nowMs >= member.expiresAt) {
      this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('SESSION_EXPIRED', undefined, msg.type), reqId));
      return;
    }
    member.lastSeenAt = nowMs;

    if (msg.type === 'party:chat') {
      if (!this.rateLimiter.consume(member.memberId, 'chat', nowMs)) {
        this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('RATE_LIMITED', undefined, msg.type), reqId));
        return;
      }
      const preset = typeof payload.presetId === 'string' ? getQuickChatPreset(payload.presetId) : null;
      const text = preset ? preset.text : sanitizeChatText(payload.text);
      if (!text) {
        this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('INVALID_MESSAGE', undefined, msg.type), reqId));
        return;
      }
      const chatMessage: ChatMessage = {
        id: `pmsg-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        senderId: member.memberId,
        senderName: member.name,
        senderSlot: -1,
        isSpectator: false,
        colorIndex: member.cosmetic.colorIndex,
        text,
        ...(preset ? { presetId: preset.id } : {}),
        createdAt: nowMs,
      };
      this.party.recentChat.push(chatMessage);
      if (this.party.recentChat.length > 40) {
        this.party.recentChat.splice(0, this.party.recentChat.length - 40);
      }
      this.saveMeta(this.party, nowMs);
      this.broadcastMsg(makeEnvelope('party:chat', { message: chatMessage }, reqId));
      return;
    }

    if (!this.rateLimiter.consume(member.memberId, 'control', nowMs)) {
      this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('RATE_LIMITED', undefined, msg.type), reqId));
      return;
    }

    if (msg.type === 'party:cosmetic') {
      if (typeof payload.name === 'string') {
        member.name = sanitizePlayerName(payload.name, member.name);
      }
      member.cosmetic = sanitizeCosmeticOrDefault(payload.cosmetic, member.cosmetic.colorIndex);
      this.saveMember(member);
      this.broadcastMsg(makeEnvelope('party:state', { party: this.buildState(this.party) }, reqId));
      return;
    }

    if (msg.type === 'party:setRoom') {
      if (member.memberId !== this.party.leaderId) {
        this.sendMsg(
          ws,
          makeEnvelope('party:error', makeErrorPayload('FORBIDDEN_HOST_ONLY', 'توجيه المجموعة متاح لقائد المجموعة فقط.', msg.type), reqId),
        );
        return;
      }
      const nextRoomCode =
        payload.roomCode === null
          ? null
          : typeof payload.roomCode === 'string'
            ? normalizeRoomCode(payload.roomCode)
            : null;
      if (nextRoomCode !== null && !isValidRoomCode(nextRoomCode)) {
        this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('INVALID_ROOM_CODE', undefined, msg.type), reqId));
        return;
      }
      const password =
        typeof payload.password === 'string' && payload.password.trim().length > 0
          ? payload.password.trim().slice(0, 32)
          : undefined;

      this.party.activeRoomCode = nextRoomCode;
      this.party.activeRoomPassword = nextRoomCode ? password ?? null : null;
      this.party.followSeq += 1;
      this.saveMeta(this.party, nowMs);

      this.broadcastMsg(makeEnvelope('party:state', { party: this.buildState(this.party) }, reqId));

      const followMsg: PartyServerMessage = makeEnvelope('party:followRoom', {
        partyCode: this.party.partyCode,
        leaderId: this.party.leaderId,
        roomCode: nextRoomCode,
        ...(password !== undefined ? { password } : {}),
        followSeq: this.party.followSeq,
      });
      const rawFollow = JSON.stringify(followMsg);
      for (const target of this.sockets.values()) {
        if (target.authenticated && target.playerId !== this.party.leaderId && target.ws.readyState === 1) {
          try {
            target.ws.send(rawFollow);
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    if (msg.type === 'party:kick') {
      if (member.memberId !== this.party.leaderId) {
        this.sendMsg(
          ws,
          makeEnvelope('party:error', makeErrorPayload('FORBIDDEN_HOST_ONLY', 'طرد الأعضاء متاح لقائد المجموعة فقط.', msg.type), reqId),
        );
        return;
      }
      const targetId = typeof payload.targetMemberId === 'string' ? payload.targetMemberId : '';
      if (!targetId || targetId === member.memberId) return;
      const target = this.party.members.get(targetId);
      if (!target) return;

      target.revoked = true;
      target.connected = false;
      this.party.members.delete(targetId);
      this.deleteMemberRow(targetId);

      for (const sock of this.sockets.values()) {
        if (sock.authenticated && sock.playerId === targetId) {
          this.sendMsg(
            sock.ws,
            makeEnvelope('party:error', makeErrorPayload('UNAUTHORIZED', 'تمت إزالتك من المجموعة بواسطة القائد.')),
          );
          try {
            sock.ws.close(4002, 'KICKED_FROM_PARTY');
          } catch {
            // ignore
          }
        }
      }
      this.broadcastMsg(makeEnvelope('party:state', { party: this.buildState(this.party) }, reqId));
      return;
    }

    if (msg.type === 'party:leave') {
      member.revoked = true;
      member.connected = false;
      this.party.members.delete(member.memberId);
      this.deleteMemberRow(member.memberId);
      this.rateLimiter.clear(member.memberId);

      binding.authenticated = false;
      binding.playerId = null;
      binding.sessionId = null;
      binding.connectionEpoch = 0;
      writeAttachment(ws, this.toAttachment(binding));

      this.reconcileLeaderAfterLeave(nowMs);

      try {
        ws.close(1000, 'LEFT_PARTY');
      } catch {
        // ignore
      }
      return;
    }

    const unknownType = (msg as { type?: string }).type ?? 'unknown';
    this.sendMsg(ws, makeEnvelope('party:error', makeErrorPayload('UNKNOWN_MESSAGE_TYPE', undefined, unknownType), reqId));
  }

  public handleWebSocketClose(ws: WebSocket): void {
    const binding = this.sockets.get(ws) ?? this.ensureBinding(ws);
    this.sockets.delete(ws);
    if (!this.party || !binding.authenticated || !binding.playerId) return;

    const member = this.party.members.get(binding.playerId);
    if (member && !member.revoked && member.sessionId === binding.sessionId) {
      member.connected = false;
      member.lastSeenAt = Date.now();
      this.saveMember(member);
      this.broadcastMsg(makeEnvelope('party:state', { party: this.buildState(this.party) }));
    }
  }

  private reconcileLeaderAfterLeave(nowMs: number): void {
    if (!this.party) return;
    const remaining = Array.from(this.party.members.values())
      .filter((m) => !m.revoked)
      .sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        return a.joinedAt - b.joinedAt;
      });

    if (remaining.length === 0) {
      const code = this.party.partyCode;
      this.party = null;
      this.purgeParty(code);
      return;
    }

    if (!this.party.members.has(this.party.leaderId)) {
      this.party.leaderId = remaining[0].memberId;
    }
    this.saveMeta(this.party, nowMs);
    this.broadcastMsg(makeEnvelope('party:state', { party: this.buildState(this.party) }));
  }

  private requireActiveParty(): PartyRecord {
    const nowMs = Date.now();
    if (!this.party || nowMs >= this.party.expiresAt) {
      throw new ProtocolError('PARTY_NOT_FOUND', ERROR_MESSAGES_AR.PARTY_NOT_FOUND, 404);
    }
    return this.party;
  }

  private ensureBinding(ws: WebSocket): SocketBinding {
    let binding = this.sockets.get(ws);
    if (binding) return binding;

    const att = readAttachment(ws);
    if (att && att.authenticated && att.playerId && att.sessionId && this.party) {
      const member = this.party.members.get(att.playerId);
      if (member && !member.revoked && member.sessionId === att.sessionId) {
        binding = {
          ws,
          authenticated: true,
          playerId: att.playerId,
          sessionId: att.sessionId,
          connectionEpoch: att.connectionEpoch,
          kind: 'party',
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
      kind: 'party',
    };
    this.sockets.set(ws, binding);
    return binding;
  }

  private toAttachment(binding: SocketBinding): SocketAttachment {
    return {
      authenticated: binding.authenticated,
      playerId: binding.playerId,
      sessionId: binding.sessionId,
      connectionEpoch: binding.connectionEpoch,
      authAttempts: binding.authAttempts ?? 0,
      kind: 'party',
    };
  }

  private sendMsg(ws: WebSocket, msg: PartyServerMessage): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  private broadcastMsg(msg: PartyServerMessage): void {
    const raw = JSON.stringify(msg);
    for (const binding of this.sockets.values()) {
      if (binding.authenticated && binding.ws.readyState === 1) {
        try {
          binding.ws.send(raw);
        } catch {
          // ignore
        }
      }
    }
  }

  public dispose(): void {
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
