import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GAME_VERSION,
  PROTOCOL_VERSION,
  type AuthHttpResponse,
  type HttpErrorResponse,
  type OpsAnalyticsHttpResponse,
  type OpsStatusHttpResponse,
  type RecordMatchHttpResponse,
  type ReplayDetailHttpResponse,
  type ReplayListHttpResponse,
  type SaveReplayHttpResponse,
} from '../../src/shared/protocol.ts';
import { createInitialSimState, DEFAULT_ROOM_SETTINGS } from '../../src/shared/physics.ts';
import type { MatchSummaryInput, RoundReplayRecord, VerifiedMatchRecord } from '../../src/shared/types.ts';
import { getBalanceAnalyticsFromD1, recordVerifiedMatchInD1, saveRoundReplayInD1 } from '../src/db/d1Store.ts';
import { activateTempBotSubstitutesIfNeeded, syncBotsInRoom } from '../src/rooms/lifecycle.ts';
import { BOT_SUBSTITUTE_DELAY_MS, type RoomRecord } from '../src/rooms/types.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { recordOnlineBatchViaService } from '../src/services/progressionService.ts';
import { connectAndAuthWs, createRoomHttp, flush, joinRoomHttp, setupTestEnv } from './helpers.ts';

function headers(token?: string, extra?: Record<string, string>): Record<string, string> {
  return {
    origin: 'http://localhost:3000',
    'content-type': 'application/json',
    'x-game-version': GAME_VERSION,
    'x-protocol-version': String(PROTOCOL_VERSION),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

describe('BOT-04 & TECH-01..07: Temp Bot Takeover, D1 Idempotency, Result Verification, Replays, Ops & Version Gating', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('BOT-04: disconnected human during active gameplay gets temporary AI substitute after 6s and reclaims seat on reconnect', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const host = await createRoomHttp(env, 'مضيف');
    const p2Res = await joinRoomHttp(env, host.roomCode, 'لاعب_منقطع');
    expect(p2Res.status).toBe(200);
    const p2 = (await p2Res.json()) as typeof host;

    const hostConn = await connectAndAuthWs(env, host);
    const p2Conn = await connectAndAuthWs(env, p2);
    const p2Renewed1 = p2Conn.msgs.find((m) => m.type === 'session:renewed');
    const p2Token2 = p2Renewed1?.type === 'session:renewed' && p2Renewed1.payload ? p2Renewed1.payload.resumeToken : p2.resumeToken;

    // Ready p2 & start game
    p2Conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'rd-sub', type: 'room:ready', payload: { ready: true } }));
    await flush(30);
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'st-sub', type: 'room:start', payload: {} }));
    await flush(60);

    const roomInfoRes = await routeWorkerRequest(new Request(`http://localhost/api/v1/rooms/${host.roomCode}`), env);
    expect(roomInfoRes.status).toBe(200);

    // Disconnect p2 socket
    p2Conn.ws.close(1000, 'DROP');
    await flush(40);

    const statusBefore = await (
      await routeWorkerRequest(new Request('http://localhost/api/v1/ops/status'), env)
    ).json() as OpsStatusHttpResponse;
    expect(statusBefore.disconnectCount).toBeGreaterThanOrEqual(1);

    // Fetch internal RoomRecord via DO debug? Instead test lifecycle helpers directly on a realistic RoomRecord snapshot
    // AND verify reconnect via WS restores human control!
    // Let's also directly test activateTempBotSubstitutesIfNeeded with a simulated 7-second disconnect
    const fakeLastSeen = Date.now() - (BOT_SUBSTITUTE_DELAY_MS + 1000);
    const simState = (
      await (
        await routeWorkerRequest(new Request(`http://localhost/api/v1/rooms/${host.roomCode}`), env)
      ).json()
    ) as { playerCount: number };
    expect(simState.playerCount).toBe(2);

    // Reconnect p2 via WS using rotated token and ensure session:renewed + room:joined preserve slot 1
    const p2Reconn = await connectAndAuthWs(env, { ...p2, resumeToken: p2Token2 });
    const renewed = p2Reconn.msgs.find((m) => m.type === 'session:renewed');
    expect(renewed).toBeDefined();
    const joined2 = p2Reconn.msgs.find((m) => m.type === 'room:joined');
    expect(joined2?.type === 'room:joined' ? joined2.payload?.slot : -1).toBe(1);

    // Direct unit check on activateTempBotSubstitutesIfNeeded + handback
    const mockSim = createInitialSimState(
      'online',
      'المضيف',
      undefined,
      'tropical',
      DEFAULT_ROOM_SETTINGS,
    );
    const mockRoom: RoomRecord = {
      roomCode: 'TEST01',
      lifecycleState: 'PLAYING',
      roundSeq: 1,
      hostId: 'host-1',
      fillBots: true,
      isPrivate: false,
      passwordHash: null,
      settings: { ...DEFAULT_ROOM_SETTINGS },
      courseId: 'tropical',
      courseSelectionMode: 'host',
      courseVotes: {},
      playlistQueue: [],
      recentChat: [],
      emoteSeq: 0,
      idempotencyKey: null,
      createdAt: fakeLastSeen - 10_000,
      expiresAt: Date.now() + 60_000,
      emptySinceMs: null,
      snapshotSeq: 1,
      accumulatorSec: 0,
      sim: mockSim,
      recentEvents: [],
      sessions: new Map([
        [
          'host-1',
          {
            playerId: 'host-1',
            roomCode: 'TEST01',
            slot: 0,
            role: 'HOST',
            name: 'المضيف',
            cosmetic: { hat: 'none', glasses: 'none', colorIndex: 0 },
            resumeTokenHash: 'h-1',
            sessionId: 'sess-1',
            connectionEpoch: 1,
            connected: true,
            ready: true,
            revoked: false,
            joinedAt: fakeLastSeen - 10_000,
            lastSeenAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            lastInputSeq: 0,
          },
        ],
        [
          'p2-id',
          {
            playerId: 'p2-id',
            roomCode: 'TEST01',
            slot: 1,
            role: 'PLAYER',
            name: 'بطل',
            cosmetic: { hat: 'crown', glasses: 'none', colorIndex: 1 },
            resumeTokenHash: 'h-2',
            sessionId: 'sess-2',
            connectionEpoch: 1,
            connected: false,
            ready: true,
            revoked: false,
            joinedAt: fakeLastSeen - 5000,
            lastSeenAt: fakeLastSeen,
            expiresAt: Date.now() + 8000,
            lastInputSeq: 0,
          },
        ],
      ]),
    };
    syncBotsInRoom(mockRoom, fakeLastSeen);
    const activated = activateTempBotSubstitutesIfNeeded(mockRoom, Date.now());
    expect(activated).toBe(true);
    expect(mockRoom.sim.players[1].tempBotSubstitute).toBe(true);
    expect(mockRoom.sim.players[1].isBot).toBe(true);
    expect(mockRoom.sim.players[1].connected).toBe(true);
    expect(mockRoom.sim.players[1].seatStatus).toBe('RECONNECTING');

    // Simulate player returning
    mockRoom.sessions.get('p2-id')!.connected = true;
    const handedBack = activateTempBotSubstitutesIfNeeded(mockRoom, Date.now());
    expect(handedBack).toBe(true);
    expect(mockRoom.sim.players[1].tempBotSubstitute).toBe(false);
    expect(mockRoom.sim.players[1].isBot).toBe(false);
    expect(mockRoom.sim.players[1].seatStatus).toBe('CONNECTED');
  });

  it('TECH-01 & TECH-02 & TECH-07: D1 verified match persistence is idempotent and powers balance analytics', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const first = await recordVerifiedMatchInD1(env.DB, {
      matchId: 'm-1',
      submissionKey: 'unique-sub-1',
      roomCode: null,
      accountId: 'acc-1',
      mode: 'solo',
      courseId: 'volcanic',
      gameMode: 'standard',
      difficulty: 'hard',
      outcome: 'victory',
      elapsedTimeSec: 42.5,
      falls: 1,
      itemsUsed: 3,
      collisionCount: 4,
      treasureScore: 0,
      survivalDistance: 0,
      minRaftHp: 68,
      verifiedAt: Date.now(),
    });
    expect(first.inserted).toBe(true);

    // Duplicate submissionKey must NOT double-insert or inflate rollups
    const dup = await recordVerifiedMatchInD1(env.DB, {
      matchId: 'm-1-dup',
      submissionKey: 'unique-sub-1',
      roomCode: null,
      accountId: 'acc-1',
      mode: 'solo',
      courseId: 'volcanic',
      gameMode: 'standard',
      difficulty: 'hard',
      outcome: 'victory',
      elapsedTimeSec: 42.5,
      falls: 1,
      itemsUsed: 3,
      collisionCount: 4,
      treasureScore: 0,
      survivalDistance: 0,
      minRaftHp: 68,
      verifiedAt: Date.now(),
    });
    expect(dup.inserted).toBe(false);

    const analyticsRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/ops/analytics?courseId=volcanic', { headers: headers() }),
      env,
    );
    expect(analyticsRes.status).toBe(200);
    const analytics = (await analyticsRes.json()) as OpsAnalyticsHttpResponse;
    expect(analytics.totalVerifiedMatches).toBe(1);
    expect(analytics.courses.length).toBe(1);
    expect(analytics.courses[0].totalRuns).toBe(1);
    expect(analytics.courses[0].winRatePct).toBe(100);
    expect(analytics.courses[0].avgClearTimeSec).toBeCloseTo(42.5, 1);
  });

  it('TECH-03: server result verification rejects impossible 1-second win with 422 and accepts plausible result', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ displayName: 'مختبر التحقق' }),
      }),
      env,
    );
    const guest = (await guestRes.json()) as { token: string };

    // 1. Impossible 1-second victory -> 422 RESULT_VERIFICATION_FAILED
    const cheatedMatch: MatchSummaryInput = {
      submissionKey: 'cheat-1',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      outcome: 'victory',
      elapsedTimeSec: 1.0,
      falls: 0,
      treasureScore: 0,
      survivalDistance: 0,
      itemsUsed: 0,
      pushContribution: 500,
      fartTimeSec: 0.8,
      harmonyCombos: 0,
      hardGatesPassed: 0,
      cleanCheckpoints: 2,
      minRaftHp: 100,
      isOnline: false,
    };
    const cheatRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify(cheatedMatch),
      }),
      env,
    );
    expect(cheatRes.status).toBe(422);
    const cheatErr = (await cheatRes.json()) as HttpErrorResponse;
    expect(cheatErr.error.code).toBe('RESULT_VERIFICATION_FAILED');

    // 2. Plausible victory with server-issued soloRunToken -> 200
    const tokRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/start-solo-run', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ courseId: 'tropical', gameMode: 'standard', difficulty: 'normal' }),
      }),
      env,
    );
    expect(tokRes.status).toBe(201);
    const { soloRunToken } = (await tokRes.json()) as { soloRunToken: string };

    const legitMatch: MatchSummaryInput = {
      submissionKey: 'legit-1',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      outcome: 'victory',
      elapsedTimeSec: 36.4,
      falls: 1,
      treasureScore: 0,
      survivalDistance: 0,
      itemsUsed: 2,
      pushContribution: 340,
      fartTimeSec: 14.5,
      harmonyCombos: 2,
      hardGatesPassed: 1,
      cleanCheckpoints: 2,
      minRaftHp: 74,
      isOnline: false,
      soloRunToken,
    };
    const nowSpyLegit = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 45_000);
    const legitRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify(legitMatch),
      }),
      env,
    );
    nowSpyLegit.mockRestore();
    expect(legitRes.status).toBe(200);
    const reward = (await legitRes.json()) as RecordMatchHttpResponse;
    expect(reward.xpEarned).toBeGreaterThan(0);

    // Health snapshot reflects 1 verified and 1 rejected match
    const opsRes = await routeWorkerRequest(new Request('http://localhost/api/v1/ops/status'), env);
    const ops = (await opsRes.json()) as OpsStatusHttpResponse;
    expect(ops.rejectedMatchesCount).toBeGreaterThanOrEqual(1);
    expect(ops.verifiedMatchesCount).toBeGreaterThanOrEqual(1);
  });

  it('TECH-04: round replay save, list, and detail retrieval roundtrip', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ displayName: 'قبطان الإعادة' }),
      }),
      env,
    );
    const guest = (await guestRes.json()) as AuthHttpResponse;

    const replay: RoundReplayRecord = {
      matchId: 'solo:replay-test-1',
      roomCode: null,
      mode: 'solo',
      courseId: 'glacial',
      gameMode: 'time_trial',
      difficulty: 'normal',
      botDifficulty: 'hard',
      outcome: 'victory',
      durationSec: 38.5,
      falls: 0,
      treasureScore: 0,
      survivalDistance: 0,
      minRaftHp: 88,
      createdAt: Date.now(),
      players: [
        { slot: 0, name: 'قبطان', isBot: false, colorIndex: 0, pushContribution: 220 },
        { slot: 1, name: 'مساعد 1', isBot: true, botPersonality: 'rusher', colorIndex: 1, pushContribution: 195 },
      ],
      frames: [
        { t: 0, x: 0, z: 0, yaw: 0, progress: 0, raftHp: 100, harmony: 0.2, windX: 0 },
        { t: 19, x: 1.5, z: -180, yaw: -0.1, progress: 0.5, raftHp: 90, harmony: 0.85, windX: 1.2 },
        { t: 38.5, x: 0.2, z: -360, yaw: 0, progress: 1, raftHp: 88, harmony: 0.9, windX: 0 },
      ],
      events: [
        { t: 19, type: 'checkpoint', x: 1.5, z: -180, intensity: 1 },
        { t: 38.5, type: 'finish', x: 0.2, z: -360, intensity: 1 },
      ],
    };

    const saveRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/replays', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ replay }),
      }),
      env,
    );
    expect(saveRes.status).toBe(201);
    const saved = (await saveRes.json()) as SaveReplayHttpResponse;
    expect(saved.ok).toBe(true);
    expect(saved.frameCount).toBe(3);

    const listRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/replays?courseId=glacial', { headers: headers() }),
      env,
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as ReplayListHttpResponse;
    expect(list.replays.some((r) => r.matchId === saved.matchId)).toBe(true);

    const detailRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/replays/${encodeURIComponent(saved.matchId)}`, {
        headers: headers(),
      }),
      env,
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as ReplayDetailHttpResponse;
    expect(detail.replay.frames).toHaveLength(3);
    expect(detail.replay.players[1].botPersonality).toBe('rusher');
  });

  it('TECH-05 & TECH-06: rejects incompatible protocol version with 426 and guards ops endpoints when OPS_ADMIN_KEY is configured', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Protocol mismatch -> 426 PROTOCOL_MISMATCH
    const mismatchRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'GET',
        headers: {
          'x-protocol-version': '99',
          'x-game-version': '9.9.0',
        },
      }),
      env,
    );
    expect(mismatchRes.status).toBe(426);
    const mismatchBody = (await mismatchRes.json()) as HttpErrorResponse;
    expect(mismatchBody.error.code).toBe('PROTOCOL_MISMATCH');

    // Health endpoint returns gameVersion & minCompatibleProtocolVersion
    const healthRes = await routeWorkerRequest(new Request('http://localhost/api/health'), env);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { gameVersion: string; protocolVersion: number };
    expect(healthJson.gameVersion).toBe(GAME_VERSION);
    expect(healthJson.protocolVersion).toBe(PROTOCOL_VERSION);

    // Optional OPS_ADMIN_KEY enforcement
    env.OPS_ADMIN_KEY = 'super-secret-ops';
    const unauthOps = await routeWorkerRequest(new Request('http://localhost/api/v1/ops/status'), env);
    expect(unauthOps.status).toBe(401);

    const authOps = await routeWorkerRequest(
      new Request('http://localhost/api/v1/ops/status', {
        headers: { 'x-ops-key': 'super-secret-ops' },
      }),
      env,
    );
    expect(authOps.status).toBe(200);
  });

  it('AUDIT P1-1: ops endpoints fail closed in production without OPS_ADMIN_KEY and reject query-string keys', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Production with missing OPS_ADMIN_KEY -> fail closed (401)
    env.ENVIRONMENT = 'production';
    env.ALLOWED_ORIGINS = 'http://localhost:3000';
    delete env.OPS_ADMIN_KEY;
    const statusNoKey = await routeWorkerRequest(
      new Request('http://localhost/api/v1/ops/status', { headers: headers() }),
      env,
    );
    expect(statusNoKey.status).toBe(401);
    const analyticsNoKey = await routeWorkerRequest(
      new Request('http://localhost/api/v1/ops/analytics', { headers: headers() }),
      env,
    );
    expect(analyticsNoKey.status).toBe(401);

    // Query string key must be rejected even when OPS_ADMIN_KEY is configured
    env.OPS_ADMIN_KEY = 'prod-ops-secret-123';
    const qsAttempt = await routeWorkerRequest(
      new Request('http://localhost/api/v1/ops/status?adminKey=prod-ops-secret-123', { headers: headers() }),
      env,
    );
    expect(qsAttempt.status).toBe(401);

    // Header key succeeds
    const headerAttempt = await routeWorkerRequest(
      new Request('http://localhost/api/v1/ops/status', {
        headers: headers(undefined, { 'x-ops-key': 'prod-ops-secret-123' }),
      }),
      env,
    );
    expect(headerAttempt.status).toBe(200);
  });

  it('AUDIT P1-2: blocks forged client online matches, missing/reused soloRunToken, and inflated achievement counters', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ displayName: 'مختبر الحماية' }),
      }),
      env,
    );
    const guest = (await guestRes.json()) as AuthHttpResponse;

    const baseMatch: MatchSummaryInput = {
      submissionKey: 'forge-1',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      outcome: 'victory',
      elapsedTimeSec: 40,
      falls: 0,
      itemsUsed: 2,
      pushContribution: 200,
      fartTimeSec: 12,
      survivalDistance: 0,
      treasureScore: 0,
      harmonyCombos: 1,
      hardGatesPassed: 2,
      cleanCheckpoints: 2,
      minRaftHp: 90,
      isOnline: false,
    };

    // 1. Client claiming isOnline: true -> 403
    const onlineForgeRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ ...baseMatch, isOnline: true }),
      }),
      env,
    );
    expect(onlineForgeRes.status).toBe(403);

    // 2. Solo match without soloRunToken -> 422
    const noTokRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify(baseMatch),
      }),
      env,
    );
    expect(noTokRes.status).toBe(422);

    // 3. Inflated hardGatesPassed / cleanCheckpoints even with valid token -> 422
    const tok1Res = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/start-solo-run', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ courseId: 'tropical', gameMode: 'standard', difficulty: 'normal' }),
      }),
      env,
    );
    const { soloRunToken: tok1 } = (await tok1Res.json()) as { soloRunToken: string };

    const inflatedRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ ...baseMatch, hardGatesPassed: 999, soloRunToken: tok1 }),
      }),
      env,
    );
    expect(inflatedRes.status).toBe(422);

    // 4. Valid token works once after real elapsed time, then reusing it on a different submissionKey is rejected -> 422
    const nowSpyValid = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 45_000);
    const validRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ ...baseMatch, submissionKey: 'valid-once', soloRunToken: tok1 }),
      }),
      env,
    );
    nowSpyValid.mockRestore();
    expect(validRes.status).toBe(200);

    const reuseRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ ...baseMatch, submissionKey: 'reuse-attempt', soloRunToken: tok1 }),
      }),
      env,
    );
    expect(reuseRes.status).toBe(422);
  });

  it('AUDIT P2-3: rejected online round batch awards zero XP/coins/stats', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ displayName: 'لاعب أونلاين' }),
      }),
      env,
    );
    const guest = (await guestRes.json()) as AuthHttpResponse;

    await recordOnlineBatchViaService(env, [
      {
        accountId: guest.profile.accountId,
        match: {
          submissionKey: 'online:BADROOM:r1',
          courseId: 'tropical',
          gameMode: 'standard',
          difficulty: 'normal',
          outcome: 'victory',
          elapsedTimeSec: 1.0, // impossible speed -> rejected
          falls: 0,
          itemsUsed: 0,
          pushContribution: 100,
          fartTimeSec: 1,
          survivalDistance: 0,
          treasureScore: 0,
          harmonyCombos: 0,
          hardGatesPassed: 0,
          minRaftHp: 100,
          isOnline: true,
        },
      },
    ]);

    const profRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/profile', {
        method: 'GET',
        headers: headers(guest.token),
      }),
      env,
    );
    const profData = (await profRes.json()) as { stats: { roundsPlayed: number }; profile: { xp: number } };
    expect(profData.stats.roundsPlayed).toBe(0);
    expect(profData.profile.xp).toBe(0);
  });

  it('AUDIT P2-4: replays require auth, block client online uploads, validate frames, and reject overwrites with 409', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ displayName: 'حارس الإعادات' }),
      }),
      env,
    );
    const guest = (await guestRes.json()) as AuthHttpResponse;

    const validReplay: RoundReplayRecord = {
      matchId: 'solo:immutable-check',
      roomCode: null,
      mode: 'solo',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      botDifficulty: 'normal',
      outcome: 'victory',
      durationSec: 42,
      falls: 0,
      treasureScore: 0,
      survivalDistance: 0,
      minRaftHp: 90,
      createdAt: Date.now(),
      players: [{ slot: 0, name: 'قبطان', isBot: false, colorIndex: 0, pushContribution: 150 }],
      frames: [
        { t: 0, x: 0, z: 0, yaw: 0, progress: 0, raftHp: 100, harmony: 0.1, windX: 0 },
        { t: 42, x: 0, z: -300, yaw: 0, progress: 1, raftHp: 90, harmony: 0.8, windX: 0 },
      ],
      events: [],
    };

    // 1. Anonymous upload -> 401
    const anonRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/replays', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ replay: validReplay }),
      }),
      env,
    );
    expect(anonRes.status).toBe(401);

    // 2. Client uploading online replay -> 403
    const onlineRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/replays', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ replay: { ...validReplay, mode: 'online', matchId: 'online:FAKE:r1' } }),
      }),
      env,
    );
    expect(onlineRes.status).toBe(403);

    // 3. Malformed frame -> 400
    const badFrameRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/replays', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({
          replay: {
            ...validReplay,
            frames: [{ t: -5, x: 'bad', z: 0, yaw: 0, progress: 99, raftHp: 999, harmony: 0, windX: 0 }],
          },
        }),
      }),
      env,
    );
    expect(badFrameRes.status).toBe(400);

    // 4. First valid save -> 201; duplicate save -> 409 (immutable)
    const firstSave = await routeWorkerRequest(
      new Request('http://localhost/api/v1/replays', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ replay: validReplay }),
      }),
      env,
    );
    expect(firstSave.status).toBe(201);

    const dupSave = await routeWorkerRequest(
      new Request('http://localhost/api/v1/replays', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ replay: validReplay }),
      }),
      env,
    );
    expect(dupSave.status).toBe(409);
  });

  it('AUDIT #7: concurrent duplicate recordVerifiedMatchInD1 increments totalRuns only once', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const db = env.DB;
    const record: VerifiedMatchRecord = {
      submissionKey: 'concurrent:match:dup-1',
      matchId: 'concurrent-dup-1',
      roomCode: 'CONC01',
      accountId: 'acc-concurrent',
      mode: 'online',
      courseId: 'volcanic',
      gameMode: 'survival',
      difficulty: 'hard',
      outcome: 'victory',
      elapsedTimeSec: 52.5,
      falls: 1,
      itemsUsed: 3,
      collisionCount: 2,
      treasureScore: 0,
      survivalDistance: 420,
      minRaftHp: 75,
      verifiedAt: Date.now(),
    };

    const [r1, r2] = await Promise.all([
      recordVerifiedMatchInD1(db, record),
      recordVerifiedMatchInD1(db, record),
    ]);

    expect([r1.inserted, r2.inserted].filter(Boolean)).toHaveLength(1);
    const analytics = await getBalanceAnalyticsFromD1(db, { courseId: 'volcanic', gameMode: 'survival' });
    expect(analytics.courses).toHaveLength(1);
    expect(analytics.courses[0].totalRuns).toBe(1);
    expect(analytics.totalVerifiedMatches).toBe(1);
  });

  it('AUDIT #8 & #9: ops/status marks isolate_local scope and ops/analytics filters by gameMode and courseId', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const db = env.DB;

    await recordVerifiedMatchInD1(db, {
      submissionKey: 'filter:std-1',
      matchId: 'filter-std-1',
      roomCode: null,
      accountId: 'acc-1',
      mode: 'solo',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      outcome: 'victory',
      elapsedTimeSec: 44,
      falls: 0,
      itemsUsed: 2,
      collisionCount: 1,
      treasureScore: 0,
      survivalDistance: 0,
      minRaftHp: 90,
      verifiedAt: Date.now(),
    });
    await recordVerifiedMatchInD1(db, {
      submissionKey: 'filter:surv-1',
      matchId: 'filter-surv-1',
      roomCode: null,
      accountId: 'acc-1',
      mode: 'solo',
      courseId: 'storm',
      gameMode: 'survival',
      difficulty: 'hard',
      outcome: 'victory',
      elapsedTimeSec: 65,
      falls: 1,
      itemsUsed: 4,
      collisionCount: 2,
      treasureScore: 0,
      survivalDistance: 500,
      minRaftHp: 70,
      verifiedAt: Date.now(),
    });

    const statusRes = await routeWorkerRequest(new Request('http://localhost/api/v1/ops/status'), env);
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as OpsStatusHttpResponse;
    expect(statusBody.metricsScope).toBe('isolate_local');
    expect(typeof statusBody.metricsNoteAr).toBe('string');

    const survRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/ops/analytics?gameMode=survival'),
      env,
    );
    expect(survRes.status).toBe(200);
    const survAnalytics = (await survRes.json()) as OpsAnalyticsHttpResponse;
    expect(survAnalytics.courses).toHaveLength(1);
    expect(survAnalytics.courses[0].gameMode).toBe('survival');
    expect(survAnalytics.courses[0].courseId).toBe('storm');
  });

  it('AUDIT #10: soloRunToken enforces real wall-clock elapsed time, 30-min TTL, and per-account minting cap', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ displayName: 'مختبر الزمن الفعلي' }),
      }),
      env,
    );
    const guest = (await guestRes.json()) as AuthHttpResponse;

    const tokRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/start-solo-run', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify({ courseId: 'tropical', gameMode: 'standard', difficulty: 'normal' }),
      }),
      env,
    );
    expect(tokRes.status).toBe(201);
    const { soloRunToken } = (await tokRes.json()) as { soloRunToken: string };

    const matchPayload: MatchSummaryInput = {
      submissionKey: 'instant-forge-1',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      outcome: 'victory',
      elapsedTimeSec: 40,
      falls: 0,
      itemsUsed: 2,
      pushContribution: 200,
      fartTimeSec: 12,
      survivalDistance: 0,
      treasureScore: 0,
      harmonyCombos: 1,
      hardGatesPassed: 2,
      cleanCheckpoints: 2,
      minRaftHp: 90,
      isOnline: false,
      soloRunToken,
    };

    // 1. Immediate submission right after minting -> rejected (422) because wall-clock < 40s*0.8-2
    const instantRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify(matchPayload),
      }),
      env,
    );
    expect(instantRes.status).toBe(422);

    // 2. Expired token (>30 min later) -> rejected (422)
    const expiredSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
    const expiredRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify(matchPayload),
      }),
      env,
    );
    expiredSpy.mockRestore();
    expect(expiredRes.status).toBe(422);

    // 3. Minting >8 tokens within 60s -> 429 RATE_LIMITED
    let hitRateLimit = false;
    for (let i = 0; i < 9; i += 1) {
      const r = await routeWorkerRequest(
        new Request('http://localhost/api/v1/progression/start-solo-run', {
          method: 'POST',
          headers: headers(guest.token),
          body: JSON.stringify({ courseId: 'tropical', gameMode: 'standard', difficulty: 'normal' }),
        }),
        env,
      );
      if (r.status === 429) {
        hitRateLimit = true;
        break;
      }
    }
    expect(hitRateLimit).toBe(true);
  });

  it('AUDIT #11 & #12: concurrent saveRoundReplayInD1 returns inserted:true only once and d1_accounts_mirror syncs on auth', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const replay: RoundReplayRecord = {
      matchId: 'solo:concurrent-replay-1',
      roomCode: null,
      mode: 'solo',
      courseId: 'tropical',
      gameMode: 'standard',
      difficulty: 'normal',
      botDifficulty: 'normal',
      outcome: 'victory',
      durationSec: 40,
      falls: 0,
      treasureScore: 0,
      survivalDistance: 0,
      minRaftHp: 90,
      createdAt: Date.now(),
      players: [{ slot: 0, name: 'قبطان', isBot: false, colorIndex: 0, pushContribution: 120 }],
      frames: [
        { t: 0, x: 0, z: 0, yaw: 0, progress: 0, raftHp: 100, harmony: 0.1, windX: 0 },
        { t: 40, x: 0, z: -300, yaw: 0, progress: 1, raftHp: 90, harmony: 0.8, windX: 0 },
      ],
      events: [],
    };

    const [s1, s2] = await Promise.all([
      saveRoundReplayInD1(env.DB, replay),
      saveRoundReplayInD1(env.DB, replay),
    ]);
    expect([s1.inserted, s2.inserted].filter(Boolean)).toHaveLength(1);

    // AUDIT #12: Guest creation syncs d1_accounts_mirror
    const guestRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/auth/guest', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ displayName: 'مرآة الحساب' }),
      }),
      env,
    );
    expect(guestRes.status).toBe(201);
    const guest = (await guestRes.json()) as AuthHttpResponse;

    const mirrorRow = await env.DB!
      .prepare(`SELECT account_id, display_name, level FROM d1_accounts_mirror WHERE account_id = ?`)
      .bind(guest.profile.accountId)
      .first<{ account_id: string; display_name: string; level: number }>();
    expect(mirrorRow).toBeTruthy();
    expect(mirrorRow?.display_name).toBe('مرآة الحساب');
    expect(mirrorRow?.level).toBe(1);
  });
});
