import { afterEach, describe, expect, it } from 'vitest';
import { createInitialSimState } from '../../src/shared/physics.ts';
import { PROTOCOL_VERSION, type RoomSessionCredentials, type ServerProtocolMessage } from '../../src/shared/protocol.ts';
import { extractLocalWsUpgrade } from '../src/env.ts';
import type { LocalWebSocket } from '../src/local/nodeDoRuntime.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { SessionManager } from '../src/rooms/sessions.ts';
import { RECONNECT_GRACE_MS, type RoomRecord, type SqlStorageAdapter } from '../src/rooms/types.ts';
import { clearRoomServiceCache } from '../src/services/roomService.ts';
import { collectMessages, connectAndAuthWs, createRoomHttp, flush, joinRoomHttp, setupTestEnv } from './helpers.ts';

describe('Concurrency, Atomicity, Durable Idempotency, Event Persistence & Client Auth Recovery', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('1. prevents double seat assignment under 4 concurrent joins and enforces SQLite active-slot unique index', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'مضيف');
    await connectAndAuthWs(env, hostCreds);

    // Fire 4 concurrent join requests at the exact same tick (only 3 open seats remain: slots 1, 2, 3)
    const responses = await Promise.all([
      joinRoomHttp(env, hostCreds.roomCode, 'متسابق_أ'),
      joinRoomHttp(env, hostCreds.roomCode, 'متسابق_ب'),
      joinRoomHttp(env, hostCreds.roomCode, 'متسابق_ج'),
      joinRoomHttp(env, hostCreds.roomCode, 'متسابق_د'),
    ]);

    const okResponses = responses.filter((r) => r.status === 200);
    const fullResponses = responses.filter((r) => r.status === 409);
    expect(okResponses).toHaveLength(3);
    expect(fullResponses).toHaveLength(1);

    const joinedCreds = (await Promise.all(okResponses.map((r) => r.json()))) as RoomSessionCredentials[];
    const assignedSlots = joinedCreds.map((c) => c.slot).sort((a, b) => a - b);
    expect(assignedSlots).toEqual([1, 2, 3]);

    // Verify SQLite partial unique index uidx_room_players_active_slot rejects duplicate active slot inserts
    const doInstance = namespace.getEntryInstance(hostCreds.roomCode) as unknown as {
      sql: SqlStorageAdapter;
    };
    expect(() =>
      doInstance.sql.exec(
        `INSERT INTO room_players (
          player_id, room_code, slot, role, name, cosmetic_json, resume_token_hash,
          session_id, connection_epoch, connected, ready, revoked, last_seen_at, seat_hold_until, expires_at
        ) VALUES ('dup-p', ?, 1, 'PLAYER', 'dup', '{}', 'hash', 's1', 1, 0, 0, 0, 1000, 16000, 9999999)`,
        hostCreds.roomCode,
      ),
    ).toThrow();
  });

  it('2. makes resumeToken rotation atomic so concurrent auth attempts cannot succeed twice', async () => {
    const sessions = new SessionManager();
    const issued = await sessions.createSession({
      roomCode: 'ATOM1234',
      slot: 0,
      role: 'HOST',
      name: 'ذري',
      cosmetic: { hat: 'captain', glasses: 'none', colorIndex: 0 },
    });

    const sim = createInitialSimState('online');
    const room: RoomRecord = {
      roomCode: 'ATOM1234',
      lifecycleState: 'WAITING',
      hostId: issued.session.playerId,
      fillBots: true,
      idempotencyKey: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      emptySinceMs: null,
      snapshotSeq: 1,
      accumulatorSec: 0,
      sim,
      recentEvents: [],
      sessions: new Map([[issued.session.playerId, issued.session]]),
    };

    const results = await Promise.allSettled([
      sessions.authenticateAndRotate({
        room,
        playerId: issued.session.playerId,
        resumeToken: issued.resumeToken,
      }),
      sessions.authenticateAndRotate({
        room,
        playerId: issued.session.playerId,
        resumeToken: issued.resumeToken,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(issued.session.connectionEpoch).toBe(2);

    // End-to-end WebSocket race with identical initial resumeToken
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();
    const hostCreds = await createRoomHttp(env, 'سباق_مصادقة');

    const [up1, up2] = await Promise.all([
      routeWorkerRequest(
        new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, {
          headers: { upgrade: 'websocket', origin: 'http://localhost:3000' },
        }),
        env,
      ),
      routeWorkerRequest(
        new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, {
          headers: { upgrade: 'websocket', origin: 'http://localhost:3000' },
        }),
        env,
      ),
    ]);

    const ws1 = extractLocalWsUpgrade(up1)!.webSocket as unknown as LocalWebSocket;
    const ws2 = extractLocalWsUpgrade(up2)!.webSocket as unknown as LocalWebSocket;
    const msgs1 = collectMessages(ws1);
    const msgs2 = collectMessages(ws2);

    const authPacket = JSON.stringify({
      version: PROTOCOL_VERSION,
      requestId: 'race-auth',
      type: 'session:authenticate',
      payload: { playerId: hostCreds.playerId, resumeToken: hostCreds.resumeToken },
    });

    ws1.send(authPacket);
    ws2.send(authPacket);
    await flush(50);

    const allMsgs = [...msgs1, ...msgs2];
    expect(allMsgs.filter((m) => m.type === 'session:renewed')).toHaveLength(1);
    expect(allMsgs.filter((m) => m.type === 'room:error' && m.payload?.code === 'UNAUTHORIZED')).toHaveLength(1);
  });

  it('3. persists create and join idempotency inside Durable Objects without storing plaintext resumeToken', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const create1 = await createRoomHttp(env, 'مضيف_ثابت', 'create-key-999');
    expect(create1.roomCode).toMatch(/^[A-Z0-9]{8}$/);

    // Clear Worker-level cache (simulated isolate restart / redeploy) -> retry still returns same room/player!
    clearRoomServiceCache();
    const create2 = await createRoomHttp(env, 'مضيف_ثابت', 'create-key-999');
    expect(create2.roomCode).toBe(create1.roomCode);
    expect(create2.playerId).toBe(create1.playerId);
    expect(create2.slot).toBe(0);

    // Join with idempotencyKey -> repeat does NOT consume a 2nd seat, and reissued token authenticates WS
    const j1Res = await joinRoomHttp(env, create1.roomCode, 'منضم', 'join-key-abc');
    expect(j1Res.status).toBe(200);
    const j1 = (await j1Res.json()) as RoomSessionCredentials;
    expect(j1.slot).toBe(1);

    const j2Res = await joinRoomHttp(env, create1.roomCode, 'منضم', 'join-key-abc');
    expect(j2Res.status).toBe(200);
    const j2 = (await j2Res.json()) as RoomSessionCredentials;
    expect(j2.playerId).toBe(j1.playerId);
    expect(j2.slot).toBe(1);

    // Verify plaintext resumeTokens are NEVER stored in SQLite room_requests
    const doInstance = namespace.getEntryInstance(create1.roomCode) as unknown as {
      sql: SqlStorageAdapter;
    };
    const reqRows = doInstance.sql.exec<{ result_json: string }>(`SELECT result_json FROM room_requests`).toArray();
    const joinedJson = reqRows.map((r) => r.result_json).join('\n');
    expect(joinedJson.includes(create1.resumeToken)).toBe(false);
    expect(joinedJson.includes(create2.resumeToken)).toBe(false);
    expect(joinedJson.includes(j1.resumeToken)).toBe(false);
    expect(joinedJson.includes(j2.resumeToken)).toBe(false);

    // The re-issued token from idempotent replay connects cleanly on WS
    const conn2 = await connectAndAuthWs(env, j2);
    expect(conn2.msgs.some((m) => m.type === 'room:joined' && m.payload?.playerId === j1.playerId)).toBe(true);

    // Replaying join AFTER WS activation must fail explicitly with 409 SESSION_ALREADY_ACTIVE (no empty resumeToken)
    const j2AfterActive = await joinRoomHttp(env, create1.roomCode, 'منضم', 'join-key-abc');
    expect(j2AfterActive.status).toBe(409);
    const j2ErrBody = (await j2AfterActive.json()) as { error?: { code?: string } };
    expect(j2ErrBody.error?.code).toBe('SESSION_ALREADY_ACTIVE');

    // Same for host create replay once host connects via WS
    const conn1 = await connectAndAuthWs(env, create2);
    expect(conn1.msgs.some((m) => m.type === 'room:joined' && m.payload?.playerId === create1.playerId)).toBe(true);
    await expect(createRoomHttp(env, 'مضيف_ثابت', 'create-key-999')).rejects.toThrow('409');

    // A different idempotencyKey gets the next open slot (slot 2)
    const j3Res = await joinRoomHttp(env, create1.roomCode, 'منضم_ثان', 'join-key-def');
    expect(j3Res.status).toBe(200);
    const j3 = (await j3Res.json()) as RoomSessionCredentials;
    expect(j3.slot).toBe(2);
    expect(j3.playerId).not.toBe(j1.playerId);
  });

  it('4. preserves room.recentEvents and sim.eventSeq independently across DO hibernation wake-up', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'ذاكرة_أحداث');
    const conn = await connectAndAuthWs(env, hostCreds);

    const doBefore = namespace.getEntryInstance(hostCreds.roomCode) as unknown as {
      room: RoomRecord;
      persistence: { saveSimState: (room: RoomRecord, nowMs?: number) => void };
    };

    // Simulate multiple past physics ticks where sim.events was cleared each step, while recentEvents retained history
    doBefore.room.sim.eventSeq = 15;
    doBefore.room.sim.events = [];
    doBefore.room.recentEvents = [
      { id: 12, type: 'bumper', intensity: 0.9, x: 1, z: -50 },
      { id: 13, type: 'checkpoint', intensity: 1, x: 0, z: -120 },
      { id: 15, type: 'collision', intensity: 0.7, x: -2, z: -180 },
    ];
    doBefore.persistence.saveSimState(doBefore.room, Date.now());

    // Evict Durable Object from memory and wake up from SQLite
    const woken = namespace.simulateDormantWakeUp(hostCreds.roomCode) as unknown as { room: RoomRecord };
    await flush();

    expect(woken.room.recentEvents).toHaveLength(3);
    expect(woken.room.recentEvents.map((e) => e.id)).toEqual([12, 13, 15]);
    expect(woken.room.sim.eventSeq).toBe(15);

    conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'resync-after-wake',
        type: 'game:resync',
        payload: { lastEventId: 12, lastSnapshotSeq: 1 },
      }),
    );
    await flush();

    const missed = conn.msgs.find((m) => m.type === 'game:event');
    expect(missed?.type === 'game:event' && missed.payload?.events.map((e) => e.id)).toEqual([13, 15]);
  });

  it('5. migrates host leadership when join path cleans up an expired host session', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'مضيف_سابق');
    const hostConn = await connectAndAuthWs(env, hostCreds);
    const j2Res = await joinRoomHttp(env, hostCreds.roomCode, 'وريث');
    const p2Creds = (await j2Res.json()) as RoomSessionCredentials;
    await connectAndAuthWs(env, p2Creds);

    // Host drops and grace expires BEFORE alarm runs
    hostConn.ws.close(1006, 'DROP');
    await flush();
    const doInstance = namespace.getEntryInstance(hostCreds.roomCode) as unknown as {
      room: RoomRecord;
    };
    const hostSession = doInstance.room.sessions.get(hostCreds.playerId)!;
    hostSession.lastSeenAt = Date.now() - RECONNECT_GRACE_MS - 5000;

    // A new player joins now -> cleanup runs inside handleInternalJoin and must migrate host to Player 2!
    const j3Res = await joinRoomHttp(env, hostCreds.roomCode, 'وافد_جديد');
    expect(j3Res.status).toBe(200);
    const p3Creds = (await j3Res.json()) as RoomSessionCredentials;

    expect(p3Creds.role).toBe('PLAYER');
    expect(p3Creds.snapshot.hostId).toBe(p2Creds.playerId);
    expect(doInstance.room.sessions.get(p2Creds.playerId)?.role).toBe('HOST');
  });

  it('6. exposes accurate seatStatus (CONNECTED, RECONNECTING, BOT, EMPTY) in snapshots matching server state', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'مراقب');
    const hostConn = await connectAndAuthWs(env, hostCreds);

    const j2Res = await joinRoomHttp(env, hostCreds.roomCode, 'منقطع');
    const p2Creds = (await j2Res.json()) as RoomSessionCredentials;
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    // With bots enabled: slots [CONNECTED, CONNECTED, BOT, BOT]
    const s1 = [...hostConn.msgs].reverse().find((m): m is Extract<ServerProtocolMessage, { type: 'room:state' }> => m.type === 'room:state');
    expect(s1?.payload?.snapshot.seats).toEqual(['CONNECTED', 'CONNECTED', 'BOT', 'BOT']);

    // Turn bots off -> slots 2 & 3 become EMPTY
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'bots-off', type: 'room:toggleBots', payload: { fillBots: false } }));
    await flush();
    const s2 = [...hostConn.msgs].reverse().find((m): m is Extract<ServerProtocolMessage, { type: 'room:state' }> => m.type === 'room:state');
    expect(s2?.payload?.snapshot.seats).toEqual(['CONNECTED', 'CONNECTED', 'EMPTY', 'EMPTY']);

    // Player 2 drops unexpectedly -> slot 1 MUST be RECONNECTING (NOT EMPTY!)
    p2Conn.ws.close(1006, 'DROP');
    await flush();
    const s3 = [...hostConn.msgs].reverse().find((m): m is Extract<ServerProtocolMessage, { type: 'room:state' }> => m.type === 'room:state');
    expect(s3?.payload?.snapshot.seats).toEqual(['CONNECTED', 'RECONNECTING', 'EMPTY', 'EMPTY']);
    expect(s3?.payload?.snapshot.sim.players[1].seatStatus).toBe('RECONNECTING');
    expect(s3?.payload?.snapshot.sim.players[1].connected).toBe(false);
    expect(s3?.payload?.snapshot.sim.players[1].isBot).toBe(false);
  });
});
