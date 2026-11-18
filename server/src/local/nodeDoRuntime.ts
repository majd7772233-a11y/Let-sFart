import { DatabaseSync } from 'node:sqlite';
import type { D1DatabaseLike, D1ExecResult, D1PreparedStatement, D1Result, Env } from '../env.ts';
import { RaftRoom } from '../rooms/RaftRoom.ts';
import type { SqlCursor, SqlStorageAdapter } from '../rooms/types.ts';

type SqliteBinding = string | number | bigint | Uint8Array | null;

function sanitizeD1Bindings(values: unknown[]): SqliteBinding[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || v instanceof Uint8Array) {
      return v;
    }
    return JSON.stringify(v);
  });
}

class LocalD1PreparedStatement implements D1PreparedStatement {
  private readonly db: DatabaseSync;
  private readonly query: string;
  private readonly bindings: SqliteBinding[];

  constructor(db: DatabaseSync, query: string, bindings: SqliteBinding[] = []) {
    this.db = db;
    this.query = query;
    this.bindings = bindings;
  }

  public bind(...values: unknown[]): D1PreparedStatement {
    return new LocalD1PreparedStatement(this.db, this.query, sanitizeD1Bindings(values));
  }

  private execRows<T>(): { rows: T[]; changes: number } {
    const stmt = this.db.prepare(this.query);
    const upper = this.query.trimStart().toUpperCase();
    const returnsRows =
      upper.startsWith('SELECT') || upper.startsWith('PRAGMA') || upper.includes('RETURNING');
    if (returnsRows) {
      const rows = stmt.all(...this.bindings) as T[];
      return { rows, changes: 0 };
    }
    const info = stmt.run(...this.bindings);
    return { rows: [], changes: Number(info.changes ?? 0) };
  }

  public async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const { rows } = this.execRows<Record<string, unknown>>();
    if (rows.length === 0) return null;
    const row = rows[0];
    if (colName !== undefined) {
      return (row[colName] as T) ?? null;
    }
    return row as T;
  }

  public async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const start = performance.now();
    const { rows, changes } = this.execRows<T>();
    return {
      results: rows,
      success: true,
      meta: { duration: performance.now() - start, changes },
    };
  }

  public async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.all<T>();
  }

  public async raw<T = unknown[]>(): Promise<T[]> {
    const { rows } = this.execRows<Record<string, unknown>>();
    return rows.map((r) => Object.values(r) as unknown as T);
  }
}

export class LocalD1Database implements D1DatabaseLike {
  private readonly db: DatabaseSync;

  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
  }

  public prepare(query: string): D1PreparedStatement {
    return new LocalD1PreparedStatement(this.db, query);
  }

  public async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        results.push(await stmt.all<T>());
      }
      this.db.exec('COMMIT');
      return results;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  public async exec(query: string): Promise<D1ExecResult> {
    const start = performance.now();
    this.db.exec(query);
    return { count: 1, duration: performance.now() - start };
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}

export function createNodeSqlAdapter(db: DatabaseSync): SqlStorageAdapter {
  let txDepth = 0;
  return {
    exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursor<T> {
      const stmt = db.prepare(query);
      const upper = query.trimStart().toUpperCase();
      const returnsRows =
        upper.startsWith('SELECT') ||
        upper.startsWith('PRAGMA') ||
        upper.includes('RETURNING');

      const typedBindings = bindings as Array<string | number | bigint | Uint8Array | null>;
      const rows = returnsRows ? (stmt.all(...typedBindings) as T[]) : (stmt.run(...typedBindings), []);

      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) {
            throw new Error(`Expected exactly 1 row, received ${rows.length}`);
          }
          return rows[0];
        },
      };
    },
    transactionSync<T>(fn: () => T): T {
      if (txDepth > 0) {
        return fn();
      }
      txDepth += 1;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        txDepth -= 1;
      }
    },
  };
}

export class LocalWebSocket implements EventTarget {
  public readyState = 1; // OPEN
  public peer: LocalWebSocket | null = null;
  private listeners = new Map<string, Set<(ev: Event) => void>>();
  private serializedAttachmentJson: string | null = null;

  public accept(): void {
    // No-op in local shim; readyState is already OPEN
  }

  public serializeAttachment(attachment: unknown): void {
    this.serializedAttachmentJson = attachment === undefined ? null : JSON.stringify(attachment);
  }

  public deserializeAttachment(): unknown {
    if (this.serializedAttachmentJson === null) return null;
    return JSON.parse(this.serializedAttachmentJson);
  }

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const fn = typeof listener === 'function' ? listener : (ev: Event) => listener.handleEvent(ev);
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  public removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const fn = typeof listener === 'function' ? listener : (ev: Event) => listener.handleEvent(ev);
    this.listeners.get(type)?.delete(fn);
  }

  public dispatchEvent(event: Event): boolean {
    const set = this.listeners.get(event.type);
    if (!set) return true;
    for (const fn of Array.from(set)) {
      fn(event);
    }
    return true;
  }

  public send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 1) return;
    const peer = this.peer;
    if (!peer || peer.readyState !== 1) return;

    queueMicrotask(() => {
      if (peer.readyState !== 1) return;
      peer.dispatchEvent(new MessageEvent('message', { data }));
    });
  }

  public close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.readyState = 3; // CLOSED
    const peer = this.peer;
    const makeClose = (): Event => {
      if (typeof CloseEvent !== 'undefined') {
        return new CloseEvent('close', { code, reason, wasClean: true });
      }
      const ev = new Event('close') as Event & { code: number; reason: string; wasClean: boolean };
      ev.code = code;
      ev.reason = reason;
      ev.wasClean = true;
      return ev;
    };
    queueMicrotask(() => {
      this.dispatchEvent(makeClose());
      if (peer && peer.readyState < 2) {
        peer.readyState = 3;
        peer.dispatchEvent(makeClose());
      }
    });
  }
}

export class LocalWebSocketPair {
  public 0: LocalWebSocket;
  public 1: LocalWebSocket;

  constructor() {
    const client = new LocalWebSocket();
    const server = new LocalWebSocket();
    client.peer = server;
    server.peer = client;
    this[0] = client;
    this[1] = server;
  }
}

export function installLocalWebSocketPairPolyfill(): void {
  const g = globalThis as unknown as { WebSocketPair?: unknown };
  if (!g.WebSocketPair) {
    g.WebSocketPair = LocalWebSocketPair;
  }
}

interface StoredDoEntry {
  id: DurableObjectId;
  instance: RaftRoom;
  db: DatabaseSync;
  sql: SqlStorageAdapter;
  acceptedSockets: Set<LocalWebSocket>;
  socketTags: Map<LocalWebSocket, string[]>;
  alarmTimer: ReturnType<typeof setTimeout> | null;
  ctxMock: DurableObjectState;
  disposed: boolean;
}

class LocalDurableObjectId implements DurableObjectId {
  public readonly name?: string;
  private readonly raw: string;

  constructor(raw: string, name?: string) {
    this.raw = raw;
    this.name = name;
  }

  public toString(): string {
    return this.raw;
  }

  public equals(other: DurableObjectId): boolean {
    return this.raw === other.toString();
  }
}

export class LocalDurableObjectNamespace {
  private entries = new Map<string, StoredDoEntry>();
  private env: Env | null = null;
  private localD1: LocalD1Database | null = null;

  public bindEnv(env: Env, localD1?: LocalD1Database): void {
    this.env = env;
    this.localD1 = localD1 ?? null;
  }

  public idFromName(name: string): DurableObjectId {
    return new LocalDurableObjectId(`do:${name}`, name);
  }

  public newUniqueId(): DurableObjectId {
    return new LocalDurableObjectId(`do:${crypto.randomUUID()}`);
  }

  public idFromString(id: string): DurableObjectId {
    return new LocalDurableObjectId(id);
  }

  public get(id: DurableObjectId): DurableObjectStub {
    const key = id.toString();
    let entry = this.entries.get(key);
    if (!entry) {
      const db = new DatabaseSync(':memory:');
      const sql = createNodeSqlAdapter(db);
      const acceptedSockets = new Set<LocalWebSocket>();
      const socketTags = new Map<LocalWebSocket, string[]>();
      const wiredSockets = new WeakSet<LocalWebSocket>();
      let entryRef: StoredDoEntry;

      const wireHibernationEvents = (localWs: LocalWebSocket): void => {
        if (wiredSockets.has(localWs)) return;
        wiredSockets.add(localWs);

        localWs.addEventListener('message', (ev) => {
          if (entryRef.disposed) return;
          const msgEv = ev as MessageEvent;
          void entryRef.instance.webSocketMessage(
            localWs as unknown as WebSocket,
            msgEv.data as string | ArrayBuffer,
          );
        });
        localWs.addEventListener('close', (ev) => {
          acceptedSockets.delete(localWs);
          socketTags.delete(localWs);
          if (entryRef.disposed) return;
          const closeEv = ev as Event & { code?: number; reason?: string; wasClean?: boolean };
          void entryRef.instance.webSocketClose(
            localWs as unknown as WebSocket,
            closeEv.code ?? 1000,
            closeEv.reason ?? '',
            closeEv.wasClean ?? true,
          );
        });
        localWs.addEventListener('error', (ev) => {
          if (entryRef.disposed) return;
          void entryRef.instance.webSocketError(localWs as unknown as WebSocket, ev);
        });
      };

      const storageMock = {
        sql,
        transactionSync: <T>(fn: () => T): T => sql.transactionSync!(fn),
        setAlarm: async (scheduledTime: number | Date) => {
          if (entryRef.disposed) return;
          const ts = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
          const delay = Math.max(10, ts - Date.now());
          if (entryRef.alarmTimer) clearTimeout(entryRef.alarmTimer);
          entryRef.alarmTimer = setTimeout(() => {
            entryRef.alarmTimer = null;
            if (entryRef.disposed) return;
            void entryRef.instance.alarm();
          }, Math.min(delay, 2_147_483_647));
          entryRef.alarmTimer.unref?.();
        },
        deleteAlarm: async () => {
          if (entryRef.alarmTimer) {
            clearTimeout(entryRef.alarmTimer);
            entryRef.alarmTimer = null;
          }
        },
      };

      const ctxMock = {
        id,
        storage: storageMock,
        acceptWebSocket: (ws: WebSocket, tags?: string[]) => {
          const localWs = ws as unknown as LocalWebSocket;
          acceptedSockets.add(localWs);
          if (tags) socketTags.set(localWs, tags);
          wireHibernationEvents(localWs);
        },
        getWebSockets: (tag?: string): WebSocket[] => {
          const active: WebSocket[] = [];
          for (const ws of acceptedSockets) {
            if (ws.readyState >= 2) {
              acceptedSockets.delete(ws);
              socketTags.delete(ws);
              continue;
            }
            if (tag !== undefined) {
              const tags = socketTags.get(ws);
              if (!tags || !tags.includes(tag)) continue;
            }
            active.push(ws as unknown as WebSocket);
          }
          return active;
        },
        blockConcurrencyWhile: async <T>(cb: () => Promise<T>): Promise<T> => cb(),
        waitUntil: (_p: Promise<unknown>) => {},
      } as unknown as DurableObjectState;

      const instance = new RaftRoom(ctxMock, this.env!);
      entryRef = { id, instance, db, sql, acceptedSockets, socketTags, alarmTimer: null, ctxMock, disposed: false };
      this.entries.set(key, entryRef);
      entry = entryRef;
    }

    const activeEntry = entry;
    return {
      id,
      name: id.name,
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const req = input instanceof Request ? input : new Request(input, init);
        return activeEntry.instance.fetch(req);
      },
    } as unknown as DurableObjectStub;
  }

  /**
   * Simulates Durable Object memory eviction + hibernation wake-up for tests:
   * reconstructs RaftRoom using the exact same SQLite DB & open WebSockets/attachments.
   */
  public simulateDormantWakeUp(roomCode: string): RaftRoom {
    const id = this.idFromName(roomCode.trim().toUpperCase());
    const entry = this.entries.get(id.toString());
    if (!entry) {
      throw new Error(`No Durable Object entry for ${roomCode}`);
    }
    // Stop in-memory loop without closing the underlying accepted sockets or SQLite DB
    const prevInstance = entry.instance as unknown as { stopLoop?: () => void };
    prevInstance.stopLoop?.();
    entry.instance = new RaftRoom(entry.ctxMock, this.env!);
    return entry.instance;
  }

  public getEntryInstance(roomCode: string): RaftRoom | null {
    const id = this.idFromName(roomCode.trim().toUpperCase());
    return this.entries.get(id.toString())?.instance ?? null;
  }

  public disposeAll(): void {
    for (const entry of this.entries.values()) {
      entry.disposed = true;
      if (entry.alarmTimer) clearTimeout(entry.alarmTimer);
      entry.instance.dispose();
      entry.acceptedSockets.clear();
      entry.socketTags.clear();
      try {
        entry.db.close();
      } catch {
        // already closed
      }
    }
    this.entries.clear();
    this.localD1?.close();
  }
}

export function createLocalWorkerEnv(): {
  env: Env;
  namespace: LocalDurableObjectNamespace;
  d1: LocalD1Database;
} {
  installLocalWebSocketPairPolyfill();
  const namespace = new LocalDurableObjectNamespace();
  const d1 = new LocalD1Database(':memory:');
  const env: Env = {
    ROOMS: namespace as unknown as DurableObjectNamespace,
    DB: d1,
    ENVIRONMENT: 'local-node',
  };
  namespace.bindEnv(env, d1);
  return { env, namespace, d1 };
}
