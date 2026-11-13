import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FART_RAMP_DURATION,
  computeFartFactor,
  createInitialSimState,
  enforceInputTimeouts,
  respawnAtCheckpoint,
  stepSimulation,
} from './physics.ts';
import { COURSE_MAIN, PLAYER_ZONES } from './course.ts';

test('computeFartFactor starts immediately and ramps monotonically to 1.0', () => {
  const f0 = computeFartFactor(0);
  const fMid = computeFartFactor(FART_RAMP_DURATION * 0.5);
  const fMax = computeFartFactor(FART_RAMP_DURATION);
  const fOver = computeFartFactor(FART_RAMP_DURATION * 3);

  assert.ok(f0 > 0.15 && f0 < 0.35, 'initial press gives an immediate light puff');
  assert.ok(fMid > f0 && fMid < 1.0, 'mid hold ramps smoothly');
  assert.equal(fMax, 1.0);
  assert.equal(fOver, 1.0);
});

test('player lateral movement stays strictly clamped inside assigned quarter zone', () => {
  const sim = createInitialSimState('online');
  const p0 = sim.players[0];
  const zone0 = PLAYER_ZONES[0];

  p0.moveDir = -1;
  for (let i = 0; i < 60; i++) stepSimulation(sim, 0.05);
  assert.ok(p0.localX >= zone0.minX - 1e-6 && p0.localX <= zone0.minX + 0.01);

  p0.moveDir = 1;
  for (let i = 0; i < 60; i++) stepSimulation(sim, 0.05);
  assert.ok(p0.localX <= zone0.maxX + 1e-6 && p0.localX >= zone0.maxX - 0.01);
});

test('farting accelerates raft forward, off-center position produces yaw torque, and momentum persists after release', () => {
  const sim = createInitialSimState('online');
  const p0 = sim.players[0];
  p0.connected = true;
  p0.localX = PLAYER_ZONES[0].minX; // far left (-2.15)
  p0.farting = true;

  for (let i = 0; i < 20; i++) stepSimulation(sim, 0.05);

  assert.ok(sim.raft.z < 0, 'raft should move forward (-Z)');
  assert.ok(sim.raft.vz < -1, 'raft should have forward velocity');
  assert.ok(Math.abs(sim.raft.yaw) > 0.05, 'off-center fart should rotate raft');

  const speedAtRelease = Math.hypot(sim.raft.vx, sim.raft.vz);
  p0.farting = false;
  stepSimulation(sim, 0.05);
  const speedRightAfter = Math.hypot(sim.raft.vx, sim.raft.vz);
  assert.ok(speedRightAfter > speedAtRelease * 0.85, 'momentum persists smoothly after release');
});

test('safe input timeout stops stuck farting after disconnect or inactivity', () => {
  const sim = createInitialSimState('online');
  const p1 = sim.players[1];
  p1.connected = true;
  p1.isBot = false;
  p1.farting = true;
  p1.lastInputAt = 1000;

  enforceInputTimeouts(sim, 5000);
  assert.equal(p1.farting, false);
});

test('checkpoint capture and fall-out respawn resets raft safely with zero velocity', () => {
  const sim = createInitialSimState('online');
  const cp1 = COURSE_MAIN.checkpoints[1];

  // Move raft onto checkpoint 1
  sim.raft.x = cp1.x;
  sim.raft.z = cp1.z;
  const events = stepSimulation(sim, 0.05);
  assert.equal(sim.checkpointIndex, 1);
  assert.ok(events.some((e) => e.type === 'checkpoint'));

  // Push raft outside open-edge danger zone to trigger fall
  sim.raft.z = -220;
  sim.raft.x = 50;
  sim.invulnTimer = 0;
  const fallEvents = stepSimulation(sim, 0.05);
  assert.equal(sim.phase, 'falling');
  assert.equal(sim.falls, 1);
  assert.ok(fallEvents.some((e) => e.type === 'fall'));

  // Respawn restores raft cleanly at checkpoint 1 with zeroed speed
  respawnAtCheckpoint(sim);
  assert.equal(sim.phase, 'playing');
  assert.equal(sim.raft.x, cp1.x);
  assert.equal(sim.raft.z, cp1.z);
  assert.equal(sim.raft.vx, 0);
  assert.equal(sim.raft.vz, 0);
  assert.ok(sim.invulnTimer > 1.0);
});

test('crossing finish line completes the run', () => {
  const sim = createInitialSimState('online');
  sim.raft.z = COURSE_MAIN.finishZ - 0.5;
  const events = stepSimulation(sim, 0.05);
  assert.equal(sim.phase, 'finished');
  assert.equal(sim.progress, 1);
  assert.ok(events.some((e) => e.type === 'finish'));
});
