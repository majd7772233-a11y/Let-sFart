import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BOT_DIFFICULTY_META, BOT_PERSONALITY_META } from '../shared/bots.ts';
import { COSMETIC_COLOR_DEFS } from '../shared/cosmetics.ts';
import { getChannelBoundsAtZ, getCourseById } from '../shared/course.ts';
import { fetchRoundReplayDetail, fetchRoundReplays } from '../net/progressionClient.ts';
import type {
  GameMode,
  ReplayKeyframe,
  RoundReplayRecord,
  RoundReplaySummary,
  SimEvent,
} from '../shared/types.ts';

interface ReplayModalProps {
  initialMatchId?: string | null;
  initialReplay?: RoundReplayRecord | null;
  onClose: () => void;
}

const MODE_LABELS: Record<GameMode, string> = {
  standard: 'القياسي',
  time_trial: 'سباق الزمن',
  survival: 'وضع البقاء',
  treasure: 'جمع الكنوز',
  chaos: 'وضع الفوضى',
};

const EVENT_LABELS: Partial<Record<SimEvent['type'], { icon: string; label: string; color: string }>> = {
  checkpoint: { icon: '🚩', label: 'نقطة حفظ', color: '#06d6a0' },
  fall: { icon: '💦', label: 'سقوط الطوف', color: '#ff595e' },
  pickup: { icon: '🎁', label: 'التقاط أداة', color: '#ffd13b' },
  super_fart: { icon: '⚡', label: 'نفخة خارقة', color: '#facc15' },
  shockwave: { icon: '💥', label: 'موجة دفع', color: '#fb923c' },
  chaos_shift: { icon: '🌀', label: 'تبدّل الفوضى', color: '#c084fc' },
  lightning: { icon: '⛈️', label: 'صاعقة برق', color: '#38bdf8' },
  shield_break: { icon: '🛡️', label: 'تحطم الدرع', color: '#7dd3fc' },
  finish: { icon: '🏁', label: 'خط النهاية', color: '#06d6a0' },
};

function formatReplayTime(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

function interpolateFrame(frames: ReplayKeyframe[], t: number): ReplayKeyframe | null {
  if (frames.length === 0) return null;
  if (t <= frames[0].t) return frames[0];
  const last = frames[frames.length - 1];
  if (t >= last.t) return last;

  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = Math.max(0.0001, b.t - a.t);
  const alpha = (t - a.t) / span;
  let dyaw = b.yaw - a.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  return {
    t,
    x: a.x + (b.x - a.x) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    yaw: a.yaw + dyaw * alpha,
    progress: a.progress + (b.progress - a.progress) * alpha,
    raftHp: Math.round(a.raftHp + (b.raftHp - a.raftHp) * alpha),
    harmony: a.harmony + (b.harmony - a.harmony) * alpha,
    windX: a.windX + (b.windX - a.windX) * alpha,
  };
}

export const ReplayModal: React.FC<ReplayModalProps> = ({
  initialMatchId = null,
  initialReplay = null,
  onClose,
}) => {
  const [summaries, setSummaries] = useState<RoundReplaySummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [activeReplay, setActiveReplay] = useState<RoundReplayRecord | null>(initialReplay);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [currentTime, setCurrentTime] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const loadArchive = async (selectId?: string | null) => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetchRoundReplays(24);
      setSummaries(res.replays);
      const targetId = selectId ?? activeReplay?.matchId ?? res.replays[0]?.matchId ?? null;
      if (targetId && (!activeReplay || activeReplay.matchId !== targetId)) {
        await selectReplayById(targetId);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'تعذر تحميل أرشيف الإعادات');
    } finally {
      setListLoading(false);
    }
  };

  const selectReplayById = async (matchId: string) => {
    if (initialReplay && initialReplay.matchId === matchId) {
      setActiveReplay(initialReplay);
      setCurrentTime(0);
      setPlaying(true);
      setDetailError(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetchRoundReplayDetail(matchId);
      setActiveReplay(res.replay);
      setCurrentTime(0);
      setPlaying(true);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الإعادة');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadArchive(initialMatchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMatchId]);

  const totalDuration = useMemo(() => {
    if (!activeReplay) return 0;
    const lastFrameT =
      activeReplay.frames.length > 0 ? activeReplay.frames[activeReplay.frames.length - 1].t : 0;
    return Math.max(0.5, activeReplay.durationSec, lastFrameT);
  }, [activeReplay]);

  // Playback timer loop
  useEffect(() => {
    if (!playing || !activeReplay || activeReplay.frames.length === 0) return;
    let rafId = 0;
    let lastMs = performance.now();
    const tick = (nowMs: number) => {
      const dt = Math.min(0.1, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      setCurrentTime((prev) => {
        const next = prev + dt * speed;
        if (next >= totalDuration) {
          setPlaying(false);
          return totalDuration;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, speed, activeReplay, totalDuration]);

  const currentPose = useMemo(
    () => (activeReplay ? interpolateFrame(activeReplay.frames, currentTime) : null),
    [activeReplay, currentTime],
  );

  // Top-down 2D Canvas Track Reconstruction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeReplay) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const course = getCourseById(activeReplay.courseId);
    const frameZs = activeReplay.frames.map((f) => f.z);
    const minFrameZ = frameZs.length > 0 ? Math.min(...frameZs) : course.finishZ;
    const maxFrameZ = frameZs.length > 0 ? Math.max(...frameZs) : course.startZ;
    const zStart = Math.max(course.startZ + 8, maxFrameZ + 8);
    const zEnd =
      activeReplay.gameMode === 'survival'
        ? minFrameZ - 12
        : Math.min(course.finishZ - 12, minFrameZ - 10);
    const zSpan = Math.max(40, zStart - zEnd);
    const padX = 28;
    const padY = 20;
    const plotW = W - padX * 2;
    const plotH = H - padY * 2;
    const xExtent = 28; // -28..+28 mapped vertically

    const toCanvasX = (z: number) => padX + ((zStart - z) / zSpan) * plotW;
    const toCanvasY = (x: number) => padY + ((x + xExtent) / (xExtent * 2)) * plotH;

    // Deep water grid background
    ctx.fillStyle = '#071522';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    for (let gx = padX; gx <= W - padX; gx += 48) {
      ctx.beginPath();
      ctx.moveTo(gx, padY);
      ctx.lineTo(gx, H - padY);
      ctx.stroke();
    }

    // Channel boundaries polygon
    const samples = 72;
    ctx.beginPath();
    for (let i = 0; i <= samples; i++) {
      const z = zStart - (i / samples) * zSpan;
      const b = getChannelBoundsAtZ(z, course.waypoints);
      const px = toCanvasX(z);
      const py = toCanvasY(b.centerX - b.halfWidth);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = samples; i >= 0; i--) {
      const z = zStart - (i / samples) * zSpan;
      const b = getChannelBoundsAtZ(z, course.waypoints);
      ctx.lineTo(toCanvasX(z), toCanvasY(b.centerX + b.halfWidth));
    }
    ctx.closePath();
    ctx.fillStyle = '#0f2d47';
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Checkpoints (dashed teal markers)
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(6, 214, 160, 0.55)';
    ctx.lineWidth = 1.5;
    for (const cp of course.checkpoints) {
      if (cp.z > zStart || cp.z < zEnd) continue;
      const cx = toCanvasX(cp.z);
      ctx.beginPath();
      ctx.moveTo(cx, padY);
      ctx.lineTo(cx, H - padY);
      ctx.stroke();
    }
    ctx.restore();

    // Static Obstacles
    for (const obs of course.staticObstacles) {
      if (obs.z > zStart || obs.z < zEnd) continue;
      const ox = toCanvasX(obs.z);
      const oy = toCanvasY(obs.x);
      const rPx = Math.max(3, (obs.radius / (xExtent * 2)) * plotH);
      ctx.beginPath();
      ctx.arc(ox, oy, rPx, 0, Math.PI * 2);
      ctx.fillStyle = obs.kind === 'bumper' ? 'rgba(255, 209, 59, 0.45)' : 'rgba(255, 89, 94, 0.45)';
      ctx.fill();
      ctx.strokeStyle = obs.kind === 'bumper' ? '#ffd13b' : '#ff595e';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Full path polyline
    if (activeReplay.frames.length > 1) {
      ctx.beginPath();
      activeReplay.frames.forEach((f, idx) => {
        const px = toCanvasX(f.z);
        const py = toCanvasY(f.x);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // Played path up to currentTime
      ctx.beginPath();
      let started = false;
      for (const f of activeReplay.frames) {
        if (f.t > currentTime) break;
        const px = toCanvasX(f.z);
        const py = toCanvasY(f.x);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      if (currentPose) {
        const px = toCanvasX(currentPose.z);
        const py = toCanvasY(currentPose.x);
        if (!started) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = course.meta.accentHex || '#ffd13b';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Discrete Event Pins
    for (const ev of activeReplay.events) {
      const ex = toCanvasX(ev.z);
      const ey = toCanvasY(ev.x);
      const meta = EVENT_LABELS[ev.type];
      ctx.beginPath();
      ctx.arc(ex, ey, ev.t <= currentTime ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = meta?.color ?? '#bae6fd';
      ctx.fill();
    }

    // Current Raft Marker + Heading Arrow
    if (currentPose) {
      const rx = toCanvasX(currentPose.z);
      const ry = toCanvasY(currentPose.x);
      ctx.save();
      ctx.translate(rx, ry);
      // World forward is -Z (canvas +X), +X is down (+Y)
      ctx.rotate(-currentPose.yaw);
      ctx.fillStyle = '#ffd13b';
      ctx.strokeStyle = '#071522';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-10, -7, 20, 14, 3);
      ctx.fill();
      ctx.stroke();
      // Bow pointer (+X in rotated space = forward along -Z)
      ctx.fillStyle = '#06d6a0';
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, [activeReplay, currentPose, currentTime]);

  const cycleSpeed = () => {
    setSpeed((prev) => (prev === 1 ? 2 : prev === 2 ? 4 : 1));
  };

  return (
    <div
      data-testid="replay-modal"
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/82"
    >
      <div className="bg-[#0b1929] border-2 border-[#2a4c6e] w-full max-w-5xl rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#2a4c6e]">
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-[#ffd13b]">
              🎬 مسجّل وإعادة الجولات
            </h2>
            <p className="text-xs font-bold text-[#93c5fd]">
              استعرض مسار الطوف، نقاط التناغم، السقوطات، وتوقيت العناصر لحظة بلحظة
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadArchive()}
              className="px-3 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#bae6fd] cursor-pointer whitespace-nowrap shrink-0"
            >
              تحديث
            </button>
            <button
              type="button"
              data-testid="replay-close-btn"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-xs font-black text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              إغلاق
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4">
          {/* Replay Viewport & Scrubber */}
          <div className="lg:col-span-8 space-y-3">
            {detailLoading ? (
              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-8 text-center text-sm font-bold text-[#93c5fd]">
                جاري تحميل بيانات الإعادة...
              </div>
            ) : detailError ? (
              <div className="bg-[#29151d] border border-[#ff595e]/60 rounded-2xl p-5 text-center space-y-2">
                <div className="text-sm font-black text-[#fecaca]">{detailError}</div>
                <button
                  type="button"
                  onClick={() => activeReplay && void selectReplayById(activeReplay.matchId)}
                  className="px-3 py-1.5 rounded-xl bg-[#19334d] text-xs font-black text-white cursor-pointer"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : !activeReplay ? (
              <div
                data-testid="replay-empty-state"
                className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-8 text-center space-y-2"
              >
                <div className="text-2xl" aria-hidden="true">🎞️</div>
                <div className="text-sm font-black text-[#ffd13b]">لا توجد جولات مسجلة بعد</div>
                <p className="text-xs font-bold text-[#93c5fd]">
                  أكمل أي جولة فردية أو أونلاين وسيتم حفظ مسارها تلقائياً هنا للمراجعة.
                </p>
              </div>
            ) : (
              <>
                {/* Selected Run Summary Strip */}
                <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-black">
                    <span
                      className="px-2 py-0.5 rounded-lg text-[#0b1929]"
                      style={{ backgroundColor: getCourseById(activeReplay.courseId).meta.accentHex }}
                    >
                      {getCourseById(activeReplay.courseId).meta.nameAr}
                    </span>
                    <span className="text-[#bae6fd]">{MODE_LABELS[activeReplay.gameMode]}</span>
                    <span className={activeReplay.outcome === 'victory' ? 'text-[#06d6a0]' : 'text-[#ff595e]'}>
                      {activeReplay.outcome === 'victory' ? 'فوز' : 'هزيمة'}
                    </span>
                    {activeReplay.botDifficulty && (
                      <span className="text-[#93c5fd]">
                        · ذكاء الطاقم: {BOT_DIFFICULTY_META[activeReplay.botDifficulty]?.labelAr ?? activeReplay.botDifficulty}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs font-bold tabular-nums text-[#ffd13b]">
                    <span>الزمن: {activeReplay.durationSec.toFixed(1)}ث</span>
                    <span>السقوطات: {activeReplay.falls}</span>
                    {activeReplay.treasureScore > 0 && <span>الكنوز: {activeReplay.treasureScore}</span>}
                  </div>
                </div>

                {/* Top-Down Course Canvas */}
                <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-2 overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    data-testid="replay-canvas"
                    width={760}
                    height={300}
                    className="w-full h-auto block rounded-xl"
                  />
                </div>

                {/* Scrubber & Live Frame Telemetry */}
                <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="replay-play-toggle"
                        onClick={() => {
                          if (!playing && currentTime >= totalDuration - 0.05) {
                            setCurrentTime(0);
                          }
                          setPlaying((p) => !p);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-[#ffd13b] hover:bg-[#ffe066] text-[#14222f] text-xs font-black cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {playing ? 'إيقاف مؤقت' : 'تشغيل'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentTime(0);
                          setPlaying(true);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-xs font-black text-white cursor-pointer whitespace-nowrap shrink-0"
                      >
                        من البداية
                      </button>
                      <button
                        type="button"
                        data-testid="replay-speed-btn"
                        onClick={cycleSpeed}
                        className="px-3 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#38bdf8]/60 text-xs font-black text-[#bae6fd] tabular-nums cursor-pointer whitespace-nowrap shrink-0"
                      >
                        السرعة ×{speed}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs font-black tabular-nums">
                      <span className="text-[#ffd13b]">
                        {formatReplayTime(currentTime)} / {formatReplayTime(totalDuration)}
                      </span>
                      {currentPose && (
                        <>
                          <span className="text-[#06d6a0]">
                            تقدم {Math.round(currentPose.progress * 100)}%
                          </span>
                          <span className={currentPose.raftHp >= 50 ? 'text-[#bae6fd]' : 'text-[#ff595e]'}>
                            سلامة {currentPose.raftHp}%
                          </span>
                          <span className="text-[#93c5fd]">
                            تناغم {Math.round(currentPose.harmony * 100)}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <input
                    type="range"
                    aria-label="شريط زمن الإعادة"
                    data-testid="replay-scrubber"
                    min={0}
                    max={totalDuration}
                    step={0.1}
                    value={Math.min(totalDuration, currentTime)}
                    onChange={(e) => {
                      setPlaying(false);
                      setCurrentTime(Number(e.target.value));
                    }}
                    className="w-full accent-[#ffd13b] cursor-pointer"
                  />
                </div>

                {/* Crew Roster & Personalities */}
                <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-black text-[#38bdf8]">طاقم الطوف في هذه الجولة</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {activeReplay.players.map((pl) => {
                      const pMeta = pl.botPersonality ? BOT_PERSONALITY_META[pl.botPersonality] : null;
                      const colorHex =
                        COSMETIC_COLOR_DEFS[pl.colorIndex % COSMETIC_COLOR_DEFS.length]?.bodyHex ?? '#ff595e';
                      return (
                        <div
                          key={pl.slot}
                          className="bg-[#0b1929] border border-[#2a4c6e] rounded-xl p-2 space-y-1 text-right"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: colorHex }}
                            />
                            <span className="text-xs font-black text-white truncate">{pl.name}</span>
                          </div>
                          <div className="text-[10px] font-bold text-[#93c5fd]">
                            {pl.wasTempSubstitute
                              ? '🤖 بديل آلي مؤقت'
                              : pl.isBot
                                ? `${pMeta?.badgeIcon ?? '🤖'} ${pMeta?.labelAr ?? 'مساعد آلي'}`
                                : '👤 لاعب بشري'}
                          </div>
                          <div className="text-[10px] font-black text-[#ffd13b] tabular-nums">
                            الدفع: {pl.pushContribution}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right Sidebar: Archive List + Event Markers */}
          <div className="lg:col-span-4 space-y-3">
            {activeReplay && activeReplay.events.length > 0 && (
              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3 space-y-2">
                <div className="text-xs font-black text-[#ffd13b]">
                  الانتقال لأحداث الجولة ({activeReplay.events.length})
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5">
                  {activeReplay.events.map((ev, idx) => {
                    const meta = EVENT_LABELS[ev.type] ?? { icon: '•', label: ev.type, color: '#bae6fd' };
                    return (
                      <button
                        key={`${ev.type}-${idx}-${ev.t}`}
                        type="button"
                        onClick={() => {
                          setCurrentTime(ev.t);
                          setPlaying(false);
                        }}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-[#0b1929] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-bold cursor-pointer"
                      >
                        <span className="truncate" style={{ color: meta.color }}>
                          {meta.icon} {ev.labelAr ?? meta.label}
                        </span>
                        <span className="text-[#93c5fd] tabular-nums shrink-0">
                          {formatReplayTime(ev.t)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3 space-y-2">
              <div className="text-xs font-black text-[#38bdf8]">أرشيف الجولات المحفوظة</div>
              {listLoading ? (
                <div className="text-xs font-bold text-[#93c5fd] py-4 text-center">جاري التحديث...</div>
              ) : listError ? (
                <div className="text-xs font-bold text-[#ff8589] py-2 text-center">{listError}</div>
              ) : summaries.length === 0 ? (
                <div className="text-xs font-bold text-[#93c5fd] py-4 text-center">
                  لا توجد إعادات محفوظة في قاعدة البيانات بعد.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
                  {summaries.map((item) => {
                    const selected = activeReplay?.matchId === item.matchId;
                    const c = getCourseById(item.courseId);
                    return (
                      <button
                        key={item.matchId}
                        type="button"
                        data-testid={`replay-item-${item.matchId}`}
                        onClick={() => void selectReplayById(item.matchId)}
                        className={`w-full text-right p-2.5 rounded-xl border transition-colors cursor-pointer space-y-1 ${
                          selected
                            ? 'bg-[#193856] border-[#ffd13b]'
                            : 'bg-[#0b1929] border-[#2a4c6e] hover:border-[#6096cc]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs font-black">
                          <span className="text-[#ffd13b] truncate">{c.meta.nameAr}</span>
                          <span className={item.outcome === 'victory' ? 'text-[#06d6a0]' : 'text-[#ff595e]'}>
                            {item.outcome === 'victory' ? 'فوز' : 'هزيمة'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#bae6fd] tabular-nums">
                          <span>{MODE_LABELS[item.gameMode]}</span>
                          <span>{item.durationSec.toFixed(1)}ث · {item.falls} سقوط</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
