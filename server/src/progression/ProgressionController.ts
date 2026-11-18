import { isValidCourseId } from '../../../src/shared/course.ts';
import {
  COSMETIC_ITEM_MAP,
  applyShopItemToCosmetic,
  cosmeticToItemIds,
  getDefaultOwnedItemIds,
  isCosmeticFullyOwned,
  normalizePlayerCosmetic,
} from '../../../src/shared/cosmetics.ts';
import { isValidDifficulty, isValidGameMode } from '../../../src/shared/physics.ts';
import { verifyMatchResult } from '../services/resultVerifier.ts';
import {
  ACHIEVEMENT_MAP,
  ACTIVE_SEASON_DEF,
  ALL_COURSE_IDS,
  RARE_EVENT_POOL,
  calculateCoinsForRound,
  calculateSeasonPointsForRound,
  calculateXpForRound,
  computeChallengePoints,
  computeLevelFromXp,
  createEmptyCourseBests,
  createIdleRareEventState,
  evaluateNewAchievements,
  evaluateRareEventTrigger,
  generateDailyQuests,
  generateWeeklyQuests,
  getAchievementCoinReward,
  getIsoWeekKey,
  getQuestDeltaForMatch,
  getSeasonChallengeDelta,
  getUtcDayKey,
  sanitizeDisplayName,
  validatePassword,
  validateUsername,
} from '../../../src/shared/progression.ts';
import type {
  AuthHttpResponse,
  BatchOnlineMatchParticipant,
  BuyCosmeticHttpRequest,
  BuyCosmeticHttpResponse,
  ClaimQuestHttpResponse,
  ClaimSeasonTierHttpResponse,
  EquipCosmeticHttpRequest,
  LeaderboardHttpResponse,
  ProfileSnapshotPayload,
  RecordMatchHttpResponse,
} from '../../../src/shared/protocol.ts';
import type {
  AccountProfile,
  AchievementDef,
  AchievementId,
  CourseBestRecord,
  CourseId,
  FriendSummary,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardScope,
  MatchSummaryInput,
  PlayerCareerStats,
  PlayerCosmetic,
  QuestCadence,
  QuestState,
  RareEventState,
  SeasonChallengeState,
  SeasonProgressState,
  SeasonRewardTierState,
  UnlockedAchievement,
} from '../../../src/shared/types.ts';
import { hashPassword, verifyPassword } from '../lib/passwords.ts';
import { generateResumeToken, hashToken } from '../lib/tokens.ts';
import { sanitizeCosmeticOrDefault, validateCosmetic } from '../lib/validation.ts';
import { ERROR_MESSAGES_AR, makeErrorPayload, ProtocolError } from '../protocol/errors.ts';
import type { SqlStorageAdapter } from '../rooms/types.ts';
import { initProgressionSchema } from './schema.ts';

const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface AccountRow {
  account_id: string;
  is_guest: number;
  username: string | null;
  username_lower: string | null;
  display_name: string;
  password_hash: string | null;
  cosmetic_json: string;
  xp: number;
  level: number;
  challenge_points: number;
  coins: number;
  is_seed: number;
  created_at: number;
  updated_at: number;
}

interface StatsRow {
  account_id: string;
  rounds_played: number;
  wins: number;
  losses: number;
  total_falls: number;
  best_time_sec: number | null;
  items_used: number;
  total_push: number;
  total_fart_time: number;
  total_score: number;
  best_survival_dist: number;
  best_treasure_score: number;
  hard_gates_passed: number;
  harmony_combos: number;
}

interface CourseBestRow {
  account_id: string;
  course_id: string;
  best_time_sec: number | null;
  best_survival_dist: number;
  best_treasure_score: number;
  wins: number;
  plays: number;
}

interface AchievementRow {
  achievement_id: string;
  unlocked_at: number;
  points: number;
}

interface QuestDbRow {
  account_id: string;
  quest_id: string;
  template_id: string;
  cadence: string;
  period_key: string;
  progress: number;
  goal: number;
  completed_at: number | null;
  claimed_at: number | null;
  updated_at: number;
}

interface SeasonDbRow {
  account_id: string;
  season_id: string;
  season_points: number;
  claimed_tiers_json: string;
  challenges_json: string;
  updated_at: number;
}

interface RareEventDbRow {
  account_id: string;
  active: number;
  event_instance_id: string | null;
  event_type_id: string | null;
  rounds_remaining: number;
  rounds_completed: number;
  bonus_goal_rounds: number;
  completed: number;
  rounds_since_last_event: number;
  occurrences_count: number;
  updated_at: number;
}

interface StoredSubmissionReward {
  xpEarned: number;
  roundXp: number;
  achievementXp: number;
  coinsEarned: number;
  leveledUp: boolean;
  previousLevel: number;
  newlyUnlockedIds: AchievementId[];
  questProgressCount: number;
  completedQuests: QuestState[];
  rareEventTriggered: boolean;
  rareEventBonusCoins: number;
  newlyUnlockedTierItems: string[];
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function parseCosmeticJson(raw: string): PlayerCosmetic {
  try {
    return sanitizeCosmeticOrDefault(JSON.parse(raw), 0);
  } catch {
    return sanitizeCosmeticOrDefault(undefined, 0);
  }
}

export class ProgressionController {
  private sql: SqlStorageAdapter;
  private initialized = false;

  constructor(sql: SqlStorageAdapter) {
    this.sql = sql;
  }

  public initIfNeeded(nowMs = Date.now()): void {
    if (this.initialized) return;
    initProgressionSchema(this.sql, nowMs);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS solo_run_tokens (
        token TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        course_id TEXT NOT NULL,
        game_mode TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0
      )`,
    );
    this.initialized = true;
  }

  private async issueSession(accountId: string, nowMs = Date.now()): Promise<{ token: string; expiresAt: number }> {
    const token = generateResumeToken();
    const tokenHash = await hashToken(token);
    const expiresAt = nowMs + ACCOUNT_SESSION_TTL_MS;
    this.sql.exec(
      `INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
      tokenHash,
      accountId,
      nowMs,
      expiresAt,
      nowMs,
    );
    return { token, expiresAt };
  }

  public async resolveAccountFromBearer(authHeader: string | null, nowMs = Date.now()): Promise<AccountRow | null> {
    if (!authHeader) return null;
    const trimmed = authHeader.trim();
    const token = trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
    if (!token || token.length < 16) return null;
    const tokenHash = await hashToken(token);
    const sess = this.sql
      .exec<{ account_id: string; expires_at: number }>(
        `SELECT account_id, expires_at FROM account_sessions WHERE token_hash = ?`,
        tokenHash,
      )
      .toArray()[0];
    if (!sess) return null;
    if (nowMs >= sess.expires_at) {
      this.sql.exec(`DELETE FROM account_sessions WHERE token_hash = ?`, tokenHash);
      return null;
    }
    this.sql.exec(`UPDATE account_sessions SET last_used_at = ? WHERE token_hash = ?`, nowMs, tokenHash);
    return this.getAccountRow(sess.account_id);
  }

  private getAccountRow(accountId: string): AccountRow | null {
    return (
      this.sql
        .exec<AccountRow>(`SELECT * FROM accounts WHERE account_id = ?`, accountId)
        .toArray()[0] ?? null
    );
  }

  private buildProfile(row: AccountRow): AccountProfile {
    const lvl = computeLevelFromXp(row.xp);
    return {
      accountId: row.account_id,
      isGuest: row.is_guest === 1,
      username: row.username,
      displayName: row.display_name,
      cosmetic: parseCosmeticJson(row.cosmetic_json),
      xp: row.xp,
      level: lvl.level,
      xpIntoLevel: lvl.xpIntoLevel,
      xpForNextLevel: lvl.xpForNextLevel,
      rankTitleAr: lvl.rankTitleAr,
      challengePoints: row.challenge_points,
      coins: Math.max(0, Math.floor(row.coins ?? 0)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private buildStats(accountId: string): PlayerCareerStats {
    const s = this.sql
      .exec<StatsRow>(`SELECT * FROM account_stats WHERE account_id = ?`, accountId)
      .toArray()[0];
    const courseBests = createEmptyCourseBests();
    const cbRows = this.sql
      .exec<CourseBestRow>(`SELECT * FROM account_course_bests WHERE account_id = ?`, accountId)
      .toArray();
    for (const r of cbRows) {
      if (isValidCourseId(r.course_id)) {
        courseBests[r.course_id] = {
          courseId: r.course_id,
          bestTimeSec: r.best_time_sec,
          bestSurvivalDistance: r.best_survival_dist,
          bestTreasureScore: r.best_treasure_score,
          wins: r.wins,
          plays: r.plays,
        } satisfies CourseBestRecord;
      }
    }

    return {
      roundsPlayed: s?.rounds_played ?? 0,
      wins: s?.wins ?? 0,
      losses: s?.losses ?? 0,
      totalFalls: s?.total_falls ?? 0,
      bestTimeSec: s?.best_time_sec ?? null,
      itemsUsed: s?.items_used ?? 0,
      totalPushContribution: Math.round(s?.total_push ?? 0),
      totalFartTime: Number((s?.total_fart_time ?? 0).toFixed(1)),
      totalScore: s?.total_score ?? 0,
      bestSurvivalDistance: s?.best_survival_dist ?? 0,
      bestTreasureScore: s?.best_treasure_score ?? 0,
      hardGatesPassed: s?.hard_gates_passed ?? 0,
      harmonyCombos: s?.harmony_combos ?? 0,
      courseBests,
    };
  }

  private buildAchievements(accountId: string): UnlockedAchievement[] {
    const rows = this.sql
      .exec<AchievementRow>(
        `SELECT achievement_id, unlocked_at, points FROM account_achievements WHERE account_id = ? ORDER BY unlocked_at DESC`,
        accountId,
      )
      .toArray();
    return rows
      .filter((r) => r.achievement_id in ACHIEVEMENT_MAP)
      .map((r) => ({
        id: r.achievement_id as AchievementId,
        unlockedAt: r.unlocked_at,
        points: r.points,
      }));
  }

  private buildFriends(accountId: string): FriendSummary[] {
    const rows = this.sql
      .exec<{
        account_id: string;
        username: string | null;
        display_name: string;
        cosmetic_json: string;
        level: number;
        challenge_points: number;
        wins: number | null;
        best_time_sec: number | null;
        created_at: number;
      }>(
        `SELECT a.account_id, a.username, a.display_name, a.cosmetic_json, a.level, a.challenge_points,
                s.wins, s.best_time_sec, f.created_at
         FROM account_friends f
         JOIN accounts a ON a.account_id = f.friend_account_id
         LEFT JOIN account_stats s ON s.account_id = a.account_id
         WHERE f.account_id = ?
         ORDER BY f.created_at DESC`,
        accountId,
      )
      .toArray();
    return rows.map((r) => ({
      accountId: r.account_id,
      username: r.username,
      displayName: r.display_name,
      cosmetic: parseCosmeticJson(r.cosmetic_json),
      level: r.level,
      wins: r.wins ?? 0,
      challengePoints: r.challenge_points,
      bestTimeSec: r.best_time_sec ?? null,
      addedAt: r.created_at,
    }));
  }

  private ensureStarterInventory(accountId: string, nowMs: number): void {
    const starterIds = getDefaultOwnedItemIds();
    for (const itemId of starterIds) {
      this.sql.exec(
        `INSERT OR IGNORE INTO account_inventory (account_id, item_id, unlocked_at, source)
         VALUES (?, ?, ?, 'starter')`,
        accountId,
        itemId,
        nowMs,
      );
    }
  }

  private getOwnedItemIds(accountId: string, nowMs = Date.now()): string[] {
    this.ensureStarterInventory(accountId, nowMs);
    const rows = this.sql
      .exec<{ item_id: string }>(
        `SELECT item_id FROM account_inventory WHERE account_id = ? ORDER BY unlocked_at ASC`,
        accountId,
      )
      .toArray();
    return rows.map((r) => r.item_id);
  }

  private grantInventoryItems(accountId: string, itemIds: string[], source: string, nowMs: number): string[] {
    const existing = new Set(this.getOwnedItemIds(accountId, nowMs));
    const granted: string[] = [];
    for (const itemId of itemIds) {
      if (!itemId || !COSMETIC_ITEM_MAP[itemId] || existing.has(itemId)) continue;
      this.sql.exec(
        `INSERT OR IGNORE INTO account_inventory (account_id, item_id, unlocked_at, source)
         VALUES (?, ?, ?, ?)`,
        accountId,
        itemId,
        nowMs,
        source,
      );
      existing.add(itemId);
      granted.push(itemId);
    }
    return granted;
  }

  private ensureActiveQuests(accountId: string, nowMs = Date.now()): QuestState[] {
    const dayKey = getUtcDayKey(nowMs);
    const weekKey = getIsoWeekKey(nowMs);
    const dailyDefaults = generateDailyQuests(dayKey, nowMs);
    const weeklyDefaults = generateWeeklyQuests(weekKey, nowMs);
    const desired = [...dailyDefaults, ...weeklyDefaults];

    for (const q of desired) {
      this.sql.exec(
        `INSERT OR IGNORE INTO account_quests (
          account_id, quest_id, template_id, cadence, period_key, progress, goal, completed_at, claimed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?)`,
        accountId,
        q.questId,
        q.templateId,
        q.cadence,
        q.periodKey,
        q.goal,
        nowMs,
      );
    }

    const dbRows = this.sql
      .exec<QuestDbRow>(
        `SELECT * FROM account_quests
         WHERE account_id = ? AND ((cadence = 'daily' AND period_key = ?) OR (cadence = 'weekly' AND period_key = ?))`,
        accountId,
        dayKey,
        weekKey,
      )
      .toArray();
    const rowById = new Map(dbRows.map((r) => [r.quest_id, r]));

    return desired.map((tpl) => {
      const row = rowById.get(tpl.questId);
      return {
        ...tpl,
        progress: row ? Math.min(tpl.goal, row.progress) : 0,
        completedAt: row?.completed_at ?? null,
        claimedAt: row?.claimed_at ?? null,
      };
    });
  }

  private getSeasonRow(accountId: string, nowMs = Date.now()): SeasonDbRow {
    const existing = this.sql
      .exec<SeasonDbRow>(
        `SELECT * FROM account_season_progress WHERE account_id = ? AND season_id = ?`,
        accountId,
        ACTIVE_SEASON_DEF.seasonId,
      )
      .toArray()[0];
    if (existing) return existing;

    this.sql.exec(
      `INSERT OR IGNORE INTO account_season_progress (
        account_id, season_id, season_points, claimed_tiers_json, challenges_json, updated_at
      ) VALUES (?, ?, 0, '[]', '{}', ?)`,
      accountId,
      ACTIVE_SEASON_DEF.seasonId,
      nowMs,
    );
    return this.sql
      .exec<SeasonDbRow>(
        `SELECT * FROM account_season_progress WHERE account_id = ? AND season_id = ?`,
        accountId,
        ACTIVE_SEASON_DEF.seasonId,
      )
      .toArray()[0];
  }

  private buildSeasonState(accountId: string, nowMs = Date.now()): SeasonProgressState {
    const row = this.getSeasonRow(accountId, nowMs);
    let claimedTiers: number[] = [];
    let challengeMap: Record<string, { progress: number; completed: boolean }> = {};
    try {
      const parsed = JSON.parse(row.claimed_tiers_json);
      if (Array.isArray(parsed)) {
        claimedTiers = parsed.filter((n): n is number => typeof n === 'number');
      }
    } catch {
      claimedTiers = [];
    }
    try {
      const parsed = JSON.parse(row.challenges_json);
      if (parsed && typeof parsed === 'object') {
        challengeMap = parsed as Record<string, { progress: number; completed: boolean }>;
      }
    } catch {
      challengeMap = {};
    }

    const claimedSet = new Set(claimedTiers);
    const tiers: SeasonRewardTierState[] = ACTIVE_SEASON_DEF.tiers.map((t) => ({
      tier: t.tier,
      requiredPoints: t.requiredPoints,
      titleAr: t.titleAr,
      coinsReward: t.coinsReward,
      xpReward: t.xpReward,
      cosmeticItemId: t.cosmeticItemId,
      unlocked: row.season_points >= t.requiredPoints,
      claimed: claimedSet.has(t.tier),
    }));

    const challenges: SeasonChallengeState[] = ACTIVE_SEASON_DEF.challenges.map((c) => {
      const st = challengeMap[c.challengeId] ?? { progress: 0, completed: false };
      return {
        challengeId: c.challengeId,
        titleAr: c.titleAr,
        descriptionAr: c.descriptionAr,
        progress: Math.min(c.goal, st.progress ?? 0),
        goal: c.goal,
        xpReward: c.xpReward,
        coinsReward: c.coinsReward,
        seasonPointsReward: c.seasonPointsReward,
        completed: Boolean(st.completed || (st.progress ?? 0) >= c.goal),
      };
    });

    return {
      seasonId: ACTIVE_SEASON_DEF.seasonId,
      titleAr: ACTIVE_SEASON_DEF.titleAr,
      subtitleAr: ACTIVE_SEASON_DEF.subtitleAr,
      featuredCourseId: ACTIVE_SEASON_DEF.featuredCourseId,
      featuredGameMode: ACTIVE_SEASON_DEF.featuredGameMode,
      seasonPoints: row.season_points,
      maxPoints: ACTIVE_SEASON_DEF.maxPoints,
      tiers,
      challenges,
    };
  }

  private getRareEventRow(accountId: string, nowMs = Date.now()): RareEventDbRow {
    const existing = this.sql
      .exec<RareEventDbRow>(`SELECT * FROM account_rare_events WHERE account_id = ?`, accountId)
      .toArray()[0];
    if (existing) return existing;

    this.sql.exec(
      `INSERT OR IGNORE INTO account_rare_events (
        account_id, active, event_instance_id, event_type_id, rounds_remaining,
        rounds_completed, bonus_goal_rounds, completed, rounds_since_last_event, occurrences_count, updated_at
      ) VALUES (?, 0, NULL, NULL, 0, 0, 0, 0, 0, 0, ?)`,
      accountId,
      nowMs,
    );
    return this.sql
      .exec<RareEventDbRow>(`SELECT * FROM account_rare_events WHERE account_id = ?`, accountId)
      .toArray()[0];
  }

  private buildRareEventState(accountId: string, nowMs = Date.now()): RareEventState {
    const row = this.getRareEventRow(accountId, nowMs);
    if (row.active !== 1 || !row.event_type_id) {
      return createIdleRareEventState(row.occurrences_count ?? 0);
    }
    const def = RARE_EVENT_POOL.find((e) => e.eventTypeId === row.event_type_id);
    if (!def) {
      return createIdleRareEventState(row.occurrences_count ?? 0);
    }
    return {
      active: true,
      eventInstanceId: row.event_instance_id,
      eventTypeId: def.eventTypeId,
      titleAr: def.titleAr,
      descriptionAr: def.descriptionAr,
      featuredCourseId: def.featuredCourseId,
      featuredGameMode: def.featuredGameMode,
      roundsRemaining: row.rounds_remaining,
      roundsCompleted: row.rounds_completed,
      bonusGoalRounds: row.bonus_goal_rounds,
      xpBonus: def.xpBonus,
      coinsBonus: def.coinsBonus,
      rewardItemId: def.rewardItemId,
      completed: row.completed === 1,
      accentHex: def.accentHex,
      occurrencesCount: row.occurrences_count,
    };
  }

  private buildSnapshotPayload(accountRow: AccountRow, nowMs = Date.now()): ProfileSnapshotPayload {
    return {
      profile: this.buildProfile(accountRow),
      stats: this.buildStats(accountRow.account_id),
      achievements: this.buildAchievements(accountRow.account_id),
      friends: this.buildFriends(accountRow.account_id),
      ownedItemIds: this.getOwnedItemIds(accountRow.account_id, nowMs),
      quests: this.ensureActiveQuests(accountRow.account_id, nowMs),
      season: this.buildSeasonState(accountRow.account_id, nowMs),
      rareEvent: this.buildRareEventState(accountRow.account_id, nowMs),
    };
  }

  private sanitizeMatchInput(raw: Partial<MatchSummaryInput>): MatchSummaryInput {
    const submissionKey =
      typeof raw.submissionKey === 'string' && raw.submissionKey.trim().length > 0
        ? raw.submissionKey.trim().slice(0, 128)
        : crypto.randomUUID();
    const courseId: CourseId = isValidCourseId(raw.courseId) ? raw.courseId : 'tropical';
    const gameMode = isValidGameMode(raw.gameMode) ? raw.gameMode : 'standard';
    const difficulty = isValidDifficulty(raw.difficulty) ? raw.difficulty : 'normal';
    const outcome = raw.outcome === 'defeat' ? 'defeat' : 'victory';
    const num = (v: unknown, max = 1_000_000) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;

    return {
      submissionKey,
      courseId,
      gameMode,
      difficulty,
      outcome,
      elapsedTimeSec: Number(num(raw.elapsedTimeSec, 36_000).toFixed(2)),
      falls: Math.round(num(raw.falls, 500)),
      itemsUsed: Math.round(num(raw.itemsUsed, 500)),
      pushContribution: Math.round(num(raw.pushContribution, 100_000)),
      fartTimeSec: Number(num(raw.fartTimeSec, 36_000).toFixed(2)),
      survivalDistance: Math.round(num(raw.survivalDistance, 100_000)),
      treasureScore: Math.round(num(raw.treasureScore, 100_000)),
      harmonyCombos: Math.round(num(raw.harmonyCombos, 200)),
      hardGatesPassed: Math.round(num(raw.hardGatesPassed, 500)),
      minRaftHp: Math.round(num(raw.minRaftHp, 100)),
      cleanCheckpoints: Math.round(num(raw.cleanCheckpoints, 100)),
      collisionCount: Math.round(num(raw.collisionCount, 500)),
      isOnline: Boolean(raw.isOnline),
    };
  }

  public applyMatchForAccount(
    accountId: string,
    rawMatch: Partial<MatchSummaryInput>,
    nowMs = Date.now(),
    rareOptions?: { rollValue?: number; selectionSeed?: number },
  ): RecordMatchHttpResponse {
    const account = this.getAccountRow(accountId);
    if (!account) {
      throw new ProtocolError('ACCOUNT_NOT_FOUND', ERROR_MESSAGES_AR.ACCOUNT_NOT_FOUND, 404);
    }

    const match = this.sanitizeMatchInput(rawMatch);
    const dedupeKey = `${accountId}:${match.submissionKey}`;

    const runTx = () => {
      const existing = this.sql
        .exec<{ reward_json: string }>(
          `SELECT reward_json FROM match_submissions WHERE submission_key = ?`,
          dedupeKey,
        )
        .toArray()[0];

      if (existing) {
        let parsed: StoredSubmissionReward = {
          xpEarned: 0,
          roundXp: 0,
          achievementXp: 0,
          coinsEarned: 0,
          leveledUp: false,
          previousLevel: account.level,
          newlyUnlockedIds: [],
          questProgressCount: 0,
          completedQuests: [],
          rareEventTriggered: false,
          rareEventBonusCoins: 0,
          newlyUnlockedTierItems: [],
        };
        try {
          parsed = {
            ...parsed,
            ...(JSON.parse(existing.reward_json) as Partial<StoredSubmissionReward>),
          };
        } catch {
          // ignore
        }
        const refreshed = this.getAccountRow(accountId)!;
        const snapshot = this.buildSnapshotPayload(refreshed, nowMs);
        const newlyUnlocked: AchievementDef[] = parsed.newlyUnlockedIds
          .map((id) => ACHIEVEMENT_MAP[id])
          .filter(Boolean);
        return {
          ...snapshot,
          xpEarned: parsed.xpEarned,
          roundXp: parsed.roundXp,
          achievementXp: parsed.achievementXp,
          coinsEarned: parsed.coinsEarned,
          leveledUp: parsed.leveledUp,
          previousLevel: parsed.previousLevel,
          newlyUnlocked,
          questProgressCount: parsed.questProgressCount,
          completedQuests: parsed.completedQuests,
          rareEventTriggered: parsed.rareEventTriggered,
          rareEventBonusCoins: parsed.rareEventBonusCoins,
          newlyUnlockedTierItems: parsed.newlyUnlockedTierItems,
          alreadyRecorded: true,
        } satisfies RecordMatchHttpResponse;
      }

      const prevStats = this.buildStats(accountId);
      const isTimedWin = match.outcome === 'victory' && match.gameMode !== 'survival' && match.elapsedTimeSec > 0;
      const isWin = match.outcome === 'victory';

      const nextBestTime =
        isTimedWin && (prevStats.bestTimeSec === null || match.elapsedTimeSec < prevStats.bestTimeSec)
          ? match.elapsedTimeSec
          : prevStats.bestTimeSec;

      const prevCourseBest = prevStats.courseBests[match.courseId];
      const nextCourseBestTime =
        isTimedWin && (prevCourseBest.bestTimeSec === null || match.elapsedTimeSec < prevCourseBest.bestTimeSec)
          ? match.elapsedTimeSec
          : prevCourseBest.bestTimeSec;

      const roundScore =
        (isWin ? 100 : 30) +
        Math.round(match.pushContribution / 15) +
        match.treasureScore +
        Math.round(match.survivalDistance / 2);

      this.sql.exec(
        `INSERT INTO account_stats (
          account_id, rounds_played, wins, losses, total_falls, best_time_sec,
          items_used, total_push, total_fart_time, total_score, best_survival_dist,
          best_treasure_score, hard_gates_passed, harmony_combos, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
          rounds_played = rounds_played + excluded.rounds_played,
          wins = wins + excluded.wins,
          losses = losses + excluded.losses,
          total_falls = total_falls + excluded.total_falls,
          best_time_sec = CASE
            WHEN excluded.best_time_sec IS NULL THEN account_stats.best_time_sec
            WHEN account_stats.best_time_sec IS NULL OR excluded.best_time_sec < account_stats.best_time_sec
              THEN excluded.best_time_sec
            ELSE account_stats.best_time_sec
          END,
          items_used = items_used + excluded.items_used,
          total_push = total_push + excluded.total_push,
          total_fart_time = total_fart_time + excluded.total_fart_time,
          total_score = total_score + excluded.total_score,
          best_survival_dist = MAX(best_survival_dist, excluded.best_survival_dist),
          best_treasure_score = MAX(best_treasure_score, excluded.best_treasure_score),
          hard_gates_passed = hard_gates_passed + excluded.hard_gates_passed,
          harmony_combos = harmony_combos + excluded.harmony_combos,
          updated_at = excluded.updated_at`,
        accountId,
        1,
        isWin ? 1 : 0,
        isWin ? 0 : 1,
        match.falls,
        isTimedWin ? match.elapsedTimeSec : null,
        match.itemsUsed,
        match.pushContribution,
        match.fartTimeSec,
        roundScore,
        match.gameMode === 'survival' ? match.survivalDistance : 0,
        match.gameMode === 'treasure' ? match.treasureScore : 0,
        match.hardGatesPassed,
        match.harmonyCombos,
        nowMs,
      );

      this.sql.exec(
        `INSERT INTO account_course_bests (
          account_id, course_id, best_time_sec, best_survival_dist, best_treasure_score, wins, plays
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(account_id, course_id) DO UPDATE SET
          best_time_sec = CASE
            WHEN excluded.best_time_sec IS NULL THEN account_course_bests.best_time_sec
            WHEN account_course_bests.best_time_sec IS NULL OR excluded.best_time_sec < account_course_bests.best_time_sec
              THEN excluded.best_time_sec
            ELSE account_course_bests.best_time_sec
          END,
          best_survival_dist = MAX(best_survival_dist, excluded.best_survival_dist),
          best_treasure_score = MAX(best_treasure_score, excluded.best_treasure_score),
          wins = wins + excluded.wins,
          plays = plays + 1`,
        accountId,
        match.courseId,
        nextCourseBestTime,
        match.gameMode === 'survival' ? match.survivalDistance : 0,
        match.gameMode === 'treasure' ? match.treasureScore : 0,
        isWin ? 1 : 0,
      );

      const updatedStats = this.buildStats(accountId);
      updatedStats.bestTimeSec = nextBestTime;
      const existingAchievementIds = new Set(this.buildAchievements(accountId).map((a) => a.id));
      const newlyUnlocked = evaluateNewAchievements(updatedStats, match, existingAchievementIds);

      for (const ach of newlyUnlocked) {
        this.sql.exec(
          `INSERT OR IGNORE INTO account_achievements (account_id, achievement_id, unlocked_at, points)
           VALUES (?, ?, ?, ?)`,
          accountId,
          ach.id,
          nowMs,
          ach.points,
        );
        existingAchievementIds.add(ach.id);
      }

      this.ensureStarterInventory(accountId, nowMs);

      const roundXp = calculateXpForRound(match);
      const achievementXp = newlyUnlocked.reduce((s, a) => s + a.points, 0);
      const roundCoins = calculateCoinsForRound(match);
      const achievementCoins = newlyUnlocked.reduce((s, a) => s + getAchievementCoinReward(a), 0);

      // PROG-06: Advance Daily & Weekly Quests
      const activeQuests = this.ensureActiveQuests(accountId, nowMs);
      let questProgressCount = 0;
      const completedQuests: QuestState[] = [];
      for (const q of activeQuests) {
        const delta = getQuestDeltaForMatch(q.objective, match);
        if (delta <= 0 || q.progress >= q.goal) continue;
        const nextProgress = Math.min(q.goal, q.progress + delta);
        if (nextProgress > q.progress) {
          questProgressCount += 1;
          const justCompleted = q.completedAt === null && nextProgress >= q.goal;
          const completedAt = justCompleted ? nowMs : q.completedAt;
          this.sql.exec(
            `UPDATE account_quests SET progress = ?, completed_at = ?, updated_at = ?
             WHERE account_id = ? AND quest_id = ?`,
            nextProgress,
            completedAt,
            nowMs,
            accountId,
            q.questId,
          );
          if (justCompleted) {
            completedQuests.push({
              ...q,
              progress: nextProgress,
              completedAt,
            });
          }
        }
      }

      // PROG-10: Advance Season Challenges & Free Track
      const seasonRow = this.getSeasonRow(accountId, nowMs);
      let challengeMap: Record<string, { progress: number; completed: boolean }> = {};
      try {
        const parsed = JSON.parse(seasonRow.challenges_json);
        if (parsed && typeof parsed === 'object') {
          challengeMap = parsed as Record<string, { progress: number; completed: boolean }>;
        }
      } catch {
        challengeMap = {};
      }
      let seasonChallengeXp = 0;
      let seasonChallengeCoins = 0;
      let seasonPointsEarned = calculateSeasonPointsForRound(match);

      for (const ch of ACTIVE_SEASON_DEF.challenges) {
        const cur = challengeMap[ch.challengeId] ?? { progress: 0, completed: false };
        if (cur.completed) continue;
        const delta = getSeasonChallengeDelta(ch, match);
        if (delta <= 0) continue;
        const nextProg = Math.min(ch.goal, (cur.progress ?? 0) + delta);
        const nowDone = nextProg >= ch.goal;
        challengeMap[ch.challengeId] = { progress: nextProg, completed: nowDone };
        if (nowDone) {
          seasonChallengeXp += ch.xpReward;
          seasonChallengeCoins += ch.coinsReward;
          seasonPointsEarned += ch.seasonPointsReward;
        }
      }

      const prevSeasonPoints = seasonRow.season_points;
      const nextSeasonPoints = Math.min(ACTIVE_SEASON_DEF.maxPoints, prevSeasonPoints + seasonPointsEarned);
      this.sql.exec(
        `UPDATE account_season_progress SET season_points = ?, challenges_json = ?, updated_at = ?
         WHERE account_id = ? AND season_id = ?`,
        nextSeasonPoints,
        JSON.stringify(challengeMap),
        nowMs,
        accountId,
        ACTIVE_SEASON_DEF.seasonId,
      );

      // Unlock notice for newly reachable tier items (auto-grant not needed since user claims tiers,
      // but let's report tier cosmetic IDs unlocked cleanly)
      const newlyUnlockedTierItems: string[] = [];
      for (const tier of ACTIVE_SEASON_DEF.tiers) {
        if (prevSeasonPoints < tier.requiredPoints && nextSeasonPoints >= tier.requiredPoints && tier.cosmeticItemId) {
          newlyUnlockedTierItems.push(tier.cosmeticItemId);
        }
      }

      // PROG-10: Sudden Rare Non-Time-Bound Dynamic Event
      const rareRow = this.getRareEventRow(accountId, nowMs);
      let rareEventTriggered = false;
      let rareEventBonusXp = 0;
      let rareEventBonusCoins = 0;

      if (rareRow.active === 1 && rareRow.event_type_id) {
        const def = RARE_EVENT_POOL.find((e) => e.eventTypeId === rareRow.event_type_id);
        const nextRemaining = Math.max(0, rareRow.rounds_remaining - 1);
        let nextCompleted = rareRow.rounds_completed;
        let isDone = rareRow.completed === 1;
        if (def && !isDone) {
          const bonusStep =
            match.courseId === def.featuredCourseId || match.gameMode === def.featuredGameMode ? 1 : 1;
          nextCompleted = Math.min(rareRow.bonus_goal_rounds, nextCompleted + bonusStep);
          if (nextCompleted >= rareRow.bonus_goal_rounds) {
            isDone = true;
            rareEventBonusXp = def.xpBonus;
            rareEventBonusCoins = def.coinsBonus;
            if (def.rewardItemId) {
              this.grantInventoryItems(accountId, [def.rewardItemId], 'rare_event', nowMs);
            }
          }
        }
        const stayActive = nextRemaining > 0 && !isDone ? 1 : 0;
        this.sql.exec(
          `UPDATE account_rare_events
           SET active = ?, rounds_remaining = ?, rounds_completed = ?, completed = ?, updated_at = ?
           WHERE account_id = ?`,
          stayActive,
          stayActive === 1 ? nextRemaining : 0,
          nextCompleted,
          isDone ? 1 : 0,
          nowMs,
          accountId,
        );
      } else {
        const nextRoundsSince = (rareRow.rounds_since_last_event ?? 0) + 1;
        const rollValue =
          typeof rareOptions?.rollValue === 'number' ? rareOptions.rollValue : Math.random();
        const selectionSeed =
          typeof rareOptions?.selectionSeed === 'number'
            ? rareOptions.selectionSeed
            : Math.floor(Math.random() * 1000) + nextRoundsSince;
        const spawned = evaluateRareEventTrigger({
          roundsSinceLastEvent: nextRoundsSince,
          currentActive: false,
          rollValue,
          selectionSeed,
        });
        if (spawned) {
          rareEventTriggered = true;
          this.sql.exec(
            `UPDATE account_rare_events
             SET active = 1, event_instance_id = ?, event_type_id = ?, rounds_remaining = ?,
                 rounds_completed = 0, bonus_goal_rounds = ?, completed = 0,
                 rounds_since_last_event = 0, occurrences_count = occurrences_count + 1, updated_at = ?
             WHERE account_id = ?`,
            crypto.randomUUID(),
            spawned.eventTypeId,
            spawned.bonusGoalRounds + 1, // 3 rounds window to finish 2 bonus rounds
            spawned.bonusGoalRounds,
            nowMs,
            accountId,
          );
        } else {
          this.sql.exec(
            `UPDATE account_rare_events SET rounds_since_last_event = ?, updated_at = ? WHERE account_id = ?`,
            nextRoundsSince,
            nowMs,
            accountId,
          );
        }
      }

      const xpEarned = roundXp + achievementXp + seasonChallengeXp + rareEventBonusXp;
      const coinsEarned = roundCoins + achievementCoins + seasonChallengeCoins + rareEventBonusCoins;
      const previousLevel = account.level;
      const newXp = account.xp + xpEarned;
      const newCoins = Math.max(0, (account.coins ?? 0) + coinsEarned);
      const lvlInfo = computeLevelFromXp(newXp);
      const totalChallengePoints = computeChallengePoints(existingAchievementIds);

      this.sql.exec(
        `UPDATE accounts SET xp = ?, level = ?, challenge_points = ?, coins = ?, updated_at = ? WHERE account_id = ?`,
        newXp,
        lvlInfo.level,
        totalChallengePoints,
        newCoins,
        nowMs,
        accountId,
      );

      const weekKey = getIsoWeekKey(nowMs);
      this.sql.exec(
        `INSERT INTO weekly_stats (
          week_key, account_id, wins, rounds_played, best_time_sec, challenge_points, total_push, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(week_key, account_id) DO UPDATE SET
          wins = wins + excluded.wins,
          rounds_played = rounds_played + 1,
          best_time_sec = CASE
            WHEN excluded.best_time_sec IS NULL THEN weekly_stats.best_time_sec
            WHEN weekly_stats.best_time_sec IS NULL OR excluded.best_time_sec < weekly_stats.best_time_sec
              THEN excluded.best_time_sec
            ELSE weekly_stats.best_time_sec
          END,
          challenge_points = MAX(weekly_stats.challenge_points, excluded.challenge_points),
          total_push = total_push + excluded.total_push,
          updated_at = excluded.updated_at`,
        weekKey,
        accountId,
        isWin ? 1 : 0,
        isTimedWin ? match.elapsedTimeSec : null,
        totalChallengePoints,
        match.pushContribution,
        nowMs,
      );

      const storedReward: StoredSubmissionReward = {
        xpEarned,
        roundXp,
        achievementXp,
        coinsEarned,
        leveledUp: lvlInfo.level > previousLevel,
        previousLevel,
        newlyUnlockedIds: newlyUnlocked.map((a) => a.id),
        questProgressCount,
        completedQuests,
        rareEventTriggered,
        rareEventBonusCoins,
        newlyUnlockedTierItems,
      };

      this.sql.exec(
        `INSERT INTO match_submissions (submission_key, account_id, reward_json, created_at)
         VALUES (?, ?, ?, ?)`,
        dedupeKey,
        accountId,
        JSON.stringify(storedReward),
        nowMs,
      );

      const refreshedAccount = this.getAccountRow(accountId)!;
      const snapshot = this.buildSnapshotPayload(refreshedAccount, nowMs);
      return {
        ...snapshot,
        xpEarned,
        roundXp,
        achievementXp,
        coinsEarned,
        leveledUp: storedReward.leveledUp,
        previousLevel,
        newlyUnlocked,
        questProgressCount,
        completedQuests,
        rareEventTriggered,
        rareEventBonusCoins,
        newlyUnlockedTierItems,
        alreadyRecorded: false,
      } satisfies RecordMatchHttpResponse;
    };

    return this.sql.transactionSync ? this.sql.transactionSync(runTx) : runTx();
  }

  private buyCosmeticForAccount(
    accountId: string,
    itemId: string,
    equip: boolean,
    nowMs = Date.now(),
  ): BuyCosmeticHttpResponse {
    const item = COSMETIC_ITEM_MAP[itemId];
    if (!item) {
      throw new ProtocolError('ITEM_NOT_FOUND', ERROR_MESSAGES_AR.ITEM_NOT_FOUND, 404);
    }

    const runTx = () => {
      const account = this.getAccountRow(accountId);
      if (!account) {
        throw new ProtocolError('ACCOUNT_NOT_FOUND', ERROR_MESSAGES_AR.ACCOUNT_NOT_FOUND, 404);
      }
      const owned = new Set(this.getOwnedItemIds(accountId, nowMs));
      if (owned.has(itemId)) {
        throw new ProtocolError('ITEM_ALREADY_OWNED', ERROR_MESSAGES_AR.ITEM_ALREADY_OWNED, 409);
      }
      if ((account.coins ?? 0) < item.priceCoins) {
        throw new ProtocolError('INSUFFICIENT_COINS', ERROR_MESSAGES_AR.INSUFFICIENT_COINS, 400);
      }

      const nextCoins = Math.max(0, (account.coins ?? 0) - item.priceCoins);
      this.sql.exec(
        `INSERT INTO account_inventory (account_id, item_id, unlocked_at, source) VALUES (?, ?, ?, 'shop')`,
        accountId,
        itemId,
        nowMs,
      );

      let nextCosmetic = parseCosmeticJson(account.cosmetic_json);
      if (equip) {
        nextCosmetic = applyShopItemToCosmetic(nextCosmetic, item);
      }

      this.sql.exec(
        `UPDATE accounts SET coins = ?, cosmetic_json = ?, updated_at = ? WHERE account_id = ?`,
        nextCoins,
        JSON.stringify(nextCosmetic),
        nowMs,
        accountId,
      );

      const refreshed = this.getAccountRow(accountId)!;
      return {
        ...this.buildSnapshotPayload(refreshed, nowMs),
        purchasedItemId: itemId,
        coinsSpent: item.priceCoins,
      } satisfies BuyCosmeticHttpResponse;
    };

    return this.sql.transactionSync ? this.sql.transactionSync(runTx) : runTx();
  }

  private equipCosmeticForAccount(
    accountId: string,
    rawCosmetic: unknown,
    nowMs = Date.now(),
  ): ProfileSnapshotPayload {
    const valid = validateCosmetic(rawCosmetic, 0);
    if (!valid) {
      throw new ProtocolError('INVALID_MESSAGE', 'بيانات المظهر التجميلي غير صالحة.', 400);
    }
    const owned = new Set(this.getOwnedItemIds(accountId, nowMs));
    if (!isCosmeticFullyOwned(valid, owned)) {
      throw new ProtocolError('ITEM_NOT_OWNED', ERROR_MESSAGES_AR.ITEM_NOT_OWNED, 403);
    }
    this.sql.exec(
      `UPDATE accounts SET cosmetic_json = ?, updated_at = ? WHERE account_id = ?`,
      JSON.stringify(valid),
      nowMs,
      accountId,
    );
    const updated = this.getAccountRow(accountId)!;
    return this.buildSnapshotPayload(updated, nowMs);
  }

  private claimQuestForAccount(accountId: string, questId: string, nowMs = Date.now()): ClaimQuestHttpResponse {
    const runTx = () => {
      const account = this.getAccountRow(accountId);
      if (!account) {
        throw new ProtocolError('ACCOUNT_NOT_FOUND', ERROR_MESSAGES_AR.ACCOUNT_NOT_FOUND, 404);
      }
      const quests = this.ensureActiveQuests(accountId, nowMs);
      const quest = quests.find((q) => q.questId === questId);
      if (!quest) {
        throw new ProtocolError('INVALID_MESSAGE', 'المهمة المطلوبة غير متاحة حاليًا.', 404);
      }
      if (quest.claimedAt !== null) {
        throw new ProtocolError('ALREADY_CLAIMED', ERROR_MESSAGES_AR.ALREADY_CLAIMED, 409);
      }
      if (quest.progress < quest.goal) {
        throw new ProtocolError('QUEST_NOT_READY', ERROR_MESSAGES_AR.QUEST_NOT_READY, 400);
      }

      this.sql.exec(
        `UPDATE account_quests SET claimed_at = ?, updated_at = ? WHERE account_id = ? AND quest_id = ?`,
        nowMs,
        nowMs,
        accountId,
        questId,
      );

      const newXp = account.xp + quest.xpReward;
      const lvlInfo = computeLevelFromXp(newXp);
      const newCoins = Math.max(0, (account.coins ?? 0) + quest.coinsReward);
      this.sql.exec(
        `UPDATE accounts SET xp = ?, level = ?, coins = ?, updated_at = ? WHERE account_id = ?`,
        newXp,
        lvlInfo.level,
        newCoins,
        nowMs,
        accountId,
      );

      const seasonRow = this.getSeasonRow(accountId, nowMs);
      const nextSeasonPoints = Math.min(ACTIVE_SEASON_DEF.maxPoints, seasonRow.season_points + quest.seasonPointsReward);
      this.sql.exec(
        `UPDATE account_season_progress SET season_points = ?, updated_at = ? WHERE account_id = ? AND season_id = ?`,
        nextSeasonPoints,
        nowMs,
        accountId,
        ACTIVE_SEASON_DEF.seasonId,
      );

      const refreshed = this.getAccountRow(accountId)!;
      return {
        ...this.buildSnapshotPayload(refreshed, nowMs),
        claimedQuestId: questId,
        xpEarned: quest.xpReward,
        coinsEarned: quest.coinsReward,
        seasonPointsEarned: quest.seasonPointsReward,
        leveledUp: lvlInfo.level > account.level,
        unlockedItemIds: [],
      } satisfies ClaimQuestHttpResponse;
    };

    return this.sql.transactionSync ? this.sql.transactionSync(runTx) : runTx();
  }

  private claimSeasonTierForAccount(accountId: string, tierNumber: number, nowMs = Date.now()): ClaimSeasonTierHttpResponse {
    const tierDef = ACTIVE_SEASON_DEF.tiers.find((t) => t.tier === tierNumber);
    if (!tierDef) {
      throw new ProtocolError('INVALID_MESSAGE', 'مستوى الموسم المطلوب غير موجود.', 404);
    }

    const runTx = () => {
      const account = this.getAccountRow(accountId);
      if (!account) {
        throw new ProtocolError('ACCOUNT_NOT_FOUND', ERROR_MESSAGES_AR.ACCOUNT_NOT_FOUND, 404);
      }
      const seasonRow = this.getSeasonRow(accountId, nowMs);
      if (seasonRow.season_points < tierDef.requiredPoints) {
        throw new ProtocolError('QUEST_NOT_READY', ERROR_MESSAGES_AR.QUEST_NOT_READY, 400);
      }
      let claimed: number[] = [];
      try {
        const parsed = JSON.parse(seasonRow.claimed_tiers_json);
        if (Array.isArray(parsed)) claimed = parsed.filter((n): n is number => typeof n === 'number');
      } catch {
        claimed = [];
      }
      if (claimed.includes(tierDef.tier)) {
        throw new ProtocolError('ALREADY_CLAIMED', ERROR_MESSAGES_AR.ALREADY_CLAIMED, 409);
      }

      claimed.push(tierDef.tier);
      this.sql.exec(
        `UPDATE account_season_progress SET claimed_tiers_json = ?, updated_at = ? WHERE account_id = ? AND season_id = ?`,
        JSON.stringify(claimed),
        nowMs,
        accountId,
        ACTIVE_SEASON_DEF.seasonId,
      );

      const newXp = account.xp + tierDef.xpReward;
      const lvlInfo = computeLevelFromXp(newXp);
      const newCoins = Math.max(0, (account.coins ?? 0) + tierDef.coinsReward);
      this.sql.exec(
        `UPDATE accounts SET xp = ?, level = ?, coins = ?, updated_at = ? WHERE account_id = ?`,
        newXp,
        lvlInfo.level,
        newCoins,
        nowMs,
        accountId,
      );

      const unlockedItemIds = tierDef.cosmeticItemId
        ? this.grantInventoryItems(accountId, [tierDef.cosmeticItemId], 'season', nowMs)
        : [];

      const refreshed = this.getAccountRow(accountId)!;
      return {
        ...this.buildSnapshotPayload(refreshed, nowMs),
        claimedTier: tierDef.tier,
        xpEarned: tierDef.xpReward,
        coinsEarned: tierDef.coinsReward,
        leveledUp: lvlInfo.level > account.level,
        unlockedItemIds,
      } satisfies ClaimSeasonTierHttpResponse;
    };

    return this.sql.transactionSync ? this.sql.transactionSync(runTx) : runTx();
  }

  private queryLeaderboard(params: {
    metric: LeaderboardMetric;
    scope: LeaderboardScope;
    courseId: CourseId | 'all';
    callerAccountId: string | null;
    partyAccountIds: string[];
    nowMs: number;
  }): LeaderboardHttpResponse {
    const { metric, scope, courseId, callerAccountId, partyAccountIds, nowMs } = params;
    const weekKey = getIsoWeekKey(nowMs);

    interface RawRow {
      account_id: string;
      username: string | null;
      display_name: string;
      is_guest: number;
      cosmetic_json: string;
      level: number;
      wins: number;
      rounds_played: number;
      best_time_sec: number | null;
      challenge_points: number;
      total_push: number;
    }

    let rows: RawRow[] = [];

    if (scope === 'weekly') {
      if (courseId !== 'all' && metric === 'best_time') {
        rows = this.sql
          .exec<RawRow>(
            `SELECT a.account_id, a.username, a.display_name, a.is_guest, a.cosmetic_json, a.level,
                    w.wins, w.rounds_played, cb.best_time_sec, a.challenge_points, w.total_push
             FROM weekly_stats w
             JOIN accounts a ON a.account_id = w.account_id
             LEFT JOIN account_course_bests cb ON cb.account_id = a.account_id AND cb.course_id = ?
             WHERE w.week_key = ?`,
            courseId,
            weekKey,
          )
          .toArray();
      } else {
        rows = this.sql
          .exec<RawRow>(
            `SELECT a.account_id, a.username, a.display_name, a.is_guest, a.cosmetic_json, a.level,
                    w.wins, w.rounds_played, w.best_time_sec, a.challenge_points, w.total_push
             FROM weekly_stats w
             JOIN accounts a ON a.account_id = w.account_id
             WHERE w.week_key = ?`,
            weekKey,
          )
          .toArray();
      }
    } else if (scope === 'friends') {
      const targetIds = new Set<string>(partyAccountIds);
      if (callerAccountId) {
        targetIds.add(callerAccountId);
        const fRows = this.sql
          .exec<{ friend_account_id: string }>(
            `SELECT friend_account_id FROM account_friends WHERE account_id = ?`,
            callerAccountId,
          )
          .toArray();
        for (const r of fRows) targetIds.add(r.friend_account_id);
      }
      if (targetIds.size > 0) {
        const placeholders = Array.from(targetIds).map(() => '?').join(',');
        const idsArr = Array.from(targetIds);
        if (courseId !== 'all' && metric === 'best_time') {
          rows = this.sql
            .exec<RawRow>(
              `SELECT a.account_id, a.username, a.display_name, a.is_guest, a.cosmetic_json, a.level,
                      COALESCE(s.wins, 0) AS wins, COALESCE(s.rounds_played, 0) AS rounds_played,
                      cb.best_time_sec, a.challenge_points, COALESCE(s.total_push, 0) AS total_push
               FROM accounts a
               LEFT JOIN account_stats s ON s.account_id = a.account_id
               LEFT JOIN account_course_bests cb ON cb.account_id = a.account_id AND cb.course_id = ?
               WHERE a.account_id IN (${placeholders})`,
              courseId,
              ...idsArr,
            )
            .toArray();
        } else {
          rows = this.sql
            .exec<RawRow>(
              `SELECT a.account_id, a.username, a.display_name, a.is_guest, a.cosmetic_json, a.level,
                      COALESCE(s.wins, 0) AS wins, COALESCE(s.rounds_played, 0) AS rounds_played,
                      s.best_time_sec, a.challenge_points, COALESCE(s.total_push, 0) AS total_push
               FROM accounts a
               LEFT JOIN account_stats s ON s.account_id = a.account_id
               WHERE a.account_id IN (${placeholders})`,
              ...idsArr,
            )
            .toArray();
        }
      }
    } else {
      // global
      if (courseId !== 'all' && metric === 'best_time') {
        rows = this.sql
          .exec<RawRow>(
            `SELECT a.account_id, a.username, a.display_name, a.is_guest, a.cosmetic_json, a.level,
                    COALESCE(cb.wins, 0) AS wins, COALESCE(cb.plays, 0) AS rounds_played,
                    cb.best_time_sec, a.challenge_points, COALESCE(s.total_push, 0) AS total_push
             FROM accounts a
             LEFT JOIN account_stats s ON s.account_id = a.account_id
             LEFT JOIN account_course_bests cb ON cb.account_id = a.account_id AND cb.course_id = ?
             WHERE cb.best_time_sec IS NOT NULL OR a.account_id = ?`,
            courseId,
            callerAccountId ?? '',
          )
          .toArray();
      } else {
        rows = this.sql
          .exec<RawRow>(
            `SELECT a.account_id, a.username, a.display_name, a.is_guest, a.cosmetic_json, a.level,
                    COALESCE(s.wins, 0) AS wins, COALESCE(s.rounds_played, 0) AS rounds_played,
                    s.best_time_sec, a.challenge_points, COALESCE(s.total_push, 0) AS total_push
             FROM accounts a
             LEFT JOIN account_stats s ON s.account_id = a.account_id
             WHERE COALESCE(s.rounds_played, 0) > 0 OR a.challenge_points > 0 OR a.account_id = ?`,
            callerAccountId ?? '',
          )
          .toArray();
      }
    }

    // Filter out entries with null best_time when metric === 'best_time' unless it's friends scope
    const sortable = rows.filter((r) => {
      if (metric === 'best_time' && scope !== 'friends') {
        return typeof r.best_time_sec === 'number' && r.best_time_sec > 0;
      }
      return true;
    });

    sortable.sort((a, b) => {
      if (metric === 'best_time') {
        const at = typeof a.best_time_sec === 'number' && a.best_time_sec > 0 ? a.best_time_sec : Number.POSITIVE_INFINITY;
        const bt = typeof b.best_time_sec === 'number' && b.best_time_sec > 0 ? b.best_time_sec : Number.POSITIVE_INFINITY;
        if (at !== bt) return at - bt;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.challenge_points - a.challenge_points;
      }
      if (metric === 'wins') {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.challenge_points !== a.challenge_points) return b.challenge_points - a.challenge_points;
        const at = typeof a.best_time_sec === 'number' ? a.best_time_sec : Number.POSITIVE_INFINITY;
        const bt = typeof b.best_time_sec === 'number' ? b.best_time_sec : Number.POSITIVE_INFINITY;
        return at - bt;
      }
      // challenge_points
      if (b.challenge_points !== a.challenge_points) return b.challenge_points - a.challenge_points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.level - a.level;
    });

    const ranked: LeaderboardEntry[] = sortable.map((r, idx) => ({
      rank: idx + 1,
      accountId: r.account_id,
      username: r.username,
      displayName: r.display_name,
      isGuest: r.is_guest === 1,
      cosmetic: parseCosmeticJson(r.cosmetic_json),
      level: r.level,
      wins: r.wins,
      roundsPlayed: r.rounds_played,
      bestTimeSec: r.best_time_sec ?? null,
      challengePoints: r.challenge_points,
      totalPushContribution: Math.round(r.total_push),
      isSelf: Boolean(callerAccountId && r.account_id === callerAccountId),
    }));

    const selfEntry = callerAccountId ? ranked.find((e) => e.accountId === callerAccountId) ?? null : null;

    return {
      metric,
      scope,
      courseId,
      weekKey,
      entries: ranked.slice(0, 50),
      selfEntry,
      total: ranked.length,
      timestamp: nowMs,
    };
  }

  public async handleFetch(request: Request, url: URL): Promise<Response> {
    const nowMs = Date.now();
    this.initIfNeeded(nowMs);
    const path = url.pathname;
    const authHeader = request.headers.get('authorization');

    if (path === '/internal/prog/guest' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { displayName?: string; cosmetic?: PlayerCosmetic };
      const accountId = crypto.randomUUID();
      const guestTag = accountId.slice(0, 4).toUpperCase();
      const displayName = sanitizeDisplayName(body.displayName ?? '', `قبطان ضيف ${guestTag}`);
      const candidateCosmetic = sanitizeCosmeticOrDefault(body.cosmetic, 0);
      const starterSet = new Set(getDefaultOwnedItemIds());
      const cosmetic = isCosmeticFullyOwned(candidateCosmetic, starterSet)
        ? candidateCosmetic
        : normalizePlayerCosmetic(undefined, 0);

      this.sql.exec(
        `INSERT INTO accounts (
          account_id, is_guest, username, username_lower, display_name, password_hash,
          cosmetic_json, xp, level, challenge_points, coins, is_seed, created_at, updated_at
        ) VALUES (?, 1, NULL, NULL, ?, NULL, ?, 0, 1, 0, 95, 0, ?, ?)`,
        accountId,
        displayName,
        JSON.stringify(cosmetic),
        nowMs,
        nowMs,
      );
      this.sql.exec(
        `INSERT INTO account_stats (account_id, updated_at) VALUES (?, ?)`,
        accountId,
        nowMs,
      );
      this.ensureStarterInventory(accountId, nowMs);

      const session = await this.issueSession(accountId, nowMs);
      const accountRow = this.getAccountRow(accountId)!;
      const resp: AuthHttpResponse = {
        token: session.token,
        expiresAt: session.expiresAt,
        ...this.buildSnapshotPayload(accountRow, nowMs),
      };
      return jsonResp(resp, 201);
    }

    if (path === '/internal/prog/register' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        username?: string;
        password?: string;
        displayName?: string;
        cosmetic?: PlayerCosmetic;
      };
      const uVal = validateUsername(typeof body.username === 'string' ? body.username : '');
      if (!uVal.ok) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', uVal.error) }, 400);
      }
      const pVal = validatePassword(typeof body.password === 'string' ? body.password : '');
      if (!pVal.ok) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', pVal.error) }, 400);
      }

      const dup = this.sql
        .exec<{ account_id: string }>(`SELECT account_id FROM accounts WHERE username_lower = ?`, uVal.lower)
        .toArray();
      if (dup.length > 0) {
        return jsonResp({ error: makeErrorPayload('USERNAME_TAKEN', ERROR_MESSAGES_AR.USERNAME_TAKEN) }, 409);
      }

      const accountId = crypto.randomUUID();
      const displayName = sanitizeDisplayName(body.displayName ?? '', uVal.username);
      const candidateCosmetic = sanitizeCosmeticOrDefault(body.cosmetic, 0);
      const starterSet = new Set(getDefaultOwnedItemIds());
      const cosmetic = isCosmeticFullyOwned(candidateCosmetic, starterSet)
        ? candidateCosmetic
        : normalizePlayerCosmetic(undefined, 0);
      const passwordHash = await hashPassword(pVal.password);

      try {
        this.sql.exec(
          `INSERT INTO accounts (
            account_id, is_guest, username, username_lower, display_name, password_hash,
            cosmetic_json, xp, level, challenge_points, coins, is_seed, created_at, updated_at
          ) VALUES (?, 0, ?, ?, ?, ?, ?, 0, 1, 0, 95, 0, ?, ?)`,
          accountId,
          uVal.username,
          uVal.lower,
          displayName,
          passwordHash,
          JSON.stringify(cosmetic),
          nowMs,
          nowMs,
        );
        this.sql.exec(`INSERT INTO account_stats (account_id, updated_at) VALUES (?, ?)`, accountId, nowMs);
        this.ensureStarterInventory(accountId, nowMs);
      } catch {
        return jsonResp({ error: makeErrorPayload('USERNAME_TAKEN', ERROR_MESSAGES_AR.USERNAME_TAKEN) }, 409);
      }

      const session = await this.issueSession(accountId, nowMs);
      const accountRow = this.getAccountRow(accountId)!;
      const resp: AuthHttpResponse = {
        token: session.token,
        expiresAt: session.expiresAt,
        ...this.buildSnapshotPayload(accountRow, nowMs),
      };
      return jsonResp(resp, 201);
    }

    if (path === '/internal/prog/login' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
      const uVal = validateUsername(typeof body.username === 'string' ? body.username : '');
      if (!uVal.ok || typeof body.password !== 'string' || body.password.length === 0) {
        return jsonResp({ error: makeErrorPayload('INVALID_CREDENTIALS', ERROR_MESSAGES_AR.INVALID_CREDENTIALS) }, 401);
      }

      const accountRow = this.sql
        .exec<AccountRow>(`SELECT * FROM accounts WHERE username_lower = ?`, uVal.lower)
        .toArray()[0];

      if (!accountRow || !accountRow.password_hash) {
        return jsonResp({ error: makeErrorPayload('INVALID_CREDENTIALS', ERROR_MESSAGES_AR.INVALID_CREDENTIALS) }, 401);
      }

      const valid = await verifyPassword(body.password, accountRow.password_hash);
      if (!valid) {
        return jsonResp({ error: makeErrorPayload('INVALID_CREDENTIALS', ERROR_MESSAGES_AR.INVALID_CREDENTIALS) }, 401);
      }

      const session = await this.issueSession(accountRow.account_id, nowMs);
      const resp: AuthHttpResponse = {
        token: session.token,
        expiresAt: session.expiresAt,
        ...this.buildSnapshotPayload(accountRow),
      };
      return jsonResp(resp, 200);
    }

    if (path === '/internal/prog/link' && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      if (caller.is_guest === 0) {
        return jsonResp({ error: makeErrorPayload('ALREADY_LINKED', ERROR_MESSAGES_AR.ALREADY_LINKED) }, 409);
      }

      const body = (await request.json().catch(() => ({}))) as {
        username?: string;
        password?: string;
        displayName?: string;
      };
      const uVal = validateUsername(typeof body.username === 'string' ? body.username : '');
      if (!uVal.ok) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', uVal.error) }, 400);
      }
      const pVal = validatePassword(typeof body.password === 'string' ? body.password : '');
      if (!pVal.ok) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', pVal.error) }, 400);
      }

      const dup = this.sql
        .exec<{ account_id: string }>(`SELECT account_id FROM accounts WHERE username_lower = ?`, uVal.lower)
        .toArray();
      if (dup.length > 0) {
        return jsonResp({ error: makeErrorPayload('USERNAME_TAKEN', ERROR_MESSAGES_AR.USERNAME_TAKEN) }, 409);
      }

      const passwordHash = await hashPassword(pVal.password);
      const nextDisplayName = body.displayName
        ? sanitizeDisplayName(body.displayName, caller.display_name)
        : caller.display_name;

      try {
        this.sql.exec(
          `UPDATE accounts
           SET is_guest = 0, username = ?, username_lower = ?, display_name = ?, password_hash = ?, updated_at = ?
           WHERE account_id = ?`,
          uVal.username,
          uVal.lower,
          nextDisplayName,
          passwordHash,
          nowMs,
          caller.account_id,
        );
      } catch {
        return jsonResp({ error: makeErrorPayload('USERNAME_TAKEN', ERROR_MESSAGES_AR.USERNAME_TAKEN) }, 409);
      }

      const session = await this.issueSession(caller.account_id, nowMs);
      const updated = this.getAccountRow(caller.account_id)!;
      const resp: AuthHttpResponse = {
        token: session.token,
        expiresAt: session.expiresAt,
        ...this.buildSnapshotPayload(updated),
      };
      return jsonResp(resp, 200);
    }

    if (path === '/internal/prog/logout' && request.method === 'POST') {
      if (authHeader) {
        const trimmed = authHeader.trim();
        const token = trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
        if (token) {
          const tokenHash = await hashToken(token);
          this.sql.exec(`DELETE FROM account_sessions WHERE token_hash = ?`, tokenHash);
        }
      }
      return jsonResp({ ok: true }, 200);
    }

    if (path === '/internal/prog/resolve-token' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const account = await this.resolveAccountFromBearer(typeof body.token === 'string' ? body.token : null, nowMs);
      if (!account) {
        return jsonResp({ found: false }, 200);
      }
      return jsonResp(
        {
          found: true,
          accountId: account.account_id,
          displayName: account.display_name,
          cosmetic: parseCosmeticJson(account.cosmetic_json),
          level: account.level,
        },
        200,
      );
    }

    if (path === '/internal/prog/me' && request.method === 'GET') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      return jsonResp(this.buildSnapshotPayload(caller), 200);
    }

    if (path === '/internal/prog/profile' && request.method === 'PATCH') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const body = (await request.json().catch(() => ({}))) as {
        displayName?: string;
        cosmetic?: PlayerCosmetic;
      };
      const nextDisplay =
        typeof body.displayName === 'string' && body.displayName.trim().length > 0
          ? sanitizeDisplayName(body.displayName, caller.display_name)
          : caller.display_name;

      let nextCosmetic = parseCosmeticJson(caller.cosmetic_json);
      if (body.cosmetic) {
        const valid = validateCosmetic(body.cosmetic, 0);
        if (!valid) {
          return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', 'بيانات المظهر غير صالحة.') }, 400);
        }
        const owned = new Set(this.getOwnedItemIds(caller.account_id, nowMs));
        if (!isCosmeticFullyOwned(valid, owned)) {
          return jsonResp({ error: makeErrorPayload('ITEM_NOT_OWNED') }, 403);
        }
        nextCosmetic = valid;
      }

      this.sql.exec(
        `UPDATE accounts SET display_name = ?, cosmetic_json = ?, updated_at = ? WHERE account_id = ?`,
        nextDisplay,
        JSON.stringify(nextCosmetic),
        nowMs,
        caller.account_id,
      );
      const updated = this.getAccountRow(caller.account_id)!;
      return jsonResp(this.buildSnapshotPayload(updated, nowMs), 200);
    }

    if (path === '/internal/prog/shop/buy' && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const body = (await request.json().catch(() => ({}))) as Partial<BuyCosmeticHttpRequest>;
      const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
      try {
        const result = this.buyCosmeticForAccount(caller.account_id, itemId, body.equip !== false, nowMs);
        return jsonResp(result, 200);
      } catch (err) {
        if (err instanceof ProtocolError) {
          return jsonResp({ error: err.toPayload() }, err.httpStatus);
        }
        throw err;
      }
    }

    if (path === '/internal/prog/shop/equip' && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const body = (await request.json().catch(() => ({}))) as Partial<EquipCosmeticHttpRequest>;
      try {
        const result = this.equipCosmeticForAccount(caller.account_id, body.cosmetic, nowMs);
        return jsonResp(result, 200);
      } catch (err) {
        if (err instanceof ProtocolError) {
          return jsonResp({ error: err.toPayload() }, err.httpStatus);
        }
        throw err;
      }
    }

    const claimQuestMatch = path.match(/^\/internal\/prog\/quests\/([^/]+)\/claim$/);
    if (claimQuestMatch && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const questId = decodeURIComponent(claimQuestMatch[1]);
      try {
        const result = this.claimQuestForAccount(caller.account_id, questId, nowMs);
        return jsonResp(result, 200);
      } catch (err) {
        if (err instanceof ProtocolError) {
          return jsonResp({ error: err.toPayload() }, err.httpStatus);
        }
        throw err;
      }
    }

    const claimTierMatch = path.match(/^\/internal\/prog\/season\/tiers\/(\d+)\/claim$/);
    if (claimTierMatch && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const tierNum = Number(claimTierMatch[1]);
      try {
        const result = this.claimSeasonTierForAccount(caller.account_id, tierNum, nowMs);
        return jsonResp(result, 200);
      } catch (err) {
        if (err instanceof ProtocolError) {
          return jsonResp({ error: err.toPayload() }, err.httpStatus);
        }
        throw err;
      }
    }

    const publicProfileMatch = path.match(/^\/internal\/prog\/profile\/([^/]+)$/);
    if (publicProfileMatch && request.method === 'GET') {
      const targetId = decodeURIComponent(publicProfileMatch[1]);
      const target = this.getAccountRow(targetId);
      if (!target) {
        return jsonResp({ error: makeErrorPayload('ACCOUNT_NOT_FOUND', ERROR_MESSAGES_AR.ACCOUNT_NOT_FOUND) }, 404);
      }
      const snap = this.buildSnapshotPayload(target, nowMs);
      return jsonResp({ profile: snap.profile, stats: snap.stats, achievements: snap.achievements }, 200);
    }

    if (path === '/internal/prog/start-solo-run' && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const body = (await request.json().catch(() => ({}))) as {
        courseId?: string;
        gameMode?: string;
        difficulty?: string;
      };
      const courseId = isValidCourseId(body.courseId) ? body.courseId : 'tropical';
      const gameMode = isValidGameMode(body.gameMode) ? body.gameMode : 'standard';
      const difficulty = isValidDifficulty(body.difficulty) ? body.difficulty : 'normal';
      const soloRunToken = crypto.randomUUID();
      this.sql.exec(
        `INSERT INTO solo_run_tokens (token, account_id, course_id, game_mode, difficulty, issued_at, consumed)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        soloRunToken,
        caller.account_id,
        courseId,
        gameMode,
        difficulty,
        nowMs,
      );
      return jsonResp({ soloRunToken, issuedAt: nowMs }, 201);
    }

    if (path === '/internal/prog/record-match' && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const body = (await request.json().catch(() => ({}))) as Partial<MatchSummaryInput>;
      if (body.isOnline === true) {
        return jsonResp(
          {
            error: makeErrorPayload(
              'RESULT_VERIFICATION_FAILED',
              'نتائج الجولات الجماعية تُوثّق من الخادم فقط.',
            ),
          },
          403,
        );
      }

      const token = typeof body.soloRunToken === 'string' ? body.soloRunToken.trim() : '';
      if (!token) {
        return jsonResp(
          {
            error: makeErrorPayload(
              'RESULT_VERIFICATION_FAILED',
              'رمز إثبات الجولة الفردية مفقود أو غير صالح.',
            ),
          },
          422,
        );
      }

      const submissionKey = typeof body.submissionKey === 'string' ? body.submissionKey.trim() : '';
      if (submissionKey) {
        const compositeKey = `${caller.account_id}:${submissionKey}`;
        const already = this.sql
          .exec<{ submission_key: string }>(
            `SELECT submission_key FROM match_submissions WHERE account_id = ? AND (submission_key = ? OR submission_key = ?)`,
            caller.account_id,
            compositeKey,
            submissionKey,
          )
          .toArray()[0];
        if (already) {
          const result = this.applyMatchForAccount(caller.account_id, body, nowMs);
          return jsonResp(result, 200);
        }
      }

      const tokenRow = this.sql
        .exec<{
          token: string;
          account_id: string;
          course_id: string;
          game_mode: string;
          difficulty: string;
          issued_at: number;
          consumed: number;
        }>(`SELECT * FROM solo_run_tokens WHERE token = ?`, token)
        .toArray()[0];

      if (
        !tokenRow ||
        tokenRow.account_id !== caller.account_id ||
        tokenRow.consumed !== 0 ||
        tokenRow.course_id !== body.courseId ||
        tokenRow.game_mode !== body.gameMode ||
        tokenRow.difficulty !== body.difficulty
      ) {
        return jsonResp(
          {
            error: makeErrorPayload(
              'RESULT_VERIFICATION_FAILED',
              'رمز إثبات الجولة غير صالح أو تم استخدامه مسبقاً أو لا يطابق إعدادات الجولة.',
            ),
          },
          422,
        );
      }

      this.sql.exec(`UPDATE solo_run_tokens SET consumed = 1 WHERE token = ?`, token);
      const result = this.applyMatchForAccount(caller.account_id, body, nowMs);
      return jsonResp(result, 200);
    }

    if (path === '/internal/prog/record-batch' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        participants?: BatchOnlineMatchParticipant[];
      };
      const participants = Array.isArray(body.participants) ? body.participants : [];
      const results: Record<string, { xpEarned: number; leveledUp: boolean }> = {};
      for (const item of participants.slice(0, 4)) {
        if (!item || typeof item.accountId !== 'string' || !item.match) continue;
        if (!verifyMatchResult(item.match, { isAuthoritativeRoom: true }).ok) continue;
        try {
          const r = this.applyMatchForAccount(item.accountId, item.match, nowMs);
          results[item.accountId] = { xpEarned: r.xpEarned, leveledUp: r.leveledUp };
        } catch {
          // ignore unknown accountId safely
        }
      }
      return jsonResp({ ok: true, results }, 200);
    }

    if (path === '/internal/prog/leaderboard' && request.method === 'GET') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      const rawMetric = url.searchParams.get('metric');
      const metric: LeaderboardMetric =
        rawMetric === 'wins' || rawMetric === 'challenge_points' ? rawMetric : 'best_time';
      const rawScope = url.searchParams.get('scope');
      const scope: LeaderboardScope =
        rawScope === 'weekly' || rawScope === 'friends' ? rawScope : 'global';
      const rawCourse = url.searchParams.get('courseId');
      const courseId: CourseId | 'all' =
        rawCourse && (ALL_COURSE_IDS as readonly string[]).includes(rawCourse)
          ? (rawCourse as CourseId)
          : 'all';
      const rawPartyIds = url.searchParams.get('partyIds') ?? '';
      const partyAccountIds = rawPartyIds
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 8);

      const lb = this.queryLeaderboard({
        metric,
        scope,
        courseId,
        callerAccountId: caller?.account_id ?? null,
        partyAccountIds,
        nowMs,
      });
      return jsonResp(lb, 200);
    }

    if (path === '/internal/prog/friends' && request.method === 'GET') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      return jsonResp({ friends: this.buildFriends(caller.account_id) }, 200);
    }

    if (path === '/internal/prog/friends' && request.method === 'POST') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const body = (await request.json().catch(() => ({}))) as { username?: string };
      const rawU = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
      if (!rawU) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', 'يرجى إدخال اسم المستخدم للصديق.') }, 400);
      }
      const target = this.sql
        .exec<AccountRow>(`SELECT * FROM accounts WHERE username_lower = ?`, rawU.toLowerCase())
        .toArray()[0];
      if (!target) {
        return jsonResp({ error: makeErrorPayload('ACCOUNT_NOT_FOUND', 'لم يتم العثور على لاعب بهذا الاسم.') }, 404);
      }
      if (target.account_id === caller.account_id) {
        return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', 'لا يمكنك إضافة نفسك كصديق.') }, 400);
      }
      this.sql.exec(
        `INSERT OR IGNORE INTO account_friends (account_id, friend_account_id, created_at) VALUES (?, ?, ?)`,
        caller.account_id,
        target.account_id,
        nowMs,
      );
      return jsonResp({ friends: this.buildFriends(caller.account_id) }, 200);
    }

    const delFriendMatch = path.match(/^\/internal\/prog\/friends\/([^/]+)$/);
    if (delFriendMatch && request.method === 'DELETE') {
      const caller = await this.resolveAccountFromBearer(authHeader, nowMs);
      if (!caller) {
        return jsonResp({ error: makeErrorPayload('UNAUTHORIZED') }, 401);
      }
      const friendId = decodeURIComponent(delFriendMatch[1]);
      this.sql.exec(
        `DELETE FROM account_friends WHERE account_id = ? AND friend_account_id = ?`,
        caller.account_id,
        friendId,
      );
      return jsonResp({ friends: this.buildFriends(caller.account_id) }, 200);
    }

    return jsonResp({ error: makeErrorPayload('INVALID_MESSAGE', 'مسار التقدم غير معروف.') }, 404);
  }
}
