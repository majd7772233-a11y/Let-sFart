import React, { useState } from 'react';
import {
  COSMETIC_COLOR_DEFS,
  COSMETIC_ITEM_MAP,
  RAFT_SKIN_PALETTES,
  normalizePlayerCosmetic,
} from '../shared/cosmetics.ts';
import type {
  MotionTrailId,
  OutfitStyle,
  PlayerCosmetic,
  RaftSkinId,
} from '../shared/types.ts';

function hexNumToCss(n: number): string {
  return `#${(n >>> 0).toString(16).padStart(6, '0')}`;
}

export const CharacterAvatarSvg: React.FC<{
  cosmetic: PlayerCosmetic;
  size?: number;
}> = ({ cosmetic, size = 72 }) => {
  const norm = normalizePlayerCosmetic(cosmetic, 0);
  const colorDef = COSMETIC_COLOR_DEFS[norm.colorIndex] ?? COSMETIC_COLOR_DEFS[0];
  const suitColor = colorDef.bodyHex;
  const outfit: OutfitStyle = norm.outfit ?? 'classic';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 88 88"
      className="shrink-0 drop-shadow-md"
      aria-hidden="true"
    >
      {/* Outfit / Royal Cape behind body */}
      {outfit === 'royal_robe' && (
        <path
          d="M16 44 L11 76 Q44 82 77 76 L72 44 Z"
          fill="#6d28d9"
          stroke="#fbbf24"
          strokeWidth="2.5"
        />
      )}

      {/* Diver tank behind body */}
      {outfit === 'diver_suit' && (
        <g>
          <rect x="61" y="42" width="11" height="24" rx="4" fill="#06d6a0" stroke="#14222f" strokeWidth="2.4" />
          <rect x="64" y="38" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#14222f" strokeWidth="1.8" />
        </g>
      )}

      {/* Body torso */}
      <circle cx="44" cy="52" r="24" fill={suitColor} stroke="#14222f" strokeWidth="3.8" />

      {/* Outfit Details on Torso */}
      {outfit === 'captain_coat' && (
        <g>
          <path d="M22 48 L44 62 L66 48 L62 72 L26 72 Z" fill="#1e3a5f" stroke="#14222f" strokeWidth="2.2" />
          <rect x="19" y="42" width="12" height="6" rx="2" fill="#ffd13b" stroke="#14222f" strokeWidth="1.8" />
          <rect x="57" y="42" width="12" height="6" rx="2" fill="#ffd13b" stroke="#14222f" strokeWidth="1.8" />
          <circle cx="44" cy="60" r="2.2" fill="#ffd13b" />
          <circle cx="44" cy="67" r="2.2" fill="#ffd13b" />
        </g>
      )}
      {outfit === 'diver_suit' && (
        <g>
          <rect x="21" y="57" width="46" height="6" rx="2" fill="#0f172a" stroke="#14222f" strokeWidth="1.8" />
          <rect x="40" y="56" width="8" height="8" rx="1.5" fill="#ffd13b" stroke="#14222f" strokeWidth="1.6" />
        </g>
      )}
      {outfit === 'volcanic_armor' && (
        <g>
          <path d="M23 49 L44 58 L65 49 L62 71 L26 71 Z" fill="#1f2937" stroke="#f97316" strokeWidth="2.2" />
          <path d="M18 44 L29 41 L27 52 Z" fill="#334155" stroke="#f97316" strokeWidth="2" />
          <path d="M70 44 L59 41 L61 52 Z" fill="#334155" stroke="#f97316" strokeWidth="2" />
          <circle cx="44" cy="60" r="4" fill="#fb923c" stroke="#14222f" strokeWidth="1.5" />
        </g>
      )}
      {outfit === 'royal_robe' && (
        <g>
          <path d="M30 46 L44 73 L58 46" fill="none" stroke="#ffd13b" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="44" cy="54" r="3" fill="#ffd13b" stroke="#14222f" strokeWidth="1.4" />
        </g>
      )}

      {/* Face */}
      <circle cx="44" cy="40" r="16.5" fill="#fde2b8" stroke="#14222f" strokeWidth="3.2" />
      <circle cx="38" cy="39" r="2.6" fill="#14222f" />
      <circle cx="50" cy="39" r="2.6" fill="#14222f" />
      <path d="M39 47 Q44 51 49 47" fill="none" stroke="#14222f" strokeWidth="2.5" strokeLinecap="round" />

      {/* Glasses */}
      {norm.glasses === 'shades' && (
        <g>
          <rect x="30.5" y="34" width="11.5" height="8" rx="2" fill="#0f172a" stroke="#ffd13b" strokeWidth="1.6" />
          <rect x="46" y="34" width="11.5" height="8" rx="2" fill="#0f172a" stroke="#ffd13b" strokeWidth="1.6" />
          <line x1="42" y1="38" x2="46" y2="38" stroke="#ffd13b" strokeWidth="2" />
        </g>
      )}
      {norm.glasses === 'nerd' && (
        <g>
          <circle cx="37.5" cy="38.5" r="6" fill="rgba(255,255,255,0.28)" stroke="#1e293b" strokeWidth="2.2" />
          <circle cx="50.5" cy="38.5" r="6" fill="rgba(255,255,255,0.28)" stroke="#1e293b" strokeWidth="2.2" />
          <line x1="43.5" y1="38.5" x2="44.5" y2="38.5" stroke="#1e293b" strokeWidth="2.2" />
        </g>
      )}
      {norm.glasses === 'monocle' && (
        <g>
          <circle cx="50.5" cy="38.5" r="6.2" fill="rgba(254, 240, 138, 0.28)" stroke="#f59e0b" strokeWidth="2.2" />
          <path d="M56.5 41 Q60 50 56 58" fill="none" stroke="#f59e0b" strokeWidth="1.6" />
        </g>
      )}
      {norm.glasses === 'cyber_visor' && (
        <g>
          <rect
            x="29"
            y="33.5"
            width="30"
            height="9"
            rx="3.5"
            fill="rgba(56, 189, 248, 0.72)"
            stroke="#0284c7"
            strokeWidth="2"
          />
          <line x1="33" y1="36.5" x2="55" y2="36.5" stroke="#e0f2fe" strokeWidth="1.4" />
        </g>
      )}
      {norm.glasses === 'heart_shades' && (
        <g>
          <path
            d="M37.5 43 C32 39.5 31 34.5 34.5 34.5 C36.5 34.5 37.5 36.2 37.5 36.2 C37.5 36.2 38.5 34.5 40.5 34.5 C44 34.5 43 39.5 37.5 43 Z"
            fill="#fb7185"
            stroke="#881337"
            strokeWidth="1.6"
          />
          <path
            d="M50.5 43 C45 39.5 44 34.5 47.5 34.5 C49.5 34.5 50.5 36.2 50.5 36.2 C50.5 36.2 51.5 34.5 53.5 34.5 C57 34.5 56 39.5 50.5 43 Z"
            fill="#fb7185"
            stroke="#881337"
            strokeWidth="1.6"
          />
          <line x1="42" y1="37" x2="46" y2="37" stroke="#881337" strokeWidth="1.8" />
        </g>
      )}

      {/* Hats */}
      {norm.hat === 'captain' && (
        <g>
          <path d="M26 26 Q44 13 62 26 Z" fill="#1e3a5f" stroke="#14222f" strokeWidth="2.5" />
          <rect x="24" y="24" width="40" height="5" rx="2" fill="#ffd13b" stroke="#14222f" strokeWidth="2" />
        </g>
      )}
      {norm.hat === 'crown' && (
        <polygon
          points="27,26 31,12 39,21 44,10 49,21 57,12 61,26"
          fill="#ffd13b"
          stroke="#14222f"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      )}
      {norm.hat === 'propeller' && (
        <g>
          <path d="M29 26 Q44 15 59 26 Z" fill="#ef4444" stroke="#14222f" strokeWidth="2.5" />
          <line x1="44" y1="13" x2="44" y2="19" stroke="#14222f" strokeWidth="3" />
          <rect x="30" y="10.5" width="28" height="4.5" rx="2" fill="#38bdf8" stroke="#14222f" strokeWidth="2" />
        </g>
      )}
      {norm.hat === 'pirate' && (
        <g>
          <path
            d="M20 26 Q44 8 68 26 L61 29 Q44 22 27 29 Z"
            fill="#1e293b"
            stroke="#ffd13b"
            strokeWidth="2.2"
          />
          <circle cx="44" cy="20" r="3" fill="#fff8e7" />
        </g>
      )}
      {norm.hat === 'viking' && (
        <g>
          <path d="M27 27 Q44 12 61 27 Z" fill="#94a3b8" stroke="#14222f" strokeWidth="2.4" />
          <path d="M28 24 Q17 17 20 8 Q25 16 32 19 Z" fill="#fef3c7" stroke="#14222f" strokeWidth="2" />
          <path d="M60 24 Q71 17 68 8 Q63 16 56 19 Z" fill="#fef3c7" stroke="#14222f" strokeWidth="2" />
        </g>
      )}
      {norm.hat === 'snorkel' && (
        <g>
          <rect x="59" y="14" width="6" height="24" rx="2.5" fill="#06d6a0" stroke="#14222f" strokeWidth="2" />
          <rect x="29" y="21" width="30" height="7" rx="3" fill="#38bdf8" stroke="#14222f" strokeWidth="2" />
        </g>
      )}
      {norm.hat === 'storm_hood' && (
        <g>
          <path
            d="M24 38 Q24 11 44 11 Q64 11 64 38 L58 29 Q44 21 30 29 Z"
            fill="#1d4ed8"
            stroke="#93c5fd"
            strokeWidth="2.2"
          />
          <polygon points="44,14 41,20 45,20 42,25 48,19 44,19" fill="#fde047" />
        </g>
      )}
    </svg>
  );
};

const TRAIL_DOT_PALETTES: Record<MotionTrailId, readonly string[]> = {
  classic_green: ['#9ef01a', '#70e000', '#ccff33'],
  rainbow_bubbles: ['#f472b6', '#fbbf24', '#06d6a0', '#38bdf8'],
  volcanic_sparks: ['#fb923c', '#f97316', '#fde047'],
  frost_mist: ['#bae6fd', '#38bdf8', '#f0f9ff'],
  golden_confetti: ['#ffd13b', '#fef08a', '#f59e0b'],
};

interface CosmeticPreviewStageProps {
  cosmetic: PlayerCosmetic;
  highlightLabel?: string | null;
}

export const CosmeticPreviewStage: React.FC<CosmeticPreviewStageProps> = ({
  cosmetic,
  highlightLabel = null,
}) => {
  const [pulseBoost, setPulseBoost] = useState(true);
  const norm = normalizePlayerCosmetic(cosmetic, 0);
  const raftSkinId: RaftSkinId = norm.raftSkin ?? 'classic_oak';
  const trailId: MotionTrailId = norm.trail ?? 'classic_green';
  const palette = RAFT_SKIN_PALETTES[raftSkinId] ?? RAFT_SKIN_PALETTES.classic_oak;
  const trailPalette = TRAIL_DOT_PALETTES[trailId] ?? TRAIL_DOT_PALETTES.classic_green;

  const logCss = hexNumToCss(palette.logHex === 0xffffff ? 0xc68642 : palette.logHex);
  const deckCss = hexNumToCss(palette.deckHex);
  const dividerCss = hexNumToCss(palette.dividerHex);
  const flagCss = hexNumToCss(palette.flagHex);
  const lanternCss = hexNumToCss(palette.lanternHex);
  const foamCss = hexNumToCss(palette.foamHex);

  const hatLabel = COSMETIC_ITEM_MAP[`hat:${norm.hat}`]?.titleAr ?? 'قبعة';
  const glassesLabel = COSMETIC_ITEM_MAP[`glasses:${norm.glasses}`]?.titleAr ?? 'نظارات';
  const outfitLabel = COSMETIC_ITEM_MAP[`outfit:${norm.outfit ?? 'classic'}`]?.titleAr ?? 'زي';
  const raftLabel = COSMETIC_ITEM_MAP[`raft_skin:${raftSkinId}`]?.titleAr ?? 'طوف';
  const trailLabel = COSMETIC_ITEM_MAP[`trail:${trailId}`]?.titleAr ?? 'أثر';

  return (
    <div
      data-testid="cosmetic-preview-stage"
      className="bg-[#0b1f33] border-2 border-[#2b5278] rounded-2xl p-3.5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black text-[#ffd13b]">منصة المعاينة الحية</div>
          <div className="text-[11px] font-bold text-[#93c5fd] truncate">
            {highlightLabel ? `تعاين الآن: ${highlightLabel}` : 'معاينة كاملة قبل الشراء أو التجهيز'}
          </div>
        </div>
        <button
          type="button"
          data-testid="preview-toggle-motion-btn"
          onClick={() => setPulseBoost((p) => !p)}
          className="px-2.5 py-1 rounded-lg bg-[#163450] hover:bg-[#1e4568] border border-[#38bdf8]/50 text-[11px] font-black text-[#bae6fd] cursor-pointer whitespace-nowrap shrink-0"
        >
          {pulseBoost ? 'إيقاف أثر الدفع' : 'معاينة الدفع'}
        </button>
      </div>

      {/* Interactive SVG Raft + Character + Motion Trail Diorama */}
      <div className="relative rounded-xl overflow-hidden bg-gradient-to-b from-[#0f3b5c] via-[#104d73] to-[#0b3350] border border-[#2a4c6e] h-48 flex items-center justify-center">
        <svg viewBox="0 0 340 185" className="w-full h-full" aria-label="معاينة المظهر والطوف">
          {/* Calm Sky Horizon & Sun */}
          <rect x="0" y="0" width="340" height="96" fill="#0d2c48" />
          <circle cx="288" cy="36" r="18" fill="#ffd13b" opacity="0.22" />
          <circle cx="288" cy="36" r="11" fill="#ffd13b" opacity="0.45" />

          {/* Ocean Surface & Foam */}
          <rect x="0" y="96" width="340" height="89" fill="#0d4f78" />
          <path
            d="M0 105 Q45 99 90 105 T180 105 T270 105 T340 105"
            fill="none"
            stroke={foamCss}
            strokeWidth="2.5"
            opacity="0.55"
          />
          <path
            d="M12 152 Q58 147 104 152 T196 152 T288 152"
            fill="none"
            stroke={foamCss}
            strokeWidth="2"
            opacity="0.35"
          />

          {/* Animated Motion Trail Puffs behind Raft */}
          {pulseBoost && (
            <g data-testid="preview-trail-puffs">
              <circle cx="86" cy="112" r="15" fill={trailPalette[0]} opacity="0.88" stroke="#14222f" strokeWidth="2">
                <animate attributeName="cx" values="92;52;92" dur="1.7s" repeatCount="indefinite" />
                <animate attributeName="r" values="12;17;12" dur="1.7s" repeatCount="indefinite" />
              </circle>
              <circle cx="62" cy="100" r="11" fill={trailPalette[1 % trailPalette.length]} opacity="0.82" stroke="#14222f" strokeWidth="1.8">
                <animate attributeName="cx" values="70;28;70" dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.35;0.9" dur="1.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="48" cy="121" r="9" fill={trailPalette[2 % trailPalette.length]} opacity="0.78" stroke="#14222f" strokeWidth="1.5">
                <animate attributeName="cx" values="58;16;58" dur="1.9s" repeatCount="indefinite" />
              </circle>
            </g>
          )}

          {/* Raft Mast, Flag & Lantern */}
          <line x1="234" y1="36" x2="234" y2="112" stroke={dividerCss} strokeWidth="5.5" strokeLinecap="round" />
          <polygon points="234,37 272,49 234,62" fill={flagCss} stroke="#14222f" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="246" cy="79" r="6" fill={lanternCss} stroke="#14222f" strokeWidth="2" />

          {/* Raft Hull Planks & Logs */}
          <rect x="94" y="106" width="168" height="26" rx="10" fill={logCss} stroke="#14222f" strokeWidth="3.5" />
          <rect x="102" y="99" width="152" height="14" rx="5" fill={deckCss} stroke="#14222f" strokeWidth="2.5" />
          <line x1="138" y1="100" x2="138" y2="131" stroke={dividerCss} strokeWidth="3" />
          <line x1="178" y1="100" x2="178" y2="131" stroke={dividerCss} strokeWidth="3" />
          <line x1="218" y1="100" x2="218" y2="131" stroke={dividerCss} strokeWidth="3" />

          {/* Character Standing on the Raft */}
          <g transform="translate(132, 24)">
            <CharacterAvatarSvg cosmetic={norm} size={86} />
          </g>
        </svg>
      </div>

      {/* Equipped/Previewed Breakdown (Clean unboxed metadata) */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-bold text-[#cbd5e1] bg-[#0d1d2f] rounded-xl px-3 py-2 border border-[#244361] leading-snug">
        <div>
          <span className="text-[#93c5fd]">القبعة:</span> {hatLabel}
        </div>
        <div>
          <span className="text-[#93c5fd]">النظارات:</span> {glassesLabel}
        </div>
        <div>
          <span className="text-[#93c5fd]">الزي:</span> {outfitLabel}
        </div>
        <div>
          <span className="text-[#93c5fd]">الطوف:</span> {raftLabel}
        </div>
        <div className="col-span-2">
          <span className="text-[#93c5fd]">أثر الحركة:</span> {trailLabel}
        </div>
      </div>
    </div>
  );
};
