import { afterEach, describe, expect, it } from 'vitest';
import { makeEnvelope } from '../shared/protocol.ts';
import type { ConnectionStatus } from '../shared/types.ts';
import { MultiplayerClient } from './multiplayerClient.ts';

describe('MultiplayerClient terminal auth error recovery', () => {
  let restoreGlobals: (() => void) | null = null;

  afterEach(() => {
    restoreGlobals?.();
    restoreGlobals = null;
  });

  it('closes socket, clears timers, and resets connectionStatus to disconnected on terminal room:error', async () => {
    const createdSockets: Array<{
      url: string;
      readyState: number;
      sent: string[];
      onopen: (() => void) | null;
      onmessage: ((ev: { data: string }) => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
      close: () => void;
      send: (d: string) => void;
    }> = [];

    class FakeBrowserWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      public readyState = 1;
      public sent: string[] = [];
      public onopen: (() => void) | null = null;
      public onmessage: ((ev: { data: string }) => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: (() => void) | null = null;
      public url: string;

      constructor(url: string) {
        this.url = url;
        createdSockets.push(this);
        queueMicrotask(() => {
          if (this.readyState === 1) this.onopen?.();
        });
      }

      send(data: string) {
        this.sent.push(data);
      }

      close() {
        this.readyState = 3;
      }
    }

    const g = globalThis as unknown as { window?: unknown; WebSocket?: unknown };
    const prevWindow = g.window;
    const prevWs = g.WebSocket;
    g.window = {
      location: { protocol: 'http:', host: 'localhost:3000' },
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    g.WebSocket = FakeBrowserWebSocket;
    restoreGlobals = () => {
      g.window = prevWindow;
      g.WebSocket = prevWs;
    };

    const statuses: ConnectionStatus[] = [];
    const errors: Array<{ msg: string; code?: string }> = [];
    const client = new MultiplayerClient({
      onJoined: () => {},
      onState: () => {},
      onError: (msg, code) => errors.push({ msg, code }),
      onConnectionChange: (s) => statuses.push(s),
    });

    await client.connect('ROOM1234', false);
    expect(createdSockets).toHaveLength(1);
    const firstSock = createdSockets[0];
    expect(firstSock.readyState).toBe(1);

    // Server sends terminal SESSION_EXPIRED error while socket is still open
    firstSock.onmessage?.({
      data: JSON.stringify(makeEnvelope('room:error', { code: 'SESSION_EXPIRED', message: 'انتهت الجلسة' })),
    });

    expect(errors[0]?.code).toBe('SESSION_EXPIRED');
    expect(firstSock.readyState).toBe(3);
    expect(statuses[statuses.length - 1]).toBe('disconnected');

    // Subsequent connect MUST open a brand-new WebSocket instead of reusing firstSock!
    await client.connect('NEWROOM8', false);
    expect(createdSockets).toHaveLength(2);
    expect(createdSockets[1].readyState).toBe(1);

    client.dispose();
  });

  it('locks duplicate in-flight create/join calls and reuses idempotencyKey across failed retries', async () => {
    class InstantWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      public readyState = 1;
      public onopen: (() => void) | null = null;
      public onmessage: ((ev: { data: string }) => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: (() => void) | null = null;
      constructor(_url: string) {
        queueMicrotask(() => {
          if (this.readyState === 1) this.onopen?.();
        });
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }

    const fetchCalls: Array<{ url: string; body: { idempotencyKey?: string } }> = [];
    let shouldFailCreate = true;
    const delayedFetchHolder: { resolve?: () => void } = {};

    const g = globalThis as unknown as {
      window?: unknown;
      WebSocket?: unknown;
      fetch?: unknown;
    };
    const prevWindow = g.window;
    const prevWs = g.WebSocket;
    const prevFetch = g.fetch;

    g.window = {
      location: { protocol: 'http:', host: 'localhost:3000' },
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    g.WebSocket = InstantWebSocket;
    g.fetch = async (url: string, init?: { body?: string }) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { idempotencyKey?: string };
      fetchCalls.push({ url: String(url), body: parsed });

      if (shouldFailCreate) {
        await new Promise<void>((r) => {
          delayedFetchHolder.resolve = r;
        });
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'عطل مؤقت' } }),
        };
      }

      return {
        ok: true,
        status: 201,
        json: async () => ({
          roomCode: 'ABCD2345',
          playerId: 'p-1',
          resumeToken: 'rt-1',
          sessionId: 's-1',
          connectionEpoch: 1,
          role: 'HOST',
          slot: 0,
          snapshot: {},
        }),
      };
    };

    restoreGlobals = () => {
      g.window = prevWindow;
      g.WebSocket = prevWs;
      g.fetch = prevFetch;
    };

    const client = new MultiplayerClient({
      onJoined: () => {},
      onState: () => {},
      onError: () => {},
      onConnectionChange: () => {},
    });

    const cosmetic = { hat: 'none' as const, glasses: 'none' as const, colorIndex: 0 };

    // 1. Short room code is rejected client-side without touching fetch
    await expect(client.joinRoom('A', 'لاعب', cosmetic)).rejects.toThrow();
    expect(fetchCalls).toHaveLength(0);

    // 2. Concurrent identical createRoom clicks share ONE HTTP call, while conflicting join rejects
    const p1 = client.createRoom('مضيف', cosmetic);
    const p2 = client.createRoom('مضيف', cosmetic);
    await expect(client.joinRoom('ABCD2345', 'مضيف', cosmetic)).rejects.toThrow();
    expect(fetchCalls).toHaveLength(1);

    delayedFetchHolder.resolve?.();
    await expect(p1).rejects.toThrow('عطل مؤقت');
    await expect(p2).rejects.toThrow('عطل مؤقت');

    const firstKey = fetchCalls[0].body.idempotencyKey;
    expect(typeof firstKey).toBe('string');
    expect(firstKey!.length).toBeGreaterThan(5);

    // 3. Retrying after failure reuses the EXACT same idempotencyKey
    shouldFailCreate = false;
    await client.createRoom('مضيف', cosmetic);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].body.idempotencyKey).toBe(firstKey);

    // 4. Subsequent new createRoom after success gets a fresh idempotencyKey
    await client.createRoom('مضيف', cosmetic);
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[2].body.idempotencyKey).not.toBe(firstKey);

    client.dispose();
  });
});
