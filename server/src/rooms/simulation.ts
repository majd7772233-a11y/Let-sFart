import { getCourseById } from '../../../src/shared/course.ts';
import {
  createInitialDynamicZones,
  createInitialPickups,
  createInitialSimState,
  createInitialTreasures,
  enforceInputTimeouts,
  normalizeRoomSettings,
  stepSimulation,
} from '../../../src/shared/physics.ts';
import type { ReplayEventEntry, ReplayKeyframe, SimEvent } from '../../../src/shared/types.ts';
import {
  activateTempBotSubstitutesIfNeeded,
  promoteWaitingSpectators,
  syncBotsInRoom,
  transitionRoomLifecycle,
} from './lifecycle.ts';
import type { RoomRecord } from './types.ts';

export const FIXED_SIM_DT = 1 / 30;
export const MAX_CATCHUP_STEPS = 4;
export const SNAPSHOT_BROADCAST_INTERVAL_MS = 50; // ~20Hz
export const STATE_PERSIST_INTERVAL_MS = 2000;
export const MAX_RECENT_EVENTS = 32;
export const REPLAY_SAMPLE_INTERVAL_SEC = 0.5;
export const MAX_REPLAY_FRAMES = 480;

function appendReplayFrame(room: RoomRecord, force = false): void {
  if (!room.replayFrames) room.replayFrames = [];
  if (room.replayFrames.length >= MAX_REPLAY_FRAMES) return;
  const elapsed = room.sim.elapsedTime ?? 0;
  const nextSample = room.nextReplaySampleElapsed ?? 0;
  if (!force && elapsed < nextSample) return;

  const frame: ReplayKeyframe = {
    t: Number(elapsed.toFixed(2)),
    x: Number(room.sim.raft.x.toFixed(2)),
    z: Number(room.sim.raft.z.toFixed(2)),
    yaw: Number(room.sim.raft.yaw.toFixed(3)),
    progress: Number((room.sim.progress ?? 0).toFixed(3)),
    raftHp: Math.round(room.sim.raftHp ?? 100),
    harmony: Number((room.sim.harmony ?? 0).toFixed(2)),
    windX: Number((room.sim.windX ?? 0).toFixed(2)),
  };
  room.replayFrames.push(frame);
  room.nextReplaySampleElapsed = elapsed + REPLAY_SAMPLE_INTERVAL_SEC;
}

function appendReplayEvents(room: RoomRecord, stepEvents: SimEvent[]): void {
  if (!room.replayEvents) room.replayEvents = [];
  if (room.replayEvents.length >= 160) return;
  const t = Number((room.sim.elapsedTime ?? 0).toFixed(2));
  for (const ev of stepEvents) {
    if (ev.type === 'fart_start' || ev.type === 'fart_stop') continue;
    const entry: ReplayEventEntry = {
      t,
      type: ev.type,
      x: Number(ev.x.toFixed(2)),
      z: Number(ev.z.toFixed(2)),
      intensity: Number(ev.intensity.toFixed(2)),
      ...(ev.slot !== undefined ? { slot: ev.slot } : {}),
    };
    room.replayEvents.push(entry);
    if (room.replayEvents.length >= 160) break;
  }
}

export function stepRoomSimulation(
  room: RoomRecord,
  rawDt: number,
  nowMs = Date.now(),
): { events: SimEvent[]; lifecycleChanged: boolean; tempSubChanged: boolean; stepsExecuted: number } {
  for (const p of room.sim.players) {
    if (p.activeEmote && nowMs >= p.activeEmote.expiresAtMs) {
      p.activeEmote = null;
    }
  }

  if (room.lifecycleState !== 'PLAYING' && room.lifecycleState !== 'FALLING') {
    room.accumulatorSec = 0;
    return { events: [], lifecycleChanged: false, tempSubChanged: false, stepsExecuted: 0 };
  }

  // BOT-04: Activate temporary AI substitute if a disconnected seated human passed delay threshold
  const tempSubChanged = activateTempBotSubstitutesIfNeeded(room, nowMs);

  const boundedDt = Number.isFinite(rawDt) ? Math.min(Math.max(rawDt, 0), 0.25) : 0;
  room.accumulatorSec += boundedDt;

  const collectedEvents: SimEvent[] = [];
  const prevLifecycle = room.lifecycleState;
  let stepsExecuted = 0;

  const course = getCourseById(room.courseId);
  room.sim.courseId = course.id;

  while (room.accumulatorSec >= FIXED_SIM_DT && stepsExecuted < MAX_CATCHUP_STEPS) {
    if (room.lifecycleState !== 'PLAYING' && room.lifecycleState !== 'FALLING') {
      room.accumulatorSec = 0;
      break;
    }

    enforceInputTimeouts(room.sim, nowMs);

    // Keep room.sim.mode as 'online' cleanly while explicitly passing enableBots
    const stepEvents = stepSimulation(room.sim, FIXED_SIM_DT, course, {
      enableBots: room.fillBots,
    });

    if (stepEvents.length > 0) {
      collectedEvents.push(...stepEvents);
      room.recentEvents.push(...stepEvents);
      if (room.recentEvents.length > MAX_RECENT_EVENTS) {
        room.recentEvents.splice(0, room.recentEvents.length - MAX_RECENT_EVENTS);
      }
      appendReplayEvents(room, stepEvents);
    }

    appendReplayFrame(room, false);

    if (room.sim.phase === 'falling' && room.lifecycleState !== 'FALLING') {
      transitionRoomLifecycle(room, 'FALLING');
    } else if (room.sim.phase === 'playing' && room.lifecycleState !== 'PLAYING') {
      transitionRoomLifecycle(room, 'PLAYING');
    } else if (room.sim.phase === 'finished') {
      appendReplayFrame(room, true);
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
    tempSubChanged,
    stepsExecuted,
  };
}

export function prepareSimForStart(room: RoomRecord, nowMs = Date.now()): void {
  const course = getCourseById(room.courseId);
  const settings = normalizeRoomSettings(room.settings);
  room.settings = settings;
  room.courseId = course.id;
  room.accumulatorSec = 0;
  room.sim.courseId = course.id;
  room.sim.mode = 'online';
  room.sim.gameMode = settings.gameMode;
  room.sim.difficulty = settings.difficulty;
  room.sim.botDifficulty = settings.botDifficulty ?? 'normal';
  room.sim.enableItems = settings.enableItems;
  room.sim.roundTimeLimitSec = settings.roundTimeLimitSec;
  room.sim.phase = 'playing';
  room.sim.runOutcome = 'victory';
  room.sim.simTime = 0;
  room.sim.elapsedTime = 0;
  room.sim.falls = 0;
  room.sim.checkpointIndex = 0;
  room.sim.invulnTimer = 0;
  room.sim.fallTimer = 0;
  room.sim.hitstopTimer = 0;
  room.sim.progress = 0;
  room.sim.dynamicZones = createInitialDynamicZones(course);
  room.sim.pickups = createInitialPickups(course, settings.enableItems);
  room.sim.treasures = createInitialTreasures(course, settings.gameMode);
  room.sim.treasureScore = 0;
  room.sim.coinsCollected = 0;
  room.sim.totalCoins = room.sim.treasures.length;
  room.sim.survivalDistance = 0;
  room.sim.survivalSpeedScale = 1;
  room.sim.chaosModifier = 'none';
  room.sim.chaosTimer = settings.gameMode === 'chaos' ? 3.5 : 0;
  room.sim.activeHazardTag = null;
  room.sim.raftHp = 100;
  room.sim.maxHp = 100;
  room.sim.shieldHits = 0;
  room.sim.shieldTimer = 0;
  room.sim.magnetTimer = 0;
  room.sim.boostKind = null;
  room.sim.boostTimer = 0;
  room.sim.boostMultiplier = 1;
  room.sim.heldItem = null;
  room.sim.anchorActive = false;
  room.sim.anchorEnergy = 1;
  room.sim.anchorCooldown = 0;
  room.sim.harmony = 0;
  room.sim.superFartTimer = 0;
  room.sim.harmonyComboCount = 0;
  room.sim.windX = 0;
  room.sim.windZ = 0;
  room.sim.lightningTimer = 0;
  room.sim.itemsCollectedCount = 0;
  room.sim.harmonySuperFartCount = 0;
  room.sim.hardGatesPassed = 0;
  room.sim.minRaftHp = 100;
  room.sim.collisionCount = 0;
  room.sim.cleanCheckpoints = 0;
  room.sim.checkpointCollisionDirty = false;
  room.sim.roundHighlights = [];
  room.sim.eventSeq = 0;
  room.sim.events = [];
  room.recentEvents = [];
  room.replayFrames = [];
  room.replayEvents = [];
  room.nextReplaySampleElapsed = 0;

  room.sim.raft.x = 0;
  room.sim.raft.y = 0;
  room.sim.raft.z = course.startZ;
  room.sim.raft.vx = 0;
  room.sim.raft.vz = 0;
  room.sim.raft.yaw = 0;
  room.sim.raft.omega = 0;
  room.sim.raft.pitch = 0;
  room.sim.raft.roll = 0;
  room.sim.raft.pitchVel = 0;
  room.sim.raft.rollVel = 0;

  for (const p of room.sim.players) {
    p.tempBotSubstitute = false;
    p.farting = false;
    p.fartHoldTime = 0;
    p.fartPower = 0;
    p.moveDir = 0;
    p.lateralVel = 0;
    p.releaseBounce = 0;
    p.anchorRequested = false;
    p.useItemRequested = false;
    p.lastFartStartSimTime = -99;
    p.lastInputAt = nowMs;
    p.activeEmote = null;
    p.stats = {
      totalFartTime: 0,
      fartCount: 0,
      maxBurstDuration: 0,
      torqueImpulseSum: 0,
      wallImpactCount: 0,
      itemsUsed: 0,
      pushImpulseSum: 0,
    };
  }

  syncBotsInRoom(room, nowMs);
  transitionRoomLifecycle(room, 'PLAYING');
  room.roundSeq = (room.roundSeq ?? 0) + 1;
  room.snapshotSeq += 1;
  appendReplayFrame(room, true);
}

export function restartRoomToWaiting(room: RoomRecord, nowMs = Date.now()): void {
  transitionRoomLifecycle(room, 'RESTARTING');
  room.accumulatorSec = 0;

  const settings = normalizeRoomSettings(room.settings);
  room.settings = settings;
  const fresh = createInitialSimState('online', undefined, undefined, room.courseId, settings);
  fresh.phase = 'waiting';
  for (let i = 0; i < 4; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    const prev = room.sim.players[slot];
    fresh.players[slot].id = prev.id;
    fresh.players[slot].name = prev.name;
    fresh.players[slot].connected = prev.connected;
    fresh.players[slot].isBot = prev.isBot;
    fresh.players[slot].cosmetic = prev.cosmetic;
    fresh.players[slot].activeEmote = null;
    fresh.players[slot].lastInputAt = nowMs;
  }

  room.sim = fresh;
  room.recentEvents = [];
  room.replayFrames = [];
  room.replayEvents = [];
  room.nextReplaySampleElapsed = 0;

  // ONLINE-07: Promote earliest waiting spectators into open seats before bots fill empty slots
  promoteWaitingSpectators(room, nowMs);

  for (const session of room.sessions.values()) {
    const slot = session.slot;
    if (session.revoked || slot === -1) continue;
    session.ready = session.role === 'HOST';
    fresh.players[slot].ready = session.ready;
  }

  syncBotsInRoom(room, nowMs);
  transitionRoomLifecycle(room, 'WAITING');
  room.snapshotSeq += 1;
}
