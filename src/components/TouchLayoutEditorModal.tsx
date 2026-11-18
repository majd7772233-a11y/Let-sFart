import React, { useRef, useState } from 'react';
import type { TouchControlsConfig } from '../shared/types.ts';
import {
  DEFAULT_TOUCH_CONTROLS_CONFIG,
  createTouchPresetConfig,
  normalizeTouchControlsConfig,
} from '../shared/ux.ts';

type TouchControlKey = 'dpad' | 'fart' | 'anchor' | 'item';

interface TouchLayoutEditorModalProps {
  config: TouchControlsConfig;
  onChange: (next: TouchControlsConfig) => void;
  onClose: () => void;
}

const CONTROL_LABELS: Record<TouchControlKey, string> = {
  dpad: 'أسهم التوجيه',
  fart: 'إطلاق الريح',
  anchor: '⚓ المرساة',
  item: '💥 الأداة [F]',
};

export const TouchLayoutEditorModal: React.FC<TouchLayoutEditorModalProps> = ({
  config,
  onChange,
  onClose,
}) => {
  const [selectedControl, setSelectedControl] = useState<TouchControlKey>('fart');
  const dragRef = useRef<{
    key: TouchControlKey;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const isLeftPreset = config.preset === 'left';

  const startDrag =
    (key: TouchControlKey) => (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedControl(key);
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        key,
        startX: e.clientX,
        startY: e.clientY,
        origX: config.offsets[key].x,
        origY: config.offsets[key].y,
      };
    };

  const moveDrag =
    (key: TouchControlKey) => (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.key !== key) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      onChange(
        normalizeTouchControlsConfig({
          ...config,
          offsets: {
            ...config.offsets,
            [key]: {
              x: drag.origX + dx,
              y: drag.origY + dy,
            },
          },
        }),
      );
    };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  const previewTransform = (key: TouchControlKey, baseScale = 1) => {
    const off = config.offsets[key];
    return `translate(${Math.round(off.x * 0.55)}px, ${Math.round(off.y * 0.55)}px) scale(${(
      config.scale * baseScale
    ).toFixed(2)})`;
  };

  return (
    <div
      data-testid="touch-layout-editor-modal"
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/85"
    >
      <div className="wood-panel w-full max-w-lg rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
              تخصيص أزرار اللمس
            </h2>
            <p className="text-xs font-bold text-[#b8d8f8] mt-0.5">
              اسحب أي زر داخل ساحة المعاينة لتغيير موقعه، أو اختر تخطيط اليد اليسرى.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق محرر أزرار اللمس"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-sm font-black cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Presets: Right-handed vs Left-handed */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            data-testid="touch-preset-right"
            aria-pressed={!isLeftPreset}
            onClick={() => onChange(createTouchPresetConfig('right', config))}
            className={`min-h-[44px] px-3 py-2 rounded-2xl border-2 text-xs sm:text-sm font-black cursor-pointer transition-colors ${
              !isLeftPreset
                ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                : 'bg-[#102438] text-[#dbeafe] border-[#2a4c6e] hover:border-[#6096cc]'
            }`}
          >
            ✋ قياسي (اليمنى)
          </button>
          <button
            type="button"
            data-testid="touch-preset-left"
            aria-pressed={isLeftPreset}
            onClick={() => onChange(createTouchPresetConfig('left', config))}
            className={`min-h-[44px] px-3 py-2 rounded-2xl border-2 text-xs sm:text-sm font-black cursor-pointer transition-colors ${
              isLeftPreset
                ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                : 'bg-[#102438] text-[#dbeafe] border-[#2a4c6e] hover:border-[#6096cc]'
            }`}
          >
            🤚 تخطيط لليد اليسرى
          </button>
        </div>

        {/* Interactive Drag Stage (dir="ltr" so physical left/right matches live screen corners) */}
        <div
          dir="ltr"
          data-testid="touch-editor-stage"
          className="relative w-full h-52 sm:h-56 rounded-2xl bg-[#091c2e] border-2 border-[#38bdf8]/50 overflow-hidden p-3 flex flex-col justify-between mb-4 select-none"
        >
          <div className="flex items-center justify-between text-[11px] font-bold text-[#93c5fd]" dir="rtl">
            <span>معاينة حية (اسحب الأزرار للتحريك)</span>
            <span className="text-[#ffd13b]">المحدد: {CONTROL_LABELS[selectedControl]}</span>
          </div>

          <div
            className={`flex items-end justify-between gap-2 w-full ${
              isLeftPreset ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* D-Pad Drag Handle */}
            <button
              type="button"
              data-testid="touch-drag-dpad"
              onPointerDown={startDrag('dpad')}
              onPointerMove={moveDrag('dpad')}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                opacity: config.opacity,
                transform: previewTransform('dpad', 0.9),
                touchAction: 'none',
              }}
              className={`min-h-[44px] px-3 py-2 rounded-2xl border-2 font-black text-xs flex items-center gap-1.5 cursor-grab active:cursor-grabbing ${
                selectedControl === 'dpad'
                  ? 'bg-[#1b3c5c] border-[#ffd13b] text-[#ffd13b]'
                  : 'bg-[#12263a] border-[#f7d060]/70 text-[#fff8e7]'
              }`}
            >
              <span>◀</span>
              <span>التوجيه</span>
              <span>▶</span>
            </button>

            {/* Center Anchor + Item Drag Handles */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                data-testid="touch-drag-item"
                onPointerDown={startDrag('item')}
                onPointerMove={moveDrag('item')}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{
                  opacity: config.opacity,
                  transform: previewTransform('item', 0.85),
                  touchAction: 'none',
                }}
                className={`min-h-[44px] px-2.5 py-1 rounded-xl border-2 font-black text-[11px] cursor-grab active:cursor-grabbing ${
                  selectedControl === 'item'
                    ? 'bg-[#facc15] border-white text-[#14222f]'
                    : 'bg-[#facc15]/90 border-[#14222f] text-[#14222f]'
                }`}
              >
                💥 موجة [F]
              </button>

              <button
                type="button"
                data-testid="touch-drag-anchor"
                onPointerDown={startDrag('anchor')}
                onPointerMove={moveDrag('anchor')}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{
                  opacity: config.opacity,
                  transform: previewTransform('anchor', 0.88),
                  touchAction: 'none',
                }}
                className={`min-h-[44px] px-2.5 py-1.5 rounded-xl border-2 font-black text-[11px] cursor-grab active:cursor-grabbing ${
                  selectedControl === 'anchor'
                    ? 'bg-[#0284c7] border-[#ffd13b] text-white'
                    : 'bg-[#12263a] border-[#38bdf8] text-[#bae6fd]'
                }`}
              >
                ⚓ المرساة [E]
              </button>
            </div>

            {/* Fart Button Drag Handle */}
            <button
              type="button"
              data-testid="touch-drag-fart"
              onPointerDown={startDrag('fart')}
              onPointerMove={moveDrag('fart')}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                opacity: config.opacity,
                transform: previewTransform('fart', 0.9),
                touchAction: 'none',
              }}
              className={`min-h-[44px] px-3 py-2.5 rounded-2xl border-2 font-black text-xs cursor-grab active:cursor-grabbing ${
                selectedControl === 'fart'
                  ? 'bg-[#9ef01a] border-white text-[#14222f]'
                  : 'bg-[#9ef01a]/90 border-[#14222f] text-[#14222f]'
              }`}
            >
              💨 إطلاق الريح
            </button>
          </div>
        </div>

        {/* Scale & Opacity Sliders */}
        <div className="space-y-3 bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e] mb-4">
          <div>
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <label htmlFor="touch-scale-slider">حجم الأزرار</label>
              <span className="tabular-nums text-[#ffd13b]">{Math.round(config.scale * 100)}%</span>
            </div>
            <input
              id="touch-scale-slider"
              data-testid="touch-scale-slider"
              type="range"
              min={0.75}
              max={1.45}
              step={0.05}
              value={config.scale}
              onChange={(e) =>
                onChange(
                  normalizeTouchControlsConfig({
                    ...config,
                    scale: Number(e.target.value),
                  }),
                )
              }
              className="w-full accent-[#ffd13b]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <label htmlFor="touch-opacity-slider">شفافية الأزرار</label>
              <span className="tabular-nums text-[#38bdf8]">{Math.round(config.opacity * 100)}%</span>
            </div>
            <input
              id="touch-opacity-slider"
              data-testid="touch-opacity-slider"
              type="range"
              min={0.35}
              max={1.0}
              step={0.05}
              value={config.opacity}
              onChange={(e) =>
                onChange(
                  normalizeTouchControlsConfig({
                    ...config,
                    opacity: Number(e.target.value),
                  }),
                )
              }
              className="w-full accent-[#38bdf8]"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            data-testid="touch-reset-btn"
            onClick={() => onChange({ ...DEFAULT_TOUCH_CONTROLS_CONFIG })}
            className="wood-btn-secondary flex-1 min-h-[44px] py-2.5 rounded-2xl font-extrabold text-sm cursor-pointer"
          >
            إعادة التعيين الافتراضي
          </button>
          <button
            type="button"
            data-testid="touch-save-btn"
            onClick={onClose}
            className="wood-btn-primary flex-1 min-h-[44px] py-2.5 rounded-2xl font-black text-base cursor-pointer"
          >
            حفظ التخطيط
          </button>
        </div>
      </div>
    </div>
  );
};
