import React from 'react';
import type { PlayerSimState, WorldSimulationState } from '../shared/types.ts';

interface VictoryModalProps {
  sim: WorldSimulationState;
  isOnline: boolean;
  isHost: boolean;
  onPlayAgain: () => void;
  onBackToTitle: () => void;
}

function formatClearTime(sec: number): string {
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

  const awards: { title: string; winner: string; detail: string }[] = [
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
  return awards;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  sim,
  isOnline,
  isHost,
  onPlayAgain,
  onBackToTitle,
}) => {
  const awards = computeComedicAwards(sim.players);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#071928]/70">
      <div className="wood-panel w-full max-w-lg rounded-3xl p-6 text-[#fff8e7] text-center">
        <div className="text-4xl mb-1" aria-hidden="true">🏆💨</div>
        <h2 className="text-3xl font-black text-[#ffd13b] cartoon-outline">
          وصل الطوف إلى النهاية!
        </h2>
        <p className="text-sm font-bold text-[#b8d8f8] mt-1">
          عمل جماعي أسطوري رغم كل الكوارث
        </p>

        {/* Core Mastery Metrics */}
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
              {sim.checkpointIndex}/2
            </div>
          </div>
        </div>

        {/* Comedic Superlative Awards */}
        {awards.length > 0 && (
          <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3.5 mb-5 text-right space-y-2">
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

        <div className="flex flex-col sm:flex-row gap-3">
          {(!isOnline || isHost) && (
            <button
              type="button"
              data-start="true"
              onClick={onPlayAgain}
              className="wood-btn-primary flex-1 py-3.5 rounded-2xl font-black text-lg cursor-pointer"
            >
              العب مجدداً
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
    </div>
  );
};
