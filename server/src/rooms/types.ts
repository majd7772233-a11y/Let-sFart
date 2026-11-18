import type {
  ChatMessage,
  CourseId,
  CourseSelectionMode,
  PlayerCosmetic,
  PlayerRole,
  PlaylistItem,
  ReplayEventEntry,
  ReplayKeyframe,
  RoomLifecycleState,
  RoomSettings,
  SimEvent,
  WorldSimulationState,
} from '../../../src/shared/types.ts';
import type { SeatSlotOrSpectator } from '../../../src/shared/protocol.ts';

export const MAX_PLAYERS = 4;
export const MAX_SPECTATORS = 12;
export const RECONNECT_GRACE_MS = 15_000;
export const BOT_SUBSTITUTE_DELAY_MS = 6_000;
export const ROOM_EMPTY_CLOSE_MS = 30_000;
export const ROOM_MAX_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours max room lifetime
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const CURRENT_SCHEMA_VERSION = 5;
export const MAX_WS_AUTH_ATTEMPTS = 3;

export interface SqlCursor<T = Record<string, unknown>> {
  toArray(): T[];
  one(): T;
}

export interface SqlStorageAdapter {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursor<T>;
  transactionSync?<T>(fn: () => T): T;
}

export type SeatKind = 'EMPTY' | 'HUMAN_CONNECTED' | 'HUMAN_DISCONNECTED_GRACE' | 'BOT';

export interface PlayerSessionRecord {
  playerId: string;
  roomCode: string;
  slot: SeatSlotOrSpectator;
  role: PlayerRole;
  name: string;
  cosmetic: PlayerCosmetic;
  resumeTokenHash: string;
  sessionId: string;
  connectionEpoch: number;
  connected: boolean;
  ready: boolean;
  revoked: boolean;
  joinedAt: number;
  lastSeenAt: number;
  expiresAt: number;
  lastInputSeq: number;
  accountId?: string;
  playerLevel?: number;
}

export interface RoomRecord {
  roomCode: string;
  lifecycleState: RoomLifecycleState;
  roundSeq?: number;
  hostId: string;
  fillBots: boolean;
  isPrivate: boolean;
  passwordHash: string | null;
  settings: RoomSettings;
  courseId: CourseId;
  courseSelectionMode: CourseSelectionMode;
  courseVotes: Record<string, CourseId>;
  playlistQueue: PlaylistItem[];
  recentChat: ChatMessage[];
  emoteSeq: number;
  idempotencyKey: string | null;
  createdAt: number;
  updatedAt?: number;
  expiresAt: number;
  emptySinceMs: number | null;
  snapshotSeq: number;
  accumulatorSec: number;
  lastPersistedAtMs?: number;
  sim: WorldSimulationState;
  recentEvents: SimEvent[];
  replayFrames?: ReplayKeyframe[];
  replayEvents?: ReplayEventEntry[];
  nextReplaySampleElapsed?: number;
  sessions: Map<string, PlayerSessionRecord>;
}

export interface SocketAttachment {
  authenticated: boolean;
  playerId: string | null;
  sessionId: string | null;
  connectionEpoch: number;
  authAttempts?: number;
  kind?: 'room' | 'party';
}

export interface SocketBinding extends SocketAttachment {
  ws: WebSocket;
}
