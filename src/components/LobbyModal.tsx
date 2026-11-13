import React, { useState } from 'react';
import { CHARACTER_PRESETS, PLAYER_ZONES } from '../shared/course.ts';
import type {
  ConnectionStatus,
  GlassesStyle,
  HatStyle,
  PlayerCosmetic,
  RoomSnapshot,
  SeatStatus,
} from '../shared/types.ts';

interface LobbyModalProps {
  playerName: string;
  onChangeName: (name: string) => void;
  cosmetic: PlayerCosmetic;
  onChangeCosmetic: (c: PlayerCosmetic) => void;
  roomSnapshot: RoomSnapshot | null;
  myPlayerId: string | null;
  connectionStatus: ConnectionStatus;
  errorMsg: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onToggleReady: (ready: boolean) => void;
  onToggleBots: (fillBots: boolean) => void;
  onStartOnlineGame: () => void;
  onLeaveRoom: () => void;
  onClose: () => void;
}

const HATS: { id: HatStyle; label: string }[] = [
  { id: 'none', label: 'بدون' },
  { id: 'captain', label: 'قبعة قبطان' },
  { id: 'crown', label: 'تاج' },
  { id: 'propeller', label: 'مروحة' },
];

const GLASSES: { id: GlassesStyle; label: string }[] = [
  { id: 'none', label: 'بدون' },
  { id: 'shades', label: 'شمسية' },
  { id: 'nerd', label: 'دائرية' },
];

const COLORS = [
  { idx: 0, label: 'مرجاني', hex: '#ff595e' },
  { idx: 1, label: 'بحري', hex: '#1982c4' },
  { idx: 2, label: 'ذهبي', hex: '#ffca3a' },
  { idx: 3, label: 'بنفسجي', hex: '#9b5de5' },
];

export const LobbyModal: React.FC<LobbyModalProps> = ({
  playerName,
  onChangeName,
  cosmetic,
  onChangeCosmetic,
  roomSnapshot,
  myPlayerId,
  connectionStatus,
  errorMsg,
  onCreateRoom,
  onJoinRoom,
  onToggleReady,
  onToggleBots,
  onStartOnlineGame,
  onLeaveRoom,
  onClose,
}) => {
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const isHost = roomSnapshot ? roomSnapshot.hostId === myPlayerId : false;
  const me = roomSnapshot?.sim.players.find((p) => p.id === myPlayerId);

  const handleCopyCode = () => {
    if (!roomSnapshot) return;
    navigator.clipboard?.writeText(roomSnapshot.roomCode).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#071928]/70">
      <div className="wood-panel w-full max-w-2xl rounded-3xl p-5 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
              {roomSnapshot ? `غرفة اللعب: ${roomSnapshot.roomCode}` : 'اللعب الجماعي عبر الإنترنت'}
            </h2>
            {(roomSnapshot || connectionStatus !== 'disconnected') && (
              <span
                data-testid="lobby-connection-status"
                className={`px-2.5 py-0.5 rounded-lg text-xs font-black border ${
                  connectionStatus === 'connected'
                    ? 'bg-[#06d6a0]/20 text-[#06d6a0] border-[#06d6a0]/50'
                    : connectionStatus === 'reconnecting' || connectionStatus === 'connecting'
                      ? 'bg-[#ffd166]/20 text-[#ffd166] border-[#ffd166]/50'
                      : 'bg-[#ff595e]/20 text-[#ff8589] border-[#ff595e]/50'
                }`}
              >
                {connectionStatus === 'connected'
                  ? 'متصل'
                  : connectionStatus === 'reconnecting'
                    ? 'جاري إعادة الاتصال...'
                    : connectionStatus === 'connecting'
                      ? 'جاري الاتصال...'
                      : 'غير متصل'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={roomSnapshot ? onLeaveRoom : onClose}
            className="px-3.5 py-1.5 rounded-xl bg-[#142a40] hover:bg-[#1e3d5c] border-2 border-[#f7d060]/40 text-sm font-bold cursor-pointer"
          >
            {roomSnapshot ? 'مغادرة الغرفة' : 'إغلاق'}
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 px-4 py-2.5 rounded-xl bg-[#ff595e]/25 border-2 border-[#ff595e] text-sm font-bold text-[#ffd6d8]">
            {errorMsg}
          </div>
        )}

        {/* Cosmetic & Nickname Customizer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e]">
          <div>
            <label htmlFor="lobby-name" className="block text-xs font-bold text-[#ffd13b] mb-1">
              اسم العرض المؤقت
            </label>
            <input
              id="lobby-name"
              type="text"
              maxLength={16}
              value={playerName}
              onChange={(e) => onChangeName(e.target.value)}
              disabled={Boolean(roomSnapshot)}
              placeholder="اكتب اسمك..."
              className="w-full px-3 py-2 rounded-xl bg-[#19334d] border-2 border-[#39628a] text-white font-bold focus:outline-none focus:border-[#ffd13b] disabled:opacity-60"
            />
          </div>

          <div>
            <span className="block text-xs font-bold text-[#ffd13b] mb-1">لون الشخصية</span>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.idx}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, colorIndex: c.idx })}
                  aria-label={`لون ${c.label}`}
                  className={`w-9 h-9 rounded-xl border-2 cursor-pointer transition-transform ${
                    cosmetic.colorIndex === c.idx ? 'border-white scale-110' : 'border-[#0f1f30] opacity-80'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-bold text-[#ffd13b] mb-1">القبعة</span>
            <div className="flex flex-wrap gap-1.5">
              {HATS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, hat: h.id })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                    cosmetic.hat === h.id
                      ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                      : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-bold text-[#ffd13b] mb-1">النظارات</span>
            <div className="flex flex-wrap gap-1.5">
              {GLASSES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, glasses: g.id })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                    cosmetic.glasses === g.id
                      ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                      : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!roomSnapshot ? (
          /* Create or Join Room */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#102438] p-4 rounded-2xl border-2 border-[#2a4c6e] flex flex-col justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-white">إنشاء غرفة جديدة</h3>
                <p className="text-xs text-[#b8d8f8] mt-1">
                  احصل على رمز قصير وشاركه مع حتى 3 أصدقاء للانضمام لنفس الطوف.
                </p>
              </div>
              <button
                type="button"
                onClick={onCreateRoom}
                className="wood-btn-primary w-full py-3 rounded-xl font-black text-base cursor-pointer"
              >
                أنشئ غرفة الآن
              </button>
            </div>

            <div className="bg-[#102438] p-4 rounded-2xl border-2 border-[#2a4c6e] flex flex-col justify-between gap-3">
              <div>
                <label htmlFor="join-room-code" className="block text-lg font-black text-white">
                  انضم برمز الغرفة
                </label>
                <input
                  id="join-room-code"
                  type="text"
                  maxLength={10}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="مثال: A4K9M2PX"
                  dir="ltr"
                  className="mt-2 w-full px-3 py-2.5 rounded-xl bg-[#19334d] border-2 border-[#39628a] text-center text-lg tracking-widest font-black text-[#ffd13b] uppercase focus:outline-none focus:border-[#ffd13b]"
                />
              </div>
              <button
                type="button"
                onClick={() => onJoinRoom(joinCode)}
                disabled={joinCode.trim().length < 2}
                className="wood-btn-secondary w-full py-3 rounded-xl font-black text-base cursor-pointer disabled:opacity-50"
              >
                دخول الغرفة
              </button>
            </div>
          </div>
        ) : (
          /* Waiting Room */
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#102438] px-4 py-3 rounded-2xl border-2 border-[#f7d060]/50">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[#b8d8f8]">رمز الغرفة:</span>
                <span dir="ltr" className="text-2xl font-black tracking-widest text-[#ffd13b] tabular-nums">
                  {roomSnapshot.roomCode}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="px-4 py-1.5 rounded-xl bg-[#23496d] hover:bg-[#2c5b87] border border-[#f7d060]/40 text-xs font-extrabold cursor-pointer"
              >
                {copied ? '✓ تم النسخ!' : 'نسخ الرمز'}
              </button>
            </div>

            {/* 4 Raft Seats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {roomSnapshot.sim.players.map((p, idx) => {
                const preset = CHARACTER_PRESETS[idx];
                const zone = PLAYER_ZONES[idx];
                const isMe = p.id === myPlayerId;
                const seatStatus: SeatStatus =
                  roomSnapshot.seats?.[idx] ??
                  p.seatStatus ??
                  (p.isBot ? 'BOT' : p.connected ? 'CONNECTED' : 'EMPTY');
                const isHumanOccupied = seatStatus === 'CONNECTED' || seatStatus === 'RECONNECTING';
                const isActiveSlot = seatStatus === 'CONNECTED' || seatStatus === 'BOT';

                return (
                  <div
                    key={idx}
                    data-seat-status={seatStatus}
                    className={`p-3 rounded-2xl border-2 flex flex-col justify-between gap-2 ${
                      seatStatus === 'RECONNECTING'
                        ? 'bg-[#2a2210] border-[#ffd166]/60'
                        : isActiveSlot
                          ? 'bg-[#17334f] border-[#4d84b8]'
                          : 'bg-[#0e2033] border-[#233d59] opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black shrink-0"
                        style={{ backgroundColor: COLORS[p.cosmetic.colorIndex % 4].hex }}
                      />
                      <span className="text-[11px] font-bold text-[#93c5fd]">
                        {zone.label}{isMe ? ' · أنت' : ''}
                      </span>
                    </div>
                    <div>
                      <div className="font-black text-sm truncate">
                        {isHumanOccupied ? p.name : preset.name}
                      </div>
                      <div className="text-xs font-bold mt-0.5">
                        {seatStatus === 'EMPTY' ? (
                          <span className="text-slate-400">مقعد فارغ</span>
                        ) : seatStatus === 'BOT' ? (
                          <span className="text-[#8ac926]">مساعد آلي</span>
                        ) : seatStatus === 'RECONNECTING' ? (
                          <span className="text-[#ffd166]">
                            جاري إعادة الاتصال…{p.ready ? ' (جاهز)' : ' (غير جاهز)'}
                          </span>
                        ) : p.ready ? (
                          <span className="text-[#06d6a0]">جاهز ✓</span>
                        ) : (
                          <span className="text-[#ffd166]">ينتظر الجاهزية</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Host / Player Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-3">
                {!isHost && me && (
                  <button
                    type="button"
                    onClick={() => onToggleReady(!me.ready)}
                    className="wood-btn-secondary px-5 py-2.5 rounded-xl font-black text-sm cursor-pointer"
                  >
                    {me.ready ? 'إلغاء الجاهزية' : 'أنا جاهز!'}
                  </button>
                )}

                {isHost && (
                  <label className="flex items-center gap-2 text-sm font-bold cursor-pointer bg-[#102438] px-3.5 py-2 rounded-xl border border-[#2a4c6e]">
                    <input
                      type="checkbox"
                      checked={roomSnapshot.fillBots}
                      onChange={(e) => onToggleBots(e.target.checked)}
                      className="w-4 h-4 accent-[#ffd13b]"
                    />
                    <span>ملء المقاعد الفارغة بمساعدين آليين</span>
                  </label>
                )}
              </div>

              {isHost ? (
                <div className="flex flex-col items-end gap-1.5">
                  {(() => {
                    const seatEntries = roomSnapshot.sim.players.map((p, idx) => ({
                      player: p,
                      status:
                        roomSnapshot.seats?.[idx] ??
                        p.seatStatus ??
                        (p.isBot ? 'BOT' : p.connected ? 'CONNECTED' : 'EMPTY'),
                    }));
                    const unreadyHumans = seatEntries
                      .filter(
                        ({ player, status }) =>
                          (status === 'CONNECTED' || status === 'RECONNECTING') && !player.ready,
                      )
                      .map(({ player }) => player);
                    const reconnectingHumans = seatEntries
                      .filter(({ status }) => status === 'RECONNECTING')
                      .map(({ player }) => player);
                    return (
                      <>
                        {unreadyHumans.length > 0 && (
                          <span className="text-xs font-bold text-[#ffd166]">
                            بانتظار جاهزية: {unreadyHumans.map((p) => p.name).join('، ')}
                          </span>
                        )}
                        {reconnectingHumans.length > 0 && (
                          <span className="text-xs font-bold text-[#93c5fd]">
                            بانتظار عودة: {reconnectingHumans.map((p) => p.name).join('، ')}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={onStartOnlineGame}
                          className="wood-btn-primary px-7 py-3 rounded-2xl font-black text-lg cursor-pointer"
                        >
                          ابدأ الجولة للجميع!
                        </button>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <span className="text-sm font-bold text-[#ffd166]">
                  {me?.ready ? 'تم تأكيد جاهزيتك — بانتظار المضيف...' : 'اضغط "أنا جاهز!" لكي يتمكن المضيف من البدء'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
