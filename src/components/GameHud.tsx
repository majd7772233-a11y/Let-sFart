import React, { useEffect, useState } from 'react';
import type { HudSnapshot } from '../game/RaftSceneManager.ts';
import { getCourseById } from '../shared/course.ts';
import type {
  ChaosModifierKind,
  ChatMessage,
  ConnectionStatus,
  EmoteId,
  GameMode,
  HazardEffectTag,
  TouchControlsConfig,
} from '../shared/types.ts';
import { CAMERA_MODE_META, TUTORIAL_STEPS } from '../shared/ux.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { EmoteBar } from './EmoteBar.tsx';

const HAZARD_BANNER: Record<
  Exclude<HazardEffectTag, null>,
  { label: string; borderClass: string; textClass: string }
> = {
  ice: {
    label: 'انزلاق جليدي — احتكاك منخفض!',
    borderClass: 'border-[#67e8f9]',
    textClass: 'text-[#a5f3fc]',
  },
  thin_ice: {
    label: 'جليد هشّ — أسرع قبل التحطم!',
    borderClass: 'border-[#38bdf8]',
    textClass: 'text-[#bae6fd]',
  },
  heat: {
    label: 'موجة حرارة — دفع قوي واضطراب!',
    borderClass: 'border-[#fb923c]',
    textClass: 'text-[#fed7aa]',
  },
  wind: {
    label: 'تيار هواء جانبي!',
    borderClass: 'border-[#a3e635]',
    textClass: 'text-[#d9f99d]',
  },
  oil: {
    label: 'بقعة زيت — انزلاق!',
    borderClass: 'border-[#facc15]',
    textClass: 'text-[#fef08a]',
  },
  storm_wind: {
    label: 'رياح عاصفة متقلبة — وازِن الطوف بالمرساة!',
    borderClass: 'border-[#38bdf8]',
    textClass: 'text-[#e0f2fe]',
  },
  damaged: {
    label: 'هيكل الطوف متضرر — السرعة منخفضة! ابحث عن حقيبة إصلاح',
    borderClass: 'border-[#ef4444]',
    textClass: 'text-[#fecaca]',
  },
};

const CHAOS_BANNER: Record<
  Exclude<ChaosModifierKind, 'none'>,
  { label: string; borderClass: string; textClass: string }
> = {
  wind_flip: {
    label: '🌀 فوضى: رياح متقلبة عاصفة!',
    borderClass: 'border-[#38bdf8]',
    textClass: 'text-[#bae6fd]',
  },
  turbo_surge: {
    label: '⚡ فوضى: اندفاع توربو +45%!',
    borderClass: 'border-[#facc15]',
    textClass: 'text-[#fef08a]',
  },
  ghost_obstacles: {
    label: '👻 فوضى: عقبات شبحية وبوابات مسرعة!',
    borderClass: 'border-[#c084fc]',
    textClass: 'text-[#e9d5ff]',
  },
  reverse_controls: {
    label: '🔄 فوضى: التوجيه معكوس (يمين ↔ يسار)!',
    borderClass: 'border-[#f43f5e]',
    textClass: 'text-[#fecdd3]',
  },
};

const MODE_LABELS: Record<GameMode, string> = {
  standard: 'قياسي',
  time_trial: '⏱️ سباق الزمن',
  survival: '🌊 البقاء',
  treasure: '🪙 الكنوز',
  chaos: '🌀 الفوضى',
};

const BOOST_LABELS: Record<string, { label: string; colorClass: string }> = {
  lentil_can: { label: '🥫 عدس فاخر +65%', colorClass: 'border-[#f59e0b] text-[#fde68a]' },
  fava_can: { label: '🥫 فول مدمس +38%', colorClass: 'border-[#10b981] text-[#a7f3d0]' },
  bean_can: { label: '🥫 فاصولياء +20%', colorClass: 'border-[#ef4444] text-[#fecaca]' },
};

interface GameHudProps {
  hud: HudSnapshot;
  connectionStatus?: ConnectionStatus;
  muted: boolean;
  showTouchControls: boolean;
  touchConfig: TouchControlsConfig;
  powerFillRef: React.RefObject<HTMLDivElement | null>;
  powerLabelRef: React.RefObject<HTMLSpanElement | null>;
  roomChatMessages?: ChatMessage[];
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
  onToggleTouchControls: () => void;
  onCycleCameraMode?: () => void;
  onTouchInput: (control: 'left' | 'right' | 'fart' | 'anchor' | 'useItem', pressed: boolean) => void;
  onTriggerEmote?: (emoteId: EmoteId) => void;
  onSendChat?: (payload: { text?: string; presetId?: string }) => void;
  onSelectSpectatorTarget?: (target: 'raft' | 0 | 1 | 2 | 3) => void;
  onLeaveRoom?: () => void;
  onSkipTutorial?: () => void;
  onResetPracticeRaft?: () => void;
  onRespawnPracticePickups?: () => void;
  onTogglePracticeBots?: () => void;
  onFinishPractice?: () => void;
}

function formatTimer(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  connectionStatus = 'disconnected',
  muted,
  showTouchControls,
  touchConfig,
  powerFillRef,
  powerLabelRef,
  roomChatMessages = [],
  onToggleMute,
  onPause,
  onRestart,
  onToggleTouchControls,
  onCycleCameraMode,
  onTouchInput,
  onTriggerEmote,
  onSendChat,
  onSelectSpectatorTarget,
  onLeaveRoom,
  onSkipTutorial,
  onResetPracticeRaft,
  onRespawnPracticePickups,
  onTogglePracticeBots,
  onFinishPractice,
}) => {
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [lastReadCount, setLastReadCount] = useState(roomChatMessages.length);

  useEffect(() => {
    if (chatOpen) {
      setLastReadCount(roomChatMessages.length);
    }
  }, [chatOpen, roomChatMessages.length]);

  const unreadChatCount = chatOpen ? 0 : Math.max(0, roomChatMessages.length - lastReadCount);
  const progressPct = Math.round(hud.progress * 100);
  const course = getCourseById(hud.courseId);
  const activeHazardInfo = hud.activeHazardTag ? HAZARD_BANNER[hud.activeHazardTag] : null;

  const sim = hud.sim;
  const gameMode: GameMode = sim.gameMode ?? 'standard';
  const maxHp = Math.max(1, sim.maxHp ?? 100);
  const hpPct = Math.round(Math.max(0, Math.min(100, ((sim.raftHp ?? 100) / maxHp) * 100)));
  const hpBarColor = hpPct >= 65 ? '#22c55e' : hpPct >= 40 ? '#facc15' : '#ef4444';

  const harmonyPct = Math.round(Math.max(0, Math.min(100, (sim.harmony ?? 0) * 100)));
  const superFartActive = (sim.superFartTimer ?? 0) > 0;

  const anchorEnergyPct = Math.round(Math.max(0, Math.min(100, (sim.anchorEnergy ?? 1) * 100)));
  const anchorActive = Boolean(sim.anchorActive);

  const windMag = Math.hypot(sim.windX ?? 0, sim.windZ ?? 0);
  const windLabel =
    windMag > 0.5
      ? `${(sim.windX ?? 0) >= 0 ? '→ شرق' : '← غرب'} ${windMag.toFixed(1)}`
      : null;

  const boostBadge =
    sim.boostKind && (sim.boostTimer ?? 0) > 0 ? BOOST_LABELS[sim.boostKind] ?? null : null;

  const chaosInfo =
    gameMode === 'chaos' && sim.chaosModifier && sim.chaosModifier !== 'none'
      ? CHAOS_BANNER[sim.chaosModifier]
      : null;

  const remainingLimitSec =
    gameMode !== 'survival' && (sim.roundTimeLimitSec ?? 0) > 0
      ? Math.max(0, (sim.roundTimeLimitSec ?? 0) - hud.elapsedTime)
      : null;

  const bindPointerHold = (control: 'left' | 'right' | 'fart' | 'anchor') => ({
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

  const soloKind = hud.soloSessionKind ?? 'normal';
  const isPractice = soloKind === 'practice';
  const isTutorial = soloKind === 'tutorial';
  const cameraMeta = CAMERA_MODE_META[hud.cameraMode ?? 'follow'];
  const tutorialStep = isTutorial
    ? TUTORIAL_STEPS[Math.min(hud.tutorialProgress.stepIndex, TUTORIAL_STEPS.length - 1)]
    : null;

  const courseDisplayName = isPractice
    ? 'ساحة التدريب الحرة'
    : isTutorial
      ? 'تدريب المبتدئين'
      : course.meta.nameAr;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-5">
      {/* Top Perimeter + Mobile-Safe Alert Stack */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          {/* Top-Right in RTL (Start side): Course Progress, Mode Metrics, Hull HP, Harmony & Compact Stats */}
          <div className="bg-[#12263a]/90 border-2 border-[#f7d060] rounded-2xl px-2.5 sm:px-3 py-2 text-[#fff8e7] shadow-lg w-[196px] sm:w-[278px]">
            <div className="flex items-center justify-between gap-2 text-xs font-extrabold">
              <span className="flex items-center gap-1.5 text-[#ffd13b] truncate max-w-[136px] sm:max-w-[190px]">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/40"
                  style={{ backgroundColor: course.meta.accentHex }}
                />
                <span data-testid="hud-course-name" className="truncate">
                  {courseDisplayName}
                </span>
              </span>
              {isPractice ? (
                <span className="text-[11px] font-black text-[#06d6a0]">حر ∞</span>
              ) : gameMode === 'survival' ? (
                <span data-testid="hud-survival-distance" className="tabular-nums text-xs sm:text-sm font-black text-[#38bdf8]">
                  {Math.round(sim.survivalDistance ?? 0)}م
                </span>
              ) : (
                <span className="tabular-nums text-xs sm:text-sm font-black">{progressPct}%</span>
              )}
            </div>

            {!isPractice && gameMode !== 'survival' && (
              <div className="w-full h-2 bg-[#0a1826] rounded-full overflow-hidden border border-[#2c4e70] mt-1">
                <div
                  className="h-full bg-[#70e000] transition-transform duration-150 origin-right"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}

            {/* Mode-Specific Compact Strip */}
            {gameMode !== 'standard' && (
              <div
                data-testid="hud-mode-strip"
                className="mt-1.5 pt-1 border-t border-[#2c4e70] flex items-center justify-between gap-1.5 text-[10px] sm:text-[11px] font-black"
              >
                <span className="text-[#ffd13b]">{MODE_LABELS[gameMode]}</span>
                {gameMode === 'treasure' && (
                  <span data-testid="hud-treasure-counter" className="tabular-nums text-[#fde047]">
                    🪙 {sim.coinsCollected ?? 0}/{sim.totalCoins ?? 0} · 💎 {sim.treasureScore ?? 0}
                  </span>
                )}
                {gameMode === 'survival' && (
                  <span className="tabular-nums text-[#93c5fd]">
                    دورة {hud.checkpointIndex + 1} · سرعة ×{(sim.survivalSpeedScale ?? 1).toFixed(2)}
                  </span>
                )}
                {gameMode === 'time_trial' && (
                  <span className="tabular-nums">
                    {hud.ghostDeltaSec !== null ? (
                      <span className={hud.ghostDeltaSec <= 0 ? 'text-[#06d6a0]' : 'text-[#ff8589]'}>
                        {hud.ghostDeltaSec <= 0 ? '' : '+'}
                        {hud.ghostDeltaSec.toFixed(1)}ث
                      </span>
                    ) : hud.bestTimeTrialSec !== null ? (
                      <span className="text-[#93c5fd]">الهدف {hud.bestTimeTrialSec.toFixed(1)}ث</span>
                    ) : (
                      <span className="text-[#93c5fd]">تسجيل شبح</span>
                    )}
                  </span>
                )}
                {gameMode === 'chaos' && (
                  <span className="tabular-nums text-[#e9d5ff]">
                    تبديل: {Math.max(0, Math.ceil(sim.chaosTimer ?? 0))}ث
                  </span>
                )}
              </div>
            )}

            {/* Hull Integrity & Team Harmony Dual Compact Meters */}
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <div>
                <div className="flex items-center justify-between gap-1 text-[9.5px] sm:text-[10px] font-extrabold whitespace-nowrap">
                  <span className="text-[#e2e8f0]">سلامة</span>
                  <span data-testid="hud-raft-hp" className="tabular-nums" style={{ color: hpBarColor }}>
                    {hpPct}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#0a1826] rounded-full overflow-hidden border border-[#2c4e70] mt-0.5">
                  <div
                    className="h-full transition-all duration-150 origin-right"
                    style={{ width: `${hpPct}%`, backgroundColor: hpBarColor }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-1 text-[9.5px] sm:text-[10px] font-extrabold whitespace-nowrap">
                  <span className={superFartActive ? 'text-[#fde047]' : 'text-[#93c5fd]'}>
                    {superFartActive ? '⚡ تناغم' : 'تناغم'}
                  </span>
                  <span data-testid="hud-harmony" className="tabular-nums text-[#38bdf8]">
                    {harmonyPct}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#0a1826] rounded-full overflow-hidden border border-[#2c4e70] mt-0.5">
                  <div
                    className="h-full transition-all duration-150 origin-right"
                    style={{
                      width: `${harmonyPct}%`,
                      backgroundColor: superFartActive ? '#facc15' : '#38bdf8',
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-1.5 mt-1.5 text-[11px] sm:text-xs font-bold tabular-nums">
              {remainingLimitSec !== null ? (
                <span
                  data-testid="hud-round-limit"
                  title="الوقت المتبقي"
                  className={remainingLimitSec <= 20 ? 'text-[#ff8589] font-black' : 'text-[#fde047] font-black'}
                >
                  ⏳ {formatTimer(remainingLimitSec)}
                </span>
              ) : (
                <span title="الوقت">⏱ {formatTimer(hud.elapsedTime)}</span>
              )}
              {gameMode !== 'survival' && (
                <span title="نقاط الحفظ">🚩 {hud.checkpointIndex}/{hud.totalCheckpoints}</span>
              )}
              <span title="السقوط">💦 {hud.falls}</span>
              <span title="الطاقم">👥 {hud.connectedPlayers}/4</span>
            </div>

            {windLabel && (
              <div
                data-testid="hud-wind-indicator"
                className="mt-1 pt-1 border-t border-[#2c4e70] flex items-center justify-between text-[10px] sm:text-[11px] font-extrabold text-[#7dd3fc]"
              >
                <span>💨 رياح العاصفة</span>
                <span className="tabular-nums">{windLabel}</span>
              </div>
            )}

            {hud.mode === 'online' && (
              <div className="mt-1 pt-1 border-t border-[#2c4e70] flex items-center justify-between text-[10px] font-extrabold">
                <span className="text-[#93c5fd]">حالة الاتصال</span>
                <span
                  data-testid="hud-connection-status"
                  className={
                    connectionStatus === 'connected'
                      ? 'text-[#06d6a0]'
                      : connectionStatus === 'reconnecting' || connectionStatus === 'connecting'
                        ? 'text-[#ffd166]'
                        : 'text-[#ff595e]'
                  }
                >
                  {connectionStatus === 'connected'
                    ? 'متصل'
                    : connectionStatus === 'reconnecting'
                      ? 'جاري إعادة الاتصال...'
                      : connectionStatus === 'connecting'
                        ? 'جاري الاتصال...'
                        : 'انقطع الاتصال'}
                </span>
              </div>
            )}
          </div>

          {/* Top-Left in RTL (End side): Compact Square SVG Utility Buttons + Camera Mode Switcher */}
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 pointer-events-auto max-w-[168px] sm:max-w-none">
            {onCycleCameraMode && (
              <button
                type="button"
                tabIndex={-1}
                data-testid="hud-camera-mode-btn"
                data-camera-mode={hud.cameraMode ?? 'follow'}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCycleCameraMode();
                }}
                aria-label={`تغيير نمط الكاميرا: ${cameraMeta.labelAr} [C]`}
                title={`تغيير نمط الكاميرا: ${cameraMeta.labelAr} [C]`}
                className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl bg-[#12263a]/88 hover:bg-[#19334d] border-2 border-[#38bdf8] text-[#bae6fd] flex items-center gap-1 cursor-pointer shadow-md text-[11px] font-black whitespace-nowrap"
              >
                <span aria-hidden="true">📷</span>
                <span>{cameraMeta.shortAr}</span>
              </button>
            )}
            {onTriggerEmote && (
              <button
                type="button"
                tabIndex={-1}
                data-testid="hud-emote-toggle"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setEmotesOpen((o) => !o);
                }}
                aria-label="تعبيرات الشخصية [1-6]"
                aria-expanded={emotesOpen}
                title="تعبيرات الشخصية [1-6]"
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl border-2 flex items-center justify-center cursor-pointer shadow-md text-base ${
                  emotesOpen
                    ? 'bg-[#ffd13b] border-[#14222f] text-[#14222f]'
                    : 'bg-[#12263a]/88 border-[#f7d060] text-[#fff8e7]'
                }`}
              >
                <span aria-hidden="true">😄</span>
              </button>
            )}

            {hud.mode === 'online' && onSendChat && (
              <button
                type="button"
                tabIndex={-1}
                data-testid="hud-chat-toggle"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setChatOpen((o) => !o);
                }}
                aria-label="دردشة الطاقم"
                aria-expanded={chatOpen}
                title="دردشة الطاقم"
                className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl border-2 flex items-center justify-center cursor-pointer shadow-md text-base ${
                  chatOpen
                    ? 'bg-[#38bdf8] border-[#bae6fd] text-[#082f49]'
                    : 'bg-[#12263a]/88 border-[#f7d060] text-[#fff8e7]'
                }`}
              >
                <span aria-hidden="true">💬</span>
                {unreadChatCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff595e] text-white text-[10px] font-black flex items-center justify-center tabular-nums border border-[#14222f]">
                    {unreadChatCount > 9 ? '9+' : unreadChatCount}
                  </span>
                )}
              </button>
            )}

            {!hud.isSpectator && (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleTouchControls();
                }}
                aria-label="أزرار اللمس"
                title="إظهار/إخفاء أزرار اللمس"
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl border-2 flex items-center justify-center cursor-pointer shadow-md ${
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
            )}

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={muted ? 'تشغيل الصوت [M]' : 'كتم الصوت [M]'}
              title="كتم/تشغيل الصوت [M]"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#12263a]/88 border-2 border-[#f7d060] text-[#fff8e7] flex items-center justify-center cursor-pointer shadow-md"
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

            {!hud.isSpectator && (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRestart();
                }}
                aria-label="إعادة المحاولة [R]"
                title="إعادة المحاولة [R]"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#12263a]/88 border-2 border-[#f7d060] text-[#fff8e7] flex items-center justify-center cursor-pointer shadow-md"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            )}

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              aria-label="إيقاف مؤقت [Esc]"
              title="إيقاف مؤقت [Esc]"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#12263a]/88 border-2 border-[#f7d060] text-[#fff8e7] flex items-center justify-center cursor-pointer shadow-md"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Top-Center Alerts: Flows below top bar on mobile (<640px), floats top-center on desktop (>=640px) */}
        <div className="self-center sm:fixed sm:top-3 sm:left-1/2 sm:-translate-x-1/2 z-20 flex flex-col items-center gap-1.5 pointer-events-none max-w-[94vw] sm:max-w-[46vw]">
          {/* UX-01: Interactive Beginner Tutorial Coach Banner */}
          {isTutorial && tutorialStep && hud.tutorialProgress.active && (
            <div
              data-testid="tutorial-coach-banner"
              data-tutorial-step={hud.tutorialProgress.stepIndex}
              className="pointer-events-auto bg-[#0c2942]/95 border-2 border-[#38bdf8] rounded-2xl px-3.5 py-2.5 shadow-xl text-right w-full sm:w-[430px]"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs sm:text-sm font-black text-[#ffd13b]">
                  🎓 {tutorialStep.titleAr}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-black bg-[#19334d] text-[#bae6fd] px-2 py-0.5 rounded-lg tabular-nums">
                    {hud.tutorialProgress.stepIndex + 1}/{TUTORIAL_STEPS.length}
                  </span>
                  {onSkipTutorial && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="tutorial-skip-btn"
                      onClick={onSkipTutorial}
                      className="px-2 py-0.5 rounded-lg bg-[#381d2a] hover:bg-[#4f283b] border border-[#ff595e]/60 text-[10px] font-black text-[#ffd6d8] cursor-pointer"
                    >
                      تخطي / خروج
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] sm:text-xs font-bold text-[#fff8e7] leading-snug">
                {tutorialStep.instructionAr}
              </p>
              <div className="mt-1.5 text-[10px] sm:text-[11px] font-black text-[#9ef01a]">
                {showTouchControls ? tutorialStep.touchHintAr : tutorialStep.keyHintAr}
              </div>
            </div>
          )}

          {/* UX-02: Free Practice Arena Action Bar */}
          {isPractice && (
            <div
              data-testid="hud-practice-bar"
              className="pointer-events-auto bg-[#0c2942]/95 border-2 border-[#06d6a0] rounded-2xl px-3 py-1.5 shadow-xl flex flex-wrap items-center justify-center gap-1.5"
            >
              <span className="text-[11px] font-black text-[#a7f3d0] px-1">
                🧪 ساحة التدريب
              </span>
              {onResetPracticeRaft && (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="practice-reset-raft-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onResetPracticeRaft();
                  }}
                  className="px-2.5 py-1 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#38bdf8]/60 text-[11px] font-black text-[#fff8e7] cursor-pointer"
                >
                  📍 إعادة للمركز
                </button>
              )}
              {onRespawnPracticePickups && (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="practice-respawn-items-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onRespawnPracticePickups();
                  }}
                  className="px-2.5 py-1 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#ffd13b]/60 text-[11px] font-black text-[#ffd13b] cursor-pointer"
                >
                  🎁 تجديد الأدوات
                </button>
              )}
              {onTogglePracticeBots && (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="practice-toggle-bots-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onTogglePracticeBots();
                  }}
                  className={`px-2.5 py-1 rounded-xl border text-[11px] font-black cursor-pointer ${
                    hud.practiceBotsEnabled
                      ? 'bg-[#06d6a0]/25 border-[#06d6a0] text-[#a7f3d0]'
                      : 'bg-[#19334d] border-[#64748b] text-[#cbd5e1]'
                  }`}
                >
                  🤖 الطاقم: {hud.practiceBotsEnabled ? 'مفعل' : 'متوقف'}
                </button>
              )}
              {onFinishPractice && (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="practice-exit-btn"
                  onClick={onFinishPractice}
                  className="px-2.5 py-1 rounded-xl bg-[#381d2a] hover:bg-[#4f283b] border border-[#ff595e]/60 text-[11px] font-black text-[#ffd6d8] cursor-pointer"
                >
                  خروج
                </button>
              )}
            </div>
          )}

          {(hud.toastText || (hud.mode === 'online' && connectionStatus === 'reconnecting')) && (
            <div className="bg-[#12263a]/95 border-2 border-[#ffd13b] px-3.5 sm:px-4 py-1 sm:py-1.5 rounded-2xl shadow-xl text-center">
              <span className="text-xs sm:text-base font-black text-[#ffd13b]">
                {hud.mode === 'online' && connectionStatus === 'reconnecting'
                  ? 'جاري إعادة الاتصال بالغرفة تلقائياً...'
                  : hud.toastText}
              </span>
            </div>
          )}

          {hud.mode === 'online' && sim.players.some((p) => p.tempBotSubstitute) && (
            <div
              data-testid="hud-temp-bot-banner"
              className="bg-[#102438]/95 border border-[#06d6a0] px-3 py-1 rounded-xl text-[11px] sm:text-xs font-black text-[#a7f3d0]"
            >
              🤖 بديل آلي مؤقت يغطي:{' '}
              {sim.players
                .filter((p) => p.tempBotSubstitute)
                .map((p) => p.name)
                .join('، ')}
            </div>
          )}

          {chaosInfo && (
            <div
              data-testid="hud-chaos-banner"
              className={`bg-[#1a1030]/95 border-2 ${chaosInfo.borderClass} px-3.5 py-1 rounded-xl shadow-lg text-center flex items-center gap-2`}
            >
              <span className={`text-[11px] sm:text-sm font-black ${chaosInfo.textClass}`}>
                {chaosInfo.label}
              </span>
              <span className="text-[11px] font-black text-white tabular-nums bg-black/40 px-2 py-0.5 rounded-lg">
                {Math.max(0, Math.ceil(sim.chaosTimer ?? 0))}ث
              </span>
            </div>
          )}

          {/* Active Pickup Buff Badges */}
          {(boostBadge || (sim.shieldHits ?? 0) > 0 || (sim.magnetTimer ?? 0) > 0 || superFartActive) && (
            <div data-testid="hud-active-buffs" className="flex flex-wrap items-center justify-center gap-1.5">
              {boostBadge && (
                <span
                  className={`bg-[#102438]/92 border-2 ${boostBadge.colorClass} px-2.5 py-0.5 rounded-xl text-[11px] font-black shadow`}
                >
                  {boostBadge.label} ({(sim.boostTimer ?? 0).toFixed(1)}ث)
                </span>
              )}
              {(sim.shieldHits ?? 0) > 0 && (
                <span className="bg-[#102438]/92 border-2 border-[#38bdf8] text-[#bae6fd] px-2.5 py-0.5 rounded-xl text-[11px] font-black shadow">
                  🛡️ درع ×{sim.shieldHits} ({(sim.shieldTimer ?? 0).toFixed(0)}ث)
                </span>
              )}
              {(sim.magnetTimer ?? 0) > 0 && (
                <span className="bg-[#102438]/92 border-2 border-[#f43f5e] text-[#fecdd3] px-2.5 py-0.5 rounded-xl text-[11px] font-black shadow">
                  🧲 مغناطيس ({(sim.magnetTimer ?? 0).toFixed(1)}ث)
                </span>
              )}
              {superFartActive && (
                <span className="bg-[#102438]/92 border-2 border-[#facc15] text-[#fef08a] px-2.5 py-0.5 rounded-xl text-[11px] font-black shadow">
                  ⚡💨 نفخة خارقة!
                </span>
              )}
            </div>
          )}

          {activeHazardInfo && (
            <div
              data-testid="hud-hazard-banner"
              className={`bg-[#0e1f30]/92 border-2 ${activeHazardInfo.borderClass} px-3.5 py-1 rounded-xl shadow-lg text-center`}
            >
              <span className={`text-[11px] sm:text-sm font-black ${activeHazardInfo.textClass}`}>
                {activeHazardInfo.label}
              </span>
            </div>
          )}
        </div>
        {/* ONLINE-06: Spectator Mode Banner & Camera Target Switcher */}
        {hud.isSpectator && (
          <div
            data-testid="hud-spectator-banner"
            className="self-center pointer-events-auto bg-[#0c2942]/95 border-2 border-[#38bdf8] rounded-2xl px-3.5 py-2 shadow-xl flex flex-wrap items-center justify-center gap-2 text-xs font-black text-[#bae6fd]"
          >
            <span>👁️ وضع المشاهد · تتأهل لمقعد تلقائياً عند توفره</span>
            {onSelectSpectatorTarget && (
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => onSelectSpectatorTarget('raft')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] cursor-pointer ${
                    hud.spectatorTarget === 'raft'
                      ? 'bg-[#ffd13b] text-[#14222f]'
                      : 'bg-[#19334d] text-white hover:bg-[#23476b]'
                  }`}
                >
                  🚣 الطوف كامل
                </button>
                {sim.players.map((p, idx) =>
                  p.connected ? (
                    <button
                      key={idx}
                      type="button"
                      tabIndex={-1}
                      onClick={() => onSelectSpectatorTarget(idx as 0 | 1 | 2 | 3)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] cursor-pointer ${
                        hud.spectatorTarget === idx
                          ? 'bg-[#ffd13b] text-[#14222f]'
                          : 'bg-[#19334d] text-white hover:bg-[#23476b]'
                      }`}
                    >
                      {p.name}
                    </button>
                  ) : null,
                )}
              </div>
            )}
            {onLeaveRoom && (
              <button
                type="button"
                tabIndex={-1}
                onClick={onLeaveRoom}
                className="px-2.5 py-1 rounded-lg bg-[#ff595e]/25 hover:bg-[#ff595e]/45 border border-[#ff595e] text-[11px] text-white cursor-pointer"
              >
                مغادرة
              </button>
            )}
          </div>
        )}
      </div>

      {/* Expandable HUD Chat Drawer & Emote Bar (Non-Blocking Corner / Bottom Strip) */}
      <div className="flex flex-col gap-2 w-full">
        {chatOpen && hud.mode === 'online' && onSendChat && (
          <div className="pointer-events-auto self-start w-full max-w-xs sm:max-w-sm shadow-2xl">
            <ChatPanel
              title="دردشة الطاقم المباشرة"
              messages={roomChatMessages}
              onSendChat={onSendChat}
              compact
              maxHeightClass="max-h-28"
              testIdPrefix="hud-chat"
            />
          </div>
        )}

        {emotesOpen && onTriggerEmote && (
          <div className="pointer-events-auto self-center bg-[#102438]/95 border-2 border-[#f7d060] rounded-2xl px-3 py-2 shadow-xl">
            <EmoteBar onTriggerEmote={onTriggerEmote} compact showShortcuts />
          </div>
        )}

        {/* Bottom Perimeter: Customizable Touch Controls + Live Fart Power Bar + Anchor & Held Item Action (Hidden for Spectators) */}
        {!hud.isSpectator && (
          <div
            dir="ltr"
            data-testid="hud-touch-bottom-bar"
            data-touch-preset={touchConfig.preset}
            className={`flex items-end justify-between gap-2 w-full ${
              touchConfig.preset === 'left' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* Touch Left/Right Movement Cluster */}
            {showTouchControls ? (
              <div
                data-testid="hud-touch-dpad"
                className="flex items-center gap-1.5 sm:gap-2.5 pointer-events-auto shrink-0"
                style={{
                  opacity: touchConfig.opacity,
                  transform: `translate(${touchConfig.offsets.dpad.x}px, ${touchConfig.offsets.dpad.y}px) scale(${touchConfig.scale})`,
                  transformOrigin: touchConfig.preset === 'left' ? 'bottom right' : 'bottom left',
                }}
              >
                <button
                  type="button"
                  aria-label="تحرك لليسار"
                  {...bindPointerHold('left')}
                  className="w-13 h-13 sm:w-16 sm:h-16 rounded-2xl bg-[#12263a]/88 border-2 sm:border-3 border-[#f7d060] text-[#fff8e7] active:bg-[#ffd13b] active:text-[#12263a] flex items-center justify-center shadow-lg cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="تحرك لليمين"
                  {...bindPointerHold('right')}
                  className="w-13 h-13 sm:w-16 sm:h-16 rounded-2xl bg-[#12263a]/88 border-2 sm:border-3 border-[#f7d060] text-[#fff8e7] active:bg-[#ffd13b] active:text-[#12263a] flex items-center justify-center shadow-lg cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="hidden sm:block w-20" />
            )}

            {/* Center Cluster: Anchor Button + Live Fart Thrust Meter + Held Item Trigger */}
            <div dir="rtl" className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2.5 mx-auto">
              {/* Anchor Hold Control [E] */}
              <button
                type="button"
                tabIndex={-1}
                data-testid="hud-anchor-btn"
                aria-label="المرساة لتثبيت الطوف [E]"
                {...bindPointerHold('anchor')}
                style={{
                  opacity: showTouchControls ? touchConfig.opacity : 1,
                  transform: showTouchControls
                    ? `translate(${touchConfig.offsets.anchor.x}px, ${touchConfig.offsets.anchor.y}px) scale(${touchConfig.scale})`
                    : undefined,
                }}
                className={`pointer-events-auto rounded-2xl border-2 px-3 py-1.5 text-[#fff8e7] shadow-lg cursor-pointer min-w-[106px] sm:min-w-[120px] transition-colors ${
                  anchorActive
                    ? 'bg-[#0284c7] border-[#bae6fd]'
                    : 'bg-[#12263a]/88 border-[#38bdf8] hover:bg-[#19334d]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] font-black">
                  <span>⚓ المرساة</span>
                  <span className="text-[10px] text-[#bae6fd]">[E]</span>
                </div>
                <div className="w-full h-1.5 bg-[#0a1826] rounded-full overflow-hidden border border-[#2c4e70] mt-1">
                  <div
                    className="h-full bg-[#38bdf8] transition-all duration-100 origin-right"
                    style={{ width: `${anchorEnergyPct}%` }}
                  />
                </div>
              </button>

              {/* Live Fart Thrust Meter */}
              <div className="bg-[#12263a]/88 border-2 border-[#f7d060] rounded-2xl px-2.5 sm:px-3 py-1.5 sm:py-2 text-[#fff8e7] w-32 sm:w-60 shadow-lg">
                <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-extrabold mb-1">
                  <span className="text-[#9ef01a]">شدة الريح</span>
                  <span ref={powerLabelRef} className="tabular-nums text-[#ffd13b]">
                    جاهز
                  </span>
                </div>
                <div className="w-full h-2.5 sm:h-3 bg-[#0a1826] rounded-full overflow-hidden border border-[#2c4e70]">
                  <div
                    ref={powerFillRef}
                    className="h-full bg-[#9ef01a] origin-right"
                    style={{ transform: 'scaleX(0)' }}
                  />
                </div>
              </div>

              {/* Shockwave Held Item Button [F] */}
              {sim.heldItem === 'shockwave' && (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="hud-use-item-btn"
                  style={{
                    opacity: showTouchControls ? touchConfig.opacity : 1,
                    transform: showTouchControls
                      ? `translate(${touchConfig.offsets.item.x}px, ${touchConfig.offsets.item.y}px) scale(${touchConfig.scale})`
                      : undefined,
                  }}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onTouchInput('useItem', true);
                  }}
                  className="pointer-events-auto rounded-2xl border-2 border-[#14222f] bg-[#facc15] hover:bg-[#fde047] text-[#14222f] px-3.5 py-2 font-black text-xs shadow-lg cursor-pointer"
                >
                  💥 موجة دفع [F]
                </button>
              )}
            </div>

            {/* Touch Fart Hold Button */}
            {showTouchControls ? (
              <button
                type="button"
                data-testid="hud-touch-fart"
                aria-label="إطلاق الريح"
                {...bindPointerHold('fart')}
                style={{
                  opacity: touchConfig.opacity,
                  transform: `translate(${touchConfig.offsets.fart.x}px, ${touchConfig.offsets.fart.y}px) scale(${touchConfig.scale})`,
                  transformOrigin: touchConfig.preset === 'left' ? 'bottom left' : 'bottom right',
                }}
                className="pointer-events-auto w-20 h-16 sm:w-28 sm:h-22 rounded-2xl sm:rounded-3xl bg-[#9ef01a] active:bg-[#ffd13b] text-[#14222f] border-2 sm:border-3 border-[#14222f] shadow-[0_4px_0_#387d00] font-black text-xs sm:text-lg flex flex-col items-center justify-center cursor-pointer shrink-0"
              >
                <span>إطلاق الريح</span>
                <span className="text-[10px] sm:text-[11px] font-extrabold opacity-80">اضغط باستمرار</span>
              </button>
            ) : (
              <div className="hidden sm:block w-20" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
