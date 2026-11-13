import { CURRENT_SCHEMA_VERSION, type SqlStorageAdapter } from './types.ts';

interface PragmaColumnRow {
  name: string;
}

interface TableExistsRow {
  name: string;
}

const V2_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS room_schema_info (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS room_meta (
    room_code TEXT PRIMARY KEY,
    lifecycle_state TEXT NOT NULL,
    host_player_id TEXT NOT NULL,
    fill_bots INTEGER NOT NULL,
    idempotency_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    empty_since_ms INTEGER,
    schema_version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS room_players (
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
    seat_hold_until INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_room_players_slot ON room_players (room_code, slot)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uidx_room_players_active_slot ON room_players (room_code, slot) WHERE revoked = 0`,
  `CREATE TABLE IF NOT EXISTS room_state (
    room_code TEXT PRIMARY KEY,
    sim_json TEXT NOT NULL,
    recent_events_json TEXT NOT NULL DEFAULT '[]',
    snapshot_seq INTEGER NOT NULL,
    last_event_seq INTEGER NOT NULL,
    saved_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS room_requests (
    request_key TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    operation TEXT NOT NULL,
    result_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
] as const;

function hasTable(sql: SqlStorageAdapter, name: string): boolean {
  const rows = sql
    .exec<TableExistsRow>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, name)
    .toArray();
  return rows.length > 0;
}

function getColumnNames(sql: SqlStorageAdapter, tableName: string): Set<string> {
  const rows = sql.exec<PragmaColumnRow>(`PRAGMA table_info(${tableName})`).toArray();
  return new Set(rows.map((r) => r.name));
}

export function initRoomSchema(sql: SqlStorageAdapter): void {
  // Migrate v1 room_meta + room_sessions tables safely if an existing DO SQLite file wakes up
  if (hasTable(sql, 'room_meta')) {
    const cols = getColumnNames(sql, 'room_meta');
    if (!cols.has('schema_version') && cols.has('sim_json')) {
      // Legacy v1 layout detected: preserve data into v2 tables
      sql.exec(`ALTER TABLE room_meta RENAME TO room_meta_v1`);
      for (const stmt of V2_SCHEMA_STATEMENTS) {
        sql.exec(stmt);
      }
      sql.exec(
        `INSERT OR IGNORE INTO room_meta (
          room_code, lifecycle_state, host_player_id, fill_bots, idempotency_key,
          created_at, updated_at, expires_at, empty_since_ms, schema_version
        ) SELECT room_code, lifecycle_state, host_player_id, fill_bots, idempotency_key,
                 created_at, created_at, expires_at, empty_since_ms, ?
          FROM room_meta_v1`,
        CURRENT_SCHEMA_VERSION,
      );
      sql.exec(
        `INSERT OR IGNORE INTO room_state (
          room_code, sim_json, snapshot_seq, last_event_seq, saved_at
        ) SELECT room_code, sim_json, 1, 0, created_at FROM room_meta_v1`,
      );
      sql.exec(`DROP TABLE IF EXISTS room_meta_v1`);
    }
  }

  for (const stmt of V2_SCHEMA_STATEMENTS) {
    sql.exec(stmt);
  }

  if (hasTable(sql, 'room_state')) {
    const stateCols = getColumnNames(sql, 'room_state');
    if (!stateCols.has('recent_events_json')) {
      sql.exec(`ALTER TABLE room_state ADD COLUMN recent_events_json TEXT NOT NULL DEFAULT '[]'`);
    }
  }

  if (hasTable(sql, 'room_sessions')) {
    sql.exec(
      `INSERT OR IGNORE INTO room_players (
        player_id, room_code, slot, role, name, cosmetic_json, resume_token_hash,
        session_id, connection_epoch, connected, ready, revoked, last_seen_at, seat_hold_until, expires_at
      ) SELECT player_id, room_code, slot, role, name, cosmetic_json, resume_token_hash,
               session_id, connection_epoch, connected, ready, revoked, last_seen_at, last_seen_at + 15000, expires_at
        FROM room_sessions`,
    );
    sql.exec(`DROP TABLE IF EXISTS room_sessions`);
  }

  sql.exec(
    `INSERT INTO room_schema_info (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    String(CURRENT_SCHEMA_VERSION),
  );
}
