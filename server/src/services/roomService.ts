import type {
  CreateRoomHttpRequest,
  JoinRoomHttpRequest,
  RoomSessionCredentials,
} from '../../../src/shared/protocol.ts';
import { INTERNAL_HEADER_NAME, INTERNAL_HEADER_VALUE, type Env } from '../env.ts';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../lib/roomCode.ts';
import { sanitizeCosmeticOrDefault, sanitizePlayerName } from '../lib/validation.ts';
import { ProtocolError } from '../protocol/errors.ts';

interface IdempotentCacheEntry {
  creds: RoomSessionCredentials;
  cachedAt: number;
}

const IDEMPOTENCY_TTL_MS = 60_000;
const recentIdempotentCreations = new Map<string, IdempotentCacheEntry>();

function pruneIdempotencyCache(nowMs: number): void {
  for (const [k, v] of recentIdempotentCreations.entries()) {
    if (nowMs - v.cachedAt > IDEMPOTENCY_TTL_MS) {
      recentIdempotentCreations.delete(k);
    }
  }
}

function makeInternalRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set(INTERNAL_HEADER_NAME, INTERNAL_HEADER_VALUE);
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(`https://raft-room.internal${path}`, {
    ...init,
    headers,
  });
}

export function clearRoomServiceCache(): void {
  recentIdempotentCreations.clear();
}

export async function createRoomViaService(
  env: Env,
  input: CreateRoomHttpRequest,
): Promise<{ status: number; creds: RoomSessionCredentials }> {
  const nowMs = Date.now();
  pruneIdempotencyCache(nowMs);

  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim().length > 0
      ? input.idempotencyKey.trim().slice(0, 128)
      : undefined;

  if (idempotencyKey) {
    const hit = recentIdempotentCreations.get(idempotencyKey);
    if (hit) {
      return { status: 200, creds: hit.creds };
    }
  }

  const name = sanitizePlayerName(input.name, 'قبطان');
  const cosmetic = sanitizeCosmeticOrDefault(input.cosmetic, 0);

  for (let attempt = 0; attempt < 8; attempt++) {
    const roomCode = generateRoomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
    const res = await stub.fetch(
      makeInternalRequest('/internal/create', {
        method: 'POST',
        body: JSON.stringify({ roomCode, name, cosmetic, idempotencyKey }),
      }),
    );

    if (res.status === 409) {
      continue;
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new ProtocolError(
        (errBody?.error?.code as ProtocolError['code']) ?? 'INTERNAL_ERROR',
        errBody?.error?.message,
        res.status,
      );
    }

    const creds = (await res.json()) as RoomSessionCredentials;
    if (idempotencyKey) {
      recentIdempotentCreations.set(idempotencyKey, { creds, cachedAt: nowMs });
    }
    return { status: 201, creds };
  }

  throw new ProtocolError('INTERNAL_ERROR', 'تعذر توليد رمز غرفة فريد، يرجى المحاولة مجدداً.', 503);
}

export async function joinRoomViaService(
  env: Env,
  rawCode: string,
  input: JoinRoomHttpRequest,
): Promise<Response> {
  const roomCode = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(roomCode)) {
    throw new ProtocolError('INVALID_ROOM_CODE', undefined, 400);
  }

  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
  return stub.fetch(
    makeInternalRequest('/internal/join', {
      method: 'POST',
      body: JSON.stringify({
        name: sanitizePlayerName(input.name, 'لاعب'),
        cosmetic: sanitizeCosmeticOrDefault(input.cosmetic, 1),
      }),
    }),
  );
}

export async function getRoomInfoViaService(env: Env, rawCode: string): Promise<Response> {
  const roomCode = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(roomCode)) {
    throw new ProtocolError('INVALID_ROOM_CODE', undefined, 400);
  }

  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
  return stub.fetch(makeInternalRequest('/internal/info', { method: 'GET' }));
}

export async function forwardWebSocketToRoom(
  env: Env,
  rawCode: string,
  request: Request,
): Promise<Response> {
  const roomCode = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(roomCode)) {
    throw new ProtocolError('INVALID_ROOM_CODE', undefined, 400);
  }

  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    throw new ProtocolError('INVALID_MESSAGE', 'يتطلب هذا المسار ترقية WebSocket.', 426);
  }

  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
  const internalHeaders = new Headers(request.headers);
  internalHeaders.set(INTERNAL_HEADER_NAME, INTERNAL_HEADER_VALUE);

  return stub.fetch(
    new Request('https://raft-room.internal/internal/ws', {
      method: 'GET',
      headers: internalHeaders,
    }),
  );
}
