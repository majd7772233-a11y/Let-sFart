import { PROTOCOL_VERSION, type CreateRoomHttpRequest, type HealthResponse, type JoinRoomHttpRequest } from '../../src/shared/protocol.ts';
import { isOriginAllowed, resolveCorsAllowOrigin, type Env } from './env.ts';
import { logServerEvent } from './lib/logger.ts';
import { extractClientIpKey, HttpIpRateLimiter } from './lib/rateLimit.ts';
import { isRecord, readBoundedJson } from './lib/validation.ts';
import { makeErrorPayload, ProtocolError } from './protocol/errors.ts';
import {
  createRoomViaService,
  forwardWebSocketToRoom,
  getRoomInfoViaService,
  joinRoomViaService,
} from './services/roomService.ts';

const httpRateLimiter = new HttpIpRateLimiter();

export function clearHttpRateLimiter(): void {
  httpRateLimiter.clearAll();
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
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type, idempotency-key');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
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

export async function routeWorkerRequest(request: Request, env: Env): Promise<Response> {
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
        runtime: 'cloudflare-worker',
        protocolVersion: PROTOCOL_VERSION,
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

    const ipKey = extractClientIpKey(request);

    // Create Room: POST /api/v1/rooms
    if (path === '/api/v1/rooms' && request.method === 'POST') {
      if (!httpRateLimiter.consume(ipKey, 'create')) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 4096);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const headerIdem = request.headers.get('idempotency-key') ?? undefined;
      const bodyIdem = typeof data.idempotencyKey === 'string' ? data.idempotencyKey : undefined;

      const { status, creds } = await createRoomViaService(env, {
        name: typeof data.name === 'string' ? data.name : '',
        cosmetic: data.cosmetic as CreateRoomHttpRequest['cosmetic'],
        idempotencyKey: bodyIdem ?? headerIdem,
      });
      return jsonResp(creds, status, request, env);
    }

    // Join Room: POST /api/v1/rooms/:code/join
    const joinMatch = path.match(/^\/api\/v1\/rooms\/([^/]+)\/join$/);
    if (joinMatch && request.method === 'POST') {
      if (!httpRateLimiter.consume(ipKey, 'join')) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const bodyResult = await readBoundedJson(request, 4096);
      if (!bodyResult.ok) {
        return jsonResp({ error: makeErrorPayload(bodyResult.code) }, bodyResult.status, request, env);
      }
      const data = isRecord(bodyResult.data) ? bodyResult.data : {};
      const doRes = await joinRoomViaService(env, decodeURIComponent(joinMatch[1]), {
        name: typeof data.name === 'string' ? data.name : '',
        cosmetic: data.cosmetic as JoinRoomHttpRequest['cosmetic'],
      });
      return withCors(doRes, request, env);
    }

    // Room Public Info: GET /api/v1/rooms/:code
    const infoMatch = path.match(/^\/api\/v1\/rooms\/([^/]+)$/);
    if (infoMatch && request.method === 'GET') {
      if (!httpRateLimiter.consume(ipKey, 'info')) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      const doRes = await getRoomInfoViaService(env, decodeURIComponent(infoMatch[1]));
      return withCors(doRes, request, env);
    }

    // Room WebSocket: GET /ws/rooms/:code
    const wsMatch = path.match(/^\/ws\/rooms\/([^/]+)$/);
    if (wsMatch && request.method === 'GET') {
      if (!httpRateLimiter.consume(ipKey, 'ws')) {
        return jsonResp({ error: makeErrorPayload('RATE_LIMITED') }, 429, request, env);
      }
      return await forwardWebSocketToRoom(env, decodeURIComponent(wsMatch[1]), request);
    }

    return jsonResp({ error: makeErrorPayload('ROOM_NOT_FOUND', 'المسار غير موجود.') }, 404, request, env);
  } catch (err) {
    if (err instanceof ProtocolError) {
      return jsonResp({ error: err.toPayload() }, err.httpStatus, request, env);
    }
    return jsonResp({ error: makeErrorPayload('INTERNAL_ERROR') }, 500, request, env);
  }
}
