import React, { useEffect, useMemo, useState } from 'react';
import {
  BOT_DIFFICULTY_META,
  BOT_PERSONALITY_META,
  getDefaultBotPersonality,
} from '../shared/bots.ts';
import { CHARACTER_PRESETS, COURSE_LIST, PLAYER_ZONES, getCourseById } from '../shared/course.ts';
import {
  COSMETIC_CATALOG,
  COSMETIC_COLOR_DEFS,
  getDefaultOwnedItemIds,
} from '../shared/cosmetics.ts';
import type {
  PublicRoomListingItem,
  RoomPublicInfoResponse,
  SeatSlotOrSpectator,
} from '../shared/protocol.ts';
import type {
  AccountProfile,
  BotDifficulty,
  BotPersonality,
  ChatMessage,
  ConnectionStatus,
  CourseId,
  CourseSelectionMode,
  EmoteId,
  GameDifficulty,
  GameMode,
  GlassesStyle,
  HatStyle,
  PartyState,
  PlayerCosmetic,
  PlaylistItem,
  RoomSettings,
  RoomSnapshot,
  SeatStatus,
} from '../shared/types.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { EmoteBar } from './EmoteBar.tsx';
import { PartyPanel } from './PartyPanel.tsx';

const COURSE_EMBLEM: Record<CourseId, string> = {
  tropical: '🌴',
  volcanic: '🌋',
  glacial: '❄️',
  factory: '⚙️',
  storm: '⛈️',
};

const GAME_MODE_OPTIONS: { id: GameMode; icon: string; label: string }[] = [
  { id: 'standard', icon: '🚣', label: 'القياسي' },
  { id: 'time_trial', icon: '⏱️', label: 'سباق الزمن' },
  { id: 'survival', icon: '🌊', label: 'وضع البقاء' },
  { id: 'treasure', icon: '🪙', label: 'جمع الكنوز' },
  { id: 'chaos', icon: '🌀', label: 'وضع الفوضى' },
];

const DIFFICULTY_OPTIONS: { id: GameDifficulty; label: string }[] = [
  { id: 'easy', label: 'سهل' },
  { id: 'normal', label: 'متوسط' },
  { id: 'hard', label: 'صعب' },
];

const BOT_DIFFICULTY_OPTIONS: { id: BotDifficulty; label: string }[] = [
  { id: 'easy', label: BOT_DIFFICULTY_META.easy.labelAr },
  { id: 'normal', label: BOT_DIFFICULTY_META.normal.labelAr },
  { id: 'hard', label: BOT_DIFFICULTY_META.hard.labelAr },
];

const BOT_PERSONALITY_ORDER: readonly BotPersonality[] = [
  'rusher',
  'cautious',
  'treasure_hunter',
  'balancer',
];

const TIME_LIMIT_OPTIONS: { sec: number; label: string }[] = [
  { sec: 0, label: 'بلا حد' },
  { sec: 90, label: '90 ث' },
  { sec: 120, label: 'دقيقتان' },
  { sec: 180, label: '3 دقائق' },
  { sec: 300, label: '5 دقائق' },
];

export type LobbyTab = 'public' | 'create' | 'join';

interface LobbyModalProps {
  playerName: string;
  onChangeName: (name: string) => void;
  cosmetic: PlayerCosmetic;
  ownedItemIds?: string[];
  onChangeCosmetic: (c: PlayerCosmetic) => void;
  selectedCourseId: CourseId;
  onSelectCourse: (courseId: CourseId, mode?: CourseSelectionMode) => void;
  onVoteCourse: (courseId: CourseId) => void;
  createSettings: RoomSettings;
  onChangeCreateSettings: (next: RoomSettings) => void;
  roomSnapshot: RoomSnapshot | null;
  myPlayerId: string | null;
  mySlot: SeatSlotOrSpectator;
  connectionStatus: ConnectionStatus;
  isSubmitting?: boolean;
  errorMsg: string | null;
  initialTab?: LobbyTab;
  initialJoinCode?: string;
  publicRooms: PublicRoomListingItem[];
  spectatableRooms: PublicRoomListingItem[];
  publicRoomsLoading: boolean;
  publicRoomsError: string | null;
  onRefreshPublicRooms: () => void;
  onQuickMatch: (preferredGameMode?: GameMode) => void;
  roomPreview: RoomPublicInfoResponse | null;
  roomPreviewLoading: boolean;
  onPreviewRoom: (code: string) => void;
  onCreateRoom: (opts: { isPrivate: boolean; password?: string; settings: RoomSettings }) => void;
  onJoinRoom: (code: string, password?: string) => void;
  onSpectateRoom: (code: string, password?: string) => void;
  onUpdateRoomSettings: (settings: Partial<RoomSettings>) => void;
  onSetPlaylist: (playlist: PlaylistItem[]) => void;
  onToggleReady: (ready: boolean) => void;
  onToggleBots: (fillBots: boolean) => void;
  onStartOnlineGame: () => void;
  onLeaveRoom: () => void;
  onClose: () => void;
  roomChatMessages: ChatMessage[];
  onSendRoomChat: (payload: { text?: string; presetId?: string }) => void;
  onTriggerEmote: (emoteId: EmoteId) => void;
  partyState: PartyState | null;
  partyMemberId: string | null;
  partyStatus: ConnectionStatus;
  partyError: string | null;
  partyBusy?: boolean;
  partyMessages: ChatMessage[];
  onCreateParty: () => void;
  onJoinParty: (partyCode: string) => void;
  onLeaveParty: () => void;
  onKickPartyMember: (targetMemberId: string) => void;
  onSendPartyChat: (payload: { text?: string; presetId?: string }) => void;
  accountProfile?: AccountProfile | null;
  onOpenProfile?: () => void;
  onOpenLeaderboard?: () => void;
}

export const LobbyModal: React.FC<LobbyModalProps> = ({
  playerName,
  onChangeName,
  cosmetic,
  ownedItemIds,
  onChangeCosmetic,
  selectedCourseId,
  onSelectCourse,
  onVoteCourse,
  createSettings,
  onChangeCreateSettings,
  roomSnapshot,
  myPlayerId,
  mySlot,
  connectionStatus,
  isSubmitting = false,
  errorMsg,
  initialTab = 'public',
  initialJoinCode = '',
  publicRooms,
  spectatableRooms,
  publicRoomsLoading,
  publicRoomsError,
  onRefreshPublicRooms,
  onQuickMatch,
  roomPreview,
  roomPreviewLoading,
  onPreviewRoom,
  onCreateRoom,
  onJoinRoom,
  onSpectateRoom,
  onUpdateRoomSettings,
  onSetPlaylist,
  onToggleReady,
  onToggleBots,
  onStartOnlineGame,
  onLeaveRoom,
  onClose,
  roomChatMessages,
  onSendRoomChat,
  onTriggerEmote,
  partyState,
  partyMemberId,
  partyStatus,
  partyError,
  partyBusy = false,
  partyMessages,
  onCreateParty,
  onJoinParty,
  onLeaveParty,
  onKickPartyMember,
  onSendPartyChat,
  accountProfile = null,
  onOpenProfile,
  onOpenLeaderboard,
}) => {
  const ownedSet = useMemo(
    () => new Set(ownedItemIds && ownedItemIds.length > 0 ? ownedItemIds : getDefaultOwnedItemIds()),
    [ownedItemIds],
  );
  const ownedColors = useMemo(
    () => COSMETIC_COLOR_DEFS.filter((c) => ownedSet.has(`color:${c.index}`)),
    [ownedSet],
  );
  const ownedHats = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'hat' && ownedSet.has(i.id)),
    [ownedSet],
  );
  const ownedGlasses = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'glasses' && ownedSet.has(i.id)),
    [ownedSet],
  );

  const [activeTab, setActiveTab] = useState<LobbyTab>(initialTab);
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [joinPassword, setJoinPassword] = useState('');
  const [manualPasswordToggle, setManualPasswordToggle] = useState(false);

  const [isPrivateCreate, setIsPrivateCreate] = useState(false);
  const [createPassword, setCreatePassword] = useState('');

  const [quickMatchMode, setQuickMatchMode] = useState<GameMode | ''>('');

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (initialJoinCode) {
      setJoinCode(initialJoinCode);
      setActiveTab('join');
    }
  }, [initialJoinCode]);

  const normalizedJoinCode = joinCode.trim().toUpperCase();
  const isJoinCodeValid = /^[A-Z0-9]{6,10}$/.test(normalizedJoinCode);
  const isBusy = isSubmitting || connectionStatus === 'connecting';
  const createPasswordValid = !isPrivateCreate || (createPassword.trim().length >= 3 && createPassword.trim().length <= 32);

  const previewMatchesInput = Boolean(roomPreview && roomPreview.roomCode === normalizedJoinCode);
  const needsPasswordInput = Boolean((previewMatchesInput && roomPreview?.isPrivate) || manualPasswordToggle);

  const isHost = roomSnapshot ? roomSnapshot.hostId === myPlayerId : false;
  const isSpectator = Boolean(roomSnapshot && mySlot === -1);
  const me = roomSnapshot && !isSpectator ? roomSnapshot.sim.players.find((p) => p.id === myPlayerId) : undefined;

  const handleCopyCode = () => {
    if (!roomSnapshot) return;
    navigator.clipboard?.writeText(roomSnapshot.roomCode).catch(() => {});
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1600);
  };

  const handleCopyInviteLink = () => {
    if (!roomSnapshot) return;
    const url = `${window.location.origin}/?room=${encodeURIComponent(roomSnapshot.roomCode)}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/70">
      <div className="wood-panel w-full max-w-3xl rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
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
          <div className="flex items-center gap-2 shrink-0">
            {accountProfile && onOpenProfile && (
              <button
                type="button"
                onClick={onOpenProfile}
                className="px-2.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#ffd13b] cursor-pointer whitespace-nowrap tabular-nums"
              >
                {accountProfile.displayName} · م{accountProfile.level}
              </button>
            )}
            {onOpenLeaderboard && (
              <button
                type="button"
                onClick={onOpenLeaderboard}
                className="px-2.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#93c5fd] cursor-pointer whitespace-nowrap"
              >
                المتصدرون
              </button>
            )}
            <button
              type="button"
              onClick={roomSnapshot ? onLeaveRoom : onClose}
              className="px-3.5 py-1.5 rounded-xl bg-[#142a40] hover:bg-[#1e3d5c] border-2 border-[#f7d060]/40 text-sm font-bold cursor-pointer whitespace-nowrap"
            >
              {roomSnapshot ? 'مغادرة الغرفة' : 'إغلاق'}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div
            data-testid="lobby-error-banner"
            className="mb-4 px-4 py-2.5 rounded-xl bg-[#ff595e]/25 border-2 border-[#ff595e] text-sm font-bold text-[#ffd6d8]"
          >
            {errorMsg}
          </div>
        )}

        {/* Cosmetic & Nickname Customizer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e]">
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
              disabled={Boolean(roomSnapshot) || isBusy}
              placeholder="اكتب اسمك..."
              className="w-full px-3 py-2 rounded-xl bg-[#19334d] border-2 border-[#39628a] text-white font-bold focus:outline-none focus:border-[#ffd13b] disabled:opacity-60"
            />
          </div>

          <div>
            <span className="block text-xs font-bold text-[#ffd13b] mb-1">لون الشخصية</span>
            <div className="flex flex-wrap gap-2">
              {ownedColors.map((c) => (
                <button
                  key={c.index}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, colorIndex: c.index })}
                  aria-label={`لون ${c.titleAr}`}
                  className={`w-9 h-9 rounded-xl border-2 cursor-pointer transition-transform ${
                    cosmetic.colorIndex === c.index ? 'border-white scale-110' : 'border-[#0f1f30] opacity-80'
                  }`}
                  style={{ backgroundColor: c.bodyHex }}
                />
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-bold text-[#ffd13b] mb-1">القبعة</span>
            <div className="flex flex-wrap gap-1.5">
              {ownedHats.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, hat: h.value as HatStyle })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                    cosmetic.hat === h.value
                      ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                      : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                  }`}
                >
                  {h.titleAr}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-bold text-[#ffd13b] mb-1">النظارات</span>
            <div className="flex flex-wrap gap-1.5">
              {ownedGlasses.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChangeCosmetic({ ...cosmetic, glasses: g.value as GlassesStyle })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                    cosmetic.glasses === g.value
                      ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                      : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                  }`}
                >
                  {g.titleAr}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ONLINE-09: Persistent Party Coordinator */}
        <PartyPanel
          partyState={partyState}
          myMemberId={partyMemberId}
          partyStatus={partyStatus}
          partyError={partyError}
          partyBusy={partyBusy}
          partyMessages={partyMessages}
          currentRoomCode={roomSnapshot?.roomCode ?? null}
          onCreateParty={onCreateParty}
          onJoinParty={onJoinParty}
          onLeaveParty={onLeaveParty}
          onKickMember={onKickPartyMember}
          onSendPartyChat={onSendPartyChat}
          onFollowRoomClick={(code, pwd) => onJoinRoom(code, pwd ?? undefined)}
        />

        {!roomSnapshot ? (
          /* Pre-Room Discovery / Creation / Join Tabs */
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 bg-[#0c1c2c] p-1.5 rounded-2xl border-2 border-[#2a4c6e]">
              <button
                type="button"
                data-testid="lobby-tab-public"
                aria-pressed={activeTab === 'public'}
                onClick={() => {
                  setActiveTab('public');
                  onRefreshPublicRooms();
                }}
                className={`py-2 px-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer transition-colors ${
                  activeTab === 'public'
                    ? 'bg-[#ffd13b] text-[#14222f]'
                    : 'text-[#dbeafe] hover:bg-[#152d45]'
                }`}
              >
                🌐 الغرف العامة
              </button>
              <button
                type="button"
                data-testid="lobby-tab-create"
                aria-pressed={activeTab === 'create'}
                onClick={() => setActiveTab('create')}
                className={`py-2 px-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer transition-colors ${
                  activeTab === 'create'
                    ? 'bg-[#ffd13b] text-[#14222f]'
                    : 'text-[#dbeafe] hover:bg-[#152d45]'
                }`}
              >
                ➕ إنشاء غرفة
              </button>
              <button
                type="button"
                data-testid="lobby-tab-join"
                aria-pressed={activeTab === 'join'}
                onClick={() => setActiveTab('join')}
                className={`py-2 px-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer transition-colors ${
                  activeTab === 'join'
                    ? 'bg-[#ffd13b] text-[#14222f]'
                    : 'text-[#dbeafe] hover:bg-[#152d45]'
                }`}
              >
                🔑 انضمام برمز
              </button>
            </div>

            {activeTab === 'public' && (
              <div className="space-y-3">
                {/* ONLINE-04: Quick Match Bar */}
                <div className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#38bdf8]/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-[#ffd13b]">⚡ اللعب السريع (Quick Match)</h3>
                    <p className="text-xs text-[#b8d8f8]">
                      ابحث تلقائياً عن غرفة عامة مفتوحة وانضم إلى الفريق فوراً.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      aria-label="تفضيل النمط للعب السريع"
                      value={quickMatchMode}
                      onChange={(e) => setQuickMatchMode((e.target.value as GameMode | '') || '')}
                      className="px-2.5 py-2 rounded-xl bg-[#19334d] border border-[#39628a] text-xs font-bold text-white"
                    >
                      <option value="">أي نمط</option>
                      {GAME_MODE_OPTIONS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.icon} {m.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-testid="quick-match-btn"
                      disabled={isBusy}
                      onClick={() => onQuickMatch(quickMatchMode || undefined)}
                      className="wood-btn-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer disabled:opacity-55"
                    >
                      {isBusy ? 'جاري البحث...' : 'انضمام عشوائي'}
                    </button>
                  </div>
                </div>

                {/* ONLINE-05: Public Rooms Directory */}
                <div className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-white">
                      الغرف العامة المتاحة ({publicRooms.length})
                    </span>
                    <button
                      type="button"
                      data-testid="refresh-public-rooms-btn"
                      onClick={onRefreshPublicRooms}
                      disabled={publicRoomsLoading}
                      className="px-3 py-1 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-xs font-bold cursor-pointer disabled:opacity-55"
                    >
                      {publicRoomsLoading ? 'جاري التحديث...' : '🔄 تحديث القائمة'}
                    </button>
                  </div>

                  {publicRoomsError && (
                    <div className="text-xs font-bold text-[#ff8589] bg-[#ff595e]/15 border border-[#ff595e]/40 px-3 py-2 rounded-xl">
                      {publicRoomsError}
                    </div>
                  )}

                  {!publicRoomsLoading && publicRooms.length === 0 ? (
                    <div
                      data-testid="public-rooms-empty"
                      className="text-center py-6 px-3 bg-[#0c1c2c] rounded-xl border border-[#233d59] text-xs sm:text-sm font-bold text-[#93c5fd]"
                    >
                      لا توجد غرف عامة بانتظار لاعبين حالياً. يمكنك إنشاء غرفة جديدة من تبويب «إنشاء غرفة»!
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                      {publicRooms.map((room) => {
                        const course = getCourseById(room.courseId);
                        const modeInfo = GAME_MODE_OPTIONS.find((m) => m.id === room.gameMode);
                        return (
                          <div
                            key={room.roomCode}
                            data-testid={`public-room-card-${room.roomCode}`}
                            className="flex flex-wrap items-center justify-between gap-2 bg-[#0d1e30] border border-[#2a4c6e] rounded-xl px-3 py-2.5"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-black text-sm text-[#ffd13b]">{room.hostName}</span>
                                <span dir="ltr" className="text-xs font-black px-2 py-0.5 rounded bg-[#19334d] text-[#93c5fd]">
                                  {room.roomCode}
                                </span>
                                <span className="text-[11px] font-bold text-[#dbeafe]">
                                  {COURSE_EMBLEM[course.id]} {course.meta.nameAr}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-[11px] font-bold text-[#93c5fd] flex-wrap">
                                <span>{modeInfo?.icon} {modeInfo?.label ?? room.gameMode}</span>
                                <span>·</span>
                                <span>👥 {room.playerCount}/{room.maxPlayers}</span>
                                <span>·</span>
                                <span>{room.fillBots ? 'مع مساعدين 🤖' : 'بشر فقط'}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              data-testid={`join-public-room-${room.roomCode}`}
                              disabled={isBusy}
                              onClick={() => onJoinRoom(room.roomCode)}
                              className="wood-btn-secondary px-4 py-1.5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-55"
                            >
                              دخول
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ONLINE-06/07: Ongoing Spectatable Rooms */}
                {spectatableRooms.length > 0 && (
                  <div className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#38bdf8]/45 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-[#bae6fd]">
                        👁️ غرف جارية للمشاهدة المباشرة ({spectatableRooms.length})
                      </span>
                    </div>
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-0.5">
                      {spectatableRooms.map((room) => {
                        const course = getCourseById(room.courseId);
                        const modeInfo = GAME_MODE_OPTIONS.find((m) => m.id === room.gameMode);
                        return (
                          <div
                            key={room.roomCode}
                            data-testid={`spectatable-room-card-${room.roomCode}`}
                            className="flex flex-wrap items-center justify-between gap-2 bg-[#0d1e30] border border-[#2a4c6e] rounded-xl px-3 py-2"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-black text-sm text-[#ffd13b]">{room.hostName}</span>
                                <span dir="ltr" className="text-xs font-black px-2 py-0.5 rounded bg-[#19334d] text-[#93c5fd]">
                                  {room.roomCode}
                                </span>
                                <span className="text-[11px] font-bold text-[#dbeafe]">
                                  {COURSE_EMBLEM[course.id]} {course.meta.nameAr}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-[11px] font-bold text-[#93c5fd] flex-wrap">
                                <span>{modeInfo?.icon} {modeInfo?.label ?? room.gameMode}</span>
                                <span>·</span>
                                <span>👥 {room.playerCount}/{room.maxPlayers}</span>
                                <span>·</span>
                                <span>👁️ {room.spectatorCount ?? 0} مشاهد</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              data-testid={`spectate-public-room-${room.roomCode}`}
                              disabled={isBusy}
                              onClick={() => onSpectateRoom(room.roomCode)}
                              className="px-3.5 py-1.5 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-black cursor-pointer disabled:opacity-55"
                            >
                              👁️ مشاهدة
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'create' && (
              <div className="space-y-3">
                {/* Course Selection */}
                <div className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e]">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-black text-[#ffd13b]">المسار المبدئي للغرفة</span>
                    <span className="text-[11px] font-bold text-[#93c5fd]">
                      {getCourseById(selectedCourseId).meta.nameAr}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {COURSE_LIST.map((c) => {
                      const isSelected = c.id === selectedCourseId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={isBusy}
                          aria-pressed={isSelected}
                          onClick={() => onSelectCourse(c.id)}
                          className={`text-right px-2.5 py-2 rounded-xl border-2 cursor-pointer transition-colors disabled:opacity-60 ${
                            isSelected
                              ? 'bg-[#193856] border-[#ffd13b] text-white'
                              : 'bg-[#0d1e30] border-[#264666] text-[#cbd5e1] hover:border-[#5282b0]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-sm" aria-hidden="true">{COURSE_EMBLEM[c.id]}</span>
                            <span
                              className="text-[10px] font-black px-1.5 py-0.5 rounded text-[#14222f]"
                              style={{ backgroundColor: c.meta.accentHex }}
                            >
                              {c.meta.difficultyAr}
                            </span>
                          </div>
                          <div className="text-xs font-black text-[#ffd13b] mt-1 truncate">
                            {c.meta.nameAr}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ONLINE-01: Custom Room Settings */}
                <div className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e] space-y-3">
                  <div className="text-xs font-black text-[#ffd13b]">إعدادات الغرفة المخصصة</div>

                  <div>
                    <span className="block text-[11px] font-bold text-[#93c5fd] mb-1">نمط اللعب</span>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                      {GAME_MODE_OPTIONS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onChangeCreateSettings({ ...createSettings, gameMode: m.id })}
                          className={`px-2 py-1.5 rounded-xl text-[11px] font-black border cursor-pointer ${
                            createSettings.gameMode === m.id
                              ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                              : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                          }`}
                        >
                          {m.icon} {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <span className="block text-[11px] font-bold text-[#93c5fd] mb-1">مستوى الصعوبة</span>
                      <div className="flex gap-1">
                        {DIFFICULTY_OPTIONS.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => onChangeCreateSettings({ ...createSettings, difficulty: d.id })}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-black border cursor-pointer ${
                              createSettings.difficulty === d.id
                                ? 'bg-[#38bdf8] text-[#082f49] border-[#bae6fd]'
                                : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="block text-[11px] font-bold text-[#93c5fd] mb-1">الحد الأقصى للاعبين</span>
                      <div className="flex gap-1">
                        {([2, 3, 4] as const).map((cap) => (
                          <button
                            key={cap}
                            type="button"
                            onClick={() => onChangeCreateSettings({ ...createSettings, maxPlayers: cap })}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-black border cursor-pointer ${
                              createSettings.maxPlayers === cap
                                ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                                : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                            }`}
                          >
                            {cap} لاعبين
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="create-time-limit" className="block text-[11px] font-bold text-[#93c5fd] mb-1">
                        حد وقت الجولة
                      </label>
                      <select
                        id="create-time-limit"
                        value={createSettings.roundTimeLimitSec}
                        onChange={(e) =>
                          onChangeCreateSettings({ ...createSettings, roundTimeLimitSec: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg bg-[#19334d] border border-[#39628a] text-xs font-bold text-white"
                      >
                        {TIME_LIMIT_OPTIONS.map((opt) => (
                          <option key={opt.sec} value={opt.sec}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-[#8ac926]">🤖 ذكاء المساعدين:</span>
                      <div className="flex gap-1">
                        {BOT_DIFFICULTY_OPTIONS.map((bd) => (
                          <button
                            key={bd.id}
                            type="button"
                            onClick={() =>
                              onChangeCreateSettings({ ...createSettings, botDifficulty: bd.id })
                            }
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-black border cursor-pointer ${
                              (createSettings.botDifficulty ?? 'normal') === bd.id
                                ? 'bg-[#06d6a0] text-[#06281e] border-[#6ee7b7]'
                                : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                            }`}
                          >
                            {bd.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createSettings.enableItems}
                        onChange={(e) => onChangeCreateSettings({ ...createSettings, enableItems: e.target.checked })}
                        className="w-4 h-4 accent-[#ffd13b]"
                      />
                      <span>تفعيل صناديق الأدوات وعلب الطاقة</span>
                    </label>

                    {/* ONLINE-02: Private Password Room Toggle */}
                    <label className="flex items-center gap-2 text-xs font-bold cursor-pointer text-[#fde047]">
                      <input
                        type="checkbox"
                        data-testid="create-private-checkbox"
                        checked={isPrivateCreate}
                        onChange={(e) => setIsPrivateCreate(e.target.checked)}
                        className="w-4 h-4 accent-[#ffd13b]"
                      />
                      <span>🔒 غرفة خاصة بكلمة مرور</span>
                    </label>
                  </div>

                  {isPrivateCreate && (
                    <div>
                      <label htmlFor="create-room-password" className="block text-xs font-bold text-[#ffd13b] mb-1">
                        كلمة مرور الغرفة (3 أحرف على الأقل)
                      </label>
                      <input
                        id="create-room-password"
                        data-testid="create-room-password"
                        type="password"
                        maxLength={32}
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        placeholder="أدخل كلمة المرور..."
                        className="w-full px-3 py-2 rounded-xl bg-[#19334d] border-2 border-[#39628a] text-white font-bold focus:outline-none focus:border-[#ffd13b]"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    data-testid="create-room-submit-btn"
                    onClick={() =>
                      onCreateRoom({
                        isPrivate: isPrivateCreate,
                        password: isPrivateCreate ? createPassword.trim() : undefined,
                        settings: createSettings,
                      })
                    }
                    disabled={isBusy || !createPasswordValid}
                    aria-busy={isBusy}
                    className="wood-btn-primary w-full py-3 rounded-xl font-black text-base cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                  >
                    {isBusy ? 'جاري الإنشاء...' : isPrivateCreate ? '🔒 أنشئ غرفة خاصة الآن' : '🌐 أنشئ غرفة عامة الآن'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'join' && (
              <div className="bg-[#102438] p-4 rounded-2xl border-2 border-[#2a4c6e] space-y-3">
                <div>
                  <label htmlFor="join-room-code" className="block text-base font-black text-white">
                    انضم برمز الغرفة أو رابط الدعوة
                  </label>
                  <div className="flex gap-2 mt-2">
                    <input
                      id="join-room-code"
                      data-testid="join-room-code"
                      type="text"
                      maxLength={10}
                      value={joinCode}
                      disabled={isBusy}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isBusy && isJoinCodeValid) {
                          onJoinRoom(normalizedJoinCode, needsPasswordInput ? joinPassword : undefined);
                        }
                      }}
                      placeholder="مثال: A4K9M2PX"
                      dir="ltr"
                      className="flex-1 px-3 py-2.5 rounded-xl bg-[#19334d] border-2 border-[#39628a] text-center text-lg tracking-widest font-black text-[#ffd13b] uppercase focus:outline-none focus:border-[#ffd13b] disabled:opacity-60"
                    />
                    <button
                      type="button"
                      data-testid="preview-room-btn"
                      disabled={!isJoinCodeValid || roomPreviewLoading}
                      onClick={() => onPreviewRoom(normalizedJoinCode)}
                      className="px-4 py-2 rounded-xl bg-[#19334d] hover:bg-[#23476b] border-2 border-[#39628a] text-xs font-black cursor-pointer disabled:opacity-50"
                    >
                      {roomPreviewLoading ? '...' : 'معاينة'}
                    </button>
                  </div>
                  {normalizedJoinCode.length > 0 && !isJoinCodeValid && (
                    <p className="mt-1.5 text-[11px] font-bold text-[#ffd166]">
                      يتكون رمز الغرفة من 6 إلى 10 أحرف أو أرقام إنجليزية.
                    </p>
                  )}
                </div>

                {/* Invite / Room Preview Card (ONLINE-03) */}
                {previewMatchesInput && roomPreview && (
                  <div
                    data-testid="join-room-preview"
                    className="bg-[#0d1e30] border-2 border-[#38bdf8]/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-black text-[#ffd13b]">
                        مضيف الغرفة: {roomPreview.hostName} {roomPreview.isPrivate ? '🔒' : '🌐'}
                      </div>
                      <div className="text-[#b8d8f8] font-bold mt-0.5">
                        {COURSE_EMBLEM[roomPreview.courseId]} {getCourseById(roomPreview.courseId).meta.nameAr} ·{' '}
                        {GAME_MODE_OPTIONS.find((m) => m.id === roomPreview.gameMode)?.label ?? roomPreview.gameMode} ·{' '}
                        👥 {roomPreview.playerCount}/{roomPreview.maxPlayers}
                      </div>
                    </div>
                    {roomPreview.isPrivate && (
                      <span className="px-2.5 py-1 rounded-lg bg-[#ffd166]/20 border border-[#ffd166]/60 text-[#fde047] font-black">
                        غرفة خاصة
                      </span>
                    )}
                  </div>
                )}

                {(!previewMatchesInput || !roomPreview) && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-bold text-[#dbeafe] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={needsPasswordInput}
                        onChange={(e) => setManualPasswordToggle(e.target.checked)}
                        className="w-4 h-4 accent-[#ffd13b]"
                      />
                      <span>الغرفة محمية بكلمة مرور</span>
                    </label>
                  </div>
                )}

                {needsPasswordInput && (
                  <div>
                    <label htmlFor="join-room-password" className="block text-xs font-bold text-[#ffd13b] mb-1">
                      كلمة مرور الغرفة
                    </label>
                    <input
                      id="join-room-password"
                      data-testid="join-room-password"
                      type="password"
                      maxLength={32}
                      value={joinPassword}
                      onChange={(e) => setJoinPassword(e.target.value)}
                      placeholder="أدخل كلمة المرور..."
                      className="w-full px-3 py-2 rounded-xl bg-[#19334d] border-2 border-[#39628a] text-white font-bold focus:outline-none focus:border-[#ffd13b]"
                    />
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    data-testid="join-room-submit-btn"
                    onClick={() => onJoinRoom(normalizedJoinCode, needsPasswordInput ? joinPassword : undefined)}
                    disabled={isBusy || !isJoinCodeValid}
                    aria-busy={isBusy}
                    className="wood-btn-primary flex-1 py-3 rounded-xl font-black text-base cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBusy ? 'جاري الدخول...' : 'دخول الغرفة'}
                  </button>
                  <button
                    type="button"
                    data-testid="spectate-room-submit-btn"
                    onClick={() => onSpectateRoom(normalizedJoinCode, needsPasswordInput ? joinPassword : undefined)}
                    disabled={isBusy || !isJoinCodeValid}
                    className="px-4 py-3 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white font-black text-sm cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    👁️ دخول كمشاهد
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Waiting Room */
          <div className="space-y-4">
            {isSpectator && (
              <div
                data-testid="lobby-spectator-banner"
                className="bg-[#0c2942] border-2 border-[#38bdf8] rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-black text-[#bae6fd]"
              >
                👁️ أنت الآن في وضع المشاهد — ستتم ترقيتك تلقائياً إلى مقعد شاغر عند توفره أو مع بداية الجولة التالية.
              </div>
            )}

            {/* Room Code + Privacy Badge + Copy Code + Copy Invite Link (ONLINE-03) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#102438] px-4 py-3 rounded-2xl border-2 border-[#f7d060]/50">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-bold text-[#b8d8f8]">رمز الغرفة:</span>
                <span dir="ltr" data-testid="waiting-room-code" className="text-2xl font-black tracking-widest text-[#ffd13b] tabular-nums">
                  {roomSnapshot.roomCode}
                </span>
                <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-[#19334d] border border-[#39628a] text-[#dbeafe]">
                  {roomSnapshot.isPrivate ? '🔒 خاصة' : '🌐 عامة'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="px-3.5 py-1.5 rounded-xl bg-[#23496d] hover:bg-[#2c5b87] border border-[#f7d060]/40 text-xs font-extrabold cursor-pointer"
                >
                  {copiedCode ? '✓ تم نسخ الرمز!' : 'نسخ الرمز'}
                </button>
                <button
                  type="button"
                  data-testid="copy-invite-link-btn"
                  onClick={handleCopyInviteLink}
                  className="px-3.5 py-1.5 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] border border-[#bae6fd]/40 text-xs font-extrabold text-white cursor-pointer"
                >
                  {copiedLink ? '✓ تم نسخ الرابط!' : '🔗 نسخ رابط الدعوة'}
                </button>
              </div>
            </div>

            {/* Live Room Settings Panel (ONLINE-01) */}
            {(() => {
              const s: RoomSettings = roomSnapshot.settings ?? {
                gameMode: roomSnapshot.sim.gameMode ?? 'standard',
                difficulty: roomSnapshot.sim.difficulty ?? 'normal',
                enableItems: roomSnapshot.sim.enableItems ?? true,
                roundTimeLimitSec: roomSnapshot.sim.roundTimeLimitSec ?? 0,
                maxPlayers: (roomSnapshot.maxPlayers as 2 | 3 | 4) ?? 4,
              };
              const modeObj = GAME_MODE_OPTIONS.find((m) => m.id === s.gameMode);
              const diffObj = DIFFICULTY_OPTIONS.find((d) => d.id === s.difficulty);

              return (
                <div className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black text-[#ffd13b]">إعدادات الجولة</span>
                    {!isHost && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                        <span className="px-2 py-0.5 rounded bg-[#19334d] text-[#ffd13b]">
                          {modeObj?.icon} {modeObj?.label}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#19334d] text-[#38bdf8]">
                          الصعوبة: {diffObj?.label}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#19334d] text-[#06d6a0]">
                          🤖 {BOT_DIFFICULTY_META[s.botDifficulty ?? 'normal'].labelAr}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#19334d] text-[#dbeafe]">
                          الحد: {s.maxPlayers} لاعبين
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#19334d] text-[#06d6a0]">
                          {s.enableItems ? 'صناديق مفعلة' : 'بدون صناديق'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#19334d] text-[#fde047]">
                          الوقت: {s.roundTimeLimitSec > 0 ? `${s.roundTimeLimitSec}ث` : 'مفتوح'}
                        </span>
                      </div>
                    )}
                  </div>

                  {isHost && (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                        {GAME_MODE_OPTIONS.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => onUpdateRoomSettings({ gameMode: m.id })}
                            className={`px-2 py-1.5 rounded-xl text-[11px] font-black border cursor-pointer ${
                              s.gameMode === m.id
                                ? 'bg-[#ffd13b] text-[#14222f] border-[#14222f]'
                                : 'bg-[#19334d] text-[#dbeafe] border-[#39628a]'
                            }`}
                          >
                            {m.icon} {m.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <div className="flex items-center gap-1 bg-[#0b1929] p-1 rounded-xl border border-[#2a4c6e]">
                          {DIFFICULTY_OPTIONS.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => onUpdateRoomSettings({ difficulty: d.id })}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                                s.difficulty === d.id ? 'bg-[#38bdf8] text-[#082f49]' : 'text-[#cbd5e1]'
                              }`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>

                        <div
                          role="group"
                          aria-label="مستوى ذكاء المساعدين"
                          className="flex items-center gap-1 bg-[#0b1929] p-1 rounded-xl border border-[#2a4c6e]"
                        >
                          <span className="text-[10px] font-black text-[#8ac926] px-1">🤖</span>
                          {BOT_DIFFICULTY_OPTIONS.map((bd) => (
                            <button
                              key={bd.id}
                              type="button"
                              data-testid={`lobby-bot-diff-${bd.id}`}
                              onClick={() => onUpdateRoomSettings({ botDifficulty: bd.id })}
                              className={`px-2 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                                (s.botDifficulty ?? 'normal') === bd.id
                                  ? 'bg-[#06d6a0] text-[#06281e]'
                                  : 'text-[#cbd5e1]'
                              }`}
                            >
                              {bd.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1 bg-[#0b1929] p-1 rounded-xl border border-[#2a4c6e]">
                          {([2, 3, 4] as const).map((cap) => (
                            <button
                              key={cap}
                              type="button"
                              onClick={() => onUpdateRoomSettings({ maxPlayers: cap })}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                                s.maxPlayers === cap ? 'bg-[#ffd13b] text-[#14222f]' : 'text-[#cbd5e1]'
                              }`}
                            >
                              {cap} مقاعد
                            </button>
                          ))}
                        </div>

                        <select
                          aria-label="حد وقت الجولة"
                          value={s.roundTimeLimitSec}
                          onChange={(e) => onUpdateRoomSettings({ roundTimeLimitSec: Number(e.target.value) })}
                          className="px-2.5 py-1.5 rounded-xl bg-[#19334d] border border-[#39628a] text-[11px] font-bold text-white"
                        >
                          {TIME_LIMIT_OPTIONS.map((opt) => (
                            <option key={opt.sec} value={opt.sec}>
                              الوقت: {opt.label}
                            </option>
                          ))}
                        </select>

                        <label className="flex items-center gap-1.5 text-[11px] font-bold cursor-pointer bg-[#0b1929] px-2.5 py-1.5 rounded-xl border border-[#2a4c6e]">
                          <input
                            type="checkbox"
                            checked={s.enableItems}
                            onChange={(e) => onUpdateRoomSettings({ enableItems: e.target.checked })}
                            className="w-3.5 h-3.5 accent-[#ffd13b]"
                          />
                          <span>صناديق الأدوات</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Course Selection / Voting Panel */}
            {(() => {
              const activeCourseId: CourseId = roomSnapshot.courseId ?? roomSnapshot.sim.courseId ?? 'tropical';
              const selectionMode: CourseSelectionMode = roomSnapshot.courseSelectionMode ?? 'host';
              const votes = roomSnapshot.courseVotes ?? {};
              const myVote = myPlayerId ? votes[myPlayerId] : undefined;

              const voteCounts: Record<CourseId, number> = {
                tropical: 0,
                volcanic: 0,
                glacial: 0,
                factory: 0,
                storm: 0,
              };
              for (const cid of Object.values(votes)) {
                if (cid in voteCounts) {
                  voteCounts[cid as CourseId] += 1;
                }
              }
              const maxVotes = Math.max(0, ...Object.values(voteCounts));
              const activeCourse = getCourseById(activeCourseId);

              return (
                <div className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-[#ffd13b]">مسار الجولة:</span>
                      <span
                        data-testid="lobby-active-course"
                        className="px-2.5 py-0.5 rounded-lg text-xs font-black text-[#14222f]"
                        style={{ backgroundColor: activeCourse.meta.accentHex }}
                      >
                        {COURSE_EMBLEM[activeCourse.id]} {activeCourse.meta.nameAr}
                      </span>
                    </div>

                    {isHost ? (
                      <div className="flex items-center gap-1 bg-[#0b1929] p-1 rounded-xl border border-[#2a4c6e]">
                        <button
                          type="button"
                          onClick={() => onSelectCourse(activeCourseId, 'host')}
                          aria-pressed={selectionMode === 'host'}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                            selectionMode === 'host'
                              ? 'bg-[#ffd13b] text-[#14222f]'
                              : 'text-[#cbd5e1] hover:text-white'
                          }`}
                        >
                          اختيار المضيف
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectCourse(activeCourseId, 'vote')}
                          aria-pressed={selectionMode === 'vote'}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                            selectionMode === 'vote'
                              ? 'bg-[#ffd13b] text-[#14222f]'
                              : 'text-[#cbd5e1] hover:text-white'
                          }`}
                        >
                          تصويت اللاعبين
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] font-bold text-[#93c5fd]">
                        {selectionMode === 'vote'
                          ? 'التصويت مفتوح — اختر مسارك المفضل!'
                          : 'المضيف يحدد المسار'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {COURSE_LIST.map((c) => {
                      const isActive = activeCourseId === c.id;
                      const count = voteCounts[c.id];
                      const isVotedByMe = myVote === c.id;
                      const isLeader = selectionMode === 'vote' && maxVotes > 0 && count === maxVotes;
                      const canClick = !isSpectator && (selectionMode === 'vote' || isHost);

                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!canClick}
                          data-lobby-course={c.id}
                          aria-pressed={selectionMode === 'vote' ? isVotedByMe : isActive}
                          onClick={() => {
                            if (selectionMode === 'vote') {
                              onVoteCourse(c.id);
                            } else if (isHost) {
                              onSelectCourse(c.id, 'host');
                            }
                          }}
                          className={`text-right p-2.5 rounded-xl border-2 flex flex-col justify-between gap-1 transition-colors ${
                            canClick ? 'cursor-pointer' : 'cursor-default opacity-90'
                          } ${
                            isActive
                              ? 'bg-[#193856] border-[#ffd13b] text-white'
                              : 'bg-[#0d1e30] border-[#264666] text-[#cbd5e1] hover:border-[#5282b0]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-sm" aria-hidden="true">{COURSE_EMBLEM[c.id]}</span>
                            <span
                              className="text-[10px] font-black px-1.5 py-0.5 rounded text-[#14222f]"
                              style={{ backgroundColor: c.meta.accentHex }}
                            >
                              {c.meta.difficultyAr}
                            </span>
                          </div>
                          <div className="text-xs font-black text-[#ffd13b] truncate">
                            {c.meta.nameAr}
                          </div>
                          <div className="text-[10px] font-bold text-[#93c5fd] line-clamp-1">
                            {c.meta.hazardSummaryAr}
                          </div>
                          {selectionMode === 'vote' && (
                            <div className="flex items-center justify-between gap-1 mt-0.5 pt-1 border-t border-[#264666] text-[10px] font-black">
                              <span className={isLeader ? 'text-[#06d6a0]' : 'text-[#cbd5e1]'}>
                                {count} صوت{isLeader ? ' · متصدر' : ''}
                              </span>
                              {isVotedByMe && <span className="text-[#ffd13b]">تصويتك ✓</span>}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* 4 Raft Seats (respecting maxPlayers cap) */}
            {(() => {
              const effectiveMax = roomSnapshot.maxPlayers ?? roomSnapshot.settings?.maxPlayers ?? 4;
              const configuredPersonalities = roomSnapshot.settings?.botPersonalities ?? {};
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {roomSnapshot.sim.players.map((p, idx) => {
                    const slotIdx = idx as 0 | 1 | 2 | 3;
                    const preset = CHARACTER_PRESETS[idx];
                    const zone = PLAYER_ZONES[idx];
                    const isMe = p.id === myPlayerId;
                    const isLockedByCap = idx >= effectiveMax;
                    const seatStatus: SeatStatus =
                      roomSnapshot.seats?.[idx] ??
                      p.seatStatus ??
                      (p.isBot ? 'BOT' : p.connected ? 'CONNECTED' : 'EMPTY');
                    const isHumanOccupied = seatStatus === 'CONNECTED' || seatStatus === 'RECONNECTING';
                    const isActiveSlot = !isLockedByCap && (seatStatus === 'CONNECTED' || seatStatus === 'BOT');
                    const personality: BotPersonality =
                      p.botPersonality ??
                      configuredPersonalities[slotIdx] ??
                      getDefaultBotPersonality(slotIdx);
                    const pMeta = BOT_PERSONALITY_META[personality];
                    const cyclePersonality = () => {
                      const nextIdx = (BOT_PERSONALITY_ORDER.indexOf(personality) + 1) % BOT_PERSONALITY_ORDER.length;
                      const nextPersonality = BOT_PERSONALITY_ORDER[nextIdx];
                      onUpdateRoomSettings({
                        botPersonalities: {
                          ...configuredPersonalities,
                          [slotIdx]: nextPersonality,
                        },
                      });
                    };

                    return (
                      <div
                        key={idx}
                        data-seat-status={isLockedByCap ? 'LOCKED' : seatStatus}
                        className={`p-3 rounded-2xl border-2 flex flex-col justify-between gap-2 ${
                          isLockedByCap
                            ? 'bg-[#091420] border-[#1c2f44] opacity-45'
                            : seatStatus === 'RECONNECTING'
                              ? 'bg-[#2a2210] border-[#ffd166]/60'
                              : isActiveSlot
                                ? 'bg-[#17334f] border-[#4d84b8]'
                                : 'bg-[#0e2033] border-[#233d59] opacity-70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black shrink-0"
                            style={{
                              backgroundColor:
                                COSMETIC_COLOR_DEFS[p.cosmetic.colorIndex % COSMETIC_COLOR_DEFS.length]
                                  ?.bodyHex ?? '#ff595e',
                            }}
                          />
                          <span className="text-[11px] font-bold text-[#93c5fd]">
                            {zone.label}{isMe ? ' · أنت' : ''}
                          </span>
                        </div>
                        <div>
                          <div className="font-black text-sm truncate">
                            {isLockedByCap ? 'مقعد مغلق' : isHumanOccupied ? p.name : preset.name}
                          </div>
                          <div className="text-xs font-bold mt-0.5 space-y-1">
                            {isLockedByCap ? (
                              <span className="text-slate-500">🔒 الحد {effectiveMax} لاعبين</span>
                            ) : seatStatus === 'EMPTY' ? (
                              <span className="text-slate-400">مقعد فارغ</span>
                            ) : seatStatus === 'BOT' ? (
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="text-[#8ac926]">
                                  {pMeta.badgeIcon} {pMeta.labelAr}
                                </span>
                                {isHost && (
                                  <button
                                    type="button"
                                    data-testid={`seat-bot-personality-${idx}`}
                                    onClick={cyclePersonality}
                                    title={pMeta.descriptionAr}
                                    className="px-1.5 py-0.5 rounded bg-[#0b1929] hover:bg-[#19334d] border border-[#2a4c6e] text-[10px] font-black text-[#bae6fd] cursor-pointer"
                                  >
                                    تبديل الأسلوب
                                  </button>
                                )}
                              </div>
                            ) : seatStatus === 'RECONNECTING' ? (
                              <span className="text-[#ffd166]">
                                {p.tempBotSubstitute
                                  ? '🤖 بديل آلي مؤقت حتى عودة اللاعب'
                                  : `جاري إعادة الاتصال…${p.ready ? ' (جاهز)' : ' (غير جاهز)'}`}
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
              );
            })()}

            {/* ONLINE-08: Playlist Queue Builder */}
            {(() => {
              const queue = roomSnapshot.playlistQueue ?? [];
              const activeCourseId: CourseId = roomSnapshot.courseId ?? roomSnapshot.sim.courseId ?? 'tropical';
              const s = roomSnapshot.settings;
              const addCurrentToQueue = () => {
                if (queue.length >= 8) return;
                const nextItem: PlaylistItem = {
                  id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  courseId: activeCourseId,
                  gameMode: s?.gameMode ?? 'standard',
                  difficulty: s?.difficulty ?? 'normal',
                };
                onSetPlaylist([...queue, nextItem]);
              };
              if (!isHost && queue.length === 0) return null;
              return (
                <div
                  data-testid="lobby-playlist-panel"
                  className="bg-[#102438] p-3.5 rounded-2xl border-2 border-[#2a4c6e] space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black text-[#ffd13b]">
                      📋 قائمة الجولات القادمة ({queue.length}/8)
                    </span>
                    {isHost && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          data-testid="playlist-add-btn"
                          disabled={queue.length >= 8}
                          onClick={addCurrentToQueue}
                          className="px-2.5 py-1 rounded-lg bg-[#19334d] hover:bg-[#23476b] border border-[#38bdf8]/60 text-[11px] font-black text-[#bae6fd] cursor-pointer disabled:opacity-45"
                        >
                          ➕ أضف المسار الحالي
                        </button>
                        {queue.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onSetPlaylist([])}
                            className="px-2.5 py-1 rounded-lg bg-[#ff595e]/20 hover:bg-[#ff595e]/35 text-[11px] font-black text-[#fecaca] cursor-pointer"
                          >
                            إفراغ
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {queue.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {queue.map((item, idx) => {
                        const c = getCourseById(item.courseId);
                        const m = GAME_MODE_OPTIONS.find((opt) => opt.id === item.gameMode);
                        return (
                          <div
                            key={item.id}
                            className="flex items-center gap-1.5 bg-[#0b1929] border border-[#2a4c6e] rounded-xl px-2.5 py-1 text-[11px] font-bold"
                          >
                            <span className="text-[#ffd13b] tabular-nums">{idx + 1}.</span>
                            <span>{COURSE_EMBLEM[c.id]} {c.meta.nameAr}</span>
                            <span className="text-[#93c5fd]">· {m?.label ?? item.gameMode}</span>
                            {isHost && (
                              <button
                                type="button"
                                aria-label={`حذف ${c.meta.nameAr} من القائمة`}
                                onClick={() => onSetPlaylist(queue.filter((_, qIdx) => qIdx !== idx))}
                                className="text-[#ff8589] hover:text-white font-black px-1 cursor-pointer"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Spectators Roster (ONLINE-06/07) */}
            {(roomSnapshot.spectators?.length ?? 0) > 0 && (
              <div className="bg-[#0e2033] border border-[#2a4c6e] rounded-xl px-3 py-2 text-xs font-bold text-[#bae6fd] flex flex-wrap items-center gap-2">
                <span>👁️ المشاهدون ({roomSnapshot.spectators!.length}):</span>
                {roomSnapshot.spectators!.map((sp) => (
                  <span key={sp.id} className="text-white">
                    {sp.name}
                  </span>
                ))}
              </div>
            )}

            {/* ONLINE-10 & ONLINE-11: Room Social Emotes + Chat */}
            <div className="space-y-2.5">
              <div className="bg-[#102438] border-2 border-[#2a4c6e] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-black text-[#ffd13b]">حركات وتعبيرات الفريق</span>
                <EmoteBar onTriggerEmote={onTriggerEmote} compact />
              </div>
              <ChatPanel
                title="دردشة الغرفة"
                messages={roomChatMessages}
                onSendChat={onSendRoomChat}
                compact
                maxHeightClass="max-h-28"
                testIdPrefix="lobby-chat"
              />
            </div>

            {/* Host / Player Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-3">
                {!isHost && !isSpectator && me && (
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
              ) : isSpectator ? (
                <span className="text-sm font-bold text-[#93c5fd]">
                  تنتظر بدء الجولة كمشاهد — سيتم إشراكك فور توفر مقعد
                </span>
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
