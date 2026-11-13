import type {
  PlayerCosmetic,
  PlayerRole,
  RoomLifecycleState,
  RoomSnapshot,
  SimEvent,
} from './types.ts';

export const PROTOCOL_VERSION = 1 as const;
export const MAX_WS_MESSAGE_BYTES = 4096;

export type ProtocolErrorCode =
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'INVALID_MESSAGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REPLACED'
  | 'SESSION_ALREADY_ACTIVE'
  | 'FORBIDDEN_HOST_ONLY'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_EXISTS'
  | 'INVALID_LIFECYCLE_STATE'
  | 'PLAYERS_NOT_READY'
  | 'STALE_INPUT_SEQ'
  | 'INVALID_ROOM_CODE'
  | 'FORBIDDEN_ORIGIN'
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
  idempotencyKey?: string;
}

export interface JoinRoomHttpRequest {
  name: string;
  cosmetic: PlayerCosmetic;
  idempotencyKey?: string;
}

export interface RoomSessionCredentials {
  roomCode: string;
  playerId: string;
  resumeToken: string;
  sessionId: string;
  connectionEpoch: number;
  role: PlayerRole;
  slot: 0 | 1 | 2 | 3;
  snapshot: RoomSnapshot;
}

export interface RoomPublicInfoResponse {
  roomCode: string;
  lifecycleState: RoomLifecycleState;
  playerCount: number;
  maxPlayers: number;
  fillBots: boolean;
  createdAt: number;
  expiresAt: number;
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
  protocolVersion: typeof PROTOCOL_VERSION;
  environment: string;
  timestamp: number;
}

// ==========================================
// Client -> Server WebSocket Payloads
// ==========================================

export interface SessionAuthenticatePayload {
  playerId: string;
  resumeToken: string;
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

export interface InputStatePayload {
  moveDir: -1 | 0 | 1;
  farting: boolean;
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
  | ProtocolEnvelope<'room:start', Record<string, never>>
  | ProtocolEnvelope<'room:restart', Record<string, never>>
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
  slot: 0 | 1 | 2 | 3;
}

export interface RoomJoinedPayload {
  roomCode: string;
  playerId: string;
  sessionId: string;
  connectionEpoch: number;
  role: PlayerRole;
  slot: 0 | 1 | 2 | 3;
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
  | ProtocolEnvelope<'room:error', RoomErrorPayload>
  | ProtocolEnvelope<'pong', PongPayload>;

export function makeEnvelope<T extends string, P>(
  type: T,
  payload: P,
  requestId?: string,
): ProtocolEnvelope<T, P> {
  return requestId !== undefined
    ? { version: PROTOCOL_VERSION, requestId, type, payload }
    : { version: PROTOCOL_VERSION, type, payload };
}
