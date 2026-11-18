import { afterEach, describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  type HttpErrorResponse,
  type PublicRoomsListResponse,
  type RoomPublicInfoResponse,
  type RoomSessionCredentials,
} from '../../src/shared/protocol.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { connectAndAuthWs, flush, joinRoomHttp, setupTestEnv } from './helpers.ts';

describe('ONLINE-01..05 Custom Room Settings, Private Rooms, Directory & Quick Match', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('ONLINE-01: creates room with custom settings, enforces maxPlayers cap on seats/bots, and allows live host updates', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'مضيف_إعدادات',
          courseId: 'tropical',
          settings: {
            gameMode: 'treasure',
            difficulty: 'hard',
            enableItems: false,
            roundTimeLimitSec: 180,
            maxPlayers: 2,
          },
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;
    expect(hostCreds.snapshot.maxPlayers).toBe(2);
    expect(hostCreds.snapshot.settings?.gameMode).toBe('treasure');
    expect(hostCreds.snapshot.settings?.difficulty).toBe('hard');
    expect(hostCreds.snapshot.settings?.enableItems).toBe(false);
    expect(hostCreds.snapshot.settings?.roundTimeLimitSec).toBe(180);
    expect(hostCreds.snapshot.sim.pickups.length).toBe(0);
    expect(hostCreds.snapshot.sim.treasures.length).toBe(24);
    expect(hostCreds.snapshot.seats).toEqual(['RECONNECTING', 'BOT', 'EMPTY', 'EMPTY']);

    // Join second player -> fills slot 1 (replaces bot), room now at maxPlayers = 2
    const j2Res = await joinRoomHttp(env, hostCreds.roomCode, 'لاعب_ثاني');
    expect(j2Res.status).toBe(200);
    const p2Creds = (await j2Res.json()) as RoomSessionCredentials;

    // 3rd player trying to join MUST be rejected with ROOM_FULL because maxPlayers = 2
    const j3Res = await joinRoomHttp(env, hostCreds.roomCode, 'لاعب_ثالث');
    expect(j3Res.status).toBe(409);
    const j3Err = (await j3Res.json()) as HttpErrorResponse;
    expect(j3Err.error.code).toBe('ROOM_FULL');

    // Non-host cannot update settings
    const hostConn = await connectAndAuthWs(env, hostCreds);
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'nonhost-settings',
        type: 'room:updateSettings',
        payload: { settings: { gameMode: 'chaos' } },
      }),
    );
    await flush();
    expect(
      p2Conn.msgs.some(
        (m) => m.type === 'room:error' && m.requestId === 'nonhost-settings' && m.payload?.code === 'FORBIDDEN_HOST_ONLY',
      ),
    ).toBe(true);

    // Host updates settings live to chaos + 3 players + items enabled
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-settings-update',
        type: 'room:updateSettings',
        payload: {
          settings: {
            gameMode: 'chaos',
            maxPlayers: 3,
            enableItems: true,
            roundTimeLimitSec: 120,
          },
        },
      }),
    );
    await flush();

    const latest = [...p2Conn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(latest?.type).toBe('room:state');
    if (latest?.type === 'room:state') {
      const snap = latest.payload!.snapshot;
      expect(snap.settings?.gameMode).toBe('chaos');
      expect(snap.maxPlayers).toBe(3);
      expect(snap.sim.gameMode).toBe('chaos');
      expect(snap.sim.enableItems).toBe(true);
      expect(snap.sim.pickups.length).toBeGreaterThan(0);
      expect(snap.seats).toEqual(['CONNECTED', 'CONNECTED', 'BOT', 'EMPTY']);
    }
  });

  it('ONLINE-02: creates private password-protected room, verifies password on join without leaking hash, and hides from directory', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Creating private room with too-short password fails validation
    const badCreate = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'مضيف_خاص',
          isPrivate: true,
          password: '12',
        }),
      }),
      env,
    );
    expect(badCreate.status).toBe(400);

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'مضيف_خاص',
          isPrivate: true,
          password: 'SecretPass42',
          settings: { gameMode: 'time_trial' },
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;
    expect(hostCreds.snapshot.isPrivate).toBe(true);

    // Public room info shows isPrivate: true and never leaks password / passwordHash
    const infoRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}`, {
        headers: { origin: 'http://localhost:3000' },
      }),
      env,
    );
    expect(infoRes.status).toBe(200);
    const infoText = await infoRes.text();
    expect(infoText).not.toContain('SecretPass42');
    expect(infoText).not.toContain('passwordHash');
    const info = JSON.parse(infoText) as RoomPublicInfoResponse;
    expect(info.isPrivate).toBe(true);
    expect(info.gameMode).toBe('time_trial');

    // Public directory MUST exclude private rooms
    const dirRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', { headers: { origin: 'http://localhost:3000' } }),
      env,
    );
    expect(dirRes.status).toBe(200);
    const dir = (await dirRes.json()) as PublicRoomsListResponse;
    expect(dir.rooms.some((r) => r.roomCode === hostCreds.roomCode)).toBe(false);

    // Joining without password fails with 403 INVALID_PASSWORD
    const noPassRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ name: 'ضيف_مجهول' }),
      }),
      env,
    );
    expect(noPassRes.status).toBe(403);
    const noPassErr = (await noPassRes.json()) as HttpErrorResponse;
    expect(noPassErr.error.code).toBe('INVALID_PASSWORD');

    // Joining with wrong password fails with 403 INVALID_PASSWORD
    const wrongPassRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ name: 'ضيف_مجهول', password: 'WrongPassword' }),
      }),
      env,
    );
    expect(wrongPassRes.status).toBe(403);

    // Joining with exact password succeeds
    const okRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ name: 'صديق_موثوق', password: 'SecretPass42' }),
      }),
      env,
    );
    expect(okRes.status).toBe(200);
    const friendCreds = (await okRes.json()) as RoomSessionCredentials;
    expect(friendCreds.roomCode).toBe(hostCreds.roomCode);
    expect(friendCreds.slot).toBe(1);
  });

  it('ONLINE-04 & ONLINE-05: public room directory & quick-match match open public rooms, prefer requested mode, and return 404 when empty', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Empty quick-match returns 404 NO_PUBLIC_ROOMS_AVAILABLE
    const emptyQuick = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms/quick-match', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'باحث_سريع',
          cosmetic: { hat: 'none', glasses: 'none', colorIndex: 0 },
        }),
      }),
      env,
    );
    expect(emptyQuick.status).toBe(404);
    const emptyErr = (await emptyQuick.json()) as HttpErrorResponse;
    expect(emptyErr.error.code).toBe('NO_PUBLIC_ROOMS_AVAILABLE');

    // Create 1 private room + 2 public rooms (standard & survival)
    await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'مضيف_سري',
          isPrivate: true,
          password: 'Hidden99',
          settings: { gameMode: 'survival' },
        }),
      }),
      env,
    );

    const stdCreate = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'مضيف_قياسي',
          courseId: 'tropical',
          settings: { gameMode: 'standard' },
        }),
      }),
      env,
    );
    const stdCreds = (await stdCreate.json()) as RoomSessionCredentials;

    const survCreate = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'مضيف_البقاء',
          courseId: 'storm',
          settings: { gameMode: 'survival' },
        }),
      }),
      env,
    );
    const survCreds = (await survCreate.json()) as RoomSessionCredentials;

    // Public directory lists exactly the 2 public rooms
    const listRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', { headers: { origin: 'http://localhost:3000' } }),
      env,
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as PublicRoomsListResponse;
    expect(list.total).toBe(2);
    expect(list.rooms.map((r) => r.roomCode).sort()).toEqual([stdCreds.roomCode, survCreds.roomCode].sort());

    // Quick match preferring survival picks survCreds.roomCode!
    const qmRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms/quick-match', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'صائد_المغامرات',
          cosmetic: { hat: 'crown', glasses: 'shades', colorIndex: 2 },
          preferredGameMode: 'survival',
        }),
      }),
      env,
    );
    expect(qmRes.status).toBe(200);
    const qmCreds = (await qmRes.json()) as RoomSessionCredentials;
    expect(qmCreds.roomCode).toBe(survCreds.roomCode);

    // After survival room starts PLAYING, it disappears from open WAITING directory
    const hostSurvConn = await connectAndAuthWs(env, survCreds);
    const qmConn = await connectAndAuthWs(env, qmCreds);
    // Mark joined player ready
    qmConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'qm-ready',
        type: 'room:ready',
        payload: { ready: true },
      }),
    );
    await flush();
    hostSurvConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'surv-start',
        type: 'room:start',
        payload: {},
      }),
    );
    await flush(80);

    const afterStartListRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', { headers: { origin: 'http://localhost:3000' } }),
      env,
    );
    const afterStartList = (await afterStartListRes.json()) as PublicRoomsListResponse;
    expect(afterStartList.rooms.some((r) => r.roomCode === survCreds.roomCode)).toBe(false);
    expect(afterStartList.rooms.some((r) => r.roomCode === stdCreds.roomCode)).toBe(true);
  });
});
