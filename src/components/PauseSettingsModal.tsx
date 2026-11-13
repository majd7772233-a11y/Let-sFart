import React from 'react';
import type { GlassesStyle, HatStyle, PlayerCosmetic } from '../shared/types.ts';

interface PauseSettingsModalProps {
  isPlayingContext: boolean;
  isOnline: boolean;
  isHost: boolean;
  sfxVolume: number;
  musicVolume: number;
  sfxMuted: boolean;
  musicMuted: boolean;
  reduceShake: boolean;
  showTouchControls: boolean;
  cosmetic: PlayerCosmetic;
  onChangeSfxVolume: (v: number) => void;
  onChangeMusicVolume: (v: number) => void;
  onToggleSfxMute: () => void;
  onToggleMusicMute: () => void;
  onToggleReduceShake: () => void;
  onToggleTouchControls: () => void;
  onChangeCosmetic: (c: PlayerCosmetic) => void;
  onResume: () => void;
  onRestart: () => void;
  onBackToTitle: () => void;
}

const HATS: { id: HatStyle; label: string }[] = [
  { id: 'none', label: 'بدون' },
  { id: 'captain', label: 'قبطان' },
  { id: 'crown', label: 'تاج' },
  { id: 'propeller', label: 'مروحة' },
];

const GLASSES: { id: GlassesStyle; label: string }[] = [
  { id: 'none', label: 'بدون' },
  { id: 'shades', label: 'شمسية' },
  { id: 'nerd', label: 'دائرية' },
];

const COLORS = ['#ff595e', '#1982c4', '#ffca3a', '#9b5de5'];

export const PauseSettingsModal: React.FC<PauseSettingsModalProps> = ({
  isPlayingContext,
  isOnline,
  isHost,
  sfxVolume,
  musicVolume,
  sfxMuted,
  musicMuted,
  reduceShake,
  showTouchControls,
  cosmetic,
  onChangeSfxVolume,
  onChangeMusicVolume,
  onToggleSfxMute,
  onToggleMusicMute,
  onToggleReduceShake,
  onToggleTouchControls,
  onChangeCosmetic,
  onResume,
  onRestart,
  onBackToTitle,
}) => {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#071928]/70">
      <div className="wood-panel w-full max-w-md rounded-3xl p-5 sm:p-6 text-[#fff8e7] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <h2 className="text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
            {isPlayingContext ? 'إيقاف مؤقت والإعدادات' : 'المظهر والإعدادات'}
          </h2>
          {isPlayingContext && isOnline && (
            <span className="text-xs font-bold text-[#93c5fd]">الجولة مستمرة على الخادم</span>
          )}
        </div>

        {/* Audio & Comfort Controls */}
        <div className="space-y-3.5 bg-[#102438] p-4 rounded-2xl border-2 border-[#2a4c6e] mb-4">
          <div>
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <label htmlFor="sfx-vol">صوت المؤثرات والريح</label>
              <button
                type="button"
                onClick={onToggleSfxMute}
                className="px-2 py-0.5 rounded bg-[#19334d] border border-[#39628a] cursor-pointer"
              >
                {sfxMuted ? 'مكتوم' : `${Math.round(sfxVolume * 100)}%`}
              </button>
            </div>
            <input
              id="sfx-vol"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sfxMuted ? 0 : sfxVolume}
              onChange={(e) => onChangeSfxVolume(Number(e.target.value))}
              className="w-full accent-[#9ef01a]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <label htmlFor="music-vol">صوت الموسيقى الخلفية</label>
              <button
                type="button"
                onClick={onToggleMusicMute}
                className="px-2 py-0.5 rounded bg-[#19334d] border border-[#39628a] cursor-pointer"
              >
                {musicMuted ? 'مكتوم' : `${Math.round(musicVolume * 100)}%`}
              </button>
            </div>
            <input
              id="music-vol"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={musicMuted ? 0 : musicVolume}
              onChange={(e) => onChangeMusicVolume(Number(e.target.value))}
              className="w-full accent-[#ffd13b]"
            />
          </div>

          <label className="flex items-center justify-between text-sm font-bold cursor-pointer pt-1">
            <span>تقليل اهتزاز الكاميرا</span>
            <input
              type="checkbox"
              checked={reduceShake}
              onChange={onToggleReduceShake}
              className="w-4 h-4 accent-[#ffd13b]"
            />
          </label>

          <label className="flex items-center justify-between text-sm font-bold cursor-pointer">
            <span>إظهار أزرار اللمس على الشاشة</span>
            <input
              type="checkbox"
              checked={showTouchControls}
              onChange={onToggleTouchControls}
              className="w-4 h-4 accent-[#ffd13b]"
            />
          </label>
        </div>

        {/* Character Customization */}
        <div className="space-y-2.5 bg-[#102438] p-4 rounded-2xl border-2 border-[#2a4c6e] mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#ffd13b]">اللون</span>
            <div className="flex gap-2">
              {COLORS.map((hex, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`اختيار لون ${idx + 1}`}
                  onClick={() => onChangeCosmetic({ ...cosmetic, colorIndex: idx })}
                  className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                    cosmetic.colorIndex === idx ? 'border-white scale-110' : 'border-black/60'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#ffd13b]">القبعة</span>
            <div className="flex gap-1">
              {HATS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, hat: h.id })}
                  className={`px-2 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    cosmetic.hat === h.id ? 'bg-[#ffd13b] text-[#14222f]' : 'bg-[#19334d] text-[#dbeafe]'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#ffd13b]">النظارات</span>
            <div className="flex gap-1">
              {GLASSES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, glasses: g.id })}
                  className={`px-2 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    cosmetic.glasses === g.id ? 'bg-[#ffd13b] text-[#14222f]' : 'bg-[#19334d] text-[#dbeafe]'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="wood-btn-primary w-full py-3 rounded-2xl font-black text-base cursor-pointer"
          >
            {isPlayingContext ? 'استئناف اللعب' : 'حفظ والعودة'}
          </button>

          {isPlayingContext && (!isOnline || isHost) && (
            <button
              type="button"
              onClick={onRestart}
              className="wood-btn-secondary w-full py-2.5 rounded-2xl font-extrabold text-sm cursor-pointer"
            >
              إعادة المحاولة من البداية
            </button>
          )}

          {isPlayingContext && (
            <button
              type="button"
              onClick={onBackToTitle}
              className="w-full py-2.5 rounded-2xl bg-[#381d2a] hover:bg-[#4f283b] border-2 border-[#ff595e]/60 text-[#ffd6d8] font-extrabold text-sm cursor-pointer"
            >
              مغادرة إلى القائمة الرئيسية
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
