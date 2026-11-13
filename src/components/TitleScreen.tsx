import React from 'react';

interface TitleScreenProps {
  onStartSolo: () => void;
  onOpenLobby: () => void;
  onOpenSettings: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  onStartSolo,
  onOpenLobby,
  onOpenSettings,
}) => {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 sm:p-8">
      {/* Top region: Bespoke SVG Emblem & Title Lockup over calm sky negative space */}
      <div className="flex flex-col items-center sm:items-start gap-4 max-w-md pointer-events-auto">
        <div className="flex items-center gap-3">
          <svg
            viewBox="0 0 88 88"
            className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 drop-shadow-md"
            aria-hidden="true"
          >
            {/* Cartoon Green Gas Cloud */}
            <circle cx="24" cy="48" r="14" fill="#9ef01a" stroke="#14222f" strokeWidth="4" />
            <circle cx="15" cy="36" r="10" fill="#ccff33" stroke="#14222f" strokeWidth="3.5" />
            <circle cx="12" cy="54" r="8" fill="#70e000" stroke="#14222f" strokeWidth="3.5" />
            {/* Wooden Raft Hull */}
            <rect x="28" y="48" width="52" height="18" rx="6" fill="#d48c46" stroke="#14222f" strokeWidth="4" />
            <line x1="42" y1="48" x2="42" y2="66" stroke="#7f4f24" strokeWidth="3" />
            <line x1="62" y1="48" x2="62" y2="66" stroke="#7f4f24" strokeWidth="3" />
            {/* Mast & Red Pennant */}
            <line x1="64" y1="16" x2="64" y2="50" stroke="#5c3614" strokeWidth="5" strokeLinecap="round" />
            <polygon points="64,17 82,24 64,32" fill="#ff595e" stroke="#14222f" strokeWidth="3" strokeLinejoin="round" />
            {/* Goofy Bulging Eyes Icon */}
            <circle cx="48" cy="37" r="9" fill="#ffffff" stroke="#14222f" strokeWidth="3.5" />
            <circle cx="58" cy="38" r="8" fill="#ffffff" stroke="#14222f" strokeWidth="3.5" />
            <circle cx="49" cy="37" r="3.2" fill="#14222f" />
            <circle cx="59" cy="38" r="2.8" fill="#14222f" />
          </svg>

          <div>
            <h1 className="text-4xl sm:text-5xl font-black text-[#ffd13b] cartoon-outline leading-tight">
              الطوف المجنونة
            </h1>
            <p className="text-sm sm:text-base font-bold text-[#fff8e7] cartoon-outline-sm mt-0.5">
              تعاون، وجّه الطوف، وأطلق الريح نحو خط النهاية!
            </p>
          </div>
        </div>

        {/* Focused CTA Stack (<= 3 primary actions) */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full sm:w-auto mt-1">
          <button
            type="button"
            data-start="true"
            onClick={onStartSolo}
            className="wood-btn-primary px-7 py-3.5 rounded-2xl text-xl font-black cursor-pointer flex items-center justify-center gap-2"
          >
            <span>ابدأ اللعب الآن</span>
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden="true">
              <path d="M16 5l-10 7 10 7V5z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onOpenLobby}
            className="wood-btn-secondary px-5 py-3.5 rounded-2xl text-base font-extrabold cursor-pointer"
          >
            غرفة أونلاين (4 لاعبين)
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="wood-btn-secondary px-4 py-3.5 rounded-2xl text-base font-bold cursor-pointer"
          >
            المظهر والإعدادات
          </button>
        </div>
      </div>

      {/* Bottom Safe Margin: Single flat borderless control hint line */}
      <div className="w-full text-center pb-1">
        <p className="text-xs sm:text-sm font-bold text-[#fff8e7] cartoon-outline-sm tracking-wide">
          ← → تحرك داخل منطقتك · Space إطلاق الريح (اضغط باستمرار) · Esc إيقاف مؤقت
        </p>
      </div>
    </div>
  );
};
