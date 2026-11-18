import React, { useMemo } from 'react';
import {
  COSMETIC_CATALOG,
  COSMETIC_COLOR_DEFS,
  getDefaultOwnedItemIds,
} from '../shared/cosmetics.ts';
import type { CameraMode, CameraPrefs, GlassesStyle, HatStyle, PlayerCosmetic } from '../shared/types.ts';
import { CAMERA_MODE_META, CAMERA_MODE_ORDER } from '../shared/ux.ts';

interface PauseSettingsModalProps {
  isPlayingContext: boolean;
  isOnline: boolean;
  isHost: boolean;
  sfxVolume: number;
  voiceVolume: number;
  musicVolume: number;
  sfxMuted: boolean;
  voiceMuted: boolean;
  musicMuted: boolean;
  reduceShake: boolean;
  showTouchControls: boolean;
  cameraPrefs: CameraPrefs;
  cosmetic: PlayerCosmetic;
  ownedItemIds?: string[];
  onOpenShop?: () => void;
  onChangeSfxVolume: (v: number) => void;
  onChangeVoiceVolume: (v: number) => void;
  onChangeMusicVolume: (v: number) => void;
  onToggleSfxMute: () => void;
  onToggleVoiceMute: () => void;
  onToggleMusicMute: () => void;
  onTestVoice?: () => void;
  onToggleReduceShake: () => void;
  onToggleTouchControls: () => void;
  onOpenTouchEditor?: () => void;
  onChangeCameraPrefs: (next: CameraPrefs) => void;
  onChangeCosmetic: (c: PlayerCosmetic) => void;
  onResume: () => void;
  onRestart: () => void;
  onBackToTitle: () => void;
}

export const PauseSettingsModal: React.FC<PauseSettingsModalProps> = ({
  isPlayingContext,
  isOnline,
  isHost,
  sfxVolume,
  voiceVolume,
  musicVolume,
  sfxMuted,
  voiceMuted,
  musicMuted,
  reduceShake,
  showTouchControls,
  cameraPrefs,
  cosmetic,
  ownedItemIds,
  onOpenShop,
  onChangeSfxVolume,
  onChangeVoiceVolume,
  onChangeMusicVolume,
  onToggleSfxMute,
  onToggleVoiceMute,
  onToggleMusicMute,
  onTestVoice,
  onToggleReduceShake,
  onToggleTouchControls,
  onOpenTouchEditor,
  onChangeCameraPrefs,
  onChangeCosmetic,
  onResume,
  onRestart,
  onBackToTitle,
}) => {
  const ownedSet = useMemo(
    () => new Set(ownedItemIds && ownedItemIds.length > 0 ? ownedItemIds : getDefaultOwnedItemIds()),
    [ownedItemIds],
  );
  const ownedHats = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'hat' && ownedSet.has(i.id)),
    [ownedSet],
  );
  const ownedGlasses = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'glasses' && ownedSet.has(i.id)),
    [ownedSet],
  );
  const ownedColors = useMemo(
    () => COSMETIC_COLOR_DEFS.filter((c) => ownedSet.has(`color:${c.index}`)),
    [ownedSet],
  );

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
              <label htmlFor="voice-vol">صوت تعليقات وأصوات الشخصيات</label>
              <div className="flex items-center gap-1.5">
                {onTestVoice && (
                  <button
                    type="button"
                    data-testid="test-voice-btn"
                    onClick={onTestVoice}
                    className="px-2 py-0.5 rounded bg-[#153e35] hover:bg-[#1d5448] border border-[#06d6a0]/60 text-[#a7f3d0] cursor-pointer"
                  >
                    اختبار صوت الشخصية
                  </button>
                )}
                <button
                  type="button"
                  data-testid="voice-mute-btn"
                  onClick={onToggleVoiceMute}
                  className="px-2 py-0.5 rounded bg-[#19334d] border border-[#39628a] cursor-pointer"
                >
                  {voiceMuted ? 'مكتوم' : `${Math.round(voiceVolume * 100)}%`}
                </button>
              </div>
            </div>
            <input
              id="voice-vol"
              data-testid="voice-vol-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={voiceMuted ? 0 : voiceVolume}
              onChange={(e) => onChangeVoiceVolume(Number(e.target.value))}
              className="w-full accent-[#38bdf8]"
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

          {onOpenTouchEditor && (
            <button
              type="button"
              data-testid="open-touch-editor-btn"
              onClick={onOpenTouchEditor}
              className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#38bdf8]/60 text-xs font-black text-[#bae6fd] cursor-pointer flex items-center justify-between"
            >
              <span>📱 تخصيص أزرار اللمس (سحب · حجم · يد يسرى)</span>
              <span className="text-[#ffd13b]">تعديل</span>
            </button>
          )}
        </div>

        {/* UX-04: Camera Mode, Distance & Angle Controls */}
        <div className="space-y-3 bg-[#102438] p-4 rounded-2xl border-2 border-[#2a4c6e] mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-[#ffd13b]">📷 الكاميرا والزوايا</span>
            <span className="text-[11px] font-bold text-[#93c5fd]">اختصار التبديل: [C]</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="اختيار نمط الكاميرا">
            {CAMERA_MODE_ORDER.map((mode: CameraMode) => {
              const active = cameraPrefs.mode === mode;
              const meta = CAMERA_MODE_META[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  data-testid={`settings-cam-${mode}`}
                  aria-pressed={active}
                  title={meta.descAr}
                  onClick={() => onChangeCameraPrefs({ ...cameraPrefs, mode })}
                  className={`min-h-[40px] px-2 py-1.5 rounded-xl text-xs font-black border cursor-pointer ${
                    active
                      ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                      : 'bg-[#19334d] text-[#dbeafe] border-[#39628a] hover:border-[#6096cc]'
                  }`}
                >
                  {meta.shortAr}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <label htmlFor="cam-dist">مسافة الكاميرا</label>
                <span className="tabular-nums text-[#ffd13b]">
                  {Math.round(cameraPrefs.distanceScale * 100)}%
                </span>
              </div>
              <input
                id="cam-dist"
                data-testid="cam-dist-slider"
                type="range"
                min={0.7}
                max={1.5}
                step={0.05}
                value={cameraPrefs.distanceScale}
                onChange={(e) =>
                  onChangeCameraPrefs({ ...cameraPrefs, distanceScale: Number(e.target.value) })
                }
                className="w-full accent-[#ffd13b]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <label htmlFor="cam-angle">زاوية الارتفاع</label>
                <span className="tabular-nums text-[#38bdf8]">
                  {cameraPrefs.angleDeg > 0 ? `+${cameraPrefs.angleDeg}°` : `${cameraPrefs.angleDeg}°`}
                </span>
              </div>
              <input
                id="cam-angle"
                data-testid="cam-angle-slider"
                type="range"
                min={-10}
                max={18}
                step={1}
                value={cameraPrefs.angleDeg}
                onChange={(e) =>
                  onChangeCameraPrefs({ ...cameraPrefs, angleDeg: Number(e.target.value) })
                }
                className="w-full accent-[#38bdf8]"
              />
            </div>
          </div>
        </div>

        {/* Owned Character Customization */}
        <div className="space-y-2.5 bg-[#102438] p-4 rounded-2xl border-2 border-[#2a4c6e] mb-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#ffd13b]">اللون</span>
            <div className="flex flex-wrap gap-1.5">
              {ownedColors.map((c) => (
                <button
                  key={c.index}
                  type="button"
                  aria-label={`اختيار لون ${c.titleAr}`}
                  onClick={() => onChangeCosmetic({ ...cosmetic, colorIndex: c.index })}
                  className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                    cosmetic.colorIndex === c.index ? 'border-white scale-110' : 'border-black/60'
                  }`}
                  style={{ backgroundColor: c.bodyHex }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#ffd13b]">القبعة</span>
            <div className="flex flex-wrap justify-end gap-1">
              {ownedHats.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, hat: h.value as HatStyle })}
                  className={`px-2 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    cosmetic.hat === h.value ? 'bg-[#ffd13b] text-[#14222f]' : 'bg-[#19334d] text-[#dbeafe]'
                  }`}
                >
                  {h.titleAr}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#ffd13b]">النظارات</span>
            <div className="flex flex-wrap justify-end gap-1">
              {ownedGlasses.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, glasses: g.value as GlassesStyle })}
                  className={`px-2 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    cosmetic.glasses === g.value ? 'bg-[#ffd13b] text-[#14222f]' : 'bg-[#19334d] text-[#dbeafe]'
                  }`}
                >
                  {g.titleAr}
                </button>
              ))}
            </div>
          </div>

          {onOpenShop && (
            <button
              type="button"
              onClick={onOpenShop}
              className="w-full py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#ffd13b]/50 text-xs font-black text-[#ffd13b] cursor-pointer"
            >
              تصفح جميع الفئات والشراء من المتجر
            </button>
          )}
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
