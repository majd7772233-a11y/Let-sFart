import {
  makeEnvelope,
  PROTOCOL_VERSION,
  type HttpErrorResponse,
  type ProtocolEnvelope,
  type RoomSessionCredentials,
  type ServerProtocolMessage,
} from '../shared/protocol.ts';
import type {
  ConnectionStatus,
  PlayerCosmetic,
  PlayerRole,
  RoomSnapshot,
  SimEvent,
} from '../shared/types.ts';

export interface MultiplayerCallbacks {
  onJoined: (data: {
    roomCode: string;
    playerId: string;
    slot: 0 | 1 | 2 | 3;
    role: PlayerRole;
    snapshot: RoomSnapshot;
  }) => void;
  onState: (snapshot: RoomSnapshot) => void;
  onEvents?: (events: SimEvent[]) => void;
  onError: (message: string, code?: string) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}

const INPUT_KEEPALIVE_MS = 850;
const MAX_RECONNECT_ATTEMPTS = 7;
const RESYNC_THROTTLE_MS = 1500;

function getApiBaseUrl(): string {
  const configured = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim();
  return configured ? configured.replace(/\/+$/, '') : '';
}

function getWsBaseUrl(): string {
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

  private connectionStatus: ConnectionStatus = 'disconnected';
  private intentionalLeave = false;
  private disposed = false;
  private reconnectAttempts = 0;
  private connectPromise: Promise<void> | null = null;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
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
    const isHoldingInput = this.currentFarting || this.currentMoveDir !== 0;
    if (isHoldingInput && this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.inputKeepaliveTimer === null) {
        this.inputKeepaliveTimer = window.setInterval(() => {
          if (
            (this.currentFarting || this.currentMoveDir !== 0) &&
            this.ws &&
            this.ws.readyState === WebSocket.OPEN
          ) {
            this.seq += 1;
            this.sendEnvelope(
              makeEnvelope('input:state', {
                moveDir: this.currentMoveDir,
                farting: this.currentFarting,
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
    this.lastInputKey = '';
    this.lastSnapshotSeq = 0;
    this.lastEventId = 0;
    this.roomCode = null;
    this.playerId = null;
    this.resumeToken = null;
    this.sessionId = null;
    this.connectionEpoch = 0;
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
          if (this.currentFarting || this.currentMoveDir !== 0) {
            this.sendInput(this.currentMoveDir, this.currentFarting, true);
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
              code === 'FORBIDDEN_ORIGIN'
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
    this.lastSnapshotSeq = 0;
    this.lastEventId = 0;
  }

  public async createRoom(
    name: string,
    cosmetic: PlayerCosmetic,
    customIdempotencyKey?: string,
  ): Promise<void> {
    this.terminateSessionAndCloseSocket('NEW_SESSION');
    this.intentionalLeave = false;
    this.reconnectAttempts = 0;
    this.setStatus('connecting');

    const idempotencyKey =
      customIdempotencyKey ?? (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const res = await fetch(`${getApiBaseUrl()}/api/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cosmetic, idempotencyKey }),
    });

    if (!res.ok) {
      this.setStatus('disconnected');
      const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
      throw new Error(errBody?.error?.message || 'تعذر إنشاء الغرفة');
    }

    const creds = (await res.json()) as RoomSessionCredentials;
    this.applyIssuedCredentials(creds);
    await this.connect(creds.roomCode, false);
  }

  public async joinRoom(
    roomCode: string,
    name: string,
    cosmetic: PlayerCosmetic,
    customIdempotencyKey?: string,
  ): Promise<void> {
    this.terminateSessionAndCloseSocket('NEW_SESSION');
    this.intentionalLeave = false;
    this.reconnectAttempts = 0;
    this.setStatus('connecting');

    const normalizedCode = roomCode.trim().toUpperCase();
    const idempotencyKey =
      customIdempotencyKey ?? (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const res = await fetch(`${getApiBaseUrl()}/api/v1/rooms/${encodeURIComponent(normalizedCode)}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cosmetic, idempotencyKey }),
    });

    if (!res.ok) {
      this.setStatus('disconnected');
      const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
      throw new Error(errBody?.error?.message || 'تعذر الانضمام للغرفة');
    }

    const creds = (await res.json()) as RoomSessionCredentials;
    this.applyIssuedCredentials(creds);
    await this.connect(creds.roomCode, false);
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

  public startGame(): void {
    this.sendEnvelope(makeEnvelope('room:start', {}, this.nextRequestId()));
  }

  public restartGame(): void {
    this.sendEnvelope(makeEnvelope('room:restart', {}, this.nextRequestId()));
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

  public sendInput(moveDir: -1 | 0 | 1, farting: boolean, force = false): void {
    this.currentMoveDir = moveDir;
    this.currentFarting = farting;
    const key = `${moveDir}:${farting ? 1 : 0}`;
    if (force || key !== this.lastInputKey) {
      this.lastInputKey = key;
      this.seq += 1;
      this.sendEnvelope(makeEnvelope('input:state', { moveDir, farting, seq: this.seq }));
    }
    this.syncInputKeepaliveTimer();
  }

  public leaveRoom(): void {
    this.intentionalLeave = true;
    this.clearReconnectTimer();
    this.clearPingTimer();
    this.clearInputKeepalive();
    this.currentMoveDir = 0;
    this.currentFarting = false;
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
