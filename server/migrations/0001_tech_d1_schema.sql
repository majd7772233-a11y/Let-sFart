-- TECH-02 & TECH-04 & TECH-07: Cloudflare D1 persistent relational schema

CREATE TABLE IF NOT EXISTS d1_accounts_mirror (
  account_id TEXT PRIMARY KEY,
  username TEXT,
  display_name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS d1_verified_matches (
  submission_key TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  room_code TEXT,
  account_id TEXT,
  mode TEXT NOT NULL,
  course_id TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  outcome TEXT NOT NULL,
  elapsed_time_sec REAL NOT NULL,
  falls INTEGER NOT NULL DEFAULT 0,
  items_used INTEGER NOT NULL DEFAULT 0,
  collision_count INTEGER NOT NULL DEFAULT 0,
  treasure_score INTEGER NOT NULL DEFAULT 0,
  survival_distance REAL NOT NULL DEFAULT 0,
  min_raft_hp INTEGER NOT NULL DEFAULT 100,
  verified_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_d1_matches_course_mode
  ON d1_verified_matches (course_id, game_mode, verified_at DESC);

CREATE TABLE IF NOT EXISTS d1_round_replays (
  match_id TEXT PRIMARY KEY,
  room_code TEXT,
  mode TEXT NOT NULL,
  course_id TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  outcome TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  falls INTEGER NOT NULL DEFAULT 0,
  treasure_score INTEGER NOT NULL DEFAULT 0,
  survival_distance REAL NOT NULL DEFAULT 0,
  frame_count INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  replay_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_d1_replays_created
  ON d1_round_replays (created_at DESC);

CREATE TABLE IF NOT EXISTS d1_course_balance_rollups (
  course_id TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  total_runs INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  total_clear_time_sec REAL NOT NULL DEFAULT 0,
  total_falls INTEGER NOT NULL DEFAULT 0,
  total_collisions INTEGER NOT NULL DEFAULT 0,
  total_items_used INTEGER NOT NULL DEFAULT 0,
  last_updated_at INTEGER NOT NULL,
  PRIMARY KEY (course_id, game_mode)
);

CREATE TABLE IF NOT EXISTS d1_ops_events (
  event_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
