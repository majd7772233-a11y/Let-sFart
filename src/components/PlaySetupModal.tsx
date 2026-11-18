import React, { useEffect } from 'react';
import { COURSE_LIST } from '../shared/course.ts';
import type { BotDifficulty, CourseId, GameDifficulty, GameMode } from '../shared/types.ts';

interface PlaySetupModalProps {
  selectedCourseId: CourseId;
  selectedGameMode: GameMode;
  selectedDifficulty: GameDifficulty;
  selectedBotDifficulty: BotDifficulty;
  onSelectCourse: (courseId: CourseId) => void;
  onSelectGameMode: (mode: GameMode) => void;
  onSelectDifficulty: (difficulty: GameDifficulty) => void;
  onSelectBotDifficulty: (botDifficulty: BotDifficulty) => void;
  onStartSolo: () => void;
  onStartTutorial?: () => void;
  onStartPractice?: () => void;
  onClose: () => void;
}

const COURSE_EMBLEM: Record<CourseId, string> = {
  tropical: '🌴',
  volcanic: '🌋',
  glacial: '❄️',
  factory: '⚙️',
  storm: '⛈️',
};

const GAME_MODES: { id: GameMode; icon: string; label: string; hint: string }[] = [
  { id: 'standard', icon: '🚣', label: 'القياسي', hint: 'تعاون نحو خط النهاية' },
  { id: 'time_trial', icon: '⏱️', label: 'سباق الزمن', hint: 'نافس شبح أفضل زمن' },
  { id: 'survival', icon: '🌊', label: 'وضع البقاء', hint: 'مسار لا نهائي متصاعد' },
  { id: 'treasure', icon: '🪙', label: 'جمع الكنوز', hint: 'عملات ذهبية وصناديق' },
  { id: 'chaos', icon: '🌀', label: 'وضع الفوضى', hint: 'تأثيرات عشوائية كل 10ث' },
];

const DIFFICULTIES: { id: GameDifficulty; label: string }[] = [
  { id: 'easy', label: 'سهل' },
  { id: 'normal', label: 'متوسط' },
  { id: 'hard', label: 'صعب' },
];

function readBestRecordBadge(courseId: CourseId, mode: GameMode): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (mode === 'time_trial') {
      const raw = window.localStorage.getItem(`letsfart_tt_best_${courseId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { bestTime?: number };
      if (typeof parsed.bestTime === 'number' && Number.isFinite(parsed.bestTime)) {
        return `أفضل زمن: ${parsed.bestTime.toFixed(1)}ث`;
      }
    } else if (mode === 'survival') {
      const raw = window.localStorage.getItem(`letsfart_survival_best_${courseId}`);
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) {
        return `أبعد مسافة: ${Math.round(num)}م`;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export const PlaySetupModal: React.FC<PlaySetupModalProps> = ({
  selectedCourseId,
  selectedGameMode,
  selectedDifficulty,
  selectedBotDifficulty,
  onSelectCourse,
  onSelectGameMode,
  onSelectDifficulty,
  onSelectBotDifficulty,
  onStartSolo,
  onStartTutorial,
  onStartPractice,
  onClose,
}) => {
  const bestBadge = readBestRecordBadge(selectedCourseId, selectedGameMode);
  const activeModeMeta = GAME_MODES.find((m) => m.id === selectedGameMode) ?? GAME_MODES[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-testid="play-setup-modal"
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5 bg-[#071928]/82 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#0b1929] border-2 border-[#2a4c6e] w-full max-w-3xl rounded-3xl text-[#fff8e7] max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#1d3955] shrink-0">
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-[#ffd13b] leading-tight">
              إعداد الجولة الفردية
            </h2>
            <p className="text-xs sm:text-sm text-[#9cc6ee] mt-0.5">
              اختر المسار، نمط اللعب، ومستوى الصعوبة ثم انطلق
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#132940] hover:bg-[#1c3b5c] border border-[#2f567d] text-xs sm:text-sm font-bold text-[#dbeafe] cursor-pointer whitespace-nowrap shrink-0"
          >
            إغلاق
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
          {/* 1. Course Selection */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-black text-[#fff8e7]">1. اختر المسار</h3>
              <span className="text-xs text-[#9cc6ee]">5 بيئات مختلفة</span>
            </div>
            <div
              role="group"
              aria-label="اختيار المسار"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5"
            >
              {COURSE_LIST.map((course) => {
                const isSelected = course.id === selectedCourseId;
                return (
                  <button
                    key={course.id}
                    type="button"
                    data-course-id={course.id}
                    aria-pressed={isSelected}
                    onClick={() => onSelectCourse(course.id)}
                    className={`text-right rounded-2xl p-3 border-2 transition-colors cursor-pointer flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-[#142e48] border-[#ffd13b] text-[#fff8e7]'
                        : 'bg-[#0f2236] border-[#234363] text-[#dbeafe] hover:border-[#4b7eb0]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg leading-none" aria-hidden="true">
                        {COURSE_EMBLEM[course.id]}
                      </span>
                      <span className="text-[11px] font-bold text-[#b8d8f8]">
                        {course.meta.difficultyAr}
                      </span>
                    </div>
                    <div className="font-black text-sm text-[#ffd13b] leading-snug">
                      {course.meta.nameAr}
                    </div>
                    <div className="text-xs text-[#b8d8f8] leading-snug line-clamp-2">
                      {course.meta.subtitleAr}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Game Mode Selection */}
          <section className="space-y-2.5 pt-1 border-t border-[#18314a]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-black text-[#fff8e7]">2. نمط اللعب</h3>
              <span className="text-xs text-[#9cc6ee]">
                {activeModeMeta.hint}
                {bestBadge ? ` · 🏆 ${bestBadge}` : ''}
              </span>
            </div>
            <div
              role="group"
              aria-label="اختيار نمط اللعب"
              className="grid grid-cols-2 sm:grid-cols-5 gap-2"
            >
              {GAME_MODES.map((m) => {
                const active = m.id === selectedGameMode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-game-mode={m.id}
                    aria-pressed={active}
                    title={m.hint}
                    onClick={() => onSelectGameMode(m.id)}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black border transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                      active
                        ? 'bg-[#ffd13b] text-[#14222f] border-[#ffd13b]'
                        : 'bg-[#0f2236] text-[#dbeafe] border-[#234363] hover:border-[#4b7eb0]'
                    }`}
                  >
                    <span aria-hidden="true">{m.icon}</span>
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Difficulty & Bot AI */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-[#18314a]">
            <div className="space-y-2">
              <h3 className="text-sm font-black text-[#fff8e7]">3. صعوبة المسار</h3>
              <div
                role="group"
                aria-label="اختيار الصعوبة"
                className="grid grid-cols-3 gap-1.5 bg-[#081523] p-1.5 rounded-xl border border-[#234363]"
              >
                {DIFFICULTIES.map((d) => {
                  const active = d.id === selectedDifficulty;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      data-difficulty={d.id}
                      aria-pressed={active}
                      onClick={() => onSelectDifficulty(d.id)}
                      className={`min-h-[40px] rounded-lg text-xs sm:text-sm font-black cursor-pointer transition-colors ${
                        active
                          ? 'bg-[#38bdf8] text-[#082f49]'
                          : 'text-[#cbd5e1] hover:text-white hover:bg-[#132940]'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-black text-[#fff8e7]">4. ذكاء المساعدين الآليين</h3>
              <div
                role="group"
                aria-label="ذكاء المساعدين"
                className="grid grid-cols-3 gap-1.5 bg-[#081523] p-1.5 rounded-xl border border-[#234363]"
              >
                {DIFFICULTIES.map((d) => {
                  const active = d.id === selectedBotDifficulty;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      data-bot-difficulty={d.id}
                      aria-pressed={active}
                      onClick={() => onSelectBotDifficulty(d.id)}
                      className={`min-h-[40px] rounded-lg text-xs sm:text-sm font-black cursor-pointer transition-colors ${
                        active
                          ? 'bg-[#06d6a0] text-[#06281e]'
                          : 'text-[#cbd5e1] hover:text-white hover:bg-[#132940]'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Optional Training Shortcuts */}
          {(onStartTutorial || onStartPractice) && (
            <section className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#18314a]">
              <span className="text-xs font-bold text-[#9cc6ee] ml-1">تريد التدرب أولاً؟</span>
              {onStartTutorial && (
                <button
                  type="button"
                  data-testid="setup-start-tutorial-btn"
                  onClick={() => {
                    onClose();
                    onStartTutorial();
                  }}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#0f2942] hover:bg-[#163a5c] border border-[#38bdf8]/50 text-xs font-black text-[#bae6fd] cursor-pointer"
                >
                  🎓 تدريب تفاعلي للمبتدئين
                </button>
              )}
              {onStartPractice && (
                <button
                  type="button"
                  data-testid="setup-start-practice-btn"
                  onClick={() => {
                    onClose();
                    onStartPractice();
                  }}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#0f2942] hover:bg-[#163a5c] border border-[#06d6a0]/50 text-xs font-black text-[#a7f3d0] cursor-pointer"
                >
                  🧪 ساحة التدريب الحرة
                </button>
              )}
            </section>
          )}
        </div>

        {/* Sticky Footer CTA */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-[#1d3955] bg-[#081523] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          <div className="text-xs text-[#9cc6ee] hidden sm:block">
            ← → تحرك · Space إطلاق الريح · E المرساة · F موجة الدفع
          </div>
          <button
            type="button"
            data-start="true"
            data-testid="play-setup-launch-btn"
            onClick={() => {
              onClose();
              onStartSolo();
            }}
            className="wood-btn-primary min-h-[48px] px-7 py-3 rounded-2xl text-base sm:text-lg font-black cursor-pointer flex items-center justify-center gap-2"
          >
            <span>انطلق في الجولة الآن</span>
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
              <path d="M16 5l-10 7 10 7V5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
