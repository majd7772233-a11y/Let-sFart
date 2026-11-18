import { CURRENT_SCHEMA_VERSION, type SqlStorageAdapter } from './types.ts';

interface PragmaColumnRow {
  name: string;
}

interface TableExistsRow {
  name: string;
}

const V5_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS room_schema_info (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS room_meta (
    room_code TEXT PRIMARY KEY,
    lifecycle_state TEXT NOT NULL,
    host_player_id TEXT NOT NULL,
    fill_bots INTEGER NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    course_id TEXT NOT NULL DEFAULT 'tropical',
    course_selection_mode TEXT NOT NULL DEFAULT 'host',
    course_votes_json TEXT NOT NULL DEFAULT '{}',
    playlist_json TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    empty_since_ms INTEGER,
    round_seq INTEGER NOT NULL DEFAULT 1,
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
    joined_at INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER NOT NULL,
    seat_hold_until INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    account_id TEXT,
    player_level INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_room_players_slot ON room_players (room_code, slot)`,
  `CREATE TABLE IF NOT EXISTS room_state (
    room_code TEXT PRIMARY KEY,
    sim_json TEXT NOT NULL,
    recent_events_json TEXT NOT NULL DEFAULT '[]',
    recent_chat_json TEXT NOT NULL DEFAULT '[]',
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
  `CREATE TABLE IF NOT EXISTS public_rooms (
    room_code TEXT PRIMARY KEY,
    listing_json TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    player_count INTEGER NOT NULL,
    max_players INTEGER NOT NULL,
    game_mode TEXT NOT NULL,
    course_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS party_meta (
    party_code TEXT PRIMARY KEY,
    leader_member_id TEXT NOT NULL,
    active_room_code TEXT,
    active_room_password TEXT,
    room_follow_seq INTEGER NOT NULL DEFAULT 0,
    recent_chat_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS party_members (
    member_id TEXT PRIMARY KEY,
    party_code TEXT NOT NULL,
    name TEXT NOT NULL,
    cosmetic_json TEXT NOT NULL,
    resume_token_hash TEXT NOT NULL,
    session_id TEXT NOT NULL,
    connection_epoch INTEGER NOT NULL,
    connected INTEGER NOT NULL,
    revoked INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
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
  if (hasTable(sql, 'room_meta')) {
    const cols = getColumnNames(sql, 'room_meta');
    if (!cols.has('schema_version') && cols.has('sim_json')) {
      sql.exec(`ALTER TABLE room_meta RENAME TO room_meta_v1`);
      for (const stmt of V5_SCHEMA_STATEMENTS) {
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

  for (const stmt of V5_SCHEMA_STATEMENTS) {
    sql.exec(stmt);
  }

  if (hasTable(sql, 'room_meta')) {
    const metaCols = getColumnNames(sql, 'room_meta');
    if (!metaCols.has('is_private')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0`);
    }
    if (!metaCols.has('password_hash')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN password_hash TEXT`);
    }
    if (!metaCols.has('settings_json')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!metaCols.has('course_id')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN course_id TEXT NOT NULL DEFAULT 'tropical'`);
    }
    if (!metaCols.has('course_selection_mode')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN course_selection_mode TEXT NOT NULL DEFAULT 'host'`);
    }
    if (!metaCols.has('course_votes_json')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN course_votes_json TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!metaCols.has('playlist_json')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN playlist_json TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!metaCols.has('round_seq')) {
      sql.exec(`ALTER TABLE room_meta ADD COLUMN round_seq INTEGER NOT NULL DEFAULT 1`);
    }
  }

  if (hasTable(sql, 'room_players')) {
    const playerCols = getColumnNames(sql, 'room_players');
    if (!playerCols.has('joined_at')) {
      sql.exec(`ALTER TABLE room_players ADD COLUMN joined_at INTEGER NOT NULL DEFAULT 0`);
    }
    if (!playerCols.has('account_id')) {
      sql.exec(`ALTER TABLE room_players ADD COLUMN account_id TEXT`);
    }
    if (!playerCols.has('player_level')) {
      sql.exec(`ALTER TABLE room_players ADD COLUMN player_level INTEGER NOT NULL DEFAULT 1`);
    }
    // Upgrade partial unique index to allow multiple spectators (slot = -1) while keeping active seated slots strictly unique
    sql.exec(`DROP INDEX IF EXISTS uidx_room_players_active_slot`);
    sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS uidx_room_players_active_slot
       ON room_players (room_code, slot)
       WHERE revoked = 0 AND slot >= 0`,
    );
  }

  if (hasTable(sql, 'room_state')) {
    const stateCols = getColumnNames(sql, 'room_state');
    if (!stateCols.has('recent_events_json')) {
      sql.exec(`ALTER TABLE room_state ADD COLUMN recent_events_json TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!stateCols.has('recent_chat_json')) {
      sql.exec(`ALTER TABLE room_state ADD COLUMN recent_chat_json TEXT NOT NULL DEFAULT '[]'`);
    }
  }

  if (hasTable(sql, 'room_sessions')) {
    sql.exec(
      `INSERT OR IGNORE INTO room_players (
        player_id, room_code, slot, role, name, cosmetic_json, resume_token_hash,
        session_id, connection_epoch, connected, ready, revoked, joined_at, last_seen_at, seat_hold_until, expires_at
      ) SELECT player_id, room_code, slot, role, name, cosmetic_json, resume_token_hash,
               session_id, connection_epoch, connected, ready, revoked, last_seen_at, last_seen_at, last_seen_at + 15000, expires_at
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
