import type {
  PlayerCosmetic,
  PlayerRole,
  RoomLifecycleState,
  SimEvent,
  WorldSimulationState,
} from '../../../src/shared/types.ts';

export const MAX_PLAYERS = 4;
export const RECONNECT_GRACE_MS = 15_000;
export const ROOM_EMPTY_CLOSE_MS = 30_000;
export const ROOM_MAX_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours max room lifetime
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const CURRENT_SCHEMA_VERSION = 2;
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
  slot: 0 | 1 | 2 | 3;
  role: PlayerRole;
  name: string;
  cosmetic: PlayerCosmetic;
  resumeTokenHash: string;
  sessionId: string;
  connectionEpoch: number;
  connected: boolean;
  ready: boolean;
  revoked: boolean;
  lastSeenAt: number;
  expiresAt: number;
  lastInputSeq: number;
}

export interface RoomRecord {
  roomCode: string;
  lifecycleState: RoomLifecycleState;
  hostId: string;
  fillBots: boolean;
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
  sessions: Map<string, PlayerSessionRecord>;
}

export interface SocketAttachment {
  authenticated: boolean;
  playerId: string | null;
  sessionId: string | null;
  connectionEpoch: number;
  authAttempts?: number;
}

export interface SocketBinding extends SocketAttachment {
  ws: WebSocket;
}
