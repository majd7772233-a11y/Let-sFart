import React from 'react';
import type { HudSnapshot } from '../game/RaftSceneManager.ts';

interface GameHudProps {
  hud: HudSnapshot;
  muted: boolean;
  showTouchControls: boolean;
  powerFillRef: React.RefObject<HTMLDivElement | null>;
  powerLabelRef: React.RefObject<HTMLSpanElement | null>;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
  onToggleTouchControls: () => void;
  onTouchInput: (control: 'left' | 'right' | 'fart', pressed: boolean) => void;
}

function formatTimer(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  muted,
  showTouchControls,
  powerFillRef,
  powerLabelRef,
  onToggleMute,
  onPause,
  onRestart,
  onToggleTouchControls,
  onTouchInput,
}) => {
  const progressPct = Math.round(hud.progress * 100);

  const bindPointerHold = (control: 'left' | 'right' | 'fart') => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      onTouchInput(control, true);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      onTouchInput(control, false);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onTouchInput(control, false);
    },
    onLostPointerCapture: () => {
      onTouchInput(control, false);
    },
  });

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 sm:p-5">
      {/* Top Perimeter Clusters */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Right in RTL (Start side): Course Progress & Compact Stats */}
        <div className="bg-[#12263a]/88 border-2 border-[#f7d060] rounded-2xl px-3.5 py-2.5 text-[#fff8e7] shadow-lg min-w-[200px] sm:min-w-[250px]">
          <div className="flex items-center justify-between gap-4 text-xs font-extrabold">
            <span className="text-[#ffd13b]">تقدم المسار</span>
            <span className="tabular-nums text-sm font-black">{progressPct}%</span>
          </div>
          <div className="w-full h-2.5 bg-[#0a1826] rounded-full overflow-hidden border border-[#2c4e70] mt-1">
            <div
              className="h-full bg-[#70e000] transition-transform duration-150 origin-right"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 mt-2 text-xs font-bold tabular-nums">
            <span title="الوقت">⏱ {formatTimer(hud.elapsedTime)}</span>
            <span title="نقاط الحفظ">🚩 {hud.checkpointIndex}/{hud.totalCheckpoints}</span>
            <span title="السقوط">💦 {hud.falls}</span>
            <span title="الطاقم">👥 {hud.connectedPlayers}/4</span>
          </div>
        </div>

        {/* Top-Left in RTL (End side): Compact Square SVG Utility Buttons */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleTouchControls();
            }}
            aria-label="أزرار اللمس"
            title="إظهار/إخفاء أزرار اللمس"
            className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center cursor-pointer shadow-md ${
              showTouchControls
                ? 'bg-[#ffd13b] border-[#14222f] text-[#14222f]'
                : 'bg-[#12263a]/88 border-[#f7d060] text-[#fff8e7]'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="4" y="6" width="16" height="12" rx="3" />
              <circle cx="9" cy="12" r="1.5" fill="currentColor" />
              <circle cx="15" cy="12" r="1.5" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'تشغيل الصوت [M]' : 'كتم الصوت [M]'}
            title="كتم/تشغيل الصوت [M]"
            className="w-10 h-10 rounded-xl bg-[#12263a]/88 border-2 border-[#f7d060] text-[#fff8e7] flex items-center justify-center cursor-pointer shadow-md"
          >
            {muted ? (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M11 5L6 9H3v6h3l5 4V5z" />
                <line x1="16" y1="9" x2="21" y2="15" />
                <line x1="21" y1="9" x2="16" y2="15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M11 5L6 9H3v6h3l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 010 7" />
                <path d="M18.5 6a8.5 8.5 0 010 12" />
              </svg>
            )}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onRestart();
            }}
            aria-label="إعادة المحاولة [R]"
            title="إعادة المحاولة [R]"
            className="w-10 h-10 rounded-xl bg-[#12263a]/88 border-2 border-[#f7d060] text-[#fff8e7] flex items-center justify-center cursor-pointer shadow-md"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="إيقاف مؤقت [Esc]"
            title="إيقاف مؤقت [Esc]"
            className="w-10 h-10 rounded-xl bg-[#12263a]/88 border-2 border-[#f7d060] text-[#fff8e7] flex items-center justify-center cursor-pointer shadow-md"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Transient Checkpoint / Fall Toast (Top-Center, zero center-playfield occlusion) */}
      {hud.toastText && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 bg-[#12263a]/95 border-2 border-[#ffd13b] px-5 py-2 rounded-2xl shadow-xl whitespace-nowrap">
          <span className="text-sm sm:text-base font-black text-[#ffd13b]">{hud.toastText}</span>
        </div>
      )}

      {/* Bottom Perimeter: Touch Controls + Live Fart Power Bar */}
      <div className="flex items-end justify-between gap-3 w-full">
        {/* Touch Right/Left Movement Cluster */}
        {showTouchControls ? (
          <div className="flex items-center gap-2.5 pointer-events-auto" dir="ltr">
            <button
              type="button"
              aria-label="تحرك لليسار"
              {...bindPointerHold('left')}
              className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-[#12263a]/88 border-3 border-[#f7d060] text-[#fff8e7] active:bg-[#ffd13b] active:text-[#12263a] flex items-center justify-center shadow-lg cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="تحرك لليمين"
              {...bindPointerHold('right')}
              className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-[#12263a]/88 border-3 border-[#f7d060] text-[#fff8e7] active:bg-[#ffd13b] active:text-[#12263a] flex items-center justify-center shadow-lg cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : (
          <div />
        )}

        {/* Center Live Fart Thrust Meter (updated via DOM ref at 60fps without React re-renders) */}
        <div className="bg-[#12263a]/88 border-2 border-[#f7d060] rounded-2xl px-3.5 py-2 text-[#fff8e7] w-48 sm:w-64 shadow-lg">
          <div className="flex items-center justify-between text-[11px] font-extrabold mb-1">
            <span className="text-[#9ef01a]">شدة الريح</span>
            <span ref={powerLabelRef} className="tabular-nums text-[#ffd13b]">
              جاهز
            </span>
          </div>
          <div className="w-full h-3 bg-[#0a1826] rounded-full overflow-hidden border border-[#2c4e70]">
            <div
              ref={powerFillRef}
              className="h-full bg-[#9ef01a] origin-right"
              style={{ transform: 'scaleX(0)' }}
            />
          </div>
        </div>

        {/* Touch Fart Hold Button */}
        {showTouchControls ? (
          <button
            type="button"
            aria-label="إطلاق الريح"
            {...bindPointerHold('fart')}
            className="pointer-events-auto w-24 h-20 sm:w-28 sm:h-22 rounded-3xl bg-[#9ef01a] active:bg-[#ffd13b] text-[#14222f] border-3 border-[#14222f] shadow-[0_5px_0_#387d00] font-black text-base sm:text-lg flex flex-col items-center justify-center cursor-pointer"
          >
            <span>إطلاق الريح</span>
            <span className="text-[11px] font-extrabold opacity-80">اضغط باستمرار</span>
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
};
