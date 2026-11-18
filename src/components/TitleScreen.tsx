import React, { useState } from 'react';
import { getCourseById } from '../shared/course.ts';
import type {
  AccountProfile,
  BotDifficulty,
  CourseId,
  GameDifficulty,
  GameMode,
  RareEventState,
} from '../shared/types.ts';
import { MoreMenuModal } from './MoreMenuModal.tsx';
import { PlaySetupModal } from './PlaySetupModal.tsx';

interface TitleScreenProps {
  selectedCourseId: CourseId;
  selectedGameMode: GameMode;
  selectedDifficulty: GameDifficulty;
  selectedBotDifficulty?: BotDifficulty;
  boatDamageEnabled?: boolean;
  accountProfile?: AccountProfile | null;
  claimableRewardsCount?: number;
  rareEvent?: RareEventState | null;
  onSelectCourse: (courseId: CourseId) => void;
  onSelectGameMode: (mode: GameMode) => void;
  onSelectDifficulty: (difficulty: GameDifficulty) => void;
  onSelectBotDifficulty?: (botDifficulty: BotDifficulty) => void;
  onToggleBoatDamage?: (enabled: boolean) => void;
  onStartSolo: () => void;
  onStartTutorial?: () => void;
  onStartPractice?: () => void;
  onOpenLobby: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenLeaderboard: () => void;
  onOpenShop: () => void;
  onOpenQuestsSeason: () => void;
  onOpenReplays?: () => void;
  onOpenOps?: () => void;
  onLaunchRareEvent?: (courseId: CourseId, gameMode: GameMode) => void;
  onOpenAuth: () => void;
}

const MODE_LABELS: Record<GameMode, string> = {
  standard: 'القياسي',
  time_trial: 'سباق الزمن',
  survival: 'البقاء',
  treasure: 'جمع الكنوز',
  chaos: 'الفوضى',
};

export const TitleScreen: React.FC<TitleScreenProps> = ({
  selectedCourseId,
  selectedGameMode,
  selectedDifficulty,
  selectedBotDifficulty = 'normal',
  boatDamageEnabled = true,
  accountProfile = null,
  claimableRewardsCount = 0,
  rareEvent = null,
  onSelectCourse,
  onSelectGameMode,
  onSelectDifficulty,
  onSelectBotDifficulty,
  onToggleBoatDamage,
  onStartSolo,
  onStartTutorial,
  onStartPractice,
  onOpenLobby,
  onOpenSettings,
  onOpenProfile,
  onOpenLeaderboard,
  onOpenShop,
  onOpenQuestsSeason,
  onOpenReplays,
  onOpenOps,
  onLaunchRareEvent,
  onOpenAuth,
}) => {
  const [playSetupOpen, setPlaySetupOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const selectedCourse = getCourseById(selectedCourseId);
  const isGuest = !accountProfile || accountProfile.isGuest;

  return (
    <>
      <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-3 sm:p-6">
        {/* Top Bar: Clean 2-side utility header (fits mobile & desktop on 1 row) */}
        <header className="flex items-center justify-between gap-2 w-full pointer-events-auto">
          <button
            type="button"
            data-testid="title-account-strip"
            onClick={onOpenProfile}
            className="min-h-[42px] flex items-center gap-2 bg-[#0c1d2e]/90 hover:bg-[#142a40] border-2 border-[#2b4d6e] rounded-2xl px-3 py-1.5 cursor-pointer transition-colors min-w-0"
          >
            <span className="text-xs sm:text-sm font-black text-[#ffd13b] truncate max-w-[110px] sm:max-w-[180px]">
              {accountProfile?.displayName ?? 'قبطان فرفوش'}
            </span>
            <span className="text-[11px] sm:text-xs font-bold text-[#b8d8f8] tabular-nums whitespace-nowrap shrink-0">
              م{accountProfile?.level ?? 1}
            </span>
            <span
              data-testid="title-coins-balance"
              className="text-xs font-black text-[#ffd13b] tabular-nums whitespace-nowrap shrink-0"
            >
              · 🪙 {accountProfile?.coins ?? 0}
            </span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="open-auth-btn"
              onClick={onOpenAuth}
              className="min-h-[42px] px-3 py-1.5 rounded-2xl bg-[#0c1d2e]/90 hover:bg-[#142a40] border-2 border-[#06d6a0]/60 text-xs font-black text-[#06d6a0] cursor-pointer whitespace-nowrap shrink-0"
            >
              {isGuest ? 'تسجيل الدخول' : 'الحساب'}
            </button>
            <button
              type="button"
              data-testid="open-settings-btn"
              aria-label="المظهر والإعدادات"
              onClick={onOpenSettings}
              className="min-h-[42px] min-w-[42px] px-3 py-1.5 rounded-2xl bg-[#0c1d2e]/90 hover:bg-[#142a40] border-2 border-[#2b4d6e] text-xs sm:text-sm font-black text-[#fff8e7] cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
            >
              <span aria-hidden="true">⚙️</span>
              <span className="hidden sm:inline">الإعدادات</span>
            </button>
          </div>
        </header>

        {/* Rare Sudden Event Banner (compact, only when active) */}
        {rareEvent?.active && (
          <div
            data-testid="title-rare-event-banner"
            className="pointer-events-auto mx-auto mt-2 w-full max-w-xl bg-[#132940]/95 border-2 rounded-2xl px-3.5 py-2 flex items-center justify-between gap-2 shadow-md"
            style={{ borderColor: rareEvent.accentHex || '#ffd13b' }}
          >
            <div className="text-xs font-bold text-[#fff8e7] min-w-0 truncate">
              <span className="font-black text-[#ffd13b]">⚡ {rareEvent.titleAr}</span>{' '}
              <span className="text-[#bae6fd] tabular-nums">
                · +{rareEvent.coinsBonus} 🪙 ({rareEvent.roundsRemaining} جولات)
              </span>
            </div>
            {onLaunchRareEvent && rareEvent.featuredCourseId && rareEvent.featuredGameMode && (
              <button
                type="button"
                data-testid="title-launch-rare-event-btn"
                onClick={() => onLaunchRareEvent(rareEvent.featuredCourseId!, rareEvent.featuredGameMode!)}
                className="min-h-[34px] px-3 py-1 rounded-xl bg-[#ffd13b] hover:bg-[#ffe066] text-[#14222f] text-xs font-black cursor-pointer whitespace-nowrap shrink-0"
              >
                انطلق
              </button>
            )}
          </div>
        )}

        {/* Center Hero: Uncluttered Logo + 2 Clear Primary Actions (3D Raft stays visible!) */}
        <div className="flex-1 flex flex-col items-center justify-center gap-5 sm:gap-6 pointer-events-none my-2">
          <div className="flex flex-col items-center text-center gap-2 pointer-events-auto">
            <div className="flex items-center gap-3">
              <svg
                viewBox="0 0 88 88"
                className="w-14 h-14 sm:w-20 sm:h-20 shrink-0 drop-shadow-md"
                aria-hidden="true"
              >
                <circle cx="24" cy="48" r="14" fill="#9ef01a" stroke="#14222f" strokeWidth="4" />
                <circle cx="15" cy="36" r="10" fill="#ccff33" stroke="#14222f" strokeWidth="3.5" />
                <circle cx="12" cy="54" r="8" fill="#70e000" stroke="#14222f" strokeWidth="3.5" />
                <rect x="28" y="48" width="52" height="18" rx="6" fill="#d48c46" stroke="#14222f" strokeWidth="4" />
                <line x1="42" y1="48" x2="42" y2="66" stroke="#7f4f24" strokeWidth="3" />
                <line x1="62" y1="48" x2="62" y2="66" stroke="#7f4f24" strokeWidth="3" />
                <line x1="64" y1="16" x2="64" y2="50" stroke="#5c3614" strokeWidth="5" strokeLinecap="round" />
                <polygon points="64,17 82,24 64,32" fill="#ff595e" stroke="#14222f" strokeWidth="3" strokeLinejoin="round" />
                <circle cx="48" cy="37" r="9" fill="#ffffff" stroke="#14222f" strokeWidth="3.5" />
                <circle cx="58" cy="38" r="8" fill="#ffffff" stroke="#14222f" strokeWidth="3.5" />
                <circle cx="49" cy="37" r="3.2" fill="#14222f" />
                <circle cx="59" cy="38" r="2.8" fill="#14222f" />
              </svg>
              <h1 className="text-3xl sm:text-6xl font-black text-[#ffd13b] cartoon-outline leading-tight">
                الطوف المجنونة
              </h1>
            </div>
            <p className="text-xs sm:text-base font-bold text-[#fff8e7] cartoon-outline-sm max-w-md">
              تعاون، وجّه الطوف، وأطلق الريح نحو خط النهاية!
            </p>
          </div>

          {/* Focused Primary Action Stack (2 clear buttons) */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full max-w-xs sm:max-w-lg pointer-events-auto">
            <button
              type="button"
              data-testid="open-play-setup-btn"
              onClick={() => setPlaySetupOpen(true)}
              className="wood-btn-primary flex-1 min-h-[54px] px-7 py-3.5 rounded-2xl text-lg sm:text-xl font-black cursor-pointer flex items-center justify-center gap-2.5 shadow-xl"
            >
              <span>ابدأ اللعب</span>
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden="true">
                <path d="M16 5l-10 7 10 7V5z" />
              </svg>
            </button>

            <button
              type="button"
              data-testid="open-lobby-btn"
              onClick={onOpenLobby}
              className="wood-btn-secondary flex-1 min-h-[54px] px-6 py-3.5 rounded-2xl text-base sm:text-lg font-extrabold cursor-pointer flex items-center justify-center gap-2 shadow-xl"
            >
              <span>اللعب الجماعي (أونلاين)</span>
            </button>
          </div>

          {/* Subtle current selection summary line (clickable to open setup) */}
          <button
            type="button"
            onClick={() => setPlaySetupOpen(true)}
            className="pointer-events-auto text-xs sm:text-sm font-bold text-[#fff8e7] cartoon-outline-sm hover:text-[#ffd13b] transition-colors cursor-pointer"
          >
            المسار الحالي: {selectedCourse.meta.nameAr} · {MODE_LABELS[selectedGameMode]} (اضغط للتغيير)
          </button>
        </div>

        {/* Bottom Navigation Dock: 4 clean thumb-friendly sections */}
        <nav
          aria-label="التنقل السريع"
          className="w-full max-w-xl mx-auto pointer-events-auto"
        >
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2 bg-[#0b1929]/92 border-2 border-[#2a4c6e] rounded-2xl p-1.5 shadow-xl">
            <button
              type="button"
              data-testid="open-shop-btn"
              onClick={onOpenShop}
              className="min-h-[48px] px-2 py-1.5 rounded-xl hover:bg-[#142a40] text-[#ffd13b] transition-colors cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5"
            >
              <span className="text-base leading-none" aria-hidden="true">🛍️</span>
              <span className="text-[11px] sm:text-xs font-black whitespace-nowrap">المتجر</span>
            </button>

            <button
              type="button"
              data-testid="open-quests-btn"
              onClick={onOpenQuestsSeason}
              className="min-h-[48px] px-2 py-1.5 rounded-xl hover:bg-[#142a40] text-[#bae6fd] transition-colors cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 tabular-nums"
            >
              <span className="text-base leading-none" aria-hidden="true">🎯</span>
              <span className="text-[11px] sm:text-xs font-black whitespace-nowrap">
                المهام{claimableRewardsCount > 0 ? ` (${claimableRewardsCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              data-testid="open-leaderboard-btn"
              onClick={onOpenLeaderboard}
              className="min-h-[48px] px-2 py-1.5 rounded-xl hover:bg-[#142a40] text-[#ffd13b] transition-colors cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5"
            >
              <span className="text-base leading-none" aria-hidden="true">🏆</span>
              <span className="text-[11px] sm:text-xs font-black whitespace-nowrap">المتصدرون</span>
            </button>

            <button
              type="button"
              data-testid="open-more-menu-btn"
              onClick={() => setMoreMenuOpen(true)}
              className="min-h-[48px] px-2 py-1.5 rounded-xl hover:bg-[#142a40] text-[#fff8e7] transition-colors cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5"
            >
              <span className="text-base leading-none" aria-hidden="true">📂</span>
              <span className="text-[11px] sm:text-xs font-black whitespace-nowrap">المزيد</span>
            </button>
          </div>
        </nav>
      </div>

      {/* Dedicated Solo Game Setup Screen */}
      {playSetupOpen && (
        <PlaySetupModal
          selectedCourseId={selectedCourseId}
          selectedGameMode={selectedGameMode}
          selectedDifficulty={selectedDifficulty}
          selectedBotDifficulty={selectedBotDifficulty}
          boatDamageEnabled={boatDamageEnabled}
          onSelectCourse={onSelectCourse}
          onSelectGameMode={onSelectGameMode}
          onSelectDifficulty={onSelectDifficulty}
          onSelectBotDifficulty={(d) => onSelectBotDifficulty?.(d)}
          onToggleBoatDamage={(enabled) => onToggleBoatDamage?.(enabled)}
          onStartSolo={onStartSolo}
          onStartTutorial={onStartTutorial}
          onStartPractice={onStartPractice}
          onClose={() => setPlaySetupOpen(false)}
        />
      )}

      {/* Dedicated More Tools & Hub Screen */}
      {moreMenuOpen && (
        <MoreMenuModal
          isGuest={isGuest}
          onOpenProfile={onOpenProfile}
          onOpenReplays={onOpenReplays}
          onOpenOps={onOpenOps}
          onOpenSettings={onOpenSettings}
          onOpenAuth={onOpenAuth}
          onStartTutorial={onStartTutorial}
          onStartPractice={onStartPractice}
          onClose={() => setMoreMenuOpen(false)}
        />
      )}
    </>
  );
};
