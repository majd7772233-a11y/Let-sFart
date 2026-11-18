import {
  GAME_VERSION,
  PROTOCOL_VERSION,
  type AuthHttpResponse,
  type BuyCosmeticHttpRequest,
  type BuyCosmeticHttpResponse,
  type ClaimQuestHttpResponse,
  type ClaimSeasonTierHttpResponse,
  type EquipCosmeticHttpRequest,
  type FriendsHttpResponse,
  type GuestAuthHttpRequest,
  type HttpErrorResponse,
  type LeaderboardHttpResponse,
  type LinkAccountHttpRequest,
  type LoginHttpRequest,
  type OpsAnalyticsHttpResponse,
  type OpsStatusHttpResponse,
  type ProfileSnapshotPayload,
  type RecordMatchHttpResponse,
  type RegisterHttpRequest,
  type ReplayDetailHttpResponse,
  type ReplayListHttpResponse,
  type SaveReplayHttpResponse,
  type UpdateProfileHttpRequest,
} from '../shared/protocol.ts';
import type {
  AccountProfile,
  CourseId,
  GameMode,
  LeaderboardMetric,
  LeaderboardScope,
  MatchSummaryInput,
  PlayerCareerStats,
  PlayerCosmetic,
  RoundReplayRecord,
  UnlockedAchievement,
} from '../shared/types.ts';

const ACCOUNT_TOKEN_STORAGE_KEY = 'letsfart_account_token';

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

export function extractProfileSnapshot(payload: ProfileSnapshotPayload): ProfileSnapshotPayload {
  return {
    profile: payload.profile,
    stats: payload.stats,
    achievements: payload.achievements,
    friends: payload.friends,
    ownedItemIds: payload.ownedItemIds ?? [],
    quests: payload.quests ?? [],
    season: payload.season,
    rareEvent: payload.rareEvent,
  };
}

export function getStoredAccountToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_TOKEN_STORAGE_KEY);
    return raw && raw.trim().length >= 16 ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredAccountToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token && token.trim().length >= 16) {
      window.localStorage.setItem(ACCOUNT_TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.localStorage.removeItem(ACCOUNT_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore quota errors
  }
}

async function apiRequest<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!headers.has('x-game-version')) {
    headers.set('x-game-version', GAME_VERSION);
  }
  if (!headers.has('x-protocol-version')) {
    headers.set('x-protocol-version', String(PROTOCOL_VERSION));
  }
  const activeToken = token !== undefined ? token : getStoredAccountToken();
  if (activeToken) {
    headers.set('authorization', `Bearer ${activeToken}`);
  }
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as HttpErrorResponse | null;
    const message = errBody?.error?.message || 'تعذر تنفيذ الطلب، يرجى المحاولة مجدداً.';
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = errBody?.error?.code;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export async function createGuestSession(req: GuestAuthHttpRequest = {}): Promise<AuthHttpResponse> {
  const data = await apiRequest<AuthHttpResponse>(
    '/api/v1/auth/guest',
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    null,
  );
  setStoredAccountToken(data.token);
  return data;
}

export async function fetchMyProfile(token?: string): Promise<ProfileSnapshotPayload> {
  return apiRequest<ProfileSnapshotPayload>('/api/v1/profile', { method: 'GET' }, token);
}

export async function ensureActiveAccountSession(defaults?: {
  displayName?: string;
  cosmetic?: PlayerCosmetic;
}): Promise<{ token: string; snapshot: ProfileSnapshotPayload }> {
  const existing = getStoredAccountToken();
  if (existing) {
    try {
      const snapshot = await fetchMyProfile(existing);
      return { token: existing, snapshot: extractProfileSnapshot(snapshot) };
    } catch {
      setStoredAccountToken(null);
    }
  }
  const guest = await createGuestSession({
    displayName: defaults?.displayName,
    cosmetic: defaults?.cosmetic,
  });
  return {
    token: guest.token,
    snapshot: extractProfileSnapshot(guest),
  };
}

export async function registerPermanentAccount(req: RegisterHttpRequest): Promise<AuthHttpResponse> {
  const data = await apiRequest<AuthHttpResponse>(
    '/api/v1/auth/register',
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    null,
  );
  setStoredAccountToken(data.token);
  return data;
}

export async function loginPermanentAccount(req: LoginHttpRequest): Promise<AuthHttpResponse> {
  const data = await apiRequest<AuthHttpResponse>(
    '/api/v1/auth/login',
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    null,
  );
  setStoredAccountToken(data.token);
  return data;
}

export async function linkGuestToPermanentAccount(req: LinkAccountHttpRequest): Promise<AuthHttpResponse> {
  const data = await apiRequest<AuthHttpResponse>('/api/v1/auth/link', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  setStoredAccountToken(data.token);
  return data;
}

export async function logoutAccount(): Promise<void> {
  const existing = getStoredAccountToken();
  if (existing) {
    try {
      await apiRequest<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }, existing);
    } catch {
      // ignore network failure on logout
    }
  }
  setStoredAccountToken(null);
}

export async function updateMyProfile(req: UpdateProfileHttpRequest): Promise<ProfileSnapshotPayload> {
  return apiRequest<ProfileSnapshotPayload>('/api/v1/profile', {
    method: 'PATCH',
    body: JSON.stringify(req),
  });
}

export async function startSoloRun(params: {
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: 'easy' | 'normal' | 'hard';
}): Promise<{ soloRunToken: string; issuedAt: number }> {
  return apiRequest<{ soloRunToken: string; issuedAt: number }>('/api/v1/progression/start-solo-run', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function recordAccountMatch(match: MatchSummaryInput): Promise<RecordMatchHttpResponse> {
  return apiRequest<RecordMatchHttpResponse>('/api/v1/progression/record-match', {
    method: 'POST',
    body: JSON.stringify(match),
  });
}

export async function buyCosmeticItem(req: BuyCosmeticHttpRequest): Promise<BuyCosmeticHttpResponse> {
  return apiRequest<BuyCosmeticHttpResponse>('/api/v1/shop/buy', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function equipCosmeticLook(req: EquipCosmeticHttpRequest): Promise<ProfileSnapshotPayload> {
  return apiRequest<ProfileSnapshotPayload>('/api/v1/shop/equip', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function claimQuestReward(questId: string): Promise<ClaimQuestHttpResponse> {
  return apiRequest<ClaimQuestHttpResponse>(`/api/v1/quests/${encodeURIComponent(questId)}/claim`, {
    method: 'POST',
  });
}

export async function claimSeasonTierReward(tier: number): Promise<ClaimSeasonTierHttpResponse> {
  return apiRequest<ClaimSeasonTierHttpResponse>(`/api/v1/season/tiers/${encodeURIComponent(String(tier))}/claim`, {
    method: 'POST',
  });
}

export async function fetchLeaderboard(params: {
  metric: LeaderboardMetric;
  scope: LeaderboardScope;
  courseId?: CourseId | 'all';
  partyIds?: string[];
}): Promise<LeaderboardHttpResponse> {
  const q = new URLSearchParams();
  q.set('metric', params.metric);
  q.set('scope', params.scope);
  if (params.courseId && params.courseId !== 'all') {
    q.set('courseId', params.courseId);
  }
  if (params.partyIds && params.partyIds.length > 0) {
    q.set('partyIds', params.partyIds.join(','));
  }
  return apiRequest<LeaderboardHttpResponse>(`/api/v1/leaderboard?${q.toString()}`, { method: 'GET' });
}

export async function addFriendByUsername(username: string): Promise<FriendsHttpResponse> {
  return apiRequest<FriendsHttpResponse>('/api/v1/friends', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export async function removeFriendById(accountId: string): Promise<FriendsHttpResponse> {
  return apiRequest<FriendsHttpResponse>(`/api/v1/friends/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  });
}

export async function fetchPublicAccountProfile(accountId: string): Promise<{
  profile: AccountProfile;
  stats: PlayerCareerStats;
  achievements: UnlockedAchievement[];
}> {
  return apiRequest(`/api/v1/profile/${encodeURIComponent(accountId)}`, { method: 'GET' });
}

// ==========================================
// TECH-04..07: Replays, Ops Monitoring & Course Balance Analytics
// ==========================================

export async function saveRoundReplay(replay: RoundReplayRecord): Promise<SaveReplayHttpResponse> {
  return apiRequest<SaveReplayHttpResponse>('/api/v1/replays', {
    method: 'POST',
    body: JSON.stringify({ replay }),
  });
}

export async function fetchRoundReplays(limit = 20, courseId?: CourseId): Promise<ReplayListHttpResponse> {
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  if (courseId) q.set('courseId', courseId);
  return apiRequest<ReplayListHttpResponse>(`/api/v1/replays?${q.toString()}`, { method: 'GET' });
}

export async function fetchRoundReplayDetail(matchId: string): Promise<ReplayDetailHttpResponse> {
  return apiRequest<ReplayDetailHttpResponse>(
    `/api/v1/replays/${encodeURIComponent(matchId)}`,
    { method: 'GET' },
  );
}

export async function fetchOpsStatus(adminKey?: string): Promise<OpsStatusHttpResponse> {
  const headers: Record<string, string> = {};
  if (adminKey && adminKey.trim().length > 0) {
    headers['x-ops-key'] = adminKey.trim();
  }
  return apiRequest<OpsStatusHttpResponse>('/api/v1/ops/status', {
    method: 'GET',
    headers,
  });
}

export async function fetchBalanceAnalytics(params?: {
  courseId?: CourseId;
  gameMode?: GameMode;
  adminKey?: string;
}): Promise<OpsAnalyticsHttpResponse> {
  const q = new URLSearchParams();
  if (params?.courseId) q.set('courseId', params.courseId);
  if (params?.gameMode) q.set('gameMode', params.gameMode);
  const headers: Record<string, string> = {};
  if (params?.adminKey && params.adminKey.trim().length > 0) {
    headers['x-ops-key'] = params.adminKey.trim();
  }
  const qs = q.toString();
  return apiRequest<OpsAnalyticsHttpResponse>(`/api/v1/ops/analytics${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers,
  });
}
