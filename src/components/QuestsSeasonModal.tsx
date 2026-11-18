import React, { useEffect, useState } from 'react';
import { getCourseById } from '../shared/course.ts';
import { COSMETIC_ITEM_MAP } from '../shared/cosmetics.ts';
import type { ProfileSnapshotPayload } from '../shared/protocol.ts';
import type { CourseId, GameMode, QuestState } from '../shared/types.ts';

interface QuestsSeasonModalProps {
  snapshot: ProfileSnapshotPayload;
  isBusy: boolean;
  errorMsg: string | null;
  onClaimQuest: (questId: string) => Promise<void>;
  onClaimSeasonTier: (tier: number) => Promise<void>;
  onLaunchRareEvent?: (courseId: CourseId, gameMode: GameMode) => void;
  onOpenShop?: () => void;
  onClose: () => void;
}

const MODE_LABELS_AR: Record<GameMode, string> = {
  standard: 'القياسي',
  time_trial: 'سباق الزمن',
  survival: 'وضع البقاء',
  treasure: 'جمع الكنوز',
  chaos: 'وضع الفوضى',
};

function formatCountdown(targetMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  if (days > 0) {
    return `${days}ي ${hours}س`;
  }
  return `${hours}س ${mins}د`;
}

export const QuestsSeasonModal: React.FC<QuestsSeasonModalProps> = ({
  snapshot,
  isBusy,
  errorMsg,
  onClaimQuest,
  onClaimSeasonTier,
  onLaunchRareEvent,
  onOpenShop,
  onClose,
}) => {
  const { profile, quests, season, rareEvent } = snapshot;
  const [tab, setTab] = useState<'quests' | 'season' | 'rare'>(
    rareEvent?.active ? 'rare' : 'quests',
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [localError, setLocalError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const dailyQuests = quests.filter((q) => q.cadence === 'daily');
  const weeklyQuests = quests.filter((q) => q.cadence === 'weekly');

  const claimableQuestsCount = quests.filter((q) => q.completedAt !== null && q.claimedAt === null).length;
  const claimableTiersCount = season.tiers.filter((t) => t.unlocked && !t.claimed).length;

  const xpPct = Math.min(100, Math.round((profile.xpIntoLevel / Math.max(1, profile.xpForNextLevel)) * 100));
  const seasonPct = Math.min(100, Math.round((season.seasonPoints / Math.max(1, season.maxPoints)) * 100));

  const handleClaimQuest = async (q: QuestState) => {
    setLocalError(null);
    setFeedback(null);
    try {
      await onClaimQuest(q.questId);
      setFeedback(`تم استلام مكافأة «${q.titleAr}»: +${q.xpReward} XP و +${q.coinsReward} عملة!`);
    } catch (err) {
      setLocalError((err as Error).message || 'تعذر استلام مكافأة المهمة');
    }
  };

  const handleClaimTier = async (tierNum: number, titleAr: string) => {
    setLocalError(null);
    setFeedback(null);
    try {
      await onClaimSeasonTier(tierNum);
      setFeedback(`تم استلام جائزة المستوى الموسمي #${tierNum}: «${titleAr}»!`);
    } catch (err) {
      setLocalError((err as Error).message || 'تعذر استلام المكافأة الموسمية');
    }
  };

  const renderQuestCard = (q: QuestState) => {
    const pct = Math.min(100, Math.round((q.progress / Math.max(1, q.goal)) * 100));
    const isComplete = q.completedAt !== null || q.progress >= q.goal;
    const isClaimed = q.claimedAt !== null;

    return (
      <div
        key={q.questId}
        data-testid={`quest-card-${q.questId}`}
        className={`rounded-2xl p-3 border flex flex-col justify-between gap-2 ${
          isClaimed
            ? 'bg-[#0d2433] border-[#06d6a0]/50 opacity-80'
            : isComplete
              ? 'bg-[#123147] border-[#ffd13b]'
              : 'bg-[#102438] border-[#2a4c6e]'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="text-xl leading-none shrink-0" aria-hidden="true">
              {q.icon}
            </span>
            <div className="min-w-0">
              <div className="font-black text-sm text-[#ffd13b] truncate">{q.titleAr}</div>
              <p className="text-xs font-semibold text-[#cbd5e1] mt-0.5">{q.descriptionAr}</p>
            </div>
          </div>

          <div className="text-left shrink-0 text-[11px] font-black text-[#06d6a0] tabular-nums">
            +{q.coinsReward} 🪙 · +{q.xpReward} XP
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#93c5fd] tabular-nums">
            <span>
              التقدم: {q.progress}/{q.goal}
            </span>
            <span>+{q.seasonPointsReward} نقطة موسم</span>
          </div>
          <div className="h-2 rounded-full bg-[#091826] border border-[#234361] overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${isComplete ? 'bg-[#ffd13b]' : 'bg-[#38bdf8]'}`}
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-end">
          {isClaimed ? (
            <span className="text-xs font-black text-[#06d6a0]">تم استلام المكافأة ✓</span>
          ) : isComplete ? (
            <button
              type="button"
              disabled={isBusy}
              data-testid={`claim-quest-${q.questId}`}
              onClick={() => void handleClaimQuest(q)}
              className="wood-btn-primary px-4 py-1.5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-55"
            >
              استلام المكافأة
            </button>
          ) : (
            <span className="text-[11px] font-bold text-[#94a3b8]">قيد التنفيذ</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/75">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="المهام والموسم والأحداث النادرة"
        data-testid="quests-season-modal"
        className="wood-panel w-full max-w-4xl rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto"
      >
        {/* Header with Level/XP & Coins */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
              المهام والموسم والأحداث النادرة
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-[#cbd5e1] tabular-nums">
              <span>
                المستوى {profile.level} ({profile.rankTitleAr})
              </span>
              <span>·</span>
              <span>
                الخبرة: {profile.xpIntoLevel}/{profile.xpForNextLevel} ({xpPct}%)
              </span>
              <span>·</span>
              <span className="text-[#ffd13b]">🪙 {profile.coins} عملة</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenShop && (
              <button
                type="button"
                onClick={onOpenShop}
                className="px-3.5 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#ffd13b]/60 text-xs font-black text-[#ffd13b] cursor-pointer whitespace-nowrap"
              >
                فتح المتجر
              </button>
            )}
            <button
              type="button"
              data-testid="quests-modal-close-btn"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#cbd5e1] cursor-pointer whitespace-nowrap"
            >
              إغلاق
            </button>
          </div>
        </div>

        {(errorMsg || localError) && (
          <div className="mb-3 rounded-xl bg-[#ff595e]/20 border border-[#ff595e] px-3 py-2 text-xs font-bold text-[#ffb4b6]">
            {localError || errorMsg}
          </div>
        )}

        {feedback && (
          <div
            data-testid="quests-feedback-banner"
            className="mb-3 rounded-xl bg-[#06d6a0]/20 border border-[#06d6a0] px-3 py-2 text-xs font-bold text-[#6ee7b7]"
          >
            {feedback}
          </div>
        )}

        {/* Section Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            type="button"
            data-testid="quests-tab-daily-weekly"
            onClick={() => setTab('quests')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer whitespace-nowrap tabular-nums ${
              tab === 'quests'
                ? 'bg-[#ffd13b] text-[#14222f]'
                : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
            }`}
          >
            المهام اليومية والأسبوعية{claimableQuestsCount > 0 ? ` (${claimableQuestsCount} جاهز)` : ''}
          </button>

          <button
            type="button"
            data-testid="quests-tab-season"
            onClick={() => setTab('season')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer whitespace-nowrap tabular-nums ${
              tab === 'season'
                ? 'bg-[#ffd13b] text-[#14222f]'
                : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
            }`}
          >
            الموسم المجاني{claimableTiersCount > 0 ? ` (${claimableTiersCount} جاهز)` : ''}
          </button>

          <button
            type="button"
            data-testid="quests-tab-rare"
            onClick={() => setTab('rare')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer whitespace-nowrap ${
              tab === 'rare'
                ? 'bg-[#ffd13b] text-[#14222f]'
                : rareEvent?.active
                  ? 'bg-[#2b1f0e] text-[#ffd13b] border border-[#ffd13b]'
                  : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
            }`}
          >
            الأحداث النادرة {rareEvent?.active ? '⚡ نشط الآن' : ''}
          </button>
        </div>

        {/* Tab 1: PROG-06 Daily & Weekly Quests */}
        {tab === 'quests' && (
          <div className="space-y-5">
            {/* Daily Section */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-[#38bdf8]">المهام اليومية</h3>
                {dailyQuests[0] && (
                  <div className="text-xs font-bold text-[#93c5fd] tabular-nums">
                    الدورة: <span dir="ltr" className="inline-block">{dailyQuests[0].periodKey}</span> · تتجدد خلال{' '}
                    {formatCountdown(dailyQuests[0].resetAt, nowMs)} (UTC)
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {dailyQuests.map(renderQuestCard)}
              </div>
            </div>

            {/* Weekly Section */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-[#06d6a0]">المهام الأسبوعية</h3>
                {weeklyQuests[0] && (
                  <div className="text-xs font-bold text-[#93c5fd] tabular-nums">
                    الأسبوع: <span dir="ltr" className="inline-block">{weeklyQuests[0].periodKey}</span> · تتجدد خلال{' '}
                    {formatCountdown(weeklyQuests[0].resetAt, nowMs)} (UTC)
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {weeklyQuests.map(renderQuestCard)}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: PROG-10 Free Active Season Track & Challenges */}
        {tab === 'season' && (
          <div className="space-y-4">
            <div className="bg-[#102438] border-2 border-[#38bdf8]/50 rounded-2xl p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-black text-[#ffd13b]">{season.titleAr}</h3>
                  <p className="text-xs font-semibold text-[#bae6fd] mt-0.5">{season.subtitleAr}</p>
                </div>
                <div className="text-left text-xs font-black text-[#06d6a0] tabular-nums">
                  {season.seasonPoints} / {season.maxPoints} نقطة موسم ({seasonPct}%)
                </div>
              </div>

              <div className="h-3 rounded-full bg-[#091826] border border-[#2a4c6e] overflow-hidden">
                <div
                  className="h-full bg-[#06d6a0] transition-all duration-300"
                  style={{ width: `${Math.max(2, seasonPct)}%` }}
                />
              </div>

              <div className="text-[11px] font-bold text-[#93c5fd]">
                المسار المميز للموسم: {getCourseById(season.featuredCourseId).meta.nameAr} · النمط المميز:{' '}
                {MODE_LABELS_AR[season.featuredGameMode]} (+12 نقطة إضافية كل جولة)
              </div>
            </div>

            {/* 6-Tier Free Reward Track */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-[#ffd13b]">مسار المكافآت المجاني (6 مستويات)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {season.tiers.map((tier) => {
                  const cosmeticDef = tier.cosmeticItemId ? COSMETIC_ITEM_MAP[tier.cosmeticItemId] : null;
                  return (
                    <div
                      key={tier.tier}
                      data-testid={`season-tier-${tier.tier}`}
                      className={`rounded-2xl p-3 border flex flex-col justify-between gap-2 ${
                        tier.claimed
                          ? 'bg-[#0d2433] border-[#06d6a0]/50'
                          : tier.unlocked
                            ? 'bg-[#123147] border-[#ffd13b]'
                            : 'bg-[#102438] border-[#2a4c6e] opacity-85'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs font-black">
                          <span className="text-[#93c5fd] tabular-nums">المرتبة #{tier.tier}</span>
                          <span className="text-[#ffd13b] tabular-nums">{tier.requiredPoints} نقطة</span>
                        </div>
                        <div className="font-black text-sm text-[#fff8e7]">{tier.titleAr}</div>
                        <div className="text-xs font-bold text-[#06d6a0] tabular-nums">
                          +{tier.coinsReward} 🪙 · +{tier.xpReward} XP
                        </div>
                        {cosmeticDef && (
                          <div className="text-[11px] font-black text-[#fde047]">
                            مظهر حصري: {cosmeticDef.titleAr}
                          </div>
                        )}
                      </div>

                      {tier.claimed ? (
                        <span className="text-xs font-black text-[#06d6a0]">تم الاستلام ✓</span>
                      ) : tier.unlocked ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          data-testid={`claim-season-tier-${tier.tier}`}
                          onClick={() => void handleClaimTier(tier.tier, tier.titleAr)}
                          className="wood-btn-primary w-full py-1.5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-55"
                        >
                          استلام مجاني
                        </button>
                      ) : (
                        <span className="text-[11px] font-bold text-[#94a3b8] tabular-nums">
                          متبقٍ {Math.max(0, tier.requiredPoints - season.seasonPoints)} نقطة
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3 Seasonal Challenges */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-[#38bdf8]">تحديات الموسم التلقائية</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {season.challenges.map((ch) => {
                  const pct = Math.min(100, Math.round((ch.progress / Math.max(1, ch.goal)) * 100));
                  return (
                    <div
                      key={ch.challengeId}
                      className={`rounded-2xl p-3 border space-y-1.5 ${
                        ch.completed ? 'bg-[#123147] border-[#06d6a0]' : 'bg-[#102438] border-[#2a4c6e]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-xs text-[#ffd13b]">{ch.titleAr}</span>
                        <span className="text-[11px] font-black text-[#06d6a0] tabular-nums">
                          {ch.completed ? 'مكتمل ✓' : `${ch.progress}/${ch.goal}`}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-[#cbd5e1]">{ch.descriptionAr}</p>
                      <div className="h-1.5 rounded-full bg-[#091826] overflow-hidden">
                        <div className="h-full bg-[#ffd13b]" style={{ width: `${Math.max(4, pct)}%` }} />
                      </div>
                      <div className="text-[10px] font-bold text-[#93c5fd] tabular-nums">
                        +{ch.coinsReward} 🪙 · +{ch.xpReward} XP · +{ch.seasonPointsReward} نقطة موسم
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: PROG-10 Rare Sudden Dynamic Event (Strictly NOT time-scheduled) */}
        {tab === 'rare' && (
          <div data-testid="rare-event-panel" className="space-y-4">
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-4 space-y-2">
              <div className="text-sm font-black text-[#ffd13b]">
                نظام الأحداث المفاجئة النادرة (غير مرتبط بوقت محدد)
              </div>
              <p className="text-xs font-semibold text-[#dbeafe] leading-relaxed">
                لا تعتمد هذه الأحداث على ساعات أو مواعيد زمنية ثابتة؛ بل تنبثق فجأة وبشكل نادر أثناء رحلاتك عبر
                الجولات لتمنحك تحدياً محدود الجولات بمكافآت عملات وخبرة ومظهر نادر!
              </p>
              <div className="text-xs font-bold text-[#93c5fd] tabular-nums">
                مرات ظهور الحدث النادر في مسيرتك: {rareEvent?.occurrencesCount ?? 0}
              </div>
            </div>

            {rareEvent?.active ? (
              <div
                data-testid="rare-event-active-card"
                className="bg-[#18293d] border-2 rounded-2xl p-4 space-y-3"
                style={{ borderColor: rareEvent.accentHex || '#ffd13b' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-black text-[#ffd13b]">⚡ {rareEvent.titleAr}</h3>
                  <span className="text-xs font-black text-[#06d6a0] tabular-nums">
                    متبقٍ {rareEvent.roundsRemaining} جولات لإتمام الحدث
                  </span>
                </div>
                <p className="text-xs sm:text-sm font-semibold text-[#fff8e7]">
                  {rareEvent.descriptionAr}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-[#bae6fd] tabular-nums">
                  <span>
                    المسار المطلوب:{' '}
                    {rareEvent.featuredCourseId ? getCourseById(rareEvent.featuredCourseId).meta.nameAr : '—'}
                  </span>
                  <span>·</span>
                  <span>
                    النمط:{' '}
                    {rareEvent.featuredGameMode ? MODE_LABELS_AR[rareEvent.featuredGameMode] : '—'}
                  </span>
                  <span>·</span>
                  <span>
                    التقدم: {rareEvent.roundsCompleted}/{rareEvent.bonusGoalRounds} جولة
                  </span>
                </div>

                <div className="bg-[#0e1f30] rounded-xl p-3 border border-[#2a4c6e] flex flex-wrap items-center justify-between gap-2 text-xs font-black">
                  <span className="text-[#ffd13b] tabular-nums">
                    مكافأة الإتمام: +{rareEvent.coinsBonus} 🪙 · +{rareEvent.xpBonus} XP
                  </span>
                  {rareEvent.rewardItemId && COSMETIC_ITEM_MAP[rareEvent.rewardItemId] && (
                    <span className="text-[#06d6a0]">
                      مظهر نادر: {COSMETIC_ITEM_MAP[rareEvent.rewardItemId].titleAr}
                    </span>
                  )}
                </div>

                {onLaunchRareEvent && rareEvent.featuredCourseId && rareEvent.featuredGameMode && (
                  <button
                    type="button"
                    data-testid="rare-event-launch-btn"
                    onClick={() =>
                      onLaunchRareEvent(rareEvent.featuredCourseId!, rareEvent.featuredGameMode!)
                    }
                    className="wood-btn-primary px-5 py-2.5 rounded-xl text-sm font-black cursor-pointer"
                  >
                    انطلق الآن إلى التحدي النادر!
                  </button>
                )}
              </div>
            ) : (
              <div
                data-testid="rare-event-idle-card"
                className="bg-[#0d1f30] border border-[#2a4c6e] rounded-2xl p-6 text-center space-y-2"
              >
                <div className="text-base font-black text-[#bae6fd]">
                  الأفق هادئ حالياً — لم يظهر حدث مفاجئ بعد
                </div>
                <p className="text-xs font-semibold text-[#93c5fd] max-w-lg mx-auto">
                  واصل الإبحار وإكمال الجولات عبر المسارات؛ سيظهر الحدث النادر فجأة في أي لحظة دون جدول زمني مسبق!
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
