import type {
  BalanceAnalyticsResponse,
  CourseBalanceStats,
  CourseId,
  GameMode,
  RoundReplayRecord,
  RoundReplaySummary,
  VerifiedMatchRecord,
} from '../../../src/shared/types.ts';
import type { D1DatabaseLike } from '../env.ts';
import { opsMetrics } from '../services/metrics.ts';

const initializedDbs = new WeakSet<D1DatabaseLike>();

const D1_DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS d1_accounts_mirror (
    account_id TEXT PRIMARY KEY,
    username TEXT,
    display_name TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS d1_verified_matches (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_d1_matches_course_mode ON d1_verified_matches (course_id, game_mode, verified_at DESC)`,
  `CREATE TABLE IF NOT EXISTS d1_round_replays (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_d1_replays_created ON d1_round_replays (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS d1_course_balance_rollups (
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
  )`,
  `CREATE TABLE IF NOT EXISTS d1_ops_events (
    event_id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
];

const schemaInitPromises = new WeakMap<D1DatabaseLike, Promise<void>>();

export async function ensureD1Schema(db: D1DatabaseLike): Promise<void> {
  if (initializedDbs.has(db)) return;
  let pending = schemaInitPromises.get(db);
  if (!pending) {
    pending = db
      .batch(D1_DDL_STATEMENTS.map((sql) => db.prepare(sql)))
      .then(() => {
        initializedDbs.add(db);
      })
      .finally(() => {
        schemaInitPromises.delete(db);
      });
    schemaInitPromises.set(db, pending);
  }
  await pending;
}

/**
 * TECH-01 & TECH-02 & TECH-07:
 * Idempotently stores a verified match record in D1 and rolls it up into course/mode balance analytics.
 */
export async function recordVerifiedMatchInD1(
  db: D1DatabaseLike | undefined,
  record: VerifiedMatchRecord,
): Promise<{ inserted: boolean }> {
  const isNewInMemory = opsMetrics.recordVerifiedMatch(record);

  if (!db) {
    return { inserted: isNewInMemory };
  }

  await ensureD1Schema(db);

  // Atomically insert the verified match first; SQLite PRIMARY KEY on submission_key
  // guarantees that under concurrent duplicate requests only ONE call gets changes === 1.
  const insertRes = await db
    .prepare(
      `INSERT OR IGNORE INTO d1_verified_matches (
        submission_key, match_id, room_code, account_id, mode, course_id, game_mode,
        difficulty, outcome, elapsed_time_sec, falls, items_used, collision_count,
        treasure_score, survival_distance, min_raft_hp, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.submissionKey,
      record.matchId,
      record.roomCode,
      record.accountId,
      record.mode,
      record.courseId,
      record.gameMode,
      record.difficulty,
      record.outcome,
      record.elapsedTimeSec,
      record.falls,
      record.itemsUsed,
      record.collisionCount,
      record.treasureScore,
      record.survivalDistance,
      record.minRaftHp,
      record.verifiedAt,
    )
    .run();

  const changes = Number((insertRes as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  if (changes <= 0) {
    return { inserted: false };
  }

  const isWin = record.outcome === 'victory' ? 1 : 0;
  const clearTimeContribution = isWin ? record.elapsedTimeSec : 0;

  await db
    .prepare(
      `INSERT INTO d1_course_balance_rollups (
        course_id, game_mode, total_runs, wins, total_clear_time_sec,
        total_falls, total_collisions, total_items_used, last_updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id, game_mode) DO UPDATE SET
        total_runs = total_runs + 1,
        wins = wins + excluded.wins,
        total_clear_time_sec = total_clear_time_sec + excluded.total_clear_time_sec,
        total_falls = total_falls + excluded.total_falls,
        total_collisions = total_collisions + excluded.total_collisions,
        total_items_used = total_items_used + excluded.total_items_used,
        last_updated_at = excluded.last_updated_at`,
    )
    .bind(
      record.courseId,
      record.gameMode,
      isWin,
      clearTimeContribution,
      record.falls,
      record.collisionCount,
      record.itemsUsed,
      record.verifiedAt,
    )
    .run();

  return { inserted: true };
}

export async function saveRoundReplayInD1(
  db: D1DatabaseLike | undefined,
  replay: RoundReplayRecord,
): Promise<{ inserted: boolean }> {
  if (!db) {
    const inserted = opsMetrics.saveFallbackReplay(replay);
    return { inserted };
  }

  await ensureD1Schema(db);
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO d1_round_replays (
        match_id, room_code, mode, course_id, game_mode, difficulty, outcome,
        duration_sec, falls, treasure_score, survival_distance,
        frame_count, event_count, replay_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      replay.matchId,
      replay.roomCode,
      replay.mode,
      replay.courseId,
      replay.gameMode,
      replay.difficulty,
      replay.outcome,
      replay.durationSec,
      replay.falls,
      replay.treasureScore,
      replay.survivalDistance,
      replay.frames.length,
      replay.events.length,
      JSON.stringify(replay),
      replay.createdAt,
    )
    .run();

  const changes = Number((res as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  if (changes <= 0) {
    return { inserted: false };
  }
  opsMetrics.saveFallbackReplay(replay);
  return { inserted: true };
}

export async function listRoundReplaysFromD1(
  db: D1DatabaseLike | undefined,
  filter?: { courseId?: CourseId; gameMode?: GameMode; limit?: number },
): Promise<RoundReplaySummary[]> {
  if (!db) {
    return opsMetrics.listFallbackReplays(filter);
  }

  await ensureD1Schema(db);
  const limit = Math.max(1, Math.min(50, filter?.limit ?? 20));
  const clauses: string[] = [];
  const bindings: unknown[] = [];

  if (filter?.courseId) {
    clauses.push(`course_id = ?`);
    bindings.push(filter.courseId);
  }
  if (filter?.gameMode) {
    clauses.push(`game_mode = ?`);
    bindings.push(filter.gameMode);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db
    .prepare(
      `SELECT match_id, room_code, mode, course_id, game_mode, difficulty, outcome,
              duration_sec, falls, treasure_score, survival_distance,
              frame_count, event_count, created_at
       FROM d1_round_replays
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<{
      match_id: string;
      room_code: string | null;
      mode: 'solo' | 'online';
      course_id: CourseId;
      game_mode: GameMode;
      difficulty: 'easy' | 'normal' | 'hard';
      outcome: 'victory' | 'defeat';
      duration_sec: number;
      falls: number;
      treasure_score: number;
      survival_distance: number;
      frame_count: number;
      event_count: number;
      created_at: number;
    }>();

  return rows.results.map((r) => ({
    matchId: r.match_id,
    roomCode: r.room_code,
    mode: r.mode,
    courseId: r.course_id,
    gameMode: r.game_mode,
    difficulty: r.difficulty,
    outcome: r.outcome,
    durationSec: r.duration_sec,
    falls: r.falls,
    treasureScore: r.treasure_score,
    survivalDistance: r.survival_distance,
    frameCount: r.frame_count,
    eventCount: r.event_count,
    createdAt: r.created_at,
  }));
}

export async function getRoundReplayFromD1(
  db: D1DatabaseLike | undefined,
  matchId: string,
): Promise<RoundReplayRecord | null> {
  if (!db) {
    return opsMetrics.getFallbackReplay(matchId);
  }

  await ensureD1Schema(db);
  const row = await db
    .prepare(`SELECT replay_json FROM d1_round_replays WHERE match_id = ?`)
    .bind(matchId)
    .first<{ replay_json: string }>();

  if (!row) {
    return opsMetrics.getFallbackReplay(matchId);
  }
  try {
    return JSON.parse(row.replay_json) as RoundReplayRecord;
  } catch {
    return null;
  }
}

export async function getBalanceAnalyticsFromD1(
  db: D1DatabaseLike | undefined,
  filter?: { courseId?: CourseId; gameMode?: GameMode },
): Promise<BalanceAnalyticsResponse> {
  if (!db) {
    return opsMetrics.getFallbackAnalytics(filter);
  }

  await ensureD1Schema(db);
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (filter?.courseId) {
    clauses.push(`course_id = ?`);
    bindings.push(filter.courseId);
  }
  if (filter?.gameMode) {
    clauses.push(`game_mode = ?`);
    bindings.push(filter.gameMode);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const stmt = db.prepare(
    `SELECT course_id, game_mode, total_runs, wins, total_clear_time_sec,
            total_falls, total_collisions, total_items_used, last_updated_at
     FROM d1_course_balance_rollups
     ${where}
     ORDER BY total_runs DESC, last_updated_at DESC`,
  );
  const rows = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all<{
    course_id: CourseId;
    game_mode: GameMode;
    total_runs: number;
    wins: number;
    total_clear_time_sec: number;
    total_falls: number;
    total_collisions: number;
    total_items_used: number;
    last_updated_at: number;
  }>();

  const courses: CourseBalanceStats[] = rows.results.map((r) => {
    const runs = Math.max(1, r.total_runs);
    return {
      courseId: r.course_id,
      gameMode: r.game_mode,
      totalRuns: r.total_runs,
      wins: r.wins,
      winRatePct: Number(((r.wins / runs) * 100).toFixed(1)),
      avgClearTimeSec: r.wins > 0 ? Number((r.total_clear_time_sec / r.wins).toFixed(1)) : 0,
      avgFalls: Number((r.total_falls / runs).toFixed(2)),
      avgCollisionCount: Number((r.total_collisions / runs).toFixed(2)),
      avgItemsUsed: Number((r.total_items_used / runs).toFixed(2)),
      lastUpdatedAt: r.last_updated_at,
    };
  });

  const totalVerifiedMatches = courses.reduce((s, c) => s + c.totalRuns, 0);
  return {
    totalVerifiedMatches,
    courses,
    generatedAt: Date.now(),
  };
}

export async function getVerifiedMatchCountFromD1(
  db: D1DatabaseLike | undefined,
): Promise<number> {
  if (!db) return 0;
  await ensureD1Schema(db);
  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM d1_verified_matches`)
    .first<{ cnt: number }>();
  return Number(row?.cnt ?? 0);
}

export async function recordOpsEventInD1(
  db: D1DatabaseLike | undefined,
  category: string,
  severity: 'info' | 'warn' | 'error',
  detail: Record<string, unknown>,
  nowMs = Date.now(),
): Promise<void> {
  if (!db) return;
  try {
    await ensureD1Schema(db);
    await db
      .prepare(
        `INSERT INTO d1_ops_events (event_id, category, severity, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), category, severity, JSON.stringify(detail), nowMs)
      .run();
  } catch {
    // Non-fatal ops telemetry write
  }
}

export async function syncAccountMirrorInD1(
  db: D1DatabaseLike | undefined,
  account: {
    accountId: string;
    username?: string | null;
    displayName: string;
    level: number;
    xp: number;
    wins: number;
    updatedAt?: number;
  },
): Promise<void> {
  if (!db || !account.accountId) return;
  try {
    await ensureD1Schema(db);
    await db
      .prepare(
        `INSERT INTO d1_accounts_mirror (
          account_id, username, display_name, level, xp, wins, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
          username = excluded.username,
          display_name = excluded.display_name,
          level = excluded.level,
          xp = excluded.xp,
          wins = excluded.wins,
          updated_at = excluded.updated_at`,
      )
      .bind(
        account.accountId,
        account.username ?? null,
        account.displayName,
        account.level,
        account.xp,
        account.wins,
        account.updatedAt ?? Date.now(),
      )
      .run();
  } catch {
    // Non-fatal mirror sync
  }
}
