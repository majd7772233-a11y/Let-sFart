export type GameScreenState = 'title' | 'lobby' | 'playing' | 'paused' | 'gameover';

export type PlayMode = 'solo' | 'online';

export type HatStyle = 'none' | 'captain' | 'crown' | 'propeller';
export type GlassesStyle = 'none' | 'shades' | 'nerd';

export interface PlayerCosmetic {
  hat: HatStyle;
  glasses: GlassesStyle;
  colorIndex: number;
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
}

export interface PlayerSimState {
  slot: 0 | 1 | 2 | 3;
  id: string;
  name: string;
  connected: boolean;
  isBot: boolean;
  ready: boolean;
  cosmetic: PlayerCosmetic;
  localX: number;
  lateralVel: number;
  moveDir: -1 | 0 | 1;
  farting: boolean;
  fartHoldTime: number;
  fartPower: number;
  releaseBounce: number;
  lastInputAt: number;
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

export interface SimEvent {
  type: 'collision' | 'bumper' | 'checkpoint' | 'fall' | 'finish' | 'fart_start' | 'fart_stop';
  slot?: number;
  intensity: number;
  x: number;
  z: number;
}

export interface WorldSimulationState {
  mode: PlayMode;
  phase: SimPhase;
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

export interface MovingGateDef {
  id: string;
  baseX: number;
  z: number;
  halfWidth: number;
  depth: number;
  amplitudeX: number;
  speed: number;
  phaseOffset: number;
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

export interface CourseDefinition {
  startZ: number;
  finishZ: number;
  finishX: number;
  finishHalfWidth: number;
  waypoints: ChannelWaypoint[];
  staticObstacles: StaticObstacleDef[];
  movingGates: MovingGateDef[];
  boostPads: BoostPadDef[];
  checkpoints: CheckpointDef[];
}

export interface ClientInputPacket {
  moveDir: -1 | 0 | 1;
  farting: boolean;
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

export interface RoomSnapshot {
  roomCode: string;
  hostId: string;
  fillBots: boolean;
  sim: WorldSimulationState;
}

export type ClientToServerMessage =
  | { type: 'room:create'; name: string; cosmetic: PlayerCosmetic }
  | { type: 'room:join'; roomCode: string; name: string; playerId?: string; cosmetic: PlayerCosmetic }
  | { type: 'room:leave' }
  | { type: 'room:ready'; ready: boolean }
  | { type: 'room:cosmetic'; cosmetic: PlayerCosmetic }
  | { type: 'room:toggleBots'; fillBots: boolean }
  | { type: 'room:start' }
  | { type: 'room:restart' }
  | { type: 'input:state'; moveDir: -1 | 0 | 1; farting: boolean; seq: number }
  | { type: 'ping' };

export type ServerToClientMessage =
  | { type: 'room:joined'; roomCode: string; playerId: string; slot: 0 | 1 | 2 | 3; snapshot: RoomSnapshot }
  | { type: 'room:state'; snapshot: RoomSnapshot }
  | { type: 'room:error'; message: string }
  | { type: 'pong'; serverTime: number };
