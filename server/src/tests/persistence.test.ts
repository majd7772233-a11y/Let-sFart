import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createInitialSimState } from '../../../src/shared/physics.ts';
import { createNodeSqlAdapter } from '../local/nodeDoRuntime.ts';
import { RoomPersistence } from '../rooms/persistence.ts';
import { initRoomSchema } from '../rooms/schema.ts';
import { SessionManager } from '../rooms/sessions.ts';
import { buildRoomSnapshot } from '../rooms/snapshots.ts';
import type { RoomRecord } from '../rooms/types.ts';

test('SQLite persistence stores hashed tokens, reloads room state cleanly, and strips secrets from snapshots', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = createNodeSqlAdapter(db);
  initRoomSchema(sql);
  const persistence = new RoomPersistence(sql);
  const sessions = new SessionManager();

  const issued = await sessions.createSession({
    roomCode: 'SQL12345',
    slot: 0,
    role: 'HOST',
    name: 'بطل',
    cosmetic: { hat: 'crown', glasses: 'shades', colorIndex: 2 },
  });

  const sim = createInitialSimState('online', 'بطل', issued.session.cosmetic);
  sim.phase = 'waiting';
  sim.players[0].id = issued.session.playerId;

  const room: RoomRecord = {
    roomCode: 'SQL12345',
    lifecycleState: 'WAITING',
    hostId: issued.session.playerId,
    fillBots: true,
    idempotencyKey: 'idem-sql-1',
    createdAt: 1000,
    expiresAt: 999_999_999_999,
    emptySinceMs: null,
    snapshotSeq: 1,
    accumulatorSec: 0,
    sim,
    recentEvents: [],
    sessions: new Map([[issued.session.playerId, issued.session]]),
  };

  persistence.saveAll(room);

  // Snapshot never leaks raw resumeToken or hash
  const snapJson = JSON.stringify(buildRoomSnapshot(room));
  assert.equal(snapJson.includes(issued.resumeToken), false);
  assert.equal(snapJson.includes(issued.session.resumeTokenHash), false);

  // Raw SQLite row stores SHA-256 hash, never plaintext resumeToken
  const rawRow = sql
    .exec<{ resume_token_hash: string }>(`SELECT resume_token_hash FROM room_players WHERE player_id = ?`, issued.session.playerId)
    .one();
  assert.equal(rawRow.resume_token_hash, issued.session.resumeTokenHash);
  assert.notEqual(rawRow.resume_token_hash, issued.resumeToken);

  // Cold reload restores room metadata and player session
  const reloaded = persistence.loadRoom();
  assert.ok(reloaded !== null);
  assert.equal(reloaded.roomCode, 'SQL12345');
  assert.equal(reloaded.hostId, issued.session.playerId);
  assert.equal(reloaded.sessions.size, 1);
  assert.equal(reloaded.sessions.get(issued.session.playerId)?.cosmetic.hat, 'crown');

  // Purge removes room & sessions cleanly
  persistence.purgeClosedRoom('SQL12345');
  assert.equal(persistence.loadRoom(), null);

  db.close();
});
