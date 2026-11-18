import type {
  CreatePartyHttpRequest,
  JoinPartyHttpRequest,
  PartySessionCredentials,
} from '../../../src/shared/protocol.ts';
import {
  CLIENT_IP_HEADER_NAME,
  INTERNAL_HEADER_NAME,
  INTERNAL_HEADER_VALUE,
  type Env,
} from '../env.ts';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../lib/roomCode.ts';
import { sanitizeCosmeticOrDefault, sanitizePlayerName } from '../lib/validation.ts';
import { ProtocolError } from '../protocol/errors.ts';

function partyDoName(partyCode: string): string {
  return `__PARTY_${partyCode}`;
}

function makeInternalPartyRequest(path: string, init?: RequestInit): Request {
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

export async function createPartyViaService(
  env: Env,
  input: CreatePartyHttpRequest,
): Promise<{ status: number; creds: PartySessionCredentials }> {
  const name = sanitizePlayerName(input.name, 'قائد المجموعة');
  const cosmetic = sanitizeCosmeticOrDefault(input.cosmetic, 0);

  for (let attempt = 0; attempt < 8; attempt++) {
    const partyCode = generateRoomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(partyDoName(partyCode)));
    const res = await stub.fetch(
      makeInternalPartyRequest('/internal/party/create', {
        method: 'POST',
        body: JSON.stringify({ partyCode, name, cosmetic }),
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

    const creds = (await res.json()) as PartySessionCredentials;
    return { status: res.status, creds };
  }

  throw new ProtocolError('INTERNAL_ERROR', 'تعذر إنشاء رمز للمجموعة، يرجى المحاولة مجدداً.', 503);
}

export async function joinPartyViaService(
  env: Env,
  rawCode: string,
  input: JoinPartyHttpRequest,
): Promise<Response> {
  const partyCode = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(partyCode)) {
    throw new ProtocolError('INVALID_ROOM_CODE', 'رمز المجموعة غير صالح.', 400);
  }
  const stub = env.ROOMS.get(env.ROOMS.idFromName(partyDoName(partyCode)));
  return stub.fetch(
    makeInternalPartyRequest('/internal/party/join', {
      method: 'POST',
      body: JSON.stringify({
        name: sanitizePlayerName(input.name, 'عضو'),
        cosmetic: sanitizeCosmeticOrDefault(input.cosmetic, 1),
      }),
    }),
  );
}

export async function getPartyInfoViaService(env: Env, rawCode: string): Promise<Response> {
  const partyCode = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(partyCode)) {
    throw new ProtocolError('INVALID_ROOM_CODE', 'رمز المجموعة غير صالح.', 400);
  }
  const stub = env.ROOMS.get(env.ROOMS.idFromName(partyDoName(partyCode)));
  return stub.fetch(makeInternalPartyRequest('/internal/party/info', { method: 'GET' }));
}

export async function forwardWebSocketToParty(
  env: Env,
  rawCode: string,
  request: Request,
  clientIp?: string,
): Promise<Response> {
  const partyCode = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(partyCode)) {
    throw new ProtocolError('INVALID_ROOM_CODE', 'رمز المجموعة غير صالح.', 400);
  }
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    throw new ProtocolError('INVALID_MESSAGE', 'يتطلب هذا المسار ترقية WebSocket.', 426);
  }
  const stub = env.ROOMS.get(env.ROOMS.idFromName(partyDoName(partyCode)));
  const internalHeaders = new Headers(request.headers);
  internalHeaders.set(INTERNAL_HEADER_NAME, INTERNAL_HEADER_VALUE);
  if (clientIp) {
    internalHeaders.set(CLIENT_IP_HEADER_NAME, clientIp);
  }
  return stub.fetch(
    new Request('https://raft-room.internal/internal/party/ws', {
      method: 'GET',
      headers: internalHeaders,
    }),
  );
}
