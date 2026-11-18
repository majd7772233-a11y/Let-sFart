import React, { useState } from 'react';
import { ChatPanel } from './ChatPanel.tsx';
import type { ChatMessage, ConnectionStatus, PartyState } from '../shared/types.ts';

const COLOR_SWATCHES = ['#ff595e', '#38bdf8', '#ffca3a', '#c084fc'];

interface PartyPanelProps {
  partyState: PartyState | null;
  myMemberId: string | null;
  partyStatus: ConnectionStatus;
  partyError: string | null;
  partyBusy?: boolean;
  partyMessages: ChatMessage[];
  currentRoomCode?: string | null;
  onCreateParty: () => void;
  onJoinParty: (partyCode: string) => void;
  onLeaveParty: () => void;
  onKickMember: (targetMemberId: string) => void;
  onSendPartyChat: (payload: { text?: string; presetId?: string }) => void;
  onFollowRoomClick?: (roomCode: string, password?: string | null) => void;
}

export const PartyPanel: React.FC<PartyPanelProps> = ({
  partyState,
  myMemberId,
  partyStatus,
  partyError,
  partyBusy = false,
  partyMessages,
  currentRoomCode = null,
  onCreateParty,
  onJoinParty,
  onLeaveParty,
  onKickMember,
  onSendPartyChat,
  onFollowRoomClick,
}) => {
  const [codeInput, setCodeInput] = useState('');
  const [copiedPartyCode, setCopiedPartyCode] = useState(false);
  const [expandedChat, setExpandedChat] = useState(false);

  const normalized = codeInput.trim().toUpperCase();
  const isCodeValid = /^[A-Z0-9]{6,10}$/.test(normalized);
  const isLeader = Boolean(partyState && myMemberId && partyState.leaderId === myMemberId);

  const handleCopyCode = () => {
    if (!partyState) return;
    navigator.clipboard?.writeText(partyState.partyCode).catch(() => {});
    setCopiedPartyCode(true);
    window.setTimeout(() => setCopiedPartyCode(false), 1600);
  };

  if (!partyState) {
    return (
      <div
        data-testid="party-panel"
        className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#a855f7]/60 space-y-2.5 mb-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-black text-[#e9d5ff]">
              👥 نظام المجموعات الدائمة (Party)
            </h3>
            <p className="text-[11px] font-bold text-[#cbd5e1]">
              اجتمع مع أصدقائك قبل الدخول؛ وسينضم الجميع تلقائياً عند دخول القائد لأي غرفة!
            </p>
          </div>
          <button
            type="button"
            data-testid="create-party-btn"
            disabled={partyBusy}
            onClick={onCreateParty}
            className="px-4 py-2 rounded-xl bg-[#9333ea] hover:bg-[#7e22ce] border border-[#f3e8ff]/40 text-xs font-black text-white cursor-pointer disabled:opacity-55 whitespace-nowrap"
          >
            {partyBusy ? 'جاري الإنشاء...' : '✨ إنشاء مجموعة'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="join-party-code" className="sr-only">
            رمز المجموعة
          </label>
          <input
            id="join-party-code"
            data-testid="join-party-code-input"
            type="text"
            maxLength={10}
            dir="ltr"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="أدخل رمز المجموعة..."
            className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-[#19334d] border border-[#39628a] text-center text-sm font-black tracking-widest text-[#e9d5ff] uppercase focus:outline-none focus:border-[#c084fc]"
          />
          <button
            type="button"
            data-testid="join-party-submit-btn"
            disabled={!isCodeValid || partyBusy}
            onClick={() => onJoinParty(normalized)}
            className="px-4 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#a855f7]/70 text-xs font-black text-[#e9d5ff] cursor-pointer disabled:opacity-45 whitespace-nowrap"
          >
            انضمام للمجموعة
          </button>
        </div>

        {partyError && (
          <div className="text-xs font-bold text-[#ff8589] bg-[#ff595e]/15 border border-[#ff595e]/40 px-3 py-1.5 rounded-xl">
            {partyError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="party-panel-active"
      className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#c084fc]/70 space-y-2.5 mb-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-black text-[#e9d5ff]">👥 المجموعة:</span>
          <span
            dir="ltr"
            data-testid="party-active-code"
            className="text-base font-black tracking-widest text-[#ffd13b] tabular-nums"
          >
            {partyState.partyCode}
          </span>
          <span className="text-[11px] font-bold text-[#93c5fd]">
            · {partyState.members.length}/4 أعضاء ·{' '}
            {partyStatus === 'connected'
              ? 'متصل'
              : partyStatus === 'reconnecting'
                ? 'إعادة اتصال...'
                : 'مزامنة'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyCode}
            className="px-2.5 py-1 rounded-lg bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-[11px] font-black cursor-pointer"
          >
            {copiedPartyCode ? '✓ تم النسخ' : 'نسخ الرمز'}
          </button>
          <button
            type="button"
            data-testid="toggle-party-chat-btn"
            onClick={() => setExpandedChat((v) => !v)}
            className="px-2.5 py-1 rounded-lg bg-[#19334d] hover:bg-[#23476b] border border-[#a855f7]/60 text-[11px] font-black text-[#e9d5ff] cursor-pointer"
          >
            💬 {expandedChat ? 'إخفاء الدردشة' : `دردشة (${partyMessages.length})`}
          </button>
          <button
            type="button"
            data-testid="leave-party-btn"
            onClick={onLeaveParty}
            className="px-2.5 py-1 rounded-lg bg-[#ff595e]/20 hover:bg-[#ff595e]/35 border border-[#ff595e]/60 text-[11px] font-black text-[#fecaca] cursor-pointer"
          >
            مغادرة
          </button>
        </div>
      </div>

      {/* Party Members Roster */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {partyState.members.map((member) => {
          const isMe = member.memberId === myMemberId;
          const swatch = COLOR_SWATCHES[(member.cosmetic?.colorIndex ?? 0) % COLOR_SWATCHES.length];
          return (
            <div
              key={member.memberId}
              className="bg-[#0b1929] border border-[#2a4c6e] rounded-xl px-2.5 py-2 flex items-center justify-between gap-1.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: swatch }}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-black truncate text-white">
                    {member.name}
                    {isMe ? ' (أنت)' : ''}
                  </span>
                </div>
                <div className="text-[10px] font-bold text-[#93c5fd] mt-0.5">
                  {member.isLeader ? '👑 قائد' : 'عضو'} ·{' '}
                  {member.connected ? 'متصل' : 'بانتظار الاتصال'}
                </div>
              </div>
              {isLeader && !isMe && (
                <button
                  type="button"
                  aria-label={`طرد ${member.name}`}
                  onClick={() => onKickMember(member.memberId)}
                  className="px-1.5 py-0.5 rounded bg-[#ff595e]/20 hover:bg-[#ff595e]/40 text-[#fecaca] text-[10px] font-black cursor-pointer shrink-0"
                >
                  طرد
                </button>
              )}
            </div>
          );
        })}
      </div>

      {partyState.activeRoomCode && partyState.activeRoomCode !== currentRoomCode && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0b1929] border border-[#38bdf8]/50 rounded-xl px-3 py-1.5 text-xs">
          <span className="font-bold text-[#bae6fd]">
            🚩 القائد متواجد حالياً في الغرفة:{' '}
            <strong dir="ltr" className="text-[#ffd13b]">
              {partyState.activeRoomCode}
            </strong>
          </span>
          {onFollowRoomClick && (
            <button
              type="button"
              onClick={() =>
                onFollowRoomClick(partyState.activeRoomCode!, partyState.activeRoomPassword)
              }
              className="px-3 py-1 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] text-white text-[11px] font-black cursor-pointer"
            >
              انضمام فوراً
            </button>
          )}
        </div>
      )}

      {partyError && (
        <div className="text-xs font-bold text-[#ff8589] bg-[#ff595e]/15 border border-[#ff595e]/40 px-3 py-1.5 rounded-xl">
          {partyError}
        </div>
      )}

      {expandedChat && (
        <ChatPanel
          title="دردشة المجموعة"
          messages={partyMessages}
          onSendChat={onSendPartyChat}
          compact
          maxHeightClass="max-h-28"
          testIdPrefix="party-chat"
        />
      )}
    </div>
  );
};
