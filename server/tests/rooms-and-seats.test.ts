import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type RoomSessionCredentials } from '../../src/shared/protocol.ts';
import { createRoomViaService } from '../src/services/roomService.ts';
import { collectMessages, connectAndAuthWs, createRoomHttp, flush, joinRoomHttp, setupTestEnv } from './helpers.ts';

describe('SRV-21: Room creation, 4-seat distribution, bots, readiness, and host migration', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
    vi.restoreAllMocks();
  });

  it('creates rooms with 8-char codes, retries on code collision, and respects idempotencyKey', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const first = await createRoomHttp(env, 'مضيف1', 'idem-collision-check');
    expect(first.roomCode).toMatch(/^[A-Z0-9]{8}$/);

    // Duplicate idempotency key returns identical credentials without creating another room
    const dup = await createRoomHttp(env, 'مضيف1', 'idem-collision-check');
    expect(dup.roomCode).toBe(first.roomCode);
    expect(dup.playerId).toBe(first.playerId);

    // Simulate Durable Object 409 collision on first code attempt -> service automatically retries
    let createCalls = 0;
    const origGet = env.ROOMS.get.bind(env.ROOMS);
    vi.spyOn(env.ROOMS, 'get').mockImplementation((id: DurableObjectId) => {
      const stub = origGet(id);
      return {
        ...stub,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = input instanceof Request ? input : new Request(input, init);
          if (new URL(req.url).pathname === '/internal/create') {
            createCalls += 1;
            if (createCalls === 1) {
              return new Response(JSON.stringify({ error: { code: 'ROOM_ALREADY_EXISTS', message: 'exists' } }), {
                status: 409,
              });
            }
          }
          return stub.fetch(req);
        },
      } as unknown as DurableObjectStub;
    });

    const retried = await createRoomViaService(env, {
      name: 'مضيف2',
      cosmetic: { hat: 'crown', glasses: 'none', colorIndex: 1 },
    });
    expect(createCalls).toBe(2);
    expect(retried.status).toBe(201);
    expect(retried.creds.roomCode).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('distributes 4 seats cleanly, rejects 5th player, toggles bots, and enforces readiness + host permissions', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'المضيف');
    const hostConn = await connectAndAuthWs(env, hostCreds);

    // Initially 1 human + 3 bots
    const joinedHost = hostConn.msgs.find((m) => m.type === 'room:joined');
    expect(joinedHost?.type === 'room:joined' && joinedHost.payload?.snapshot.sim.players.filter((p) => p.isBot).length).toBe(3);

    // Non-host joins into slot 1
    const j2 = await joinRoomHttp(env, hostCreds.roomCode, 'لاعب 2');
    expect(j2.status).toBe(200);
    const p2Creds = (await j2.json()) as RoomSessionCredentials;
    expect(p2Creds.slot).toBe(1);
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    // Non-host cannot toggle bots or start
    p2Conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'tb1', type: 'room:toggleBots', payload: { fillBots: false } }));
    await flush();
    expect(p2Conn.msgs.some((m) => m.type === 'room:error' && m.requestId === 'tb1' && m.payload?.code === 'FORBIDDEN_HOST_ONLY')).toBe(true);

    // Host toggles fillBots -> false (slots 2 & 3 become EMPTY, not BOT)
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'tb2', type: 'room:toggleBots', payload: { fillBots: false } }));
    await flush();
    const afterBotsOff = [...hostConn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(afterBotsOff?.type === 'room:state' && afterBotsOff.payload?.snapshot.sim.players[2].isBot).toBe(false);
    expect(afterBotsOff?.type === 'room:state' && afterBotsOff.payload?.snapshot.sim.players[2].connected).toBe(false);

    // Host toggles fillBots -> true (slots 2 & 3 become bots again)
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'tb3', type: 'room:toggleBots', payload: { fillBots: true } }));
    await flush();
    const afterBotsOn = [...hostConn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(afterBotsOn?.type === 'room:state' && afterBotsOn.payload?.snapshot.sim.players[2].isBot).toBe(true);

    // Host cannot start while player 2 is unready
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'st1', type: 'room:start', payload: {} }));
    await flush();
    expect(hostConn.msgs.some((m) => m.type === 'room:error' && m.requestId === 'st1' && m.payload?.code === 'PLAYERS_NOT_READY')).toBe(true);

    // Player 2 marks ready -> Host starts round
    p2Conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'rd1', type: 'room:ready', payload: { ready: true } }));
    await flush();
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'st2', type: 'room:start', payload: {} }));
    await flush();

    const playingState = [...hostConn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(playingState?.type === 'room:state' && playingState.payload?.snapshot.lifecycleState).toBe('PLAYING');

    // Join players 3 & 4 -> 5th player rejected with 409 ROOM_FULL
    const j3 = await joinRoomHttp(env, hostCreds.roomCode, 'لاعب 3');
    const j4 = await joinRoomHttp(env, hostCreds.roomCode, 'لاعب 4');
    const j5 = await joinRoomHttp(env, hostCreds.roomCode, 'لاعب 5');
    expect(j3.status).toBe(200);
    expect(j4.status).toBe(200);
    expect(j5.status).toBe(409);

    // Host leaves permanently -> Host role migrates cleanly to Player 2
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'room:leave', payload: {} }));
    await flush();
    const migratedState = [...p2Conn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(migratedState?.type === 'room:state' && migratedState.payload?.snapshot.hostId).toBe(p2Creds.playerId);

    // New host (Player 2) now has permission to restart
    p2Conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, requestId: 'rs-new-host', type: 'room:restart', payload: {} }));
    await flush();
    const restartedState = [...p2Conn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(restartedState?.type === 'room:state' && restartedState.payload?.snapshot.lifecycleState).toBe('WAITING');
  });

  it('retains host role during brief disconnect grace instead of immediately reassigning', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const hostCreds = await createRoomHttp(env, 'قبطان_أصلي');
    const hostConn = await connectAndAuthWs(env, hostCreds);
    const j2 = await joinRoomHttp(env, hostCreds.roomCode, 'عضو');
    const p2Creds = (await j2.json()) as RoomSessionCredentials;
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    // Drop host socket unexpectedly (not room:leave) -> host retains HOST role & slot 0 (not replaced by bot!)
    hostConn.ws.close(1006, 'NETWORK_DROP');
    await flush();

    const afterDrop = [...p2Conn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(afterDrop?.type === 'room:state' && afterDrop.payload?.snapshot.hostId).toBe(hostCreds.playerId);
    expect(afterDrop?.type === 'room:state' && afterDrop.payload?.snapshot.sim.players[0].isBot).toBe(false);
    expect(afterDrop?.type === 'room:state' && afterDrop.payload?.snapshot.sim.players[0].connected).toBe(false);

    // Reconnect using renewed token -> regains connected state cleanly
    const renewed = hostConn.msgs.find((m) => m.type === 'session:renewed');
    const token2 = renewed?.type === 'session:renewed' ? renewed.payload!.resumeToken : hostCreds.resumeToken;
    const hostReconn = await connectAndAuthWs(env, {
      roomCode: hostCreds.roomCode,
      playerId: hostCreds.playerId,
      resumeToken: token2,
    });
    const reconnJoined = hostReconn.msgs.find((m) => m.type === 'room:joined');
    expect(reconnJoined?.type === 'room:joined' && reconnJoined.payload?.role).toBe('HOST');
    expect(reconnJoined?.type === 'room:joined' && reconnJoined.payload?.snapshot.sim.players[0].connected).toBe(true);
  });
});
