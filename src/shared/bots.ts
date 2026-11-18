import { getChannelBoundsAtZ, getMovingGateTransform } from './course.ts';
import type {
  BotDifficulty,
  BotPersonality,
  CourseDefinition,
  PlayerSimState,
  WorldSimulationState,
} from './types.ts';

export interface BotDifficultyProfile {
  id: BotDifficulty;
  labelAr: string;
  descriptionAr: string;
  reactionStepSec: number;
  lookaheadZ: number;
  steeringGain: number;
  safetyMargin: number;
  allowAnchor: boolean;
  allowShockwave: boolean;
  syncSuperFartWindow: number;
}

export const BOT_DIFFICULTY_META: Record<BotDifficulty, BotDifficultyProfile> = {
  easy: {
    id: 'easy',
    labelAr: 'سهل',
    descriptionAr: 'ردة فعل أبطأ ومدى استشعار قصير، مناسب للتجربة الهادئة.',
    reactionStepSec: 0.45,
    lookaheadZ: 9,
    steeringGain: 0.78,
    safetyMargin: 1.0,
    allowAnchor: false,
    allowShockwave: false,
    syncSuperFartWindow: 0.25,
  },
  normal: {
    id: 'normal',
    labelAr: 'متوسط',
    descriptionAr: 'توقيت متوازن وتفادٍ جيد للبوابات والصخور وتعاون معقول.',
    reactionStepSec: 0.2,
    lookaheadZ: 16,
    steeringGain: 1.0,
    safetyMargin: 1.28,
    allowAnchor: true,
    allowShockwave: true,
    syncSuperFartWindow: 0.6,
  },
  hard: {
    id: 'hard',
    labelAr: 'صعب',
    descriptionAr: 'استشعار بعيد المدى وتنسيق جماعي ذكي واستخدام دقيق للمرساة والموجة.',
    reactionStepSec: 0.08,
    lookaheadZ: 24,
    steeringGain: 1.22,
    safetyMargin: 1.5,
    allowAnchor: true,
    allowShockwave: true,
    syncSuperFartWindow: 0.95,
  },
};

export interface BotPersonalityProfile {
  id: BotPersonality;
  labelAr: string;
  badgeIcon: string;
  descriptionAr: string;
}

export const BOT_PERSONALITY_META: Record<BotPersonality, BotPersonalityProfile> = {
  rusher: {
    id: 'rusher',
    labelAr: 'مندفع',
    badgeIcon: '🚀',
    descriptionAr: 'يفضّل الدفع المستمر ومنصات التسريع وعلب الطاقة.',
  },
  cautious: {
    id: 'cautious',
    labelAr: 'حذر',
    badgeIcon: '🛡️',
    descriptionAr: 'يوسّع هامش الأمان ويستخدم المرساة عند المنعطفات والرياح، ويفضّل الدروع.',
  },
  treasure_hunter: {
    id: 'treasure_hunter',
    labelAr: 'صائد الكنوز',
    badgeIcon: '🪙',
    descriptionAr: 'ينعطف بذكاء لالتقاط العملات والصناديق والمغناطيس عندما يكون الممر آمناً.',
  },
  balancer: {
    id: 'balancer',
    labelAr: 'موازن الطوف',
    badgeIcon: '⚖️',
    descriptionAr: 'يُوازن حركة الطاقم وميلان الطوف ويقاوم الانجراف الجانبي والرياح.',
  },
};

const DEFAULT_SLOT_PERSONALITIES: readonly [
  BotPersonality,
  BotPersonality,
  BotPersonality,
  BotPersonality,
] = ['balancer', 'rusher', 'cautious', 'treasure_hunter'];

export function getDefaultBotPersonality(slot: 0 | 1 | 2 | 3): BotPersonality {
  return DEFAULT_SLOT_PERSONALITIES[slot] ?? 'balancer';
}

export function isValidBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

export function isValidBotPersonality(value: unknown): value is BotPersonality {
  return (
    value === 'rusher' ||
    value === 'cautious' ||
    value === 'treasure_hunter' ||
    value === 'balancer'
  );
}

interface SwarmWaypointPlan {
  targetX: number;
  hazardSeverity: number; // 0..1
  imminentBlock: boolean;
  needsAnchor: boolean;
  shouldShockwave: boolean;
  humanFarting: boolean;
  channelCenterX: number;
  halfWidth: number;
}

function resolveBotDifficulty(state: WorldSimulationState): BotDifficultyProfile {
  const diff = state.botDifficulty ?? state.difficulty ?? 'normal';
  return BOT_DIFFICULTY_META[isValidBotDifficulty(diff) ? diff : 'normal'];
}

function resolvePersonality(player: PlayerSimState): BotPersonality {
  if (isValidBotPersonality(player.botPersonality)) {
    return player.botPersonality;
  }
  return getDefaultBotPersonality(player.slot);
}

/**
 * Computes a shared collision-free corridor target for the bot swarm ahead of the raft.
 * Evaluates static obstacles, moving gates (including vertical pistons), falling hazards,
 * and cracking/broken dynamic surfaces so cooperative bots align on one safe lane.
 */
function planSwarmCorridor(
  state: WorldSimulationState,
  course: CourseDefinition,
  profile: BotDifficultyProfile,
  quantizedSimTime: number,
  activeBots: PlayerSimState[],
): SwarmWaypointPlan {
  const raft = state.raft;
  const speedAhead = Math.max(4, -raft.vz);
  const lookaheadZ = Math.min(profile.lookaheadZ, Math.max(8, speedAhead * 1.45));
  const probeZ = raft.z - lookaheadZ * 0.55;
  const { centerX, halfWidth } = getChannelBoundsAtZ(probeZ, course.waypoints);
  const safeHalf = Math.max(2.0, halfWidth - 2.65);

  const hasTreasureHunter = activeBots.some((b) => resolvePersonality(b) === 'treasure_hunter');
  const hasCautious = activeBots.some((b) => resolvePersonality(b) === 'cautious');
  const hasRusher = activeBots.some((b) => resolvePersonality(b) === 'rusher');

  const sampleCount = profile.id === 'easy' ? 5 : 9;
  let bestTargetX = centerX;
  let bestScore = -Infinity;
  let minClearancePenalty = 0;

  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const candX = centerX + (t * 2 - 1) * (safeHalf * 0.9);
    // Base preference: stay near channel center & close to current raft alignment
    let score = -Math.abs(candX - centerX) * 0.35 - Math.abs(candX - raft.x) * 0.2;
    let hazardCost = 0;

    // 1. Static obstacles within lookahead band
    for (const obs of course.staticObstacles) {
      if (obs.z > raft.z + 1.5 || obs.z < raft.z - lookaheadZ) continue;
      const dx = Math.abs(candX - obs.x);
      const minGap = obs.radius + 2.35 * profile.safetyMargin + (hasCautious ? 0.55 : 0);
      if (dx < minGap) {
        const dzWeight = 1 - Math.min(1, Math.abs(raft.z - obs.z) / lookaheadZ);
        hazardCost += ((minGap - dx) / minGap) * (28 + 20 * dzWeight);
      }
    }

    // 2. Moving gates & vertical pistons (predictive lead for normal/hard)
    for (const gate of course.movingGates) {
      if (gate.z > raft.z + 1.5 || gate.z < raft.z - lookaheadZ) continue;
      const distZ = Math.max(0.5, raft.z - gate.z);
      const eta = profile.id === 'easy' ? 0 : Math.min(1.5, distZ / speedAhead);
      const tr = getMovingGateTransform(gate, quantizedSimTime + eta);
      if (!tr.blocksChannel) continue;
      const gateLeft = tr.x - gate.halfWidth - 2.1 * profile.safetyMargin;
      const gateRight = tr.x + gate.halfWidth + 2.1 * profile.safetyMargin;
      if (candX >= gateLeft && candX <= gateRight) {
        const penetration = Math.min(candX - gateLeft, gateRight - candX);
        hazardCost += 22 + penetration * 5;
      }
    }

    // 3. Falling hazards in warning/impact window
    for (const fh of course.fallingHazards) {
      if (fh.z > raft.z + 2 || fh.z < raft.z - lookaheadZ) continue;
      const cycle = ((quantizedSimTime + fh.phaseOffset) % fh.period + fh.period) % fh.period;
      if (cycle >= fh.period - fh.warningDuration - 0.5 || cycle < 0.4) {
        const dx = Math.abs(candX - fh.x);
        const minGap = fh.radius + 2.4 * profile.safetyMargin;
        if (dx < minGap) {
          hazardCost += 24 * (1 - dx / minGap);
        }
      }
    }

    // 4. Cracking or broken dynamic floor zones
    for (let zi = 0; zi < course.dynamicZones.length; zi++) {
      const dz = course.dynamicZones[zi];
      if (dz.z > raft.z + 2 || dz.z < raft.z - lookaheadZ) continue;
      const dState = state.dynamicZones[zi];
      if (dState && dState.status !== 'intact') {
        const dx = Math.abs(candX - dz.x);
        if (dx < dz.halfWidth + 1.8) {
          hazardCost += dState.status === 'broken' ? 35 : 14;
        }
      }
    }

    // 5. Beneficial incentives: Pickups, Boost Pads, Treasures
    if (state.enableItems) {
      for (const pickup of state.pickups) {
        if (pickup.collected || pickup.z > raft.z + 1 || pickup.z < raft.z - lookaheadZ) continue;
        const dx = Math.abs(candX - pickup.x);
        if (dx < 3.6) {
          let weight = 3.5;
          if (hasRusher && (pickup.kind === 'lentil_can' || pickup.kind === 'fava_can' || pickup.kind === 'bean_can')) {
            weight += 4.2;
          }
          if (hasCautious && (pickup.kind === 'shield' || pickup.kind === 'repair_kit')) {
            weight += 4.5;
          }
          if (hasTreasureHunter && pickup.kind === 'magnet') {
            weight += 5.0;
          }
          score += (1 - dx / 3.6) * weight;
        }
      }
    }

    if (hasRusher || profile.id !== 'easy') {
      for (const pad of course.boostPads) {
        if (pad.z > raft.z + 1 || pad.z < raft.z - lookaheadZ) continue;
        const dx = Math.abs(candX - pad.x);
        if (dx < 3.4) {
          score += (1 - dx / 3.4) * (hasRusher ? 6.0 : 2.5);
        }
      }
    }

    if (hasTreasureHunter || state.gameMode === 'treasure') {
      for (const tr of state.treasures) {
        if (tr.collected || tr.z > raft.z + 1 || tr.z < raft.z - lookaheadZ) continue;
        const dx = Math.abs(candX - tr.x);
        if (dx < 3.8) {
          const valBonus = tr.kind === 'chest' ? 7.5 : 3.2;
          score += (1 - dx / 3.8) * (hasTreasureHunter ? valBonus * 1.45 : valBonus * 0.75);
        }
      }
    }

    const total = score - hazardCost;
    if (total > bestScore) {
      bestScore = total;
      bestTargetX = candX;
      minClearancePenalty = hazardCost;
    }
  }

  // Evaluate near-field imminent danger (within 7.5m) for cooperative anchor / shockwave
  let imminentBlock = false;
  for (const gate of course.movingGates) {
    if (gate.z > raft.z || gate.z < raft.z - 7.5) continue;
    const tr = getMovingGateTransform(gate, quantizedSimTime + 0.15);
    if (tr.blocksChannel && Math.abs(raft.x - tr.x) < gate.halfWidth + 2.2) {
      imminentBlock = true;
      break;
    }
  }

  const lateralSpeed = Math.abs(raft.vx);
  const edgeProximity = Math.max(0, Math.abs(raft.x - centerX) - (safeHalf - 1.1));
  const needsAnchor =
    profile.allowAnchor &&
    state.anchorEnergy > 0.28 &&
    (imminentBlock || (lateralSpeed > 7.5 && edgeProximity > 0.2) || (Math.abs(state.windX) > 7 && edgeProximity > 0));

  const shouldShockwave =
    profile.allowShockwave &&
    state.heldItem === 'shockwave' &&
    (imminentBlock || minClearancePenalty > 18 || state.raftHp < 55);

  const humanFarting = state.players.some(
    (p) => !p.isBot && p.connected && (p.farting || (p.lastFartStartSimTime !== undefined && state.simTime - p.lastFartStartSimTime <= profile.syncSuperFartWindow)),
  );

  const hazardSeverity = Math.min(1, minClearancePenalty / 32);

  return {
    targetX: bestTargetX,
    hazardSeverity,
    imminentBlock,
    needsAnchor,
    shouldShockwave,
    humanFarting,
    channelCenterX: centerX,
    halfWidth,
  };
}

/**
 * Cooperative Swarm AI for Bots (BOT-01, BOT-02, BOT-03).
 * Fair physics: only sets moveDir, farting, anchorRequested, useItemRequested.
 */
export function computeSwarmBotDirectives(
  state: WorldSimulationState,
  course: CourseDefinition,
): void {
  const activeBots = state.players.filter((p) => p.isBot && p.connected);
  if (activeBots.length === 0) return;

  const profile = resolveBotDifficulty(state);
  const quantizedTime =
    profile.reactionStepSec > 0
      ? Math.floor(state.simTime / profile.reactionStepSec) * profile.reactionStepSec
      : state.simTime;

  const swarmPlan = planSwarmCorridor(state, course, profile, quantizedTime, activeBots);

  const desiredCenterOffset = swarmPlan.targetX - state.raft.x;
  const targetYaw = Math.max(-0.46, Math.min(0.46, -desiredCenterOffset * 0.095 * profile.steeringGain));
  const yawError = targetYaw - state.raft.yaw;
  const yawCommand = yawError * 2.2 - state.raft.omega * 0.65;

  // Determine how much left vs right lateral trim is needed so bots don't fight each other
  const leftSideWeight = activeBots.filter((b) => b.slot === 0 || b.slot === 2).length;
  const rightSideWeight = activeBots.filter((b) => b.slot === 1 || b.slot === 3).length;
  const crewImbalance = rightSideWeight - leftSideWeight;

  // Reverse chaos modifier awareness on Normal/Hard
  const controlsReversed =
    state.chaosModifier === 'reverse_controls' && profile.id !== 'easy';
  const dirSign = controlsReversed ? -1 : 1;

  // Read human player(s) intent so bots actively cooperate with the player!
  const activeHumans = state.players.filter((p) => !p.isBot && p.connected);
  const humanMoveDir =
    activeHumans.length > 0
      ? activeHumans.reduce((sum, h) => sum + h.moveDir, 0) / activeHumans.length
      : 0;
  const humanLocalX =
    activeHumans.length > 0
      ? activeHumans.reduce((sum, h) => sum + h.localX, 0) / activeHumans.length
      : 0;

  for (const player of activeBots) {
    const personality = resolvePersonality(player);
    const isFrontSlot = player.slot === 2 || player.slot === 3;
    // Slight personal seat anchor around center so bots don't stack on one pixel,
    // while still able to cross freely to BOTH left (-1.35) and right (+1.35) sides.
    const seatBias = (player.slot - 1.5) * 0.22;

    // 1. Movement / Roll-Balance Steering (`moveDir`)
    // Combine swarm corridor yaw steering, human teamwork, and distinct personality goals
    let desiredShiftX = seatBias + Math.max(-1.15, Math.min(1.15, yawCommand * 1.05));

    if (personality === 'rusher') {
      // Rusher teams up with the human's steering direction to carve aggressive turns & hit boost pads
      desiredShiftX += humanMoveDir * 0.65;
      let nearestPadDx = 0;
      let bestPadDist = 16;
      for (const pad of course.boostPads) {
        if (pad.z > state.raft.z || pad.z < state.raft.z - 16) continue;
        const d = state.raft.z - pad.z;
        if (d < bestPadDist) {
          bestPadDist = d;
          nearestPadDx = pad.x - state.raft.x;
        }
      }
      if (bestPadDist < 16) {
        desiredShiftX += Math.max(-0.8, Math.min(0.8, nearestPadDx * 0.2));
      }
    } else if (personality === 'balancer') {
      // Balancer actively counter-balances the human's weight, raft roll, and side winds
      const windCounter = -state.windX * 0.09;
      const rollCounter = -state.raft.roll * 2.1;
      const humanCounter = -humanLocalX * 0.55;
      const weightCounter = -crewImbalance * 0.25;
      desiredShiftX =
        Math.max(-1.3, Math.min(1.3, windCounter + rollCounter + humanCounter + weightCounter + yawCommand * 0.45));
    } else if (personality === 'cautious') {
      // Cautious leans strongly toward the safest channel center away from walls & hazards
      const edgePush = (swarmPlan.channelCenterX - state.raft.x) * 0.22;
      desiredShiftX += Math.max(-0.95, Math.min(0.95, edgePush));
    } else if (personality === 'treasure_hunter') {
      // Treasure hunter actively shifts left OR right to steer toward the nearest coin/chest
      let nearestCoinDx = 0;
      let bestDist = 18;
      for (const tr of state.treasures) {
        if (tr.collected || tr.z > state.raft.z || tr.z < state.raft.z - 18) continue;
        const d = state.raft.z - tr.z;
        if (d < bestDist) {
          bestDist = d;
          nearestCoinDx = tr.x - state.raft.x;
        }
      }
      if (bestDist < 18) {
        desiredShiftX = Math.max(-1.35, Math.min(1.35, nearestCoinDx * 0.28 + yawCommand * 0.45));
      } else {
        // When no treasure is nearby, cooperate gently with human steering
        desiredShiftX += humanMoveDir * 0.35;
      }
    }

    desiredShiftX = Math.max(-1.35, Math.min(1.35, desiredShiftX));
    const dx = desiredShiftX - player.localX;
    let rawMoveDir: -1 | 0 | 1 = dx > 0.14 ? 1 : dx < -0.14 ? -1 : 0;
    if (dirSign === -1 && rawMoveDir !== 0) {
      rawMoveDir = (rawMoveDir === 1 ? -1 : 1) as -1 | 1;
    }
    player.moveDir = rawMoveDir;

    // 2. Cooperative Thruster (`farting`)
    // Avoid opposing torque when heading is strongly skewed; favor synchronized Super Fart bursts
    const forwardSpeed = -state.raft.vz;
    const minTargetSpeed =
      personality === 'rusher' ? 12.2 : personality === 'cautious' ? 8.2 : 10.0;

    // Contribution to yaw from firing this slot:
    // Left slots (localX < 0) produce slight positive yaw torque when pushing right-of-center?
    // Actually in physics.ts: torque = -(player.localX * thrust). So left slots (localX < 0) -> positive torque (+yaw turns left).
    // Right slots (localX > 0) -> negative torque (-yaw turns right).
    const torqueDirection = player.localX < 0 ? 1 : -1;
    const helpsSteering = torqueDirection * yawCommand > -0.25;
    const urgentTurn = Math.abs(yawCommand) > 0.55 && torqueDirection * yawCommand > 0.2;

    const pulseWindow = ((quantizedTime + player.slot * 0.14) % 1.4) < (personality === 'rusher' ? 1.15 : 0.85);
    const shouldSyncHuman = swarmPlan.humanFarting && helpsSteering;
    const slowSpeedPush = forwardSpeed < minTargetSpeed && helpsSteering;
    const brakeForImminentBlock =
      swarmPlan.imminentBlock && (personality === 'cautious' || profile.id === 'hard');

    if (brakeForImminentBlock) {
      player.farting = false;
    } else if (shouldSyncHuman || urgentTurn) {
      player.farting = true;
    } else if (isFrontSlot && forwardSpeed > 13.5 && swarmPlan.hazardSeverity > 0.45) {
      player.farting = false;
    } else {
      player.farting = (slowSpeedPush || pulseWindow) && helpsSteering;
    }

    // 3. Cooperative Anchor & Shockwave Item Usage
    const wantsAnchor =
      swarmPlan.needsAnchor &&
      (personality === 'cautious' || personality === 'balancer' || swarmPlan.imminentBlock);
    player.anchorRequested = Boolean(wantsAnchor);

    // Only one designated bot triggers shockwave per frame to avoid duplicate consumption
    player.useItemRequested =
      swarmPlan.shouldShockwave && player.slot === activeBots[0].slot;
  }
}
