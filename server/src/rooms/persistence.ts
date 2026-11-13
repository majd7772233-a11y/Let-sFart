import type {
  PlayerCosmetic,
  PlayerRole,
  RoomLifecycleState,
  SimEvent,
  WorldSimulationState,
} from '../../../src/shared/types.ts';
import {
  CURRENT_SCHEMA_VERSION,
  RECONNECT_GRACE_MS,
  type PlayerSessionRecord,
  type RoomRecord,
  type SqlStorageAdapter,
} from './types.ts';

interface RoomMetaRow {
  room_code: string;
  lifecycle_state: string;
  host_player_id: string;
  fill_bots: number;
  idempotency_key: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
  empty_since_ms: number | null;
  schema_version: number;
}

interface RoomStateRow {
  room_code: string;
  sim_json: string;
  recent_events_json?: string;
  snapshot_seq: number;
  last_event_seq: number;
  saved_at: number;
}

interface RoomPlayerRow {
  player_id: string;
  room_code: string;
  slot: number;
  role: string;
  name: string;
  cosmetic_json: string;
  resume_token_hash: string;
  session_id: string;
  connection_epoch: number;
  connected: number;
  ready: number;
  revoked: number;
  last_seen_at: number;
  seat_hold_until: number;
  expires_at: number;
}

interface RoomRequestRow {
  request_key: string;
  room_code: string;
  operation: string;
  result_json: string;
  expires_at: number;
}

const VALID_LIFECYCLE_STATES = new Set<RoomLifecycleState>([
  'CREATING',
  'WAITING',
  'PLAYING',
  'FALLING',
  'FINISHED',
  'RESTARTING',
  'CLOSED',
]);

function isValidRestoredSim(sim: unknown): sim is WorldSimulationState {
  if (!sim || typeof sim !== 'object') return false;
  const s = sim as Partial<WorldSimulationState>;
  if (!s.raft || typeof s.raft !== 'object') return false;
  if (!Number.isFinite(s.raft.x) || !Number.isFinite(s.raft.z) || !Number.isFinite(s.raft.yaw)) {
    return false;
  }
  if (!Array.isArray(s.players) || s.players.length !== 4) {
    return false;
  }
  for (let i = 0; i < 4; i++) {
    const p = s.players[i];
    if (!p || p.slot !== i || !Number.isFinite(p.localX)) return false;
  }
  if (typeof s.simTime !== 'number' || !Number.isFinite(s.simTime)) return false;
  return true;
}

const VALID_EVENT_TYPES = new Set<SimEvent['type']>([
  'collision',
  'bumper',
  'checkpoint',
  'fall',
  'finish',
  'fart_start',
  'fart_stop',
]);

function parseRestoredEvents(rawJson: string | undefined, fallbackSimEvents: unknown): SimEvent[] {
  let candidate: unknown = null;
  if (typeof rawJson === 'string' && rawJson.length > 0) {
    try {
      candidate = JSON.parse(rawJson);
    } catch {
      candidate = null;
    }
  }
  if (!Array.isArray(candidate) && Array.isArray(fallbackSimEvents)) {
    candidate = fallbackSimEvents;
  }
  if (!Array.isArray(candidate)) return [];

  const valid: SimEvent[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== 'object') continue;
    const ev = item as Partial<SimEvent>;
    if (
      typeof ev.id === 'number' &&
      Number.isInteger(ev.id) &&
      ev.id > 0 &&
      typeof ev.type === 'string' &&
      VALID_EVENT_TYPES.has(ev.type as SimEvent['type']) &&
      typeof ev.intensity === 'number' &&
      Number.isFinite(ev.intensity) &&
      typeof ev.x === 'number' &&
      Number.isFinite(ev.x) &&
      typeof ev.z === 'number' &&
      Number.isFinite(ev.z)
    ) {
      valid.push({
        id: ev.id,
        type: ev.type as SimEvent['type'],
        ...(typeof ev.slot === 'number' ? { slot: ev.slot } : {}),
        intensity: ev.intensity,
        x: ev.x,
        z: ev.z,
      });
    }
  }
  return valid.slice(-32);
}

export class RoomPersistence {
  private sql: SqlStorageAdapter;

  constructor(sql: SqlStorageAdapter) {
    this.sql = sql;
  }

  private runTransaction<T>(fn: () => T): T {
    if (this.sql.transactionSync) {
      return this.sql.transactionSync(fn);
    }
    return fn();
  }

  public loadRoom(): RoomRecord | null {
    const metaRows = this.sql
      .exec<RoomMetaRow>(
        `SELECT room_code, lifecycle_state, host_player_id, fill_bots, idempotency_key,
                created_at, updated_at, expires_at, empty_since_ms, schema_version
         FROM room_meta
         LIMIT 1`,
      )
      .toArray();

    if (metaRows.length === 0) {
      return null;
    }

    const row = metaRows[0];
    if (!VALID_LIFECYCLE_STATES.has(row.lifecycle_state as RoomLifecycleState)) {
      this.purgeClosedRoom(row.room_code);
      return null;
    }

    const stateRows = this.sql
      .exec<RoomStateRow>(
        `SELECT room_code, sim_json, recent_events_json, snapshot_seq, last_event_seq, saved_at
         FROM room_state
         WHERE room_code = ?
         LIMIT 1`,
        row.room_code,
      )
      .toArray();

    if (stateRows.length === 0) {
      // Incomplete persisted state -> purge safely rather than booting a corrupted room
      this.purgeClosedRoom(row.room_code);
      return null;
    }

    let sim: WorldSimulationState;
    try {
      const parsed = JSON.parse(stateRows[0].sim_json);
      if (!isValidRestoredSim(parsed)) {
        this.purgeClosedRoom(row.room_code);
        return null;
      }
      sim = parsed;
    } catch {
      this.purgeClosedRoom(row.room_code);
      return null;
    }

    const playerRows = this.sql
      .exec<RoomPlayerRow>(
        `SELECT player_id, room_code, slot, role, name, cosmetic_json, resume_token_hash,
                session_id, connection_epoch, connected, ready, revoked, last_seen_at,
                seat_hold_until, expires_at
         FROM room_players
         WHERE room_code = ?`,
        row.room_code,
      )
      .toArray();

    const sessions = new Map<string, PlayerSessionRecord>();
    for (const sr of playerRows) {
      if (sr.slot < 0 || sr.slot > 3) continue;
      let cosmetic: PlayerCosmetic;
      try {
        cosmetic = JSON.parse(sr.cosmetic_json) as PlayerCosmetic;
      } catch {
        continue;
      }

      const slot = sr.slot as 0 | 1 | 2 | 3;
      const session: PlayerSessionRecord = {
        playerId: sr.player_id,
        roomCode: sr.room_code,
        slot,
        role: sr.role === 'HOST' ? 'HOST' : 'PLAYER',
        name: sr.name,
        cosmetic,
        resumeTokenHash: sr.resume_token_hash,
        sessionId: sr.session_id,
        connectionEpoch: sr.connection_epoch,
        // Initially mark false; DO Hibernation constructor restores live attached sockets right after loadRoom()
        connected: false,
        ready: Boolean(sr.ready),
        revoked: Boolean(sr.revoked),
        lastSeenAt: sr.last_seen_at,
        expiresAt: sr.expires_at,
        lastInputSeq: 0,
      };
      sessions.set(session.playerId, session);

      if (sim.players[slot] && !session.revoked) {
        sim.players[slot].connected = false;
        sim.players[slot].farting = false;
        sim.players[slot].moveDir = 0;
        sim.players[slot].ready = session.ready;
      }
    }

    const recentEvents = parseRestoredEvents(stateRows[0].recent_events_json, sim.events);
    const maxRestoredEventId = recentEvents.reduce((max, ev) => (ev.id > max ? ev.id : max), 0);
    sim.eventSeq = Math.max(
      typeof sim.eventSeq === 'number' && Number.isFinite(sim.eventSeq) ? sim.eventSeq : 0,
      stateRows[0].last_event_seq || 0,
      maxRestoredEventId,
    );

    return {
      roomCode: row.room_code,
      lifecycleState: row.lifecycle_state as RoomLifecycleState,
      hostId: row.host_player_id,
      fillBots: Boolean(row.fill_bots),
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      emptySinceMs: row.empty_since_ms,
      snapshotSeq: Math.max(1, stateRows[0].snapshot_seq || 1),
      accumulatorSec: 0,
      lastPersistedAtMs: stateRows[0].saved_at,
      sim,
      recentEvents,
      sessions,
    };
  }

  public saveRoomMeta(room: RoomRecord, nowMs = Date.now()): void {
    room.updatedAt = nowMs;
    this.sql.exec(
      `INSERT INTO room_meta (
        room_code, lifecycle_state, host_player_id, fill_bots, idempotency_key,
        created_at, updated_at, expires_at, empty_since_ms, schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_code) DO UPDATE SET
        lifecycle_state = excluded.lifecycle_state,
        host_player_id = excluded.host_player_id,
        fill_bots = excluded.fill_bots,
        idempotency_key = excluded.idempotency_key,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        empty_since_ms = excluded.empty_since_ms,
        schema_version = excluded.schema_version`,
      room.roomCode,
      room.lifecycleState,
      room.hostId,
      room.fillBots ? 1 : 0,
      room.idempotencyKey,
      room.createdAt,
      nowMs,
      room.expiresAt,
      room.emptySinceMs,
      CURRENT_SCHEMA_VERSION,
    );
  }

  public saveSimState(room: RoomRecord, nowMs = Date.now()): void {
    room.lastPersistedAtMs = nowMs;
    const boundedEvents = room.recentEvents.slice(-32);
    this.sql.exec(
      `INSERT INTO room_state (
        room_code, sim_json, recent_events_json, snapshot_seq, last_event_seq, saved_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_code) DO UPDATE SET
        sim_json = excluded.sim_json,
        recent_events_json = excluded.recent_events_json,
        snapshot_seq = excluded.snapshot_seq,
        last_event_seq = excluded.last_event_seq,
        saved_at = excluded.saved_at`,
      room.roomCode,
      JSON.stringify(room.sim),
      JSON.stringify(boundedEvents),
      room.snapshotSeq,
      room.sim.eventSeq,
      nowMs,
    );
  }

  public saveSession(session: PlayerSessionRecord): void {
    const seatHoldUntil = session.lastSeenAt + RECONNECT_GRACE_MS;
    this.sql.exec(
      `INSERT INTO room_players (
        player_id, room_code, slot, role, name, cosmetic_json, resume_token_hash,
        session_id, connection_epoch, connected, ready, revoked, last_seen_at, seat_hold_until, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        room_code = excluded.room_code,
        slot = excluded.slot,
        role = excluded.role,
        name = excluded.name,
        cosmetic_json = excluded.cosmetic_json,
        resume_token_hash = excluded.resume_token_hash,
        session_id = excluded.session_id,
        connection_epoch = excluded.connection_epoch,
        connected = excluded.connected,
        ready = excluded.ready,
        revoked = excluded.revoked,
        last_seen_at = excluded.last_seen_at,
        seat_hold_until = excluded.seat_hold_until,
        expires_at = excluded.expires_at`,
      session.playerId,
      session.roomCode,
      session.slot,
      session.role as PlayerRole,
      session.name,
      JSON.stringify(session.cosmetic),
      session.resumeTokenHash,
      session.sessionId,
      session.connectionEpoch,
      session.connected ? 1 : 0,
      session.ready ? 1 : 0,
      session.revoked ? 1 : 0,
      session.lastSeenAt,
      seatHoldUntil,
      session.expiresAt,
    );
  }

  public deleteSession(playerId: string): void {
    this.sql.exec(`DELETE FROM room_players WHERE player_id = ?`, playerId);
  }

  public saveAll(room: RoomRecord, nowMs = Date.now()): void {
    this.runTransaction(() => {
      this.saveRoomMeta(room, nowMs);
      this.saveSimState(room, nowMs);
      for (const session of room.sessions.values()) {
        this.saveSession(session);
      }
    });
  }

  public getRequestRecord<T = unknown>(requestKey: string, nowMs = Date.now()): T | null {
    const rows = this.sql
      .exec<RoomRequestRow>(
        `SELECT request_key, room_code, operation, result_json, expires_at
         FROM room_requests
         WHERE request_key = ?
         LIMIT 1`,
        requestKey,
      )
      .toArray();
    if (rows.length === 0) return null;
    if (nowMs >= rows[0].expires_at) {
      this.sql.exec(`DELETE FROM room_requests WHERE request_key = ?`, requestKey);
      return null;
    }
    try {
      return JSON.parse(rows[0].result_json) as T;
    } catch {
      return null;
    }
  }

  public saveRequestRecord(
    requestKey: string,
    roomCode: string,
    operation: string,
    result: unknown,
    ttlMs = 60_000,
    nowMs = Date.now(),
  ): void {
    this.sql.exec(
      `INSERT INTO room_requests (request_key, room_code, operation, result_json, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(request_key) DO UPDATE SET
         result_json = excluded.result_json,
         expires_at = excluded.expires_at`,
      requestKey,
      roomCode,
      operation,
      JSON.stringify(result),
      nowMs + ttlMs,
    );
  }

  public pruneExpiredRequests(nowMs = Date.now()): void {
    this.sql.exec(`DELETE FROM room_requests WHERE expires_at <= ?`, nowMs);
  }

  public purgeClosedRoom(roomCode: string): void {
    this.runTransaction(() => {
      this.sql.exec(`DELETE FROM room_players WHERE room_code = ?`, roomCode);
      this.sql.exec(`DELETE FROM room_state WHERE room_code = ?`, roomCode);
      this.sql.exec(`DELETE FROM room_requests WHERE room_code = ?`, roomCode);
      this.sql.exec(`DELETE FROM room_meta WHERE room_code = ?`, roomCode);
    });
  }
}
