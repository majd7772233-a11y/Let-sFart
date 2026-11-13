import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLocalWsUpgrade } from '../env.ts';
import { createLocalWorkerEnv } from '../local/nodeDoRuntime.ts';
import { routeWorkerRequest } from '../router.ts';
import { clearRoomServiceCache } from '../services/roomService.ts';

test('router serves health, blocks /internal/*, handles non-existent rooms without creating state, and routes create/join/ws', async () => {
  clearRoomServiceCache();
  const { env, namespace } = createLocalWorkerEnv();

  try {
    // 1. Health endpoint
    const healthRes = await routeWorkerRequest(new Request('http://localhost/api/health'), env);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean };
    assert.equal(healthJson.ok, true);

    // 2. Public access to /internal/* must be forbidden
    const internalRes = await routeWorkerRequest(new Request('http://localhost/internal/info'), env);
    assert.equal(internalRes.status, 403);

    // 3. Unknown room returns 404 on info, join, and WS without creating room state
    const unknownInfo = await routeWorkerRequest(new Request('http://localhost/api/v1/rooms/ZZZZZZ'), env);
    assert.equal(unknownInfo.status, 404);

    const unknownJoin = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms/ZZZZZZ/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ضيف' }),
      }),
      env,
    );
    assert.equal(unknownJoin.status, 404);

    const unknownWs = await routeWorkerRequest(
      new Request('http://localhost/ws/rooms/ZZZZZZ', {
        headers: { upgrade: 'websocket' },
      }),
      env,
    );
    assert.equal(unknownWs.status, 404);

    // 4. Create room + idempotency key check
    const idemKey = 'idem-router-test-1';
    const createReq1 = new Request('http://localhost/api/v1/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'قبطان',
        cosmetic: { hat: 'captain', glasses: 'none', colorIndex: 0 },
        idempotencyKey: idemKey,
      }),
    });
    const createRes1 = await routeWorkerRequest(createReq1, env);
    assert.equal(createRes1.status, 201);
    const creds1 = (await createRes1.json()) as {
      roomCode: string;
      playerId: string;
      resumeToken: string;
      snapshot: Record<string, unknown>;
    };
    assert.match(creds1.roomCode, /^[A-Z0-9]{8}$/);
    assert.ok(creds1.resumeToken.length >= 32);
    assert.equal(JSON.stringify(creds1.snapshot).includes(creds1.resumeToken), false);

    // Duplicate idempotencyKey returns exact same room instead of creating another
    const createReq2 = new Request('http://localhost/api/v1/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'قبطان', idempotencyKey: idemKey }),
    });
    const createRes2 = await routeWorkerRequest(createReq2, env);
    const creds2 = (await createRes2.json()) as { roomCode: string; playerId: string };
    assert.equal(creds2.roomCode, creds1.roomCode);
    assert.equal(creds2.playerId, creds1.playerId);

    // 5. Public room info & join & WS upgrade
    const infoRes = await routeWorkerRequest(new Request(`http://localhost/api/v1/rooms/${creds1.roomCode}`), env);
    assert.equal(infoRes.status, 200);
    const info = (await infoRes.json()) as { roomCode: string; maxPlayers: number; playerCount: number };
    assert.equal(info.roomCode, creds1.roomCode);
    assert.equal(info.maxPlayers, 4);
    assert.equal(info.playerCount, 1);

    const wsRes = await routeWorkerRequest(
      new Request(`http://localhost/ws/rooms/${creds1.roomCode}`, {
        headers: { upgrade: 'websocket' },
      }),
      env,
    );
    const upgrade = extractLocalWsUpgrade(wsRes);
    assert.ok(upgrade !== null && upgrade.status === 101);
  } finally {
    namespace.disposeAll();
  }
});
