import type {
  ClientToServerMessage,
  ConnectionStatus,
  PlayerCosmetic,
  RoomSnapshot,
  ServerToClientMessage,
} from '../shared/types.ts';

export interface MultiplayerCallbacks {
  onJoined: (data: { roomCode: string; playerId: string; slot: 0 | 1 | 2 | 3; snapshot: RoomSnapshot }) => void;
  onState: (snapshot: RoomSnapshot) => void;
  onError: (message: string) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}

const INPUT_KEEPALIVE_MS = 850;
const MAX_RECONNECT_ATTEMPTS = 7;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private callbacks: MultiplayerCallbacks;
  private lastInputKey = '';
  private currentMoveDir: -1 | 0 | 1 = 0;
  private currentFarting = false;
  private seq = 0;

  private pingTimer: number | null = null;
  private inputKeepaliveTimer: number | null = null;
  private reconnectTimer: number | null = null;

  private roomCode: string | null = null;
  private playerId: string | null = null;
  private playerName = 'أنت';
  private cosmetic: PlayerCosmetic | null = null;

  private connectionStatus: ConnectionStatus = 'disconnected';
  private intentionalLeave = false;
  private disposed = false;
  private reconnectAttempts = 0;
  private connectPromise: Promise<void> | null = null;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
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
            this.send({
              type: 'input:state',
              moveDir: this.currentMoveDir,
              farting: this.currentFarting,
              seq: this.seq,
            });
          } else {
            this.clearInputKeepalive();
          }
        }, INPUT_KEEPALIVE_MS);
      }
    } else {
      this.clearInputKeepalive();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.intentionalLeave) return;
    if (!this.roomCode || !this.playerId || !this.cosmetic) {
      this.setStatus('disconnected');
      return;
    }
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.roomCode = null;
      this.playerId = null;
      this.setStatus('disconnected');
      this.callbacks.onError('انقطع الاتصال بالخادم وتعذرت إعادة الاتصال.');
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(3000, 650 * Math.pow(1.45, this.reconnectAttempts - 1));
    this.setStatus('reconnecting');

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.intentionalLeave || !this.roomCode || !this.playerId || !this.cosmetic) {
        return;
      }
      this.connect(true)
        .then(() => {
          if (this.roomCode && this.playerId && this.cosmetic) {
            this.send({
              type: 'room:join',
              roomCode: this.roomCode,
              name: this.playerName,
              cosmetic: this.cosmetic,
              playerId: this.playerId,
            });
            // Re-sync currently held input right after reconnecting
            this.lastInputKey = '';
            if (this.currentFarting || this.currentMoveDir !== 0) {
              this.sendInput(this.currentMoveDir, this.currentFarting, true);
            }
          }
        })
        .catch(() => {
          // ws.onclose / onerror will trigger next reconnect attempt
        });
    }, delayMs);
  }

  public connect(isReconnect = false): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.clearReconnectTimer();
    this.setStatus(isReconnect ? 'reconnecting' : 'connecting');

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        settled = true;
        this.connectPromise = null;
        this.reconnectAttempts = 0;
        this.setStatus('connected');

        this.clearPingTimer();
        this.pingTimer = window.setInterval(() => {
          this.send({ type: 'ping' });
        }, 4000);
        this.syncInputKeepaliveTimer();
        resolve();
      };

      ws.onmessage = (ev) => {
        let msg: ServerToClientMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerToClientMessage;
        } catch {
          return;
        }
        if (msg.type === 'room:joined') {
          this.roomCode = msg.roomCode;
          this.playerId = msg.playerId;
          this.callbacks.onJoined(msg);
        } else if (msg.type === 'room:state') {
          this.callbacks.onState(msg.snapshot);
        } else if (msg.type === 'room:error') {
          if (this.connectionStatus === 'reconnecting') {
            this.roomCode = null;
            this.playerId = null;
            this.intentionalLeave = true;
          }
          this.callbacks.onError(msg.message);
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          reject(new Error('تعذر الاتصال بالخادم'));
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        this.connectPromise = null;
        this.clearPingTimer();
        this.clearInputKeepalive();

        if (!settled) {
          settled = true;
          reject(new Error('تعذر الاتصال بالخادم'));
        }

        if (!this.disposed && !this.intentionalLeave && this.roomCode && this.playerId) {
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };
    });

    return this.connectPromise;
  }

  private send(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public async createRoom(name: string, cosmetic: PlayerCosmetic): Promise<void> {
    this.intentionalLeave = false;
    this.reconnectAttempts = 0;
    this.playerName = name;
    this.cosmetic = cosmetic;
    await this.connect(false);
    this.send({ type: 'room:create', name, cosmetic });
  }

  public async joinRoom(roomCode: string, name: string, cosmetic: PlayerCosmetic): Promise<void> {
    this.intentionalLeave = false;
    this.reconnectAttempts = 0;
    this.playerName = name;
    this.cosmetic = cosmetic;
    const normalizedCode = roomCode.trim().toUpperCase();
    await this.connect(false);
    this.send({
      type: 'room:join',
      roomCode: normalizedCode,
      name,
      cosmetic,
      playerId: this.roomCode === normalizedCode ? (this.playerId ?? undefined) : undefined,
    });
  }

  public setReady(ready: boolean): void {
    this.send({ type: 'room:ready', ready });
  }

  public updateCosmetic(cosmetic: PlayerCosmetic): void {
    this.cosmetic = cosmetic;
    this.send({ type: 'room:cosmetic', cosmetic });
  }

  public toggleBots(fillBots: boolean): void {
    this.send({ type: 'room:toggleBots', fillBots });
  }

  public startGame(): void {
    this.send({ type: 'room:start' });
  }

  public restartGame(): void {
    this.send({ type: 'room:restart' });
  }

  public sendInput(moveDir: -1 | 0 | 1, farting: boolean, force = false): void {
    this.currentMoveDir = moveDir;
    this.currentFarting = farting;
    const key = `${moveDir}:${farting ? 1 : 0}`;
    if (force || key !== this.lastInputKey) {
      this.lastInputKey = key;
      this.seq += 1;
      this.send({ type: 'input:state', moveDir, farting, seq: this.seq });
    }
    this.syncInputKeepaliveTimer();
  }

  public leaveRoom(): void {
    this.intentionalLeave = true;
    this.clearReconnectTimer();
    this.clearInputKeepalive();
    this.currentMoveDir = 0;
    this.currentFarting = false;
    this.lastInputKey = '';
    this.send({ type: 'room:leave' });
    this.roomCode = null;
    this.playerId = null;
  }

  public dispose(): void {
    this.disposed = true;
    this.intentionalLeave = true;
    this.clearReconnectTimer();
    this.clearPingTimer();
    this.clearInputKeepalive();
    this.roomCode = null;
    this.playerId = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
