import React from 'react';
import { COURSE_LIST, getCourseById } from '../shared/course.ts';
import { COSMETIC_ITEM_MAP } from '../shared/cosmetics.ts';
import { computePushShares } from '../shared/progression.ts';
import { buildRoundSummaryInsights, formatHighlightTime } from '../shared/ux.ts';
import type { NextRoundAction, RecordMatchHttpResponse } from '../shared/protocol.ts';
import type {
  ChatMessage,
  CourseId,
  EmoteId,
  PlayerSimState,
  PlaylistItem,
  SoloSessionKind,
  WorldSimulationState,
} from '../shared/types.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { EmoteBar } from './EmoteBar.tsx';

interface VictoryModalProps {
  sim: WorldSimulationState;
  soloSessionKind?: SoloSessionKind;
  bestTimeTrialSec?: number | null;
  bestSurvivalDistance?: number | null;
  isOnline: boolean;
  isHost: boolean;
  isSpectator?: boolean;
  playlistQueue?: PlaylistItem[];
  roomChatMessages?: ChatMessage[];
  matchReward?: RecordMatchHttpResponse | null;
  onPlayAgain: () => void;
  onStartPractice?: () => void;
  onNextRound?: (payload: { action: NextRoundAction; courseId?: CourseId }) => void;
  onSendChat?: (payload: { text?: string; presetId?: string }) => void;
  onTriggerEmote?: (emoteId: EmoteId) => void;
  onOpenProfile?: () => void;
  onOpenLeaderboard?: () => void;
  onOpenShop?: () => void;
  onOpenQuestsSeason?: () => void;
  onOpenReplay?: () => void;
  onBackToTitle: () => void;
}

function formatClearTime(sec: number, showDecimals = false): string {
  if (showDecimals && sec < 120) {
    return `${sec.toFixed(2)}ث`;
  }
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function computeComedicAwards(players: readonly PlayerSimState[]) {
  const active = players.filter((p) => p.connected);
  if (active.length === 0) return [];

  const strongest = [...active].sort((a, b) => b.stats.maxBurstDuration - a.stats.maxBurstDuration)[0];
  const chaotic = [...active].sort((a, b) => b.stats.torqueImpulseSum - a.stats.torqueImpulseSum)[0];
  const puffKing = [...active].sort((a, b) => b.stats.fartCount - a.stats.fartCount)[0];

  return [
    {
      title: 'أقوى دفعة صاروخية',
      winner: strongest.name,
      detail: `${strongest.stats.maxBurstDuration.toFixed(1)} ثانية متواصلة`,
    },
    {
      title: 'أكثر لاعب أربك الفريق',
      winner: chaotic.name,
      detail: `${Math.round(chaotic.stats.torqueImpulseSum)} عزم دوران`,
    },
    {
      title: 'ملك النفخات السريعة',
      winner: puffKing.name,
      detail: `${puffKing.stats.fartCount} نفخة`,
    },
  ];
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  sim,
  soloSessionKind = 'normal',
  bestTimeTrialSec = null,
  bestSurvivalDistance = null,
  isOnline,
  isHost,
  isSpectator = false,
  playlistQueue = [],
  roomChatMessages = [],
  matchReward = null,
  onPlayAgain,
  onStartPractice,
  onNextRound,
  onSendChat,
  onTriggerEmote,
  onOpenProfile,
  onOpenLeaderboard,
  onOpenShop,
  onOpenQuestsSeason,
  onOpenReplay,
  onBackToTitle,
}) => {
  const awards = computeComedicAwards(sim.players);
  const pushShares = computePushShares(sim.players);
  const insights = buildRoundSummaryInsights(sim);
  const course = getCourseById(sim.courseId);
  const totalCheckpoints = Math.max(1, course.checkpoints.length - 1);
  const gameMode = sim.gameMode ?? 'standard';
  const isDefeat = sim.runOutcome === 'defeat';

  let headerEmoji = '🏆💨';
  let headerTitle = 'وصل الطوف إلى النهاية!';
  let headerSubtitle = `أنهيتم ${course.meta.nameAr} بعمل جماعي أسطوري`;

  if (soloSessionKind === 'tutorial') {
    headerEmoji = '🎓💨';
    headerTitle = 'أتممت تدريب المبتدئين بنجاح!';
    headerSubtitle = 'أصبحت جاهزاً لقيادة الطوف عبر كل المسارات والتحديات';
  } else if (gameMode === 'survival') {
    headerEmoji = '🌊💦';
    headerTitle = 'انتهت رحلة البقاء!';
    headerSubtitle = `صمدتم لمسافة ${Math.round(sim.survivalDistance ?? 0)} متر في ${course.meta.nameAr}`;
  } else if (isDefeat) {
    headerEmoji = '⏰💨';
    headerTitle = 'انتهى وقت الجولة!';
    headerSubtitle = `بلغتم ${Math.round((sim.progress ?? 0) * 100)}% من مسار ${course.meta.nameAr}`;
  } else if (gameMode === 'time_trial') {
    headerEmoji = '⏱️🏆';
    headerTitle = 'اكتمل سباق الزمن!';
    headerSubtitle = `أنهيتم ${course.meta.nameAr} بزمن ${sim.elapsedTime.toFixed(2)} ثانية`;
  } else if (gameMode === 'treasure') {
    headerEmoji = '🪙💎';
    headerTitle = 'اكتملت رحلة الكنوز!';
    headerSubtitle = `جمعتم ${sim.treasureScore ?? 0} نقطة من كنوز ${course.meta.nameAr}`;
  } else if (gameMode === 'chaos') {
    headerEmoji = '🌀🏆';
    headerTitle = 'نجوتم من الفوضى!';
    headerSubtitle = `تغلبتم على تقلبات ${course.meta.nameAr} بنجاح`;
  }

  const currentIdx = COURSE_LIST.findIndex((c) => c.id === sim.courseId);
  const fallbackNextCourse = COURSE_LIST[(currentIdx + 1 + COURSE_LIST.length) % COURSE_LIST.length];
  const queuedNext = playlistQueue.length > 0 ? playlistQueue[0] : null;
  const nextPreviewCourse = getCourseById(queuedNext ? queuedNext.courseId : fallbackNextCourse.id);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/70">
      <div className="wood-panel w-full max-w-xl rounded-3xl p-5 sm:p-6 text-[#fff8e7] text-center max-h-[90vh] overflow-y-auto">
        <div className="text-4xl mb-1" aria-hidden="true">{headerEmoji}</div>
        <h2 data-testid="gameover-title" className="text-3xl font-black text-[#ffd13b] cartoon-outline">
          {headerTitle}
        </h2>
        <p className="text-sm font-bold text-[#b8d8f8] mt-1">
          {headerSubtitle}
        </p>

        {/* Mode-Adapted Mastery Metrics */}
        {gameMode === 'survival' ? (
          <div className="grid grid-cols-3 gap-2.5 my-5">
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">المسافة المقطوعة</div>
              <div className="text-2xl font-black text-[#ffd13b] tabular-nums mt-0.5">
                {Math.round(sim.survivalDistance ?? 0)}م
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">أفضل مسافة</div>
              <div className="text-2xl font-black text-[#06d6a0] tabular-nums mt-0.5">
                {Math.round(Math.max(bestSurvivalDistance ?? 0, sim.survivalDistance ?? 0))}م
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">زمن الصمود</div>
              <div className="text-2xl font-black text-[#38bdf8] tabular-nums mt-0.5">
                {formatClearTime(sim.elapsedTime)}
              </div>
            </div>
          </div>
        ) : gameMode === 'treasure' ? (
          <div className="grid grid-cols-3 gap-2.5 my-5">
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">نقاط الكنوز</div>
              <div className="text-2xl font-black text-[#ffd13b] tabular-nums mt-0.5">
                {sim.treasureScore ?? 0}
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">العملات والصناديق</div>
              <div className="text-2xl font-black text-[#06d6a0] tabular-nums mt-0.5">
                {sim.coinsCollected ?? 0}/{sim.totalCoins ?? 0}
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">زمن الوصول</div>
              <div className="text-2xl font-black text-[#38bdf8] tabular-nums mt-0.5">
                {formatClearTime(sim.elapsedTime)}
              </div>
            </div>
          </div>
        ) : gameMode === 'time_trial' ? (
          <div className="grid grid-cols-3 gap-2.5 my-5">
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">الزمن المسجل</div>
              <div className="text-2xl font-black text-[#ffd13b] tabular-nums mt-0.5">
                {formatClearTime(sim.elapsedTime, true)}
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">الرقم القياسي</div>
              <div className="text-2xl font-black text-[#06d6a0] tabular-nums mt-0.5">
                {bestTimeTrialSec !== null ? `${bestTimeTrialSec.toFixed(2)}ث` : `${sim.elapsedTime.toFixed(2)}ث`}
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">عدد السقوطات</div>
              <div className="text-2xl font-black text-[#ff595e] tabular-nums mt-0.5">
                {sim.falls}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 my-5">
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">زمن الوصول</div>
              <div className="text-2xl font-black text-[#ffd13b] tabular-nums mt-0.5">
                {formatClearTime(sim.elapsedTime)}
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">عدد السقوطات</div>
              <div className="text-2xl font-black text-[#ff595e] tabular-nums mt-0.5">
                {sim.falls}
              </div>
            </div>
            <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-[11px] font-bold text-[#93c5fd]">نقاط الحفظ</div>
              <div className="text-2xl font-black text-[#06d6a0] tabular-nums mt-0.5">
                {sim.checkpointIndex}/{totalCheckpoints}
              </div>
            </div>
          </div>
        )}

        {/* PROG-01..10: XP, Coins, Quests, Season & Rare Event Banner */}
        {matchReward && (
          <div
            data-testid="victory-progression-banner"
            className="bg-[#112a40] border-2 border-[#06d6a0]/60 rounded-2xl p-3.5 mb-4 text-right space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs sm:text-sm font-black text-[#06d6a0] tabular-nums">
                +{matchReward.xpEarned} نقطة خبرة ·{' '}
                <span className="text-[#ffd13b]">+{matchReward.coinsEarned} 🪙 عملة</span>{' '}
                (المستوى {matchReward.profile.level} · {matchReward.profile.rankTitleAr})
              </div>
              {matchReward.leveledUp && (
                <span className="text-xs font-black text-[#ffd13b]">
                  ترقية مستوى جديدة! ({matchReward.previousLevel} ← {matchReward.profile.level})
                </span>
              )}
            </div>

            {matchReward.achievementXp > 0 && (
              <div className="text-[11px] font-bold text-[#93c5fd] tabular-nums">
                تفصيل الخبرة: +{matchReward.roundXp} من الجولة · +{matchReward.achievementXp} من الإنجازات
              </div>
            )}

            {(matchReward.rareEventTriggered || matchReward.rareEventBonusCoins > 0) && (
              <div
                data-testid="victory-rare-event-highlight"
                className="rounded-xl bg-[#291e10] border border-[#ffd13b] px-3 py-2 text-xs font-black text-[#ffd13b]"
              >
                {matchReward.rareEventBonusCoins > 0
                  ? `⚡ اكتمل الحدث النادر! مكافأة إضافية: +${matchReward.rareEventBonusCoins} 🪙 عملة`
                  : `⚡ ظهر حدث مفاجئ نادر الآن: ${matchReward.rareEvent.titleAr ?? 'تحدي نادر جديد'}!`}
              </div>
            )}

            {matchReward.completedQuests.length > 0 && (
              <div className="pt-1 border-t border-[#2a4c6e] space-y-1">
                <div className="text-[11px] font-black text-[#38bdf8]">
                  مهام مكتملة جاهزة للاستلام ({matchReward.completedQuests.length}):
                </div>
                {matchReward.completedQuests.map((q) => (
                  <div
                    key={q.questId}
                    className="flex items-center justify-between text-xs font-bold text-[#fff8e7]"
                  >
                    <span>
                      {q.icon} {q.titleAr}
                    </span>
                    <span className="text-[#ffd13b] tabular-nums">
                      +{q.coinsReward} 🪙 · +{q.xpReward} XP
                    </span>
                  </div>
                ))}
              </div>
            )}

            {matchReward.newlyUnlockedTierItems.length > 0 && (
              <div className="pt-1 border-t border-[#2a4c6e] text-xs font-black text-[#06d6a0]">
                مكافآت موسمية جديدة متاحة:{' '}
                {matchReward.newlyUnlockedTierItems
                  .map((id) => COSMETIC_ITEM_MAP[id]?.titleAr ?? id)
                  .join('، ')}
              </div>
            )}

            {matchReward.newlyUnlocked.length > 0 && (
              <div className="pt-1 border-t border-[#2a4c6e] space-y-1">
                <div className="text-[11px] font-black text-[#ffd13b]">إنجازات جديدة مفتوحة:</div>
                {matchReward.newlyUnlocked.map((ach) => (
                  <div
                    key={ach.id}
                    className="flex items-center justify-between text-xs font-bold text-[#fff8e7]"
                  >
                    <span>
                      {ach.icon} {ach.titleAr}
                    </span>
                    <span className="text-[#06d6a0] tabular-nums">+{ach.points} نقطة</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* UX-05: Best Boost, Most Collisions & Fastest Reaction Superlative Cards */}
        <div
          data-testid="victory-ux-insights"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 text-right"
        >
          <div className="bg-[#102438] border-2 border-[#f59e0b]/60 rounded-2xl p-3">
            <div className="text-[11px] font-black text-[#ffd13b]">🚀 أفضل دفعة</div>
            <div className="text-sm font-black text-[#fff8e7] truncate mt-0.5">
              {insights.bestBoost?.name ?? '—'}
            </div>
            <div className="text-[11px] font-bold text-[#fde68a] tabular-nums">
              {insights.bestBoost?.valueLabelAr ?? 'لا بيانات'}
            </div>
          </div>
          <div className="bg-[#102438] border-2 border-[#ef4444]/60 rounded-2xl p-3">
            <div className="text-[11px] font-black text-[#fca5a5]">💥 أكثر اصطدامات</div>
            <div className="text-sm font-black text-[#fff8e7] truncate mt-0.5">
              {insights.mostCollisions?.name ?? '—'}
            </div>
            <div className="text-[11px] font-bold text-[#fecaca] tabular-nums">
              {insights.mostCollisions?.valueLabelAr ?? '0 اصطدام'}
            </div>
          </div>
          <div className="bg-[#102438] border-2 border-[#06d6a0]/60 rounded-2xl p-3">
            <div className="text-[11px] font-black text-[#6ee7b7]">⚡ أسرع استجابة</div>
            <div className="text-sm font-black text-[#fff8e7] truncate mt-0.5">
              {insights.fastestReaction?.name ?? '—'}
            </div>
            <div className="text-[11px] font-bold text-[#a7f3d0] tabular-nums">
              {insights.fastestReaction?.valueLabelAr ?? 'انتظار رد بشري'}
            </div>
          </div>
        </div>

        {/* PROG-03 + UX-05: Crew Push, Reaction & Collision Breakdown */}
        {pushShares.length > 0 && (
          <div
            data-testid="victory-push-breakdown"
            className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3.5 mb-4 text-right space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-[#38bdf8]">مساهمة الطاقم في دفع الطوف والعناصر</span>
              <span className="text-[11px] font-bold text-[#93c5fd] tabular-nums">
                العناصر المستخدمة: {sim.itemsCollectedCount ?? 0}
              </span>
            </div>
            <div className="space-y-1.5">
              {pushShares.map((row) => {
                const simPlayer = sim.players.find((p) => p.slot === row.slot);
                const reactionMs = simPlayer?.stats.fastestReactionMs;
                const impacts = simPlayer?.stats.wallImpactCount ?? 0;
                return (
                  <div key={row.slot} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2 text-xs font-bold">
                      <span className="text-[#fff8e7] truncate">
                        {row.name} {row.isBot ? '(روبوت)' : ''}
                      </span>
                      <span className="text-[#ffd13b] tabular-nums shrink-0">
                        {row.sharePct}% · {row.pushScore} دفع · {row.itemsUsed} أداة
                        {impacts > 0 ? ` · ${impacts}💥` : ''}
                        {typeof reactionMs === 'number' && reactionMs > 0 ? ` · ${reactionMs}ms` : ''}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#091826] overflow-hidden">
                      <div
                        className="h-full bg-[#38bdf8]"
                        style={{ width: `${Math.max(4, row.sharePct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Comedic Superlative Awards */}
        {awards.length > 0 && (
          <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3.5 mb-4 text-right space-y-2">
            <div className="text-xs font-black text-[#9ef01a]">ألقاب الطاقم الكوميدية</div>
            {awards.map((a) => (
              <div key={a.title} className="flex items-center justify-between text-xs font-bold">
                <span className="text-[#dbeafe]">{a.title}</span>
                <span className="text-[#ffd13b] font-black">
                  {a.winner} <span className="text-[#93c5fd] font-normal">({a.detail})</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* UX-05: Chronological Round Highlights Timeline */}
        <div
          data-testid="victory-highlights-timeline"
          className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3.5 mb-5 text-right space-y-1.5"
        >
          <div className="text-xs font-black text-[#ffd13b]">🎬 أبرز أحداث الجولة</div>
          {insights.highlights.length > 0 ? (
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {insights.highlights.map((h, idx) => (
                <div
                  key={`${h.kind}-${idx}-${h.timeSec}`}
                  className="flex items-center justify-between gap-2 text-xs font-bold bg-[#0c1d2e] rounded-xl px-2.5 py-1.5 border border-[#1f3b57]"
                >
                  <span className="text-[#fff8e7] truncate">{h.titleAr}</span>
                  <span className="text-[#38bdf8] tabular-nums shrink-0">
                    {formatHighlightTime(h.timeSec)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs font-bold text-[#93c5fd]">
              رحلة سلسة وهادئة حتى خط النهاية!
            </div>
          )}
        </div>

        {/* ONLINE-10 & ONLINE-11: Post-Round Celebration Emotes & Crew Chat */}
        {(onTriggerEmote || (isOnline && onSendChat)) && (
          <div className="space-y-2.5 mb-4 text-right">
            {onTriggerEmote && (
              <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-black text-[#ffd13b]">تفاعل الطاقم</span>
                <EmoteBar onTriggerEmote={onTriggerEmote} compact />
              </div>
            )}
            {isOnline && onSendChat && (
              <ChatPanel
                title="دردشة ما بعد الجولة"
                messages={roomChatMessages}
                onSendChat={onSendChat}
                compact
                maxHeightClass="max-h-24"
                testIdPrefix="victory-chat"
              />
            )}
          </div>
        )}

        {/* ONLINE-08: Next-Round & Playlist Progression Controls */}
        {isOnline && isHost && onNextRound ? (
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                data-start="true"
                data-testid="victory-replay-btn"
                onClick={() => onNextRound({ action: 'replay' })}
                className="wood-btn-primary flex-1 py-3 rounded-2xl font-black text-base cursor-pointer"
              >
                🔄 إعادة فورية
              </button>
              <button
                type="button"
                data-testid="victory-next-course-btn"
                onClick={() => onNextRound({ action: 'next' })}
                className="px-4 py-3 rounded-2xl bg-[#0284c7] hover:bg-[#0369a1] text-white border-2 border-[#0c2942] font-black text-sm sm:text-base cursor-pointer flex-1"
              >
                ⏭️ التالي: {nextPreviewCourse.meta.nameAr}
              </button>
            </div>

            <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-2.5">
              <div className="text-[11px] font-bold text-[#93c5fd] mb-1.5">
                انتقال سريع لأي مسار:
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {COURSE_LIST.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`victory-pick-course-${c.id}`}
                    onClick={() => onNextRound({ action: 'course', courseId: c.id })}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-black border cursor-pointer ${
                      c.id === sim.courseId
                        ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                        : 'bg-[#19334d] hover:bg-[#23476b] text-[#dbeafe] border-[#39628a]'
                    }`}
                  >
                    {c.meta.nameAr}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                data-testid="victory-back-lobby-btn"
                onClick={() => onNextRound({ action: 'lobby' })}
                className="wood-btn-secondary flex-1 py-2.5 rounded-2xl font-extrabold text-sm cursor-pointer"
              >
                🏠 العودة إلى الردهة
              </button>
              <button
                type="button"
                onClick={onBackToTitle}
                className="px-4 py-2.5 rounded-2xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-bold text-[#cbd5e1] cursor-pointer"
              >
                القائمة الرئيسية
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {isOnline && (
              <div className="bg-[#102438] border border-[#38bdf8]/40 rounded-xl px-3 py-2 text-xs font-bold text-[#bae6fd]">
                {isSpectator
                  ? '👁️ ستتم ترقيتك لمقعد شاغر فور بدء المضيف للجولة التالية...'
                  : '⏳ بانتظار المضيف لبدء الجولة التالية أو العودة للردهة...'}
                {queuedNext && (
                  <div className="text-[#ffd13b] mt-0.5">
                    المحطة القادمة في القائمة: {nextPreviewCourse.meta.nameAr}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              {!isOnline && (
                <button
                  type="button"
                  data-start="true"
                  onClick={onPlayAgain}
                  className="wood-btn-primary flex-1 py-3.5 rounded-2xl font-black text-lg cursor-pointer"
                >
                  {soloSessionKind === 'tutorial' ? 'إعادة التدريب' : 'العب مجدداً'}
                </button>
              )}
              {soloSessionKind === 'tutorial' && onStartPractice && (
                <button
                  type="button"
                  data-testid="victory-start-practice-btn"
                  onClick={onStartPractice}
                  className="px-4 py-3.5 rounded-2xl bg-[#0c2942] hover:bg-[#143d61] border-2 border-[#06d6a0] text-[#a7f3d0] font-black text-sm cursor-pointer"
                >
                  🧪 ساحة التدريب الحرة
                </button>
              )}
              <button
                type="button"
                onClick={onBackToTitle}
                className="wood-btn-secondary flex-1 py-3.5 rounded-2xl font-extrabold text-base cursor-pointer"
              >
                القائمة الرئيسية
              </button>
            </div>
          </div>
        )}

        {(onOpenProfile || onOpenLeaderboard || onOpenShop || onOpenQuestsSeason || onOpenReplay) && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-3 pt-3 border-t border-[#2a4c6e]">
            {onOpenReplay && (
              <button
                type="button"
                data-testid="victory-watch-replay-btn"
                onClick={onOpenReplay}
                className="px-3.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#06d6a0]/70 text-xs font-black text-[#6ee7b7] cursor-pointer whitespace-nowrap"
              >
                🎬 مشاهدة إعادة الجولة
              </button>
            )}
            {onOpenQuestsSeason && (
              <button
                type="button"
                data-testid="victory-open-quests-btn"
                onClick={onOpenQuestsSeason}
                className="px-3.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#38bdf8]/60 text-xs font-black text-[#bae6fd] cursor-pointer whitespace-nowrap"
              >
                المهام والموسم
              </button>
            )}
            {onOpenShop && (
              <button
                type="button"
                data-testid="victory-open-shop-btn"
                onClick={onOpenShop}
                className="px-3.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#ffd13b]/60 text-xs font-black text-[#ffd13b] cursor-pointer whitespace-nowrap"
              >
                متجر المظهر
              </button>
            )}
            {onOpenProfile && (
              <button
                type="button"
                data-testid="victory-open-profile-btn"
                onClick={onOpenProfile}
                className="px-3.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#fff8e7] cursor-pointer whitespace-nowrap"
              >
                الملف الشخصي
              </button>
            )}
            {onOpenLeaderboard && (
              <button
                type="button"
                data-testid="victory-open-leaderboard-btn"
                onClick={onOpenLeaderboard}
                className="px-3.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#ffd13b] cursor-pointer whitespace-nowrap"
              >
                لوحة المتصدرين
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
