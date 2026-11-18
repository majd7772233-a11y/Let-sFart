import { afterEach, describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  type HttpErrorResponse,
  type PartyServerMessage,
  type PartySessionCredentials,
  type PublicRoomsListResponse,
  type RoomSessionCredentials,
} from '../../src/shared/protocol.ts';
import { extractLocalWsUpgrade } from '../src/env.ts';
import { type LocalWebSocket } from '../src/local/nodeDoRuntime.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { connectAndAuthWs, flush, setupTestEnv } from './helpers.ts';

async function connectAndAuthPartyWs(
  env: ReturnType<typeof setupTestEnv>['env'],
  creds: Pick<PartySessionCredentials, 'partyCode' | 'memberId' | 'resumeToken'>,
): Promise<{ ws: LocalWebSocket; msgs: PartyServerMessage[] }> {
  const res = await routeWorkerRequest(
    new Request(`http://localhost/ws/parties/${creds.partyCode}`, {
      headers: { upgrade: 'websocket', origin: 'http://localhost:3000' },
    }),
    env,
  );
  const upgrade = extractLocalWsUpgrade(res);
  if (!upgrade) {
    throw new Error(`Party WS upgrade failed with ${res.status}`);
  }
  const ws = upgrade.webSocket as unknown as LocalWebSocket;
  const msgs: PartyServerMessage[] = [];
  ws.addEventListener('message', (ev) => {
    msgs.push(JSON.parse(String((ev as MessageEvent).data)) as PartyServerMessage);
  });
  ws.send(
    JSON.stringify({
      version: PROTOCOL_VERSION,
      requestId: `pauth-${Math.random().toString(36).slice(2, 8)}`,
      type: 'party:authenticate',
      payload: { memberId: creds.memberId, resumeToken: creds.resumeToken },
    }),
  );
  await flush(50);
  return { ws, msgs };
}

describe('ONLINE-06..11 Spectator, Next-Round Progression, Party, Chat & Emotes', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('ONLINE-06 & ONLINE-07: joins full or active room as spectator, blocks spectator raft input, and promotes on open seat', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Host creates 2-seat room
    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'مضيف_مشاهدة',
          courseId: 'tropical',
          settings: { maxPlayers: 2 },
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;

    // Seat 1 joins -> fills maxPlayers=2
    const p2JoinRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'لاعب_ثاني' }),
      }),
      env,
    );
    expect(p2JoinRes.status).toBe(200);
    const p2Creds = (await p2JoinRes.json()) as RoomSessionCredentials;

    // 3rd user with spectate: 'never' is rejected as ROOM_FULL
    const rejectedRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'مرفوض', spectate: 'never' }),
      }),
      env,
    );
    expect(rejectedRes.status).toBe(409);
    const rejErr = (await rejectedRes.json()) as HttpErrorResponse;
    expect(rejErr.error.code).toBe('ROOM_FULL');

    // 3rd user with spectate: 'auto' enters as SPECTATOR (slot = -1)
    const specRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'مشاهد_أول', spectate: 'auto' }),
      }),
      env,
    );
    expect(specRes.status).toBe(200);
    const specCreds = (await specRes.json()) as RoomSessionCredentials;
    expect(specCreds.slot).toBe(-1);
    expect(specCreds.role).toBe('SPECTATOR');
    expect(specCreds.snapshot.spectatorCount).toBe(1);

    const hostConn = await connectAndAuthWs(env, hostCreds);
    const p2Conn = await connectAndAuthWs(env, p2Creds);
    const specConn = await connectAndAuthWs(env, specCreds);

    // Spectator is forbidden from sending gameplay inputs, setting ready, or voting on courses
    specConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: 'input:state',
        payload: { moveDir: 1, farting: true, seq: 1 },
      }),
    );
    specConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'spec-ready',
        type: 'room:ready',
        payload: { ready: true },
      }),
    );
    specConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'spec-vote',
        type: 'room:voteCourse',
        payload: { courseId: 'volcanic' },
      }),
    );
    await flush(50);

    const specErrors = specConn.msgs.filter((m) => m.type === 'room:error');
    expect(specErrors.some((m) => m.payload?.code === 'SPECTATOR_FORBIDDEN')).toBe(true);
    expect(
      specErrors.some((m) => m.requestId === 'spec-ready' && m.payload?.code === 'SPECTATOR_FORBIDDEN'),
    ).toBe(true);
    expect(
      specErrors.some((m) => m.requestId === 'spec-vote' && m.payload?.code === 'SPECTATOR_FORBIDDEN'),
    ).toBe(true);

    // Start game cleanly
    p2Conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'room:ready', payload: { ready: true } }));
    await flush(30);
    hostConn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'room:start', payload: {} }));
    await flush(60);

    // Active PLAYING public room appears in directory's spectatableRooms list
    const dirRes = await routeWorkerRequest(new Request('http://localhost/api/v1/rooms', { method: 'GET' }), env);
    expect(dirRes.status).toBe(200);
    const dirBody = (await dirRes.json()) as PublicRoomsListResponse;
    expect(dirBody.spectatableRooms?.some((r) => r.roomCode === hostCreds.roomCode)).toBe(true);

    // Mid-round join forces spectate ('auto' or 'only') -> enters as spectator #2
    const midSpecRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'مشاهد_وسط_الجولة', spectate: 'only' }),
      }),
      env,
    );
    expect(midSpecRes.status).toBe(200);
    const midSpecCreds = (await midSpecRes.json()) as RoomSessionCredentials;
    expect(midSpecCreds.slot).toBe(-1);
    expect(midSpecCreds.role).toBe('SPECTATOR');

    // Player 2 leaves room during game -> seat 1 becomes empty
    p2Conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'room:leave', payload: {} }));
    await flush(40);

    // Host restarts round to WAITING -> earliest connected spectator ('مشاهد_أول') is promoted BEFORE bots
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-restart-promote',
        type: 'room:restart',
        payload: {},
      }),
    );
    await flush(80);

    const promotedSnapMsg = [...specConn.msgs]
      .reverse()
      .find((m) => m.type === 'room:state' || m.type === 'game:snapshot');
    expect(promotedSnapMsg).toBeTruthy();
    if (promotedSnapMsg && (promotedSnapMsg.type === 'room:state' || promotedSnapMsg.type === 'game:snapshot')) {
      const snap = promotedSnapMsg.payload!.snapshot;
      const seatedSpec = snap.sim.players.find((p) => p.id === specCreds.playerId);
      expect(seatedSpec).toBeTruthy();
      expect(seatedSpec?.isBot).toBe(false);
    }
  });

  it('ONLINE-08: supports host playlist queue and next-round progression actions', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'مضيف_القائمة', courseId: 'tropical' }),
      }),
      env,
    );
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;
    const p2Res = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'عضو' }),
      }),
      env,
    );
    const p2Creds = (await p2Res.json()) as RoomSessionCredentials;

    const hostConn = await connectAndAuthWs(env, hostCreds);
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    // Non-host cannot set playlist or trigger nextRound
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'p2-playlist',
        type: 'room:setPlaylist',
        payload: { playlist: [{ courseId: 'volcanic', gameMode: 'chaos' }] },
      }),
    );
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'p2-next',
        type: 'room:nextRound',
        payload: { action: 'next' },
      }),
    );
    await flush(40);
    expect(
      p2Conn.msgs.filter((m) => m.type === 'room:error' && m.payload?.code === 'FORBIDDEN_HOST_ONLY').length,
    ).toBe(2);

    // Host configures playlist queue: volcanic (chaos) -> glacial (treasure)
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-playlist',
        type: 'room:setPlaylist',
        payload: {
          playlist: [
            { courseId: 'volcanic', gameMode: 'chaos' },
            { courseId: 'glacial', gameMode: 'treasure' },
          ],
        },
      }),
    );
    await flush(50);

    const stateAfterPlaylist = [...hostConn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(
      stateAfterPlaylist?.type === 'room:state' ? stateAfterPlaylist.payload?.snapshot.playlistQueue?.length : 0,
    ).toBe(2);

    // Host calls nextRound action: 'next' (immediate) -> consumes first playlist item (volcanic + chaos)
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-next-1',
        type: 'room:nextRound',
        payload: { action: 'next', immediate: true },
      }),
    );
    await flush(70);

    const afterNext = [...hostConn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(afterNext?.type).toBe('room:state');
    if (afterNext?.type === 'room:state') {
      expect(afterNext.payload!.snapshot.courseId).toBe('volcanic');
      expect(afterNext.payload!.snapshot.sim.gameMode).toBe('chaos');
      expect(afterNext.payload!.snapshot.sim.phase).toBe('playing');
      expect(afterNext.payload!.snapshot.playlistQueue?.length).toBe(1);
      expect(afterNext.payload!.snapshot.playlistQueue?.[0]?.courseId).toBe('glacial');
    }

    // Host returns to waiting via restart, then switches to explicit course 'storm' via nextRound
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-back-wait',
        type: 'room:restart',
        payload: {},
      }),
    );
    await flush(40);
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-course',
        type: 'room:nextRound',
        payload: { action: 'course', courseId: 'storm', immediate: false },
      }),
    );
    await flush(60);

    const afterCourse = [...hostConn.msgs].reverse().find((m) => m.type === 'room:state');
    expect(afterCourse?.type).toBe('room:state');
    if (afterCourse?.type === 'room:state') {
      expect(afterCourse.payload!.snapshot.courseId).toBe('storm');
      expect(afterCourse.payload!.snapshot.sim.phase).toBe('waiting');
    }
  });

  it('ONLINE-09: creates persistent party, enforces 4-member cap, supports chat, followRoom broadcast, and leader migration', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    // Leader creates party
    const createPartyRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'قائد_المجموعة' }),
      }),
      env,
    );
    expect(createPartyRes.status).toBe(201);
    const leaderCreds = (await createPartyRes.json()) as PartySessionCredentials;
    expect(leaderCreds.party.members.length).toBe(1);

    // Join 3 more friends (total 4)
    const memberCreds: PartySessionCredentials[] = [];
    for (let i = 2; i <= 4; i++) {
      const jr = await routeWorkerRequest(
        new Request(`http://localhost/api/v1/parties/${leaderCreds.partyCode}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `صديق_${i}` }),
        }),
        env,
      );
      expect(jr.status).toBe(200);
      memberCreds.push((await jr.json()) as PartySessionCredentials);
    }

    // 5th friend gets PARTY_FULL (409)
    const fullRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/parties/${leaderCreds.partyCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'خامس' }),
      }),
      env,
    );
    expect(fullRes.status).toBe(409);
    const fullErr = (await fullRes.json()) as HttpErrorResponse;
    expect(fullErr.error.code).toBe('PARTY_FULL');

    const leaderWs = await connectAndAuthPartyWs(env, leaderCreds);
    const friend2Ws = await connectAndAuthPartyWs(env, memberCreds[0]);

    // Party chat broadcast
    leaderWs.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'pchat-1',
        type: 'party:chat',
        payload: { presetId: 'get_ready' },
      }),
    );
    await flush(50);
    expect(friend2Ws.msgs.some((m) => m.type === 'party:chat')).toBe(true);

    // Leader binds room code -> broadcasts party:followRoom to friends (and NOT to leader)
    leaderWs.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'proom-1',
        type: 'party:setRoom',
        payload: { roomCode: 'ROOM88', password: 'secret' },
      }),
    );
    await flush(50);

    const followMsg = friend2Ws.msgs.find((m) => m.type === 'party:followRoom');
    expect(followMsg?.type).toBe('party:followRoom');
    if (followMsg?.type === 'party:followRoom') {
      expect(followMsg.payload?.roomCode).toBe('ROOM88');
      expect(followMsg.payload?.password).toBe('secret');
    }
    expect(leaderWs.msgs.some((m) => m.type === 'party:followRoom')).toBe(false);

    // Leader leaves party -> leadership migrates to remaining member
    leaderWs.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'party:leave', payload: {} }));
    await flush(50);

    const migratedState = [...friend2Ws.msgs].reverse().find((m) => m.type === 'party:state');
    expect(migratedState?.type).toBe('party:state');
    if (migratedState?.type === 'party:state') {
      expect(migratedState.payload?.party.members.length).toBe(3);
      expect(migratedState.payload?.party.leaderId).toBe(memberCreds[0].memberId);
    }
  });

  it('ONLINE-10 & ONLINE-11: broadcasts sanitized text/quick chat and 3D character emotes to room including snapshots', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'مضيف_تواصل', courseId: 'tropical' }),
      }),
      env,
    );
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;
    const p2Res = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'زميل_طوف' }),
      }),
      env,
    );
    const p2Creds = (await p2Res.json()) as RoomSessionCredentials;

    const hostConn = await connectAndAuthWs(env, hostCreds);
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    // Quick chat preset
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'chat-preset',
        type: 'chat:send',
        payload: { presetId: 'go_left' },
      }),
    );
    // Manual sanitized text (strips control/zero-width chars)
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'chat-text',
        type: 'chat:send',
        payload: { text: '  انتبهوا من الحجر!  ' },
      }),
    );
    // Emote trigger
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'emote-1',
        type: 'emote:trigger',
        payload: { emoteId: 'celebrate' },
      }),
    );
    await flush(60);

    const chatMsgs = p2Conn.msgs.filter((m) => m.type === 'chat:message');
    expect(chatMsgs.length).toBeGreaterThanOrEqual(2);
    expect(
      chatMsgs.some(
        (m) => m.type === 'chat:message' && m.payload?.message.presetId === 'go_left' && m.payload.message.text === 'يسار!',
      ),
    ).toBe(true);
    expect(
      chatMsgs.some((m) => m.type === 'chat:message' && m.payload?.message.text === 'انتبهوا من الحجر!'),
    ).toBe(true);

    const emoteBroadcast = p2Conn.msgs.find((m) => m.type === 'game:emote');
    expect(emoteBroadcast?.type).toBe('game:emote');
    if (emoteBroadcast?.type === 'game:emote') {
      expect(emoteBroadcast.payload?.emoteId).toBe('celebrate');
      expect(emoteBroadcast.payload?.slot).toBe(0);
    }

    // Room info GET /api/v1/rooms/:code returns valid metadata and late joiner sees recentChat in snapshot
    const p3Res = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'منضم_متأخر' }),
      }),
      env,
    );
    expect(p3Res.status).toBe(200);
    const p3Creds = (await p3Res.json()) as RoomSessionCredentials;
    expect(p3Creds.snapshot.recentChat?.length).toBeGreaterThanOrEqual(2);
    expect(p3Creds.snapshot.sim.players[0].activeEmote?.id).toBe('celebrate');
  });
});
