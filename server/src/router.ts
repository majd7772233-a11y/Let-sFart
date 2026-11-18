import { isValidCourseId } from '../../src/shared/course.ts';
import { isValidDifficulty, isValidGameMode } from '../../src/shared/physics.ts';
import {
  GAME_VERSION,
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type CreateRoomHttpRequest,
  type HealthResponse,
  type JoinRoomHttpRequest,
  type OpsAnalyticsHttpResponse,
  type OpsStatusHttpResponse,
  type ReplayDetailHttpResponse,
  type ReplayListHttpResponse,
  type SaveReplayHttpResponse,
} from '../../src/shared/protocol.ts';
import type {
  MatchSummaryInput,
  RoomSettings,
  RoundReplayRecord,
  VerifiedMatchRecord,
} from '../../src/shared/types.ts';
import {
  getBalanceAnalyticsFromD1,
  getRoundReplayFromD1,
  getVerifiedMatchCountFromD1,
  listRoundReplaysFromD1,
  recordOpsEventInD1,
  recordVerifiedMatchInD1,
  saveRoundReplayInD1,
} from './db/d1Store.ts';
import { isOriginAllowed, resolveCorsAllowOrigin, type Env } from './env.ts';
import { logServerEvent } from './lib/logger.ts';
import { extractClientIpKey, HttpIpRateLimiter, type HttpRateChannel } from './lib/rateLimit.ts';
import { constantTimeEqual } from './lib/tokens.ts';
import { isRecord, readBoundedJson } from './lib/validation.ts';
import { makeErrorPayload, ProtocolError } from './protocol/errors.ts';
import { opsMetrics } from './services/metrics.ts';
import {
  createPartyViaService,
  forwardWebSocketToParty,
  getPartyInfoViaService,
  joinPartyViaService,
} from './services/partyService.ts';
import { forwardProgressionRequest, resolveAccountTokenViaService } from './services/progressionService.ts';
import { validateReplayPayload, verifyMatchResult } from './services/resultVerifier.ts';
import {
  consumeDurableHttpRateLimit,
  createRoomViaService,
  forwardWebSocketToRoom,
  getRoomInfoViaService,
  joinRoomViaService,
  listPublicRoomsViaService,
  quickMatchViaService,
} from './services/roomService.ts';

const httpRateLimiter = new HttpIpRateLimiter();

export function clearHttpRateLimiter(): void {
  httpRateLimiter.clearAll();
}

async function checkEdgeRateLimit(env: Env, channel: HttpRateChannel, ipKey: string): Promise<boolean> {
  if (!httpRateLimiter.consume(ipKey, channel)) {
    return false;
  }
  if (env.RATE_LIMITER) {
    const res = await env.RATE_LIMITER.limit({ key: `${channel}:${ipKey}` });
    if (!res.success) {
      return false;
    }
  }
  return true;
}

async function checkPersistentEdgeRateLimit(
  env: Env,
  channel: 'create' | 'join',
  actionScope: string,
  subjectKey: string,
): Promise<boolean> {
  const scopedKey = `${actionScope}:${subjectKey}`;
  if (!(await checkEdgeRateLimit(env, channel, scopedKey))) {
    return false;
  }
  if (!env.RATE_LIMITER && !(await consumeDurableHttpRateLimit(env, channel, scopedKey))) {
    return false;
  }
  return true;
}

function withCors(res: Response, request: Request, env: Env): Response {
  // Never mutate status 101 WebSocket upgrade responses
  if (res.status === 101 || (res as unknown as { webSocket?: unknown }).webSocket) {
    return res;
  }
  const headers = new Headers(res.headers);
  const allowOrigin = resolveCorsAllowOrigin(request, env);
  if (allowOrigin) {
    headers.set('access-control-allow-origin', allowOrigin);
    headers.set('vary', 'Origin');
  }
  headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set(
    'access-control-allow-headers',
    'content-type, idempotency-key, authorization, x-protocol-version, x-game-version, x-admin-key, x-ops-key',
  );
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function extractAccountToken(request: Request, bodyData: Record<string, unknown>): string | undefined {
  if (typeof bodyData.accountToken === 'string' && bodyData.accountToken.trim().length >= 16) {
    return bodyData.accountToken.trim();
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const trimmed = authHeader.trim();
    const token = trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
    if (token.length >= 16) return token;
  }
  return undefined;
}

function jsonResp(data: unknown, status: number, request: Request, env: Env): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
    request,
    env,
  );
}

/**
 * TECH-06: Validates explicit client protocolVersion headers, query params, or JSON body fields.
 */
function checkProtocolCompatibility(
  request: Request,
  url: URL,
  bodyData?: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const rawHeader = request.headers.get('x-protocol-version');
  const rawQuery = url.searchParams.get('protocolVersion');
  const rawBody = bodyData?.protocolVersion;

  const candidate = rawBody ?? (rawHeader !== null ? Number(rawHeader) : rawQuery !== null ? Number(rawQuery) : undefined);
  if (candidate === undefined) {
    return { ok: true };
  }

  if (
    typeof candidate !== 'number' ||
    !Number.isInteger(candidate) ||
    candidate < MIN_COMPATIBLE_PROTOCOL_VERSION ||
    candidate > PROTOCOL_VERSION
  ) {
    return {
      ok: false,
      message: `إصدار البروتوكول (${String(candidate)}) غير متوافق مع الخادم (المدعوم: v${MIN_COMPATIBLE_PROTOCOL_VERSION}..v${PROTOCOL_VERSION}). يرجى تحديث الصفحة.`,
    };
  }
  return { ok: true };
}

function isOpsAuthorized(request: Request, env: Env): boolean {
  const configuredKey = env.OPS_ADMIN_KEY?.trim();
  const isLocalDev =
    env.ENVIRONMENT === 'local-node' ||
    env.ENVIRONMENT === 'development' ||
    env.ENVIRONMENT === 'test';

  if (!configuredKey) {
    // Fail closed in production when OPS_ADMIN_KEY is not configured
    return isLocalDev;
  }

  // Header-only authentication (never accept secrets in query string)
  const headerKey = (request.headers.get('x-admin-key') ?? request.headers.get('x-ops-key'))?.trim();
  if (!headerKey) return false;
  return constantTimeEqual(headerKey, configuredKey);
}

async function handleWorkerRouteInner(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request, env, false)) {
      return jsonResp({ error: makeErrorPayload('FORBIDDEN_ORIGIN') }, 403, request, env);
    }
    return withCors(new Response(null, { status: 204 }), request, env);
  }

  // Never allow public access to internal Durable Object paths
  if (path.startsWith('/internal/') || path === '/internal') {
    logServerEvent('security_rejected', { path, reason: 'internal_route_blocked' });
    return jsonResp(
      { error: makeErrorPayload('UNAUTHORIZED', 'المسار الداخلي غير مصرح به.') },
      403,
      request,
      env,
    );
  }

  try {
    // Health Check (exempt from Origin rejection so probes succeed cleanly)
    if (path === '/api/health' && request.method === 'GET') {
      const payload: HealthResponse = {
        ok: true,
        service: 'letsfart-worker',
        runtime: env.ENVIRONMENT === 'local-node' ? 'node-local-do' : 'cloudflare-worker',
        gameVersion: GAME_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        minCompatibleProtocolVersion: MIN_COMPATIBLE_PROTOCOL_VERSION,
        environment: env.ENVIRONMENT ?? 'production',
        timestamp: Date.now(),
      };
      return jsonResp(payload, 200, request, env);
    }

    const isWsPath = path.startsWith('/ws/');
    if (!isOriginAllowed(request, env, isWsPath)) {
      logServerEvent('security_rejected', {
        path,
        reason: 'forbidden_origin',
        origin: request.headers.get('origin') ?? 'missing',
      });
      return jsonResp({ error: makeErrorPayload('FORBIDDEN_ORIGIN') }, 403, request, env);
    }

    const headerProto = checkProtocolCompatibility(request, url);
    if (!headerProto.ok) {
      return jsonResp(
        { error: makeErrorPayload('PROTOCOL_MISMATCH', headerProto.message) },
        426,
        request,
        env,
      );
    }

    const ipKey = extractClientIpKey(request);

    // Public Rooms List: GET /api/v1/rooms
    if (path === '/api/v1/rooms' && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const list = await listPublicRoomsViaService(env);
      return jsonResp(list, 200, request, env);
    }

    // Create Room: POST /api/v1/rooms
    if (path === '/api/v1/rooms' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'create', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      if (!env.RATE_LIMITER && !(await consumeDurableHttpRateLimit(env, 'create', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 4096);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const bodyProto = checkProtocolCompatibility(request, url, data);
      if (!bodyProto.ok) {
        return jsonResp({ error: makeErrorPayload('PROTOCOL_MISMATCH', bodyProto.message) }, 426, request, env);
      }
      const headerIdem = request.headers.get('idempotency-key') ?? undefined;
      const bodyIdem = typeof data.idempotencyKey === 'string' ? data.idempotencyKey : undefined;

      const { status, creds } = await createRoomViaService(env, {
        name: typeof data.name === 'string' ? data.name : '',
        cosmetic: data.cosmetic as CreateRoomHttpRequest['cosmetic'],
        courseId: isValidCourseId(data.courseId) ? data.courseId : undefined,
        idempotencyKey: bodyIdem ?? headerIdem,
        isPrivate: typeof data.isPrivate === 'boolean' ? data.isPrivate : undefined,
        password: typeof data.password === 'string' ? data.password : undefined,
        settings: isRecord(data.settings) ? (data.settings as Partial<RoomSettings>) : undefined,
        accountToken: extractAccountToken(request, data),
      });
      return jsonResp(creds, status, request, env);
    }

    // Quick Match: POST /api/v1/rooms/quick-match
    if (path === '/api/v1/rooms/quick-match' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      if (!env.RATE_LIMITER && !(await consumeDurableHttpRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 4096);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const bodyProto = checkProtocolCompatibility(request, url, data);
      if (!bodyProto.ok) {
        return jsonResp({ error: makeErrorPayload('PROTOCOL_MISMATCH', bodyProto.message) }, 426, request, env);
      }
      const doRes = await quickMatchViaService(
        env,
        {
          name: typeof data.name === 'string' ? data.name : '',
          cosmetic: data.cosmetic as JoinRoomHttpRequest['cosmetic'],
          preferredGameMode: isValidGameMode(data.preferredGameMode) ? data.preferredGameMode : undefined,
          preferredCourseId: isValidCourseId(data.preferredCourseId) ? data.preferredCourseId : undefined,
          accountToken: extractAccountToken(request, data),
        },
        ipKey,
      );
      return withCors(doRes, request, env);
    }

    // Join Room: POST /api/v1/rooms/:code/join
    const joinMatch = path.match(/^\/api\/v1\/rooms\/([^/]+)\/join$/);
    if (joinMatch && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 4096);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const bodyProto = checkProtocolCompatibility(request, url, data);
      if (!bodyProto.ok) {
        return jsonResp({ error: makeErrorPayload('PROTOCOL_MISMATCH', bodyProto.message) }, 426, request, env);
      }
      const headerIdem = request.headers.get('idempotency-key') ?? undefined;
      const bodyIdem = typeof data.idempotencyKey === 'string' ? data.idempotencyKey : undefined;
      const spectate =
        data.spectate === 'auto' || data.spectate === 'only' || data.spectate === 'never'
          ? data.spectate
          : undefined;
      const doRes = await joinRoomViaService(
        env,
        decodeURIComponent(joinMatch[1]),
        {
          name: typeof data.name === 'string' ? data.name : '',
          cosmetic: data.cosmetic as JoinRoomHttpRequest['cosmetic'],
          idempotencyKey: bodyIdem ?? headerIdem,
          password: typeof data.password === 'string' ? data.password : undefined,
          ...(spectate !== undefined ? { spectate } : {}),
          accountToken: extractAccountToken(request, data),
        },
        ipKey,
      );
      return withCors(doRes, request, env);
    }

    // Room Public Info: GET /api/v1/rooms/:code
    const infoMatch = path.match(/^\/api\/v1\/rooms\/([^/]+)$/);
    if (infoMatch && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await getRoomInfoViaService(env, decodeURIComponent(infoMatch[1]));
      return withCors(doRes, request, env);
    }

    // Room WebSocket: GET /ws/rooms/:code
    const wsMatch = path.match(/^\/ws\/rooms\/([^/]+)$/);
    if (wsMatch && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'ws', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      return await forwardWebSocketToRoom(env, decodeURIComponent(wsMatch[1]), request, ipKey);
    }

    // Party Create: POST /api/v1/parties
    if (path === '/api/v1/parties' && request.method === 'POST') {
      if (!(await checkPersistentEdgeRateLimit(env, 'create', 'party_create', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 2048);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const { status, creds } = await createPartyViaService(env, {
        name: typeof data.name === 'string' ? data.name : '',
        cosmetic: data.cosmetic as CreateRoomHttpRequest['cosmetic'],
      });
      return jsonResp(creds, status, request, env);
    }

    // Party Join: POST /api/v1/parties/:code/join
    const partyJoinMatch = path.match(/^\/api\/v1\/parties\/([^/]+)\/join$/);
    if (partyJoinMatch && request.method === 'POST') {
      if (!(await checkPersistentEdgeRateLimit(env, 'join', 'party_join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 2048);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const doRes = await joinPartyViaService(env, decodeURIComponent(partyJoinMatch[1]), {
        name: typeof data.name === 'string' ? data.name : '',
        cosmetic: data.cosmetic as JoinRoomHttpRequest['cosmetic'],
      });
      return withCors(doRes, request, env);
    }

    // Party Info: GET /api/v1/parties/:code
    const partyInfoMatch = path.match(/^\/api\/v1\/parties\/([^/]+)$/);
    if (partyInfoMatch && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await getPartyInfoViaService(env, decodeURIComponent(partyInfoMatch[1]));
      return withCors(doRes, request, env);
    }

    // Party WebSocket: GET /ws/parties/:code
    const partyWsMatch = path.match(/^\/ws\/parties\/([^/]+)$/);
    if (partyWsMatch && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'ws', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      return await forwardWebSocketToParty(env, decodeURIComponent(partyWsMatch[1]), request, ipKey);
    }

    // ==========================================
    // PROG-01..10: Accounts, Profiles, Stats & Leaderboards
    // ==========================================

    if (path === '/api/v1/auth/guest' && request.method === 'POST') {
      if (!(await checkPersistentEdgeRateLimit(env, 'create', 'auth_guest', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/guest', request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/auth/register' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'create', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      if (!env.RATE_LIMITER && !(await consumeDurableHttpRateLimit(env, 'create', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/register', request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/auth/login' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      if (!env.RATE_LIMITER && !(await consumeDurableHttpRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/login', request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/auth/link' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/link', request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/auth/logout' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/logout', request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/profile' && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/me', request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/profile' && request.method === 'PATCH') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/profile', request);
      return withCors(doRes, request, env);
    }

    const publicProfMatch = path.match(/^\/api\/v1\/profile\/([^/]+)$/);
    if (publicProfMatch && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(
        env,
        `/internal/prog/profile/${encodeURIComponent(decodeURIComponent(publicProfMatch[1]))}`,
        request,
      );
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/progression/start-solo-run' && request.method === 'POST') {
      if (!(await checkPersistentEdgeRateLimit(env, 'join', 'solo_start', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/start-solo-run', request);
      return withCors(doRes, request, env);
    }

    // TECH-01 & TECH-03: Authoritative Result Verification before recording progression & D1 analytics
    if (path === '/api/v1/progression/record-match' && request.method === 'POST') {
      if (!(await checkPersistentEdgeRateLimit(env, 'join', 'record_match', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request.clone(), 8192);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const rawBody = isRecord(bodyResult.data) ? (bodyResult.data as Partial<MatchSummaryInput>) : {};
      if (rawBody.isOnline === true) {
        opsMetrics.recordVerificationRejection();
        return jsonResp(
          {
            error: makeErrorPayload(
              'RESULT_VERIFICATION_FAILED',
              'نتائج الجولات الجماعية تُوثّق من الخادم فقط.',
            ),
          },
          403,
          request,
          env,
        );
      }
      const verification = verifyMatchResult(rawBody, { isAuthoritativeRoom: false });
      if (!verification.ok) {
        opsMetrics.recordVerificationRejection();
        void recordOpsEventInD1(env.DB, 'verification_rejected', 'warn', {
          reasonCode: verification.reasonCode,
          courseId: rawBody.courseId,
          gameMode: rawBody.gameMode,
          elapsedTimeSec: rawBody.elapsedTimeSec,
        });
        return jsonResp(
          {
            error: makeErrorPayload(
              'RESULT_VERIFICATION_FAILED',
              verification.reasonAr ?? 'تم رفض النتيجة لعدم مطابقتها حدود الفيزياء.',
            ),
          },
          422,
          request,
          env,
        );
      }

      const doRes = await forwardProgressionRequest(env, '/internal/prog/record-match', request);
      if (doRes.ok) {
        const cloned = doRes.clone();
        try {
          const payload = (await cloned.json()) as {
            profile?: { accountId?: string };
            alreadyRecorded?: boolean;
          };
          if (!payload.alreadyRecorded && rawBody.courseId && rawBody.gameMode && rawBody.difficulty && rawBody.outcome) {
            const subKey =
              typeof rawBody.submissionKey === 'string' && rawBody.submissionKey.trim().length > 0
                ? `${payload.profile?.accountId ?? 'anon'}:${rawBody.submissionKey.trim()}`
                : crypto.randomUUID();
            const verified: VerifiedMatchRecord = {
              matchId: subKey,
              submissionKey: subKey,
              roomCode: null,
              accountId: payload.profile?.accountId ?? null,
              mode: rawBody.isOnline ? 'online' : 'solo',
              courseId: rawBody.courseId,
              gameMode: rawBody.gameMode,
              difficulty: rawBody.difficulty,
              outcome: rawBody.outcome,
              elapsedTimeSec: Number(rawBody.elapsedTimeSec ?? 0),
              falls: Number(rawBody.falls ?? 0),
              itemsUsed: Number(rawBody.itemsUsed ?? 0),
              collisionCount: Number(rawBody.collisionCount ?? 0),
              treasureScore: Number(rawBody.treasureScore ?? 0),
              survivalDistance: Number(rawBody.survivalDistance ?? 0),
              minRaftHp: Number(rawBody.minRaftHp ?? 100),
              verifiedAt: Date.now(),
            };
            await recordVerifiedMatchInD1(env.DB, verified);
          }
        } catch {
          // Best-effort D1 mirror
        }
      }
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/leaderboard' && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, `/internal/prog/leaderboard${url.search}`, request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/friends' && (request.method === 'GET' || request.method === 'POST')) {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/friends', request);
      return withCors(doRes, request, env);
    }

    const delFriendApiMatch = path.match(/^\/api\/v1\/friends\/([^/]+)$/);
    if (delFriendApiMatch && request.method === 'DELETE') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(
        env,
        `/internal/prog/friends/${encodeURIComponent(decodeURIComponent(delFriendApiMatch[1]))}`,
        request,
      );
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/shop/buy' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/shop/buy', request);
      return withCors(doRes, request, env);
    }

    if (path === '/api/v1/shop/equip' && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(env, '/internal/prog/shop/equip', request);
      return withCors(doRes, request, env);
    }

    const claimQuestApiMatch = path.match(/^\/api\/v1\/quests\/([^/]+)\/claim$/);
    if (claimQuestApiMatch && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(
        env,
        `/internal/prog/quests/${encodeURIComponent(decodeURIComponent(claimQuestApiMatch[1]))}/claim`,
        request,
      );
      return withCors(doRes, request, env);
    }

    const claimTierApiMatch = path.match(/^\/api\/v1\/season\/tiers\/(\d+)\/claim$/);
    if (claimTierApiMatch && request.method === 'POST') {
      if (!(await checkEdgeRateLimit(env, 'join', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await forwardProgressionRequest(
        env,
        `/internal/prog/season/tiers/${claimTierApiMatch[1]}/claim`,
        request,
      );
      return withCors(doRes, request, env);
    }

    // ==========================================
    // TECH-04: Round Replay Storage & Retrieval
    // ==========================================

    if (path === '/api/v1/replays' && request.method === 'POST') {
      if (!(await checkPersistentEdgeRateLimit(env, 'join', 'replay_upload_ip', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 128_000);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const accountToken = extractAccountToken(request, data);
      const account = await resolveAccountTokenViaService(env, accountToken);
      if (!account) {
        return jsonResp(
          { error: makeErrorPayload('UNAUTHORIZED', 'يجب تسجيل الدخول لحفظ إعادة الجولة.') },
          401,
          request,
          env,
        );
      }
      if (!(await checkPersistentEdgeRateLimit(env, 'join', 'replay_upload_acct', account.accountId))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }

      const candidate = (isRecord(data.replay) ? data.replay : data) as Partial<RoundReplayRecord>;
      const rawMatchId = typeof candidate.matchId === 'string' ? candidate.matchId.trim() : '';
      if (
        rawMatchId.length < 3 ||
        !isValidCourseId(candidate.courseId) ||
        !isValidGameMode(candidate.gameMode) ||
        !isValidDifficulty(candidate.difficulty) ||
        (candidate.outcome !== 'victory' && candidate.outcome !== 'defeat')
      ) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', 'بيانات الإعادة غير مكتملة.') }, 400, request, env);
      }

      // Online replays are strictly server-authoritative (saved only by RaftRoom DO)
      if (candidate.mode === 'online' || rawMatchId.toLowerCase().startsWith('online:')) {
        return jsonResp(
          { error: makeErrorPayload('UNAUTHORIZED', 'إعادات الجولات الجماعية تُحفظ من الخادم فقط.') },
          403,
          request,
          env,
        );
      }

      const deepCheck = validateReplayPayload(candidate as Record<string, unknown>);
      if (!deepCheck.ok) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', deepCheck.reasonAr) }, 400, request, env);
      }

      const verifyRes = verifyMatchResult({
        courseId: candidate.courseId,
        gameMode: candidate.gameMode,
        difficulty: candidate.difficulty,
        outcome: candidate.outcome,
        elapsedTimeSec: typeof candidate.durationSec === 'number' ? candidate.durationSec : 0,
        falls: typeof candidate.falls === 'number' ? candidate.falls : 0,
        treasureScore: typeof candidate.treasureScore === 'number' ? candidate.treasureScore : 0,
        survivalDistance: typeof candidate.survivalDistance === 'number' ? candidate.survivalDistance : 0,
        minRaftHp: typeof candidate.minRaftHp === 'number' ? candidate.minRaftHp : 100,
      });
      if (!verifyRes.ok) {
        opsMetrics.recordVerificationRejection();
        return jsonResp(
          { error: makeErrorPayload('RESULT_VERIFICATION_FAILED', verifyRes.reasonAr) },
          422,
          request,
          env,
        );
      }

      const boundMatchId = rawMatchId.startsWith(`solo:${account.accountId}:`)
        ? rawMatchId.slice(0, 128)
        : `solo:${account.accountId}:${rawMatchId}`.slice(0, 128);

      const sanitized: RoundReplayRecord = {
        matchId: boundMatchId,
        roomCode: null,
        mode: 'solo',
        courseId: candidate.courseId,
        gameMode: candidate.gameMode,
        difficulty: candidate.difficulty,
        botDifficulty: candidate.botDifficulty,
        outcome: candidate.outcome,
        durationSec: Number((candidate.durationSec ?? 0).toFixed(2)),
        falls: Math.max(0, Math.round(candidate.falls ?? 0)),
        treasureScore: Math.max(0, Math.round(candidate.treasureScore ?? 0)),
        survivalDistance: Math.max(0, Math.round(candidate.survivalDistance ?? 0)),
        minRaftHp: Math.max(0, Math.min(100, Math.round(candidate.minRaftHp ?? 100))),
        createdAt: typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : Date.now(),
        players: Array.isArray(candidate.players) ? candidate.players.slice(0, 4) : [],
        frames: (candidate.frames ?? []).slice(0, 480),
        events: Array.isArray(candidate.events) ? candidate.events.slice(0, 160) : [],
      };
      const saveResult = await saveRoundReplayInD1(env.DB, sanitized);
      if (!saveResult.inserted) {
        return jsonResp(
          { error: makeErrorPayload('ROOM_ALREADY_EXISTS', 'هذه الإعادة محفوظة مسبقاً ولا يمكن استبدالها.') },
          409,
          request,
          env,
        );
      }
      const response: SaveReplayHttpResponse = {
        ok: true,
        matchId: sanitized.matchId,
        frameCount: sanitized.frames.length,
        createdAt: sanitized.createdAt,
      };
      return jsonResp(response, 201, request, env);
    }

    if (path === '/api/v1/replays' && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const courseParam = url.searchParams.get('courseId');
      const modeParam = url.searchParams.get('gameMode');
      const limitParam = Number(url.searchParams.get('limit') ?? 20);
      const replays = await listRoundReplaysFromD1(env.DB, {
        ...(isValidCourseId(courseParam) ? { courseId: courseParam } : {}),
        ...(isValidGameMode(modeParam) ? { gameMode: modeParam } : {}),
        limit: Number.isFinite(limitParam) ? limitParam : 20,
      });
      const payload: ReplayListHttpResponse = {
        replays,
        total: replays.length,
        timestamp: Date.now(),
      };
      return jsonResp(payload, 200, request, env);
    }

    const replayMatch = path.match(/^\/api\/v1\/replays\/([^/]+)$/);
    if (replayMatch && request.method === 'GET') {
      if (!(await checkEdgeRateLimit(env, 'info', ipKey))) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const matchId = decodeURIComponent(replayMatch[1]);
      const replay = await getRoundReplayFromD1(env.DB, matchId);
      if (!replay) {
        return jsonResp({ error: makeErrorPayload('ROOM_NOT_FOUND', 'لم يتم العثور على إعادة الجولة المطلوبة.') }, 404, request, env);
      }
      const payload: ReplayDetailHttpResponse = { replay };
      return jsonResp(payload, 200, request, env);
    }

    // ==========================================
    // TECH-05 & TECH-07: Server Health & Balance Analytics
    // ==========================================

    if (path === '/api/v1/ops/status' && request.method === 'GET') {
      if (!isOpsAuthorized(request, env)) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED', 'مفتاح مراقبة الخادم غير صالح.') }, 401, request, env);
      }
      const d1VerifiedCount = await getVerifiedMatchCountFromD1(env.DB);
      const snapshot: OpsStatusHttpResponse = opsMetrics.getHealthSnapshot({
        runtime: env.ENVIRONMENT === 'local-node' ? 'node-local-do' : 'cloudflare-worker',
        d1Connected: Boolean(env.DB),
        d1VerifiedCount,
      });
      return jsonResp(snapshot, 200, request, env);
    }

    if (path === '/api/v1/ops/analytics' && request.method === 'GET') {
      if (!isOpsAuthorized(request, env)) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED', 'مفتاح مراقبة الخادم غير صالح.') }, 401, request, env);
      }
      const rawCourseId = url.searchParams.get('courseId');
      const rawGameMode = url.searchParams.get('gameMode');
      const courseId = rawCourseId && isValidCourseId(rawCourseId) ? rawCourseId : undefined;
      const gameMode = rawGameMode && isValidGameMode(rawGameMode) ? rawGameMode : undefined;
      const analytics: OpsAnalyticsHttpResponse = await getBalanceAnalyticsFromD1(env.DB, {
        courseId,
        gameMode,
      });
      return jsonResp(analytics, 200, request, env);
    }

    return jsonResp({ error: makeErrorPayload('ROOM_NOT_FOUND', 'المسار غير موجود.') }, 404, request, env);
  } catch (err) {
    if (err instanceof ProtocolError) {
      return jsonResp({ error: err.toPayload() }, err.httpStatus, request, env);
    }
    return jsonResp({ error: makeErrorPayload('INTERNAL_ERROR') }, 500, request, env);
  }
}

export async function routeWorkerRequest(request: Request, env: Env): Promise<Response> {
  const start = performance.now();
  const res = await handleWorkerRouteInner(request, env);
  const durationMs = performance.now() - start;
  opsMetrics.recordHttpRequest(durationMs, res.status);
  return res;
}
