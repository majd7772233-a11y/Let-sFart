import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, type RoomSessionCredentials, type ServerProtocolMessage } from '../../../src/shared/protocol.ts';
import { extractLocalWsUpgrade } from '../env.ts';
import { createLocalWorkerEnv, type LocalWebSocket } from '../local/nodeDoRuntime.ts';
import { canTransitionLifecycle } from '../rooms/lifecycle.ts';
import { routeWorkerRequest } from '../router.ts';
import { clearRoomServiceCache } from '../services/roomService.ts';

function collectMessages(ws: LocalWebSocket): ServerProtocolMessage[] {
  const list: ServerProtocolMessage[] = [];
  ws.addEventListener('message', (ev) => {
    list.push(JSON.parse(String((ev as MessageEvent).data)) as ServerProtocolMessage);
  });
  return list;
}

const flush = () => new Promise((r) => setTimeout(r, 25));

test('lifecycle state transitions, 4-player cap, readiness gate, and host-only controls', async () => {
  assert.equal(canTransitionLifecycle('WAITING', 'PLAYING'), true);
  assert.equal(canTransitionLifecycle('WAITING', 'FINISHED'), false);
  assert.equal(canTransitionLifecycle('CLOSED', 'WAITING'), false);

  clearRoomServiceCache();
  const { env, namespace } = createLocalWorkerEnv();

  try {
    // Host creates room
    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'المضيف' }),
      }),
      env,
    );
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;

    const hostWs = extractLocalWsUpgrade(
      await routeWorkerRequest(
        new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, { headers: { upgrade: 'websocket' } }),
        env,
      ),
    )!.webSocket as unknown as LocalWebSocket;
    const hostMsgs = collectMessages(hostWs);
    hostWs.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: 'session:authenticate',
        payload: { playerId: hostCreds.playerId, resumeToken: hostCreds.resumeToken },
      }),
    );
    await flush();

    // Player 2 joins (defaults to ready = false!)
    const join2Res = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'لاعب2' }),
      }),
      env,
    );
    assert.equal(join2Res.status, 200);
    const p2Creds = (await join2Res.json()) as RoomSessionCredentials;
    assert.equal(p2Creds.slot, 1);
    assert.equal(p2Creds.role, 'PLAYER');

    const p2Ws = extractLocalWsUpgrade(
      await routeWorkerRequest(
        new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, { headers: { upgrade: 'websocket' } }),
        env,
      ),
    )!.webSocket as unknown as LocalWebSocket;
    const p2Msgs = collectMessages(p2Ws);
    p2Ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: 'session:authenticate',
        payload: { playerId: p2Creds.playerId, resumeToken: p2Creds.resumeToken },
      }),
    );
    await flush();

    // Non-host cannot start game
    p2Ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 's1', type: 'room:start', payload: {} }));
    await flush();
    const p2Err = p2Msgs.find((m) => m.type === 'room:error' && m.requestId === 's1');
    assert.ok(p2Err && p2Err.type === 'room:error' && p2Err.payload?.code === 'FORBIDDEN_HOST_ONLY');

    // Host cannot start while player 2 is NOT ready (SRV-08)
    hostWs.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 's2', type: 'room:start', payload: {} }));
    await flush();
    const startErr = hostMsgs.find((m) => m.type === 'room:error' && m.requestId === 's2');
    assert.ok(startErr && startErr.type === 'room:error' && startErr.payload?.code === 'PLAYERS_NOT_READY');

    // Player 2 marks ready, now Host can start!
    p2Ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'r1',
        type: 'room:ready',
        payload: { ready: true },
      }),
    );
    await flush();
    hostWs.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 's3', type: 'room:start', payload: {} }));
    await flush();

    const startedState = [...hostMsgs].reverse().find((m) => m.type === 'room:state');
    assert.ok(startedState && startedState.type === 'room:state');
    assert.equal(startedState.payload?.snapshot.lifecycleState, 'PLAYING');

    // Host restarts -> RESTARTING -> WAITING while keeping seats
    hostWs.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'rs1', type: 'room:restart', payload: {} }));
    await flush();
    const restartedState = [...hostMsgs].reverse().find((m) => m.type === 'room:state');
    assert.ok(restartedState && restartedState.type === 'room:state');
    assert.equal(restartedState.payload?.snapshot.lifecycleState, 'WAITING');
    assert.equal(restartedState.payload?.snapshot.sim.players[1].id, p2Creds.playerId);

    // Join players 3 & 4 -> 5th player rejected as ROOM_FULL
    const j3 = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'لاعب3' }),
      }),
      env,
    );
    assert.equal(j3.status, 200);
    const j4 = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'لاعب4' }),
      }),
      env,
    );
    assert.equal(j4.status, 200);
    const j5 = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'لاعب5' }),
      }),
      env,
    );
    assert.equal(j5.status, 409);

    hostWs.close(1000, 'done');
    p2Ws.close(1000, 'done');
  } finally {
    namespace.disposeAll();
  }
});
