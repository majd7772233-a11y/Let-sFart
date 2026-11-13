export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ROOMS: DurableObjectNamespace;
  RATE_LIMITER?: RateLimitBinding;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
}

export const INTERNAL_HEADER_NAME = 'x-raft-internal';
export const INTERNAL_HEADER_VALUE = 'worker-router-v1';
export const CLIENT_IP_HEADER_NAME = 'x-raft-client-ip';

export function parseAllowedOrigins(env: Env): string[] | null {
  if (!env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS.trim().length === 0) {
    return null;
  }
  const origins = env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return origins.length > 0 ? origins : null;
}

export function isOriginAllowed(request: Request, env: Env, requireOriginHeader = false): boolean {
  const allowed = parseAllowedOrigins(env);
  const origin = request.headers.get('origin');
  if (!allowed) {
    // Fail closed in production when ALLOWED_ORIGINS is omitted
    if (env.ENVIRONMENT === 'production') {
      return false;
    }
    return true;
  }
  if (!origin) {
    return !requireOriginHeader;
  }
  return allowed.includes(origin);
}

export function resolveCorsAllowOrigin(request: Request, env: Env): string | null {
  const allowed = parseAllowedOrigins(env);
  const origin = request.headers.get('origin');
  if (!allowed) {
    if (env.ENVIRONMENT === 'production') {
      return null;
    }
    return origin ?? '*';
  }
  if (origin && allowed.includes(origin)) {
    return origin;
  }
  return null;
}

export const LOCAL_WS_UPGRADE_SYMBOL = Symbol.for('letsfart.localWsUpgrade');

export interface LocalWsUpgradeMarker {
  status: 101;
  webSocket: WebSocket;
}

/**
 * Creates a WebSocketPair using Cloudflare Workers runtime or a registered global polyfill in Node dev/tests.
 */
export function createWebSocketPair(): [WebSocket, WebSocket] {
  const PairCtor = (globalThis as unknown as { WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket } })
    .WebSocketPair;
  if (!PairCtor) {
    throw new Error('WebSocketPair is not available in this runtime.');
  }
  const pair = new PairCtor();
  return [pair[0], pair[1]];
}

/**
 * Returns a standard CF Worker 101 WebSocket upgrade response, falling back cleanly
 * when Node's Undici Response disallows status 101 directly.
 */
export function createWebSocketUpgradeResponse(clientSocket: WebSocket): Response {
  try {
    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    } as unknown as ResponseInit);
  } catch {
    const res = new Response(null, { status: 200 });
    (res as unknown as Record<symbol, LocalWsUpgradeMarker>)[LOCAL_WS_UPGRADE_SYMBOL] = {
      status: 101,
      webSocket: clientSocket,
    };
    return res;
  }
}

export function extractLocalWsUpgrade(res: Response): LocalWsUpgradeMarker | null {
  return (res as unknown as Record<symbol, LocalWsUpgradeMarker | undefined>)[LOCAL_WS_UPGRADE_SYMBOL] ?? null;
}
