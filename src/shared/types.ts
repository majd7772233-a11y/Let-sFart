export type GameScreenState = 'title' | 'lobby' | 'playing' | 'paused' | 'gameover';

export type PlayMode = 'solo' | 'online';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'connected';

export type GameMode = 'standard' | 'time_trial' | 'survival' | 'treasure' | 'chaos';

export type GameDifficulty = 'easy' | 'normal' | 'hard';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export type BotPersonality = 'rusher' | 'cautious' | 'treasure_hunter' | 'balancer';

export type BotPersonalitiesMap = Partial<Record<0 | 1 | 2 | 3, BotPersonality>>;

export interface RoomSettings {
  gameMode: GameMode;
  difficulty: GameDifficulty;
  enableItems: boolean;
  roundTimeLimitSec: number; // 0 = unlimited, else seconds (e.g., 90, 120, 180, 300)
  maxPlayers: 2 | 3 | 4;
  botDifficulty?: BotDifficulty;
  botPersonalities?: BotPersonalitiesMap;
}

export type ChaosModifierKind =
  | 'none'
  | 'wind_flip'
  | 'turbo_surge'
  | 'ghost_obstacles'
  | 'reverse_controls';

export type TreasureKind = 'coin' | 'chest';

export interface TreasureSimState {
  id: string;
  kind: TreasureKind;
  x: number;
  z: number;
  value: number;
  collected: boolean;
}

export interface GhostFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export type RunOutcome = 'victory' | 'defeat';

export type CourseId = 'tropical' | 'volcanic' | 'glacial' | 'factory' | 'storm';

export type CourseSelectionMode = 'host' | 'vote';

export type HatStyle =
  | 'none'
  | 'captain'
  | 'crown'
  | 'propeller'
  | 'pirate'
  | 'viking'
  | 'snorkel'
  | 'storm_hood';

export type GlassesStyle =
  | 'none'
  | 'shades'
  | 'nerd'
  | 'monocle'
  | 'cyber_visor'
  | 'heart_shades';

export type OutfitStyle =
  | 'classic'
  | 'captain_coat'
  | 'diver_suit'
  | 'volcanic_armor'
  | 'royal_robe';

export type RaftSkinId =
  | 'classic_oak'
  | 'bamboo_tropical'
  | 'obsidian_magma'
  | 'frost_crystal'
  | 'golden_galleon';

export type MotionTrailId =
  | 'classic_green'
  | 'rainbow_bubbles'
  | 'volcanic_sparks'
  | 'frost_mist'
  | 'golden_confetti';

export interface PlayerCosmetic {
  hat: HatStyle;
  glasses: GlassesStyle;
  colorIndex: number;
  outfit?: OutfitStyle;
  raftSkin?: RaftSkinId;
  trail?: MotionTrailId;
}

export interface PlayerZoneBounds {
  slot: 0 | 1 | 2 | 3;
  minX: number;
  maxX: number;
  defaultX: number;
  zoneZ: number;
  label: string;
}

export interface PlayerStats {
  totalFartTime: number;
  fartCount: number;
  maxBurstDuration: number;
  torqueImpulseSum: number;
  wallImpactCount: number;
  itemsUsed?: number;
  pushImpulseSum?: number;
  firstReactionMs?: number | null;
  fastestReactionMs?: number | null;
  lastCueSimTime?: number | null;
}

export type SeatStatus = 'EMPTY' | 'BOT' | 'CONNECTED' | 'RECONNECTING';

export type EmoteId = 'laugh' | 'fear' | 'celebrate' | 'dance' | 'point_left' | 'point_right';

export interface ActivePlayerEmote {
  id: EmoteId;
  seq: number;
  expiresAtMs: number;
}

export interface PlayerSimState {
  slot: 0 | 1 | 2 | 3;
  id: string;
  name: string;
  connected: boolean;
  isBot: boolean;
  botPersonality?: BotPersonality;
  tempBotSubstitute?: boolean;
  ready: boolean;
  seatStatus?: SeatStatus;
  cosmetic: PlayerCosmetic;
  localX: number;
  lateralVel: number;
  moveDir: -1 | 0 | 1;
  farting: boolean;
  fartHoldTime: number;
  fartPower: number;
  releaseBounce: number;
  anchorRequested?: boolean;
  useItemRequested?: boolean;
  lastFartStartSimTime?: number;
  lastInputAt: number;
  activeEmote?: ActivePlayerEmote | null;
  accountId?: string;
  playerLevel?: number;
  stats: PlayerStats;
}

export interface RaftSimState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  omega: number;
  pitch: number;
  roll: number;
  pitchVel: number;
  rollVel: number;
}

export type SimPhase = 'waiting' | 'playing' | 'paused' | 'falling' | 'finished';

export type HazardEffectTag =
  | 'ice'
  | 'heat'
  | 'wind'
  | 'thin_ice'
  | 'oil'
  | 'storm_wind'
  | 'damaged'
  | null;

export type BoostCanKind = 'lentil_can' | 'fava_can' | 'bean_can';

export type PickupKind =
  | BoostCanKind
  | 'shield'
  | 'magnet'
  | 'shockwave'
  | 'repair_kit'
  | 'mystery_crate';

export interface CoursePickupDef {
  id: string;
  kind: PickupKind;
  x: number;
  z: number;
  respawnDelay?: number;
}

export interface PickupSimState {
  id: string;
  kind: PickupKind;
  x: number;
  z: number;
  collected: boolean;
  respawnTimer: number;
}

export interface SimEvent {
  id: number;
  type:
    | 'collision'
    | 'bumper'
    | 'checkpoint'
    | 'fall'
    | 'finish'
    | 'fart_start'
    | 'fart_stop'
    | 'hazard_hit'
    | 'surface_crack'
    | 'surface_break'
    | 'pickup'
    | 'shield_block'
    | 'shield_break'
    | 'repair'
    | 'super_fart'
    | 'anchor_drop'
    | 'anchor_raise'
    | 'shockwave'
    | 'lightning'
    | 'hull_critical'
    | 'coin'
    | 'chaos_shift'
    | 'time_expired';
  slot?: number;
  pickupKind?: PickupKind;
  chaosModifier?: ChaosModifierKind;
  intensity: number;
  x: number;
  z: number;
}

export interface DynamicZoneState {
  id: string;
  status: 'intact' | 'cracking' | 'broken';
  timer: number;
}

export interface WorldSimulationState {
  courseId: CourseId;
  mode: PlayMode;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  botDifficulty?: BotDifficulty;
  enableItems: boolean;
  roundTimeLimitSec: number;
  phase: SimPhase;
  runOutcome: RunOutcome;
  simTime: number;
  elapsedTime: number;
  raft: RaftSimState;
  players: [PlayerSimState, PlayerSimState, PlayerSimState, PlayerSimState];
  checkpointIndex: number;
  falls: number;
  progress: number;
  invulnTimer: number;
  fallTimer: number;
  hitstopTimer: number;
  dynamicZones: DynamicZoneState[];
  activeHazardTag: HazardEffectTag;
  pickups: PickupSimState[];
  raftHp: number;
  maxHp: number;
  shieldHits: number;
  shieldTimer: number;
  magnetTimer: number;
  boostKind: BoostCanKind | null;
  boostTimer: number;
  boostMultiplier: number;
  heldItem: 'shockwave' | null;
  anchorActive: boolean;
  anchorEnergy: number;
  anchorCooldown: number;
  harmony: number;
  superFartTimer: number;
  harmonyComboCount: number;
  windX: number;
  windZ: number;
  lightningTimer: number;
  survivalDistance: number;
  survivalSpeedScale: number;
  treasures: TreasureSimState[];
  treasureScore: number;
  coinsCollected: number;
  totalCoins: number;
  chaosModifier: ChaosModifierKind;
  chaosTimer: number;
  itemsCollectedCount?: number;
  harmonySuperFartCount?: number;
  hardGatesPassed?: number;
  minRaftHp?: number;
  collisionCount?: number;
  cleanCheckpoints?: number;
  checkpointCollisionDirty?: boolean;
  practiceMode?: boolean;
  infiniteSandbox?: boolean;
  reactionCueSimTime?: number;
  roundHighlights?: RoundHighlight[];
  eventSeq: number;
  events: SimEvent[];
}

export interface ChannelWaypoint {
  z: number;
  centerX: number;
  halfWidth: number;
}

export interface StaticObstacleDef {
  id: string;
  kind: 'rock' | 'pillar' | 'buoy' | 'bumper';
  x: number;
  z: number;
  radius: number;
  height: number;
  restitution: number;
}

export type MovingGateMotion = 'oscillate' | 'slam' | 'vertical_piston';
export type MovingGateStyle =
  | 'wooden_gate'
  | 'lava_surge'
  | 'iceberg'
  | 'piston'
  | 'gear'
  | 'crane';

export interface MovingGateDef {
  id: string;
  baseX: number;
  z: number;
  halfWidth: number;
  depth: number;
  amplitudeX: number;
  speed: number;
  phaseOffset: number;
  motion?: MovingGateMotion;
  style?: MovingGateStyle;
  slamPeriod?: number;
  closedRatio?: number;
}

export interface BoostPadDef {
  id: string;
  x: number;
  z: number;
  radius: number;
  dirX: number;
  dirZ: number;
  strength: number;
}

export interface CheckpointDef {
  index: number;
  z: number;
  x: number;
  yaw: number;
  radius: number;
  label: string;
}

export interface DangerZoneRange {
  zStart: number;
  zEnd: number;
}

export interface FrictionZoneDef {
  id: string;
  kind: 'ice_sheet' | 'oil_slick';
  x: number;
  z: number;
  halfWidth: number;
  halfLength: number;
  dragMultiplier: number;
  turnMultiplier?: number;
}

export interface HeatZoneDef {
  id: string;
  kind: 'magma_vent' | 'furnace_blast';
  x: number;
  z: number;
  radius: number;
  thrustBoost: number;
  turbulenceX: number;
}

export interface WindZoneDef {
  id: string;
  kind: 'waterfall_gust' | 'factory_fan' | 'steam_vent';
  x: number;
  z: number;
  halfWidth: number;
  halfLength: number;
  forceX: number;
  forceZ: number;
  cyclePeriod?: number;
  dutyCycle?: number;
  phaseOffset?: number;
}

export interface FallingHazardDef {
  id: string;
  kind: 'volcanic_rock' | 'icicle' | 'scrap_crate';
  x: number;
  z: number;
  radius: number;
  period: number;
  phaseOffset: number;
  warningDuration: number;
  impactForce: number;
}

export interface DynamicSurfaceZoneDef {
  id: string;
  kind: 'crumbling_rock' | 'thin_ice';
  x: number;
  z: number;
  halfWidth: number;
  halfLength: number;
  collapseDelay: number;
  respawnDelay: number;
  pitFallOnBreak?: boolean;
}

export interface DynamicWindConfig {
  baseAngle: number;
  baseSpeed: number;
  gustAmplitude: number;
  gustPeriod: number;
}

export interface CourseEnvironmentMeta {
  id: CourseId;
  nameAr: string;
  subtitleAr: string;
  difficultyAr: 'سهل' | 'متوسط' | 'صعب' | 'متقدم';
  accentHex: string;
  hazardSummaryAr: string;
  skyTopHex: number;
  skyHorizonHex: number;
  fogColorHex: number;
  fogNear: number;
  fogFar: number;
  waterColorHex: number;
  waterFoamHex: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  keyLightHex: number;
  keyLightIntensity: number;
  rimLightHex: number;
  ambientParticles: 'mist' | 'embers' | 'snow' | 'sparks' | 'rain';
  waveAmplitude?: number;
}

export interface CourseDefinition {
  id: CourseId;
  meta: CourseEnvironmentMeta;
  startZ: number;
  finishZ: number;
  finishX: number;
  finishHalfWidth: number;
  waypoints: ChannelWaypoint[];
  dangerZones: DangerZoneRange[];
  staticObstacles: StaticObstacleDef[];
  movingGates: MovingGateDef[];
  boostPads: BoostPadDef[];
  checkpoints: CheckpointDef[];
  frictionZones: FrictionZoneDef[];
  heatZones: HeatZoneDef[];
  windZones: WindZoneDef[];
  fallingHazards: FallingHazardDef[];
  dynamicZones: DynamicSurfaceZoneDef[];
  pickups?: CoursePickupDef[];
  dynamicWind?: DynamicWindConfig;
}

export interface ClientInputPacket {
  moveDir: -1 | 0 | 1;
  farting: boolean;
  anchor?: boolean;
  useItem?: boolean;
  seq: number;
}

export interface RoomPlayerMeta {
  slot: 0 | 1 | 2 | 3;
  id: string;
  name: string;
  connected: boolean;
  isBot: boolean;
  ready: boolean;
  cosmetic: PlayerCosmetic;
}

export type PlayerRole = 'HOST' | 'PLAYER' | 'SPECTATOR';

export interface SpectatorInfo {
  id: string;
  name: string;
  connected: boolean;
  cosmetic: PlayerCosmetic;
  joinedAt: number;
}

export interface PlaylistItem {
  id: string;
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: GameDifficulty;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderSlot: 0 | 1 | 2 | 3 | -1;
  isSpectator: boolean;
  colorIndex: number;
  text: string;
  presetId?: string;
  createdAt: number;
}

export interface PartyMember {
  memberId: string;
  name: string;
  cosmetic: PlayerCosmetic;
  connected: boolean;
  isLeader: boolean;
  joinedAt: number;
}

export interface PartyState {
  partyCode: string;
  leaderId: string;
  members: PartyMember[];
  activeRoomCode: string | null;
  activeRoomPassword?: string | null;
  roomFollowSeq: number;
  recentChat: ChatMessage[];
  createdAt: number;
  expiresAt: number;
}

export type RoomLifecycleState =
  | 'CREATING'
  | 'WAITING'
  | 'PLAYING'
  | 'FALLING'
  | 'FINISHED'
  | 'RESTARTING'
  | 'CLOSED';

export interface RoomSnapshot {
  roomCode: string;
  hostId: string;
  fillBots: boolean;
  isPrivate?: boolean;
  maxPlayers?: number;
  settings?: RoomSettings;
  courseId?: CourseId;
  courseSelectionMode?: CourseSelectionMode;
  courseVotes?: Record<string, CourseId>;
  lifecycleState?: RoomLifecycleState;
  roundSeq?: number;
  snapshotSeq: number;
  serverTime: number;
  seats?: [SeatStatus, SeatStatus, SeatStatus, SeatStatus];
  spectators?: SpectatorInfo[];
  spectatorCount?: number;
  playlistQueue?: PlaylistItem[];
  recentChat?: ChatMessage[];
  sim: WorldSimulationState;
}

export type ClientToServerMessage =
  | { type: 'room:create'; name: string; cosmetic: PlayerCosmetic }
  | { type: 'room:join'; roomCode: string; name: string; playerId?: string; cosmetic: PlayerCosmetic }
  | { type: 'room:leave' }
  | { type: 'room:ready'; ready: boolean }
  | { type: 'room:cosmetic'; cosmetic: PlayerCosmetic }
  | { type: 'room:toggleBots'; fillBots: boolean }
  | { type: 'room:selectCourse'; courseId: CourseId; courseSelectionMode?: CourseSelectionMode }
  | { type: 'room:voteCourse'; courseId: CourseId }
  | { type: 'room:updateSettings'; settings: Partial<RoomSettings> }
  | { type: 'room:start' }
  | { type: 'room:restart' }
  | { type: 'input:state'; moveDir: -1 | 0 | 1; farting: boolean; anchor?: boolean; useItem?: boolean; seq: number }
  | { type: 'ping' };

export type ServerToClientMessage =
  | { type: 'room:joined'; roomCode: string; playerId: string; slot: 0 | 1 | 2 | 3 | -1; snapshot: RoomSnapshot }
  | { type: 'room:state'; snapshot: RoomSnapshot }
  | { type: 'room:error'; message: string }
  | { type: 'pong'; serverTime: number };

// ==========================================
// PROG-01..05: Accounts, Stats, Achievements & Leaderboards
// ==========================================

export type AchievementId =
  | 'first_voyage'
  | 'speed_demon'
  | 'untouchable'
  | 'hard_gate_master'
  | 'win_streak_5'
  | 'win_legend_15'
  | 'item_collector'
  | 'engine_of_crew'
  | 'harmony_conductor'
  | 'treasure_hunter'
  | 'survivor_300'
  | 'all_courses_explorer';

export interface AchievementDef {
  id: AchievementId;
  titleAr: string;
  descriptionAr: string;
  icon: string;
  points: number;
  category: 'speed' | 'mastery' | 'teamwork' | 'milestone';
}

export interface UnlockedAchievement {
  id: AchievementId;
  unlockedAt: number;
  points: number;
}

export interface CourseBestRecord {
  courseId: CourseId;
  bestTimeSec: number | null;
  bestSurvivalDistance: number;
  bestTreasureScore: number;
  wins: number;
  plays: number;
}

export interface PlayerCareerStats {
  roundsPlayed: number;
  wins: number;
  losses: number;
  totalFalls: number;
  bestTimeSec: number | null;
  itemsUsed: number;
  totalPushContribution: number;
  totalFartTime: number;
  totalScore: number;
  bestSurvivalDistance: number;
  bestTreasureScore: number;
  hardGatesPassed: number;
  harmonyCombos: number;
  courseBests: Record<CourseId, CourseBestRecord>;
}

export interface AccountProfile {
  accountId: string;
  isGuest: boolean;
  username: string | null;
  displayName: string;
  cosmetic: PlayerCosmetic;
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  rankTitleAr: string;
  challengePoints: number;
  coins: number;
  createdAt: number;
  updatedAt: number;
}

export interface FriendSummary {
  accountId: string;
  username: string | null;
  displayName: string;
  cosmetic: PlayerCosmetic;
  level: number;
  wins: number;
  challengePoints: number;
  bestTimeSec: number | null;
  addedAt: number;
}

export type LeaderboardMetric = 'best_time' | 'wins' | 'challenge_points';
export type LeaderboardScope = 'global' | 'weekly' | 'friends';

export interface LeaderboardEntry {
  rank: number;
  accountId: string;
  username: string | null;
  displayName: string;
  isGuest: boolean;
  cosmetic: PlayerCosmetic;
  level: number;
  wins: number;
  roundsPlayed: number;
  bestTimeSec: number | null;
  challengePoints: number;
  totalPushContribution: number;
  isSelf?: boolean;
}

export interface MatchSummaryInput {
  submissionKey: string;
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  outcome: RunOutcome;
  elapsedTimeSec: number;
  falls: number;
  itemsUsed: number;
  pushContribution: number;
  fartTimeSec: number;
  survivalDistance: number;
  treasureScore: number;
  harmonyCombos: number;
  hardGatesPassed: number;
  minRaftHp: number;
  cleanCheckpoints?: number;
  collisionCount?: number;
  isOnline: boolean;
}

// ==========================================
// PROG-06..10: Quests, Coins, Cosmetic Shop, Seasons & Rare Events
// ==========================================

export type CosmeticCategory =
  | 'hat'
  | 'glasses'
  | 'color'
  | 'outfit'
  | 'raft_skin'
  | 'trail';

export type CosmeticRarity = 'starter' | 'common' | 'rare' | 'epic' | 'seasonal';

export interface CosmeticItemDef {
  id: string;
  category: CosmeticCategory;
  value: string | number;
  titleAr: string;
  descriptionAr: string;
  priceCoins: number;
  rarity: CosmeticRarity;
  unlockSource: 'starter' | 'shop' | 'season' | 'rare_event';
  previewAccentHex: string;
}

export type QuestCadence = 'daily' | 'weekly';

export type QuestObjectiveKind =
  | 'play_rounds'
  | 'win_rounds'
  | 'treasure_points'
  | 'clean_checkpoints'
  | 'items_used'
  | 'push_contribution'
  | 'survival_distance';

export interface QuestState {
  questId: string;
  templateId: string;
  cadence: QuestCadence;
  periodKey: string;
  titleAr: string;
  descriptionAr: string;
  icon: string;
  objective: QuestObjectiveKind;
  progress: number;
  goal: number;
  xpReward: number;
  coinsReward: number;
  seasonPointsReward: number;
  completedAt: number | null;
  claimedAt: number | null;
  resetAt: number;
}

export interface SeasonRewardTierState {
  tier: number;
  requiredPoints: number;
  titleAr: string;
  coinsReward: number;
  xpReward: number;
  cosmeticItemId: string | null;
  unlocked: boolean;
  claimed: boolean;
}

export interface SeasonChallengeState {
  challengeId: string;
  titleAr: string;
  descriptionAr: string;
  progress: number;
  goal: number;
  xpReward: number;
  coinsReward: number;
  seasonPointsReward: number;
  completed: boolean;
}

export interface SeasonProgressState {
  seasonId: string;
  titleAr: string;
  subtitleAr: string;
  featuredCourseId: CourseId;
  featuredGameMode: GameMode;
  seasonPoints: number;
  maxPoints: number;
  tiers: SeasonRewardTierState[];
  challenges: SeasonChallengeState[];
}

export interface RareEventDef {
  eventTypeId: string;
  titleAr: string;
  descriptionAr: string;
  featuredCourseId: CourseId;
  featuredGameMode: GameMode;
  bonusGoalRounds: number;
  xpBonus: number;
  coinsBonus: number;
  rewardItemId: string | null;
  accentHex: string;
}

export interface RareEventState {
  active: boolean;
  eventInstanceId: string | null;
  eventTypeId: string | null;
  titleAr: string | null;
  descriptionAr: string | null;
  featuredCourseId: CourseId | null;
  featuredGameMode: GameMode | null;
  roundsRemaining: number;
  roundsCompleted: number;
  bonusGoalRounds: number;
  xpBonus: number;
  coinsBonus: number;
  rewardItemId: string | null;
  completed: boolean;
  accentHex: string;
  occurrencesCount: number;
}

// ==========================================
// UX-01..06: Tutorial, Practice, Touch Layout, Camera, Round Summary & Audio
// ==========================================

export type SoloSessionKind = 'normal' | 'tutorial' | 'practice';

export type CameraMode = 'follow' | 'wide' | 'dynamic';

export interface CameraPrefs {
  mode: CameraMode;
  distanceScale: number; // 0.7..1.5
  angleDeg: number; // -10..18
}

export type TouchLayoutPreset = 'right' | 'left' | 'custom';

export interface TouchOffset {
  x: number;
  y: number;
}

export interface TouchControlsConfig {
  preset: TouchLayoutPreset;
  scale: number; // 0.75..1.45
  opacity: number; // 0.35..1.0
  offsets: {
    dpad: TouchOffset;
    fart: TouchOffset;
    anchor: TouchOffset;
    item: TouchOffset;
  };
}

export type RoundHighlightKind =
  | 'super_fart'
  | 'checkpoint'
  | 'pickup'
  | 'shield'
  | 'shockwave'
  | 'fall'
  | 'chaos'
  | 'lightning'
  | 'finish';

export interface RoundHighlight {
  id: number;
  timeSec: number;
  kind: RoundHighlightKind;
  titleAr: string;
  detailAr?: string;
  slot?: number;
}

// ==========================================
// TECH-01..07: Verification, Replays, Ops & Balance Analytics
// ==========================================

export interface ReplayKeyframe {
  t: number;
  x: number;
  z: number;
  yaw: number;
  progress: number;
  raftHp: number;
  harmony: number;
  windX: number;
}

export interface ReplayEventEntry {
  t: number;
  type: SimEvent['type'];
  x: number;
  z: number;
  intensity: number;
  slot?: number;
  labelAr?: string;
}

export interface ReplayPlayerRosterItem {
  slot: 0 | 1 | 2 | 3;
  name: string;
  isBot: boolean;
  botPersonality?: BotPersonality;
  wasTempSubstitute?: boolean;
  colorIndex: number;
  pushContribution: number;
}

export interface RoundReplayRecord {
  matchId: string;
  roomCode: string | null;
  mode: PlayMode;
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  botDifficulty?: BotDifficulty;
  outcome: RunOutcome;
  durationSec: number;
  falls: number;
  treasureScore: number;
  survivalDistance: number;
  minRaftHp: number;
  createdAt: number;
  players: ReplayPlayerRosterItem[];
  frames: ReplayKeyframe[];
  events: ReplayEventEntry[];
}

export interface RoundReplaySummary {
  matchId: string;
  roomCode: string | null;
  mode: PlayMode;
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  outcome: RunOutcome;
  durationSec: number;
  falls: number;
  treasureScore: number;
  survivalDistance: number;
  frameCount: number;
  eventCount: number;
  createdAt: number;
}

export interface MatchVerificationResult {
  ok: boolean;
  reasonCode?: string;
  reasonAr?: string;
  warnings?: string[];
}

export interface VerifiedMatchRecord {
  matchId: string;
  submissionKey: string;
  roomCode: string | null;
  accountId: string | null;
  mode: PlayMode;
  courseId: CourseId;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  outcome: RunOutcome;
  elapsedTimeSec: number;
  falls: number;
  itemsUsed: number;
  collisionCount: number;
  treasureScore: number;
  survivalDistance: number;
  minRaftHp: number;
  verifiedAt: number;
}

export interface RoomOpsMetricsSummary {
  roomCode: string;
  courseId: CourseId;
  gameMode: GameMode;
  lifecycleState: RoomLifecycleState;
  humanCount: number;
  botCount: number;
  tempSubstituteCount: number;
  spectatorCount: number;
  updatedAt: number;
}

export interface ServerHealthSnapshot {
  ok: boolean;
  service: string;
  runtime: string;
  gameVersion: string;
  protocolVersion: number;
  minCompatibleProtocolVersion: number;
  uptimeSec: number;
  timestamp: number;
  d1Connected: boolean;
  activeRoomsCount: number;
  totalHumansOnline: number;
  totalBotsActive: number;
  totalTempSubstitutesActive: number;
  totalSpectatorsOnline: number;
  disconnectCount: number;
  reconnectCount: number;
  tempSubstitutesActivated: number;
  verifiedMatchesCount: number;
  rejectedMatchesCount: number;
  httpRequestsTotal: number;
  http2xxCount: number;
  http4xxCount: number;
  http5xxCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  activeRooms: RoomOpsMetricsSummary[];
}

export interface CourseBalanceStats {
  courseId: CourseId;
  gameMode: GameMode;
  totalRuns: number;
  wins: number;
  winRatePct: number;
  avgClearTimeSec: number;
  avgFalls: number;
  avgCollisionCount: number;
  avgItemsUsed: number;
  lastUpdatedAt: number;
}

export interface BalanceAnalyticsResponse {
  totalVerifiedMatches: number;
  courses: CourseBalanceStats[];
  generatedAt: number;
}

export interface ProtocolCompatibilityInfo {
  gameVersion: string;
  protocolVersion: number;
  minCompatibleProtocolVersion: number;
}




