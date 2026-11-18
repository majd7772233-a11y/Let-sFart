import assert from 'node:assert/strict';
import test from 'node:test';
import { COURSE_PRACTICE, COURSE_TUTORIAL } from './courses/training.ts';
import { createInitialSimState, stepSimulation } from './physics.ts';
import {
  TUTORIAL_STEPS,
  buildRoundSummaryInsights,
  createInitialTutorialProgress,
  createTouchPresetConfig,
  cycleCameraMode,
  evaluateTutorialStep,
  normalizeCameraPrefs,
  normalizeTouchControlsConfig,
} from './ux.ts';

test('UX-04: camera prefs normalization and cycling work deterministically', () => {
  const clamped = normalizeCameraPrefs({
    mode: 'invalid' as never,
    distanceScale: 9.5,
    angleDeg: -99,
  });
  assert.equal(clamped.mode, 'follow');
  assert.equal(clamped.distanceScale, 1.5);
  assert.equal(clamped.angleDeg, -10);

  assert.equal(cycleCameraMode('follow'), 'wide');
  assert.equal(cycleCameraMode('wide'), 'dynamic');
  assert.equal(cycleCameraMode('dynamic'), 'follow');
});

test('UX-03: touch controls preset flips left/right and clamps scale, opacity, and drag offsets', () => {
  const left = createTouchPresetConfig('left', { scale: 1.2, opacity: 0.7 });
  assert.equal(left.preset, 'left');
  assert.equal(left.scale, 1.2);
  assert.equal(left.opacity, 0.7);
  assert.deepEqual(left.offsets.fart, { x: 0, y: 0 });

  const normalized = normalizeTouchControlsConfig({
    preset: 'custom',
    scale: 4,
    opacity: 0.1,
    offsets: {
      dpad: { x: 500, y: -500 },
      fart: { x: -400, y: 400 },
      anchor: { x: 20, y: -15 },
      item: { x: 0, y: 0 },
    },
  });
  assert.equal(normalized.scale, 1.45);
  assert.equal(normalized.opacity, 0.35);
  assert.equal(normalized.offsets.dpad.x, 220);
  assert.equal(normalized.offsets.dpad.y, -200);
  assert.equal(normalized.offsets.fart.x, -220);
  assert.equal(normalized.offsets.fart.y, 100);
});

test('UX-01: interactive tutorial progresses through all 5 guided steps smoothly', () => {
  const sim = createInitialSimState('solo', 'متدرب', undefined, 'tropical', undefined, COURSE_TUTORIAL);
  sim.practiceMode = true;
  let tut = createInitialTutorialProgress(true);
  assert.equal(tut.stepIndex, 0);
  assert.equal(TUTORIAL_STEPS.length, 5);

  // Step 1: Steer left/right
  sim.players[0].moveDir = 1;
  for (let i = 0; i < 12; i++) {
    stepSimulation(sim, 0.05, COURSE_TUTORIAL);
    tut = evaluateTutorialStep(tut, sim, 0.05).progress;
  }
  assert.equal(tut.stepIndex, 1);

  // Step 2: Thrust / hold space
  sim.players[0].moveDir = 0;
  sim.players[0].farting = true;
  for (let i = 0; i < 20; i++) {
    stepSimulation(sim, 0.05, COURSE_TUTORIAL);
    tut = evaluateTutorialStep(tut, sim, 0.05).progress;
  }
  assert.equal(tut.stepIndex, 2);

  // Step 3: Anchor brake
  sim.players[0].farting = false;
  sim.players[0].anchorRequested = true;
  for (let i = 0; i < 10; i++) {
    stepSimulation(sim, 0.05, COURSE_TUTORIAL);
    tut = evaluateTutorialStep(tut, sim, 0.05).progress;
  }
  assert.equal(tut.stepIndex, 3);

  // Step 4: Pickup item
  sim.players[0].anchorRequested = false;
  sim.itemsCollectedCount = 1;
  tut = evaluateTutorialStep(tut, sim, 0.05).progress;
  assert.equal(tut.stepIndex, 4);

  // Step 5: Reach finish
  sim.phase = 'finished';
  const finalEval = evaluateTutorialStep(tut, sim, 0.05);
  assert.equal(finalEval.progress.completed, true);
  assert.equal(finalEval.tutorialJustFinished, true);
});

test('UX-02: free practice arena keeps hull non-fatal and enforces infinite sandbox lagoon', () => {
  const sim = createInitialSimState('solo', 'متدرب حر', undefined, 'tropical', undefined, COURSE_PRACTICE);
  sim.practiceMode = true;
  sim.infiniteSandbox = true;
  sim.roundTimeLimitSec = 1; // even if timer were set, practiceMode prevents timer defeat
  sim.raft.z = COURSE_PRACTICE.finishZ - 5;
  sim.raft.vz = -14;

  for (let i = 0; i < 30; i++) {
    stepSimulation(sim, 0.05, COURSE_PRACTICE);
  }
  assert.equal(sim.phase, 'playing');
  assert.ok(sim.raftHp >= 45);
  assert.ok(sim.raft.z >= COURSE_PRACTICE.finishZ + 7.5);
});

test('UX-05: reaction timing and round summary insights capture boost, collisions, reaction ms & highlights', () => {
  const sim = createInitialSimState('solo', 'سريع', undefined, 'tropical');
  // Advance 0.35s before first player input
  for (let i = 0; i < 7; i++) {
    stepSimulation(sim, 0.05);
  }
  sim.players[0].farting = true;
  for (let i = 0; i < 10; i++) {
    stepSimulation(sim, 0.05);
  }
  sim.players[1].stats.wallImpactCount = 4;
  sim.players[0].stats.wallImpactCount = 1;

  // Trigger checkpoint highlight
  sim.raft.x = 0;
  sim.raft.z = -186;
  stepSimulation(sim, 0.05);

  const insights = buildRoundSummaryInsights(sim);
  assert.ok(insights.bestBoost !== null);
  assert.ok(insights.mostCollisions !== null);
  assert.equal(insights.mostCollisions?.name, sim.players[1].name);
  assert.ok(insights.fastestReaction !== null);
  assert.ok(sim.players[0].stats.fastestReactionMs! >= 300);
  assert.ok(insights.highlights.some((h) => h.kind === 'checkpoint'));
});
