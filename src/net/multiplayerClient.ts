import {
  GAME_VERSION,
  makeEnvelope,
  PROTOCOL_VERSION,
  type GameEmoteBroadcastPayload,
  type HttpErrorResponse,
  type NextRoundAction,
  type ProtocolEnvelope,
  type PublicRoomsListResponse,
  type QuickMatchHttpRequest,
  type RoomPublicInfoResponse,
  type RoomSessionCredentials,
  type SeatSlotOrSpectator,
  type ServerProtocolMessage,
  type SpectateJoinMode,
} from '../shared/protocol.ts';
import type {
  ChatMessage,
  ConnectionStatus,
  CourseId,
  CourseSelectionMode,
  EmoteId,
  PlayerCosmetic,
  PlayerRole,
  PlaylistItem,
  RoomSettings,
  RoomSnapshot,
  SimEvent,
} from '../shared/types.ts';

export interface MultiplayerCallbacks {
  onJoined: (data: {
    roomCode: string;
    playerId: string;
    slot: SeatSlotOrSpectator;
    role: PlayerRole;
    snapshot: RoomSnapshot;
  }) => void;
  onPromoted?: (data: {
    slot: 0 | 1 | 2 | 3;
    role: PlayerRole;
    snapshot: RoomSnapshot;
  }) => void;
  onState: (snapshot: RoomSnapshot) => void;
  onEvents?: (events: SimEvent[]) => void;
  onChatMessage?: (message: ChatMessage) => void;
  onEmote?: (emote: GameEmoteBroadcastPayload) => void;
  onError: (message: string, code?: string) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}

const INPUT_KEEPALIVE_MS = 850;
const MAX_RECONNECT_ATTEMPTS = 7;
const RESYNC_THROTTLE_MS = 1500;

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const params = new URLSearchParams(window.location.search);
  if (params.get('remote') === '1') return false;
  return import.meta.env?.DEV === true && (host === 'localhost' || host === '127.0.0.1');
}

function getApiBaseUrl(): string {
  if (isLocalDevHost()) return '';
  const configured = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim();
  return configured ? configured.replace(/\/+$/, '') : '';
}

function getWsBaseUrl(): string {
  if (isLocalDevHost()) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  const configuredWs = (import.meta.env?.VITE_WS_BASE_URL as string | undefined)?.trim();
  if (configuredWs) return configuredWs.replace(/\/+$/, '');

  const configuredApi = getApiBaseUrl();
  if (configuredApi) {
    return configuredApi.replace(/^http/i, 'ws');
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private callbacks: MultiplayerCallbacks;
  private lastInputKey = '';
  private currentMoveDir: -1 | 0 | 1 = 0;
  private currentFarting = false;
  private currentAnchor = false;
  private seq = 0;
  private requestCounter = 0;

  private lastSnapshotSeq = 0;
  private lastEventId = 0;
  private lastResyncRequestAtMs = 0;
  private lastLatencyMs = 0;

  private pingTimer: number | null = null;
  private inputKeepaliveTimer: number | null = null;
  private reconnectTimer: number | null = null;

  private roomCode: string | null = null;
  private playerId: string | null = null;
  private resumeToken: string | null = null;
  private sessionId: string | null = null;
  private connectionEpoch = 0;
  private role: PlayerRole = 'PLAYER';
  private currentSlot: SeatSlotOrSpectator = 0;

  private connectionStatus: ConnectionStatus = 'disconnected';
  private intentionalLeave = false;
  private disposed = false;
  private reconnectAttempts = 0;
  private connectPromise: Promise<void> | null = null;
  private pendingRoomRequest: Promise<void> | null = null;
  private pendingRoomSignature: string | null = null;
  private pendingIdempotency: { signature: string; key: string } | null = null;
  private accountToken: string | null = null;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  public setAccountToken(token: string | null): void {
    this.accountToken = token && token.trim().length > 0 ? token.trim() : null;
  }

  public getLastLatencyMs(): number {
    return this.lastLatencyMs;
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter}`;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.callbacks.onConnectionChange(status);
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearInputKeepalive(): void {
    if (this.inputKeepaliveTimer !== null) {
      window.clearInterval(this.inputKeepaliveTimer);
      this.inputKeepaliveTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private syncInputKeepaliveTimer(): void {
    const isHoldingInput = this.currentFarting || this.currentMoveDir !== 0 || this.currentAnchor;
    if (isHoldingInput && this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.inputKeepaliveTimer === null) {
        this.inputKeepaliveTimer = window.setInterval(() => {
          if (
            (this.currentFarting || this.currentMoveDir !== 0 || this.currentAnchor) &&
            this.ws &&
            this.ws.readyState === WebSocket.OPEN
          ) {
            this.seq += 1;
            this.sendEnvelope(
              makeEnvelope('input:state', {
                moveDir: this.currentMoveDir,
                farting: this.currentFarting,
                anchor: this.currentAnchor,
                seq: this.seq,
              }),
            );
          } else {
            this.clearInputKeepalive();
          }
        }, INPUT_KEEPALIVE_MS);
      }
    } else {
      this.clearInputKeepalive();
    }
  }

  private authenticateCurrentSocket(): void {
    if (!this.playerId || !this.resumeToken) return;
    this.sendEnvelope(
      makeEnvelope(
        'session:authenticate',
        {
          playerId: this.playerId,
          resumeToken: this.resumeToken,
          protocolVersion: PROTOCOL_VERSION,
          clientVersion: GAME_VERSION,
        },
        this.nextRequestId(),
      ),
    );
  }

  private clearActiveSocket(closeReason?: string): void {
    const existingWs = this.ws;
    this.ws = null;
    this.connectPromise = null;
    this.clearPingTimer();
    this.clearInputKeepalive();
    if (existingWs) {
      try {
        if (existingWs.readyState === WebSocket.OPEN || existingWs.readyState === WebSocket.CONNECTING) {
          existingWs.close(1000, closeReason ?? 'RESET');
        }
      } catch {
        // ignore close errors
      }
    }
  }

  private terminateSessionAndCloseSocket(reason = 'TERMINATED'): void {
    this.intentionalLeave = true;
    this.clearReconnectTimer();
    this.clearActiveSocket(reason);
    this.currentMoveDir = 0;
    this.currentFarting = false;
    this.currentAnchor = false;
    this.lastInputKey = '';
    this.lastSnapshotSeq = 0;
    this.lastEventId = 0;
    this.roomCode = null;
    this.playerId = null;
    this.resumeToken = null;
    this.sessionId = null;
    this.connectionEpoch = 0;
    this.role = 'PLAYER';
    this.currentSlot = 0;
    this.setStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.intentionalLeave) return;
    if (!this.roomCode || !this.playerId || !this.resumeToken) {
      this.setStatus('disconnected');
      return;
    }
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.terminateSessionAndCloseSocket('MAX_RECONNECT_EXCEEDED');
      this.callbacks.onError('انقطع الاتصال بالخادم وتعذرت إعادة الاتصال.');
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(3000, 650 * Math.pow(1.45, this.reconnectAttempts - 1));
    this.setStatus('reconnecting');

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.intentionalLeave || !this.roomCode || !this.playerId || !this.resumeToken) {
        return;
      }
      this.connect(this.roomCode, true)
        .then(() => {
          this.lastInputKey = '';
          if (this.currentFarting || this.currentMoveDir !== 0 || this.currentAnchor) {
            this.sendInput(this.currentMoveDir, this.currentFarting, true, this.currentAnchor, false);
          }
        })
        .catch(() => {
          // ws.onclose / onerror will schedule the next retry
        });
    }, delayMs);
  }

  /**
   * Connects WebSocket to a room route (`/ws/rooms/:code` or roomCode).
   */
  public connect(roomCodeOrPath: string, isReconnect = false): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const wsPath = roomCodeOrPath.startsWith('/ws/')
      ? roomCodeOrPath
      : `/ws/rooms/${encodeURIComponent(roomCodeOrPath)}`;

    this.clearReconnectTimer();
    this.setStatus(isReconnect ? 'reconnecting' : 'connecting');

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = `${getWsBaseUrl()}${wsPath}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        settled = true;
        this.connectPromise = null;
        this.reconnectAttempts = 0;

        this.authenticateCurrentSocket();

        this.clearPingTimer();
        this.pingTimer = window.setInterval(() => {
          this.sendEnvelope(makeEnvelope('ping', { clientTime: Date.now() }));
        }, 4000);
        this.syncInputKeepaliveTimer();
        resolve();
      };

      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let msg: ServerProtocolMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerProtocolMessage;
        } catch {
          return;
        }
        if (!msg || msg.version !== PROTOCOL_VERSION) return;

        switch (msg.type) {
          case 'session:renewed':
            this.roomCode = msg.payload!.roomCode;
            this.playerId = msg.payload!.playerId;
            this.resumeToken = msg.payload!.resumeToken;
            this.sessionId = msg.payload!.sessionId;
            this.connectionEpoch = msg.payload!.connectionEpoch;
            this.role = msg.payload!.role;
            this.currentSlot = msg.payload!.slot;
            this.seq = 0;
            this.setStatus('connected');
            break;

          case 'room:joined': {
            const snap = msg.payload!.snapshot;
            this.roomCode = msg.payload!.roomCode;
            this.playerId = msg.payload!.playerId;
            this.sessionId = msg.payload!.sessionId;
            this.connectionEpoch = msg.payload!.connectionEpoch;
            this.role = msg.payload!.role;
            this.currentSlot = msg.payload!.slot;
            this.lastSnapshotSeq = snap.snapshotSeq;
            this.lastEventId = Math.max(this.lastEventId, snap.sim.eventSeq ?? 0);
            this.setStatus('connected');
            this.callbacks.onJoined({
              roomCode: msg.payload!.roomCode,
              playerId: msg.payload!.playerId,
              slot: msg.payload!.slot,
              role: msg.payload!.role,
              snapshot: snap,
            });
            break;
          }

          case 'room:state': {
            const snap = msg.payload!.snapshot;
            if (snap.snapshotSeq < this.lastSnapshotSeq) return;
            this.lastSnapshotSeq = snap.snapshotSeq;
            this.lastEventId = Math.max(this.lastEventId, snap.sim.eventSeq ?? 0);
            if (this.currentSlot === -1 && this.playerId) {
              const promotedIdx = snap.sim.players.findIndex((p) => p.id === this.playerId);
              if (promotedIdx >= 0) {
                this.currentSlot = promotedIdx as 0 | 1 | 2 | 3;
                this.role = snap.hostId === this.playerId ? 'HOST' : 'PLAYER';
                this.callbacks.onPromoted?.({
                  slot: this.currentSlot,
                  role: this.role,
                  snapshot: snap,
                });
              }
            }
            this.callbacks.onState(snap);
            break;
          }

          case 'game:snapshot': {
            const snap = msg.payload!.snapshot;
            if (snap.snapshotSeq <= this.lastSnapshotSeq) {
              return;
            }
            if (this.lastSnapshotSeq > 0 && snap.snapshotSeq > this.lastSnapshotSeq + 1) {
              const now = Date.now();
              if (now - this.lastResyncRequestAtMs >= RESYNC_THROTTLE_MS) {
                this.lastResyncRequestAtMs = now;
                this.requestResync();
              }
            }
            this.lastSnapshotSeq = snap.snapshotSeq;
            this.callbacks.onState(snap);
            break;
          }

          case 'game:event': {
            const freshEvents = msg.payload!.events.filter((e) => e.id > this.lastEventId);
            if (freshEvents.length > 0) {
              this.lastEventId = freshEvents[freshEvents.length - 1].id;
              this.callbacks.onEvents?.(freshEvents);
            }
            break;
          }

          case 'chat:message': {
            this.callbacks.onChatMessage?.(msg.payload!.message);
            break;
          }

          case 'game:emote': {
            this.callbacks.onEmote?.(msg.payload!);
            break;
          }

          case 'pong':
            if (typeof msg.payload?.clientTime === 'number') {
              this.lastLatencyMs = Math.max(0, Date.now() - msg.payload.clientTime);
            }
            break;

          case 'room:error': {
            const code = msg.payload!.code;
            if (
              code === 'SESSION_REPLACED' ||
              code === 'SESSION_EXPIRED' ||
              code === 'UNAUTHORIZED' ||
              code === 'ROOM_NOT_FOUND' ||
              code === 'ROOM_CLOSED' ||
              code === 'FORBIDDEN_ORIGIN' ||
              code === 'PROTOCOL_MISMATCH'
            ) {
              this.terminateSessionAndCloseSocket(code);
            }
            this.callbacks.onError(msg.payload!.message, code);
            break;
          }
        }
      };

      ws.onerror = () => {
        if (this.ws !== ws) return;
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          reject(new Error('تعذر الاتصال بالخادم'));
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) {
          return;
        }
        this.ws = null;
        this.connectPromise = null;
        this.clearPingTimer();
        this.clearInputKeepalive();

        if (!settled) {
          settled = true;
          reject(new Error('تعذر الاتصال بالخادم'));
        }

        if (!this.disposed && !this.intentionalLeave && this.roomCode && this.playerId && this.resumeToken) {
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };
    });

    return this.connectPromise;
  }

  private sendEnvelope(msg: ProtocolEnvelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private applyIssuedCredentials(creds: RoomSessionCredentials): void {
    this.roomCode = creds.roomCode;
    this.playerId = creds.playerId;
    this.resumeToken = creds.resumeToken;
    this.sessionId = creds.sessionId;
    this.connectionEpoch = creds.connectionEpoch;
    this.role = creds.role;
    this.currentSlot = creds.slot;
    this.lastSnapshotSeq = 0;
    this.lastEventId = 0;
  }

  private getOrCreateIdempotencyKey(signature: string, customKey?: string): string {
    if (customKey) {
      return customKey;
    }
    if (this.pendingIdempotency && this.pendingIdempotency.signature === signature) {
      return this.pendingIdempotency.key;
    }
    const key =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pendingIdempotency = { signature, key };
    return key;
  }

  public createRoom(
    name: string,
    cosmetic: PlayerCosmetic,
    courseOrOpts?:
      | CourseId
      | {
          courseId?: CourseId;
          isPrivate?: boolean;
          password?: string;
          settings?: Partial<RoomSettings>;
          customIdempotencyKey?: string;
        },
    customIdempotencyKey?: string,
  ): Promise<void> {
    const opts =
      typeof courseOrOpts === 'string'
        ? { courseId: courseOrOpts, customIdempotencyKey }
        : { ...(courseOrOpts ?? {}), customIdempotencyKey: courseOrOpts?.customIdempotencyKey ?? customIdempotencyKey };
    const courseId = opts.courseId;
    const signature = `create:${name.trim()}:${courseId ?? 'tropical'}:${opts.isPrivate ? 'priv' : 'pub'}:${JSON.stringify(opts.settings ?? {})}:${JSON.stringify(cosmetic)}`;
    if (this.pendingRoomRequest) {
      if (this.pendingRoomSignature === signature) {
        return this.pendingRoomRequest;
      }
      return Promise.reject(new Error('يوجد طلب اتصال قيد التنفيذ بالفعل، يرجى الانتظار.'));
    }

    const idempotencyKey = this.getOrCreateIdempotencyKey(signature, opts.customIdempotencyKey);
    this.pendingRoomSignature = signature;

    const op = (async () => {
      this.terminateSessionAndCloseSocket('NEW_SESSION');
      this.intentionalLeave = false;
      this.reconnectAttempts = 0;
      this.setStatus('connecting');

      const res = await fetch(`${getApiBaseUrl()}/api/v1/rooms`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-game-version': GAME_VERSION,
          'x-protocol-version': String(PROTOCOL_VERSION),
        },
        body: JSON.stringify({
          name,
          cosmetic,
          ...(courseId ? { courseId } : {}),
          ...(opts.isPrivate ? { isPrivate: true } : {}),
          ...(opts.password ? { password: opts.password } : {}),
          ...(opts.settings ? { settings: opts.settings } : {}),
          ...(this.accountToken ? { accountToken: this.accountToken } : {}),
          idempotencyKey,
        }),
      });

      if (!res.ok) {
        this.setStatus('disconnected');
        const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
        if (errBody?.error?.code === 'SESSION_ALREADY_ACTIVE') {
          this.pendingIdempotency = null;
        }
        throw new Error(errBody?.error?.message || 'تعذر إنشاء الغرفة');
      }

      const creds = (await res.json()) as RoomSessionCredentials;
      this.applyIssuedCredentials(creds);
      await this.connect(creds.roomCode, false);
      this.pendingIdempotency = null;
    })().finally(() => {
      if (this.pendingRoomRequest === op) {
        this.pendingRoomRequest = null;
        this.pendingRoomSignature = null;
      }
    });

    this.pendingRoomRequest = op;
    return op;
  }

  public joinRoom(
    roomCode: string,
    name: string,
    cosmetic: PlayerCosmetic,
    customIdempotencyKeyOrOpts?:
      | string
      | { customIdempotencyKey?: string; password?: string; spectate?: SpectateJoinMode },
    passwordArg?: string,
  ): Promise<void> {
    const normalizedCode = roomCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,10}$/.test(normalizedCode)) {
      return Promise.reject(new Error('رمز الغرفة يجب أن يتكون من 6 إلى 10 أحرف أو أرقام.'));
    }

    const opts =
      typeof customIdempotencyKeyOrOpts === 'string'
        ? { customIdempotencyKey: customIdempotencyKeyOrOpts, password: passwordArg, spectate: 'auto' as SpectateJoinMode }
        : {
            customIdempotencyKey: customIdempotencyKeyOrOpts?.customIdempotencyKey,
            password: customIdempotencyKeyOrOpts?.password ?? passwordArg,
            spectate: customIdempotencyKeyOrOpts?.spectate ?? ('auto' as SpectateJoinMode),
          };

    const signature = `join:${normalizedCode}:${name.trim()}:${opts.password ?? ''}:${opts.spectate}:${JSON.stringify(cosmetic)}`;
    if (this.pendingRoomRequest) {
      if (this.pendingRoomSignature === signature) {
        return this.pendingRoomRequest;
      }
      return Promise.reject(new Error('يوجد طلب اتصال قيد التنفيذ بالفعل، يرجى الانتظار.'));
    }

    const idempotencyKey = this.getOrCreateIdempotencyKey(signature, opts.customIdempotencyKey);
    this.pendingRoomSignature = signature;

    const op = (async () => {
      this.terminateSessionAndCloseSocket('NEW_SESSION');
      this.intentionalLeave = false;
      this.reconnectAttempts = 0;
      this.setStatus('connecting');

      const res = await fetch(`${getApiBaseUrl()}/api/v1/rooms/${encodeURIComponent(normalizedCode)}/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-game-version': GAME_VERSION,
          'x-protocol-version': String(PROTOCOL_VERSION),
        },
        body: JSON.stringify({
          name,
          cosmetic,
          idempotencyKey,
          spectate: opts.spectate,
          ...(opts.password ? { password: opts.password } : {}),
          ...(this.accountToken ? { accountToken: this.accountToken } : {}),
        }),
      });

      if (!res.ok) {
        this.setStatus('disconnected');
        const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
        if (errBody?.error?.code === 'SESSION_ALREADY_ACTIVE') {
          this.pendingIdempotency = null;
        }
        throw new Error(errBody?.error?.message || 'تعذر الانضمام للغرفة');
      }

      const creds = (await res.json()) as RoomSessionCredentials;
      this.applyIssuedCredentials(creds);
      await this.connect(creds.roomCode, false);
      this.pendingIdempotency = null;
    })().finally(() => {
      if (this.pendingRoomRequest === op) {
        this.pendingRoomRequest = null;
        this.pendingRoomSignature = null;
      }
    });

    this.pendingRoomRequest = op;
    return op;
  }

  public async fetchRoomInfo(roomCode: string): Promise<RoomPublicInfoResponse> {
    const normalizedCode = roomCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,10}$/.test(normalizedCode)) {
      throw new Error('رمز الغرفة غير صالح.');
    }
    const res = await fetch(`${getApiBaseUrl()}/api/v1/rooms/${encodeURIComponent(normalizedCode)}`, {
      method: 'GET',
      headers: {
        'x-game-version': GAME_VERSION,
        'x-protocol-version': String(PROTOCOL_VERSION),
      },
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
      throw new Error(errBody?.error?.message || 'تعذر العثور على الغرفة.');
    }
    return (await res.json()) as RoomPublicInfoResponse;
  }

  public async fetchPublicRooms(): Promise<PublicRoomsListResponse> {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/rooms`, {
      method: 'GET',
      headers: {
        'x-game-version': GAME_VERSION,
        'x-protocol-version': String(PROTOCOL_VERSION),
      },
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
      throw new Error(errBody?.error?.message || 'تعذر جلب قائمة الغرف العامة.');
    }
    return (await res.json()) as PublicRoomsListResponse;
  }

  public quickMatch(req: QuickMatchHttpRequest): Promise<void> {
    const signature = `quick:${req.name.trim()}:${req.preferredGameMode ?? 'any'}:${req.preferredCourseId ?? 'any'}`;
    if (this.pendingRoomRequest) {
      if (this.pendingRoomSignature === signature) {
        return this.pendingRoomRequest;
      }
      return Promise.reject(new Error('يوجد طلب اتصال قيد التنفيذ بالفعل، يرجى الانتظار.'));
    }

    this.pendingRoomSignature = signature;
    const op = (async () => {
      this.terminateSessionAndCloseSocket('NEW_SESSION');
      this.intentionalLeave = false;
      this.reconnectAttempts = 0;
      this.setStatus('connecting');

      const res = await fetch(`${getApiBaseUrl()}/api/v1/rooms/quick-match`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-game-version': GAME_VERSION,
          'x-protocol-version': String(PROTOCOL_VERSION),
        },
        body: JSON.stringify({
          ...req,
          ...(this.accountToken && !req.accountToken ? { accountToken: this.accountToken } : {}),
        }),
      });

      if (!res.ok) {
        this.setStatus('disconnected');
        const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
        throw new Error(errBody?.error?.message || 'لا توجد غرف عامة متاحة حاليًا.');
      }

      const creds = (await res.json()) as RoomSessionCredentials;
      this.applyIssuedCredentials(creds);
      await this.connect(creds.roomCode, false);
    })().finally(() => {
      if (this.pendingRoomRequest === op) {
        this.pendingRoomRequest = null;
        this.pendingRoomSignature = null;
      }
    });

    this.pendingRoomRequest = op;
    return op;
  }

  public setReady(ready: boolean): void {
    this.sendEnvelope(makeEnvelope('room:ready', { ready }, this.nextRequestId()));
  }

  public updateCosmetic(cosmetic: PlayerCosmetic): void {
    this.sendEnvelope(makeEnvelope('room:cosmetic', { cosmetic }, this.nextRequestId()));
  }

  public toggleBots(fillBots: boolean): void {
    this.sendEnvelope(makeEnvelope('room:toggleBots', { fillBots }, this.nextRequestId()));
  }

  public selectCourse(courseId: CourseId, courseSelectionMode?: CourseSelectionMode): void {
    this.sendEnvelope(
      makeEnvelope(
        'room:selectCourse',
        {
          courseId,
          ...(courseSelectionMode ? { courseSelectionMode } : {}),
        },
        this.nextRequestId(),
      ),
    );
  }

  public voteCourse(courseId: CourseId): void {
    this.sendEnvelope(makeEnvelope('room:voteCourse', { courseId }, this.nextRequestId()));
  }

  public updateRoomSettings(settings: Partial<RoomSettings>): void {
    this.sendEnvelope(makeEnvelope('room:updateSettings', { settings }, this.nextRequestId()));
  }

  public startGame(): void {
    this.sendEnvelope(makeEnvelope('room:start', {}, this.nextRequestId()));
  }

  public restartGame(): void {
    this.sendEnvelope(makeEnvelope('room:restart', {}, this.nextRequestId()));
  }

  public setPlaylist(playlist: PlaylistItem[]): void {
    this.sendEnvelope(makeEnvelope('room:setPlaylist', { playlist }, this.nextRequestId()));
  }

  public nextRound(opts: {
    action: NextRoundAction;
    courseId?: CourseId;
    settings?: Partial<RoomSettings>;
    immediate?: boolean;
  }): void {
    this.sendEnvelope(makeEnvelope('room:nextRound', opts, this.nextRequestId()));
  }

  public sendChat(payload: { text?: string; presetId?: string }): void {
    this.sendEnvelope(makeEnvelope('chat:send', payload, this.nextRequestId()));
  }

  public triggerEmote(emoteId: EmoteId): void {
    this.sendEnvelope(makeEnvelope('emote:trigger', { emoteId }, this.nextRequestId()));
  }

  public requestResync(): void {
    this.sendEnvelope(
      makeEnvelope(
        'game:resync',
        { lastEventId: this.lastEventId, lastSnapshotSeq: this.lastSnapshotSeq },
        this.nextRequestId(),
      ),
    );
  }

  public sendInput(
    moveDir: -1 | 0 | 1,
    farting: boolean,
    force = false,
    anchor = false,
    useItem = false,
  ): void {
    this.currentMoveDir = moveDir;
    this.currentFarting = farting;
    this.currentAnchor = anchor;
    const key = `${moveDir}:${farting ? 1 : 0}:${anchor ? 1 : 0}`;
    if (force || useItem || key !== this.lastInputKey) {
      this.lastInputKey = key;
      this.seq += 1;
      this.sendEnvelope(
        makeEnvelope('input:state', {
          moveDir,
          farting,
          anchor,
          ...(useItem ? { useItem: true } : {}),
          seq: this.seq,
        }),
      );
    }
    this.syncInputKeepaliveTimer();
  }

  public leaveRoom(): void {
    this.intentionalLeave = true;
    this.pendingIdempotency = null;
    this.clearReconnectTimer();
    this.clearPingTimer();
    this.clearInputKeepalive();
    this.currentMoveDir = 0;
    this.currentFarting = false;
    this.currentAnchor = false;
    this.lastInputKey = '';
    this.lastSnapshotSeq = 0;
    this.lastEventId = 0;
    this.sendEnvelope(makeEnvelope('room:leave', {}, this.nextRequestId()));
    this.roomCode = null;
    this.playerId = null;
    this.resumeToken = null;
    this.sessionId = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      window.setTimeout(() => {
        try {
          ws.close(1000, 'LEFT_ROOM');
        } catch {
          // ignore
        }
      }, 40);
    }
    this.setStatus('disconnected');
  }

  public dispose(): void {
    this.disposed = true;
    this.intentionalLeave = true;
    this.pendingIdempotency = null;
    this.pendingRoomRequest = null;
    this.pendingRoomSignature = null;
    this.clearReconnectTimer();
    this.clearPingTimer();
    this.clearInputKeepalive();
    this.roomCode = null;
    this.playerId = null;
    this.resumeToken = null;
    this.sessionId = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
