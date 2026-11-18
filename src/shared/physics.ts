import {
  CHARACTER_PRESETS,
  COURSE_MAIN,
  PLAYER_ZONES,
  RAFT_RADIUS,
  getChannelBoundsAtZ,
  getCourseById,
  getCourseProgress,
  getMovingGateTransform,
  isWindZoneActive,
} from './course.ts';
import {
  computeSwarmBotDirectives,
  getDefaultBotPersonality,
  isValidBotDifficulty,
  isValidBotPersonality,
} from './bots.ts';
import type {
  BoostCanKind,
  BotDifficulty,
  BotPersonalitiesMap,
  ChaosModifierKind,
  CourseDefinition,
  CourseId,
  DynamicZoneState,
  GameDifficulty,
  GameMode,
  HazardEffectTag,
  PickupKind,
  PickupSimState,
  PlayMode,
  PlayerCosmetic,
  PlayerSimState,
  RoomSettings,
  RoundHighlight,
  RoundHighlightKind,
  SimEvent,
  TreasureSimState,
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

export const CAN_BOOST_TIERS: Record<BoostCanKind, { multiplier: number; duration: number }> = {
  lentil_can: { multiplier: 1.65, duration: 8.5 }, // العدس (أقوى)
  fava_can: { multiplier: 1.38, duration: 7.2 }, // الفول (متوسط)
  bean_can: { multiplier: 1.2, duration: 6.0 }, // الفاصولياء (أساسي)
};

export const VALID_GAME_MODES: readonly GameMode[] = [
  'standard',
  'time_trial',
  'survival',
  'treasure',
  'chaos',
];

export const VALID_DIFFICULTIES: readonly GameDifficulty[] = ['easy', 'normal', 'hard'];

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  gameMode: 'standard',
  difficulty: 'normal',
  enableItems: true,
  roundTimeLimitSec: 0,
  maxPlayers: 4,
  botDifficulty: 'normal',
  botPersonalities: {
    0: 'balancer',
    1: 'rusher',
    2: 'cautious',
    3: 'treasure_hunter',
  },
};

export function isValidGameMode(value: unknown): value is GameMode {
  return (
    value === 'standard' ||
    value === 'time_trial' ||
    value === 'survival' ||
    value === 'treasure' ||
    value === 'chaos'
  );
}

export function isValidDifficulty(value: unknown): value is GameDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

function normalizeBotPersonalities(
  raw: unknown,
  fallback?: BotPersonalitiesMap,
): BotPersonalitiesMap {
  const result: BotPersonalitiesMap = {
    0: fallback?.[0] ?? getDefaultBotPersonality(0),
    1: fallback?.[1] ?? getDefaultBotPersonality(1),
    2: fallback?.[2] ?? getDefaultBotPersonality(2),
    3: fallback?.[3] ?? getDefaultBotPersonality(3),
  };
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    for (const slot of [0, 1, 2, 3] as const) {
      const candidate = rec[String(slot)];
      if (isValidBotPersonality(candidate)) {
        result[slot] = candidate;
      }
    }
  }
  return result;
}

export function normalizeRoomSettings(
  input?: Partial<RoomSettings> | null,
  base: RoomSettings = DEFAULT_ROOM_SETTINGS,
): RoomSettings {
  const gameMode = isValidGameMode(input?.gameMode) ? input.gameMode : base.gameMode;
  const difficulty = isValidDifficulty(input?.difficulty) ? input.difficulty : base.difficulty;
  const enableItems = typeof input?.enableItems === 'boolean' ? input.enableItems : base.enableItems;
  const rawLimit = input?.roundTimeLimitSec;
  const roundTimeLimitSec =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit >= 0
      ? Math.min(600, Math.round(rawLimit))
      : base.roundTimeLimitSec;
  const rawMax = input?.maxPlayers;
  const maxPlayers: 2 | 3 | 4 =
    rawMax === 2 || rawMax === 3 || rawMax === 4 ? rawMax : base.maxPlayers;
  const botDifficulty: BotDifficulty = isValidBotDifficulty(input?.botDifficulty)
    ? input.botDifficulty
    : isValidBotDifficulty(base.botDifficulty)
      ? base.botDifficulty
      : 'normal';
  const botPersonalities = normalizeBotPersonalities(input?.botPersonalities, base.botPersonalities);

  return {
    gameMode,
    difficulty,
    enableItems,
    roundTimeLimitSec,
    maxPlayers,
    botDifficulty,
    botPersonalities,
  };
}

export const CHAOS_MODIFIERS: readonly Exclude<ChaosModifierKind, 'none'>[] = [
  'wind_flip',
  'turbo_surge',
  'ghost_obstacles',
  'reverse_controls',
];

export const CHAOS_CYCLE_DURATION_SEC = 10.0;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const PICKUP_HIGHLIGHT_NAMES: Record<string, string> = {
  lentil_can: 'علبة عدس فاخرة (+65% دفع)',
  fava_can: 'علبة فول مدمس (+38% دفع)',
  bean_can: 'علبة فاصولياء (+20% دفع)',
  shield: 'درع طاقة واقٍ',
  magnet: 'مغناطيس الكنوز',
  shockwave: 'موجة دفع بحرية',
  repair_kit: 'حقيبة إصلاح الهيكل',
};

function appendHighlight(
  state: WorldSimulationState,
  kind: RoundHighlightKind,
  titleAr: string,
  detailAr?: string,
  slot?: number,
): void {
  if (!Array.isArray(state.roundHighlights)) {
    state.roundHighlights = [];
  }
  const item: RoundHighlight = {
    id: state.eventSeq,
    timeSec: Number((state.elapsedTime ?? 0).toFixed(1)),
    kind,
    titleAr,
    ...(detailAr ? { detailAr } : {}),
    ...(slot !== undefined ? { slot } : {}),
  };
  state.roundHighlights.push(item);
  if (state.roundHighlights.length > 14) {
    state.roundHighlights = state.roundHighlights.slice(state.roundHighlights.length - 14);
  }
}

function pushEvent(state: WorldSimulationState, ev: Omit<SimEvent, 'id'>): void {
  if (ev.type === 'collision' || ev.type === 'hazard_hit') {
    state.collisionCount = (state.collisionCount ?? 0) + 1;
    state.checkpointCollisionDirty = true;
  }
  state.eventSeq += 1;
  state.events.push({
    id: state.eventSeq,
    ...ev,
  });

  if (ev.type === 'super_fart') {
    appendHighlight(state, 'super_fart', 'نفخة تناغم خارقة للفريق!');
  } else if (ev.type === 'checkpoint') {
    appendHighlight(state, 'checkpoint', `الوصول لنقطة الحفظ #${state.checkpointIndex}`);
  } else if (ev.type === 'shield_block') {
    appendHighlight(state, 'shield', 'الدرع امتص اصطداماً قوياً');
  } else if (ev.type === 'shockwave') {
    appendHighlight(state, 'shockwave', 'إطلاق موجة دفع بحرية');
  } else if (ev.type === 'fall') {
    appendHighlight(state, 'fall', 'سقوط الطوف وعودة لنقطة الحفظ');
  } else if (ev.type === 'chaos_shift') {
    appendHighlight(state, 'chaos', 'تقلب فوضوي مفاجئ في المسار', ev.chaosModifier);
  } else if (ev.type === 'lightning') {
    appendHighlight(state, 'lightning', 'صاعقة برق قوية في العاصفة');
  } else if (ev.type === 'pickup' && ev.pickupKind && PICKUP_HIGHLIGHT_NAMES[ev.pickupKind]) {
    appendHighlight(state, 'pickup', `التقاط ${PICKUP_HIGHLIGHT_NAMES[ev.pickupKind]}`);
  } else if (ev.type === 'finish') {
    appendHighlight(
      state,
      'finish',
      state.runOutcome === 'defeat' ? 'نهاية الوقت في الجولة' : 'عبور خط النهاية بنجاح!',
    );
  }
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
    outfit: 'classic',
    raftSkin: 'classic_oak',
    trail: 'classic_green',
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
    botPersonality: getDefaultBotPersonality(slot),
    tempBotSubstitute: false,
    ready: opts?.isBot ?? false,
    seatStatus: opts?.isBot ? 'BOT' : opts?.connected ? 'CONNECTED' : 'EMPTY',
    cosmetic: opts?.cosmetic ?? createDefaultCosmetic(slot),
    localX: zone.defaultX,
    lateralVel: 0,
    moveDir: 0,
    farting: false,
    fartHoldTime: 0,
    fartPower: 0,
    releaseBounce: 0,
    anchorRequested: false,
    useItemRequested: false,
    lastFartStartSimTime: -99,
    lastInputAt: Date.now(),
    stats: {
      totalFartTime: 0,
      fartCount: 0,
      maxBurstDuration: 0,
      torqueImpulseSum: 0,
      wallImpactCount: 0,
      itemsUsed: 0,
      pushImpulseSum: 0,
      firstReactionMs: null,
      fastestReactionMs: null,
      lastCueSimTime: null,
    },
  };
}

export function createInitialDynamicZones(course: CourseDefinition): DynamicZoneState[] {
  return course.dynamicZones.map((dz) => ({
    id: dz.id,
    status: 'intact',
    timer: 0,
  }));
}

export function createInitialPickups(course: CourseDefinition, enableItems = true): PickupSimState[] {
  if (!enableItems) return [];
  return (course.pickups ?? []).map((p) => ({
    id: p.id,
    kind: p.kind,
    x: p.x,
    z: p.z,
    collected: false,
    respawnTimer: 0,
  }));
}

export function createInitialTreasures(course: CourseDefinition, gameMode: GameMode): TreasureSimState[] {
  if (gameMode !== 'treasure') return [];
  const items: TreasureSimState[] = [];
  const span = Math.abs(course.finishZ - course.startZ);
  const count = 24;
  for (let i = 0; i < count; i++) {
    const frac = (i + 1) / (count + 1);
    const z = course.startZ - frac * (span - 24) - 12;
    const bounds = getChannelBoundsAtZ(z, course.waypoints);
    const isChest = i % 4 === 3;
    const sideSign = i % 2 === 0 ? 1 : -1;
    // Coins follow navigable racing lines; high-value chests sit daringly near risky outer banks
    const lateralOffset = isChest
      ? sideSign * Math.max(2.5, bounds.halfWidth - 3.2)
      : sideSign * Math.min(bounds.halfWidth * 0.42, 3.6);
    items.push({
      id: `treasure-${course.id}-${i}`,
      kind: isChest ? 'chest' : 'coin',
      x: bounds.centerX + lateralOffset,
      z,
      value: isChest ? 50 : 10,
      collected: false,
    });
  }
  return items;
}

export function hydrateSimStateFields(
  state: WorldSimulationState,
  course: CourseDefinition = getCourseById(state.courseId),
): void {
  if (!isValidGameMode(state.gameMode)) state.gameMode = 'standard';
  if (!isValidDifficulty(state.difficulty)) state.difficulty = 'normal';
  if (!isValidBotDifficulty(state.botDifficulty)) state.botDifficulty = 'normal';
  if (typeof state.enableItems !== 'boolean') state.enableItems = true;
  if (typeof state.roundTimeLimitSec !== 'number' || !Number.isFinite(state.roundTimeLimitSec)) {
    state.roundTimeLimitSec = 0;
  }
  if (state.runOutcome !== 'victory' && state.runOutcome !== 'defeat') state.runOutcome = 'victory';
  if (!Array.isArray(state.dynamicZones) || state.dynamicZones.length !== course.dynamicZones.length) {
    state.dynamicZones = createInitialDynamicZones(course);
  }
  if (!Array.isArray(state.pickups)) {
    state.pickups = createInitialPickups(course, state.enableItems);
  }
  if (!Array.isArray(state.treasures)) {
    state.treasures = createInitialTreasures(course, state.gameMode);
  }
  if (typeof state.treasureScore !== 'number' || !Number.isFinite(state.treasureScore)) state.treasureScore = 0;
  if (typeof state.coinsCollected !== 'number' || !Number.isFinite(state.coinsCollected)) state.coinsCollected = 0;
  if (typeof state.totalCoins !== 'number' || !Number.isFinite(state.totalCoins)) {
    state.totalCoins = state.treasures.length;
  }
  if (typeof state.survivalDistance !== 'number' || !Number.isFinite(state.survivalDistance)) {
    state.survivalDistance = 0;
  }
  if (typeof state.survivalSpeedScale !== 'number' || !Number.isFinite(state.survivalSpeedScale)) {
    state.survivalSpeedScale = 1;
  }
  if (!state.chaosModifier) state.chaosModifier = 'none';
  if (typeof state.chaosTimer !== 'number' || !Number.isFinite(state.chaosTimer)) {
    state.chaosTimer = state.gameMode === 'chaos' ? 3.5 : 0;
  }
  if (typeof state.raftHp !== 'number' || !Number.isFinite(state.raftHp)) state.raftHp = 100;
  if (typeof state.maxHp !== 'number' || !Number.isFinite(state.maxHp)) state.maxHp = 100;
  if (typeof state.shieldHits !== 'number' || !Number.isFinite(state.shieldHits)) state.shieldHits = 0;
  if (typeof state.shieldTimer !== 'number' || !Number.isFinite(state.shieldTimer)) state.shieldTimer = 0;
  if (typeof state.magnetTimer !== 'number' || !Number.isFinite(state.magnetTimer)) state.magnetTimer = 0;
  if (state.boostKind === undefined) state.boostKind = null;
  if (typeof state.boostTimer !== 'number' || !Number.isFinite(state.boostTimer)) state.boostTimer = 0;
  if (typeof state.boostMultiplier !== 'number' || !Number.isFinite(state.boostMultiplier)) state.boostMultiplier = 1;
  if (state.heldItem === undefined) state.heldItem = null;
  if (typeof state.anchorActive !== 'boolean') state.anchorActive = false;
  if (typeof state.anchorEnergy !== 'number' || !Number.isFinite(state.anchorEnergy)) state.anchorEnergy = 1;
  if (typeof state.anchorCooldown !== 'number' || !Number.isFinite(state.anchorCooldown)) state.anchorCooldown = 0;
  if (typeof state.harmony !== 'number' || !Number.isFinite(state.harmony)) state.harmony = 0;
  if (typeof state.superFartTimer !== 'number' || !Number.isFinite(state.superFartTimer)) state.superFartTimer = 0;
  if (typeof state.harmonyComboCount !== 'number' || !Number.isFinite(state.harmonyComboCount)) {
    state.harmonyComboCount = 0;
  }
  if (typeof state.windX !== 'number' || !Number.isFinite(state.windX)) state.windX = 0;
  if (typeof state.windZ !== 'number' || !Number.isFinite(state.windZ)) state.windZ = 0;
  if (typeof state.lightningTimer !== 'number' || !Number.isFinite(state.lightningTimer)) state.lightningTimer = 0;
  if (typeof state.itemsCollectedCount !== 'number' || !Number.isFinite(state.itemsCollectedCount)) {
    state.itemsCollectedCount = 0;
  }
  if (typeof state.harmonySuperFartCount !== 'number' || !Number.isFinite(state.harmonySuperFartCount)) {
    state.harmonySuperFartCount = 0;
  }
  if (typeof state.hardGatesPassed !== 'number' || !Number.isFinite(state.hardGatesPassed)) {
    state.hardGatesPassed = 0;
  }
  if (typeof state.minRaftHp !== 'number' || !Number.isFinite(state.minRaftHp)) {
    state.minRaftHp = state.raftHp;
  }
  if (typeof state.collisionCount !== 'number' || !Number.isFinite(state.collisionCount)) {
    state.collisionCount = 0;
  }
  if (typeof state.cleanCheckpoints !== 'number' || !Number.isFinite(state.cleanCheckpoints)) {
    state.cleanCheckpoints = 0;
  }
  if (typeof state.checkpointCollisionDirty !== 'boolean') {
    state.checkpointCollisionDirty = false;
  }
  if (typeof state.practiceMode !== 'boolean') {
    state.practiceMode = false;
  }
  if (typeof state.infiniteSandbox !== 'boolean') {
    state.infiniteSandbox = false;
  }
  if (typeof state.reactionCueSimTime !== 'number' || !Number.isFinite(state.reactionCueSimTime)) {
    state.reactionCueSimTime = 0;
  }
  if (!Array.isArray(state.roundHighlights)) {
    state.roundHighlights = [];
  }
  for (const p of state.players) {
    if (typeof p.stats.itemsUsed !== 'number' || !Number.isFinite(p.stats.itemsUsed)) {
      p.stats.itemsUsed = 0;
    }
    if (typeof p.stats.pushImpulseSum !== 'number' || !Number.isFinite(p.stats.pushImpulseSum)) {
      p.stats.pushImpulseSum = 0;
    }
    if (p.stats.firstReactionMs === undefined) {
      p.stats.firstReactionMs = null;
    }
    if (p.stats.fastestReactionMs === undefined) {
      p.stats.fastestReactionMs = null;
    }
    if (p.stats.lastCueSimTime === undefined) {
      p.stats.lastCueSimTime = null;
    }
  }
}

export function createInitialSimState(
  mode: PlayMode = 'solo',
  playerName = 'أنت',
  playerCosmetic?: PlayerCosmetic,
  courseId: CourseId = 'tropical',
  settings?: Partial<RoomSettings>,
  courseOverride?: CourseDefinition,
): WorldSimulationState {
  const course = courseOverride ?? getCourseById(courseId);
  const resolved = normalizeRoomSettings(settings);
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
  p0.botPersonality = resolved.botPersonalities?.[0] ?? getDefaultBotPersonality(0);
  p1.botPersonality = resolved.botPersonalities?.[1] ?? getDefaultBotPersonality(1);
  p2.botPersonality = resolved.botPersonalities?.[2] ?? getDefaultBotPersonality(2);
  p3.botPersonality = resolved.botPersonalities?.[3] ?? getDefaultBotPersonality(3);
  const treasures = createInitialTreasures(course, resolved.gameMode);

  return {
    courseId: course.id,
    mode,
    gameMode: resolved.gameMode,
    difficulty: resolved.difficulty,
    botDifficulty: resolved.botDifficulty ?? 'normal',
    enableItems: resolved.enableItems,
    roundTimeLimitSec: resolved.roundTimeLimitSec,
    phase: 'playing',
    runOutcome: 'victory',
    simTime: 0,
    elapsedTime: 0,
    raft: {
      x: 0,
      y: 0,
      z: course.startZ,
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
    dynamicZones: createInitialDynamicZones(course),
    activeHazardTag: null,
    pickups: createInitialPickups(course, resolved.enableItems),
    raftHp: 100,
    maxHp: 100,
    boatDamageEnabled: true,
    shieldHits: 0,
    shieldTimer: 0,
    magnetTimer: 0,
    boostKind: null,
    boostTimer: 0,
    boostMultiplier: 1,
    heldItem: null,
    anchorActive: false,
    anchorEnergy: 1,
    anchorCooldown: 0,
    harmony: 0,
    superFartTimer: 0,
    harmonyComboCount: 0,
    windX: 0,
    windZ: 0,
    lightningTimer: 0,
    survivalDistance: 0,
    survivalSpeedScale: 1,
    treasures,
    treasureScore: 0,
    coinsCollected: 0,
    totalCoins: treasures.length,
    chaosModifier: 'none',
    chaosTimer: resolved.gameMode === 'chaos' ? 3.5 : 0,
    itemsCollectedCount: 0,
    harmonySuperFartCount: 0,
    hardGatesPassed: 0,
    minRaftHp: 100,
    collisionCount: 0,
    cleanCheckpoints: 0,
    checkpointCollisionDirty: false,
    practiceMode: false,
    infiniteSandbox: false,
    reactionCueSimTime: 0,
    roundHighlights: [],
    eventSeq: 0,
    events: [],
  };
}

export function isDangerOpenEdgeZone(z: number, course: CourseDefinition = COURSE_MAIN): boolean {
  for (const dz of course.dangerZones) {
    if (z <= dz.zStart && z >= dz.zEnd) {
      return true;
    }
  }
  return false;
}

export function getCourseLoopSpan(course: CourseDefinition): number {
  return Math.max(120, Math.abs(course.finishZ - course.startZ));
}

export function mapZForCourseMode(
  z: number,
  course: CourseDefinition,
  isSurvival: boolean,
): number {
  if (!isSurvival || z > course.startZ) {
    return z;
  }
  const span = getCourseLoopSpan(course);
  const offset = (((course.startZ - z) % span) + span) % span;
  return course.startZ - offset;
}

function deltaZForMode(
  mappedRaftZ: number,
  targetZ: number,
  span: number,
  isSurvival: boolean,
): number {
  let dz = mappedRaftZ - targetZ;
  if (isSurvival) {
    if (dz > span * 0.5) dz -= span;
    else if (dz < -span * 0.5) dz += span;
  }
  return dz;
}

/**
 * Cooperative AI Bot Swarm controller (BOT-01..03).
 * Fair physics: controls only moveDir, farting, anchorRequested, useItemRequested.
 */
export function updateBotInputs(
  state: WorldSimulationState,
  course: CourseDefinition = getCourseById(state.courseId),
): void {
  computeSwarmBotDirectives(state, course);
}

export function respawnAtCheckpoint(
  state: WorldSimulationState,
  course: CourseDefinition = getCourseById(state.courseId),
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
    p.anchorRequested = false;
    p.useItemRequested = false;
  }

  // Restore dynamic breakable surfaces on respawn so path is cleanly traversable
  if (!state.dynamicZones || state.dynamicZones.length !== course.dynamicZones.length) {
    state.dynamicZones = createInitialDynamicZones(course);
  } else {
    for (const dz of state.dynamicZones) {
      dz.status = 'intact';
      dz.timer = 0;
    }
  }

  state.raftHp = state.maxHp;
  state.anchorActive = false;
  state.activeHazardTag = null;
  state.phase = 'playing';
  state.fallTimer = 0;
  state.invulnTimer = 1.5;
  state.checkpointCollisionDirty = false;
  state.reactionCueSimTime = state.simTime;
}

export function enforceInputTimeouts(state: WorldSimulationState, nowMs: number): void {
  for (const p of state.players) {
    if (!p.isBot && p.connected && nowMs - p.lastInputAt > SAFE_INPUT_TIMEOUT_MS) {
      p.farting = false;
      p.anchorRequested = false;
      p.useItemRequested = false;
    }
    if (!p.connected && !p.isBot) {
      p.farting = false;
      p.moveDir = 0;
      p.anchorRequested = false;
      p.useItemRequested = false;
    }
  }
}

function triggerShockwave(state: WorldSimulationState): void {
  const raft = state.raft;
  const fwdX = -Math.sin(raft.yaw);
  const fwdZ = -Math.cos(raft.yaw);
  raft.vx += fwdX * 8.5;
  raft.vz += fwdZ * 8.5;
  state.invulnTimer = Math.max(state.invulnTimer, 0.75);

  // Stabilize cracking surfaces slightly around the raft
  for (const dz of state.dynamicZones) {
    if (dz.status === 'cracking') {
      dz.timer += 0.7;
    }
  }

  pushEvent(state, {
    type: 'shockwave',
    intensity: 1,
    x: raft.x,
    z: raft.z,
  });
}

function applyPickupEffect(
  state: WorldSimulationState,
  kind: PickupKind,
  pickupIndex: number,
  x: number,
  z: number,
): void {
  let resolvedKind: PickupKind = kind;
  if (kind === 'mystery_crate') {
    const pool: PickupKind[] =
      state.raftHp < 55
        ? ['repair_kit', 'lentil_can', 'shield', 'fava_can', 'magnet', 'shockwave']
        : ['lentil_can', 'fava_can', 'bean_can', 'shield', 'magnet', 'shockwave', 'repair_kit'];
    const idx = Math.abs(Math.floor(state.simTime * 11 + state.eventSeq * 3 + pickupIndex * 5)) % pool.length;
    resolvedKind = pool[idx];
  }

  if (resolvedKind === 'lentil_can' || resolvedKind === 'fava_can' || resolvedKind === 'bean_can') {
    const tier = CAN_BOOST_TIERS[resolvedKind];
    if (state.boostTimer <= 0 || tier.multiplier >= state.boostMultiplier) {
      state.boostKind = resolvedKind;
      state.boostMultiplier = tier.multiplier;
      state.boostTimer = tier.duration;
    } else {
      state.boostTimer = Math.min(12, state.boostTimer + 2.0);
    }
  } else if (resolvedKind === 'shield') {
    state.shieldHits = Math.min(3, state.shieldHits + 2);
    state.shieldTimer = 15.0;
  } else if (resolvedKind === 'magnet') {
    state.magnetTimer = 10.0;
  } else if (resolvedKind === 'repair_kit') {
    state.raftHp = Math.min(state.maxHp, state.raftHp + 32);
    pushEvent(state, {
      type: 'repair',
      intensity: 1,
      x,
      z,
    });
  } else if (resolvedKind === 'shockwave') {
    if (state.heldItem === 'shockwave') {
      triggerShockwave(state);
    } else {
      state.heldItem = 'shockwave';
    }
  }

  state.itemsCollectedCount = (state.itemsCollectedCount ?? 0) + 1;
  for (const p of state.players) {
    if (p.connected && !p.isBot) {
      p.stats.itemsUsed = (p.stats.itemsUsed ?? 0) + 1;
    }
  }

  pushEvent(state, {
    type: 'pickup',
    pickupKind: resolvedKind,
    intensity: 1,
    x,
    z,
  });
}

/**
 * Applies hull damage unless absorbed by invulnerability or active shield.
 * Returns 'blocked' if absorbed/invulnerable, 'damaged' if hull took non-fatal damage, or 'sunk' if raftHp reached 0.
 */
function applyHullDamage(
  state: WorldSimulationState,
  rawDamage: number,
  x: number,
  z: number,
): 'blocked' | 'damaged' | 'sunk' {
  if (state.boatDamageEnabled === false) {
    return 'blocked';
  }
  const diffScale =
    state.difficulty === 'easy' ? 0.55 : state.difficulty === 'hard' ? 1.05 : 0.78;
  const survScale =
    state.gameMode === 'survival'
      ? Math.min(1.4, 1 + Math.max(0, (state.survivalSpeedScale ?? 1) - 1) * 0.35)
      : 1.0;
  const scaledDamage = Math.max(1, Math.round(rawDamage * diffScale * survScale * 0.72));

  if (state.invulnTimer > 0 || scaledDamage <= 0) return 'blocked';
  if (state.shieldHits > 0 && state.shieldTimer > 0) {
    state.shieldHits -= 1;
    if (state.shieldHits <= 0) {
      state.shieldHits = 0;
      state.shieldTimer = 0;
      pushEvent(state, {
        type: 'shield_break',
        intensity: 1,
        x,
        z,
      });
    } else {
      pushEvent(state, {
        type: 'shield_block',
        intensity: 0.85,
        x,
        z,
      });
    }
    state.invulnTimer = Math.max(state.invulnTimer, 0.55);
    return 'blocked';
  }

  const prevHp = state.raftHp;
  state.invulnTimer = Math.max(state.invulnTimer, 0.55);
  if (state.practiceMode) {
    state.raftHp = Math.max(45, state.raftHp - scaledDamage);
    state.minRaftHp = Math.min(state.minRaftHp ?? 100, state.raftHp);
    return 'damaged';
  }
  state.raftHp = Math.max(0, state.raftHp - scaledDamage);
  state.minRaftHp = Math.min(state.minRaftHp ?? 100, state.raftHp);
  if (prevHp >= 40 && state.raftHp < 40 && state.raftHp > 0) {
    pushEvent(state, {
      type: 'hull_critical',
      intensity: 0.9,
      x,
      z,
    });
  }
  if (state.raftHp <= 0) {
    state.phase = 'falling';
    state.fallTimer = 0.9;
    state.falls += 1;
    pushEvent(state, {
      type: 'fall',
      intensity: 1,
      x: state.raft.x,
      z: state.raft.z,
    });
    return 'sunk';
  }
  return 'damaged';
}

export interface StepSimulationOptions {
  enableBots?: boolean;
}

export function stepSimulation(
  state: WorldSimulationState,
  rawDt: number,
  courseArg?: CourseDefinition,
  options?: StepSimulationOptions,
): SimEvent[] {
  const course = courseArg ?? getCourseById(state.courseId);
  const dt = clamp(rawDt, 0, 0.05);
  state.events = [];

  hydrateSimStateFields(state, course);

  if (state.phase === 'paused' || state.phase === 'waiting' || state.phase === 'finished') {
    return state.events;
  }

  // Hitstop freezes simulation physics briefly on heavy impact while still letting visuals tick
  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return state.events;
  }

  const prevSimTime = state.simTime;
  state.simTime += dt;

  // Handle comical falling state before checkpoint respawn (or Game Over in Survival)
  if (state.phase === 'falling') {
    state.fallTimer -= dt;
    state.raft.y -= 13.5 * dt;
    state.raft.pitch += 2.2 * dt;
    state.raft.roll += 3.1 * dt;
    if (state.fallTimer <= 0) {
      if (state.gameMode === 'survival') {
        state.phase = 'finished';
        state.runOutcome = 'defeat';
        state.anchorActive = false;
        for (const p of state.players) {
          p.farting = false;
          p.moveDir = 0;
          p.anchorRequested = false;
          p.useItemRequested = false;
        }
      } else {
        respawnAtCheckpoint(state, course);
      }
    }
    return state.events;
  }

  const isSurvival = state.gameMode === 'survival';
  const loopSpan = getCourseLoopSpan(course);
  state.elapsedTime += dt;

  // Enforce optional host-configured round timer (except endless survival or practice mode)
  if (!isSurvival && !state.practiceMode && state.roundTimeLimitSec > 0 && state.elapsedTime >= state.roundTimeLimitSec) {
    state.phase = 'finished';
    state.runOutcome = 'defeat';
    state.anchorActive = false;
    for (const p of state.players) {
      p.farting = false;
      p.moveDir = 0;
      p.anchorRequested = false;
      p.useItemRequested = false;
    }
    pushEvent(state, {
      type: 'time_expired',
      intensity: 1,
      x: state.raft.x,
      z: state.raft.z,
    });
    return state.events;
  }

  if (state.practiceMode && state.raftHp < state.maxHp) {
    state.raftHp = Math.min(state.maxHp, state.raftHp + 9 * dt);
  }

  // Survival progressive difficulty ramp (MODE-02)
  if (isSurvival) {
    state.survivalSpeedScale = Math.min(1.85, 1 + state.elapsedTime / 75);
  } else {
    state.survivalSpeedScale = 1;
  }

  // Chaos Mode periodic modifier cycle (MODE-04)
  if (state.gameMode === 'chaos') {
    state.chaosTimer -= dt;
    if (state.chaosTimer <= 0) {
      const currentIdx = CHAOS_MODIFIERS.indexOf(
        state.chaosModifier as Exclude<ChaosModifierKind, 'none'>,
      );
      const nextIdx =
        currentIdx >= 0
          ? (currentIdx + 1) % CHAOS_MODIFIERS.length
          : Math.abs(Math.floor(state.simTime + state.eventSeq)) % CHAOS_MODIFIERS.length;
      state.chaosModifier = CHAOS_MODIFIERS[nextIdx];
      state.chaosTimer = CHAOS_CYCLE_DURATION_SEC;
      state.reactionCueSimTime = state.simTime;
      pushEvent(state, {
        type: 'chaos_shift',
        chaosModifier: state.chaosModifier,
        intensity: 1,
        x: state.raft.x,
        z: state.raft.z,
      });
    }
  } else {
    state.chaosModifier = 'none';
    state.chaosTimer = 0;
  }

  if (state.invulnTimer > 0) state.invulnTimer = Math.max(0, state.invulnTimer - dt);
  if (state.shieldTimer > 0) {
    state.shieldTimer = Math.max(0, state.shieldTimer - dt);
    if (state.shieldTimer <= 0) state.shieldHits = 0;
  }
  if (state.magnetTimer > 0) state.magnetTimer = Math.max(0, state.magnetTimer - dt);
  if (state.boostTimer > 0) {
    state.boostTimer = Math.max(0, state.boostTimer - dt);
    if (state.boostTimer <= 0) {
      state.boostKind = null;
      state.boostMultiplier = 1;
    }
  }
  if (state.superFartTimer > 0) state.superFartTimer = Math.max(0, state.superFartTimer - dt);
  if (state.anchorCooldown > 0) state.anchorCooldown = Math.max(0, state.anchorCooldown - dt);
  if (state.lightningTimer > 0) state.lightningTimer = Math.max(0, state.lightningTimer - dt);

  const hasTempBotSubstitute = state.players.some((p) => Boolean(p.tempBotSubstitute && p.isBot && p.connected));
  const shouldRunBots = (options?.enableBots ?? state.mode === 'solo') || hasTempBotSubstitute;
  if (shouldRunBots) {
    updateBotInputs(state, course);
  }

  // Record player response latency from round start or latest cue (UX-05)
  const cueTime = state.reactionCueSimTime ?? 0;
  for (const p of state.players) {
    if (!p.connected || p.isBot) continue;
    const hasActiveCommand = Boolean(p.farting || p.moveDir !== 0 || p.anchorRequested || p.useItemRequested);
    if (hasActiveCommand && p.stats.lastCueSimTime !== cueTime) {
      p.stats.lastCueSimTime = cueTime;
      const reactionMs = clamp(Math.round((state.simTime - cueTime) * 1000), 85, 15000);
      if (p.stats.firstReactionMs === null || p.stats.firstReactionMs === undefined) {
        p.stats.firstReactionMs = reactionMs;
      }
      if (
        p.stats.fastestReactionMs === null ||
        p.stats.fastestReactionMs === undefined ||
        reactionMs < p.stats.fastestReactionMs
      ) {
        p.stats.fastestReactionMs = reactionMs;
      }
    }
  }

  // Handle Shockwave / Active Item Trigger
  const activator = state.players.find((p) => p.connected && p.useItemRequested);
  if (state.heldItem === 'shockwave' && activator) {
    state.heldItem = null;
    activator.stats.itemsUsed = (activator.stats.itemsUsed ?? 0) + 1;
    for (const p of state.players) {
      p.useItemRequested = false;
    }
    triggerShockwave(state);
  } else {
    for (const p of state.players) {
      p.useItemRequested = false;
    }
  }

  // Handle Anchor System (GAME-03)
  const wantsAnchor = state.players.some((p) => p.connected && p.anchorRequested);
  const prevAnchorActive = state.anchorActive;
  if (wantsAnchor && state.anchorCooldown <= 0 && state.anchorEnergy > 0.08) {
    state.anchorActive = true;
    state.anchorEnergy = Math.max(0, state.anchorEnergy - dt * 0.28);
    if (state.anchorEnergy <= 0.01) {
      state.anchorActive = false;
      state.anchorCooldown = 0.65;
    }
  } else {
    state.anchorActive = false;
    state.anchorEnergy = Math.min(1, state.anchorEnergy + dt * 0.24);
  }
  if (!prevAnchorActive && state.anchorActive) {
    pushEvent(state, { type: 'anchor_drop', intensity: 0.8, x: state.raft.x, z: state.raft.z });
  } else if (prevAnchorActive && !state.anchorActive) {
    pushEvent(state, { type: 'anchor_raise', intensity: 0.5, x: state.raft.x, z: state.raft.z });
  }

  const raft = state.raft;
  const fwdX = -Math.sin(raft.yaw);
  const fwdZ = -Math.cos(raft.yaw);
  const mappedRaftZ = mapZForCourseMode(raft.z, course, isSurvival);
  const difficultyWindScale =
    state.difficulty === 'easy' ? 0.75 : state.difficulty === 'hard' ? 1.35 : 1.0;

  // Storm dynamic crosswinds + Chaos Wind Flip
  let baseWindX = 0;
  let baseWindZ = 0;
  if (course.dynamicWind) {
    const dw = course.dynamicWind;
    const angle = dw.baseAngle + Math.sin(state.simTime * ((Math.PI * 2) / Math.max(2, dw.gustPeriod))) * 0.95;
    const speed = (dw.baseSpeed + Math.sin(state.simTime * 1.45 + 0.7) * dw.gustAmplitude) * difficultyWindScale;
    baseWindX = Math.sin(angle) * speed;
    baseWindZ = Math.cos(angle) * speed * 0.25;

    const prevStrike = Math.floor(prevSimTime / 7.5);
    const curStrike = Math.floor(state.simTime / 7.5);
    if (curStrike > prevStrike && state.simTime > 1.0) {
      state.lightningTimer = 0.6;
      pushEvent(state, {
        type: 'lightning',
        intensity: 0.9,
        x: raft.x,
        z: raft.z - 16,
      });
    }
  }
  if (state.chaosModifier === 'wind_flip') {
    baseWindX += Math.sin(state.simTime * 1.9) * 10.5 * difficultyWindScale;
  }
  state.windX = baseWindX;
  state.windZ = baseWindZ;

  // Sample environmental zones affecting drag, heat thrust, wind, and thin-ice/crumbling surfaces
  let activeHazardTag: HazardEffectTag = course.dynamicWind ? 'storm_wind' : null;
  let dragMultiplier = 1.0;
  let turnGripMultiplier = 1.0;

  for (const fz of course.frictionZones) {
    if (
      Math.abs(raft.x - fz.x) <= fz.halfWidth + RAFT_RADIUS * 0.45 &&
      Math.abs(deltaZForMode(mappedRaftZ, fz.z, loopSpan, isSurvival)) <= fz.halfLength + RAFT_RADIUS * 0.45
    ) {
      dragMultiplier = Math.min(dragMultiplier, fz.dragMultiplier);
      if (fz.turnMultiplier !== undefined) {
        turnGripMultiplier = Math.min(turnGripMultiplier, fz.turnMultiplier);
      }
      activeHazardTag = fz.kind === 'ice_sheet' ? 'ice' : 'oil';
    }
  }

  let heatThrustMultiplier = 1.0;
  let heatTurbulenceX = 0;
  for (const hz of course.heatZones) {
    const dist = Math.hypot(raft.x - hz.x, deltaZForMode(mappedRaftZ, hz.z, loopSpan, isSurvival));
    if (dist <= hz.radius + RAFT_RADIUS * 0.5) {
      heatThrustMultiplier = Math.max(heatThrustMultiplier, hz.thrustBoost);
      heatTurbulenceX += Math.sin(state.simTime * 5.4 + raft.z * 0.25) * hz.turbulenceX;
      activeHazardTag = 'heat';
    }
  }

  let totalThrust = 0;
  let totalTorque = 0;
  let weightBalanceX = 0;
  let activeCount = 0;

  // Pass 1: update lateral positions (reversing controls during Chaos 'reverse_controls')
  const reverseSteer = state.chaosModifier === 'reverse_controls' ? -1 : 1;
  for (const p of state.players) {
    const zone = PLAYER_ZONES[p.slot];

    // Lateral movement strictly inside quarter zone
    const effectiveMoveDir = p.moveDir * reverseSteer;
    const targetLatVel = p.connected ? effectiveMoveDir * LATERAL_MOVE_SPEED : 0;
    p.lateralVel += (targetLatVel - p.lateralVel) * clamp(14 * dt, 0, 1);
    p.localX = clamp(p.localX + p.lateralVel * dt, zone.minX, zone.maxX);
    if ((p.localX <= zone.minX && p.lateralVel < 0) || (p.localX >= zone.maxX && p.lateralVel > 0)) {
      p.lateralVel = 0;
    }

    if (p.connected) {
      weightBalanceX += p.localX;
      activeCount++;
    }
  }

  // Uniform crew scaling applied equally to all connected seats
  const crewScale = activeCount > 0 ? Math.min(1.5, 2.2 / Math.max(1, activeCount * 0.62)) : 1;
  const canMultiplier = state.boostTimer > 0 ? state.boostMultiplier : 1.0;
  const chaosThrustScale = state.chaosModifier === 'turbo_surge' ? 1.45 : 1.0;
  const isDamaged = state.raftHp < 40;
  const damageThrustScale = isDamaged ? 0.76 : 1.0;

  let activeFarters = 0;
  let alignedFarters = 0;
  const fartStarts: number[] = [];

  // Pass 2: compute fart thrust & torque fairly across all slots + track harmony timing
  for (const p of state.players) {
    if (p.farting && p.connected) {
      if (p.fartHoldTime === 0) {
        p.stats.fartCount += 1;
        p.lastFartStartSimTime = state.simTime;
        pushEvent(state, {
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

      activeFarters += 1;
      if (p.fartHoldTime >= 0.35) alignedFarters += 1;
      fartStarts.push(p.lastFartStartSimTime ?? state.simTime);

      const force =
        FART_MAX_THRUST *
        p.fartPower *
        crewScale *
        heatThrustMultiplier *
        canMultiplier *
        chaosThrustScale *
        damageThrustScale;
      totalThrust += force;
      p.stats.pushImpulseSum = (p.stats.pushImpulseSum ?? 0) + force * dt;

      const torque = p.localX * force * FART_TORQUE_FACTOR;
      totalTorque += torque;
      p.stats.torqueImpulseSum += Math.abs(torque) * dt;
    } else {
      if (p.fartHoldTime > 0) {
        pushEvent(state, {
          type: 'fart_stop',
          slot: p.slot,
          intensity: p.fartPower,
          x: raft.x,
          z: raft.z,
        });
        p.releaseBounce = Math.max(p.releaseBounce, 0.35 + p.fartPower * 0.65);
        // Erratic micro-tap penalty if player mashed < 0.14s alone
        if (p.fartHoldTime < 0.14 && activeFarters === 0) {
          state.harmony = Math.max(0, state.harmony - 0.05);
        }
      }
      p.fartHoldTime = 0;
      p.fartPower = Math.max(0, p.fartPower - dt * 5.5);
      p.releaseBounce = Math.max(0, p.releaseBounce - dt * 3.2);
    }
  }

  // Harmony Meter & Co-op Super-Fart (GAME-04)
  if (activeFarters >= 2) {
    let minStart = fartStarts[0];
    let maxStart = fartStarts[0];
    for (const st of fartStarts) {
      if (st < minStart) minStart = st;
      if (st > maxStart) maxStart = st;
    }
    const tightSync = maxStart - minStart <= 0.45;
    if (tightSync || alignedFarters >= 2) {
      const gainRate = tightSync ? 0.42 : 0.24;
      state.harmony = clamp(state.harmony + gainRate * dt, 0, 1);
    }
  } else {
    state.harmony = Math.max(0, state.harmony - 0.14 * dt);
  }

  if (state.harmony >= 0.8 && activeFarters >= 2 && state.superFartTimer <= 0) {
    state.superFartTimer = 2.0;
    state.harmony = 0.22;
    state.harmonyComboCount += 1;
    state.harmonySuperFartCount = (state.harmonySuperFartCount ?? 0) + 1;
    pushEvent(state, {
      type: 'super_fart',
      intensity: 1,
      x: raft.x,
      z: raft.z,
    });
  }

  if (state.superFartTimer > 0) {
    totalThrust *= 1.52;
    totalTorque *= 0.65;
  }

  // Apply thrust + survival progressive river current + thermal turbulence + wind zones
  if (isSurvival) {
    const currentPush = 2.4 + (state.survivalSpeedScale - 1) * 7.5;
    raft.vx += fwdX * currentPush * 0.35 * dt;
    raft.vz -= currentPush * dt;
  }
  raft.vx += (fwdX * totalThrust + heatTurbulenceX) * dt;
  raft.vz += fwdZ * totalThrust * dt;

  const anchorWindResist = state.anchorActive ? 0.2 : 1.0;
  if (state.windX !== 0 || state.windZ !== 0) {
    raft.vx += state.windX * anchorWindResist * dt;
    raft.vz += state.windZ * anchorWindResist * dt;
  }

  for (const wz of course.windZones) {
    if (
      Math.abs(raft.x - wz.x) <= wz.halfWidth + RAFT_RADIUS * 0.5 &&
      Math.abs(deltaZForMode(mappedRaftZ, wz.z, loopSpan, isSurvival)) <= wz.halfLength + RAFT_RADIUS * 0.5 &&
      isWindZoneActive(wz, state.simTime)
    ) {
      raft.vx += wz.forceX * difficultyWindScale * anchorWindResist * dt;
      raft.vz += wz.forceZ * difficultyWindScale * anchorWindResist * dt;
      activeHazardTag = 'wind';
    }
  }

  // Apply linear drag (drastically lower inside ice sheets, dramatically higher when anchor dropped or damaged!)
  const anchorDragScale = state.anchorActive ? 4.8 : 1.0;
  const damageDragScale = isDamaged ? 1.24 : 1.0;
  const linearDrag = RAFT_LINEAR_DRAG * dragMultiplier * anchorDragScale * damageDragScale;
  const dragFactor = Math.exp(-linearDrag * dt);
  raft.vx *= dragFactor;
  raft.vz *= dragFactor;

  const speed = Math.hypot(raft.vx, raft.vz);
  const boostCapMult =
    (state.superFartTimer > 0 ? 1.32 : 1.0) *
    (canMultiplier > 1 ? 1 + (canMultiplier - 1) * 0.48 : 1.0) *
    (state.chaosModifier === 'turbo_surge' ? 1.28 : 1.0) *
    (isSurvival ? Math.min(1.4, 1 + (state.survivalSpeedScale - 1) * 0.35) : 1.0);
  const damageSpeedScale = isDamaged ? 0.76 : 1.0;
  const maxSpeed =
    (dragMultiplier < 0.5 ? RAFT_MAX_SPEED * 1.18 : RAFT_MAX_SPEED) * boostCapMult * damageSpeedScale;
  if (speed > maxSpeed) {
    const s = maxSpeed / speed;
    raft.vx *= s;
    raft.vz *= s;
  }

  // Rotational physics
  const anchorTurnDamp = state.anchorActive ? 0.35 : 1.0;
  const damageTurnScale = isDamaged ? 0.82 : 1.0;
  raft.omega += totalTorque * turnGripMultiplier * anchorTurnDamp * damageTurnScale * dt;
  raft.omega *= Math.exp(
    -RAFT_ANGULAR_DRAG * (0.45 + 0.55 * dragMultiplier) * (state.anchorActive ? 2.4 : 1.0) * dt,
  );
  raft.omega = clamp(raft.omega, -RAFT_MAX_OMEGA, RAFT_MAX_OMEGA);

  // Advance position & yaw
  raft.x += raft.vx * dt;
  raft.z += raft.vz * dt;
  raft.yaw += raft.omega * dt;

  if (raft.yaw > Math.PI) raft.yaw -= Math.PI * 2;
  if (raft.yaw < -Math.PI) raft.yaw += Math.PI * 2;

  const postMoveMappedZ = mapZForCourseMode(raft.z, course, isSurvival);

  // Visual spring tilt (amplified in storm waves, stabilized when anchored)
  const stormWaveAmp = course.meta.waveAmplitude ?? 1.0;
  const waveRoll =
    stormWaveAmp > 1.2 && !state.anchorActive
      ? Math.sin(state.simTime * 2.4 + raft.z * 0.08) * 0.095
      : 0;
  const wavePitch =
    stormWaveAmp > 1.2 && !state.anchorActive
      ? Math.cos(state.simTime * 1.9 + raft.x * 0.08) * 0.06
      : 0;
  const targetPitch = clamp(-totalThrust * 0.0022 + wavePitch, -0.22, 0.16);
  const targetRoll = clamp(
    -raft.omega * 0.14 - (weightBalanceX / Math.max(1, activeCount)) * 0.035 + waveRoll,
    -0.28,
    0.28,
  );
  raft.pitchVel += ((targetPitch - raft.pitch) * 65 - raft.pitchVel * 9) * dt;
  raft.rollVel += ((targetRoll - raft.roll) * 65 - raft.rollVel * 9) * dt;
  raft.pitch += raft.pitchVel * dt;
  raft.roll += raft.rollVel * dt;

  // Pickups & Magnet Attraction (respects enableItems setting)
  if (state.enableItems) {
    const pickupDefs = course.pickups ?? [];
    for (let i = 0; i < state.pickups.length; i++) {
      const pk = state.pickups[i];
      const def = pickupDefs[i];
      if (pk.collected) {
        pk.respawnTimer -= dt;
        if (pk.respawnTimer <= 0) {
          pk.collected = false;
          pk.respawnTimer = 0;
          if (def) {
            pk.x = def.x;
            pk.z = def.z;
          }
        }
        continue;
      }

      const dx = raft.x - pk.x;
      const dz = deltaZForMode(postMoveMappedZ, pk.z, loopSpan, isSurvival);
      const dist = Math.hypot(dx, dz);

      if (state.magnetTimer > 0 && dist > 0.1 && dist < 21.0) {
        const pull = Math.min(dist, 15.0 * dt);
        pk.x += (dx / dist) * pull;
        pk.z += (dz / dist) * pull;
      }

      const collectDist = Math.hypot(raft.x - pk.x, deltaZForMode(postMoveMappedZ, pk.z, loopSpan, isSurvival));
      if (collectDist <= RAFT_RADIUS + 1.35) {
        pk.collected = true;
        pk.respawnTimer = def?.respawnDelay ?? 14;
        applyPickupEffect(state, pk.kind, i, pk.x, raft.z);
      }
    }
  }

  // Treasure Hunt Mode Coins & High-Risk Chests (MODE-03)
  if (state.gameMode === 'treasure' && state.treasures.length > 0) {
    for (const tr of state.treasures) {
      if (tr.collected) continue;
      const dx = raft.x - tr.x;
      const dz = raft.z - tr.z;
      const dist = Math.hypot(dx, dz);

      if (state.magnetTimer > 0 && dist > 0.1 && dist < 22.0) {
        const pull = Math.min(dist, 16.5 * dt);
        tr.x += (dx / dist) * pull;
        tr.z += (dz / dist) * pull;
      }

      if (Math.hypot(raft.x - tr.x, raft.z - tr.z) <= RAFT_RADIUS + 1.45) {
        tr.collected = true;
        state.treasureScore += tr.value;
        state.coinsCollected += 1;
        pushEvent(state, {
          type: 'coin',
          intensity: tr.kind === 'chest' ? 1 : 0.65,
          x: tr.x,
          z: tr.z,
        });
      }
    }
  }

  // Boost pads (water current jets / conveyor turbines)
  for (const pad of course.boostPads) {
    const dx = raft.x - pad.x;
    const dz = deltaZForMode(postMoveMappedZ, pad.z, loopSpan, isSurvival);
    const dist = Math.hypot(dx, dz);
    if (dist < pad.radius + RAFT_RADIUS * 0.6) {
      raft.vx += pad.dirX * pad.strength * dt * 3.2;
      raft.vz += pad.dirZ * pad.strength * dt * 3.2;
    }
  }

  // Dynamic surfaces: crumbling volcanic ledges & breakable thin-ice bridges
  for (let i = 0; i < course.dynamicZones.length; i++) {
    const def = course.dynamicZones[i];
    const dzState = state.dynamicZones[i];
    if (!dzState) continue;

    if (dzState.status === 'cracking') {
      dzState.timer -= dt;
      if (dzState.timer <= 0) {
        dzState.status = 'broken';
        dzState.timer = def.respawnDelay;
        pushEvent(state, {
          type: 'surface_break',
          intensity: 0.9,
          x: def.x,
          z: raft.z,
        });
        if (def.kind === 'crumbling_rock') {
          const dist = Math.hypot(raft.x - def.x, deltaZForMode(postMoveMappedZ, def.z, loopSpan, isSurvival));
          if (dist < Math.max(def.halfWidth, def.halfLength) + RAFT_RADIUS) {
            const nx = dist > 0.01 ? (raft.x - def.x) / dist : 0;
            const nz = -1;
            const dmgOutcome = applyHullDamage(state, 18, def.x, raft.z);
            if (dmgOutcome === 'sunk') return state.events;
            const blocked = dmgOutcome === 'blocked';
            const knock = blocked ? 0.45 : 1.0;
            raft.vx = raft.vx * 0.55 + nx * 6.5 * knock;
            raft.vz = raft.vz * 0.55 + nz * 6.5 * knock;
            raft.omega += (nx >= 0 ? -1 : 1) * 1.1 * knock;
            state.hitstopTimer = Math.max(state.hitstopTimer, 0.035);
          }
        }
      }
    } else if (dzState.status === 'broken') {
      dzState.timer -= dt;
      if (dzState.timer <= 0) {
        dzState.status = 'intact';
        dzState.timer = 0;
      }
    }

    const overlaps =
      Math.abs(raft.x - def.x) <= def.halfWidth + RAFT_RADIUS * 0.35 &&
      Math.abs(deltaZForMode(postMoveMappedZ, def.z, loopSpan, isSurvival)) <= def.halfLength + RAFT_RADIUS * 0.35;

    if (overlaps) {
      if (dzState.status === 'intact') {
        dzState.status = 'cracking';
        dzState.timer = def.collapseDelay;
        pushEvent(state, {
          type: 'surface_crack',
          intensity: 0.65,
          x: def.x,
          z: raft.z,
        });
      }
      if (dzState.status === 'cracking' && def.kind === 'thin_ice') {
        activeHazardTag = 'thin_ice';
      }
      if (dzState.status === 'broken' && def.pitFallOnBreak && state.invulnTimer <= 0) {
        state.phase = 'falling';
        state.fallTimer = 0.85;
        state.falls += 1;
        state.activeHazardTag = 'thin_ice';
        pushEvent(state, {
          type: 'fall',
          intensity: 1,
          x: raft.x,
          z: raft.z,
        });
        return state.events;
      }
    }
  }

  // Falling hazards (volcanic rocks, icicles, factory scrap)
  for (const h of course.fallingHazards) {
    const period = Math.max(1.5, h.period);
    const prevPhase = (((prevSimTime + h.phaseOffset) % period) + period) % period;
    const curPhase = (((state.simTime + h.phaseOffset) % period) + period) % period;
    if (curPhase < prevPhase) {
      const dx = raft.x - h.x;
      const dz = deltaZForMode(postMoveMappedZ, h.z, loopSpan, isSurvival);
      const dist = Math.hypot(dx, dz);
      if (dist < h.radius + RAFT_RADIUS && state.invulnTimer <= 0) {
        const nx = dist > 0.001 ? dx / dist : 0;
        const nz = dist > 0.001 ? dz / dist : 1;
        const dmgOutcome = applyHullDamage(state, 26, h.x, raft.z);
        if (dmgOutcome === 'sunk') return state.events;
        const blocked = dmgOutcome === 'blocked';
        const knock = blocked ? 0.35 : 1.0;
        raft.vx += nx * h.impactForce * knock;
        raft.vz += nz * h.impactForce * knock;
        raft.omega += (nx >= 0 ? -1 : 1) * 1.6 * knock;
        state.hitstopTimer = Math.max(state.hitstopTimer, 0.045);
        pushEvent(state, {
          type: 'hazard_hit',
          intensity: 0.95,
          x: h.x,
          z: raft.z,
        });
      } else {
        pushEvent(state, {
          type: 'hazard_hit',
          intensity: 0.35,
          x: h.x,
          z: raft.z,
        });
      }
    }
  }

  // Collisions with static obstacles (phased out during Chaos 'ghost_obstacles')
  if (state.chaosModifier !== 'ghost_obstacles') {
    for (const obs of course.staticObstacles) {
      const dx = raft.x - obs.x;
      const dz = deltaZForMode(postMoveMappedZ, obs.z, loopSpan, isSurvival);
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

          if (obs.kind === 'bumper') {
            raft.vx += nx * 7.5;
            raft.vz += nz * 7.5;
            raft.omega += (nx > 0 ? -1 : 1) * 1.4;
            state.hitstopTimer = Math.max(state.hitstopTimer, 0.035);
            pushEvent(state, {
              type: 'bumper',
              intensity: clamp(Math.abs(vn) / 10 + 0.4, 0.3, 1),
              x: obs.x,
              z: raft.z,
            });
          } else {
            const impactStrength = clamp(Math.abs(vn) / 12, 0.15, 1);
            if (impactStrength > 0.35) {
              const dmg = Math.round((impactStrength - 0.25) * 28);
              if (applyHullDamage(state, dmg, obs.x, raft.z) === 'sunk') return state.events;
            }
            if (impactStrength > 0.45) {
              state.hitstopTimer = Math.max(state.hitstopTimer, 0.03);
            }
            for (const p of state.players) {
              if (p.farting) p.stats.wallImpactCount += 1;
            }
            pushEvent(state, {
              type: 'collision',
              intensity: impactStrength,
              x: obs.x,
              z: raft.z,
            });
          }
        }
      }
    }
  }

  // Collisions with moving barrier gates & vertical hydraulic pistons (faster in Survival / Ghost Chaos)
  const gateTimeScale =
    state.chaosModifier === 'ghost_obstacles'
      ? 1.35
      : isSurvival
        ? Math.min(1.6, state.survivalSpeedScale)
        : 1.0;
  for (const gate of course.movingGates) {
    const tf = getMovingGateTransform(gate, state.simTime * gateTimeScale);
    if (!tf.blocksChannel) continue;

    const closestX = clamp(raft.x, tf.x - gate.halfWidth, tf.x + gate.halfWidth);
    const dzFromGate = deltaZForMode(postMoveMappedZ, tf.z, loopSpan, isSurvival);
    const clampedDz = clamp(dzFromGate, -gate.depth * 0.5, gate.depth * 0.5);
    const dx = raft.x - closestX;
    const dz = dzFromGate - clampedDz;
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
        const impactStrength = clamp(Math.abs(vn) / 10 + 0.35, 0.3, 1);
        const dmgOutcome = applyHullDamage(state, Math.round(impactStrength * 22), closestX, raft.z);
        if (dmgOutcome === 'sunk') return state.events;
        const blocked = dmgOutcome === 'blocked';

        const bounceMult = blocked ? 1.35 : 1.85;
        raft.vx -= bounceMult * vn * nx;
        raft.vz -= bounceMult * vn * nz;
        raft.omega += (raft.x - tf.x) * (blocked ? 0.15 : 0.35);
        state.hitstopTimer = Math.max(state.hitstopTimer, 0.045);
        for (const p of state.players) {
          if (p.connected && (p.farting || p.moveDir !== 0)) {
            p.stats.wallImpactCount += 1;
          }
        }
        pushEvent(state, {
          type: 'collision',
          intensity: impactStrength,
          x: closestX,
          z: raft.z,
        });
      }
    }
  }

  // Channel boundary walls vs open waterfall/cliff drop-off
  const finalMappedZ = mapZForCourseMode(raft.z, course, isSurvival);
  const bounds = getChannelBoundsAtZ(finalMappedZ, course.waypoints);
  const offsetFromCenter = raft.x - bounds.centerX;
  const maxSafeOffset = bounds.halfWidth - RAFT_RADIUS * 0.65;

  if (isDangerOpenEdgeZone(finalMappedZ, course)) {
    if (Math.abs(offsetFromCenter) > bounds.halfWidth + 0.65 && state.invulnTimer <= 0) {
      state.phase = 'falling';
      state.fallTimer = 0.85;
      state.falls += 1;
      state.activeHazardTag = activeHazardTag;
      pushEvent(state, {
        type: 'fall',
        intensity: 1,
        x: raft.x,
        z: raft.z,
      });
      return state.events;
    }
  } else if (Math.abs(offsetFromCenter) > maxSafeOffset) {
    const sign = offsetFromCenter > 0 ? 1 : -1;
    raft.x = bounds.centerX + sign * maxSafeOffset;
    if (raft.vx * sign > 0) {
      const impact = clamp(Math.abs(raft.vx) / 12, 0.15, 0.9);
      if (impact > 0.48) {
        if (applyHullDamage(state, Math.round((impact - 0.35) * 20), raft.x, raft.z) === 'sunk') {
          return state.events;
        }
      }
      raft.vx = -raft.vx * 0.55;
      raft.omega -= sign * 0.45;
      if (impact > 0.25) {
        for (const p of state.players) {
          if (p.connected && (p.farting || p.moveDir !== 0)) {
            p.stats.wallImpactCount += 1;
          }
        }
        pushEvent(state, {
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

  if (isSurvival) {
    const forwardDist = Math.max(0, course.startZ - raft.z);
    state.survivalDistance = Math.max(state.survivalDistance, Math.round(forwardDist));
    const currentLap = Math.floor(forwardDist / loopSpan);
    if (currentLap > state.checkpointIndex) {
      state.checkpointIndex = currentLap;
      if (!state.checkpointCollisionDirty) {
        state.cleanCheckpoints = (state.cleanCheckpoints ?? 0) + 1;
      }
      state.checkpointCollisionDirty = false;
      if (state.raftHp < state.maxHp) {
        state.raftHp = Math.min(state.maxHp, state.raftHp + 18);
        pushEvent(state, { type: 'repair', intensity: 0.75, x: raft.x, z: raft.z });
      }
      pushEvent(state, { type: 'checkpoint', intensity: 1, x: raft.x, z: raft.z });
    }
    state.progress = (forwardDist % loopSpan) / loopSpan;
    const perLoopPassed = course.movingGates.filter((g) => postMoveMappedZ < g.z - 2.5).length;
    state.hardGatesPassed = Math.max(
      state.hardGatesPassed ?? 0,
      currentLap * course.movingGates.length + perLoopPassed,
    );
  } else {
    const passedCount = course.movingGates.filter((g) => raft.z < g.z - 2.5).length;
    state.hardGatesPassed = Math.max(state.hardGatesPassed ?? 0, passedCount);
    // Standard checkpoint capture (+20 HP repair dock)
    for (const cp of course.checkpoints) {
      if (cp.index > state.checkpointIndex) {
        const dist = Math.hypot(raft.x - cp.x, raft.z - cp.z);
        const maxLateralSpan = cp.radius + RAFT_RADIUS;
        const inRadialZone = dist <= maxLateralSpan;
        const crossedGateSpan =
          raft.z <= cp.z &&
          raft.z >= cp.z - 12 &&
          Math.abs(raft.x - cp.x) <= maxLateralSpan;
        if (inRadialZone || crossedGateSpan) {
          state.checkpointIndex = cp.index;
          if (!state.checkpointCollisionDirty) {
            state.cleanCheckpoints = (state.cleanCheckpoints ?? 0) + 1;
          }
          state.checkpointCollisionDirty = false;
          if (state.raftHp < state.maxHp) {
            state.raftHp = Math.min(state.maxHp, state.raftHp + 20);
            pushEvent(state, {
              type: 'repair',
              intensity: 0.75,
              x: cp.x,
              z: cp.z,
            });
          }
          state.reactionCueSimTime = state.simTime;
          pushEvent(state, {
            type: 'checkpoint',
            intensity: 1,
            x: cp.x,
            z: cp.z,
          });
        }
      }
    }

    // Progress & Finish Line (or soft lagoon boundary when infiniteSandbox is active in Free Practice)
    state.progress = getCourseProgress(raft.z, course);
    if (state.infiniteSandbox) {
      if (raft.z <= course.finishZ + 8) {
        raft.z = course.finishZ + 8;
        if (raft.vz < 0) raft.vz = -raft.vz * 0.45;
      }
    } else if (raft.z <= course.finishZ && Math.abs(raft.x - course.finishX) <= course.finishHalfWidth) {
      state.phase = 'finished';
      state.runOutcome = 'victory';
      state.progress = 1;
      state.anchorActive = false;
      for (const p of state.players) {
        p.farting = false;
        p.moveDir = 0;
        p.anchorRequested = false;
        p.useItemRequested = false;
      }
      pushEvent(state, {
        type: 'finish',
        intensity: 1,
        x: raft.x,
        z: raft.z,
      });
    }
  }

  if (state.raftHp < 40 && !activeHazardTag) {
    activeHazardTag = 'damaged';
  }
  state.activeHazardTag = activeHazardTag;

  return state.events;
}
