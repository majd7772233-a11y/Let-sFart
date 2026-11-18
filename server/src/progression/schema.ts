import type { SqlStorageAdapter } from '../rooms/types.ts';
import type { AchievementId, CourseId, PlayerCosmetic } from '../../../src/shared/types.ts';
import { getIsoWeekKey } from '../../../src/shared/progression.ts';

const PROGRESSION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS prog_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    is_guest INTEGER NOT NULL DEFAULT 1,
    username TEXT,
    username_lower TEXT UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    cosmetic_json TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    challenge_points INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0,
    is_seed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions (account_id)`,
  `CREATE TABLE IF NOT EXISTS account_stats (
    account_id TEXT PRIMARY KEY,
    rounds_played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    total_falls INTEGER NOT NULL DEFAULT 0,
    best_time_sec REAL,
    items_used INTEGER NOT NULL DEFAULT 0,
    total_push REAL NOT NULL DEFAULT 0,
    total_fart_time REAL NOT NULL DEFAULT 0,
    total_score INTEGER NOT NULL DEFAULT 0,
    best_survival_dist INTEGER NOT NULL DEFAULT 0,
    best_treasure_score INTEGER NOT NULL DEFAULT 0,
    hard_gates_passed INTEGER NOT NULL DEFAULT 0,
    harmony_combos INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_course_bests (
    account_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    best_time_sec REAL,
    best_survival_dist INTEGER NOT NULL DEFAULT 0,
    best_treasure_score INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    plays INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, course_id)
  )`,
  `CREATE TABLE IF NOT EXISTS account_achievements (
    account_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    points INTEGER NOT NULL,
    PRIMARY KEY (account_id, achievement_id)
  )`,
  `CREATE TABLE IF NOT EXISTS weekly_stats (
    week_key TEXT NOT NULL,
    account_id TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    rounds_played INTEGER NOT NULL DEFAULT 0,
    best_time_sec REAL,
    challenge_points INTEGER NOT NULL DEFAULT 0,
    total_push REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (week_key, account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS account_friends (
    account_id TEXT NOT NULL,
    friend_account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, friend_account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS match_submissions (
    submission_key TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    reward_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_inventory (
    account_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (account_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS account_quests (
    account_id TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    cadence TEXT NOT NULL,
    period_key TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    goal INTEGER NOT NULL,
    completed_at INTEGER,
    claimed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, quest_id)
  )`,
  `CREATE TABLE IF NOT EXISTS account_season_progress (
    account_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    season_points INTEGER NOT NULL DEFAULT 0,
    claimed_tiers_json TEXT NOT NULL DEFAULT '[]',
    challenges_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, season_id)
  )`,
  `CREATE TABLE IF NOT EXISTS account_rare_events (
    account_id TEXT PRIMARY KEY,
    active INTEGER NOT NULL DEFAULT 0,
    event_instance_id TEXT,
    event_type_id TEXT,
    rounds_remaining INTEGER NOT NULL DEFAULT 0,
    rounds_completed INTEGER NOT NULL DEFAULT 0,
    bonus_goal_rounds INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    rounds_since_last_event INTEGER NOT NULL DEFAULT 0,
    occurrences_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
] as const;

interface SeedPioneer {
  accountId: string;
  username: string;
  displayName: string;
  cosmetic: PlayerCosmetic;
  xp: number;
  level: number;
  wins: number;
  roundsPlayed: number;
  falls: number;
  bestTimeSec: number;
  courseId: CourseId;
  itemsUsed: number;
  totalPush: number;
  achievements: { id: AchievementId; points: number }[];
}

const STARTER_PIONEERS: readonly SeedPioneer[] = [
  {
    accountId: 'seed-captain-zawbaa',
    username: 'zawbaa',
    displayName: 'القبطان زوبعة',
    cosmetic: { hat: 'crown', glasses: 'shades', colorIndex: 2 },
    xp: 1240,
    level: 6,
    wins: 14,
    roundsPlayed: 18,
    falls: 7,
    bestTimeSec: 64.2,
    courseId: 'tropical',
    itemsUsed: 24,
    totalPush: 4820,
    achievements: [
      { id: 'first_voyage', points: 20 },
      { id: 'speed_demon', points: 50 },
      { id: 'untouchable', points: 45 },
      { id: 'win_streak_5', points: 40 },
      { id: 'engine_of_crew', points: 50 },
      { id: 'item_collector', points: 35 },
    ],
  },
  {
    accountId: 'seed-captain-sharar',
    username: 'sharar',
    displayName: 'الربّان شرار',
    cosmetic: { hat: 'captain', glasses: 'shades', colorIndex: 0 },
    xp: 890,
    level: 5,
    wins: 9,
    roundsPlayed: 13,
    falls: 11,
    bestTimeSec: 71.8,
    courseId: 'volcanic',
    itemsUsed: 16,
    totalPush: 3340,
    achievements: [
      { id: 'first_voyage', points: 20 },
      { id: 'speed_demon', points: 50 },
      { id: 'win_streak_5', points: 40 },
      { id: 'engine_of_crew', points: 50 },
    ],
  },
  {
    accountId: 'seed-coral-star',
    username: 'coral_star',
    displayName: 'نجمة المرجان',
    cosmetic: { hat: 'propeller', glasses: 'nerd', colorIndex: 3 },
    xp: 560,
    level: 4,
    wins: 6,
    roundsPlayed: 9,
    falls: 5,
    bestTimeSec: 79.4,
    courseId: 'glacial',
    itemsUsed: 12,
    totalPush: 2150,
    achievements: [
      { id: 'first_voyage', points: 20 },
      { id: 'untouchable', points: 45 },
      { id: 'win_streak_5', points: 40 },
      { id: 'harmony_conductor', points: 30 },
    ],
  },
  {
    accountId: 'seed-storm-sailor',
    username: 'raed_wave',
    displayName: 'رائد الأمواج',
    cosmetic: { hat: 'captain', glasses: 'none', colorIndex: 1 },
    xp: 310,
    level: 3,
    wins: 3,
    roundsPlayed: 5,
    falls: 4,
    bestTimeSec: 88.6,
    courseId: 'storm',
    itemsUsed: 7,
    totalPush: 1180,
    achievements: [
      { id: 'first_voyage', points: 20 },
      { id: 'hard_gate_master', points: 60 },
    ],
  },
];

export function initProgressionSchema(sql: SqlStorageAdapter, nowMs = Date.now()): void {
  for (const stmt of PROGRESSION_SCHEMA_STATEMENTS) {
    sql.exec(stmt);
  }

  // Safely migrate pre-existing accounts tables lacking coins column
  const accountCols = sql.exec<{ name: string }>(`PRAGMA table_info(accounts)`).toArray();
  if (!accountCols.some((c) => c.name === 'coins')) {
    sql.exec(`ALTER TABLE accounts ADD COLUMN coins INTEGER NOT NULL DEFAULT 0`);
  }

  const seeded = sql.exec<{ value: string }>(`SELECT value FROM prog_meta WHERE key = 'seeded_v1'`).toArray();
  if (seeded.length === 0) {
    const weekKey = getIsoWeekKey(nowMs);
    for (const p of STARTER_PIONEERS) {
      const challengePoints = p.achievements.reduce((s, a) => s + a.points, 0);
      sql.exec(
        `INSERT OR IGNORE INTO accounts (
          account_id, is_guest, username, username_lower, display_name, password_hash,
          cosmetic_json, xp, level, challenge_points, is_seed, created_at, updated_at
        ) VALUES (?, 0, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?)`,
        p.accountId,
        p.username,
        p.username.toLowerCase(),
        p.displayName,
        JSON.stringify(p.cosmetic),
        p.xp,
        p.level,
        challengePoints,
        nowMs - 86_400_000,
        nowMs,
      );
      sql.exec(
        `INSERT OR IGNORE INTO account_stats (
          account_id, rounds_played, wins, losses, total_falls, best_time_sec,
          items_used, total_push, total_fart_time, total_score, best_survival_dist,
          best_treasure_score, hard_gates_passed, harmony_combos, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 180, 110, 6, 2, ?)`,
        p.accountId,
        p.roundsPlayed,
        p.wins,
        Math.max(0, p.roundsPlayed - p.wins),
        p.falls,
        p.bestTimeSec,
        p.itemsUsed,
        p.totalPush,
        Math.round(p.totalPush / 18),
        p.wins * 120,
        nowMs,
      );
      sql.exec(
        `INSERT OR IGNORE INTO account_course_bests (
          account_id, course_id, best_time_sec, best_survival_dist, best_treasure_score, wins, plays
        ) VALUES (?, ?, ?, 180, 110, ?, ?)`,
        p.accountId,
        p.courseId,
        p.bestTimeSec,
        p.wins,
        p.roundsPlayed,
      );
      for (const a of p.achievements) {
        sql.exec(
          `INSERT OR IGNORE INTO account_achievements (account_id, achievement_id, unlocked_at, points)
           VALUES (?, ?, ?, ?)`,
          p.accountId,
          a.id,
          nowMs - 43_200_000,
          a.points,
        );
      }
      sql.exec(
        `INSERT OR IGNORE INTO weekly_stats (
          week_key, account_id, wins, rounds_played, best_time_sec, challenge_points, total_push, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        weekKey,
        p.accountId,
        Math.max(1, Math.floor(p.wins / 2)),
        Math.max(2, Math.floor(p.roundsPlayed / 2)),
        p.bestTimeSec,
        challengePoints,
        Math.round(p.totalPush / 2),
        nowMs,
      );
    }

    sql.exec(
      `INSERT INTO prog_meta (key, value) VALUES ('seeded_v1', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    );
  }
}
