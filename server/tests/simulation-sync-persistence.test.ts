import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialSimState } from '../../src/shared/physics.ts';
import { PROTOCOL_VERSION, type HealthResponse } from '../../src/shared/protocol.ts';
import { createNodeSqlAdapter } from '../src/local/nodeDoRuntime.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { RoomPersistence } from '../src/rooms/persistence.ts';
import { initRoomSchema } from '../src/rooms/schema.ts';
import { SessionManager } from '../src/rooms/sessions.ts';
import { FIXED_SIM_DT, MAX_CATCHUP_STEPS, prepareSimForStart, stepRoomSimulation } from '../src/rooms/simulation.ts';
import { buildRoomSnapshot } from '../src/rooms/snapshots.ts';
import { ROOM_EMPTY_CLOSE_MS, type RoomRecord } from '../src/rooms/types.ts';
import { connectAndAuthWs, createRoomHttp, flush, setupTestEnv } from './helpers.ts';

describe('SRV-21: Fixed-timestep simulation, Snapshot/Resync, SQLite/Hibernation, and Room Expiry', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('steps physics strictly at FIXED_SIM_DT=1/30s with accumulator + catchup cap and preserves mode=online', async () => {
    const sessions = new SessionManager();
    const issued = await sessions.createSession({
      roomCode: 'ACC12345',
      slot: 0,
      role: 'HOST',
      name: 'ملاح',
      cosmetic: { hat: 'captain', glasses: 'none', colorIndex: 0 },
    });
    const sim = createInitialSimState('online', 'ملاح', issued.session.cosmetic);
    sim.phase = 'waiting';
    sim.players[0].id = issued.session.playerId;

    const room: RoomRecord = {
      roomCode: 'ACC12345',
      lifecycleState: 'WAITING',
      hostId: issued.session.playerId,
      fillBots: true,
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
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      emptySinceMs: null,
      snapshotSeq: 1,
      accumulatorSec: 0,
      sim,
      recentEvents: [],
      sessions: new Map([[issued.session.playerId, issued.session]]),
    };

    // WAITING room ignores steps
    const waitRes = stepRoomSimulation(room, 0.1);
    expect(waitRes.stepsExecuted).toBe(0);

    prepareSimForStart(room);
    room.sim.players[0].connected = true;
    room.sim.players[0].farting = true;

    // Small dt (< 1/30s) accumulates without executing a half step; 2nd small dt crosses 1/30s -> 1 fixed step!
    const s1 = stepRoomSimulation(room, 0.02);
    expect(s1.stepsExecuted).toBe(0);
    const s2 = stepRoomSimulation(room, 0.02);
    expect(s2.stepsExecuted).toBe(1);
    expect(room.sim.simTime).toBeCloseTo(FIXED_SIM_DT, 6);
    expect(room.sim.mode).toBe('online');

    // Huge lag spike (0.5s) is bounded by MAX_CATCHUP_STEPS
    const sLag = stepRoomSimulation(room, 0.5);
    expect(sLag.stepsExecuted).toBe(MAX_CATCHUP_STEPS);
  });

  it('supports snapshotSeq ordering, game:resync missed event replay, and conditional loop pausing in WAITING rooms', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const healthRes = await routeWorkerRequest(new Request('http://localhost/api/health'), env);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as HealthResponse;
    expect(health.ok).toBe(true);
    expect(health.protocolVersion).toBe(PROTOCOL_VERSION);

    const hostCreds = await createRoomHttp(env, 'متزامن');
    const conn = await connectAndAuthWs(env, hostCreds);

    // Waiting room MUST NOT have an active simulation interval timer running (hibernation friendly!)
    const doInstance = namespace.getEntryInstance(hostCreds.roomCode) as unknown as {
      loopTimer: ReturnType<typeof setInterval> | null;
      room: RoomRecord;
    };
    expect(doInstance.loopTimer).toBeNull();

    // Start round -> loop starts automatically
    conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'go', type: 'room:start', payload: {} }));
    await flush(60);
    expect(doInstance.loopTimer).not.toBeNull();

    // Inject discrete event and verify game:resync returns missed events since cursor
    doInstance.room.recentEvents.push({ id: 42, type: 'checkpoint', intensity: 1, x: 0, z: -120 });
    doInstance.room.sim.eventSeq = 42;

    conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'resync-1',
        type: 'game:resync',
        payload: { lastEventId: 40, lastSnapshotSeq: 1 },
      }),
    );
    await flush();

    const resyncState = conn.msgs.find((m) => m.type === 'room:state' && m.requestId === 'resync-1');
    expect(resyncState?.type === 'room:state' && resyncState.payload?.snapshot.snapshotSeq).toBeGreaterThan(1);
    const missedEventsMsg = conn.msgs.find((m) => m.type === 'game:event' && m.payload?.events.some((e) => e.id === 42));
    expect(missedEventsMsg).toBeDefined();

    // Restart -> returns to WAITING and stops simulation interval timer
    conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'rst', type: 'room:restart', payload: {} }));
    await flush();
    expect(doInstance.loopTimer).toBeNull();
  });

  it('migrates v1 SQLite schema, rejects corrupted state safely, and restores open sockets after DO Hibernation wake-up', async () => {
    // 1. v1 -> v2 schema migration & corrupt JSON safety
    const db = new DatabaseSync(':memory:');
    const sql = createNodeSqlAdapter(db);
    db.exec(`
      CREATE TABLE room_meta (
        room_code TEXT PRIMARY KEY,
        lifecycle_state TEXT NOT NULL,
        host_player_id TEXT NOT NULL,
        fill_bots INTEGER NOT NULL,
        idempotency_key TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        empty_since_ms INTEGER,
        sim_json TEXT NOT NULL
      );
      CREATE TABLE room_sessions (
        player_id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        slot INTEGER NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        cosmetic_json TEXT NOT NULL,
        resume_token_hash TEXT NOT NULL,
        session_id TEXT NOT NULL,
        connection_epoch INTEGER NOT NULL,
        connected INTEGER NOT NULL,
        ready INTEGER NOT NULL,
        revoked INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    const v1Sim = createInitialSimState('online', 'مهاجر');
    db.prepare(`INSERT INTO room_meta VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'MIG12345', 'WAITING', 'p1', 1, null, 1000, 999999999999, null, JSON.stringify(v1Sim),
    );
    initRoomSchema(sql);
    const persistence = new RoomPersistence(sql);
    const migrated = persistence.loadRoom();
    expect(migrated?.roomCode).toBe('MIG12345');

    // Corrupt room_state JSON is safely purged instead of throwing/reviving corrupt room
    db.prepare(`UPDATE room_state SET sim_json = '{bad-json' WHERE room_code = 'MIG12345'`).run();
    expect(persistence.loadRoom()).toBeNull();
    db.close();

    // 2. Durable Object Hibernation wake-up keeps existing authenticated WS + room state
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'سبات');
    const conn = await connectAndAuthWs(env, hostCreds);

    // Evict RaftRoom instance from memory and wake it up from SQLite + Hibernation attachments!
    const wokenInstance = namespace.simulateDormantWakeUp(hostCreds.roomCode);
    await flush();

    // Existing client socket sends room:toggleBots WITHOUT re-authenticating -> works seamlessly!
    conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'after-wake', type: 'room:toggleBots', payload: { fillBots: false } }));
    await flush();
    const afterWakeState = [...conn.msgs].reverse().find((m) => m.type === 'room:state' && m.requestId === 'after-wake');
    expect(afterWakeState?.type === 'room:state' && afterWakeState.payload?.snapshot.fillBots).toBe(false);
    expect(buildRoomSnapshot((wokenInstance as unknown as { room: RoomRecord }).room).roomCode).toBe(hostCreds.roomCode);
  });

  it('closes expired/abandoned rooms cleanly, notifies open sockets with ROOM_CLOSED, and purges storage', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'منتهي');
    const conn = await connectAndAuthWs(env, hostCreds);

    // Force room past expiresAt and invoke alarm()
    const doInstance = namespace.getEntryInstance(hostCreds.roomCode) as unknown as {
      room: RoomRecord | null;
      alarm: () => Promise<void>;
    };
    expect(doInstance.room).not.toBeNull();
    doInstance.room!.expiresAt = Date.now() - 1000;
    doInstance.room!.emptySinceMs = Date.now() - ROOM_EMPTY_CLOSE_MS - 1000;

    await doInstance.alarm();
    await flush();

    // Connected client received ROOM_CLOSED notice & closed socket; subsequent GET /api/v1/rooms/:code returns 404
    expect(conn.msgs.some((m) => m.type === 'room:error' && m.payload?.code === 'ROOM_CLOSED')).toBe(true);
    expect(conn.ws.readyState).toBe(3);

    // Calling alarm() again is safely idempotent
    await expect(doInstance.alarm()).resolves.toBeUndefined();

    const infoAfterClose = await routeWorkerRequest(new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}`), env);
    expect(infoAfterClose.status).toBe(404);
  });
});
