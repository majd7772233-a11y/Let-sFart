import React, { useEffect, useRef, useState } from 'react';
import {
  MAX_CHAT_LENGTH,
  QUICK_CHAT_PRESETS,
  type QuickChatPreset,
} from '../shared/social.ts';
import type { ChatMessage } from '../shared/types.ts';

const SENDER_COLOR_HEX = ['#ff595e', '#38bdf8', '#ffca3a', '#c084fc'];

interface ChatPanelProps {
  title?: string;
  messages: ChatMessage[];
  presets?: readonly QuickChatPreset[];
  onSendChat: (payload: { text?: string; presetId?: string }) => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
  maxHeightClass?: string;
  testIdPrefix?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  title = 'دردشة الطاقم',
  messages,
  presets = QUICK_CHAT_PRESETS,
  onSendChat,
  disabled = false,
  placeholder = 'اكتب رسالة قصيرة...',
  compact = false,
  maxHeightClass = 'max-h-36',
  testIdPrefix = 'chat',
}) => {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    onSendChat({ text: trimmed });
    setDraft('');
  };

  return (
    <div
      data-testid={`${testIdPrefix}-panel`}
      className="bg-[#0e2033] border-2 border-[#2a4c6e] rounded-2xl p-3 flex flex-col gap-2 text-[#fff8e7]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-[#ffd13b]">{title}</span>
        <span className="text-[11px] font-bold text-[#93c5fd] tabular-nums">
          {messages.length} رسالة
        </span>
      </div>

      {/* Quick Chat Tactical Presets */}
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.slice(0, compact ? 4 : presets.length).map((preset) => (
            <button
              key={preset.id}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              data-testid={`${testIdPrefix}-preset-${preset.id}`}
              onClick={(e) => {
                e.currentTarget.blur();
                onSendChat({ presetId: preset.id });
              }}
              className="px-2 py-1 rounded-lg bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-[11px] font-extrabold text-[#dbeafe] cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {preset.text}
            </button>
          ))}
        </div>
      )}

      {/* Messages Feed */}
      <div
        ref={listRef}
        data-testid={`${testIdPrefix}-messages`}
        className={`overflow-y-auto bg-[#081523] border border-[#203a56] rounded-xl p-2 space-y-1.5 ${maxHeightClass}`}
      >
        {messages.length === 0 ? (
          <div className="text-[11px] font-bold text-[#7ca3cc] text-center py-2">
            لا توجد رسائل بعد — ابدأ المحادثة أو استخدم الرسائل السريعة!
          </div>
        ) : (
          messages.map((msg) => {
            const swatch = SENDER_COLOR_HEX[(msg.colorIndex ?? 0) % SENDER_COLOR_HEX.length];
            return (
              <div key={msg.id} className="text-xs leading-relaxed break-words">
                <span
                  className="inline-block w-2 h-2 rounded-full ml-1.5 align-middle"
                  style={{ backgroundColor: swatch }}
                  aria-hidden="true"
                />
                <span className="font-black text-[#ffd13b]">{msg.senderName}</span>
                {msg.isSpectator && (
                  <span className="text-[10px] font-bold text-[#93c5fd] mx-1">· مشاهد</span>
                )}
                <span className="text-[#93c5fd] mx-1">:</span>
                <span className="font-bold text-[#f8fafc]">{msg.text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Text Input Form */}
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
        <label htmlFor={`${testIdPrefix}-input`} className="sr-only">
          {title}
        </label>
        <input
          id={`${testIdPrefix}-input`}
          data-testid={`${testIdPrefix}-input`}
          type="text"
          maxLength={MAX_CHAT_LENGTH}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={placeholder}
          className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-[#19334d] border border-[#39628a] text-xs font-bold text-white focus:outline-none focus:border-[#ffd13b] disabled:opacity-55"
        />
        <button
          type="submit"
          data-testid={`${testIdPrefix}-send-btn`}
          disabled={disabled || draft.trim().length === 0}
          className="px-3.5 py-1.5 rounded-xl bg-[#ffd13b] hover:bg-[#ffe066] text-[#14222f] border border-[#14222f] text-xs font-black cursor-pointer disabled:opacity-45 whitespace-nowrap shrink-0"
        >
          إرسال
        </button>
      </form>
    </div>
  );
};
