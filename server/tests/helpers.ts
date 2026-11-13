import { PROTOCOL_VERSION, type RoomSessionCredentials, type ServerProtocolMessage } from '../../src/shared/protocol.ts';
import { extractLocalWsUpgrade } from '../src/env.ts';
import { createLocalWorkerEnv, type LocalWebSocket } from '../src/local/nodeDoRuntime.ts';
import { clearHttpRateLimiter, routeWorkerRequest } from '../src/router.ts';
import { clearRoomServiceCache } from '../src/services/roomService.ts';

export function setupTestEnv() {
  clearRoomServiceCache();
  clearHttpRateLimiter();
  return createLocalWorkerEnv();
}

export function collectMessages(ws: LocalWebSocket): ServerProtocolMessage[] {
  const list: ServerProtocolMessage[] = [];
  ws.addEventListener('message', (ev) => {
    list.push(JSON.parse(String((ev as MessageEvent).data)) as ServerProtocolMessage);
  });
  return list;
}

export const flush = (ms = 25) => new Promise<void>((r) => setTimeout(r, ms));

export async function createRoomHttp(
  env: ReturnType<typeof createLocalWorkerEnv>['env'],
  name = 'مضيف',
  idempotencyKey?: string,
): Promise<RoomSessionCredentials> {
  const res = await routeWorkerRequest(
    new Request('http://localhost/api/v1/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        cosmetic: { hat: 'captain', glasses: 'none', colorIndex: 0 },
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    }),
    env,
  );
  if (!res.ok) {
    throw new Error(`createRoomHttp failed with ${res.status}`);
  }
  return (await res.json()) as RoomSessionCredentials;
}

export async function joinRoomHttp(
  env: ReturnType<typeof createLocalWorkerEnv>['env'],
  roomCode: string,
  name: string,
  idempotencyKey?: string,
): Promise<Response> {
  return routeWorkerRequest(
    new Request(`http://localhost/api/v1/rooms/${roomCode}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    }),
    env,
  );
}

export async function connectAndAuthWs(
  env: ReturnType<typeof createLocalWorkerEnv>['env'],
  creds: Pick<RoomSessionCredentials, 'roomCode' | 'playerId' | 'resumeToken'>,
): Promise<{ ws: LocalWebSocket; msgs: ServerProtocolMessage[] }> {
  const res = await routeWorkerRequest(
    new Request(`http://localhost/ws/rooms/${creds.roomCode}`, {
      headers: { upgrade: 'websocket', origin: 'http://localhost:3000' },
    }),
    env,
  );
  const upgrade = extractLocalWsUpgrade(res);
  if (!upgrade) {
    throw new Error(`WS upgrade failed with status ${res.status}`);
  }
  const ws = upgrade.webSocket as unknown as LocalWebSocket;
  const msgs = collectMessages(ws);
  ws.send(
    JSON.stringify({
      version: PROTOCOL_VERSION,
      requestId: `auth-${Math.random().toString(36).slice(2, 8)}`,
      type: 'session:authenticate',
      payload: { playerId: creds.playerId, resumeToken: creds.resumeToken },
    }),
  );
  await flush();
  return { ws, msgs };
}
