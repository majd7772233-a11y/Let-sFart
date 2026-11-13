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
});
