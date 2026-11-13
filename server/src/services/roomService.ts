import type {
  CreateRoomHttpRequest,
  JoinRoomHttpRequest,
  RoomSessionCredentials,
} from '../../../src/shared/protocol.ts';
import {
  CLIENT_IP_HEADER_NAME,
  INTERNAL_HEADER_NAME,
  INTERNAL_HEADER_VALUE,
  type Env,
} from '../env.ts';
import type { HttpRateChannel } from '../lib/rateLimit.ts';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../lib/roomCode.ts';
import { hashToken } from '../lib/tokens.ts';
import { sanitizeCosmeticOrDefault, sanitizePlayerName } from '../lib/validation.ts';
import { ProtocolError } from '../protocol/errors.ts';

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
  // No Worker-local mutable idempotency cache remains; state lives durably in Durable Objects.
}

export async function consumeDurableHttpRateLimit(
  env: Env,
  channel: HttpRateChannel,
  clientIp: string,
): Promise<boolean> {
  const ipHash = await hashToken(clientIp);
  // 16 coordinator DO shards by IP hash to avoid single hot DO bottleneck
  const shard = ipHash.slice(0, 1);
  const rlStub = env.ROOMS.get(env.ROOMS.idFromName(`__RL_${shard}`));
  const res = await rlStub.fetch(
    makeInternalRequest('/internal/rate-limit', {
      method: 'POST',
      body: JSON.stringify({ key: ipHash, channel }),
    }),
  );
  return res.status !== 429;
}

export async function createRoomViaService(
  env: Env,
  input: CreateRoomHttpRequest,
): Promise<{ status: number; creds: RoomSessionCredentials }> {
  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim().length > 0
      ? input.idempotencyKey.trim().slice(0, 128)
      : undefined;

  const name = sanitizePlayerName(input.name, 'قبطان');
  const cosmetic = sanitizeCosmeticOrDefault(input.cosmetic, 0);

  const keyHash = idempotencyKey ? await hashToken(idempotencyKey) : null;
  const idemStub = keyHash
    ? env.ROOMS.get(env.ROOMS.idFromName(`__IDEM_${keyHash.slice(0, 2)}`))
    : null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidateRoomCode = generateRoomCode();
    let targetRoomCode = candidateRoomCode;
    let claimed = false;

    if (idemStub && keyHash) {
      const claimRes = await idemStub.fetch(
        makeInternalRequest('/internal/idem-claim', {
          method: 'POST',
          body: JSON.stringify({ keyHash, candidateRoomCode }),
        }),
      );
      if (claimRes.ok) {
        const claimData = (await claimRes.json()) as { roomCode: string; claimed: boolean };
        targetRoomCode = claimData.roomCode;
        claimed = claimData.claimed;
      }
    }

    const stub = env.ROOMS.get(env.ROOMS.idFromName(targetRoomCode));
    const res = await stub.fetch(
      makeInternalRequest('/internal/create', {
        method: 'POST',
        body: JSON.stringify({ roomCode: targetRoomCode, name, cosmetic, idempotencyKey }),
      }),
    );

    if (res.status === 409) {
      const errBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const errCode = errBody?.error?.code as ProtocolError['code'] | undefined;
      if (errCode && errCode !== 'ROOM_ALREADY_EXISTS') {
        throw new ProtocolError(errCode, errBody?.error?.message, 409);
      }
      if (idemStub && keyHash && claimed) {
        await idemStub.fetch(
          makeInternalRequest('/internal/idem-release', {
            method: 'POST',
            body: JSON.stringify({ keyHash, candidateRoomCode: targetRoomCode }),
          }),
        );
      }
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
    return { status: res.status, creds };
  }

  throw new ProtocolError('INTERNAL_ERROR', 'تعذر توليد رمز غرفة فريد، يرجى المحاولة مجدداً.', 503);
}

export async function joinRoomViaService(
  env: Env,
  rawCode: string,
  input: JoinRoomHttpRequest,
  clientIp?: string,
): Promise<Response> {
  const roomCode = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(roomCode)) {
    throw new ProtocolError('INVALID_ROOM_CODE', undefined, 400);
  }

  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim().length > 0
      ? input.idempotencyKey.trim().slice(0, 128)
      : undefined;

  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
  return stub.fetch(
    makeInternalRequest('/internal/join', {
      method: 'POST',
      headers: clientIp ? { [CLIENT_IP_HEADER_NAME]: clientIp } : undefined,
      body: JSON.stringify({
        name: sanitizePlayerName(input.name, 'لاعب'),
        cosmetic: sanitizeCosmeticOrDefault(input.cosmetic, 1),
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
  clientIp?: string,
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
  if (clientIp) {
    internalHeaders.set(CLIENT_IP_HEADER_NAME, clientIp);
  }

  return stub.fetch(
    new Request('https://raft-room.internal/internal/ws', {
      method: 'GET',
      headers: internalHeaders,
    }),
  );
}
