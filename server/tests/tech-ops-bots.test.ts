import { afterEach, describe, expect, it } from 'vitest';
import {
  GAME_VERSION,
  PROTOCOL_VERSION,
  type HttpErrorResponse,
  type OpsAnalyticsHttpResponse,
  type OpsStatusHttpResponse,
  type RecordMatchHttpResponse,
  type ReplayDetailHttpResponse,
  type ReplayListHttpResponse,
  type SaveReplayHttpResponse,
} from '../../src/shared/protocol.ts';
import { createInitialSimState, DEFAULT_ROOM_SETTINGS } from '../../src/shared/physics.ts';
import type { MatchSummaryInput, RoundReplayRecord } from '../../src/shared/types.ts';
import { recordVerifiedMatchInD1 } from '../src/db/d1Store.ts';
import { activateTempBotSubstitutesIfNeeded, syncBotsInRoom } from '../src/rooms/lifecycle.ts';
import { BOT_SUBSTITUTE_DELAY_MS, type RoomRecord } from '../src/rooms/types.ts';
import { routeWorkerRequest } from '../src/router.ts';
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

    // 2. Plausible victory -> 200
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
    };
    const legitRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/progression/record-match', {
        method: 'POST',
        headers: headers(guest.token),
        body: JSON.stringify(legitMatch),
      }),
      env,
    );
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
        headers: headers(),
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
    expect(list.replays.some((r) => r.matchId === replay.matchId)).toBe(true);

    const detailRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/replays/${encodeURIComponent(replay.matchId)}`, {
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
});
