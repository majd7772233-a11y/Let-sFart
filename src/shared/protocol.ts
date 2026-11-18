import type {
  AccountProfile,
  AchievementDef,
  BalanceAnalyticsResponse,
  ChatMessage,
  CourseId,
  CourseSelectionMode,
  EmoteId,
  FriendSummary,
  GameDifficulty,
  GameMode,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardScope,
  MatchSummaryInput,
  PartyState,
  PlayerCareerStats,
  PlayerCosmetic,
  PlayerRole,
  PlaylistItem,
  QuestState,
  RareEventState,
  RoomLifecycleState,
  RoomSettings,
  RoomSnapshot,
  RoundReplayRecord,
  RoundReplaySummary,
  SeasonProgressState,
  ServerHealthSnapshot,
  SimEvent,
  UnlockedAchievement,
} from './types.ts';

export const GAME_VERSION = '2.7.0' as const;
export const PROTOCOL_VERSION = 1 as const;
export const MIN_COMPATIBLE_PROTOCOL_VERSION = 1 as const;
export const MAX_WS_MESSAGE_BYTES = 4096;

export type SeatSlotOrSpectator = 0 | 1 | 2 | 3 | -1;
export type SpectateJoinMode = 'auto' | 'only' | 'never';

export type ProtocolErrorCode =
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'PROTOCOL_MISMATCH'
  | 'RESULT_VERIFICATION_FAILED'
  | 'INVALID_MESSAGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REPLACED'
  | 'SESSION_ALREADY_ACTIVE'
  | 'FORBIDDEN_HOST_ONLY'
  | 'SPECTATOR_FORBIDDEN'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_EXISTS'
  | 'PARTY_NOT_FOUND'
  | 'PARTY_FULL'
  | 'INVALID_LIFECYCLE_STATE'
  | 'PLAYERS_NOT_READY'
  | 'STALE_INPUT_SEQ'
  | 'INVALID_ROOM_CODE'
  | 'INVALID_PASSWORD'
  | 'NO_PUBLIC_ROOMS_AVAILABLE'
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_NOT_FOUND'
  | 'ALREADY_LINKED'
  | 'FORBIDDEN_ORIGIN'
  | 'INSUFFICIENT_COINS'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_ALREADY_OWNED'
  | 'ITEM_NOT_OWNED'
  | 'QUEST_NOT_READY'
  | 'ALREADY_CLAIMED'
  | 'INTERNAL_ERROR';

export interface ProtocolEnvelope<T extends string = string, P = unknown> {
  version: typeof PROTOCOL_VERSION;
  requestId?: string;
  type: T;
  payload?: P;
}

// ==========================================
// HTTP Room Discovery / Creation / Join APIs
// ==========================================

export interface CreateRoomHttpRequest {
  name: string;
  cosmetic: PlayerCosmetic;
  courseId?: CourseId;
  idempotencyKey?: string;
  isPrivate?: boolean;
  password?: string;
  settings?: Partial<RoomSettings>;
  accountToken?: string;
  protocolVersion?: number;
  clientVersion?: string;
}

export interface JoinRoomHttpRequest {
  name: string;
  cosmetic: PlayerCosmetic;
  idempotencyKey?: string;
  password?: string;
  spectate?: SpectateJoinMode;
  accountToken?: string;
  protocolVersion?: number;
  clientVersion?: string;
}

export interface RoomSessionCredentials {
  roomCode: string;
  playerId: string;
  resumeToken: string;
  sessionId: string;
  connectionEpoch: number;
  role: PlayerRole;
  slot: SeatSlotOrSpectator;
  snapshot: RoomSnapshot;
}

export interface RoomPublicInfoResponse {
  roomCode: string;
  hostName: string;
  lifecycleState: RoomLifecycleState;
  playerCount: number;
  maxPlayers: number;
  spectatorCount?: number;
  fillBots: boolean;
  isPrivate: boolean;
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  enableItems: boolean;
  roundTimeLimitSec: number;
  settings: RoomSettings;
  createdAt: number;
  expiresAt: number;
}

export interface PublicRoomListingItem {
  roomCode: string;
  hostName: string;
  lifecycleState: RoomLifecycleState;
  playerCount: number;
  maxPlayers: number;
  spectatorCount?: number;
  fillBots: boolean;
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  enableItems: boolean;
  roundTimeLimitSec: number;
  createdAt: number;
  expiresAt: number;
}

export interface PublicRoomsListResponse {
  rooms: PublicRoomListingItem[];
  spectatableRooms?: PublicRoomListingItem[];
  total: number;
  timestamp: number;
}

export interface QuickMatchHttpRequest {
  name: string;
  cosmetic: PlayerCosmetic;
  preferredGameMode?: GameMode;
  preferredCourseId?: CourseId;
  accountToken?: string;
  protocolVersion?: number;
  clientVersion?: string;
}

export interface HttpErrorResponse {
  error: {
    code: ProtocolErrorCode;
    message: string;
  };
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  runtime: string;
  gameVersion: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  minCompatibleProtocolVersion: number;
  environment: string;
  timestamp: number;
}

// ==========================================
// Client -> Server WebSocket Payloads
// ==========================================

export interface SessionAuthenticatePayload {
  playerId: string;
  resumeToken: string;
  protocolVersion?: number;
  clientVersion?: string;
}

export interface RoomReadyPayload {
  ready: boolean;
}

export interface RoomCosmeticPayload {
  cosmetic: PlayerCosmetic;
}

export interface RoomToggleBotsPayload {
  fillBots: boolean;
}

export interface RoomSelectCoursePayload {
  courseId: CourseId;
  courseSelectionMode?: CourseSelectionMode;
}

export interface RoomVoteCoursePayload {
  courseId: CourseId;
}

export interface RoomUpdateSettingsPayload {
  settings: Partial<RoomSettings>;
}

export interface RoomSetPlaylistPayload {
  playlist: PlaylistItem[];
}

export type NextRoundAction = 'replay' | 'next' | 'lobby' | 'course';

export interface RoomNextRoundPayload {
  action: NextRoundAction;
  courseId?: CourseId;
  settings?: Partial<RoomSettings>;
  immediate?: boolean;
}

export interface ChatSendPayload {
  text?: string;
  presetId?: string;
}

export interface EmoteTriggerPayload {
  emoteId: EmoteId;
}

export interface InputStatePayload {
  moveDir: -1 | 0 | 1;
  farting: boolean;
  anchor?: boolean;
  useItem?: boolean;
  seq: number;
}

export interface PingPayload {
  clientTime?: number;
}

export interface GameResyncPayload {
  lastEventId?: number;
  lastSnapshotSeq?: number;
}

export type ClientProtocolMessage =
  | ProtocolEnvelope<'session:authenticate', SessionAuthenticatePayload>
  | ProtocolEnvelope<'room:leave', Record<string, never>>
  | ProtocolEnvelope<'room:ready', RoomReadyPayload>
  | ProtocolEnvelope<'room:cosmetic', RoomCosmeticPayload>
  | ProtocolEnvelope<'room:toggleBots', RoomToggleBotsPayload>
  | ProtocolEnvelope<'room:selectCourse', RoomSelectCoursePayload>
  | ProtocolEnvelope<'room:voteCourse', RoomVoteCoursePayload>
  | ProtocolEnvelope<'room:updateSettings', RoomUpdateSettingsPayload>
  | ProtocolEnvelope<'room:setPlaylist', RoomSetPlaylistPayload>
  | ProtocolEnvelope<'room:nextRound', RoomNextRoundPayload>
  | ProtocolEnvelope<'room:start', Record<string, never>>
  | ProtocolEnvelope<'room:restart', Record<string, never>>
  | ProtocolEnvelope<'chat:send', ChatSendPayload>
  | ProtocolEnvelope<'emote:trigger', EmoteTriggerPayload>
  | ProtocolEnvelope<'game:resync', GameResyncPayload>
  | ProtocolEnvelope<'input:state', InputStatePayload>
  | ProtocolEnvelope<'ping', PingPayload>;

// ==========================================
// Server -> Client WebSocket Payloads
// ==========================================

export interface SessionRenewedPayload {
  roomCode: string;
  playerId: string;
  sessionId: string;
  resumeToken: string;
  connectionEpoch: number;
  role: PlayerRole;
  slot: SeatSlotOrSpectator;
}

export interface RoomJoinedPayload {
  roomCode: string;
  playerId: string;
  sessionId: string;
  connectionEpoch: number;
  role: PlayerRole;
  slot: SeatSlotOrSpectator;
  snapshot: RoomSnapshot;
}

export interface RoomStatePayload {
  snapshot: RoomSnapshot;
}

export interface GameSnapshotPayload {
  snapshot: RoomSnapshot;
}

export interface GameEventPayload {
  events: SimEvent[];
}

export interface ChatMessageBroadcastPayload {
  message: ChatMessage;
}

export interface GameEmoteBroadcastPayload {
  playerId: string;
  slot: SeatSlotOrSpectator;
  name: string;
  emoteId: EmoteId;
  colorIndex: number;
  durationMs: number;
  serverTime: number;
}

export interface RoomErrorPayload {
  code: ProtocolErrorCode;
  message: string;
  command?: string;
}

export interface PongPayload {
  serverTime: number;
  clientTime?: number;
}

export type ServerProtocolMessage =
  | ProtocolEnvelope<'session:renewed', SessionRenewedPayload>
  | ProtocolEnvelope<'room:joined', RoomJoinedPayload>
  | ProtocolEnvelope<'room:state', RoomStatePayload>
  | ProtocolEnvelope<'game:snapshot', GameSnapshotPayload>
  | ProtocolEnvelope<'game:event', GameEventPayload>
  | ProtocolEnvelope<'chat:message', ChatMessageBroadcastPayload>
  | ProtocolEnvelope<'game:emote', GameEmoteBroadcastPayload>
  | ProtocolEnvelope<'room:error', RoomErrorPayload>
  | ProtocolEnvelope<'pong', PongPayload>;

// ==========================================
// ONLINE-09: Persistent Party Protocol
// ==========================================

export interface CreatePartyHttpRequest {
  name: string;
  cosmetic: PlayerCosmetic;
}

export interface JoinPartyHttpRequest {
  name: string;
  cosmetic: PlayerCosmetic;
}

export interface PartySessionCredentials {
  partyCode: string;
  memberId: string;
  resumeToken: string;
  sessionId: string;
  connectionEpoch: number;
  isLeader: boolean;
  party: PartyState;
}

export type PartyClientMessage =
  | ProtocolEnvelope<'party:authenticate', { memberId: string; resumeToken: string }>
  | ProtocolEnvelope<'party:cosmetic', { name?: string; cosmetic: PlayerCosmetic }>
  | ProtocolEnvelope<'party:chat', { text?: string; presetId?: string }>
  | ProtocolEnvelope<'party:setRoom', { roomCode: string | null; password?: string }>
  | ProtocolEnvelope<'party:kick', { targetMemberId: string }>
  | ProtocolEnvelope<'party:leave', Record<string, never>>
  | ProtocolEnvelope<'party:ping', { clientTime?: number }>;

export type PartyServerMessage =
  | ProtocolEnvelope<
      'party:renewed',
      {
        partyCode: string;
        memberId: string;
        sessionId: string;
        resumeToken: string;
        connectionEpoch: number;
        isLeader: boolean;
      }
    >
  | ProtocolEnvelope<'party:state', { party: PartyState }>
  | ProtocolEnvelope<'party:chat', { message: ChatMessage }>
  | ProtocolEnvelope<
      'party:followRoom',
      {
        partyCode: string;
        leaderId: string;
        roomCode: string | null;
        password?: string;
        followSeq: number;
      }
    >
  | ProtocolEnvelope<'party:error', RoomErrorPayload>
  | ProtocolEnvelope<'party:pong', PongPayload>;

export function makeEnvelope<T extends string, P>(
  type: T,
  payload: P,
  requestId?: string,
): ProtocolEnvelope<T, P> {
  return requestId !== undefined
    ? { version: PROTOCOL_VERSION, requestId, type, payload }
    : { version: PROTOCOL_VERSION, type, payload };
}

// ==========================================
// PROG-01..05: Accounts, Profiles, Stats & Leaderboards HTTP APIs
// ==========================================

export interface GuestAuthHttpRequest {
  displayName?: string;
  cosmetic?: PlayerCosmetic;
}

export interface RegisterHttpRequest {
  username: string;
  password: string;
  displayName?: string;
  cosmetic?: PlayerCosmetic;
}

export interface LoginHttpRequest {
  username: string;
  password: string;
}

export interface LinkAccountHttpRequest {
  username: string;
  password: string;
  displayName?: string;
}

export interface UpdateProfileHttpRequest {
  displayName?: string;
  cosmetic?: PlayerCosmetic;
}

export interface ProfileSnapshotPayload {
  profile: AccountProfile;
  stats: PlayerCareerStats;
  achievements: UnlockedAchievement[];
  friends: FriendSummary[];
  ownedItemIds: string[];
  quests: QuestState[];
  season: SeasonProgressState;
  rareEvent: RareEventState;
}

export interface AuthHttpResponse extends ProfileSnapshotPayload {
  token: string;
  expiresAt: number;
}

export interface RecordMatchHttpResponse extends ProfileSnapshotPayload {
  xpEarned: number;
  roundXp: number;
  achievementXp: number;
  coinsEarned: number;
  leveledUp: boolean;
  previousLevel: number;
  newlyUnlocked: AchievementDef[];
  questProgressCount: number;
  completedQuests: QuestState[];
  rareEventTriggered: boolean;
  rareEventBonusCoins: number;
  newlyUnlockedTierItems: string[];
  alreadyRecorded: boolean;
}

export interface BatchOnlineMatchParticipant {
  accountId: string;
  match: MatchSummaryInput;
}

export interface LeaderboardHttpResponse {
  metric: LeaderboardMetric;
  scope: LeaderboardScope;
  courseId: CourseId | 'all';
  weekKey: string;
  entries: LeaderboardEntry[];
  selfEntry: LeaderboardEntry | null;
  total: number;
  timestamp: number;
}

export interface AddFriendHttpRequest {
  username: string;
}

export interface FriendsHttpResponse {
  friends: FriendSummary[];
}

export interface BuyCosmeticHttpRequest {
  itemId: string;
  equip?: boolean;
}

export interface BuyCosmeticHttpResponse extends ProfileSnapshotPayload {
  purchasedItemId: string;
  coinsSpent: number;
}

export interface EquipCosmeticHttpRequest {
  cosmetic: PlayerCosmetic;
}

export interface ClaimQuestHttpResponse extends ProfileSnapshotPayload {
  claimedQuestId: string;
  xpEarned: number;
  coinsEarned: number;
  seasonPointsEarned: number;
  leveledUp: boolean;
  unlockedItemIds: string[];
}

export interface ClaimSeasonTierHttpResponse extends ProfileSnapshotPayload {
  claimedTier: number;
  xpEarned: number;
  coinsEarned: number;
  leveledUp: boolean;
  unlockedItemIds: string[];
}

// ==========================================
// TECH-04..07: Replays, Ops Monitoring & Analytics HTTP APIs
// ==========================================

export interface SaveReplayHttpRequest {
  replay: RoundReplayRecord;
}

export interface SaveReplayHttpResponse {
  ok: boolean;
  matchId: string;
  frameCount: number;
  createdAt: number;
}

export interface ReplayListHttpResponse {
  replays: RoundReplaySummary[];
  total: number;
  timestamp: number;
}

export interface ReplayDetailHttpResponse {
  replay: RoundReplayRecord;
}

export type OpsStatusHttpResponse = ServerHealthSnapshot;
export type OpsAnalyticsHttpResponse = BalanceAnalyticsResponse;


