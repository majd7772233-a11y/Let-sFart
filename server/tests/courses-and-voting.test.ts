import { afterEach, describe, expect, it } from 'vitest';
import { getCourseById } from '../../src/shared/course.ts';
import {
  PROTOCOL_VERSION,
  type RoomPublicInfoResponse,
  type RoomSessionCredentials,
  type ServerProtocolMessage,
} from '../../src/shared/protocol.ts';
import { routeWorkerRequest } from '../src/router.ts';
import { stepRoomSimulation } from '../src/rooms/simulation.ts';
import type { RoomRecord } from '../src/rooms/types.ts';
import { connectAndAuthWs, flush, joinRoomHttp, setupTestEnv } from './helpers.ts';

describe('COURSE-01..05 Server Course Selection, Voting, Persistence & Authoritative Simulation', () => {
  let disposeEnv: (() => void) | null = null;

  afterEach(() => {
    disposeEnv?.();
    disposeEnv = null;
  });

  it('creates room with requested courseId, rejects non-host course selection, and updates sim preview on host switch', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ name: 'مضيف_خرائط', courseId: 'volcanic' }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;
    expect(hostCreds.snapshot.courseId).toBe('volcanic');
    expect(hostCreds.snapshot.sim.courseId).toBe('volcanic');
    expect(hostCreds.snapshot.sim.raft.z).toBe(getCourseById('volcanic').startZ);

    // Public room info exposes courseId
    const infoRes = await routeWorkerRequest(
      new Request(`http://localhost/api/v1/rooms/${hostCreds.roomCode}`, {
        headers: { origin: 'http://localhost:3000' },
      }),
      env,
    );
    expect(infoRes.status).toBe(200);
    const info = (await infoRes.json()) as RoomPublicInfoResponse;
    expect(info.courseId).toBe('volcanic');

    const hostConn = await connectAndAuthWs(env, hostCreds);
    const j2Res = await joinRoomHttp(env, hostCreds.roomCode, 'عضو_ثان');
    const p2Creds = (await j2Res.json()) as RoomSessionCredentials;
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    // Non-host player trying room:selectCourse MUST be rejected with FORBIDDEN_HOST_ONLY
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'nonhost-course',
        type: 'room:selectCourse',
        payload: { courseId: 'factory' },
      }),
    );
    await flush();
    expect(
      p2Conn.msgs.some(
        (m) => m.type === 'room:error' && m.requestId === 'nonhost-course' && m.payload?.code === 'FORBIDDEN_HOST_ONLY',
      ),
    ).toBe(true);

    // Voting while mode is 'host' MUST fail cleanly with INVALID_LIFECYCLE_STATE
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'vote-disabled',
        type: 'room:voteCourse',
        payload: { courseId: 'glacial' },
      }),
    );
    await flush();
    expect(
      p2Conn.msgs.some(
        (m) => m.type === 'room:error' && m.requestId === 'vote-disabled' && m.payload?.code === 'INVALID_LIFECYCLE_STATE',
      ),
    ).toBe(true);

    // Host switches to 'glacial' directly -> broadcast updates courseId & sim.dynamicZones!
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-pick-glacial',
        type: 'room:selectCourse',
        payload: { courseId: 'glacial', courseSelectionMode: 'host' },
      }),
    );
    await flush();

    const latestState = [...p2Conn.msgs]
      .reverse()
      .find((m): m is Extract<ServerProtocolMessage, { type: 'room:state' }> => m.type === 'room:state');
    expect(latestState?.payload?.snapshot.courseId).toBe('glacial');
    expect(latestState?.payload?.snapshot.sim.courseId).toBe('glacial');
    expect(latestState?.payload?.snapshot.sim.dynamicZones.length).toBe(
      getCourseById('glacial').dynamicZones.length,
    );
  });

  it('supports voting mode, deterministic tie-breaking, persistence across DO wakeup, vote cleanup on leave, and course-specific simulation', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ name: 'مضيف_تصويت', courseId: 'tropical' }),
      }),
      env,
    );
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;
    const hostConn = await connectAndAuthWs(env, hostCreds);

    const p2Creds = (await (await joinRoomHttp(env, hostCreds.roomCode, 'مصوت_1')).json()) as RoomSessionCredentials;
    const p2Conn = await connectAndAuthWs(env, p2Creds);

    const p3Creds = (await (await joinRoomHttp(env, hostCreds.roomCode, 'مصوت_2')).json()) as RoomSessionCredentials;
    const p3Conn = await connectAndAuthWs(env, p3Creds);

    // Host enables voting mode (auto-registers host initial pick 'tropical')
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'enable-vote',
        type: 'room:selectCourse',
        payload: { courseId: 'tropical', courseSelectionMode: 'vote' },
      }),
    );
    await flush();

    // Players 2 and 3 both vote 'factory' -> factory wins 2 vs 1!
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'p2-vote',
        type: 'room:voteCourse',
        payload: { courseId: 'factory' },
      }),
    );
    p3Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'p3-vote',
        type: 'room:voteCourse',
        payload: { courseId: 'factory' },
      }),
    );
    await flush();

    const afterVotes = [...hostConn.msgs]
      .reverse()
      .find((m): m is Extract<ServerProtocolMessage, { type: 'room:state' }> => m.type === 'room:state');
    expect(afterVotes?.payload?.snapshot.courseSelectionMode).toBe('vote');
    expect(afterVotes?.payload?.snapshot.courseId).toBe('factory');
    expect(Object.keys(afterVotes?.payload?.snapshot.courseVotes ?? {})).toHaveLength(3);

    // Evict Durable Object and verify courseId, courseSelectionMode, and courseVotes survive SQLite reload!
    const woken = namespace.simulateDormantWakeUp(hostCreds.roomCode) as unknown as { room: RoomRecord };
    await flush();
    expect(woken.room.courseId).toBe('factory');
    expect(woken.room.courseSelectionMode).toBe('vote');
    expect(woken.room.courseVotes[p2Creds.playerId]).toBe('factory');

    // Player 3 leaves -> vote removed -> now tied 1 ('tropical' by host) vs 1 ('factory' by p2)
    // Deterministic tie-breaker favors Host's vote ('tropical')!
    p3Conn.ws.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'room:leave', payload: {} }));
    await flush();
    expect(woken.room.courseVotes[p3Creds.playerId]).toBeUndefined();
    expect(woken.room.courseId).toBe('tropical');

    // Switch back to 'factory' via p2 changing host-not-tied vote or host voting factory -> start round!
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'host-vote-factory',
        type: 'room:voteCourse',
        payload: { courseId: 'factory' },
      }),
    );
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'p2-ready',
        type: 'room:ready',
        payload: { ready: true },
      }),
    );
    await flush();

    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'start-factory',
        type: 'room:start',
        payload: {},
      }),
    );
    await flush(50);

    // Voting during PLAYING must be rejected cleanly
    p2Conn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'vote-playing',
        type: 'room:voteCourse',
        payload: { courseId: 'volcanic' },
      }),
    );
    await flush();
    expect(
      p2Conn.msgs.some(
        (m) => m.type === 'room:error' && m.requestId === 'vote-playing' && m.payload?.code === 'INVALID_LIFECYCLE_STATE',
      ),
    ).toBe(true);

    // Verify authoritative server simulation advances on Factory course
    expect(woken.room.sim.courseId).toBe('factory');
    stepRoomSimulation(woken.room, 0.1, Date.now());
    expect(woken.room.sim.simTime).toBeGreaterThan(0);
  });

  it('supports storm course, validates optional anchor & useItem inputs, and syncs pickups & storm wind authoritatively', async () => {
    const { env, namespace } = setupTestEnv();
    disposeEnv = () => namespace.disposeAll();

    const createRes = await routeWorkerRequest(
      new Request('http://localhost/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ name: 'ربان_العاصفة', courseId: 'storm' }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const hostCreds = (await createRes.json()) as RoomSessionCredentials;
    expect(hostCreds.snapshot.courseId).toBe('storm');
    expect(hostCreds.snapshot.sim.pickups.length).toBeGreaterThanOrEqual(8);

    const hostConn = await connectAndAuthWs(env, hostCreds);

    // Invalid anchor type must be rejected with INVALID_MESSAGE
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'bad-anchor',
        type: 'input:state',
        payload: { moveDir: 0, farting: false, seq: 1, anchor: 'yes' },
      }),
    );
    await flush();
    expect(
      hostConn.msgs.some(
        (m) => m.type === 'room:error' && m.requestId === 'bad-anchor' && m.payload?.code === 'INVALID_MESSAGE',
      ),
    ).toBe(true);

    // Valid anchor & useItem booleans must be accepted and forwarded during PLAYING
    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: 'start-storm',
        type: 'room:start',
        payload: {},
      }),
    );
    await flush(50);

    const live = namespace.getEntryInstance(hostCreds.roomCode) as unknown as {
      room: RoomRecord;
      stopLoop?: () => void;
    };
    live.stopLoop?.();

    hostConn.ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: 'input:state',
        payload: { moveDir: 1, farting: true, seq: 2, anchor: true, useItem: true },
      }),
    );
    await flush();

    expect(live.room.sim.courseId).toBe('storm');
    expect(live.room.sim.players[0].anchorRequested).toBe(true);
    expect(live.room.sim.players[0].useItemRequested).toBe(true);

    // Place raft onto the first storm pickup (lentil_can) and step authoritative simulation
    const firstPk = live.room.sim.pickups[0];
    live.room.sim.raft.x = firstPk.x;
    live.room.sim.raft.z = firstPk.z;
    stepRoomSimulation(live.room, 1 / 30, Date.now());

    expect(live.room.sim.pickups[0].collected).toBe(true);
    expect(live.room.sim.boostKind).toBe('lentil_can');
    expect(live.room.sim.anchorActive).toBe(true);
    expect(Math.hypot(live.room.sim.windX, live.room.sim.windZ)).toBeGreaterThan(0);
  });
});

