import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_SEASON_DEF,
  buildMatchSummaryFromSim,
  calculateCoinsForRound,
  calculateSeasonPointsForRound,
  calculateXpForRound,
  computeChallengePoints,
  computeLevelFromXp,
  computePushShares,
  createEmptyCareerStats,
  evaluateNewAchievements,
  evaluateRareEventTrigger,
  generateDailyQuests,
  generateWeeklyQuests,
  getAchievementCoinReward,
  getIsoWeekKey,
  getNextDailyResetMs,
  getNextWeeklyResetMs,
  getQuestDeltaForMatch,
  getUtcDayKey,
  validatePassword,
  validateUsername,
} from './progression.ts';
import {
  COSMETIC_CATALOG,
  COSMETIC_ITEM_MAP,
  SHOP_CATEGORY_LABELS_AR,
  applyShopItemToCosmetic,
  getDefaultOwnedItemIds,
  normalizePlayerCosmetic,
} from './cosmetics.ts';
import { getCourseById } from './course.ts';
import { createInitialSimState, stepSimulation } from './physics.ts';
import type { AchievementId, CosmeticCategory, MatchSummaryInput } from './types.ts';

test('username and password validators enforce safe constraints', () => {
  assert.equal(validateUsername('ab').ok, false);
  assert.equal(validateUsername('bad name!').ok, false);
  assert.equal(validateUsername('Captain_42').ok, true);
  assert.equal(validatePassword('12345').ok, false);
  assert.equal(validatePassword('secret123').ok, true);
});

test('XP and leveling curve advances levels and rank titles cleanly', () => {
  const lvl1 = computeLevelFromXp(0);
  assert.equal(lvl1.level, 1);
  assert.equal(lvl1.xpIntoLevel, 0);
  assert.equal(lvl1.xpForNextLevel, 100);

  const lvl2 = computeLevelFromXp(125);
  assert.equal(lvl2.level, 2);
  assert.equal(lvl2.xpIntoLevel, 25);
  assert.equal(lvl2.xpForNextLevel, 165);
});

test('calculateXpForRound rewards clean difficulty victories and contributions', () => {
  const baseMatch: MatchSummaryInput = {
    submissionKey: 'k1',
    courseId: 'storm',
    gameMode: 'standard',
    difficulty: 'hard',
    outcome: 'victory',
    elapsedTimeSec: 64,
    falls: 0,
    itemsUsed: 4,
    pushContribution: 500,
    fartTimeSec: 22,
    survivalDistance: 0,
    treasureScore: 0,
    harmonyCombos: 1,
    hardGatesPassed: 5,
    minRaftHp: 80,
    isOnline: false,
  };
  const xp = calculateXpForRound(baseMatch);
  assert.ok(xp > 120);
});

test('evaluateNewAchievements detects speed, clean, hard gate, crew engine, and 5-course mastery without duplicates', () => {
  const stats = createEmptyCareerStats();
  stats.roundsPlayed = 15;
  stats.wins = 15;
  stats.itemsUsed = 18;
  stats.totalPushContribution = 3500;
  stats.harmonyCombos = 2;
  for (const c of ['tropical', 'volcanic', 'glacial', 'factory', 'storm'] as const) {
    stats.courseBests[c].wins = 3;
    stats.courseBests[c].plays = 3;
  }

  const match: MatchSummaryInput = {
    submissionKey: 'k2',
    courseId: 'storm',
    gameMode: 'standard',
    difficulty: 'hard',
    outcome: 'victory',
    elapsedTimeSec: 68.5,
    falls: 0,
    itemsUsed: 3,
    pushContribution: 650,
    fartTimeSec: 24,
    survivalDistance: 0,
    treasureScore: 0,
    harmonyCombos: 1,
    hardGatesPassed: 5,
    minRaftHp: 82,
    isOnline: true,
  };

  const firstRun = evaluateNewAchievements(stats, match, new Set<AchievementId>());
  const ids = new Set(firstRun.map((a) => a.id));
  assert.equal(ids.has('first_voyage'), true);
  assert.equal(ids.has('speed_demon'), true);
  assert.equal(ids.has('untouchable'), true);
  assert.equal(ids.has('hard_gate_master'), true);
  assert.equal(ids.has('win_streak_5'), true);
  assert.equal(ids.has('win_legend_15'), true);
  assert.equal(ids.has('item_collector'), true);
  assert.equal(ids.has('engine_of_crew'), true);
  assert.equal(ids.has('harmony_conductor'), true);
  assert.equal(ids.has('all_courses_explorer'), true);

  // Re-evaluating with already unlocked IDs yields zero duplicates
  const secondRun = evaluateNewAchievements(stats, match, ids);
  assert.equal(secondRun.length, 0);
  assert.ok(computeChallengePoints(ids) >= 450);
});

test('computePushShares computes accurate crew percentages', () => {
  const sim = createInitialSimState('solo');
  sim.players[0].stats.pushImpulseSum = 600;
  sim.players[1].stats.pushImpulseSum = 200;
  sim.players[2].stats.pushImpulseSum = 200;
  sim.players[3].stats.pushImpulseSum = 0;

  const shares = computePushShares(sim.players);
  assert.equal(shares.length, 4);
  assert.equal(shares[0].sharePct, 60);
  assert.equal(shares[1].sharePct, 20);
  assert.equal(shares[2].sharePct, 20);
  assert.equal(shares[3].sharePct, 0);
});

test('getIsoWeekKey returns consistent YYYY-Www format', () => {
  const key = getIsoWeekKey(Date.UTC(2026, 10, 16));
  assert.match(key, /^2026-W\d{2}$/);
});

test('daily and weekly quest schedules generate deterministic quests with exact UTC reset boundaries', () => {
  const now = Date.UTC(2026, 10, 17, 14, 30, 0);
  const dayKey = getUtcDayKey(now);
  assert.equal(dayKey, '2026-11-17');
  assert.equal(getNextDailyResetMs(now), Date.UTC(2026, 10, 18, 0, 0, 0));
  assert.equal(getNextWeeklyResetMs(now), Date.UTC(2026, 10, 23, 0, 0, 0)); // next Monday UTC

  const dailyA = generateDailyQuests(dayKey, now);
  const dailyB = generateDailyQuests(dayKey, now);
  assert.equal(dailyA.length, 3);
  assert.deepEqual(dailyA.map((q) => q.questId), dailyB.map((q) => q.questId));

  const nextDayQuests = generateDailyQuests(getUtcDayKey(now + 86_400_000), now + 86_400_000);
  assert.notEqual(nextDayQuests[0].periodKey, dailyA[0].periodKey);

  const weekly = generateWeeklyQuests(getIsoWeekKey(now), now);
  assert.equal(weekly.length, 3);
  assert.ok(weekly.every((q) => q.xpReward > dailyA[0].xpReward && q.coinsReward > dailyA[0].coinsReward));
});

test('coin rewards and quest delta calculations match gameplay outputs', () => {
  const match: MatchSummaryInput = {
    submissionKey: 'k-coins',
    courseId: 'tropical',
    gameMode: 'treasure',
    difficulty: 'normal',
    outcome: 'victory',
    elapsedTimeSec: 65,
    falls: 0,
    itemsUsed: 3,
    pushContribution: 450,
    fartTimeSec: 18,
    survivalDistance: 0,
    treasureScore: 110,
    harmonyCombos: 1,
    hardGatesPassed: 2,
    minRaftHp: 90,
    cleanCheckpoints: 2,
    collisionCount: 0,
    isOnline: false,
  };
  const coins = calculateCoinsForRound(match);
  assert.ok(coins >= 60);
  assert.ok(getAchievementCoinReward({ id: 'first_voyage', titleAr: '', descriptionAr: '', icon: '', points: 20, category: 'milestone' }) >= 30);
  assert.ok(calculateSeasonPointsForRound(match) > 40);
  assert.equal(getQuestDeltaForMatch('play_rounds', match), 1);
  assert.equal(getQuestDeltaForMatch('win_rounds', match), 1);
  assert.equal(getQuestDeltaForMatch('treasure_points', match), 110);
  assert.equal(getQuestDeltaForMatch('clean_checkpoints', match), 2);
});

test('cosmetic catalog covers all 6 categories and equipping any cosmetic never alters raft physics', () => {
  const categories = Object.keys(SHOP_CATEGORY_LABELS_AR) as CosmeticCategory[];
  assert.deepEqual(categories.sort(), ['color', 'glasses', 'hat', 'outfit', 'raft_skin', 'trail'].sort());
  for (const cat of categories) {
    assert.ok(COSMETIC_CATALOG.some((item) => item.category === cat), `Missing category ${cat}`);
  }

  const starterIds = new Set(getDefaultOwnedItemIds());
  assert.ok(starterIds.has('hat:captain'));
  assert.ok(starterIds.has('outfit:classic'));
  assert.ok(starterIds.has('raft_skin:classic_oak'));
  assert.ok(starterIds.has('trail:classic_green'));

  let customCosmetic = normalizePlayerCosmetic(undefined, 0);
  customCosmetic = applyShopItemToCosmetic(customCosmetic, COSMETIC_ITEM_MAP['hat:crown']);
  customCosmetic = applyShopItemToCosmetic(customCosmetic, COSMETIC_ITEM_MAP['glasses:cyber_visor']);
  customCosmetic = applyShopItemToCosmetic(customCosmetic, COSMETIC_ITEM_MAP['outfit:royal_robe']);
  customCosmetic = applyShopItemToCosmetic(customCosmetic, COSMETIC_ITEM_MAP['raft_skin:golden_galleon']);
  customCosmetic = applyShopItemToCosmetic(customCosmetic, COSMETIC_ITEM_MAP['trail:golden_confetti']);
  customCosmetic = applyShopItemToCosmetic(customCosmetic, COSMETIC_ITEM_MAP['color:7']);

  const course = getCourseById('tropical');
  const simStarter = createInitialSimState('solo', 'tropical');
  const simFancy = createInitialSimState('solo', 'tropical');
  simFancy.players[0].cosmetic = customCosmetic;

  simStarter.players[0].farting = true;
  simFancy.players[0].farting = true;

  for (let i = 0; i < 120; i += 1) {
    stepSimulation(simStarter, 1 / 60, course);
    stepSimulation(simFancy, 1 / 60, course);
  }

  // Zero-advantage fairness invariant: exact same physics state
  assert.equal(simFancy.raft.x, simStarter.raft.x);
  assert.equal(simFancy.raft.z, simStarter.raft.z);
  assert.equal(simFancy.raft.vx, simStarter.raft.vx);
  assert.equal(simFancy.raft.vz, simStarter.raft.vz);
  assert.equal(simFancy.raft.yaw, simStarter.raft.yaw);
  assert.equal(simFancy.raftHp, simStarter.raftHp);
});

test('buildMatchSummaryFromSim tracks cleanCheckpoints and active season has free reward tiers', () => {
  const sim = createInitialSimState('solo', 'storm');
  sim.cleanCheckpoints = 3;
  sim.collisionCount = 1;
  sim.runOutcome = 'victory';
  const summary = buildMatchSummaryFromSim(sim, 0, 'sub-clean-1');
  assert.equal(summary.cleanCheckpoints, 3);
  assert.equal(summary.collisionCount, 1);

  assert.equal(ACTIVE_SEASON_DEF.tiers.length, 6);
  assert.ok(ACTIVE_SEASON_DEF.tiers.some((t) => t.cosmeticItemId === 'hat:storm_hood'));
  assert.ok(ACTIVE_SEASON_DEF.tiers.some((t) => t.cosmeticItemId === 'outfit:royal_robe'));
});

test('rare sudden dynamic events trigger unpredictably without time limits and honor cooldown + pity', () => {
  // Cooldown prevents triggering immediately after an event
  assert.equal(
    evaluateRareEventTrigger({ roundsSinceLastEvent: 1, currentActive: false, rollValue: 0.01, selectionSeed: 0 }),
    null,
  );
  // Active event prevents overlapping trigger
  assert.equal(
    evaluateRareEventTrigger({ roundsSinceLastEvent: 6, currentActive: true, rollValue: 0.01, selectionSeed: 0 }),
    null,
  );
  // Low roll after cooldown triggers an event
  const triggered = evaluateRareEventTrigger({
    roundsSinceLastEvent: 3,
    currentActive: false,
    rollValue: 0.05,
    selectionSeed: 2,
  });
  assert.ok(triggered !== null);
  assert.equal(triggered.bonusGoalRounds, 2);

  // Pity guarantees sudden trigger after extended drought regardless of rollValue
  const pityTriggered = evaluateRareEventTrigger({
    roundsSinceLastEvent: 6,
    currentActive: false,
    rollValue: 0.99,
    selectionSeed: 1,
  });
  assert.ok(pityTriggered !== null);
});
