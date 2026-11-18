import type { SqlStorageAdapter } from '../rooms/types.ts';

export type RateChannel = 'input' | 'control' | 'ping' | 'auth' | 'chat' | 'emote';

interface BucketConfig {
  capacity: number;
  refillPerMs: number;
}

const CHANNEL_LIMITS: Record<RateChannel, BucketConfig> = {
  // Generous for 30Hz input + keepalives + fast taps, blocks floods > 50/sec
  input: { capacity: 50, refillPerMs: 45 / 1000 },
  // Control actions (ready, cosmetic, start, restart, toggleBots, resync)
  control: { capacity: 12, refillPerMs: 6 / 1000 },
  // Chat messages (burst 8, sustain ~1.5/sec)
  chat: { capacity: 8, refillPerMs: 1.5 / 1000 },
  // Emotes (burst 6, sustain ~2/sec)
  emote: { capacity: 6, refillPerMs: 2 / 1000 },
  // Heartbeat pings
  ping: { capacity: 6, refillPerMs: 2 / 1000 },
  // Failed or repeated session authentication attempts per playerId
  auth: { capacity: 10, refillPerMs: 10 / 60_000 },
};

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export class SessionRateLimiter {
  private buckets = new Map<string, Record<RateChannel, BucketState>>();

  public consume(key: string, channel: RateChannel, nowMs = Date.now()): boolean {
    const cfg = CHANNEL_LIMITS[channel];
    let record = this.buckets.get(key);
    if (!record) {
      record = {
        input: { tokens: CHANNEL_LIMITS.input.capacity, lastRefillMs: nowMs },
        control: { tokens: CHANNEL_LIMITS.control.capacity, lastRefillMs: nowMs },
        chat: { tokens: CHANNEL_LIMITS.chat.capacity, lastRefillMs: nowMs },
        emote: { tokens: CHANNEL_LIMITS.emote.capacity, lastRefillMs: nowMs },
        ping: { tokens: CHANNEL_LIMITS.ping.capacity, lastRefillMs: nowMs },
        auth: { tokens: CHANNEL_LIMITS.auth.capacity, lastRefillMs: nowMs },
      };
      this.buckets.set(key, record);
    }

    const bucket = record[channel];
    const elapsed = Math.max(0, nowMs - bucket.lastRefillMs);
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsed * cfg.refillPerMs);
    bucket.lastRefillMs = nowMs;

    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  public clear(key: string): void {
    this.buckets.delete(key);
  }
}

export type HttpRateChannel = 'create' | 'join' | 'info' | 'ws';

export const HTTP_CHANNEL_LIMITS: Record<HttpRateChannel, BucketConfig> = {
  create: { capacity: 12, refillPerMs: 12 / 60_000 },
  join: { capacity: 30, refillPerMs: 30 / 60_000 },
  info: { capacity: 60, refillPerMs: 60 / 60_000 },
  ws: { capacity: 30, refillPerMs: 30 / 60_000 },
};

export class HttpIpRateLimiter {
  private buckets = new Map<string, Record<HttpRateChannel, BucketState>>();

  public consume(clientKey: string, channel: HttpRateChannel, nowMs = Date.now()): boolean {
    if (this.buckets.size > 4096) {
      this.pruneStale(nowMs);
    }

    const cfg = HTTP_CHANNEL_LIMITS[channel];
    let record = this.buckets.get(clientKey);
    if (!record) {
      record = {
        create: { tokens: HTTP_CHANNEL_LIMITS.create.capacity, lastRefillMs: nowMs },
        join: { tokens: HTTP_CHANNEL_LIMITS.join.capacity, lastRefillMs: nowMs },
        info: { tokens: HTTP_CHANNEL_LIMITS.info.capacity, lastRefillMs: nowMs },
        ws: { tokens: HTTP_CHANNEL_LIMITS.ws.capacity, lastRefillMs: nowMs },
      };
      this.buckets.set(clientKey, record);
    }

    const bucket = record[channel];
    const elapsed = Math.max(0, nowMs - bucket.lastRefillMs);
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsed * cfg.refillPerMs);
    bucket.lastRefillMs = nowMs;

    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  public clearAll(): void {
    this.buckets.clear();
  }

  private pruneStale(nowMs: number): void {
    for (const [key, rec] of this.buckets.entries()) {
      const oldest = Math.max(rec.create.lastRefillMs, rec.join.lastRefillMs, rec.info.lastRefillMs, rec.ws.lastRefillMs);
      if (nowMs - oldest > 5 * 60_000) {
        this.buckets.delete(key);
      }
    }
  }
}

interface StoredBucketRow {
  result_json: string;
  expires_at: number;
}

/**
 * Persistent DO SQLite token-bucket rate limiter surviving Worker isolate resets & DO hibernation.
 */
export function consumeDurableTokenBucket(
  sql: SqlStorageAdapter,
  bucketKey: string,
  capacity: number,
  refillPerMs: number,
  ttlMs = 5 * 60_000,
  nowMs = Date.now(),
): boolean {
  const apply = (): boolean => {
    const rows = sql
      .exec<StoredBucketRow>(
        `SELECT result_json, expires_at FROM room_requests WHERE request_key = ? LIMIT 1`,
        bucketKey,
      )
      .toArray();

    let state: BucketState = { tokens: capacity, lastRefillMs: nowMs };
    if (rows.length > 0 && nowMs < rows[0].expires_at) {
      try {
        const parsed = JSON.parse(rows[0].result_json) as Partial<BucketState>;
        if (typeof parsed.tokens === 'number' && typeof parsed.lastRefillMs === 'number') {
          const elapsed = Math.max(0, nowMs - parsed.lastRefillMs);
          state = {
            tokens: Math.min(capacity, parsed.tokens + elapsed * refillPerMs),
            lastRefillMs: nowMs,
          };
        }
      } catch {
        // reset malformed bucket
      }
    }

    const allowed = state.tokens >= 1;
    if (allowed) {
      state.tokens -= 1;
    }

    sql.exec(
      `INSERT INTO room_requests (request_key, room_code, operation, result_json, expires_at)
       VALUES (?, 'RATE_LIMIT', 'rate_limit', ?, ?)
       ON CONFLICT(request_key) DO UPDATE SET
         result_json = excluded.result_json,
         expires_at = excluded.expires_at`,
      bucketKey,
      JSON.stringify(state),
      nowMs + ttlMs,
    );
    return allowed;
  };

  return sql.transactionSync ? sql.transactionSync(apply) : apply();
}

export function extractClientIpKey(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim().length > 0) return cfIp.trim().slice(0, 64);
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim().length > 0) return xff.split(',')[0].trim().slice(0, 64);
  return 'local-client';
}
