import React, { useState } from 'react';
import { EMOTE_DEFINITIONS } from '../shared/social.ts';
import type { EmoteId } from '../shared/types.ts';

interface EmoteBarProps {
  onTriggerEmote: (emoteId: EmoteId) => void;
  compact?: boolean;
  disabled?: boolean;
  showShortcuts?: boolean;
  className?: string;
}

export const EmoteBar: React.FC<EmoteBarProps> = ({
  onTriggerEmote,
  compact = false,
  disabled = false,
  showShortcuts = false,
  className = '',
}) => {
  const [recentId, setRecentId] = useState<EmoteId | null>(null);

  const handleTrigger = (emoteId: EmoteId) => {
    if (disabled) return;
    onTriggerEmote(emoteId);
    setRecentId(emoteId);
    window.setTimeout(() => {
      setRecentId((prev) => (prev === emoteId ? null : prev));
    }, 550);
  };

  return (
    <div
      data-testid="emote-bar"
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
      role="group"
      aria-label="تعبيرات وحركات الشخصية"
    >
      {EMOTE_DEFINITIONS.map((def, idx) => {
        const isActive = recentId === def.id;
        return (
          <button
            key={def.id}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            data-testid={`emote-btn-${def.id}`}
            aria-label={`${def.labelAr}${showShortcuts ? ` [${idx + 1}]` : ''}`}
            onClick={(e) => {
              e.currentTarget.blur();
              handleTrigger(def.id);
            }}
            className={`inline-flex items-center gap-1 rounded-xl border font-black cursor-pointer transition-transform disabled:opacity-50 ${
              compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-xs sm:text-sm'
            } ${
              isActive
                ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f] scale-105'
                : 'bg-[#19334d] hover:bg-[#23476b] text-[#fff8e7] border-[#39628a]'
            }`}
          >
            <span aria-hidden="true">{def.icon}</span>
            <span className="whitespace-nowrap">{def.labelAr}</span>
            {showShortcuts && (
              <span className="text-[10px] opacity-75 tabular-nums">[{idx + 1}]</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
