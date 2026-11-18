import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  PLAYER_ZONES,
  getCourseById,
  getFallingHazardCycle,
  getMovingGateTransform,
  isValidCourseId,
  isWindZoneActive,
} from '../shared/course.ts';
import {
  clamp,
  createInitialSimState,
  getCourseLoopSpan,
  stepSimulation,
} from '../shared/physics.ts';
import { COURSE_PRACTICE, COURSE_TUTORIAL } from '../shared/courses/training.ts';
import {
  CAMERA_MODE_META,
  DEFAULT_CAMERA_PREFS,
  TUTORIAL_STEPS,
  createInitialTutorialProgress,
  cycleCameraMode,
  evaluateTutorialStep,
  normalizeCameraPrefs,
  type TutorialProgressState,
} from '../shared/ux.ts';
import { EMOTE_DEFINITIONS, getEmoteDefinition } from '../shared/social.ts';
import type { GameEmoteBroadcastPayload, SeatSlotOrSpectator } from '../shared/protocol.ts';
import type {
  CameraMode,
  CameraPrefs,
  CourseDefinition,
  CourseId,
  EmoteId,
  GameScreenState,
  GhostFrame,
  HazardEffectTag,
  PlayMode,
  PlayerCosmetic,
  ReplayEventEntry,
  ReplayKeyframe,
  RoomSettings,
  RoomSnapshot,
  RoundReplayRecord,
  SimEvent,
  SoloSessionKind,
  WorldSimulationState,
} from '../shared/types.ts';
import type { SoundEngine } from '../audio/soundEngine.ts';
import {
  animateCharacterRig,
  applyRaftSkin,
  createCharacterRig,
  createCourseScene,
  createGhostRaftModel,
  createRaftModel,
  createTreasureModel,
  type CharacterRig,
  type CourseSceneHandles,
  type RaftModelHandles,
} from './models.ts';
import { ParticlePoolSystem } from './particles.ts';
import { createProceduralTextures, type ProceduralTextures } from './textures.ts';

// Pre-allocated scratch math helpers (zero GC inside animation loop)
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _camLookSmooth = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _backDir = new THREE.Vector3();
const _raftQuat = new THREE.Quaternion();
const _raftEuler = new THREE.Euler(0, 0, 0, 'YXZ');

const TT_STORAGE_PREFIX = 'letsfart_tt_best_';
const SURVIVAL_STORAGE_PREFIX = 'letsfart_survival_best_';

interface TimeTrialRecord {
  bestTime: number;
  frames: GhostFrame[];
}

function loadTimeTrialRecord(courseId: CourseId): TimeTrialRecord | null {
  try {
    const raw = window.localStorage.getItem(`${TT_STORAGE_PREFIX}${courseId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimeTrialRecord;
    if (
      parsed &&
      typeof parsed.bestTime === 'number' &&
      Number.isFinite(parsed.bestTime) &&
      Array.isArray(parsed.frames)
    ) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function saveTimeTrialRecord(
  courseId: CourseId,
  bestTime: number,
  frames: GhostFrame[],
): { isNewBest: boolean; record: TimeTrialRecord } {
  const existing = loadTimeTrialRecord(courseId);
  if (existing && existing.bestTime <= bestTime) {
    return { isNewBest: false, record: existing };
  }
  const record: TimeTrialRecord = {
    bestTime: Number(bestTime.toFixed(2)),
    frames: frames.slice(0, 1200),
  };
  try {
    window.localStorage.setItem(`${TT_STORAGE_PREFIX}${courseId}`, JSON.stringify(record));
  } catch {
    // ignore storage quota errors
  }
  return { isNewBest: true, record };
}

function loadSurvivalBest(courseId: CourseId): number | null {
  try {
    const raw = window.localStorage.getItem(`${SURVIVAL_STORAGE_PREFIX}${courseId}`);
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

function saveSurvivalBest(courseId: CourseId, distance: number): { isNewBest: boolean; best: number } {
  const prev = loadSurvivalBest(courseId) ?? 0;
  if (distance <= prev) {
    return { isNewBest: false, best: prev };
  }
  try {
    window.localStorage.setItem(`${SURVIVAL_STORAGE_PREFIX}${courseId}`, String(Math.round(distance)));
  } catch {
    // ignore storage errors
  }
  return { isNewBest: true, best: Math.round(distance) };
}

function sampleGhostPose(frames: GhostFrame[], t: number): GhostFrame | null {
  if (frames.length === 0) return null;
  if (t <= frames[0].t) return frames[0];
  const last = frames[frames.length - 1];
  if (t >= last.t) return last;

  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = Math.max(0.0001, b.t - a.t);
  const alpha = (t - a.t) / span;
  let dyaw = b.yaw - a.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  return {
    t,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    yaw: a.yaw + dyaw * alpha,
  };
}

function estimateGhostDelta(frames: GhostFrame[], elapsed: number, currentZ: number): number | null {
  if (frames.length < 2) return null;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (b.z <= currentZ) {
      const dz = b.z - a.z;
      const frac = Math.abs(dz) > 0.001 ? Math.max(0, Math.min(1, (currentZ - a.z) / dz)) : 0;
      const ghostT = a.t + (b.t - a.t) * frac;
      return elapsed - ghostT;
    }
  }
  const last = frames[frames.length - 1];
  return elapsed - last.t;
}

export interface HudSnapshot {
  screen: GameScreenState;
  mode: PlayMode;
  courseId: CourseId;
  activeHazardTag: HazardEffectTag;
  elapsedTime: number;
  falls: number;
  checkpointIndex: number;
  totalCheckpoints: number;
  progress: number;
  connectedPlayers: number;
  mySlot: SeatSlotOrSpectator;
  isSpectator: boolean;
  spectatorTarget: 'raft' | 0 | 1 | 2 | 3;
  toastText: string | null;
  bestTimeTrialSec: number | null;
  ghostDeltaSec: number | null;
  bestSurvivalDistance: number | null;
  soloSessionKind: SoloSessionKind;
  tutorialProgress: TutorialProgressState;
  practiceBotsEnabled: boolean;
  cameraMode: CameraMode;
  sim: WorldSimulationState;
}

export interface RaftSceneOptions {
  container: HTMLElement;
  sound: SoundEngine;
  onHudUpdate: (hud: HudSnapshot) => void;
  onPowerBarUpdate: (power: number, farting: boolean) => void;
  onInputSend?: (moveDir: -1 | 0 | 1, farting: boolean, anchor?: boolean, useItem?: boolean) => void;
  onQuickEmote?: (emoteId: EmoteId) => void;
  onRunFinished?: (
    simSnapshot: WorldSimulationState,
    courseId: CourseId,
    soloSessionKind: SoloSessionKind,
    replay?: RoundReplayRecord | null,
  ) => void;
  onCameraPrefsChange?: (prefs: CameraPrefs) => void;
  initialCourseId?: CourseId;
  initialCameraPrefs?: CameraPrefs;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class RaftSceneManager {
  private container: HTMLElement;
  private sound: SoundEngine;
  private onHudUpdate: (hud: HudSnapshot) => void;
  private onPowerBarUpdate: (power: number, farting: boolean) => void;
  private onInputSend?: (moveDir: -1 | 0 | 1, farting: boolean, anchor?: boolean, useItem?: boolean) => void;
  private onQuickEmote?: (emoteId: EmoteId) => void;
  private onRunFinished?: (
    simSnapshot: WorldSimulationState,
    courseId: CourseId,
    soloSessionKind: SoloSessionKind,
    replay?: RoundReplayRecord | null,
  ) => void;
  private onCameraPrefsChange?: (prefs: CameraPrefs) => void;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private textures: ProceduralTextures;
  private currentCourseId: CourseId;
  private activeCourseKey: string;
  private activeCourseDef: CourseDefinition;
  private soloSessionKind: SoloSessionKind = 'normal';
  private tutorialProgress: TutorialProgressState = createInitialTutorialProgress(false);
  private practiceBotsEnabled = true;
  private cameraPrefs: CameraPrefs = { ...DEFAULT_CAMERA_PREFS };
  private currentCamRoll = 0;
  private courseHandles: CourseSceneHandles;
  private particles: ParticlePoolSystem;

  private raftModels: RaftModelHandles;
  private raftGroup: THREE.Group;
  private ghostRaftGroup: THREE.Group;
  private flagMesh: THREE.Mesh;
  private characterRigs: [CharacterRig, CharacterRig, CharacterRig, CharacterRig];

  private treasureMeshes = new Map<string, THREE.Group>();
  private currentTreasuresKey = '';
  private activeBestTtRecord: TimeTrialRecord | null = null;
  private recordedGhostFrames: GhostFrame[] = [];
  private nextGhostSampleTime = 0;
  private recordedReplayFrames: ReplayKeyframe[] = [];
  private recordedReplayEvents: ReplayEventEntry[] = [];
  private nextReplaySampleSec = 0;
  private minObservedRaftHp = 100;
  private currentSoloMatchId = '';
  private lastFinishedReplay: RoundReplayRecord | null = null;
  private activeBestSurvival: number | null = null;
  private survivalRecordSaved = false;
  private soloRunRecorded = false;

  private screenState: GameScreenState = 'title';
  private sim: WorldSimulationState;
  private serverTargetSim: WorldSimulationState | null = null;
  private serverSimTime = 0;
  private lastServerSnapshotAtMs = 0;
  private hasSyncedOnlineSimTime = false;
  private lastProcessedEventId = 0;
  private lastSnapshotSeq = 0;
  private mySlot: SeatSlotOrSpectator = 0;
  private isSpectator = false;
  private spectatorTarget: 'raft' | 0 | 1 | 2 | 3 = 'raft';
  private localEmoteSeq = 0;
  private emoteSeqSynced = [-1, -1, -1, -1];
  private reduceShake = false;
  private trauma = 0;

  // Input state
  private keysHeld = new Set<string>();
  private touchLeft = false;
  private touchRight = false;
  private touchFart = false;
  private touchAnchor = false;
  private pendingUseItem = false;

  // Loop & timers
  private frameId = 0;
  private lastTimeMs = performance.now();
  private lastHudPushMs = 0;
  private toastText: string | null = null;
  private toastTimer = 0;
  private fartEmitAccum = [0, 0, 0, 0];
  private wakeEmitAccum = 0;
  private leakEmitAccum = 0;
  private anchorDropVisual = 0;
  private disposed = false;

  private resizeObserver: ResizeObserver;

  constructor(opts: RaftSceneOptions) {
    this.container = opts.container;
    this.sound = opts.sound;
    this.onHudUpdate = opts.onHudUpdate;
    this.onPowerBarUpdate = opts.onPowerBarUpdate;
    this.onInputSend = opts.onInputSend;
    this.onQuickEmote = opts.onQuickEmote;
    this.onRunFinished = opts.onRunFinished;
    this.onCameraPrefsChange = opts.onCameraPrefsChange;
    this.currentCourseId = isValidCourseId(opts.initialCourseId) ? opts.initialCourseId : 'tropical';
    this.activeCourseKey = `normal:${this.currentCourseId}`;
    this.activeCourseDef = getCourseById(this.currentCourseId);
    if (opts.initialCameraPrefs) {
      this.cameraPrefs = normalizeCameraPrefs(opts.initialCameraPrefs);
    }

    const initialCourse = this.activeCourseDef;

    this.isSoftwareGl = detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);

    // Scene & Atmosphere driven by active course
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(initialCourse.meta.skyHorizonHex);
    this.scene.fog = new THREE.Fog(
      initialCourse.meta.fogColorHex,
      initialCourse.meta.fogNear,
      initialCourse.meta.fogFar,
    );

    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.2, 300);
    this.camera.position.set(6.5, 4.8, initialCourse.startZ + 10.5);
    _camLookSmooth.set(0, 1.3, initialCourse.startZ);
    this.camera.lookAt(_camLookSmooth);

    // Mandatory procedural RoomEnvironment for PBR realism
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 3-point atmospheric lighting rig
    this.hemiLight = new THREE.HemisphereLight(
      initialCourse.meta.hemiSkyHex,
      initialCourse.meta.hemiGroundHex,
      0.85,
    );
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(
      initialCourse.meta.keyLightHex,
      initialCourse.meta.keyLightIntensity,
    );
    this.keyLight.position.set(16, 28, 18);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 90;
    const d = 24;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(initialCourse.meta.rimLightHex, 0.5);
    this.rimLight.position.set(-14, 12, -20);
    this.scene.add(this.rimLight);

    // Build textures, active course, raft, characters, and pooled particles
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.courseHandles = createCourseScene(this.scene, this.textures, initialCourse);
    this.particles = new ParticlePoolSystem(this.scene);

    const raftModels = createRaftModel(this.textures);
    this.raftModels = raftModels;
    this.raftGroup = raftModels.raftGroup;
    this.flagMesh = raftModels.flagMesh;
    this.scene.add(this.raftGroup);

    this.ghostRaftGroup = createGhostRaftModel();
    this.ghostRaftGroup.visible = false;
    this.scene.add(this.ghostRaftGroup);

    this.sim = createInitialSimState('solo', undefined, undefined, this.currentCourseId);
    this.sim.phase = 'waiting';
    this.activeBestTtRecord = loadTimeTrialRecord(this.currentCourseId);
    this.activeBestSurvival = loadSurvivalBest(this.currentCourseId);

    this.characterRigs = [
      createCharacterRig(0, this.sim.players[0].cosmetic, this.textures),
      createCharacterRig(1, this.sim.players[1].cosmetic, this.textures),
      createCharacterRig(2, this.sim.players[2].cosmetic, this.textures),
      createCharacterRig(3, this.sim.players[3].cosmetic, this.textures),
    ];
    for (const rig of this.characterRigs) {
      this.raftGroup.add(rig.root);
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Bind listeners
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clearAllInputs);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.startLoop();
  }

  private clearTreasureMeshes(): void {
    for (const mesh of this.treasureMeshes.values()) {
      mesh.parent?.remove(mesh);
      mesh.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material.dispose();
          }
        }
      });
    }
    this.treasureMeshes.clear();
    this.currentTreasuresKey = '';
  }

  private syncTreasureMeshes(): void {
    const treasures = this.sim.treasures ?? [];
    const key = treasures.map((tr) => tr.id).join('|');
    if (key === this.currentTreasuresKey) return;
    this.clearTreasureMeshes();
    this.currentTreasuresKey = key;
    for (const tr of treasures) {
      const model = createTreasureModel(tr.kind);
      model.position.set(tr.x, 0, tr.z);
      model.visible = !tr.collected;
      this.courseHandles.worldChunksGroup.add(model);
      this.treasureMeshes.set(tr.id, model);
    }
  }

  private rebuildCourseWorld(
    courseId: CourseId,
    overrideCourse?: CourseDefinition,
    worldKey?: string,
  ): void {
    const targetId: CourseId = isValidCourseId(courseId) ? courseId : 'tropical';
    const nextKey = worldKey ?? `normal:${targetId}`;
    if (this.activeCourseKey === nextKey) return;

    this.currentCourseId = targetId;
    this.activeCourseKey = nextKey;
    const course = overrideCourse ?? getCourseById(targetId);
    this.activeCourseDef = course;

    this.clearTreasureMeshes();
    this.courseHandles.dispose();
    this.particles.clearAmbient();
    this.courseHandles = createCourseScene(this.scene, this.textures, course);

    this.scene.background = new THREE.Color(course.meta.skyHorizonHex);
    this.scene.fog = new THREE.Fog(course.meta.fogColorHex, course.meta.fogNear, course.meta.fogFar);
    this.hemiLight.color.setHex(course.meta.hemiSkyHex);
    this.hemiLight.groundColor.setHex(course.meta.hemiGroundHex);
    this.keyLight.color.setHex(course.meta.keyLightHex);
    this.keyLight.intensity = course.meta.keyLightIntensity;
    this.rimLight.color.setHex(course.meta.rimLightHex);

    this.activeBestTtRecord = loadTimeTrialRecord(targetId);
    this.activeBestSurvival = loadSurvivalBest(targetId);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
    this.pushHud(true);
  }

  public setPreviewCourse(courseId: CourseId): void {
    const valid = isValidCourseId(courseId) ? courseId : 'tropical';
    this.soloSessionKind = 'normal';
    this.tutorialProgress = createInitialTutorialProgress(false);
    this.rebuildCourseWorld(valid, undefined, `normal:${valid}`);
    if (this.screenState === 'title' || this.screenState === 'lobby') {
      const course = this.activeCourseDef;
      this.sim.courseId = valid;
      this.sim.raft.x = 0;
      this.sim.raft.z = course.startZ;
      this.courseHandles.worldChunksGroup.position.z = 0;
      this.courseHandles.finishGroup.visible = true;
      this.ghostRaftGroup.visible = false;
    }
    this.pushHud(true);
  }

  public setScreenState(next: GameScreenState): void {
    this.screenState = next;
    document.body.dataset.state = next;
    if (next === 'paused' || next === 'title' || next === 'gameover') {
      this.clearAllInputs();
      this.sound.stopAllFarts();
    }
    if (next === 'playing' && this.sim.mode === 'solo') {
      this.sim.phase = 'playing';
    } else if (next === 'paused' && this.sim.mode === 'solo') {
      this.sim.phase = 'paused';
    }
    this.pushHud(true);
  }

  public startSoloGame(
    playerName: string,
    cosmetic: PlayerCosmetic,
    fromUserGesture = true,
    courseId?: CourseId,
    settings?: Partial<RoomSettings> & { boatDamageEnabled?: boolean },
    accountMeta?: { accountId?: string; playerLevel?: number },
  ): void {
    if (fromUserGesture) {
      this.sound.unlock();
      this.sound.startMusic();
    }
    const targetCourse = isValidCourseId(courseId) ? courseId : this.currentCourseId;
    this.soloSessionKind = 'normal';
    this.tutorialProgress = createInitialTutorialProgress(false);
    this.practiceBotsEnabled = true;
    this.rebuildCourseWorld(targetCourse, undefined, `normal:${targetCourse}`);

    this.serverTargetSim = null;
    this.hasSyncedOnlineSimTime = false;
    this.lastProcessedEventId = 0;
    this.mySlot = 0;
    this.isSpectator = false;
    this.spectatorTarget = 'raft';
    this.emoteSeqSynced = [-1, -1, -1, -1];
    this.recordedGhostFrames = [];
    this.nextGhostSampleTime = 0;
    this.recordedReplayFrames = [];
    this.recordedReplayEvents = [];
    this.nextReplaySampleSec = 0;
    this.minObservedRaftHp = 100;
    this.currentSoloMatchId = `solo:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    this.lastFinishedReplay = null;
    this.survivalRecordSaved = false;
    this.soloRunRecorded = false;
    this.activeBestTtRecord = loadTimeTrialRecord(targetCourse);
    this.activeBestSurvival = loadSurvivalBest(targetCourse);

    this.sim = createInitialSimState('solo', playerName, cosmetic, targetCourse, settings);
    this.sim.boatDamageEnabled = settings?.boatDamageEnabled ?? true;
    if (accountMeta?.accountId) {
      this.sim.players[0].accountId = accountMeta.accountId;
    }
    if (typeof accountMeta?.playerLevel === 'number') {
      this.sim.players[0].playerLevel = accountMeta.playerLevel;
    }
    this.sim.phase = 'playing';
    this.courseHandles.worldChunksGroup.position.z = 0;
    this.courseHandles.finishGroup.visible = this.sim.gameMode !== 'survival';
    this.syncTreasureMeshes();

    const course = this.activeCourseDef;
    const modeToast: Record<string, string> = {
      time_trial: `⏱ سباق الزمن — حقق أسرع زمن في ${course.meta.nameAr}!`,
      survival: `🌊 وضع البقاء — اصمد لأطول مسافة ممكنة!`,
      treasure: `🪙 جمع الكنوز — اجمع العملات والصناديق!`,
      chaos: `🌀 وضع الفوضى — استعد للمفاجآت كل 10 ثوانٍ!`,
      standard: `انطلق في ${course.meta.nameAr}!`,
    };
    this.toastText = modeToast[this.sim.gameMode] ?? `انطلق في ${course.meta.nameAr}!`;
    this.toastTimer = 2.2;
    this.setScreenState('playing');
  }

  public startTutorialGame(
    playerName: string,
    cosmetic: PlayerCosmetic,
    fromUserGesture = true,
  ): void {
    if (fromUserGesture) {
      this.sound.unlock();
      this.sound.startMusic();
    }
    this.soloSessionKind = 'tutorial';
    this.tutorialProgress = createInitialTutorialProgress(true);
    this.practiceBotsEnabled = true;
    this.rebuildCourseWorld('tropical', COURSE_TUTORIAL, 'tutorial');

    this.serverTargetSim = null;
    this.hasSyncedOnlineSimTime = false;
    this.lastProcessedEventId = 0;
    this.mySlot = 0;
    this.isSpectator = false;
    this.spectatorTarget = 'raft';
    this.emoteSeqSynced = [-1, -1, -1, -1];
    this.recordedGhostFrames = [];
    this.nextGhostSampleTime = 0;
    this.survivalRecordSaved = false;
    this.soloRunRecorded = false;

    this.sim = createInitialSimState(
      'solo',
      playerName,
      cosmetic,
      'tropical',
      { gameMode: 'standard', difficulty: 'easy', enableItems: true, roundTimeLimitSec: 0 },
      COURSE_TUTORIAL,
    );
    this.sim.practiceMode = true;
    this.sim.infiniteSandbox = false;
    this.sim.phase = 'playing';
    this.courseHandles.worldChunksGroup.position.z = 0;
    this.courseHandles.finishGroup.visible = true;
    this.syncTreasureMeshes();

    this.toastText = '🎓 التدريب التفاعلي — اتبع التوجيهات خطوة بخطوة!';
    this.toastTimer = 2.8;
    this.setScreenState('playing');
  }

  public startPracticeArena(
    playerName: string,
    cosmetic: PlayerCosmetic,
    fromUserGesture = true,
    botsEnabled = true,
  ): void {
    if (fromUserGesture) {
      this.sound.unlock();
      this.sound.startMusic();
    }
    this.soloSessionKind = 'practice';
    this.tutorialProgress = createInitialTutorialProgress(false);
    this.practiceBotsEnabled = botsEnabled;
    this.rebuildCourseWorld('tropical', COURSE_PRACTICE, 'practice');

    this.serverTargetSim = null;
    this.hasSyncedOnlineSimTime = false;
    this.lastProcessedEventId = 0;
    this.mySlot = 0;
    this.isSpectator = false;
    this.spectatorTarget = 'raft';
    this.emoteSeqSynced = [-1, -1, -1, -1];
    this.recordedGhostFrames = [];
    this.nextGhostSampleTime = 0;
    this.survivalRecordSaved = false;
    this.soloRunRecorded = false;

    this.sim = createInitialSimState(
      'solo',
      playerName,
      cosmetic,
      'tropical',
      { gameMode: 'standard', difficulty: 'normal', enableItems: true, roundTimeLimitSec: 0 },
      COURSE_PRACTICE,
    );
    this.sim.practiceMode = true;
    this.sim.infiniteSandbox = true;
    for (let i = 1; i <= 3; i++) {
      this.sim.players[i].connected = botsEnabled;
    }
    this.sim.phase = 'playing';
    this.courseHandles.worldChunksGroup.position.z = 0;
    this.courseHandles.finishGroup.visible = false;
    this.syncTreasureMeshes();

    this.toastText = '🧪 ساحة التدريب الحرة — جرّب الدفع والعلب والمرساة بحرية!';
    this.toastTimer = 2.6;
    this.setScreenState('playing');
  }

  public resetPracticeRaft(): void {
    if (this.soloSessionKind !== 'practice') return;
    this.sim.raft.x = 0;
    this.sim.raft.y = 0;
    this.sim.raft.z = COURSE_PRACTICE.startZ;
    this.sim.raft.vx = 0;
    this.sim.raft.vz = 0;
    this.sim.raft.yaw = 0;
    this.sim.raft.omega = 0;
    this.sim.raft.pitch = 0;
    this.sim.raft.roll = 0;
    this.sim.raftHp = 100;
    this.respawnPracticePickups(false);
    this.showToast('📍 تم إعادة الطوف لمركز الساحة الحرة!', 1.8);
  }

  public respawnPracticePickups(notify = true): void {
    const defs = COURSE_PRACTICE.pickups ?? [];
    for (let i = 0; i < this.sim.pickups.length; i++) {
      const pk = this.sim.pickups[i];
      const def = defs[i];
      pk.collected = false;
      pk.respawnTimer = 0;
      if (def) {
        pk.x = def.x;
        pk.z = def.z;
      }
    }
    if (notify) {
      this.showToast('🎁 تم تجديد جميع العلب والأدوات!', 1.8);
    }
  }

  public togglePracticeBots(): void {
    if (this.soloSessionKind !== 'practice') return;
    this.practiceBotsEnabled = !this.practiceBotsEnabled;
    for (let i = 1; i <= 3; i++) {
      const bot = this.sim.players[i];
      bot.connected = this.practiceBotsEnabled;
      if (!this.practiceBotsEnabled) {
        bot.moveDir = 0;
        bot.farting = false;
        bot.fartHoldTime = 0;
        bot.fartPower = 0;
      }
    }
    this.showToast(
      this.practiceBotsEnabled
        ? '🤖 تم تفعيل الطاقم المساعد لتجربة التناغم!'
        : '👤 الوضع الفردي الخالص (بدون طاقم آلي)',
      2.0,
    );
  }

  public setCameraPrefs(prefs: CameraPrefs): void {
    this.cameraPrefs = normalizeCameraPrefs(prefs);
    this.pushHud(true);
  }

  public cycleCameraMode(): CameraMode {
    const nextMode = cycleCameraMode(this.cameraPrefs.mode);
    this.cameraPrefs = { ...this.cameraPrefs, mode: nextMode };
    this.onCameraPrefsChange?.(this.cameraPrefs);
    this.showToast(`📷 ${CAMERA_MODE_META[nextMode].labelAr}`, 1.8);
    return nextMode;
  }

  public syncLocalCosmetic(cosmetic: PlayerCosmetic): void {
    const slot = this.mySlot;
    if (slot !== -1) {
      this.sim.players[slot].cosmetic = { ...cosmetic };
    }
  }

  public setSpectatorMode(spectating: boolean, target?: 'raft' | 0 | 1 | 2 | 3): void {
    this.isSpectator = spectating;
    if (spectating) {
      this.mySlot = -1;
      this.clearAllInputs();
    }
    if (target !== undefined) {
      this.spectatorTarget = target;
    } else if (!spectating) {
      this.spectatorTarget = 'raft';
    }
    this.pushHud(true);
  }

  public setSpectatorTarget(target: 'raft' | 0 | 1 | 2 | 3): void {
    this.spectatorTarget = target;
    this.pushHud(true);
  }

  public showToast(text: string, duration = 2.4): void {
    this.toastText = text;
    this.toastTimer = duration;
    this.pushHud(true);
  }

  public triggerLocalEmote(emoteId: EmoteId): void {
    this.sound.unlock();
    this.sound.playEmote(emoteId);
    const def = getEmoteDefinition(emoteId);
    const expiresAtMs = performance.now() + def.durationMs;
    const slot = this.mySlot;
    if (this.isSpectator || slot === -1) {
      this.toastText = `${def.icon} (مشاهد) ${def.labelAr}`;
      this.toastTimer = 1.6;
      this.pushHud(true);
      return;
    }
    this.localEmoteSeq += 1;
    this.sim.players[slot].activeEmote = {
      id: emoteId,
      seq: this.localEmoteSeq,
      expiresAtMs,
    };
  }

  public handleRemoteEmote(ev: GameEmoteBroadcastPayload): void {
    this.sound.playEmote(ev.emoteId);
    const def = getEmoteDefinition(ev.emoteId);
    if (ev.slot === -1) {
      this.toastText = `${def.icon} ${ev.name} (مشاهد): ${def.labelAr}`;
      this.toastTimer = 1.8;
      this.pushHud(true);
      return;
    }
    if (ev.slot >= 0 && ev.slot <= 3) {
      this.localEmoteSeq += 1;
      this.sim.players[ev.slot].activeEmote = {
        id: ev.emoteId,
        seq: this.localEmoteSeq,
        expiresAtMs: performance.now() + ev.durationMs,
      };
    }
  }

  public setOnlineRoomState(
    snapshot: RoomSnapshot,
    mySlot: SeatSlotOrSpectator,
    isInitialJoin = false,
  ): void {
    if (!isInitialJoin && snapshot.snapshotSeq < this.lastSnapshotSeq) {
      return;
    }
    this.lastSnapshotSeq = snapshot.snapshotSeq;
    this.mySlot = mySlot;
    this.isSpectator = mySlot === -1;
    if (isInitialJoin) {
      this.spectatorTarget = 'raft';
      this.emoteSeqSynced = [-1, -1, -1, -1];
    }

    const remoteCourseId: CourseId = isValidCourseId(snapshot.sim.courseId)
      ? snapshot.sim.courseId
      : isValidCourseId(snapshot.courseId)
        ? snapshot.courseId
        : 'tropical';
    if (remoteCourseId !== this.currentCourseId) {
      this.rebuildCourseWorld(remoteCourseId);
    }

    this.serverTargetSim = snapshot.sim;
    this.serverSimTime = snapshot.sim.simTime;
    this.lastServerSnapshotAtMs = performance.now();
    this.sim.mode = 'online';
    this.sim.courseId = remoteCourseId;

    const prevFalls = this.sim.falls;
    const prevPhase = this.sim.phase;

    // Reset event cursor on initial join or host restart (when server eventSeq resets)
    if (isInitialJoin || snapshot.sim.eventSeq < this.lastProcessedEventId) {
      this.lastProcessedEventId = snapshot.sim.eventSeq;
    }

    // Sync simulation clock immediately on join/start/large drift so moving gates align with server
    if (
      isInitialJoin ||
      !this.hasSyncedOnlineSimTime ||
      (prevPhase === 'waiting' && snapshot.sim.phase === 'playing') ||
      Math.abs(this.sim.simTime - snapshot.sim.simTime) > 0.25
    ) {
      this.sim.simTime = snapshot.sim.simTime;
      this.hasSyncedOnlineSimTime = true;
    }

    // Copy player states & meta directly
    const perfNow = performance.now();
    for (let i = 0; i < 4; i++) {
      const sp = snapshot.sim.players[i];
      const lp = this.sim.players[i];
      lp.id = sp.id;
      lp.name = sp.name;
      lp.connected = sp.connected;
      lp.isBot = sp.isBot;
      lp.ready = sp.ready;
      lp.cosmetic = sp.cosmetic;
      lp.moveDir = sp.moveDir;
      lp.farting = sp.farting;
      lp.fartHoldTime = sp.fartHoldTime;
      lp.fartPower = sp.fartPower;
      lp.releaseBounce = sp.releaseBounce;
      lp.anchorRequested = sp.anchorRequested;
      lp.useItemRequested = sp.useItemRequested;
      lp.stats = sp.stats;

      if (sp.activeEmote && sp.activeEmote.expiresAtMs > snapshot.serverTime) {
        if (sp.activeEmote.seq !== this.emoteSeqSynced[i]) {
          this.emoteSeqSynced[i] = sp.activeEmote.seq;
          const remaining = Math.min(4500, Math.max(250, sp.activeEmote.expiresAtMs - snapshot.serverTime));
          this.localEmoteSeq += 1;
          lp.activeEmote = {
            id: sp.activeEmote.id,
            seq: this.localEmoteSeq,
            expiresAtMs: perfNow + remaining,
          };
        }
      }
    }

    this.sim.elapsedTime = snapshot.sim.elapsedTime;
    this.sim.gameMode = snapshot.sim.gameMode ?? snapshot.settings?.gameMode ?? 'standard';
    this.sim.difficulty = snapshot.sim.difficulty ?? snapshot.settings?.difficulty ?? 'normal';
    this.sim.enableItems = snapshot.sim.enableItems ?? snapshot.settings?.enableItems ?? true;
    this.sim.roundTimeLimitSec = snapshot.sim.roundTimeLimitSec ?? snapshot.settings?.roundTimeLimitSec ?? 0;
    this.sim.runOutcome = snapshot.sim.runOutcome ?? 'victory';
    this.sim.checkpointIndex = snapshot.sim.checkpointIndex;
    this.sim.falls = snapshot.sim.falls;
    this.sim.progress = snapshot.sim.progress;
    this.sim.invulnTimer = snapshot.sim.invulnTimer;
    this.sim.phase = snapshot.sim.phase;
    this.sim.dynamicZones = snapshot.sim.dynamicZones ?? [];
    this.sim.activeHazardTag = snapshot.sim.activeHazardTag ?? null;
    this.sim.pickups = snapshot.sim.pickups ?? [];
    this.sim.treasures = snapshot.sim.treasures ?? [];
    this.sim.treasureScore = snapshot.sim.treasureScore ?? 0;
    this.sim.coinsCollected = snapshot.sim.coinsCollected ?? 0;
    this.sim.totalCoins = snapshot.sim.totalCoins ?? this.sim.treasures.length;
    this.sim.survivalDistance = snapshot.sim.survivalDistance ?? 0;
    this.sim.survivalSpeedScale = snapshot.sim.survivalSpeedScale ?? 1;
    this.sim.chaosModifier = snapshot.sim.chaosModifier ?? 'none';
    this.sim.chaosTimer = snapshot.sim.chaosTimer ?? 0;
    this.sim.raftHp = snapshot.sim.raftHp ?? 100;
    this.sim.maxHp = snapshot.sim.maxHp ?? 100;
    this.sim.shieldHits = snapshot.sim.shieldHits ?? 0;
    this.sim.shieldTimer = snapshot.sim.shieldTimer ?? 0;
    this.sim.magnetTimer = snapshot.sim.magnetTimer ?? 0;
    this.sim.boostKind = snapshot.sim.boostKind ?? null;
    this.sim.boostTimer = snapshot.sim.boostTimer ?? 0;
    this.sim.boostMultiplier = snapshot.sim.boostMultiplier ?? 1;
    this.sim.heldItem = snapshot.sim.heldItem ?? null;
    this.sim.anchorActive = snapshot.sim.anchorActive ?? false;
    this.sim.anchorEnergy = snapshot.sim.anchorEnergy ?? 1;
    this.sim.anchorCooldown = snapshot.sim.anchorCooldown ?? 0;
    this.sim.harmony = snapshot.sim.harmony ?? 0;
    this.sim.superFartTimer = snapshot.sim.superFartTimer ?? 0;
    this.sim.harmonyComboCount = snapshot.sim.harmonyComboCount ?? 0;
    this.sim.windX = snapshot.sim.windX ?? 0;
    this.sim.windZ = snapshot.sim.windZ ?? 0;
    this.sim.lightningTimer = snapshot.sim.lightningTimer ?? 0;

    if (
      isInitialJoin ||
      (prevPhase !== 'playing' && snapshot.sim.phase === 'playing')
    ) {
      this.recordedGhostFrames = [];
      this.nextGhostSampleTime = 0;
      this.survivalRecordSaved = false;
      this.activeBestTtRecord = loadTimeTrialRecord(remoteCourseId);
      this.activeBestSurvival = loadSurvivalBest(remoteCourseId);
      this.courseHandles.worldChunksGroup.position.z = 0;
    }

    this.syncTreasureMeshes();

    // Snap raft immediately on join, respawn, start, or large reconnect jump
    const raftJumpDist = Math.hypot(
      snapshot.sim.raft.x - this.sim.raft.x,
      snapshot.sim.raft.z - this.sim.raft.z,
    );
    if (
      isInitialJoin ||
      snapshot.sim.falls > prevFalls ||
      (prevPhase !== 'playing' && snapshot.sim.phase === 'playing') ||
      raftJumpDist > 12
    ) {
      this.sim.raft = { ...snapshot.sim.raft };
    }

    if (snapshot.sim.events.length > 0) {
      this.processSimEvents(snapshot.sim.events);
    }

    if (snapshot.sim.phase === 'finished' && prevPhase !== 'finished') {
      this.sound.stopAllFarts();
      if (this.sim.gameMode === 'survival' && !this.survivalRecordSaved) {
        this.survivalRecordSaved = true;
        const saved = saveSurvivalBest(remoteCourseId, this.sim.survivalDistance);
        this.activeBestSurvival = saved.best;
      }
      this.setScreenState('gameover');
    } else if (
      (snapshot.sim.phase === 'playing' || snapshot.sim.phase === 'falling') &&
      (this.screenState === 'lobby' ||
        this.screenState === 'gameover' ||
        this.screenState === 'title' ||
        isInitialJoin)
    ) {
      this.sound.unlock();
      this.sound.startMusic();
      this.setScreenState('playing');
    } else if (
      snapshot.sim.phase === 'waiting' &&
      (this.screenState === 'gameover' ||
        this.screenState === 'playing' ||
        this.screenState === 'paused' ||
        (isInitialJoin && this.screenState === 'title'))
    ) {
      this.sound.stopAllFarts();
      this.setScreenState('lobby');
    }
  }

  public processDiscreteEvents(events: SimEvent[]): void {
    if (events.length > 0) {
      this.processSimEvents(events);
    }
  }

  public setReduceShake(reduce: boolean): void {
    this.reduceShake = reduce;
  }

  public setTouchInput(control: 'left' | 'right' | 'fart' | 'anchor' | 'useItem', pressed: boolean): void {
    if (this.isSpectator || this.mySlot < 0) return;
    this.sound.unlock();
    if (control === 'left') this.touchLeft = pressed;
    if (control === 'right') this.touchRight = pressed;
    if (control === 'fart') this.touchFart = pressed;
    if (control === 'anchor') this.touchAnchor = pressed;
    if (control === 'useItem' && pressed) this.pendingUseItem = true;
    this.applyLocalPlayerInput();
  }

  public clearAllInputs = (): void => {
    this.keysHeld.clear();
    this.touchLeft = false;
    this.touchRight = false;
    this.touchFart = false;
    this.touchAnchor = false;
    this.pendingUseItem = false;
    this.applyLocalPlayerInput();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.clearAllInputs();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (this.screenState !== 'playing') return;

    if (e.code === 'KeyC' && !e.repeat) {
      e.preventDefault();
      this.cycleCameraMode();
      return;
    }

    // Numeric keys 1..6 trigger character emotes cleanly (works for players & spectators)
    if (e.code.startsWith('Digit') && e.code.length === 6) {
      const idx = Number(e.code.charAt(5)) - 1;
      const emoteDef = EMOTE_DEFINITIONS[idx];
      if (emoteDef) {
        if (this.sim.mode === 'online' && this.onQuickEmote) {
          this.onQuickEmote(emoteDef.id);
        } else {
          this.triggerLocalEmote(emoteDef.id);
        }
        return;
      }
    }

    if (this.isSpectator || this.mySlot < 0) return;

    if (
      e.code === 'Space' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown'
    ) {
      e.preventDefault();
    }

    if (!this.keysHeld.has(e.code)) {
      this.keysHeld.add(e.code);
      if (e.code === 'KeyF') {
        this.pendingUseItem = true;
      }
      this.sound.unlock();
      this.applyLocalPlayerInput();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (this.keysHeld.has(e.code)) {
      this.keysHeld.delete(e.code);
      if (!this.isSpectator && this.mySlot >= 0) {
        this.applyLocalPlayerInput();
      }
    }
  };

  private applyLocalPlayerInput(): void {
    const slot = this.mySlot;
    if (this.isSpectator || slot === -1) return;

    if (this.screenState !== 'playing') {
      const p = this.sim.players[slot];
      if (p) {
        p.moveDir = 0;
        p.farting = false;
        p.anchorRequested = false;
        p.useItemRequested = false;
      }
      if (this.sim.mode === 'online' && this.onInputSend) {
        this.onInputSend(0, false, false, false);
      }
      return;
    }

    const left = this.keysHeld.has('ArrowLeft') || this.keysHeld.has('KeyA') || this.touchLeft;
    const right = this.keysHeld.has('ArrowRight') || this.keysHeld.has('KeyD') || this.touchRight;
    const farting = this.keysHeld.has('Space') || this.touchFart;
    const anchor =
      this.keysHeld.has('KeyE') ||
      this.keysHeld.has('ShiftLeft') ||
      this.keysHeld.has('ShiftRight') ||
      this.touchAnchor;
    const useItem = this.pendingUseItem;
    this.pendingUseItem = false;
    const moveDir: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;

    if (this.sim.mode === 'solo') {
      const p = this.sim.players[0];
      p.moveDir = moveDir;
      p.farting = farting;
      p.anchorRequested = anchor;
      if (useItem) {
        p.useItemRequested = true;
      }
    } else if (this.onInputSend) {
      this.onInputSend(moveDir, farting, anchor, useItem);
    }
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTimeMs) / 1000;
      this.lastTimeMs = now;
      const maxFrameDt = this.isSoftwareGl ? 0.16 : 0.08;
      const dt = Math.min(Math.max(rawDt, 0.001), maxFrameDt);

      this.update(dt, now);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private processSimEvents(events: SimEvent[]): void {
    const course = this.activeCourseDef;
    const voiceSlot = this.mySlot >= 0 ? this.mySlot : 0;
    for (const ev of events) {
      if (ev.id <= this.lastProcessedEventId) continue;
      this.lastProcessedEventId = ev.id;

      if (ev.type === 'collision') {
        this.sound.playCollision(ev.intensity);
        if (ev.intensity >= 0.45) {
          this.sound.playCharacterReaction('collision', voiceSlot);
        }
        this.trauma = Math.min(1, this.trauma + ev.intensity * 0.5);
        this.particles.spawnSplash(ev.x, 0.3, ev.z, 10, 0.85);
      } else if (ev.type === 'bumper') {
        this.sound.playBumper();
        this.sound.playCharacterReaction('collision', (voiceSlot + 1) % 4);
        this.trauma = Math.min(1, this.trauma + 0.65);
        this.particles.spawnSplash(ev.x, 0.4, ev.z, 16, 1.2);
      } else if (ev.type === 'checkpoint') {
        this.sound.playCheckpoint();
        this.sound.playCharacterReaction('victory', voiceSlot);
        this.toastText = `✓ تم حفظ النقطة ${this.sim.checkpointIndex}!`;
        this.toastTimer = 2.2;
      } else if (ev.type === 'hazard_hit') {
        this.sound.playHazardHit();
        this.sound.playCharacterReaction('fear', (voiceSlot + 1) % 4);
        this.trauma = Math.min(1, this.trauma + 0.72);
        const burstColor = course.id === 'volcanic' ? 0xff5500 : course.id === 'glacial' ? 0x90e0ef : 0xffb703;
        this.particles.spawnImpactBurst(ev.x, 0.4, ev.z, burstColor, 20, 1.35);
      } else if (ev.type === 'surface_crack') {
        this.sound.playSurfaceCrack();
        this.sound.playCharacterReaction('fear', (voiceSlot + 2) % 4);
        this.trauma = Math.min(1, this.trauma + 0.2);
      } else if (ev.type === 'surface_break') {
        this.sound.playSurfaceBreak();
        this.trauma = Math.min(1, this.trauma + 0.5);
        const shatterColor = course.id === 'glacial' ? 0xb8f5ff : 0x8d5524;
        this.particles.spawnImpactBurst(ev.x, 0.25, ev.z, shatterColor, 22, 1.4);
      } else if (ev.type === 'fall') {
        this.sound.playFall();
        this.sound.playCharacterReaction('fall', voiceSlot);
        this.sound.stopAllFarts();
        this.trauma = 0.85;
        this.particles.spawnImpactBurst(
          ev.x,
          0.2,
          ev.z,
          course.id === 'volcanic' ? 0xff5500 : 0xdcf9ff,
          26,
          1.45,
        );
        this.toastText = course.id === 'volcanic'
          ? '🔥 احذر الحمم! عودة لنقطة الحفظ...'
          : '💦 سقط الطوف! عودة لنقطة الحفظ...';
        this.toastTimer = 2.0;
      } else if (ev.type === 'pickup') {
        this.sound.playPickup(ev.pickupKind);
        this.sound.playCharacterReaction('powerup', voiceSlot);
        const burstMap: Record<string, number> = {
          lentil_can: 0xf59e0b,
          fava_can: 0x10b981,
          bean_can: 0xef4444,
          shield: 0x38bdf8,
          magnet: 0xf43f5e,
          shockwave: 0xfacc15,
          repair_kit: 0x22c55e,
          mystery_crate: 0xc084fc,
        };
        const toastMap: Record<string, string> = {
          lentil_can: '🥫 علبة عدس فاخرة! دفع صاروخي +65%!',
          fava_can: '🥫 علبة فول مدمس! دفع قوي +38%!',
          bean_can: '🥫 علبة فاصولياء! تعزيز سرعة +20%!',
          shield: '🛡️ درع طاقة نشط (يصد ضربتين)!',
          magnet: '🧲 مغناطيس! يجذب العلب والأدوات!',
          shockwave: '💥 موجة دفع جاهزة! اضغط [F] لإطلاقها!',
          repair_kit: '🧰 حقيبة إصلاح! +32% سلامة الطوف',
          mystery_crate: '📦 صندوق مفاجآت!',
        };
        const k = ev.pickupKind ?? 'mystery_crate';
        this.particles.spawnImpactBurst(ev.x, 0.7, ev.z, burstMap[k] ?? 0xffd13b, 18, 1.15);
        this.toastText = toastMap[k] ?? '🎁 عنصر جديد!';
        this.toastTimer = 2.1;
      } else if (ev.type === 'shield_block') {
        this.sound.playShieldBlock();
        this.trauma = Math.min(1, this.trauma + 0.3);
        this.particles.spawnImpactBurst(ev.x, 0.8, ev.z, 0x38bdf8, 18, 1.2);
        this.toastText = '🛡️ الدرع امتص الصدمة!';
        this.toastTimer = 1.6;
      } else if (ev.type === 'shield_break') {
        this.sound.playShieldBreak();
        this.sound.playCharacterReaction('fear', voiceSlot);
        this.trauma = Math.min(1, this.trauma + 0.45);
        this.particles.spawnImpactBurst(ev.x, 0.8, ev.z, 0x7dd3fc, 24, 1.35);
        this.toastText = '🛡️ تحطم الدرع!';
        this.toastTimer = 1.6;
      } else if (ev.type === 'repair') {
        this.sound.playRepair();
        this.particles.spawnImpactBurst(ev.x, 0.8, ev.z, 0x22c55e, 16, 1.0);
        this.toastText = '🔧 تم إصلاح الطوف!';
        this.toastTimer = 1.8;
      } else if (ev.type === 'super_fart') {
        this.sound.playSuperFart();
        this.sound.playCharacterReaction('powerup', (voiceSlot + 2) % 4);
        this.trauma = Math.min(1, this.trauma + 0.45);
        this.particles.spawnImpactBurst(ev.x, 0.8, ev.z, 0xfacc15, 24, 1.4);
        this.toastText = '⚡💨 نفخة التناغم الخارقة!!';
        this.toastTimer = 2.0;
      } else if (ev.type === 'anchor_drop') {
        this.sound.playAnchor(true);
        this.sound.playCharacterReaction('anchor', voiceSlot);
        this.particles.spawnSplash(ev.x, 0.25, ev.z, 10, 0.9);
      } else if (ev.type === 'anchor_raise') {
        this.sound.playAnchor(false);
      } else if (ev.type === 'shockwave') {
        this.sound.playShockwave();
        this.sound.playCharacterReaction('powerup', voiceSlot);
        this.trauma = Math.min(1, this.trauma + 0.55);
        this.particles.spawnImpactBurst(ev.x, 0.6, ev.z, 0xfacc15, 28, 1.6);
        this.toastText = '💥 موجة دفع بحرية!';
        this.toastTimer = 1.8;
      } else if (ev.type === 'lightning') {
        this.sound.playLightning();
        this.sound.playCharacterReaction('fear', (voiceSlot + 3) % 4);
        if (this.courseHandles.lightningLight) {
          this.courseHandles.lightningLight.position.set(this.sim.raft.x + 12, 38, this.sim.raft.z - 25);
        }
      } else if (ev.type === 'hull_critical') {
        this.sound.playCharacterReaction('fear', voiceSlot);
        this.trauma = Math.min(1, this.trauma + 0.4);
        this.toastText = '⚠️ هيكل الطوف حرج! ابحث عن حقيبة إصلاح!';
        this.toastTimer = 2.2;
      } else if (ev.type === 'coin') {
        const isChest = ev.intensity > 1.2;
        this.sound.playCoin(isChest);
        this.particles.spawnImpactBurst(
          ev.x,
          0.9,
          ev.z,
          isChest ? 0xf59e0b : 0xfacc15,
          isChest ? 22 : 11,
          isChest ? 1.25 : 0.95,
        );
        if (isChest) {
          this.toastText = '💎 صندوق كنز نادر (+50 نقطة)!';
          this.toastTimer = 1.6;
        }
      } else if (ev.type === 'chaos_shift') {
        this.sound.playChaosShift();
        this.trauma = Math.min(1, this.trauma + 0.32);
        this.particles.spawnImpactBurst(ev.x, 1.0, ev.z, 0xc084fc, 22, 1.35);
      } else if (ev.type === 'time_expired') {
        this.sound.stopAllFarts();
        this.sound.playFall();
        this.sound.playCharacterReaction('fear', voiceSlot);
        this.toastText = '⏰ انتهى وقت الجولة!';
        this.toastTimer = 2.4;
      } else if (ev.type === 'finish') {
        this.sound.stopAllFarts();
        if (this.sim.runOutcome === 'defeat') {
          this.sound.playFall();
        } else {
          this.sound.playVictory();
          this.sound.playCharacterReaction('victory', voiceSlot);
          if (this.sim.gameMode === 'time_trial' && this.soloSessionKind === 'normal') {
            const saved = saveTimeTrialRecord(
              this.currentCourseId,
              this.sim.elapsedTime,
              this.recordedGhostFrames,
            );
            this.activeBestTtRecord = saved.record;
            if (saved.isNewBest) {
              this.toastText = '🏆 رقم قياسي جديد في سباق الزمن!';
              this.toastTimer = 2.4;
            }
          }
        }
      }

      if (
        this.sim.mode === 'solo' &&
        this.soloSessionKind === 'normal' &&
        this.recordedReplayEvents.length < 160 &&
        (ev.type === 'checkpoint' ||
          ev.type === 'fall' ||
          ev.type === 'pickup' ||
          ev.type === 'super_fart' ||
          ev.type === 'shockwave' ||
          ev.type === 'chaos_shift' ||
          ev.type === 'lightning' ||
          ev.type === 'shield_break' ||
          ev.type === 'finish')
      ) {
        this.recordedReplayEvents.push({
          t: Number(this.sim.elapsedTime.toFixed(2)),
          type: ev.type,
          x: Number(ev.x.toFixed(2)),
          z: Number(ev.z.toFixed(2)),
          intensity: Number(ev.intensity.toFixed(2)),
          ...(ev.slot !== undefined ? { slot: ev.slot } : {}),
        });
      }
    }
  }

  private update(dt: number, nowMs: number): void {
    const course = this.activeCourseDef;

    // 1. Advance simulation or interpolate server snapshot
    if (this.screenState === 'playing') {
      if (this.sim.mode === 'solo') {
        const enableBots = this.soloSessionKind === 'practice' ? this.practiceBotsEnabled : true;
        let remaining = dt;
        let advancedTutorialStep = false;
        while (remaining > 0.0001) {
          const stepDt = Math.min(remaining, 0.05);
          remaining -= stepDt;
          const events = stepSimulation(this.sim, stepDt, course, { enableBots });
          if (events.length > 0) this.processSimEvents(events);

          if (this.soloSessionKind === 'tutorial') {
            const evalRes = evaluateTutorialStep(this.tutorialProgress, this.sim, stepDt);
            this.tutorialProgress = evalRes.progress;
            if (evalRes.stepJustCompleted && !evalRes.tutorialJustFinished) {
              advancedTutorialStep = true;
            }
          }
          if (this.soloSessionKind === 'normal') {
            this.minObservedRaftHp = Math.min(this.minObservedRaftHp, this.sim.raftHp ?? 100);
            if (
              (this.sim.phase === 'playing' || this.sim.phase === 'falling') &&
              this.sim.elapsedTime >= this.nextReplaySampleSec &&
              this.recordedReplayFrames.length < 480
            ) {
              this.nextReplaySampleSec += 0.5;
              this.recordedReplayFrames.push({
                t: Number(this.sim.elapsedTime.toFixed(2)),
                x: Number(this.sim.raft.x.toFixed(2)),
                z: Number(this.sim.raft.z.toFixed(2)),
                yaw: Number(this.sim.raft.yaw.toFixed(3)),
                progress: Number((this.sim.progress ?? 0).toFixed(3)),
                raftHp: Math.round(this.sim.raftHp ?? 100),
                harmony: Number((this.sim.harmony ?? 0).toFixed(2)),
                windX: Number((this.sim.windX ?? 0).toFixed(2)),
              });
            }
          }

          if (this.sim.phase === 'finished') break;
        }

        if (advancedTutorialStep) {
          this.sound.playCheckpoint();
          const nextDef = TUTORIAL_STEPS[this.tutorialProgress.stepIndex];
          if (nextDef) {
            this.toastText = `✅ أحسنت! الخطوة التالية: ${nextDef.titleAr}`;
            this.toastTimer = 2.4;
          }
          this.pushHud(true, nowMs);
        }

        if (
          this.soloSessionKind === 'normal' &&
          this.sim.gameMode === 'time_trial' &&
          this.sim.phase === 'playing' &&
          this.sim.elapsedTime >= this.nextGhostSampleTime
        ) {
          this.nextGhostSampleTime += 0.15;
          this.recordedGhostFrames.push({
            t: Number(this.sim.elapsedTime.toFixed(2)),
            x: Number(this.sim.raft.x.toFixed(2)),
            y: Number(this.sim.raft.y.toFixed(2)),
            z: Number(this.sim.raft.z.toFixed(2)),
            yaw: Number(this.sim.raft.yaw.toFixed(3)),
          });
        }

        if (this.sim.phase === 'finished') {
          if (this.soloSessionKind === 'normal' && this.sim.gameMode === 'survival' && !this.survivalRecordSaved) {
            this.survivalRecordSaved = true;
            const saved = saveSurvivalBest(this.currentCourseId, this.sim.survivalDistance);
            this.activeBestSurvival = saved.best;
          }
          if (this.soloSessionKind === 'normal' && !this.lastFinishedReplay) {
            if (this.recordedReplayFrames.length < 480) {
              this.recordedReplayFrames.push({
                t: Number(this.sim.elapsedTime.toFixed(2)),
                x: Number(this.sim.raft.x.toFixed(2)),
                z: Number(this.sim.raft.z.toFixed(2)),
                yaw: Number(this.sim.raft.yaw.toFixed(3)),
                progress: Number((this.sim.progress ?? 0).toFixed(3)),
                raftHp: Math.round(this.sim.raftHp ?? 100),
                harmony: Number((this.sim.harmony ?? 0).toFixed(2)),
                windX: Number((this.sim.windX ?? 0).toFixed(2)),
              });
            }
            this.lastFinishedReplay = {
              matchId: this.currentSoloMatchId || `solo:${Date.now()}`,
              roomCode: null,
              mode: 'solo',
              courseId: this.currentCourseId,
              gameMode: this.sim.gameMode ?? 'standard',
              difficulty: this.sim.difficulty ?? 'normal',
              botDifficulty: this.sim.botDifficulty ?? 'normal',
              outcome: this.sim.runOutcome ?? 'victory',
              durationSec: Number(this.sim.elapsedTime.toFixed(2)),
              falls: this.sim.falls,
              treasureScore: this.sim.treasureScore ?? 0,
              survivalDistance: Math.round(this.sim.survivalDistance ?? 0),
              minRaftHp: Math.round(this.minObservedRaftHp),
              createdAt: Date.now(),
              players: this.sim.players.map((p) => ({
                slot: p.slot,
                name: p.name,
                isBot: p.isBot,
                ...(p.botPersonality ? { botPersonality: p.botPersonality } : {}),
                ...(p.tempBotSubstitute ? { wasTempSubstitute: true } : {}),
                colorIndex: p.cosmetic.colorIndex,
                pushContribution: Math.round(p.stats.pushImpulseSum ?? p.stats.totalFartTime * 15),
              })),
              frames: [...this.recordedReplayFrames],
              events: [...this.recordedReplayEvents],
            };
          }
          if (!this.soloRunRecorded) {
            this.soloRunRecorded = true;
            this.onRunFinished?.(
              {
                ...this.sim,
                players: this.sim.players.map((p) => ({ ...p, stats: { ...p.stats } })) as WorldSimulationState['players'],
              },
              this.currentCourseId,
              this.soloSessionKind,
              this.lastFinishedReplay,
            );
          }
          this.setScreenState('gameover');
        }
      } else if (this.serverTargetSim) {
        const k = 1 - Math.exp(-16 * dt);
        const sr = this.serverTargetSim.raft;
        const lr = this.sim.raft;
        lr.x += (sr.x - lr.x) * k;
        lr.y += (sr.y - lr.y) * k;
        lr.z += (sr.z - lr.z) * k;
        lr.vx = sr.vx;
        lr.vz = sr.vz;
        let dyaw = sr.yaw - lr.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        lr.yaw += dyaw * k;
        lr.pitch += (sr.pitch - lr.pitch) * k;
        lr.roll += (sr.roll - lr.roll) * k;

        for (let i = 0; i < 4; i++) {
          this.sim.players[i].localX +=
            (this.serverTargetSim.players[i].localX - this.sim.players[i].localX) * k;
          this.sim.players[i].lateralVel = this.serverTargetSim.players[i].lateralVel;
        }
        this.sim.simTime += dt;
        const elapsedSinceSnapshot = Math.min(0.15, Math.max(0, (nowMs - this.lastServerSnapshotAtMs) / 1000));
        const targetServerSimTime = this.serverSimTime + elapsedSinceSnapshot;
        this.sim.simTime += (targetServerSimTime - this.sim.simTime) * Math.min(1, 10 * dt);
      }
    } else if (this.screenState === 'title' || this.screenState === 'lobby') {
      this.sim.simTime += dt;
      this.sim.raft.y = Math.sin(this.sim.simTime * 1.9) * 0.11;
      this.sim.raft.roll = Math.sin(this.sim.simTime * 1.3) * 0.035;
      this.sim.raft.pitch = Math.cos(this.sim.simTime * 1.5) * 0.025;
    }

    const t = this.sim.simTime;
    const isSurvival = this.sim.gameMode === 'survival';
    const loopSpan = getCourseLoopSpan(course);
    const survivalLap =
      isSurvival && this.screenState === 'playing'
        ? Math.floor(Math.max(0, course.startZ - this.sim.raft.z) / loopSpan)
        : 0;
    this.courseHandles.worldChunksGroup.position.z = -survivalLap * loopSpan;
    this.courseHandles.finishGroup.visible = !isSurvival;
    this.courseHandles.waterMesh.position.z = isSurvival
      ? this.sim.raft.z - 20
      : course.finishZ * 0.5 - 10;

    // Ghost Raft Playback for Time Trial (MODE-01)
    if (
      this.screenState === 'playing' &&
      this.sim.gameMode === 'time_trial' &&
      this.activeBestTtRecord &&
      this.activeBestTtRecord.frames.length > 0
    ) {
      const gPose = sampleGhostPose(this.activeBestTtRecord.frames, this.sim.elapsedTime);
      if (gPose) {
        this.ghostRaftGroup.visible = true;
        this.ghostRaftGroup.position.set(gPose.x, gPose.y + 0.05, gPose.z);
        this.ghostRaftGroup.rotation.set(0, gPose.yaw, 0);
      }
    } else {
      this.ghostRaftGroup.visible = false;
    }

    // Chaos 'ghost_obstacles' visual phasing
    const isGhostObstacles = this.sim.chaosModifier === 'ghost_obstacles';
    const obsScale = isGhostObstacles ? 0.28 + 0.08 * Math.sin(t * 9) : 1.0;
    for (const obsGrp of this.courseHandles.staticObstacleGroups) {
      obsGrp.visible = !isGhostObstacles || Math.floor(t * 10) % 2 === 0;
      obsGrp.scale.setScalar(obsScale);
    }

    this.courseHandles.waterUniforms.uTime.value = t;
    this.textures.conveyorMap.offset.y = -(t * 1.2) % 1;

    // 2. Animate moving gates, hydraulic pistons, gears, falling hazards, dynamic zones, wind fans, checkpoints
    const gateTimeScale =
      isGhostObstacles
        ? 1.35
        : isSurvival
          ? Math.min(1.6, this.sim.survivalSpeedScale || 1)
          : 1.0;
    for (const gate of course.movingGates) {
      const mesh = this.courseHandles.movingGateMeshes.get(gate.id);
      if (mesh) {
        const tf = getMovingGateTransform(gate, t * gateTimeScale);
        mesh.position.set(tf.x, tf.y, tf.z);
        const glowMat = this.courseHandles.pistonGlowMats.get(gate.id);
        if (glowMat) {
          glowMat.emissiveIntensity = 0.25 + tf.warningPulse * 1.8;
        }
      }
    }

    for (const part of this.courseHandles.spinningGearParts) {
      part.mesh.rotation.z += dt * part.speed;
    }

    for (const b of this.courseHandles.bumperMeshes) {
      b.rotation.y += dt * 1.4;
      b.position.y = Math.sin(t * 3 + b.position.z) * 0.12;
    }

    for (const pad of this.courseHandles.boostMeshes) {
      pad.scale.setScalar(1 + Math.sin(t * 5) * 0.07);
    }

    for (const ring of this.courseHandles.heatRingMeshes) {
      const pulse = 0.92 + Math.sin(t * 5.2 + ring.position.z) * 0.1;
      ring.scale.setScalar(pulse);
    }

    for (const ribbon of this.courseHandles.waterfallRibbons) {
      ribbon.scale.x = 0.94 + Math.sin(t * 7 + ribbon.position.z) * 0.08;
    }

    for (const wz of course.windZones) {
      const active = isWindZoneActive(wz, t);
      const fanBlades = this.courseHandles.windFanBlades.get(wz.id);
      if (fanBlades) {
        fanBlades.rotation.x += dt * (active ? 11.5 : 1.4);
      }
      const streamMesh = this.courseHandles.windStreamMeshes.get(wz.id);
      if (streamMesh) {
        streamMesh.visible = active;
        if (active) {
          streamMesh.position.x = wz.x + Math.sin(t * 10) * 0.8;
        }
      }
    }

    for (const fh of course.fallingHazards) {
      const cycle = getFallingHazardCycle(fh, t);
      const rockMesh = this.courseHandles.fallingRockMeshes.get(fh.id);
      if (rockMesh) {
        rockMesh.position.y = cycle.heightY;
        rockMesh.rotation.x += dt * 2.2;
        rockMesh.rotation.y += dt * 1.6;
        rockMesh.visible = cycle.inWarning || cycle.cycleU < 0.12;
      }
      const ringMesh = this.courseHandles.fallingRingMeshes.get(fh.id);
      if (ringMesh) {
        ringMesh.visible = cycle.inWarning;
        const ringMat = ringMesh.material as THREE.MeshBasicMaterial;
        if (cycle.inWarning) {
          const urgency = 1 - cycle.timeUntilImpact / fh.warningDuration;
          ringMat.opacity = 0.25 + 0.65 * Math.abs(Math.sin(t * 14));
          ringMesh.scale.setScalar(0.55 + urgency * 0.55);
        }
      }
    }

    for (const dz of course.dynamicZones) {
      const vis = this.courseHandles.dynamicZoneMeshes.get(dz.id);
      if (!vis) continue;
      const state = this.sim.dynamicZones.find((s) => s.id === dz.id);
      if (!state || state.status === 'intact') {
        vis.group.visible = true;
        vis.group.position.set(vis.baseX, vis.baseY, vis.baseZ);
        vis.mat.emissiveIntensity = 0.15;
      } else if (state.status === 'cracking') {
        vis.group.visible = true;
        vis.group.position.set(
          vis.baseX + Math.sin(t * 48) * 0.14,
          vis.baseY - 0.05,
          vis.baseZ + Math.cos(t * 42) * 0.1,
        );
        vis.mat.emissiveIntensity = 0.8 + 0.5 * Math.sin(t * 20);
      } else {
        // broken
        vis.group.visible = false;
      }
    }

    for (const [idx, flag] of this.courseHandles.checkpointFlags.entries()) {
      const captured = this.sim.checkpointIndex >= idx;
      const targetY = captured ? 5.3 : 2.2;
      flag.position.y += (targetY - flag.position.y) * Math.min(1, 6 * dt);
      const mat = flag.material as THREE.MeshStandardMaterial;
      mat.color.setHex(captured ? 0x06d6a0 : 0xff595e);
    }

    // 2b. Animate Pickups & Treasures (floating, spinning, magnet-pulled positions, collected hide)
    for (const pk of this.sim.pickups ?? []) {
      const mesh = this.courseHandles.pickupMeshes.get(pk.id);
      if (!mesh) continue;
      mesh.visible = !pk.collected;
      if (!pk.collected) {
        const bob = Math.sin(t * 3.2 + pk.z * 0.25) * 0.16;
        mesh.position.x += (pk.x - mesh.position.x) * Math.min(1, 16 * dt);
        mesh.position.z += (pk.z - mesh.position.z) * Math.min(1, 16 * dt);
        mesh.position.y = bob;
        mesh.rotation.y = t * 1.45 + pk.x * 0.2;
      }
    }

    for (const tr of this.sim.treasures ?? []) {
      const mesh = this.treasureMeshes.get(tr.id);
      if (!mesh) continue;
      mesh.visible = !tr.collected;
      if (!tr.collected) {
        const bob = Math.sin(t * 3.8 + tr.z * 0.3) * 0.18;
        mesh.position.x += (tr.x - mesh.position.x) * Math.min(1, 16 * dt);
        mesh.position.z += (tr.z - mesh.position.z) * Math.min(1, 16 * dt);
        mesh.position.y = bob;
        mesh.rotation.y = t * (tr.kind === 'coin' ? 2.6 : 1.05);
      }
    }

    // 2c. Storm Lighthouses & Lightning Flash
    for (const beacon of this.courseHandles.lighthouseBeacons) {
      beacon.rotation.y += dt * 1.65;
    }
    if (this.courseHandles.lightningLight) {
      const lTimer = this.sim.lightningTimer ?? 0;
      if (lTimer > 0) {
        const pulse = Math.sin(lTimer * 42) > 0 ? 1 : 0.35;
        this.courseHandles.lightningLight.intensity = 18 * pulse * Math.min(1, lTimer * 3.5);
        this.scene.background = new THREE.Color(0x527499).lerp(
          new THREE.Color(course.meta.skyHorizonHex),
          1 - pulse * 0.65,
        );
      } else {
        this.courseHandles.lightningLight.intensity = 0;
        (this.scene.background as THREE.Color).setHex(course.meta.skyHorizonHex);
      }
    }

    // 3. Apply Raft transform, spawn protection blink, hull damage visuals, shield, magnet & anchor
    const raft = this.sim.raft;
    const waveBob = this.screenState === 'playing' && this.sim.phase !== 'falling'
      ? Math.sin(t * 3.1) * 0.07 * (course.meta.waveAmplitude ?? 1)
      : 0;
    this.raftGroup.position.set(raft.x, raft.y + waveBob, raft.z);
    _raftEuler.set(raft.pitch, raft.yaw, raft.roll, 'YXZ');
    _raftQuat.setFromEuler(_raftEuler);
    this.raftGroup.quaternion.copy(_raftQuat);

    this.flagMesh.rotation.y = -Math.PI * 0.5 + Math.sin(t * 9) * 0.18;
    if (this.sim.invulnTimer > 0) {
      this.raftGroup.visible = Math.floor(this.sim.invulnTimer * 14) % 2 === 0;
    } else {
      this.raftGroup.visible = true;
    }

    // Apply equipped Raft Skin (local player's skin in solo/online, or host's skin for spectators)
    const skinOwner = this.mySlot !== -1 ? this.sim.players[this.mySlot] : this.sim.players[0];
    applyRaftSkin(this.raftModels, skinOwner?.cosmetic?.raftSkin);

    // Progressive Hull Damage Visuals (GAME-05) preserving skin tint
    const hpRatio = Math.max(0, Math.min(1, (this.sim.raftHp ?? 100) / (this.sim.maxHp || 100)));
    const dmgScale = 0.48 + hpRatio * 0.52;
    this.raftModels.deckMat.color.copy(this.raftModels.baseDeckColor).multiplyScalar(dmgScale);
    this.raftModels.deckPlanks.forEach((plank, idx) => {
      if (hpRatio < 0.6) {
        const dmg = (0.6 - hpRatio) / 0.6;
        plank.rotation.z = (idx % 2 === 0 ? 1 : -1) * dmg * 0.06;
        plank.rotation.x = (idx % 3 === 0 ? 1 : -1) * dmg * 0.04;
      } else {
        plank.rotation.set(0, 0, 0);
      }
    });
    if (this.screenState === 'playing' && hpRatio < 0.42 && this.sim.phase !== 'falling') {
      this.leakEmitAccum += dt;
      if (this.leakEmitAccum >= 0.12) {
        this.leakEmitAccum = 0;
        _worldPos.set((Math.random() - 0.5) * 3.8, 0.55, (Math.random() - 0.5) * 3.8);
        this.raftGroup.localToWorld(_worldPos);
        this.particles.spawnSplash(_worldPos.x, _worldPos.y, _worldPos.z, 2, 0.5);
      }
    }

    // Shield Dome Visual (GAME-02)
    const shieldActive = (this.sim.shieldHits ?? 0) > 0 && (this.sim.shieldTimer ?? 0) > 0;
    this.raftModels.shieldDome.visible = shieldActive;
    if (shieldActive) {
      const pulse = 1 + Math.sin(t * 6.5) * 0.025;
      this.raftModels.shieldDome.scale.set(pulse, 0.72 * pulse, 1.05 * pulse);
      this.textures.shieldHexMap.offset.y = (t * 0.35) % 1;
    }

    // Magnet Aura Visual (GAME-01)
    const magActive = (this.sim.magnetTimer ?? 0) > 0;
    this.raftModels.magnetRing.visible = magActive;
    if (magActive) {
      const mScale = 0.85 + Math.sin(t * 8) * 0.15;
      this.raftModels.magnetRing.scale.setScalar(mScale);
      this.raftModels.magnetRing.rotation.z = t * 2.5;
    }

    // Bow Anchor Chain & Cast-Iron Drop Animation (GAME-03)
    const targetAnchorDrop = this.sim.anchorActive ? 1 : 0;
    this.anchorDropVisual += (targetAnchorDrop - this.anchorDropVisual) * Math.min(1, 10 * dt);
    const chainLen = 0.25 + this.anchorDropVisual * 2.35;
    this.raftModels.anchorChain.scale.set(1, chainLen, 1);
    this.raftModels.anchorChain.position.y = -chainLen * 0.5;
    this.raftModels.anchorIronGroup.position.y = -0.35 - this.anchorDropVisual * 2.1;
    this.raftModels.anchorIronGroup.rotation.z = Math.sin(t * 3.5) * 0.08 * this.anchorDropVisual;

    // Move keyLight shadow frustum with raft
    this.keyLight.position.set(raft.x + 16, 28, raft.z + 18);
    this.keyLight.target.position.set(raft.x, 0, raft.z - 8);
    this.keyLight.target.updateMatrixWorld();

    // 4. Animate all 4 characters + expire emotes + emit pooled fart puffs + update Web Audio
    const isFalling = this.sim.phase === 'falling';
    const isSuperFart = (this.sim.superFartTimer ?? 0) > 0;
    for (let i = 0; i < 4; i++) {
      const player = this.sim.players[i];
      if (player.activeEmote && nowMs >= player.activeEmote.expiresAtMs) {
        player.activeEmote = null;
      }
      const rig = this.characterRigs[i];
      animateCharacterRig(rig, player, t, isFalling, dt);

      if (this.screenState === 'playing') {
        this.sound.updateFartVoice(i, player.connected && player.farting && !isFalling, player.fartPower);
      }

      if (player.connected && player.fartPower > 0.05 && !isFalling) {
        const rate = 0.095 - player.fartPower * 0.068;
        this.fartEmitAccum[i] += dt;
        if (this.fartEmitAccum[i] >= rate) {
          this.fartEmitAccum[i] = 0;
          const zone = PLAYER_ZONES[player.slot];
          _worldPos.set(player.localX, 1.15, zone.zoneZ + 0.65);
          this.raftGroup.localToWorld(_worldPos);
          _backDir.set(Math.sin(raft.yaw), 0, Math.cos(raft.yaw));
          this.particles.spawnFartPuff(
            _worldPos.x,
            _worldPos.y,
            _worldPos.z,
            _backDir.x,
            _backDir.z,
            player.fartPower,
            isSuperFart,
            player.cosmetic.trail,
          );
        }
      }
    }

    // Wake foam behind moving raft
    const raftSpeed = Math.hypot(raft.vx, raft.vz);
    if (this.screenState === 'playing' && raftSpeed > 2.2 && !isFalling) {
      this.wakeEmitAccum += dt;
      if (this.wakeEmitAccum >= 0.09) {
        this.wakeEmitAccum = 0;
        _worldPos.set((Math.random() - 0.5) * 3.6, 0.15, 3.3);
        this.raftGroup.localToWorld(_worldPos);
        if (course.id === 'volcanic') {
          this.particles.spawnImpactBurst(_worldPos.x, 0.12, _worldPos.z, 0xff6b00, 2, 0.45);
        } else {
          this.particles.spawnSplash(_worldPos.x, 0.1, _worldPos.z, 2, 0.45);
        }
      }
    }

    this.particles.updateAmbientWeather(
      course.meta.ambientParticles,
      raft.x,
      raft.z,
      dt,
      this.sim.windX ?? 0,
      this.sim.windZ ?? 0,
    );
    this.particles.update(dt);

    // 5. Update 60fps direct power meter DOM callback
    const slot = this.mySlot;
    const me = slot !== -1 ? this.sim.players[slot] : null;
    if (me) {
      this.onPowerBarUpdate(me.fartPower, me.farting);
    } else {
      this.onPowerBarUpdate(0, false);
    }

    // 6. Camera framing (UX-04: Follow / Wide / Dynamic + Distance & Angle) & exponential damping
    const camMode = this.cameraPrefs.mode;
    const distScale = this.cameraPrefs.distanceScale;
    const angleRad = (this.cameraPrefs.angleDeg * Math.PI) / 180;
    const isBoosting = isSuperFart || (this.sim.boostTimer ?? 0) > 0;

    const portraitAspect = this.camera.aspect < 0.85;
    const portraitFovBoost = portraitAspect ? (0.85 - this.camera.aspect) * 18 : 0;

    let baseFov = 56;
    let dampRate = 6.5;
    let targetCamRoll = 0;
    if (camMode === 'wide') {
      baseFov = 64;
      dampRate = 5.4;
    } else if (camMode === 'dynamic') {
      baseFov = 59 + Math.min(7, raftSpeed * 0.35);
      dampRate = 8.6;
      targetCamRoll = clamp(-raft.omega * 0.055 + raft.roll * 0.2, -0.14, 0.14);
    }

    const targetFov = baseFov + portraitFovBoost + (isBoosting ? 4.5 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 6 * dt);
      this.camera.updateProjectionMatrix();
    }
    const dampK = 1 - Math.exp(-dampRate * dt);
    const lookDampK = 1 - Math.exp(-(dampRate + 2.5) * dt);

    if (this.screenState === 'title' || this.screenState === 'lobby') {
      const orbitA = t * 0.28 + 0.45;
      _camTargetPos.set(
        raft.x + Math.sin(orbitA) * 9.5,
        4.6 + Math.sin(t * 0.6) * 0.35,
        raft.z + Math.cos(orbitA) * 9.5,
      );
      _camTargetLook.set(raft.x, 1.5, raft.z);
      targetCamRoll = 0;
    } else if (this.isSpectator && this.spectatorTarget !== 'raft') {
      const targetSeat = this.spectatorTarget;
      const zone = PLAYER_ZONES[targetSeat];
      const sp = this.sim.players[targetSeat];
      _worldPos.set(sp.localX, 1.4, zone.zoneZ);
      this.raftGroup.localToWorld(_worldPos);
      const camYaw = raft.yaw * 0.45;
      _camTargetPos.set(
        _worldPos.x + Math.sin(camYaw) * 6.2 * distScale,
        Math.max(2.3, _worldPos.y + 2.9),
        _worldPos.z + Math.cos(camYaw) * 6.2 * distScale,
      );
      _camTargetLook.set(
        _worldPos.x - Math.sin(camYaw) * 2.5,
        Math.max(0.4, _worldPos.y),
        _worldPos.z - Math.cos(camYaw) * 2.5,
      );
      targetCamRoll = 0;
    } else {
      const camYaw = raft.yaw * (camMode === 'dynamic' ? 0.6 : 0.45);
      const rawDistBack =
        camMode === 'wide'
          ? 15.6 + Math.min(2.4, raftSpeed * 0.1)
          : camMode === 'dynamic'
            ? 8.9 + Math.min(3.8, raftSpeed * 0.24)
            : 10.6 + Math.min(2.2, raftSpeed * 0.12);
      const rawHeightUp =
        camMode === 'wide'
          ? 11.4
          : camMode === 'dynamic'
            ? 5.6 + Math.min(1.5, raftSpeed * 0.08)
            : 6.9;
      const baseLookAhead = camMode === 'wide' ? 12.0 : camMode === 'dynamic' ? 8.5 : 6.5;
      const lookAheadDist = portraitAspect ? baseLookAhead * Math.max(0.5, this.camera.aspect / 0.85) : baseLookAhead;

      const scaledDist = rawDistBack * distScale;
      const horizBack = Math.max(5.2, scaledDist * Math.cos(angleRad * 0.65));
      const heightUp = Math.max(2.4, rawHeightUp * distScale + Math.sin(angleRad) * scaledDist * 0.55);
      const dynLatOffset = camMode === 'dynamic' ? clamp(raft.vx * 0.2, -2.5, 2.5) : 0;

      _camTargetPos.set(
        raft.x + Math.sin(camYaw) * horizBack - dynLatOffset * 0.45,
        Math.max(2.4, raft.y + heightUp),
        raft.z + Math.cos(camYaw) * horizBack,
      );
      _camTargetLook.set(
        raft.x - Math.sin(camYaw) * lookAheadDist + dynLatOffset,
        Math.max(0.2, raft.y + 1.3),
        raft.z - Math.cos(camYaw) * lookAheadDist,
      );
    }

    this.camera.position.lerp(_camTargetPos, dampK);
    _camLookSmooth.lerp(_camTargetLook, lookDampK);
    this.camera.lookAt(_camLookSmooth);

    this.currentCamRoll += (targetCamRoll - this.currentCamRoll) * dampK;
    if (!this.reduceShake && Math.abs(this.currentCamRoll) > 0.0004) {
      this.camera.rotateZ(this.currentCamRoll);
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
      if (!this.reduceShake) {
        const shakeScale = camMode === 'dynamic' ? 0.52 : 0.42;
        const shake = this.trauma * this.trauma * shakeScale;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
      }
    }

    this.courseHandles.skyDome.position.copy(this.camera.position);

    // 7. Toast timer & throttled HUD snapshot (<= 10Hz)
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toastText = null;
        this.pushHud(true);
      }
    }

    if (nowMs - this.lastHudPushMs >= 100) {
      this.pushHud(false, nowMs);
    }
  }

  private pushHud(force: boolean, nowMs = performance.now()): void {
    if (!force && nowMs - this.lastHudPushMs < 100) return;
    this.lastHudPushMs = nowMs;
    const course = this.activeCourseDef;
    const connectedPlayers = this.sim.players.filter((p) => p.connected).length;
    const ghostDeltaSec =
      this.soloSessionKind === 'normal' && this.sim.gameMode === 'time_trial' && this.activeBestTtRecord
        ? estimateGhostDelta(this.activeBestTtRecord.frames, this.sim.elapsedTime, this.sim.raft.z)
        : null;

    this.onHudUpdate({
      screen: this.screenState,
      mode: this.sim.mode,
      courseId: this.currentCourseId,
      activeHazardTag: this.sim.activeHazardTag,
      elapsedTime: this.sim.elapsedTime,
      falls: this.sim.falls,
      checkpointIndex: this.sim.checkpointIndex,
      totalCheckpoints: Math.max(1, course.checkpoints.length - 1),
      progress: this.sim.progress,
      connectedPlayers,
      mySlot: this.mySlot,
      isSpectator: this.isSpectator,
      spectatorTarget: this.spectatorTarget,
      toastText: this.toastText,
      bestTimeTrialSec: this.activeBestTtRecord?.bestTime ?? null,
      ghostDeltaSec,
      bestSurvivalDistance: this.activeBestSurvival,
      soloSessionKind: this.soloSessionKind,
      tutorialProgress: { ...this.tutorialProgress },
      practiceBotsEnabled: this.practiceBotsEnabled,
      cameraMode: this.cameraPrefs.mode,
      sim: this.sim,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.clearAllInputs);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    for (const rig of this.characterRigs) {
      rig.emoteBadgeMesh.geometry.dispose();
      rig.emoteBadgeMat.dispose();
      rig.emoteBadgeTex?.dispose();
    }

    this.clearTreasureMeshes();
    this.ghostRaftGroup.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material.dispose();
      }
    });
    this.particles.dispose();
    this.courseHandles.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
