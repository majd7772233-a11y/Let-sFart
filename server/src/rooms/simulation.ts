import { COURSE_MAIN } from '../../../src/shared/course.ts';
import {
  createInitialSimState,
  enforceInputTimeouts,
  stepSimulation,
} from '../../../src/shared/physics.ts';
import type { SimEvent } from '../../../src/shared/types.ts';
import { syncBotsInRoom, transitionRoomLifecycle } from './lifecycle.ts';
import type { RoomRecord } from './types.ts';

export const FIXED_SIM_DT = 1 / 30;
export const MAX_CATCHUP_STEPS = 4;
export const SNAPSHOT_BROADCAST_INTERVAL_MS = 50; // ~20Hz
export const STATE_PERSIST_INTERVAL_MS = 2000;
export const MAX_RECENT_EVENTS = 32;

export function stepRoomSimulation(
  room: RoomRecord,
  rawDt: number,
  nowMs = Date.now(),
): { events: SimEvent[]; lifecycleChanged: boolean; stepsExecuted: number } {
  if (room.lifecycleState !== 'PLAYING' && room.lifecycleState !== 'FALLING') {
    room.accumulatorSec = 0;
    return { events: [], lifecycleChanged: false, stepsExecuted: 0 };
  }

  const boundedDt = Number.isFinite(rawDt) ? Math.min(Math.max(rawDt, 0), 0.25) : 0;
  room.accumulatorSec += boundedDt;

  const collectedEvents: SimEvent[] = [];
  const prevLifecycle = room.lifecycleState;
  let stepsExecuted = 0;

  while (room.accumulatorSec >= FIXED_SIM_DT && stepsExecuted < MAX_CATCHUP_STEPS) {
    if (room.lifecycleState !== 'PLAYING' && room.lifecycleState !== 'FALLING') {
      room.accumulatorSec = 0;
      break;
    }

    enforceInputTimeouts(room.sim, nowMs);

    // Keep room.sim.mode as 'online' cleanly while explicitly passing enableBots
    const stepEvents = stepSimulation(room.sim, FIXED_SIM_DT, COURSE_MAIN, {
      enableBots: room.fillBots,
    });

    if (stepEvents.length > 0) {
      collectedEvents.push(...stepEvents);
      room.recentEvents.push(...stepEvents);
      if (room.recentEvents.length > MAX_RECENT_EVENTS) {
        room.recentEvents.splice(0, room.recentEvents.length - MAX_RECENT_EVENTS);
      }
    }

    if (room.sim.phase === 'falling' && room.lifecycleState !== 'FALLING') {
      transitionRoomLifecycle(room, 'FALLING');
    } else if (room.sim.phase === 'playing' && room.lifecycleState !== 'PLAYING') {
      transitionRoomLifecycle(room, 'PLAYING');
    } else if (room.sim.phase === 'finished') {
      transitionRoomLifecycle(room, 'FINISHED');
      room.accumulatorSec = 0;
      stepsExecuted += 1;
      break;
    }

    room.accumulatorSec -= FIXED_SIM_DT;
    stepsExecuted += 1;
  }

  // Clamp residual accumulator if catch-up cap was reached to prevent spiral-of-death
  if (stepsExecuted >= MAX_CATCHUP_STEPS && room.accumulatorSec > FIXED_SIM_DT) {
    room.accumulatorSec = FIXED_SIM_DT;
  }

  return {
    events: collectedEvents,
    lifecycleChanged: prevLifecycle !== room.lifecycleState,
    stepsExecuted,
  };
}

export function prepareSimForStart(room: RoomRecord, nowMs = Date.now()): void {
  room.accumulatorSec = 0;
  room.sim.mode = 'online';
  room.sim.phase = 'playing';
  room.sim.simTime = 0;
  room.sim.elapsedTime = 0;
  room.sim.falls = 0;
  room.sim.checkpointIndex = 0;
  room.sim.invulnTimer = 0;
  room.sim.fallTimer = 0;
  room.sim.hitstopTimer = 0;
  room.sim.progress = 0;
  room.sim.eventSeq = 0;
  room.sim.events = [];
  room.recentEvents = [];

  room.sim.raft.x = 0;
  room.sim.raft.y = 0;
  room.sim.raft.z = COURSE_MAIN.startZ;
  room.sim.raft.vx = 0;
  room.sim.raft.vz = 0;
  room.sim.raft.yaw = 0;
  room.sim.raft.omega = 0;
  room.sim.raft.pitch = 0;
  room.sim.raft.roll = 0;
  room.sim.raft.pitchVel = 0;
  room.sim.raft.rollVel = 0;

  for (const p of room.sim.players) {
    p.farting = false;
    p.fartHoldTime = 0;
    p.fartPower = 0;
    p.moveDir = 0;
    p.lateralVel = 0;
    p.releaseBounce = 0;
    p.lastInputAt = nowMs;
    p.stats = {
      totalFartTime: 0,
      fartCount: 0,
      maxBurstDuration: 0,
      torqueImpulseSum: 0,
      wallImpactCount: 0,
    };
  }

  syncBotsInRoom(room, nowMs);
  transitionRoomLifecycle(room, 'PLAYING');
  room.snapshotSeq += 1;
}

export function restartRoomToWaiting(room: RoomRecord, nowMs = Date.now()): void {
  transitionRoomLifecycle(room, 'RESTARTING');
  room.accumulatorSec = 0;

  const fresh = createInitialSimState('online');
  fresh.phase = 'waiting';
  for (let i = 0; i < 4; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    const prev = room.sim.players[slot];
    fresh.players[slot].id = prev.id;
    fresh.players[slot].name = prev.name;
    fresh.players[slot].connected = prev.connected;
    fresh.players[slot].isBot = prev.isBot;
    fresh.players[slot].cosmetic = prev.cosmetic;
    fresh.players[slot].lastInputAt = nowMs;
  }

  for (const session of room.sessions.values()) {
    if (session.revoked) continue;
    session.ready = session.role === 'HOST';
    fresh.players[session.slot].ready = session.ready;
  }

  room.sim = fresh;
  room.recentEvents = [];
  syncBotsInRoom(room, nowMs);
  transitionRoomLifecycle(room, 'WAITING');
  room.snapshotSeq += 1;
}
