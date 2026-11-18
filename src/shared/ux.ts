import type {
  CameraMode,
  CameraPrefs,
  PlayerSimState,
  RoundHighlight,
  TouchControlsConfig,
  TouchLayoutPreset,
  TouchOffset,
  WorldSimulationState,
} from './types.ts';

function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

// ==========================================
// UX-04: Camera Modes & Preferences
// ==========================================

export const DEFAULT_CAMERA_PREFS: CameraPrefs = {
  mode: 'follow',
  distanceScale: 1.0,
  angleDeg: 0,
};

export const CAMERA_MODE_ORDER: readonly CameraMode[] = ['follow', 'wide', 'dynamic'];

export const CAMERA_MODE_META: Record<
  CameraMode,
  { id: CameraMode; labelAr: string; shortAr: string; descAr: string }
> = {
  follow: {
    id: 'follow',
    labelAr: 'كاميرا تتبع الطوف',
    shortAr: 'تتبع',
    descAr: 'متابعة متوازنة خلف الطوف في كل المنعطفات',
  },
  wide: {
    id: 'wide',
    labelAr: 'كاميرا رؤية أوسع للمسار',
    shortAr: 'واسعة',
    descAr: 'تبتعد وترتفع لكشف البوابات والعقبات القادمة مبكراً',
  },
  dynamic: {
    id: 'dynamic',
    labelAr: 'كاميرا ديناميكية تفاعلية',
    shortAr: 'ديناميكية',
    descAr: 'تتفاعل مع السرعة والميلان والاصطدامات بزاوية سينمائية',
  },
};

export function isValidCameraMode(value: unknown): value is CameraMode {
  return value === 'follow' || value === 'wide' || value === 'dynamic';
}

export function normalizeCameraPrefs(raw?: Partial<CameraPrefs> | null): CameraPrefs {
  return {
    mode: isValidCameraMode(raw?.mode) ? raw.mode : DEFAULT_CAMERA_PREFS.mode,
    distanceScale: Number(clampNum(raw?.distanceScale ?? DEFAULT_CAMERA_PREFS.distanceScale, 0.7, 1.5).toFixed(2)),
    angleDeg: Math.round(clampNum(raw?.angleDeg ?? DEFAULT_CAMERA_PREFS.angleDeg, -10, 18)),
  };
}

export function cycleCameraMode(current: CameraMode): CameraMode {
  const idx = CAMERA_MODE_ORDER.indexOf(current);
  return CAMERA_MODE_ORDER[(idx + 1) % CAMERA_MODE_ORDER.length];
}

// ==========================================
// UX-03: Customizable Touch Controls Config
// ==========================================

function clampOffset(offset?: Partial<TouchOffset> | null): TouchOffset {
  return {
    x: Math.round(clampNum(offset?.x ?? 0, -220, 220)),
    y: Math.round(clampNum(offset?.y ?? 0, -200, 100)),
  };
}

export const DEFAULT_TOUCH_CONTROLS_CONFIG: TouchControlsConfig = {
  preset: 'right',
  scale: 1.0,
  opacity: 0.9,
  offsets: {
    dpad: { x: 0, y: 0 },
    fart: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    item: { x: 0, y: 0 },
  },
};

export function createTouchPresetConfig(
  preset: 'right' | 'left',
  current?: Partial<TouchControlsConfig>,
): TouchControlsConfig {
  return {
    preset,
    scale: Number(clampNum(current?.scale ?? DEFAULT_TOUCH_CONTROLS_CONFIG.scale, 0.75, 1.45).toFixed(2)),
    opacity: Number(clampNum(current?.opacity ?? DEFAULT_TOUCH_CONTROLS_CONFIG.opacity, 0.35, 1.0).toFixed(2)),
    offsets: {
      dpad: { x: 0, y: 0 },
      fart: { x: 0, y: 0 },
      anchor: { x: 0, y: 0 },
      item: { x: 0, y: 0 },
    },
  };
}

export function normalizeTouchControlsConfig(
  raw?: Partial<TouchControlsConfig> | null,
): TouchControlsConfig {
  const preset: TouchLayoutPreset =
    raw?.preset === 'left' || raw?.preset === 'custom' || raw?.preset === 'right'
      ? raw.preset
      : 'right';
  return {
    preset,
    scale: Number(clampNum(raw?.scale ?? DEFAULT_TOUCH_CONTROLS_CONFIG.scale, 0.75, 1.45).toFixed(2)),
    opacity: Number(clampNum(raw?.opacity ?? DEFAULT_TOUCH_CONTROLS_CONFIG.opacity, 0.35, 1.0).toFixed(2)),
    offsets: {
      dpad: clampOffset(raw?.offsets?.dpad),
      fart: clampOffset(raw?.offsets?.fart),
      anchor: clampOffset(raw?.offsets?.anchor),
      item: clampOffset(raw?.offsets?.item),
    },
  };
}

// ==========================================
// UX-01: Interactive Beginner Tutorial Coach
// ==========================================

export type TutorialStepId =
  | 'steer'
  | 'thrust'
  | 'anchor_obstacle'
  | 'pickup_item'
  | 'checkpoint_finish';

export interface TutorialStepDef {
  id: TutorialStepId;
  index: number;
  titleAr: string;
  instructionAr: string;
  keyHintAr: string;
  touchHintAr: string;
}

export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  {
    id: 'steer',
    index: 0,
    titleAr: '1. التوازن والتوجيه الجانبي',
    instructionAr: 'تحرك يميناً أو يساراً داخل مقعدك لتوجيه الطوف وتعديل توازنه.',
    keyHintAr: 'اضغط ← / → أو A / D لمدة نصف ثانية',
    touchHintAr: 'اضغط على أسهم اليمين أو اليسار',
  },
  {
    id: 'thrust',
    index: 1,
    titleAr: '2. النفخ والتوقيت والتناغم',
    instructionAr: 'اضغط باستمرار لتصاعد شدة الدفع ومزامنة نفخاتك مع الطاقم لملء عداد التناغم!',
    keyHintAr: 'اضغط باستمرار على Space لنحو ثانية',
    touchHintAr: 'اضغط باستمرار على زر إطلاق الريح',
  },
  {
    id: 'anchor_obstacle',
    index: 2,
    titleAr: '3. المرساة وتخطي العوائق',
    instructionAr: 'استخدم المرساة لتثبيت الطوف وكبح سرعتك أمام البوابة المتحركة ثم اعبرها بأمان.',
    keyHintAr: 'اضغط مع الاستمرار على E أو Shift للفرملة',
    touchHintAr: 'اضغط باستمرار على زر ⚓ المرساة',
  },
  {
    id: 'pickup_item',
    index: 3,
    titleAr: '4. صناديق الأدوات وعلب الطاقة',
    instructionAr: 'اقترب من علبة العدس أو الدرع في المجرى المائي لالتقاطها وتعزيز الطوف!',
    keyHintAr: 'التقط أي علبة أو أداة أمامك (اضغط F إذا جمعت موجة دفع)',
    touchHintAr: 'وجّه الطوف نحو العلبة أو الدرع لالتقاطها',
  },
  {
    id: 'checkpoint_finish',
    index: 4,
    titleAr: '5. نقطة الحفظ وخط النهاية',
    instructionAr: 'اعبر نقطة الحفظ الخضراء لإصلاح الطوف ثم اندفع نحو راية خط النهاية!',
    keyHintAr: 'تقدم عبر المرسى حتى خط النهاية',
    touchHintAr: 'استمر بالاندفاع نحو خط النهاية',
  },
];

export interface TutorialProgressState {
  active: boolean;
  stepIndex: number;
  completed: boolean;
  steerTime: number;
  thrustTime: number;
  anchorTime: number;
  collectedItem: boolean;
  crossedCheckpoint: boolean;
  finished: boolean;
}

export function createInitialTutorialProgress(active = true): TutorialProgressState {
  return {
    active,
    stepIndex: 0,
    completed: false,
    steerTime: 0,
    thrustTime: 0,
    anchorTime: 0,
    collectedItem: false,
    crossedCheckpoint: false,
    finished: false,
  };
}

export function evaluateTutorialStep(
  prev: TutorialProgressState,
  sim: WorldSimulationState,
  dt: number,
): {
  progress: TutorialProgressState;
  stepJustCompleted: TutorialStepId | null;
  tutorialJustFinished: boolean;
} {
  if (!prev.active || prev.completed) {
    return { progress: prev, stepJustCompleted: null, tutorialJustFinished: false };
  }

  const p0 = sim.players[0];
  const next: TutorialProgressState = { ...prev };
  let stepJustCompleted: TutorialStepId | null = null;
  let tutorialJustFinished = false;

  if (p0?.moveDir !== 0) {
    next.steerTime += dt;
  }
  if (p0?.farting) {
    next.thrustTime += dt;
  }
  if (sim.anchorActive || p0?.anchorRequested) {
    next.anchorTime += dt;
  }
  if ((sim.itemsCollectedCount ?? 0) > 0) {
    next.collectedItem = true;
  }
  if (sim.checkpointIndex >= 1) {
    next.crossedCheckpoint = true;
  }
  if (sim.phase === 'finished') {
    next.finished = true;
  }

  const currentStep = TUTORIAL_STEPS[next.stepIndex];
  if (currentStep) {
    let satisfied = false;
    if (currentStep.id === 'steer') {
      satisfied = next.steerTime >= 0.25 || Math.abs(sim.raft.x) >= 0.65;
    } else if (currentStep.id === 'thrust') {
      satisfied = next.thrustTime >= 0.45 || sim.raft.z <= -8;
    } else if (currentStep.id === 'anchor_obstacle') {
      satisfied = next.anchorTime >= 0.22 || sim.raft.z <= -72;
    } else if (currentStep.id === 'pickup_item') {
      satisfied = next.collectedItem || sim.raft.z <= -96;
    } else if (currentStep.id === 'checkpoint_finish') {
      satisfied = next.finished;
    }

    if (satisfied) {
      stepJustCompleted = currentStep.id;
      if (next.stepIndex < TUTORIAL_STEPS.length - 1) {
        next.stepIndex += 1;
      } else {
        next.completed = true;
        tutorialJustFinished = true;
      }
    }
  }

  return { progress: next, stepJustCompleted, tutorialJustFinished };
}

// ==========================================
// UX-05: Enhanced End-of-Round Insights
// ==========================================

export interface RoundAwardInsight {
  name: string;
  slot: number;
  valueLabelAr: string;
}

export interface RoundSummaryInsights {
  bestBoost: RoundAwardInsight | null;
  mostCollisions: RoundAwardInsight | null;
  fastestReaction: RoundAwardInsight | null;
  highlights: RoundHighlight[];
}

export function formatHighlightTime(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function buildRoundSummaryInsights(sim: WorldSimulationState): RoundSummaryInsights {
  const active: PlayerSimState[] = sim.players.filter((p) => p.connected);
  if (active.length === 0) {
    return {
      bestBoost: null,
      mostCollisions: null,
      fastestReaction: null,
      highlights: (sim.roundHighlights ?? []).slice(-10),
    };
  }

  const boostLeader = [...active].sort((a, b) => {
    const pushDiff = (b.stats.pushImpulseSum ?? 0) - (a.stats.pushImpulseSum ?? 0);
    if (Math.abs(pushDiff) > 0.5) return pushDiff;
    return b.stats.maxBurstDuration - a.stats.maxBurstDuration;
  })[0];

  const collisionLeader = [...active].sort((a, b) => {
    const wallDiff = (b.stats.wallImpactCount ?? 0) - (a.stats.wallImpactCount ?? 0);
    if (wallDiff !== 0) return wallDiff;
    return (b.stats.torqueImpulseSum ?? 0) - (a.stats.torqueImpulseSum ?? 0);
  })[0];

  const withReaction = active.filter(
    (p) => typeof p.stats.fastestReactionMs === 'number' && Number.isFinite(p.stats.fastestReactionMs) && p.stats.fastestReactionMs! > 0,
  );
  const reactionLeader =
    withReaction.length > 0
      ? [...withReaction].sort((a, b) => (a.stats.fastestReactionMs ?? 99999) - (b.stats.fastestReactionMs ?? 99999))[0]
      : null;

  return {
    bestBoost: {
      name: boostLeader.name,
      slot: boostLeader.slot,
      valueLabelAr: `${Math.round(boostLeader.stats.pushImpulseSum ?? 0)} قوة · ${boostLeader.stats.maxBurstDuration.toFixed(1)}ث ذروة`,
    },
    mostCollisions: {
      name: collisionLeader.name,
      slot: collisionLeader.slot,
      valueLabelAr:
        (collisionLeader.stats.wallImpactCount ?? 0) > 0
          ? `${collisionLeader.stats.wallImpactCount} اصطدام`
          : 'قيادة نظيفة (0 اصطدامات)',
    },
    fastestReaction: reactionLeader
      ? {
          name: reactionLeader.name,
          slot: reactionLeader.slot,
          valueLabelAr: `${reactionLeader.stats.fastestReactionMs} مللي ثانية`,
        }
      : null,
    highlights: (sim.roundHighlights ?? []).slice(-10),
  };
}
