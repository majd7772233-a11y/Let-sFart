import type {
  AchievementDef,
  AchievementId,
  CourseBestRecord,
  CourseId,
  GameMode,
  MatchSummaryInput,
  PlayerCareerStats,
  PlayerSimState,
  QuestCadence,
  QuestObjectiveKind,
  QuestState,
  RareEventDef,
  RareEventState,
  WorldSimulationState,
} from './types.ts';

export const ALL_COURSE_IDS: readonly CourseId[] = [
  'tropical',
  'volcanic',
  'glacial',
  'factory',
  'storm',
];

export const ACHIEVEMENT_CATALOG: readonly AchievementDef[] = [
  {
    id: 'first_voyage',
    titleAr: 'الرحلة الأولى',
    descriptionAr: 'أكمل أول جولة بنجاح ووصل بالطوف إلى النهاية.',
    icon: '🚣',
    points: 20,
    category: 'milestone',
  },
  {
    id: 'speed_demon',
    titleAr: 'صاروخ البحر',
    descriptionAr: 'أنهِ مسارًا في زمن قياسي أقل من 75 ثانية.',
    icon: '⚡',
    points: 50,
    category: 'speed',
  },
  {
    id: 'untouchable',
    titleAr: 'توازن مثالي',
    descriptionAr: 'أنهِ جولة فوز كاملة دون أي سقوط للطوف.',
    icon: '🛡️',
    points: 45,
    category: 'mastery',
  },
  {
    id: 'hard_gate_master',
    titleAr: 'قاهر البوابات الصعبة',
    descriptionAr: 'تجاوز 4 بوابات صعبة وأنهِ جولة في مستوى «صعب» أو مسار العاصفة/المصنع.',
    icon: '🚧',
    points: 60,
    category: 'mastery',
  },
  {
    id: 'win_streak_5',
    titleAr: 'ربان خمس نجوم',
    descriptionAr: 'حقق 5 انتصارات عبر مختلف المسارات.',
    icon: '⭐',
    points: 40,
    category: 'milestone',
  },
  {
    id: 'win_legend_15',
    titleAr: 'أسطورة الطوف',
    descriptionAr: 'حقق 15 انتصارًا ورسّخ اسمك في لوحة المتصدرين.',
    icon: '👑',
    points: 100,
    category: 'milestone',
  },
  {
    id: 'item_collector',
    titleAr: 'خبير العدس والفول',
    descriptionAr: 'استخدم واجمع 15 علبة وأداة عبر جولاتك.',
    icon: '🥫',
    points: 35,
    category: 'mastery',
  },
  {
    id: 'engine_of_crew',
    titleAr: 'محرك الطاقم',
    descriptionAr: 'ساهم بإجمالي 3,000 وحدة دفع لصالح الطوف.',
    icon: '💨',
    points: 50,
    category: 'teamwork',
  },
  {
    id: 'harmony_conductor',
    titleAr: 'مايسترو التناغم',
    descriptionAr: 'فعّل نفخة التناغم الخارقة بالتعاون مع الطاقم.',
    icon: '🎵',
    points: 30,
    category: 'teamwork',
  },
  {
    id: 'treasure_hunter',
    titleAr: 'صائد الكنوز',
    descriptionAr: 'اجمع 150 نقطة أو أكثر في نمط جمع الكنوز.',
    icon: '💎',
    points: 45,
    category: 'mastery',
  },
  {
    id: 'survivor_300',
    titleAr: 'صامد الأمواج',
    descriptionAr: 'اقطع مسافة 300 متر أو أكثر في وضع البقاء.',
    icon: '🌊',
    points: 55,
    category: 'mastery',
  },
  {
    id: 'all_courses_explorer',
    titleAr: 'رحّالة العوالم الخمسة',
    descriptionAr: 'حقق الفوز في جميع المسارات الخمسة المتاحة.',
    icon: '🧭',
    points: 90,
    category: 'milestone',
  },
];

export const ACHIEVEMENT_MAP: Record<AchievementId, AchievementDef> = Object.fromEntries(
  ACHIEVEMENT_CATALOG.map((a) => [a.id, a]),
) as Record<AchievementId, AchievementDef>;

export function createEmptyCourseBests(): Record<CourseId, CourseBestRecord> {
  return {
    tropical: { courseId: 'tropical', bestTimeSec: null, bestSurvivalDistance: 0, bestTreasureScore: 0, wins: 0, plays: 0 },
    volcanic: { courseId: 'volcanic', bestTimeSec: null, bestSurvivalDistance: 0, bestTreasureScore: 0, wins: 0, plays: 0 },
    glacial: { courseId: 'glacial', bestTimeSec: null, bestSurvivalDistance: 0, bestTreasureScore: 0, wins: 0, plays: 0 },
    factory: { courseId: 'factory', bestTimeSec: null, bestSurvivalDistance: 0, bestTreasureScore: 0, wins: 0, plays: 0 },
    storm: { courseId: 'storm', bestTimeSec: null, bestSurvivalDistance: 0, bestTreasureScore: 0, wins: 0, plays: 0 },
  };
}

export function createEmptyCareerStats(): PlayerCareerStats {
  return {
    roundsPlayed: 0,
    wins: 0,
    losses: 0,
    totalFalls: 0,
    bestTimeSec: null,
    itemsUsed: 0,
    totalPushContribution: 0,
    totalFartTime: 0,
    totalScore: 0,
    bestSurvivalDistance: 0,
    bestTreasureScore: 0,
    hardGatesPassed: 0,
    harmonyCombos: 0,
    courseBests: createEmptyCourseBests(),
  };
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): { ok: true; username: string; lower: string } | { ok: false; error: string } {
  const cleaned = raw.trim();
  if (cleaned.length < 3 || cleaned.length > 20) {
    return { ok: false, error: 'اسم المستخدم يجب أن يكون بين 3 و20 حرفًا.' };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(cleaned)) {
    return { ok: false, error: 'اسم المستخدم يقبل أحرفًا إنجليزية وأرقامًا والرموز (_ . -) فقط.' };
  }
  return { ok: true, username: cleaned, lower: cleaned.toLowerCase() };
}

export function validatePassword(raw: string): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.length < 6 || raw.length > 72) {
    return { ok: false, error: 'كلمة المرور يجب أن تكون بين 6 و72 حرفًا.' };
  }
  return { ok: true, password: raw };
}

export function sanitizeDisplayName(raw: string, fallback = 'قبطان'): string {
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, 20);
  return clean.length > 0 ? clean : fallback;
}

const RANK_TITLES_AR = [
  'ملاح مبتدئ',
  'بحّار النسمات',
  'مجدّف ماهر',
  'ربان الموج',
  'قبطان الريح',
  'مهندس العواصف',
  'زعيم المضيق',
  'أمير البحار',
  'أسطورة الطوف',
];

export function xpNeededForLevel(level: number): number {
  const safe = Math.max(1, Math.floor(level));
  return 100 + (safe - 1) * 65;
}

export function computeLevelFromXp(totalXp: number): {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  rankTitleAr: string;
} {
  let remaining = Math.max(0, Math.floor(Number.isFinite(totalXp) ? totalXp : 0));
  let level = 1;
  while (level < 99) {
    const needed = xpNeededForLevel(level);
    if (remaining < needed) {
      const rankIdx = Math.min(RANK_TITLES_AR.length - 1, Math.floor((level - 1) / 3));
      return {
        level,
        xp: Math.max(0, Math.floor(totalXp)),
        xpIntoLevel: remaining,
        xpForNextLevel: needed,
        rankTitleAr: RANK_TITLES_AR[rankIdx],
      };
    }
    remaining -= needed;
    level += 1;
  }
  return {
    level: 99,
    xp: Math.max(0, Math.floor(totalXp)),
    xpIntoLevel: 0,
    xpForNextLevel: xpNeededForLevel(99),
    rankTitleAr: RANK_TITLES_AR[RANK_TITLES_AR.length - 1],
  };
}

export function calculateXpForRound(match: MatchSummaryInput): number {
  const baseXp = match.outcome === 'victory' ? 55 : 22;
  const survivalBonus =
    match.gameMode === 'survival' ? Math.min(80, Math.round(match.survivalDistance / 8)) : 0;
  const treasureBonus =
    match.gameMode === 'treasure' ? Math.min(50, Math.round(match.treasureScore / 6)) : 0;
  const pushBonus = Math.min(45, Math.round(Math.max(0, match.pushContribution) / 25));
  const itemBonus = Math.min(20, Math.max(0, match.itemsUsed) * 4);
  const diffMult =
    match.difficulty === 'hard' ? 1.35 : match.difficulty === 'easy' ? 0.85 : 1.0;
  const cleanBonus = match.outcome === 'victory' && match.falls === 0 ? 20 : 0;
  return Math.max(10, Math.round((baseXp + survivalBonus + treasureBonus + pushBonus + itemBonus + cleanBonus) * diffMult));
}

export function evaluateNewAchievements(
  stats: PlayerCareerStats,
  match: MatchSummaryInput,
  alreadyUnlockedIds: ReadonlySet<AchievementId>,
): AchievementDef[] {
  const unlocked: AchievementDef[] = [];
  const check = (id: AchievementId, condition: boolean) => {
    if (condition && !alreadyUnlockedIds.has(id)) {
      unlocked.push(ACHIEVEMENT_MAP[id]);
    }
  };

  const isTimedWin = match.outcome === 'victory' && match.gameMode !== 'survival';

  check('first_voyage', stats.wins >= 1);
  check('speed_demon', isTimedWin && match.elapsedTimeSec > 5 && match.elapsedTimeSec < 75);
  check('untouchable', isTimedWin && match.falls === 0);
  check(
    'hard_gate_master',
    isTimedWin &&
      match.hardGatesPassed >= 4 &&
      match.falls <= 2 &&
      (match.difficulty === 'hard' || match.courseId === 'storm' || match.courseId === 'factory'),
  );
  check('win_streak_5', stats.wins >= 5);
  check('win_legend_15', stats.wins >= 15);
  check('item_collector', stats.itemsUsed >= 15);
  check('engine_of_crew', stats.totalPushContribution >= 3000);
  check('harmony_conductor', match.harmonyCombos >= 1 || stats.harmonyCombos >= 1);
  check('treasure_hunter', match.gameMode === 'treasure' && match.treasureScore >= 150);
  check('survivor_300', match.gameMode === 'survival' && match.survivalDistance >= 300);
  check(
    'all_courses_explorer',
    ALL_COURSE_IDS.every((c) => (stats.courseBests[c]?.wins ?? 0) >= 1),
  );

  return unlocked;
}

export function computeChallengePoints(achievementIds: Iterable<AchievementId>): number {
  let total = 0;
  for (const id of achievementIds) {
    total += ACHIEVEMENT_MAP[id]?.points ?? 0;
  }
  return total;
}

export function getIsoWeekKey(timestampMs = Date.now()): string {
  const date = new Date(timestampMs);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getPlayerPushValue(player: PlayerSimState): number {
  if (typeof player.stats.pushImpulseSum === 'number' && Number.isFinite(player.stats.pushImpulseSum) && player.stats.pushImpulseSum > 0) {
    return Math.round(player.stats.pushImpulseSum);
  }
  return Math.round(Math.max(0, player.stats.totalFartTime) * 18);
}

export function computePushShares(players: readonly PlayerSimState[]): {
  slot: 0 | 1 | 2 | 3;
  name: string;
  isBot: boolean;
  connected: boolean;
  pushScore: number;
  sharePct: number;
  itemsUsed: number;
  fartCount: number;
}[] {
  const active = players.filter((p) => p.connected);
  const totalPush = active.reduce((acc, p) => acc + getPlayerPushValue(p), 0);
  return active.map((p) => {
    const pushScore = getPlayerPushValue(p);
    const sharePct = totalPush > 0 ? Math.round((pushScore / totalPush) * 100) : Math.round(100 / Math.max(1, active.length));
    return {
      slot: p.slot,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      pushScore,
      sharePct,
      itemsUsed: p.stats.itemsUsed ?? 0,
      fartCount: p.stats.fartCount,
    };
  });
}

export function buildMatchSummaryFromSim(
  sim: WorldSimulationState,
  slot: 0 | 1 | 2 | 3,
  submissionKey: string,
): MatchSummaryInput {
  const player = sim.players[slot];
  const pushContribution = getPlayerPushValue(player);
  const itemsUsed = Math.max(player.stats.itemsUsed ?? 0, sim.mode === 'solo' ? sim.itemsCollectedCount ?? 0 : 0);
  const isVictory =
    sim.gameMode === 'survival'
      ? sim.survivalDistance >= 120
      : sim.runOutcome === 'victory';

  return {
    submissionKey,
    courseId: sim.courseId,
    gameMode: sim.gameMode,
    difficulty: sim.difficulty,
    outcome: isVictory ? 'victory' : 'defeat',
    elapsedTimeSec: Number(Math.max(0, sim.elapsedTime).toFixed(2)),
    falls: Math.max(0, sim.falls),
    itemsUsed,
    pushContribution,
    fartTimeSec: Number(Math.max(0, player.stats.totalFartTime).toFixed(2)),
    survivalDistance: Math.max(0, Math.round(sim.survivalDistance ?? 0)),
    treasureScore: Math.max(0, Math.round(sim.treasureScore ?? 0)),
    harmonyCombos: Math.max(0, sim.harmonySuperFartCount ?? sim.harmonyComboCount ?? 0),
    hardGatesPassed: Math.max(0, sim.hardGatesPassed ?? 0),
    minRaftHp: Math.max(0, Math.round(sim.minRaftHp ?? sim.raftHp ?? 100)),
    cleanCheckpoints: Math.max(0, Math.round(sim.cleanCheckpoints ?? 0)),
    collisionCount: Math.max(0, Math.round(sim.collisionCount ?? 0)),
    isOnline: sim.mode === 'online',
  };
}

// ==========================================
// PROG-06..10: Quests, Coins, Seasons & Rare Sudden Events
// ==========================================

export function getUtcDayKey(timestampMs = Date.now()): string {
  const d = new Date(timestampMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getNextDailyResetMs(timestampMs = Date.now()): number {
  const d = new Date(timestampMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

export function getNextWeeklyResetMs(timestampMs = Date.now()): number {
  const d = new Date(timestampMs);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const dayNum = utc.getUTCDay() || 7; // Mon=1 .. Sun=7
  const daysUntilNextMonday = 8 - dayNum;
  utc.setUTCDate(utc.getUTCDate() + daysUntilNextMonday);
  return utc.getTime();
}

export function calculateCoinsForRound(match: MatchSummaryInput): number {
  const baseCoins = match.outcome === 'victory' ? 35 : 15;
  const treasureBonus = Math.min(35, Math.round(Math.max(0, match.treasureScore) / 5));
  const survivalBonus =
    match.gameMode === 'survival' ? Math.min(35, Math.round(Math.max(0, match.survivalDistance) / 12)) : 0;
  const cleanBonus = Math.min(18, Math.max(0, match.cleanCheckpoints ?? 0) * 6);
  const pushBonus = Math.min(20, Math.round(Math.max(0, match.pushContribution) / 45));
  const diffMult =
    match.difficulty === 'hard' ? 1.25 : match.difficulty === 'easy' ? 0.9 : 1.0;
  return Math.max(10, Math.round((baseCoins + treasureBonus + survivalBonus + cleanBonus + pushBonus) * diffMult));
}

export function getAchievementCoinReward(ach: AchievementDef): number {
  return Math.max(25, Math.round(ach.points * 1.5));
}

export function calculateSeasonPointsForRound(match: MatchSummaryInput): number {
  const base = match.outcome === 'victory' ? 40 : 22;
  const activeBonus =
    match.courseId === ACTIVE_SEASON_DEF.featuredCourseId || match.gameMode === ACTIVE_SEASON_DEF.featuredGameMode
      ? 12
      : 0;
  return base + activeBonus;
}

export interface QuestTemplateDef {
  templateId: string;
  cadence: QuestCadence;
  titleAr: string;
  descriptionAr: string;
  icon: string;
  objective: QuestObjectiveKind;
  goal: number;
  xpReward: number;
  coinsReward: number;
  seasonPointsReward: number;
}

export const DAILY_QUEST_POOL: readonly QuestTemplateDef[] = [
  {
    templateId: 'daily_play_3',
    cadence: 'daily',
    titleAr: 'ثلاث رحلات بحرية',
    descriptionAr: 'أكمل 3 جولات في أي مسار أو نمط لعب.',
    icon: '🚣',
    objective: 'play_rounds',
    goal: 3,
    xpReward: 45,
    coinsReward: 65,
    seasonPointsReward: 35,
  },
  {
    templateId: 'daily_treasure_60',
    cadence: 'daily',
    titleAr: 'صياد الكنوز اليومي',
    descriptionAr: 'اجمع 60 نقطة من العملات والكنوز أثناء الإبحار.',
    icon: '💎',
    objective: 'treasure_points',
    goal: 60,
    xpReward: 55,
    coinsReward: 80,
    seasonPointsReward: 40,
  },
  {
    templateId: 'daily_clean_cp_2',
    cadence: 'daily',
    titleAr: 'قيادة نظيفة بلا صدمات',
    descriptionAr: 'الوصول إلى نقطتي حفظ دون أي اصطدام للطوف.',
    icon: '🛡️',
    objective: 'clean_checkpoints',
    goal: 2,
    xpReward: 65,
    coinsReward: 90,
    seasonPointsReward: 45,
  },
  {
    templateId: 'daily_items_3',
    cadence: 'daily',
    titleAr: 'طاهي العدس والفول',
    descriptionAr: 'اجمع واستخدم 3 صناديق أو علب أدوات على المسار.',
    icon: '🥫',
    objective: 'items_used',
    goal: 3,
    xpReward: 45,
    coinsReward: 65,
    seasonPointsReward: 35,
  },
  {
    templateId: 'daily_push_350',
    cadence: 'daily',
    titleAr: 'محرك الدفع القوي',
    descriptionAr: 'ساهم بـ 350 وحدة دفع في تحريك الطوف.',
    icon: '💨',
    objective: 'push_contribution',
    goal: 350,
    xpReward: 50,
    coinsReward: 75,
    seasonPointsReward: 35,
  },
  {
    templateId: 'daily_win_1',
    cadence: 'daily',
    titleAr: 'انتصار اليوم',
    descriptionAr: 'حقق الفوز في جولة واحدة على أي مسار.',
    icon: '🏆',
    objective: 'win_rounds',
    goal: 1,
    xpReward: 60,
    coinsReward: 85,
    seasonPointsReward: 40,
  },
];

export const WEEKLY_QUEST_POOL: readonly QuestTemplateDef[] = [
  {
    templateId: 'weekly_play_10',
    cadence: 'weekly',
    titleAr: 'بحّار الأسبوع المثابر',
    descriptionAr: 'أنهِ 10 جولات عبر مختلف المسارات خلال الأسبوع.',
    icon: '🧭',
    objective: 'play_rounds',
    goal: 10,
    xpReward: 140,
    coinsReward: 200,
    seasonPointsReward: 100,
  },
  {
    templateId: 'weekly_wins_4',
    cadence: 'weekly',
    titleAr: 'أربع رايات نصر',
    descriptionAr: 'حقق 4 انتصارات هذا الأسبوع في الفردي أو الأونلاين.',
    icon: '👑',
    objective: 'win_rounds',
    goal: 4,
    xpReward: 170,
    coinsReward: 240,
    seasonPointsReward: 120,
  },
  {
    templateId: 'weekly_treasure_250',
    cadence: 'weekly',
    titleAr: 'خزينة القبطان الأسبوعية',
    descriptionAr: 'اجمع 250 نقطة كنوز إجمالًا خلال الأسبوع.',
    icon: '💰',
    objective: 'treasure_points',
    goal: 250,
    xpReward: 160,
    coinsReward: 230,
    seasonPointsReward: 110,
  },
  {
    templateId: 'weekly_clean_cp_6',
    cadence: 'weekly',
    titleAr: 'العبور السلس',
    descriptionAr: 'تجاوز 6 نقاط حفظ نظيفة دون أي اصطدام.',
    icon: '✨',
    objective: 'clean_checkpoints',
    goal: 6,
    xpReward: 185,
    coinsReward: 260,
    seasonPointsReward: 125,
  },
  {
    templateId: 'weekly_push_1800',
    cadence: 'weekly',
    titleAr: 'عاصفة الدفع الجبارة',
    descriptionAr: 'ساهم بـ 1,800 وحدة دفع لصالح الطوف خلال الأسبوع.',
    icon: '⚡',
    objective: 'push_contribution',
    goal: 1800,
    xpReward: 150,
    coinsReward: 215,
    seasonPointsReward: 105,
  },
];

function hashPeriodKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function selectQuestTemplatesForPeriod(
  pool: readonly QuestTemplateDef[],
  periodKey: string,
  count = 3,
): QuestTemplateDef[] {
  const start = hashPeriodKey(periodKey) % pool.length;
  const picked: QuestTemplateDef[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i += 1) {
    picked.push(pool[(start + i) % pool.length]);
  }
  return picked;
}

export function generateDailyQuests(dayKey: string, nowMs = Date.now()): QuestState[] {
  const resetAt = getNextDailyResetMs(nowMs);
  return selectQuestTemplatesForPeriod(DAILY_QUEST_POOL, dayKey, 3).map((tpl) => ({
    questId: `daily:${dayKey}:${tpl.templateId}`,
    templateId: tpl.templateId,
    cadence: 'daily',
    periodKey: dayKey,
    titleAr: tpl.titleAr,
    descriptionAr: tpl.descriptionAr,
    icon: tpl.icon,
    objective: tpl.objective,
    progress: 0,
    goal: tpl.goal,
    xpReward: tpl.xpReward,
    coinsReward: tpl.coinsReward,
    seasonPointsReward: tpl.seasonPointsReward,
    completedAt: null,
    claimedAt: null,
    resetAt,
  }));
}

export function generateWeeklyQuests(weekKey: string, nowMs = Date.now()): QuestState[] {
  const resetAt = getNextWeeklyResetMs(nowMs);
  return selectQuestTemplatesForPeriod(WEEKLY_QUEST_POOL, weekKey, 3).map((tpl) => ({
    questId: `weekly:${weekKey}:${tpl.templateId}`,
    templateId: tpl.templateId,
    cadence: 'weekly',
    periodKey: weekKey,
    titleAr: tpl.titleAr,
    descriptionAr: tpl.descriptionAr,
    icon: tpl.icon,
    objective: tpl.objective,
    progress: 0,
    goal: tpl.goal,
    xpReward: tpl.xpReward,
    coinsReward: tpl.coinsReward,
    seasonPointsReward: tpl.seasonPointsReward,
    completedAt: null,
    claimedAt: null,
    resetAt,
  }));
}

export function getQuestDeltaForMatch(objective: QuestObjectiveKind, match: MatchSummaryInput): number {
  switch (objective) {
    case 'play_rounds':
      return 1;
    case 'win_rounds':
      return match.outcome === 'victory' ? 1 : 0;
    case 'treasure_points':
      return Math.max(0, Math.round(match.treasureScore));
    case 'clean_checkpoints':
      return Math.max(0, Math.round(match.cleanCheckpoints ?? 0));
    case 'items_used':
      return Math.max(0, Math.round(match.itemsUsed));
    case 'push_contribution':
      return Math.max(0, Math.round(match.pushContribution));
    case 'survival_distance':
      return match.gameMode === 'survival' ? Math.max(0, Math.round(match.survivalDistance)) : 0;
  }
}

export interface SeasonTierDef {
  tier: number;
  requiredPoints: number;
  titleAr: string;
  coinsReward: number;
  xpReward: number;
  cosmeticItemId: string | null;
}

export interface SeasonChallengeDef {
  challengeId: string;
  titleAr: string;
  descriptionAr: string;
  objective: 'season_rounds' | 'season_storm_or_treasure' | 'season_clean_checkpoints';
  goal: number;
  xpReward: number;
  coinsReward: number;
  seasonPointsReward: number;
}

export const ACTIVE_SEASON_DEF = {
  seasonId: 'season_1_storm_explorers',
  titleAr: 'موسم المستكشفين والعاصفة',
  subtitleAr: 'مسار مكافآت مجاني بالكامل يتقدّم من لعب الجولات والمهام دون أي مشتريات مدفوعة.',
  featuredCourseId: 'storm' as CourseId,
  featuredGameMode: 'treasure' as GameMode,
  maxPoints: 600,
  tiers: [
    {
      tier: 1,
      requiredPoints: 60,
      titleAr: 'حقيبة البحّار المبتدئة',
      coinsReward: 90,
      xpReward: 60,
      cosmeticItemId: null,
    },
    {
      tier: 2,
      requiredPoints: 140,
      titleAr: 'غطاء العاصفة النادر',
      coinsReward: 110,
      xpReward: 80,
      cosmeticItemId: 'hat:storm_hood',
    },
    {
      tier: 3,
      requiredPoints: 240,
      titleAr: 'صندوق العملات الموسمية',
      coinsReward: 150,
      xpReward: 100,
      cosmeticItemId: null,
    },
    {
      tier: 4,
      requiredPoints: 360,
      titleAr: 'غبار النجوم الذهبي',
      coinsReward: 140,
      xpReward: 120,
      cosmeticItemId: 'trail:golden_confetti',
    },
    {
      tier: 5,
      requiredPoints: 480,
      titleAr: 'منحة قبطان المضيق',
      coinsReward: 210,
      xpReward: 150,
      cosmeticItemId: null,
    },
    {
      tier: 6,
      requiredPoints: 600,
      titleAr: 'رداء الأسطورة الملكي',
      coinsReward: 260,
      xpReward: 200,
      cosmeticItemId: 'outfit:royal_robe',
    },
  ] satisfies readonly SeasonTierDef[],
  challenges: [
    {
      challengeId: 's1_storm_or_treasure',
      titleAr: 'تحدي العاصفة والكنوز',
      descriptionAr: 'أكمل 4 جولات في مسار العاصفة البحرية أو نمط جمع الكنوز.',
      objective: 'season_storm_or_treasure',
      goal: 4,
      xpReward: 140,
      coinsReward: 180,
      seasonPointsReward: 90,
    },
    {
      challengeId: 's1_clean_sailor',
      titleAr: 'ملاحة بلا خدش',
      descriptionAr: 'احصد 8 نقاط حفظ نظيفة دون اصطدام خلال الموسم.',
      objective: 'season_clean_checkpoints',
      goal: 8,
      xpReward: 160,
      coinsReward: 210,
      seasonPointsReward: 110,
    },
    {
      challengeId: 's1_voyages_12',
      titleAr: 'رحّالة الموسم الأول',
      descriptionAr: 'أكمل 12 جولة إجمالًا خلال الموسم الأول.',
      objective: 'season_rounds',
      goal: 12,
      xpReward: 200,
      coinsReward: 260,
      seasonPointsReward: 130,
    },
  ] satisfies readonly SeasonChallengeDef[],
};

export function getSeasonChallengeDelta(def: SeasonChallengeDef, match: MatchSummaryInput): number {
  switch (def.objective) {
    case 'season_rounds':
      return 1;
    case 'season_storm_or_treasure':
      return match.courseId === 'storm' || match.gameMode === 'treasure' ? 1 : 0;
    case 'season_clean_checkpoints':
      return Math.max(0, Math.round(match.cleanCheckpoints ?? 0));
  }
}

export const RARE_EVENT_POOL: readonly RareEventDef[] = [
  {
    eventTypeId: 'aurora_treasure_rush',
    titleAr: 'ظاهرة مدّ الكنوز النادرة',
    descriptionAr: 'ظهرت موجة مفاجئة من الكنوز في الجزر الاستوائية! أكمل جولتين لاقتناص المكافأة النادرة.',
    featuredCourseId: 'tropical',
    featuredGameMode: 'treasure',
    bonusGoalRounds: 2,
    xpBonus: 120,
    coinsBonus: 190,
    rewardItemId: 'trail:golden_confetti',
    accentHex: '#ffd13b',
  },
  {
    eventTypeId: 'volcanic_turbo_surge',
    titleAr: 'ثوران الجمر المفاجئ',
    descriptionAr: 'نشاط بركاني نادر يفتح تحدي السرعة الفائق! أكمل جولتين للحصول على مكافأة نادرة.',
    featuredCourseId: 'volcanic',
    featuredGameMode: 'time_trial',
    bonusGoalRounds: 2,
    xpBonus: 140,
    coinsBonus: 220,
    rewardItemId: 'outfit:volcanic_armor',
    accentHex: '#f97316',
  },
  {
    eventTypeId: 'storm_legend_trial',
    titleAr: 'نداء السفينة الذهبية النادر',
    descriptionAr: 'ظاهرة بحرية نادرة في العاصفة! أكمل جولتين بنجاح لفتح مظهر السفينة الذهبية.',
    featuredCourseId: 'storm',
    featuredGameMode: 'standard',
    bonusGoalRounds: 2,
    xpBonus: 170,
    coinsBonus: 270,
    rewardItemId: 'raft_skin:golden_galleon',
    accentHex: '#38bdf8',
  },
];

export function createIdleRareEventState(occurrencesCount = 0): RareEventState {
  return {
    active: false,
    eventInstanceId: null,
    eventTypeId: null,
    titleAr: null,
    descriptionAr: null,
    featuredCourseId: null,
    featuredGameMode: null,
    roundsRemaining: 0,
    roundsCompleted: 0,
    bonusGoalRounds: 0,
    xpBonus: 0,
    coinsBonus: 0,
    rewardItemId: null,
    completed: false,
    accentHex: '#ffd13b',
    occurrencesCount,
  };
}

/**
 * Pure non-time-bound trigger evaluation for Rare Sudden Events (PROG-10).
 * Never uses wall-clock schedules or dates; depends only on rounds played & chance.
 */
export function evaluateRareEventTrigger(params: {
  roundsSinceLastEvent: number;
  currentActive: boolean;
  rollValue: number; // 0..1
  selectionSeed: number;
}): RareEventDef | null {
  const { roundsSinceLastEvent, currentActive, rollValue, selectionSeed } = params;
  if (currentActive) return null;
  if (roundsSinceLastEvent < 2) return null;

  // Guarantees sudden appearance if player goes several rounds without one,
  // while staying rare and unpredictable in normal play (~15%-35% after cooldown).
  const chance = roundsSinceLastEvent >= 6 ? 1 : Math.min(0.42, 0.14 + (roundsSinceLastEvent - 2) * 0.07);
  if (rollValue >= chance) {
    return null;
  }

  const idx = Math.abs(Math.floor(selectionSeed)) % RARE_EVENT_POOL.length;
  return RARE_EVENT_POOL[idx];
}
