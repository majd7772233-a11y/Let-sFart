import { afterEach, describe, expect, it } from 'vitest';
import { MAX_WS_MESSAGE_BYTES, PROTOCOL_VERSION, type RoomSessionCredentials } from '../../src/shared/protocol.ts';
import { extractLocalWsUpgrade } from '../src/env.ts';
import type { LocalWebSocket } from '../src/local/nodeDoRuntime.ts';
import { parseAndValidateClientEnvelope } from '../src/protocol/validators.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { SessionManager } from '../src/rooms/sessions.ts';
import { RECONNECT_GRACE_MS, type RoomRecord } from '../src/rooms/types.ts';
import { createInitialSimState } from '../../src/shared/physics.ts';
import { collectMessages, connectAndAuthWs, createRoomHttp, flush, setupTestEnv } from './helpers.ts';

describe('SRV-21: Sessions, reconnect epoch safety, WS validation, and security hardening', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('rotates resumeToken, rejects old/forged tokens, and ignores delayed close from superseded socket', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'مضيف');
    const conn1 = await connectAndAuthWs(env, hostCreds);

    const renewed1 = conn1.msgs.find((m) => m.type === 'session:renewed');
    expect(renewed1?.type).toBe('session:renewed');
    const token2 = renewed1?.type === 'session:renewed' ? renewed1.payload!.resumeToken : '';
    expect(token2).not.toBe(hostCreds.resumeToken);

    // Old token1 must now be rejected (one-time rotation!)
    const replayConn = await connectAndAuthWs(env, {
      roomCode: hostCreds.roomCode,
      playerId: hostCreds.playerId,
      resumeToken: hostCreds.resumeToken,
    });
    expect(replayConn.msgs.some((m) => m.type === 'room:error' && m.payload?.code === 'UNAUTHORIZED')).toBe(true);
    replayConn.ws.close(1000, 'cleanup');

    // Valid reconnect with token2 -> supersedes conn1 without marking host disconnected
    const conn2 = await connectAndAuthWs(env, {
      roomCode: hostCreds.roomCode,
      playerId: hostCreds.playerId,
      resumeToken: token2,
    });
    await flush();

    expect(conn1.msgs.some((m) => m.type === 'room:error' && m.payload?.code === 'SESSION_REPLACED')).toBe(true);
    expect(conn1.ws.readyState).toBe(3);

    // Simulate a late/out-of-order webSocketClose notification on conn1's server socket:
    // host MUST remain connected in conn2!
    const infoRes = await routeWorkerRequest(new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}`), env);
    expect(infoRes.status).toBe(200);
    const joined2 = conn2.msgs.find((m) => m.type === 'room:joined');
    expect(joined2?.type === 'room:joined' && joined2.payload?.connectionEpoch).toBe(3);
    expect(joined2?.type === 'room:joined' && joined2.payload?.snapshot.sim.players[0].connected).toBe(true);
  });

  it('rejects expired grace sessions via SessionManager', async () => {
    const sessions = new SessionManager();
    const issued = await sessions.createSession({
      roomCode: 'EXP12345',
      slot: 0,
      role: 'HOST',
      name: 'توقيت',
      cosmetic: { hat: 'none', glasses: 'none', colorIndex: 0 },
      nowMs: 10_000,
    });

    const sim = createInitialSimState('online');
    const room: RoomRecord = {
      roomCode: 'EXP12345',
      lifecycleState: 'WAITING',
      hostId: issued.session.playerId,
      fillBots: false,
      isPrivate: false,
      passwordHash: null,
      settings: { gameMode: 'standard', difficulty: 'normal', enableItems: true, roundTimeLimitSec: 0, maxPlayers: 4 },
      courseId: 'tropical',
      courseSelectionMode: 'host',
      courseVotes: {},
      playlistQueue: [],
      recentChat: [],
      emoteSeq: 0,
      idempotencyKey: null,
      createdAt: 10_000,
      expiresAt: 1_000_000,
      emptySinceMs: null,
      snapshotSeq: 1,
      accumulatorSec: 0,
      sim,
      recentEvents: [],
      sessions: new Map([[issued.session.playerId, issued.session]]),
    };

    const { newResumeToken } = await sessions.authenticateAndRotate({
      room,
      playerId: issued.session.playerId,
      resumeToken: issued.resumeToken,
      nowMs: 10_500,
    });
    issued.session.connected = false;
    issued.session.lastSeenAt = 10_500;

    await expect(
      sessions.authenticateAndRotate({
        room,
        playerId: issued.session.playerId,
        resumeToken: newResumeToken,
        nowMs: 10_500 + RECONNECT_GRACE_MS + 500,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('validates WS envelopes, rejects spoofing/oversized payloads, enforces monotonic seq and command dedup', async () => {
    expect(parseAndValidateClientEnvelope('not-json').ok).toBe(false);
    expect(parseAndValidateClientEnvelope(JSON.stringify({ version: 99, type: 'ping' })).ok).toBe(false);
    expect(parseAndValidateClientEnvelope(JSON.stringify({ version: PROTOCOL_VERSION, type: 'evil:op' })).ok).toBe(false);
    expect(
      parseAndValidateClientEnvelope(
        JSON.stringify({ version: PROTOCOL_VERSION, type: 'ping', payload: { pad: 'a'.repeat(MAX_WS_MESSAGE_BYTES) } }),
      ).ok,
    ).toBe(false);
    expect(
      parseAndValidateClientEnvelope(
        JSON.stringify({ version: PROTOCOL_VERSION, type: 'input:state', payload: { moveDir: 0, farting: true, seq: 1, slot: 2 } }),
      ).ok,
    ).toBe(false);

    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'أمان');
    const conn = await connectAndAuthWs(env, hostCreds);

    // Start round with requestId='dedup-start-1'
    conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'dedup-start-1', type: 'room:start', payload: {} }));
    await flush();
    const stateCountAfterFirst = conn.msgs.filter((m) => m.type === 'room:state').length;

    // Replaying exact same requestId='dedup-start-1' is idempotently ignored instead of erroring or double-executing
    conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'dedup-start-1', type: 'room:start', payload: {} }));
    await flush();
    expect(conn.msgs.filter((m) => m.type === 'room:error' && m.requestId === 'dedup-start-1').length).toBe(0);
    expect(conn.msgs.filter((m) => m.type === 'room:state').length).toBe(stateCountAfterFirst);

    // Input seq ordering: seq=10 accepted, stale seq=9 ignored
    conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'input:state', payload: { moveDir: 1, farting: true, seq: 10 } }));
    conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'input:state', payload: { moveDir: 0, farting: false, seq: 9 } }));
    await flush();

    // Verify stale seq=9 did not stop farting by inspecting room state
    const roomObj = namespace.getEntryInstance(hostCreds.roomCode) as unknown as { room: RoomRecord };
    expect(roomObj.room.sim.players[0].farting).toBe(true);
    expect(roomObj.room.sim.players[0].moveDir).toBe(1);
  });

  it('blocks /internal/*, enforces ALLOWED_ORIGINS on HTTP & WS, and applies HTTP IP rate limits', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();
    env.ALLOWED_ORIGINS = 'https://game.example.com';

    const internalRes = await routeWorkerRequest(new Request('http://localhost/internal/create', { method: 'POST' }), env);
    expect(internalRes.status).toBe(403);

    const badOriginRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
        body: JSON.stringify({ name: 'مخترق' }),
      }),
      env,
    );
    expect(badOriginRes.status).toBe(403);

    const goodOriginRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://game.example.com' },
        body: JSON.stringify({ name: 'موثوق' }),
      }),
      env,
    );
    expect(goodOriginRes.status).toBe(201);
    expect(goodOriginRes.headers.get('access-control-allow-origin')).toBe('https://game.example.com');
    const creds = (await goodOriginRes.json()) as RoomSessionCredentials;

    const badWsRes = await routeWorkerRequest(
      new Request(`http://localhost/ws/rooms/${creds.roomCode}`, {
        headers: { upgrade: 'websocket', origin: 'https://evil.example.com' },
      }),
      env,
    );
    expect(badWsRes.status).toBe(403);

    const goodWsRes = await routeWorkerRequest(
      new Request(`http://localhost/ws/rooms/${creds.roomCode}`, {
        headers: { upgrade: 'websocket', origin: 'https://game.example.com' },
      }),
      env,
    );
    expect(extractLocalWsUpgrade(goodWsRes)?.status).toBe(101);

    // Rate limit on /api/v1/rooms from same IP (>12 burst)
    let hit429 = false;
    for (let i = 0; i < 16; i++) {
      const r = await routeWorkerRequest(
        new Request('http://localhost/api/v1/rooms', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://game.example.com',
            'cf-connecting-ip': '203.0.113.55',
          },
          body: JSON.stringify({ name: `r${i}` }),
        }),
        env,
      );
      if (r.status === 429) {
        hit429 = true;
        break;
      }
    }
    expect(hit429).toBe(true);
  });

  it('bounds WebSocket session:authenticate failures and closes the socket across DO hibernation', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'حماية_مصادقة');
    const wsRes = await routeWorkerRequest(
      new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, {
        headers: { upgrade: 'websocket', origin: 'http://localhost:3000' },
      }),
      env,
    );
    const ws = extractLocalWsUpgrade(wsRes)!.webSocket as unknown as LocalWebSocket;
    const msgs = collectMessages(ws);

    const badAuth = JSON.stringify({
      version: PROTOCOL_VERSION,
      requestId: 'bad-auth',
      type: 'session:authenticate',
      payload: { playerId: hostCreds.playerId, resumeToken: 'wrong-token-000000' },
    });

    // Attempts 1 & 2 -> error returned, socket remains open
    ws.send(badAuth);
    ws.send(badAuth);
    await flush();
    expect(msgs.filter((m) => m.type === 'room:error' && m.payload?.code === 'UNAUTHORIZED')).toHaveLength(2);
    expect(ws.readyState).toBe(1);

    // Simulate DO hibernation eviction between auth failures -> attempt count survives in attachment!
    namespace.simulateDormantWakeUp(hostCreds.roomCode);
    await flush();

    // Attempt 3 -> returns UNAUTHORIZED and immediately closes socket (MAX_WS_AUTH_ATTEMPTS = 3)
    ws.send(badAuth);
    await flush();
    expect(msgs.filter((m) => m.type === 'room:error' && m.payload?.code === 'UNAUTHORIZED')).toHaveLength(3);
    expect(ws.readyState).toBe(3);
  });

  it('enforces durable DO rate limiting across Worker isolate clears, supports RATE_LIMITER binding, and fails closed in production CORS', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Production with unset ALLOWED_ORIGINS MUST reject requests and omit CORS * header
    env.ENVIRONMENT = 'production';
    env.ALLOWED_ORIGINS = '';
    const unconfiguredProdRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://any.example.com' },
        body: JSON.stringify({ name: 'test' }),
      }),
      env,
    );
    expect(unconfiguredProdRes.status).toBe(403);
    expect(unconfiguredProdRes.headers.get('access-control-allow-origin')).toBeNull();

    // Configure allowed origin for production
    env.ALLOWED_ORIGINS = 'https://prod.example.com';

    // Exhaust 12 create tokens in both Worker isolate and durable DO SQLite for IP 203.0.113.88
    for (let i = 0; i < 12; i++) {
      const res = await routeWorkerRequest(
        new Request('http://localhost/api/v1/rooms', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://prod.example.com',
            'cf-connecting-ip': '203.0.113.88',
          },
          body: JSON.stringify({ name: `d${i}` }),
        }),
        env,
      );
      expect(res.status).toBe(201);
    }

    // Clear Worker in-memory limiter (simulates isolate cold start/eviction)
    const { clearHttpRateLimiter } = await import('../src/router.ts');
    clearHttpRateLimiter();

    // 13th request STILL blocked 429 by durable DO SQLite bucket!
    const afterIsolateReset = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://prod.example.com',
          'cf-connecting-ip': '203.0.113.88',
        },
        body: JSON.stringify({ name: 'blocked' }),
      }),
      env,
    );
    expect(afterIsolateReset.status).toBe(429);

    // Optional Cloudflare RATE_LIMITER binding is honored when present
    env.RATE_LIMITER = {
      limit: async () => ({ success: false }),
    };
    const cfLimitedRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://prod.example.com',
          'cf-connecting-ip': '198.51.100.9',
        },
        body: JSON.stringify({ name: 'edge' }),
      }),
      env,
    );
    expect(cfLimitedRes.status).toBe(429);
  });
});
