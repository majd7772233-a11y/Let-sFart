import {
  makeEnvelope,
  PROTOCOL_VERSION,
  type HttpErrorResponse,
  type PartyServerMessage,
  type PartySessionCredentials,
  type ProtocolEnvelope,
} from '../shared/protocol.ts';
import type { ChatMessage, ConnectionStatus, PartyState, PlayerCosmetic } from '../shared/types.ts';

export interface PartyCallbacks {
  onState: (party: PartyState, myMemberId: string) => void;
  onChat?: (message: ChatMessage) => void;
  onFollowRoom?: (data: {
    partyCode: string;
    leaderId: string;
    roomCode: string | null;
    password?: string;
    followSeq: number;
  }) => void;
  onError: (message: string, code?: string) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}

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
  if (configuredApi) return configuredApi.replace(/^http/i, 'ws');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export class PartyClient {
  private ws: WebSocket | null = null;
  private callbacks: PartyCallbacks;
  private partyCode: string | null = null;
  private memberId: string | null = null;
  private resumeToken: string | null = null;
  private status: ConnectionStatus = 'disconnected';
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private intentionalLeave = false;
  private disposed = false;
  private reconnectAttempts = 0;
  private reqCounter = 0;

  constructor(callbacks: PartyCallbacks) {
    this.callbacks = callbacks;
  }

  public getPartyCode(): string | null {
    return this.partyCode;
  }

  public getMemberId(): string | null {
    return this.memberId;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.callbacks.onConnectionChange(status);
    }
  }

  private nextReqId(): string {
    this.reqCounter += 1;
    return `preq-${this.reqCounter}`;
  }

  private sendEnvelope(msg: ProtocolEnvelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeActiveSocket(reason = 'RESET'): void {
    const ws = this.ws;
    this.ws = null;
    this.clearTimers();
    if (ws) {
      try {
        ws.close(1000, reason);
      } catch {
        // ignore
      }
    }
  }

  public async createParty(name: string, cosmetic: PlayerCosmetic): Promise<PartySessionCredentials> {
    this.closeActiveSocket('NEW_PARTY');
    this.intentionalLeave = false;
    this.reconnectAttempts = 0;
    this.setStatus('connecting');

    const res = await fetch(`${getApiBaseUrl()}/api/v1/parties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cosmetic }),
    });
    if (!res.ok) {
      this.setStatus('disconnected');
      const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
      throw new Error(errBody?.error?.message || 'تعذر إنشاء المجموعة');
    }

    const creds = (await res.json()) as PartySessionCredentials;
    this.partyCode = creds.partyCode;
    this.memberId = creds.memberId;
    this.resumeToken = creds.resumeToken;
    this.callbacks.onState(creds.party, creds.memberId);
    await this.connectWs(creds.partyCode);
    return creds;
  }

  public async joinParty(
    partyCode: string,
    name: string,
    cosmetic: PlayerCosmetic,
  ): Promise<PartySessionCredentials> {
    const code = partyCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,10}$/.test(code)) {
      throw new Error('رمز المجموعة يجب أن يتكون من 6 إلى 10 أحرف أو أرقام.');
    }

    this.closeActiveSocket('NEW_PARTY');
    this.intentionalLeave = false;
    this.reconnectAttempts = 0;
    this.setStatus('connecting');

    const res = await fetch(`${getApiBaseUrl()}/api/v1/parties/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cosmetic }),
    });
    if (!res.ok) {
      this.setStatus('disconnected');
      const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
      throw new Error(errBody?.error?.message || 'تعذر الانضمام للمجموعة');
    }

    const creds = (await res.json()) as PartySessionCredentials;
    this.partyCode = creds.partyCode;
    this.memberId = creds.memberId;
    this.resumeToken = creds.resumeToken;
    this.callbacks.onState(creds.party, creds.memberId);
    await this.connectWs(creds.partyCode);
    return creds;
  }

  private connectWs(partyCode: string, isReconnect = false): Promise<void> {
    this.setStatus(isReconnect ? 'reconnecting' : 'connecting');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${getWsBaseUrl()}/ws/parties/${encodeURIComponent(partyCode)}`);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        settled = true;
        this.reconnectAttempts = 0;
        if (this.memberId && this.resumeToken) {
          this.sendEnvelope(
            makeEnvelope(
              'party:authenticate',
              { memberId: this.memberId, resumeToken: this.resumeToken },
              this.nextReqId(),
            ),
          );
        }
        if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          this.sendEnvelope(makeEnvelope('party:ping', { clientTime: Date.now() }));
        }, 6000);
        resolve();
      };

      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let msg: PartyServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as PartyServerMessage;
        } catch {
          return;
        }
        if (!msg || msg.version !== PROTOCOL_VERSION) return;

        switch (msg.type) {
          case 'party:renewed':
            this.partyCode = msg.payload!.partyCode;
            this.memberId = msg.payload!.memberId;
            this.resumeToken = msg.payload!.resumeToken;
            this.setStatus('connected');
            break;
          case 'party:state':
            if (this.memberId) {
              this.callbacks.onState(msg.payload!.party, this.memberId);
            }
            break;
          case 'party:chat':
            this.callbacks.onChat?.(msg.payload!.message);
            break;
          case 'party:followRoom':
            this.callbacks.onFollowRoom?.(msg.payload!);
            break;
          case 'party:error': {
            const code = msg.payload!.code;
            if (code === 'SESSION_EXPIRED' || code === 'UNAUTHORIZED' || code === 'PARTY_NOT_FOUND') {
              this.intentionalLeave = true;
              this.closeActiveSocket(code);
              this.partyCode = null;
              this.memberId = null;
              this.resumeToken = null;
              this.setStatus('disconnected');
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
          reject(new Error('تعذر الاتصال بخادم المجموعة'));
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.clearTimers();
        if (!settled) {
          settled = true;
          reject(new Error('تعذر الاتصال بخادم المجموعة'));
        }
        if (!this.disposed && !this.intentionalLeave && this.partyCode && this.memberId && this.resumeToken) {
          if (this.reconnectAttempts < 6) {
            this.reconnectAttempts += 1;
            const delay = Math.min(3500, 700 * this.reconnectAttempts);
            this.setStatus('reconnecting');
            this.reconnectTimer = window.setTimeout(() => {
              this.reconnectTimer = null;
              if (this.partyCode) void this.connectWs(this.partyCode, true).catch(() => {});
            }, delay);
            return;
          }
        }
        this.setStatus('disconnected');
      };
    });
  }

  public sendChat(payload: { text?: string; presetId?: string }): void {
    this.sendEnvelope(makeEnvelope('party:chat', payload, this.nextReqId()));
  }

  public updateCosmetic(name: string, cosmetic: PlayerCosmetic): void {
    this.sendEnvelope(makeEnvelope('party:cosmetic', { name, cosmetic }, this.nextReqId()));
  }

  public setRoom(roomCode: string | null, password?: string): void {
    this.sendEnvelope(
      makeEnvelope('party:setRoom', { roomCode, ...(password ? { password } : {}) }, this.nextReqId()),
    );
  }

  public kickMember(targetMemberId: string): void {
    this.sendEnvelope(makeEnvelope('party:kick', { targetMemberId }, this.nextReqId()));
  }

  public leaveParty(): void {
    this.intentionalLeave = true;
    this.sendEnvelope(makeEnvelope('party:leave', {}, this.nextReqId()));
    this.partyCode = null;
    this.memberId = null;
    this.resumeToken = null;
    window.setTimeout(() => this.closeActiveSocket('LEFT_PARTY'), 30);
    this.setStatus('disconnected');
  }

  public dispose(): void {
    this.disposed = true;
    this.intentionalLeave = true;
    this.closeActiveSocket('DISPOSED');
  }
}
