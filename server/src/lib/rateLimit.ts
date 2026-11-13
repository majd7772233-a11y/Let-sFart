export type RateChannel = 'input' | 'control' | 'ping';

interface BucketConfig {
  capacity: number;
  refillPerMs: number;
}

const CHANNEL_LIMITS: Record<RateChannel, BucketConfig> = {
  // Generous for 30Hz input + keepalives + fast taps, blocks floods > 50/sec
  input: { capacity: 50, refillPerMs: 45 / 1000 },
  // Control actions (ready, cosmetic, start, restart, toggleBots, resync)
  control: { capacity: 12, refillPerMs: 6 / 1000 },
  // Heartbeat pings
  ping: { capacity: 6, refillPerMs: 2 / 1000 },
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
        ping: { tokens: CHANNEL_LIMITS.ping.capacity, lastRefillMs: nowMs },
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

const HTTP_CHANNEL_LIMITS: Record<HttpRateChannel, BucketConfig> = {
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

export function extractClientIpKey(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim().length > 0) return cfIp.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim().length > 0) return xff.split(',')[0].trim();
  return 'local-client';
}
