import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, type RoomSessionCredentials, type ServerProtocolMessage } from '../../../src/shared/protocol.ts';
import { extractLocalWsUpgrade } from '../env.ts';
import { createLocalWorkerEnv, type LocalWebSocket } from '../local/nodeDoRuntime.ts';
import { routeWorkerRequest } from '../router.ts';
import { clearRoomServiceCache } from '../services/roomService.ts';

function collectMessages(ws: LocalWebSocket): ServerProtocolMessage[] {
  const list: ServerProtocolMessage[] = [];
  ws.addEventListener('message', (ev) => {
    list.push(JSON.parse(String((ev as MessageEvent).data)) as ServerProtocolMessage);
  });
  return list;
}

const flush = () => new Promise((r) => setTimeout(r, 30));

test('session authentication rejects fake tokens, rotates resumeToken, replaces old socket, and migrates host on leave', async () => {
  clearRoomServiceCache();
  const { env, namespace } = createLocalWorkerEnv();

  try {
    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'مضيف' }),
      }),
      env,
    );
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;

    // 1. Forged auth attempt using only playerId + invalid token must fail
    const attackerWs = extractLocalWsUpgrade(
      await routeWorkerRequest(
        new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, { headers: { upgrade: 'websocket' } }),
        env,
      ),
    )!.webSocket as unknown as LocalWebSocket;
    const attackerMsgs = collectMessages(attackerWs);
    attackerWs.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'bad1',
        type: 'session:authenticate',
        payload: { playerId: hostCreds.playerId, resumeToken: 'forged-token-that-is-long-enough-123456' },
      }),
    );
    await flush();
    const errMsg = attackerMsgs.find((m) => m.type === 'room:error');
    assert.ok(errMsg && errMsg.type === 'room:error' && errMsg.payload?.code === 'UNAUTHORIZED');
    attackerWs.close(1000, 'closed');

    // 2. Real host authenticates -> receives rotated resumeToken
    const ws1 = extractLocalWsUpgrade(
      await routeWorkerRequest(
        new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, { headers: { upgrade: 'websocket' } }),
        env,
      ),
    )!.webSocket as unknown as LocalWebSocket;
    const msgs1 = collectMessages(ws1);
    ws1.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: 'session:authenticate',
        payload: { playerId: hostCreds.playerId, resumeToken: hostCreds.resumeToken },
      }),
    );
    await flush();
    const renewed1 = msgs1.find((m) => m.type === 'session:renewed');
    assert.ok(renewed1 && renewed1.type === 'session:renewed');
    const token2 = renewed1.payload!.resumeToken;
    assert.notEqual(token2, hostCreds.resumeToken);

    // 3. Reconnecting with new token2 replaces ws1 cleanly and rotates token again
    const ws2 = extractLocalWsUpgrade(
      await routeWorkerRequest(
        new Request(`http://localhost/ws/rooms/${hostCreds.roomCode}`, { headers: { upgrade: 'websocket' } }),
        env,
      ),
    )!.webSocket as unknown as LocalWebSocket;
    const msgs2 = collectMessages(ws2);
    ws2.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: 'session:authenticate',
        payload: { playerId: hostCreds.playerId, resumeToken: token2 },
      }),
    );
    await flush();

    const replacedErr = msgs1.find((m) => m.type === 'room:error' && m.payload?.code === 'SESSION_REPLACED');
    assert.ok(replacedErr);
    assert.equal(ws1.readyState, 3); // closed
    const renewed2 = msgs2.find((m) => m.type === 'session:renewed');
    assert.ok(renewed2 && renewed2.type === 'session:renewed');
    assert.equal(renewed2.payload!.connectionEpoch, 3);

    // 4. Player 2 joins, then Host leaves -> leadership migrates to Player 2
    const join2Res = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'خليفة' }),
      }),
      env,
    );
    const p2Creds = (await join2Res.json()) as RoomSessionCredentials;
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

    ws2.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'room:leave', payload: {} }));
    await flush();

    const lastState = [...p2Msgs].reverse().find((m) => m.type === 'room:state');
    assert.ok(lastState && lastState.type === 'room:state');
    assert.equal(lastState.payload?.snapshot.hostId, p2Creds.playerId);

    p2Ws.close(1000, 'done');
  } finally {
    namespace.disposeAll();
  }
});
