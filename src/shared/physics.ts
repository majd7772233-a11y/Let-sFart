import {
  CHARACTER_PRESETS,
  COURSE_MAIN,
  PLAYER_ZONES,
  RAFT_RADIUS,
  getChannelBoundsAtZ,
  getCourseProgress,
  getMovingGateCenterX,
} from './course.ts';
import type {
  CourseDefinition,
  PlayMode,
  PlayerCosmetic,
  PlayerSimState,
  SimEvent,
  WorldSimulationState,
} from './types.ts';

export const FART_RAMP_DURATION = 1.5; // T in F(t) = F_max * g(t / T)
export const FART_MAX_THRUST = 24.0;
export const FART_TORQUE_FACTOR = 0.095;
export const LATERAL_MOVE_SPEED = 2.6;
export const RAFT_LINEAR_DRAG = 1.45;
export const RAFT_ANGULAR_DRAG = 3.6;
export const RAFT_MAX_SPEED = 17.5;
export const RAFT_MAX_OMEGA = 2.8;
export const SAFE_INPUT_TIMEOUT_MS = 2500;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Gradual fart intensity curve: F(t) / F_max = g(t / T)
 * Starts immediately at 0.24 on press, increases smoothly to 1.0 at T, and stays at 1.0.
 */
export function computeFartFactor(holdTime: number, rampDuration = FART_RAMP_DURATION): number {
  if (holdTime < 0) return 0;
  const u = clamp(holdTime / rampDuration, 0, 1);
  return 0.24 + 0.76 * (1 - Math.pow(1 - u, 2.1));
}

export function createDefaultCosmetic(slot: number): PlayerCosmetic {
  const hats = ['captain', 'propeller', 'none', 'crown'] as const;
  const glasses = ['none', 'nerd', 'shades', 'none'] as const;
  return {
    hat: hats[slot % hats.length],
    glasses: glasses[slot % glasses.length],
    colorIndex: slot % 4,
  };
}

export function createPlayerState(
  slot: 0 | 1 | 2 | 3,
  opts?: { id?: string; name?: string; connected?: boolean; isBot?: boolean; cosmetic?: PlayerCosmetic },
): PlayerSimState {
  const zone = PLAYER_ZONES[slot];
  const preset = CHARACTER_PRESETS[slot];
  return {
    slot,
    id: opts?.id ?? `bot-${slot}`,
    name: opts?.name ?? preset.name,
    connected: opts?.connected ?? false,
    isBot: opts?.isBot ?? false,
    ready: opts?.isBot ?? false,
    cosmetic: opts?.cosmetic ?? createDefaultCosmetic(slot),
    localX: zone.defaultX,
    lateralVel: 0,
    moveDir: 0,
    farting: false,
    fartHoldTime: 0,
    fartPower: 0,
    releaseBounce: 0,
    lastInputAt: Date.now(),
    stats: {
      totalFartTime: 0,
      fartCount: 0,
      maxBurstDuration: 0,
      torqueImpulseSum: 0,
      wallImpactCount: 0,
    },
  };
}

export function createInitialSimState(
  mode: PlayMode = 'solo',
  playerName = 'أنت',
  playerCosmetic?: PlayerCosmetic,
): WorldSimulationState {
  const p0 = createPlayerState(0, {
    id: 'local-0',
    name: playerName,
    connected: true,
    isBot: false,
    cosmetic: playerCosmetic,
  });
  const p1 = createPlayerState(1, { isBot: mode === 'solo', connected: mode === 'solo' });
  const p2 = createPlayerState(2, { isBot: mode === 'solo', connected: mode === 'solo' });
  const p3 = createPlayerState(3, { isBot: mode === 'solo', connected: mode === 'solo' });

  return {
    mode,
    phase: 'playing',
    simTime: 0,
    elapsedTime: 0,
    raft: {
      x: 0,
      y: 0,
      z: COURSE_MAIN.startZ,
      vx: 0,
      vz: 0,
      yaw: 0,
      omega: 0,
      pitch: 0,
      roll: 0,
      pitchVel: 0,
      rollVel: 0,
    },
    players: [p0, p1, p2, p3],
    checkpointIndex: 0,
    falls: 0,
    progress: 0,
    invulnTimer: 0,
    fallTimer: 0,
    hitstopTimer: 0,
    events: [],
  };
}

export function isDangerOpenEdgeZone(z: number): boolean {
  // Open waterfall drop-off segments in narrow gorge, sharp bend, and final gauntlet
  return (
    (z <= -102 && z >= -142) ||
    (z <= -206 && z >= -252) ||
    (z <= -280 && z >= -312)
  );
}

/**
 * Lightweight cooperative AI bots so Solo mode or partial online rooms still feel lively
 * without overriding the human player's steering authority.
 */
export function updateBotInputs(state: WorldSimulationState, course: CourseDefinition = COURSE_MAIN): void {
  const raft = state.raft;
  const lookAheadZ = raft.z - 12;
  const targetChannel = getChannelBoundsAtZ(lookAheadZ, course.waypoints);
  const dxToCenter = targetChannel.centerX - raft.x;
  const desiredYaw = clamp(-Math.atan2(dxToCenter, 14), -0.65, 0.65);
  const yawError = desiredYaw - raft.yaw;
  const forwardSpeed = -raft.vx * Math.sin(raft.yaw) - raft.vz * Math.cos(raft.yaw);

  // Check if human slot 0 is actively steering
  const human = state.players[0];
  const humanThrusting = human && !human.isBot && human.farting;

  for (const p of state.players) {
    if (!p.isBot || !p.connected) continue;
    const zone = PLAYER_ZONES[p.slot];

    // Steer gently to assist keeping raft inside channel while respecting human input
    let desiredLocalX = zone.defaultX;
    if (Math.abs(yawError) > 0.08) {
      // Positive yawError => need +torque => positive localX shift
      desiredLocalX = clamp(zone.defaultX + clamp(yawError * 1.1, -0.75, 0.75), zone.minX, zone.maxX);
    }

    const diffX = desiredLocalX - p.localX;
    p.moveDir = Math.abs(diffX) > 0.12 ? (diffX > 0 ? 1 : -1) : 0;

    // Bots pulse fart gently to maintain steady cruise or assist when human farts
    const botWave = Math.sin(state.simTime * (1.8 + p.slot * 0.35) + p.slot * 1.9);
    const needsForwardPush = forwardSpeed < 5.5 || humanThrusting;
    p.farting = needsForwardPush && (botWave > -0.25 || Math.abs(yawError) > 0.22);
  }
}

export function respawnAtCheckpoint(
  state: WorldSimulationState,
  course: CourseDefinition = COURSE_MAIN,
): void {
  const cp = course.checkpoints[state.checkpointIndex] ?? course.checkpoints[0];
  state.raft.x = cp.x;
  state.raft.y = 0;
  state.raft.z = cp.z;
  state.raft.vx = 0;
  state.raft.vz = 0;
  state.raft.yaw = cp.yaw;
  state.raft.omega = 0;
  state.raft.pitch = 0;
  state.raft.roll = 0;
  state.raft.pitchVel = 0;
  state.raft.rollVel = 0;

  for (const p of state.players) {
    const zone = PLAYER_ZONES[p.slot];
    p.localX = zone.defaultX;
    p.lateralVel = 0;
    p.farting = false;
    p.fartHoldTime = 0;
    p.fartPower = 0;
    p.releaseBounce = 0.5;
  }

  state.phase = 'playing';
  state.fallTimer = 0;
  state.invulnTimer = 1.5;
}

export function enforceInputTimeouts(state: WorldSimulationState, nowMs: number): void {
  for (const p of state.players) {
    if (!p.isBot && p.connected && p.farting && nowMs - p.lastInputAt > SAFE_INPUT_TIMEOUT_MS) {
      p.farting = false;
    }
    if (!p.connected && !p.isBot) {
      p.farting = false;
      p.moveDir = 0;
    }
  }
}

export function stepSimulation(
  state: WorldSimulationState,
  rawDt: number,
  course: CourseDefinition = COURSE_MAIN,
): SimEvent[] {
  const dt = clamp(rawDt, 0, 0.05);
  state.events = [];

  if (state.phase === 'paused' || state.phase === 'waiting' || state.phase === 'finished') {
    return state.events;
  }

  // Hitstop freezes simulation physics briefly on heavy impact while still letting visuals tick
  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return state.events;
  }

  state.simTime += dt;

  // Handle comical falling state before checkpoint respawn
  if (state.phase === 'falling') {
    state.fallTimer -= dt;
    state.raft.y -= 13.5 * dt;
    state.raft.pitch += 2.2 * dt;
    state.raft.roll += 3.1 * dt;
    if (state.fallTimer <= 0) {
      respawnAtCheckpoint(state, course);
    }
    return state.events;
  }

  state.elapsedTime += dt;
  if (state.invulnTimer > 0) {
    state.invulnTimer = Math.max(0, state.invulnTimer - dt);
  }

  if (state.mode === 'solo') {
    updateBotInputs(state, course);
  }

  const raft = state.raft;
  const fwdX = -Math.sin(raft.yaw);
  const fwdZ = -Math.cos(raft.yaw);

  let totalThrust = 0;
  let totalTorque = 0;
  let weightBalanceX = 0;
  let activeCount = 0;

  for (const p of state.players) {
    const zone = PLAYER_ZONES[p.slot];

    // Lateral movement strictly inside quarter zone
    const targetLatVel = p.connected ? p.moveDir * LATERAL_MOVE_SPEED : 0;
    p.lateralVel += (targetLatVel - p.lateralVel) * clamp(14 * dt, 0, 1);
    p.localX = clamp(p.localX + p.lateralVel * dt, zone.minX, zone.maxX);
    if ((p.localX <= zone.minX && p.lateralVel < 0) || (p.localX >= zone.maxX && p.lateralVel > 0)) {
      p.lateralVel = 0;
    }

    if (p.connected) {
      weightBalanceX += p.localX;
      activeCount++;
    }

    // Gradual fart thrust
    if (p.farting && p.connected) {
      if (p.fartHoldTime === 0) {
        p.stats.fartCount += 1;
        state.events.push({
          type: 'fart_start',
          slot: p.slot,
          intensity: 0.25,
          x: raft.x,
          z: raft.z,
        });
      }
      p.fartHoldTime += dt;
      p.stats.totalFartTime += dt;
      if (p.fartHoldTime > p.stats.maxBurstDuration) {
        p.stats.maxBurstDuration = p.fartHoldTime;
      }
      p.fartPower = computeFartFactor(p.fartHoldTime);
      p.releaseBounce = 0;

      // Scale per-player thrust slightly depending on active crew count so solo or 2-4p all feel snappy
      const crewScale = activeCount > 0 ? Math.min(1.5, 2.2 / Math.max(1, activeCount * 0.62)) : 1;
      const force = FART_MAX_THRUST * p.fartPower * crewScale;
      totalThrust += force;

      // Torque = +localX * force (right-side push turns bow left / +yaw)
      const torque = p.localX * force * FART_TORQUE_FACTOR;
      totalTorque += torque;
      p.stats.torqueImpulseSum += Math.abs(torque) * dt;
    } else {
      if (p.fartHoldTime > 0) {
        state.events.push({
          type: 'fart_stop',
          slot: p.slot,
          intensity: p.fartPower,
          x: raft.x,
          z: raft.z,
        });
        p.releaseBounce = Math.max(p.releaseBounce, 0.35 + p.fartPower * 0.65);
      }
      p.fartHoldTime = 0;
      p.fartPower = Math.max(0, p.fartPower - dt * 5.5);
      p.releaseBounce = Math.max(0, p.releaseBounce - dt * 3.2);
    }
  }

  // Apply thrust force + water drag
  raft.vx += fwdX * totalThrust * dt;
  raft.vz += fwdZ * totalThrust * dt;

  const dragFactor = Math.exp(-RAFT_LINEAR_DRAG * dt);
  raft.vx *= dragFactor;
  raft.vz *= dragFactor;

  // Mild forward water current gently carries raft if near zero speed inside course
  const speed = Math.hypot(raft.vx, raft.vz);
  if (speed > RAFT_MAX_SPEED) {
    const s = RAFT_MAX_SPEED / speed;
    raft.vx *= s;
    raft.vz *= s;
  }

  // Rotational physics
  raft.omega += totalTorque * dt;
  raft.omega *= Math.exp(-RAFT_ANGULAR_DRAG * dt);
  raft.omega = clamp(raft.omega, -RAFT_MAX_OMEGA, RAFT_MAX_OMEGA);

  // Advance position & yaw
  raft.x += raft.vx * dt;
  raft.z += raft.vz * dt;
  raft.yaw += raft.omega * dt;

  // Keep yaw wrapped nicely
  if (raft.yaw > Math.PI) raft.yaw -= Math.PI * 2;
  if (raft.yaw < -Math.PI) raft.yaw += Math.PI * 2;

  // Visual spring tilt (pitch backward on thrust, roll on yaw + weight shift)
  const targetPitch = clamp(-totalThrust * 0.0022, -0.18, 0.12);
  const targetRoll = clamp(-raft.omega * 0.14 - (weightBalanceX / Math.max(1, activeCount)) * 0.035, -0.24, 0.24);
  raft.pitchVel += ((targetPitch - raft.pitch) * 65 - raft.pitchVel * 9) * dt;
  raft.rollVel += ((targetRoll - raft.roll) * 65 - raft.rollVel * 9) * dt;
  raft.pitch += raft.pitchVel * dt;
  raft.roll += raft.rollVel * dt;

  // Boost pads (water current jets)
  for (const pad of course.boostPads) {
    const dx = raft.x - pad.x;
    const dz = raft.z - pad.z;
    const dist = Math.hypot(dx, dz);
    if (dist < pad.radius + RAFT_RADIUS * 0.6) {
      raft.vx += pad.dirX * pad.strength * dt * 3.2;
      raft.vz += pad.dirZ * pad.strength * dt * 3.2;
    }
  }

  // Collisions with static obstacles
  for (const obs of course.staticObstacles) {
    const dx = raft.x - obs.x;
    const dz = raft.z - obs.z;
    const dist = Math.hypot(dx, dz);
    const minDist = RAFT_RADIUS + obs.radius;
    if (dist < minDist) {
      const nx = dist > 0.0001 ? dx / dist : 0;
      const nz = dist > 0.0001 ? dz / dist : 1;
      const overlap = minDist - dist;
      raft.x += nx * overlap;
      raft.z += nz * overlap;

      const vn = raft.vx * nx + raft.vz * nz;
      if (vn < 0) {
        const bounce = 1 + obs.restitution;
        raft.vx -= bounce * vn * nx;
        raft.vz -= bounce * vn * nz;

        // Extra bounce kick for bumpers
        if (obs.kind === 'bumper') {
          raft.vx += nx * 7.5;
          raft.vz += nz * 7.5;
          raft.omega += (nx > 0 ? -1 : 1) * 1.4;
          state.hitstopTimer = Math.max(state.hitstopTimer, 0.035);
          state.events.push({
            type: 'bumper',
            intensity: clamp(Math.abs(vn) / 10 + 0.4, 0.3, 1),
            x: obs.x,
            z: obs.z,
          });
        } else {
          const impactStrength = clamp(Math.abs(vn) / 12, 0.15, 1);
          if (impactStrength > 0.45) {
            state.hitstopTimer = Math.max(state.hitstopTimer, 0.03);
          }
          for (const p of state.players) {
            if (p.farting) p.stats.wallImpactCount += 1;
          }
          state.events.push({
            type: 'collision',
            intensity: impactStrength,
            x: obs.x,
            z: obs.z,
          });
        }
      }
    }
  }

  // Collisions with moving barrier gates (AABB vs circle)
  for (const gate of course.movingGates) {
    const gx = getMovingGateCenterX(gate, state.simTime);
    const closestX = clamp(raft.x, gx - gate.halfWidth, gx + gate.halfWidth);
    const closestZ = clamp(raft.z, gate.z - gate.depth * 0.5, gate.z + gate.depth * 0.5);
    const dx = raft.x - closestX;
    const dz = raft.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < RAFT_RADIUS * RAFT_RADIUS) {
      const dist = Math.sqrt(distSq);
      const nx = dist > 0.0001 ? dx / dist : 0;
      const nz = dist > 0.0001 ? dz / dist : 1;
      const overlap = RAFT_RADIUS - dist;
      raft.x += nx * overlap;
      raft.z += nz * overlap;

      const vn = raft.vx * nx + raft.vz * nz;
      if (vn < 0) {
        raft.vx -= 1.85 * vn * nx;
        raft.vz -= 1.85 * vn * nz;
        raft.omega += (raft.x - gx) * 0.35;
        state.hitstopTimer = Math.max(state.hitstopTimer, 0.045);
        state.events.push({
          type: 'collision',
          intensity: clamp(Math.abs(vn) / 10 + 0.35, 0.3, 1),
          x: closestX,
          z: closestZ,
        });
      }
    }
  }

  // Channel boundary walls vs open waterfall drop-off
  const bounds = getChannelBoundsAtZ(raft.z, course.waypoints);
  const offsetFromCenter = raft.x - bounds.centerX;
  const maxSafeOffset = bounds.halfWidth - RAFT_RADIUS * 0.65;

  if (isDangerOpenEdgeZone(raft.z)) {
    // Open cliff/waterfall edge: falling off triggers comical fall & checkpoint respawn
    if (Math.abs(offsetFromCenter) > bounds.halfWidth + 0.65 && state.invulnTimer <= 0) {
      state.phase = 'falling';
      state.fallTimer = 0.85;
      state.falls += 1;
      state.events.push({
        type: 'fall',
        intensity: 1,
        x: raft.x,
        z: raft.z,
      });
      return state.events;
    }
  } else if (Math.abs(offsetFromCenter) > maxSafeOffset) {
    // Rocky canyon bank: bounce back inward safely
    const sign = offsetFromCenter > 0 ? 1 : -1;
    raft.x = bounds.centerX + sign * maxSafeOffset;
    if (raft.vx * sign > 0) {
      const impact = clamp(Math.abs(raft.vx) / 12, 0.15, 0.9);
      raft.vx = -raft.vx * 0.55;
      raft.omega -= sign * 0.45;
      if (impact > 0.25) {
        state.events.push({
          type: 'collision',
          intensity: impact,
          x: raft.x,
          z: raft.z,
        });
      }
    }
  }

  // Soft backstop behind start bay so raft can't reverse infinitely
  if (raft.z > course.waypoints[0].z - 3) {
    raft.z = course.waypoints[0].z - 3;
    if (raft.vz > 0) raft.vz = -raft.vz * 0.4;
  }

  // Checkpoint capture
  for (const cp of course.checkpoints) {
    if (cp.index > state.checkpointIndex) {
      const dist = Math.hypot(raft.x - cp.x, raft.z - cp.z);
      if (dist <= cp.radius + RAFT_RADIUS || raft.z <= cp.z) {
        state.checkpointIndex = cp.index;
        state.events.push({
          type: 'checkpoint',
          intensity: 1,
          x: cp.x,
          z: cp.z,
        });
      }
    }
  }

  // Progress & Finish Line
  state.progress = getCourseProgress(raft.z, course);
  if (raft.z <= course.finishZ) {
    state.phase = 'finished';
    state.progress = 1;
    for (const p of state.players) {
      p.farting = false;
      p.moveDir = 0;
    }
    state.events.push({
      type: 'finish',
      intensity: 1,
      x: raft.x,
      z: raft.z,
    });
  }

  return state.events;
}
