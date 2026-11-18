import type { BatchOnlineMatchParticipant } from '../../../src/shared/protocol.ts';
import type { PlayerCosmetic } from '../../../src/shared/types.ts';
import {
  INTERNAL_HEADER_NAME,
  INTERNAL_HEADER_VALUE,
  type Env,
} from '../env.ts';

export const PROGRESSION_DO_NAME = '__PROGRESSION';

export function getProgressionStub(env: Env): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(PROGRESSION_DO_NAME));
}

function makeInternalProgressionRequest(
  path: string,
  init?: RequestInit,
  incomingHeaders?: Headers,
): Request {
  const headers = new Headers(init?.headers);
  headers.set(INTERNAL_HEADER_NAME, INTERNAL_HEADER_VALUE);
  const auth = incomingHeaders?.get('authorization');
  if (auth && !headers.has('authorization')) {
    headers.set('authorization', auth);
  }
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(`https://raft-room.internal${path}`, {
    ...init,
    headers,
  });
}

export async function forwardProgressionRequest(
  env: Env,
  internalPathWithQuery: string,
  request: Request,
): Promise<Response> {
  const stub = getProgressionStub(env);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const rawBody = hasBody ? await request.text() : undefined;
  return stub.fetch(
    makeInternalProgressionRequest(
      internalPathWithQuery,
      {
        method: request.method,
        ...(rawBody !== undefined ? { body: rawBody } : {}),
      },
      request.headers,
    ),
  );
}

export interface ResolvedAccountIdentity {
  found: true;
  accountId: string;
  displayName: string;
  cosmetic: PlayerCosmetic;
  level: number;
}

export async function resolveAccountTokenViaService(
  env: Env,
  token: string | undefined | null,
): Promise<ResolvedAccountIdentity | null> {
  if (!token || typeof token !== 'string' || token.trim().length < 16) {
    return null;
  }
  try {
    const stub = getProgressionStub(env);
    const res = await stub.fetch(
      makeInternalProgressionRequest('/internal/prog/resolve-token', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      }),
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      found?: boolean;
      accountId?: string;
      displayName?: string;
      cosmetic?: PlayerCosmetic;
      level?: number;
    };
    if (!data.found || !data.accountId) return null;
    return {
      found: true,
      accountId: data.accountId,
      displayName: data.displayName ?? 'قبطان',
      cosmetic: data.cosmetic ?? { hat: 'none', glasses: 'none', colorIndex: 0 },
      level: typeof data.level === 'number' ? data.level : 1,
    };
  } catch {
    return null;
  }
}

export async function recordOnlineBatchViaService(
  env: Env,
  participants: BatchOnlineMatchParticipant[],
): Promise<void> {
  if (!env?.ROOMS || participants.length === 0) return;
  try {
    const stub = getProgressionStub(env);
    await stub.fetch(
      makeInternalProgressionRequest('/internal/prog/record-batch', {
        method: 'POST',
        body: JSON.stringify({ participants }),
      }),
    );
  } catch {
    // Best-effort recording; client victory modal also reconciles with idempotent submissionKey
  }
}
