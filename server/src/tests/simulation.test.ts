import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSimState } from '../../../src/shared/physics.ts';
import { SessionRateLimiter } from '../lib/rateLimit.ts';
import { handleRoomClientMessage } from '../rooms/messages.ts';
import { RoomPersistence } from '../rooms/persistence.ts';
import { initRoomSchema } from '../rooms/schema.ts';
import { SessionManager } from '../rooms/sessions.ts';
import { prepareSimForStart, stepRoomSimulation } from '../rooms/simulation.ts';
import { createNodeSqlAdapter, LocalWebSocketPair } from '../local/nodeDoRuntime.ts';
import { DatabaseSync } from 'node:sqlite';
import type { RoomRecord, SocketBinding } from '../rooms/types.ts';
import { PROTOCOL_VERSION } from '../../../src/shared/protocol.ts';

test('server simulation accepts monotonic seq inputs only and steps shared physics cleanly', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = createNodeSqlAdapter(db);
  initRoomSchema(sql);
  const persistence = new RoomPersistence(sql);
  const sessions = new SessionManager();
  const rateLimiter = new SessionRateLimiter();

  const issued = await sessions.createSession({
    roomCode: 'SIM001',
    slot: 0,
    role: 'HOST',
    name: 'فرفوش',
    cosmetic: { hat: 'captain', glasses: 'none', colorIndex: 0 },
  });

  const sim = createInitialSimState('online', 'فرفوش', issued.session.cosmetic);
  sim.phase = 'waiting';
  sim.players[0].id = issued.session.playerId;

  const room: RoomRecord = {
    roomCode: 'SIM00001',
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
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    emptySinceMs: null,
    snapshotSeq: 1,
    accumulatorSec: 0,
    sim,
    recentEvents: [],
    sessions: new Map([[issued.session.playerId, issued.session]]),
  };

  issued.session.connected = true;
  sim.players[0].connected = true;
  prepareSimForStart(room);
  assert.equal(room.lifecycleState, 'PLAYING');

  const pair = new LocalWebSocketPair();
  const binding: SocketBinding = {
    ws: pair[1] as unknown as WebSocket,
    playerId: issued.session.playerId,
    sessionId: issued.session.sessionId,
    connectionEpoch: issued.session.connectionEpoch,
    authenticated: true,
  };

  const ctx = {
    room,
    binding,
    sessions,
    persistence,
    rateLimiter,
    sendToSocket: () => {},
    broadcastMsg: () => {},
    broadcastState: () => {},
    closeSocket: () => {},
    findSocketByPlayerId: () => null,
    onStartLoop: () => {},
  };

  // Send seq=5 -> accepted
  await handleRoomClientMessage(
    JSON.stringify({
      version: PROTOCOL_VERSION,
      type: 'input:state',
      payload: { moveDir: 1, farting: true, seq: 5 },
    }),
    ctx,
  );
  assert.equal(room.sim.players[0].farting, true);
  assert.equal(room.sim.players[0].moveDir, 1);

  // Send stale seq=3 trying to stop farting -> MUST be ignored!
  await handleRoomClientMessage(
    JSON.stringify({
      version: PROTOCOL_VERSION,
      type: 'input:state',
      payload: { moveDir: 0, farting: false, seq: 3 },
    }),
    ctx,
  );
  assert.equal(room.sim.players[0].farting, true);
  assert.equal(room.sim.players[0].moveDir, 1);

  for (let i = 0; i < 10; i++) {
    stepRoomSimulation(room, 0.033);
  }
  assert.ok(room.sim.raft.z < 0, 'raft advances forward via shared physics engine');

  db.close();
});
