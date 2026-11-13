import type {
  ClientToServerMessage,
  PlayerCosmetic,
  RoomSnapshot,
  ServerToClientMessage,
} from '../shared/types.ts';

export interface MultiplayerCallbacks {
  onJoined: (data: { roomCode: string; playerId: string; slot: 0 | 1 | 2 | 3; snapshot: RoomSnapshot }) => void;
  onState: (snapshot: RoomSnapshot) => void;
  onError: (message: string) => void;
  onConnectionChange: (connected: boolean) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private callbacks: MultiplayerCallbacks;
  private lastInputKey = '';
  private seq = 0;
  private pingTimer: number | null = null;
  private roomCode: string | null = null;
  private playerId: string | null = null;
  private playerName = 'أنت';
  private cosmetic: PlayerCosmetic | null = null;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.callbacks.onConnectionChange(true);
        if (this.pingTimer) window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          this.send({ type: 'ping' });
        }, 4000);
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
          this.callbacks.onError(msg.message);
        }
      };

      ws.onerror = () => {
        this.callbacks.onConnectionChange(false);
        reject(new Error('تعذر الاتصال بالخادم'));
      };

      ws.onclose = () => {
        this.callbacks.onConnectionChange(false);
        if (this.pingTimer) {
          window.clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
      };
    });
  }

  private send(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public async createRoom(name: string, cosmetic: PlayerCosmetic): Promise<void> {
    this.playerName = name;
    this.cosmetic = cosmetic;
    await this.connect();
    this.send({ type: 'room:create', name, cosmetic });
  }

  public async joinRoom(roomCode: string, name: string, cosmetic: PlayerCosmetic): Promise<void> {
    this.playerName = name;
    this.cosmetic = cosmetic;
    await this.connect();
    this.send({
      type: 'room:join',
      roomCode: roomCode.trim().toUpperCase(),
      name,
      cosmetic,
      playerId: this.roomCode === roomCode.trim().toUpperCase() ? (this.playerId ?? undefined) : undefined,
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
    const key = `${moveDir}:${farting ? 1 : 0}`;
    if (!force && key === this.lastInputKey) return;
    this.lastInputKey = key;
    this.seq += 1;
    this.send({ type: 'input:state', moveDir, farting, seq: this.seq });
  }

  public leaveRoom(): void {
    this.send({ type: 'room:leave' });
    this.roomCode = null;
    this.playerId = null;
  }

  public dispose(): void {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
