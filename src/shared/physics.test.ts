import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAOS_CYCLE_DURATION_SEC,
  FART_RAMP_DURATION,
  computeFartFactor,
  createInitialSimState,
  createInitialTreasures,
  enforceInputTimeouts,
  normalizeRoomSettings,
  respawnAtCheckpoint,
  stepSimulation,
} from './physics.ts';
import {
  COURSE_CATALOG,
  COURSE_LIST,
  COURSE_MAIN,
  PLAYER_ZONES,
  getCourseById,
  getMovingGateTransform,
  isWindZoneActive,
} from './course.ts';
import type { CourseId } from './types.ts';

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

test('crossing finish line completes the run only within finishX +/- finishHalfWidth', () => {
  const simOut = createInitialSimState('online');
  simOut.raft.z = COURSE_MAIN.finishZ - 0.5;
  simOut.raft.x = COURSE_MAIN.finishX + COURSE_MAIN.finishHalfWidth + 4.0;
  const outEvents = stepSimulation(simOut, 0.05);
  assert.equal(simOut.phase, 'playing');
  assert.equal(outEvents.some((e) => e.type === 'finish'), false);

  const simIn = createInitialSimState('online');
  simIn.raft.z = COURSE_MAIN.finishZ - 0.5;
  simIn.raft.x = COURSE_MAIN.finishX;
  const events = stepSimulation(simIn, 0.05);
  assert.equal(simIn.phase, 'finished');
  assert.equal(simIn.progress, 1);
  assert.ok(events.some((e) => e.type === 'finish'));
});

test('checkpoints require horizontal X proximity rather than Z-only crossing', () => {
  const sim = createInitialSimState('online');
  const cp1 = COURSE_MAIN.checkpoints[1];

  // Crossing cp1.z far to the side should NOT capture checkpoint 1
  sim.raft.z = cp1.z - 0.5;
  sim.raft.x = cp1.x + cp1.radius + 10;
  const missEvents = stepSimulation(sim, 0.05);
  assert.equal(sim.checkpointIndex, 0);
  assert.equal(missEvents.some((e) => e.type === 'checkpoint'), false);

  // Crossing within horizontal checkpoint bounds SHOULD capture checkpoint 1
  sim.raft.x = cp1.x + 1.5;
  sim.raft.z = cp1.z - 0.5;
  const hitEvents = stepSimulation(sim, 0.05);
  assert.equal(sim.checkpointIndex, 1);
  assert.ok(hitEvents.some((e) => e.type === 'checkpoint'));
});

test('crewScale thrust is identical across all 4 player slots when 4 players are connected', () => {
  const measureSlotSpeed = (activeSlot: 0 | 1 | 2 | 3) => {
    const sim = createInitialSimState('online');
    for (let i = 0; i < 4; i++) {
      sim.players[i].connected = true;
      sim.players[i].isBot = false;
      sim.players[i].localX = 0; // isolate forward thrust without lateral offset differences
      sim.players[i].farting = i === activeSlot;
    }
    for (let step = 0; step < 10; step++) {
      stepSimulation(sim, 0.05);
    }
    return -sim.raft.vz;
  };

  const s0 = measureSlotSpeed(0);
  const s1 = measureSlotSpeed(1);
  const s2 = measureSlotSpeed(2);
  const s3 = measureSlotSpeed(3);

  assert.ok(Math.abs(s0 - s1) < 1e-6 && Math.abs(s0 - s2) < 1e-6 && Math.abs(s0 - s3) < 1e-6);
});

test('SimEvents receive strictly monotonic sequential IDs across physics steps', () => {
  const sim = createInitialSimState('online');
  sim.players[0].connected = true;
  sim.players[0].farting = true;
  const e1 = stepSimulation(sim, 0.05);
  sim.players[0].farting = false;
  const e2 = stepSimulation(sim, 0.05);
  const all = [...e1, ...e2];
  assert.ok(all.length >= 2);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].id > all[i - 1].id);
  }
});

test('all 5 courses are registered with valid waypoints, checkpoints, and reach finish cleanly', () => {
  assert.equal(COURSE_LIST.length, 5);
  const ids: CourseId[] = ['tropical', 'volcanic', 'glacial', 'factory', 'storm'];
  for (const id of ids) {
    const c = getCourseById(id);
    assert.equal(c.id, id);
    assert.ok(c.waypoints.length >= 10);
    assert.ok(c.checkpoints.length >= 3);
    assert.ok(c.finishZ < -300);

    const sim = createInitialSimState('solo', 'قبطان', undefined, id);
    assert.equal(sim.courseId, id);
    sim.raft.x = c.finishX;
    sim.raft.z = c.finishZ - 0.5;
    const evs = stepSimulation(sim, 0.05);
    assert.equal(sim.phase, 'finished');
    assert.ok(evs.some((e) => e.type === 'finish'));
  }
});

test('Glacial low-friction ice sheets preserve significantly higher coasting speed and tag ice HUD cue', () => {
  const glacial = COURSE_CATALOG.glacial;
  const iceZone = glacial.frictionZones[0];

  const simNormal = createInitialSimState('online', 'نور', undefined, 'tropical');
  simNormal.raft.vz = -12;
  simNormal.raft.z = -10;

  const simIce = createInitialSimState('online', 'نور', undefined, 'glacial');
  simIce.raft.x = iceZone.x;
  simIce.raft.z = iceZone.z + 4;
  simIce.raft.vz = -12;

  for (let i = 0; i < 15; i++) {
    stepSimulation(simNormal, 0.05, COURSE_CATALOG.tropical);
    stepSimulation(simIce, 0.05, glacial);
  }

  assert.equal(simIce.activeHazardTag, 'ice');
  assert.ok(
    Math.abs(simIce.raft.vz) > Math.abs(simNormal.raft.vz) + 3.0,
    'ice sheet retains noticeably higher glide speed due to lower drag',
  );
});

test('Glacial thin-ice bridge cracks on entry and breaks into a fall hazard if raft lingers', () => {
  const glacial = COURSE_CATALOG.glacial;
  const thinIce = glacial.dynamicZones[0];
  const sim = createInitialSimState('online', 'نور', undefined, 'glacial');
  sim.invulnTimer = 0;
  sim.raft.x = thinIce.x;
  sim.raft.z = thinIce.z;

  const firstEvs = stepSimulation(sim, 0.05, glacial);
  assert.equal(sim.dynamicZones[0].status, 'cracking');
  assert.ok(firstEvs.some((e) => e.type === 'surface_crack'));

  let broke = false;
  for (let i = 0; i < 30; i++) {
    const evs = stepSimulation(sim, 0.05, glacial);
    if (evs.some((e) => e.type === 'surface_break')) broke = true;
    if (sim.phase === 'falling') break;
  }
  assert.equal(broke, true);
  assert.equal(sim.phase, 'falling');
  assert.equal(sim.falls, 1);

  // Respawn restores broken thin ice back to intact
  respawnAtCheckpoint(sim, glacial);
  assert.equal(sim.dynamicZones[0].status, 'intact');
});

test('Volcanic falling hazards emit impact event across period wrap and push nearby raft', () => {
  const volcanic = COURSE_CATALOG.volcanic;
  const meteor = volcanic.fallingHazards[0];
  const sim = createInitialSimState('online', 'نور', undefined, 'volcanic');
  sim.invulnTimer = 0;
  sim.raft.x = meteor.x + 1.0;
  sim.raft.z = meteor.z;

  let sawImpact = false;
  const totalSteps = Math.ceil((meteor.period + 0.5) / 0.05);
  for (let i = 0; i < totalSteps; i++) {
    // Keep raft near meteor target to measure impact impulse cleanly
    sim.raft.x = meteor.x + 1.0;
    sim.raft.z = meteor.z;
    const evs = stepSimulation(sim, 0.05, volcanic);
    if (evs.some((e) => e.type === 'hazard_hit' && e.intensity > 0.8)) {
      sawImpact = true;
      break;
    }
  }
  assert.equal(sawImpact, true);
  assert.ok(Math.hypot(sim.raft.vx, sim.raft.vz) > 4, 'meteor impact pushes raft');
});

test('Factory vertical hydraulic pistons alternate open/closed and wind fans pulse on duty cycle', () => {
  const factory = COURSE_CATALOG.factory;
  const piston = factory.movingGates.find((g) => g.motion === 'vertical_piston')!;
  const fan = factory.windZones[0];

  let sawOpen = false;
  let sawClosed = false;
  for (let t = 0; t < (piston.slamPeriod ?? 4) * 1.2; t += 0.1) {
    const tf = getMovingGateTransform(piston, t);
    if (tf.blocksChannel) sawClosed = true;
    else sawOpen = true;
  }
  assert.ok(sawOpen && sawClosed, 'hydraulic piston alternates cleanly between raised open and slammed closed');

  let fanOn = false;
  let fanOff = false;
  for (let t = 0; t < (fan.cyclePeriod ?? 4) * 1.2; t += 0.1) {
    if (isWindZoneActive(fan, t)) fanOn = true;
    else fanOff = true;
  }
  assert.ok(fanOn && fanOff, 'factory wind fan pulses ON and OFF deterministically');
});

test('GAME-01: lentil_can > fava_can > bean_can thrust hierarchy and magnet pull work cleanly', () => {
  const measureCanSpeed = (kind: 'lentil_can' | 'fava_can' | 'bean_can') => {
    const sim = createInitialSimState('online', 'قبطان', undefined, 'tropical');
    sim.players[0].connected = true;
    sim.players[0].localX = 0;
    sim.players[0].farting = true;
    sim.pickups = [{ id: 'test-can', kind, x: 0, z: sim.raft.z, collected: false, respawnTimer: 0 }];
    for (let i = 0; i < 20; i++) {
      stepSimulation(sim, 0.05, COURSE_CATALOG.tropical);
    }
    return -sim.raft.vz;
  };

  const lentilSpeed = measureCanSpeed('lentil_can');
  const favaSpeed = measureCanSpeed('fava_can');
  const beanSpeed = measureCanSpeed('bean_can');

  assert.ok(lentilSpeed > favaSpeed, 'lentil can grants stronger speed than fava can');
  assert.ok(favaSpeed > beanSpeed, 'fava can grants stronger speed than bean can');

  // Magnet attraction test
  const simMag = createInitialSimState('online', 'قبطان', undefined, 'tropical');
  simMag.magnetTimer = 5.0;
  simMag.pickups = [{ id: 'far-can', kind: 'lentil_can', x: 8, z: simMag.raft.z - 8, collected: false, respawnTimer: 0 }];
  const startDist = Math.hypot(simMag.pickups[0].x - simMag.raft.x, simMag.pickups[0].z - simMag.raft.z);
  stepSimulation(simMag, 0.05, COURSE_CATALOG.tropical);
  const endDist = Math.hypot(simMag.pickups[0].x - simMag.raft.x, simMag.pickups[0].z - simMag.raft.z);
  assert.ok(endDist < startDist, 'magnet pulls nearby pickups closer toward raft');
});

test('GAME-02: shield absorbs hazard damage and emits shield_block then shield_break', () => {
  const volcanic = COURSE_CATALOG.volcanic;
  const meteor = volcanic.fallingHazards[0];
  const sim = createInitialSimState('online', 'نور', undefined, 'volcanic');
  sim.invulnTimer = 0;
  sim.shieldHits = 2;
  sim.shieldTimer = 15;
  sim.raftHp = 100;

  // Trigger first impact at exact wrap
  sim.simTime = meteor.period - meteor.phaseOffset - 0.02;
  sim.raft.x = meteor.x;
  sim.raft.z = meteor.z;
  const ev1 = stepSimulation(sim, 0.05, volcanic);
  assert.ok(ev1.some((e) => e.type === 'shield_block'));
  assert.equal(sim.shieldHits, 1);
  assert.equal(sim.raftHp, 100, 'shield prevents hull damage');

  // Clear invuln/hitstop (time jumped forward one full period) and absorb second impact -> breaks shield
  sim.invulnTimer = 0;
  sim.hitstopTimer = 0;
  sim.simTime = meteor.period * 2 - meteor.phaseOffset - 0.02;
  sim.raft.x = meteor.x;
  sim.raft.z = meteor.z;
  const ev2 = stepSimulation(sim, 0.05, volcanic);
  assert.ok(ev2.some((e) => e.type === 'shield_break'));
  assert.equal(sim.shieldHits, 0);
  assert.equal(sim.raftHp, 100);
});

test('GAME-03: dropping anchor rapidly brakes raft velocity and drains/recharges anchorEnergy', () => {
  const sim = createInitialSimState('online', 'نور', undefined, 'storm');
  sim.raft.vz = -14;
  sim.players[0].connected = true;
  sim.players[0].anchorRequested = true;

  const evDrop = stepSimulation(sim, 0.05, COURSE_CATALOG.storm);
  assert.equal(sim.anchorActive, true);
  assert.ok(evDrop.some((e) => e.type === 'anchor_drop'));

  for (let i = 0; i < 12; i++) {
    stepSimulation(sim, 0.05, COURSE_CATALOG.storm);
  }
  assert.ok(Math.abs(sim.raft.vz) < 4.5, 'anchor brakes raft speed strongly');
  assert.ok(sim.anchorEnergy < 1.0, 'anchor drains energy while held');

  sim.players[0].anchorRequested = false;
  const energyBefore = sim.anchorEnergy;
  const evRaise = stepSimulation(sim, 0.05, COURSE_CATALOG.storm);
  assert.equal(sim.anchorActive, false);
  assert.ok(evRaise.some((e) => e.type === 'anchor_raise'));
  assert.ok(sim.anchorEnergy > energyBefore, 'anchor recharges after release');
});

test('GAME-04: synchronized co-op farts build harmony and unleash super_fart stronger than sum', () => {
  const sim = createInitialSimState('online', 'نور', undefined, 'tropical');
  for (let i = 0; i < 2; i++) {
    sim.players[i].connected = true;
    sim.players[i].isBot = false;
    sim.players[i].localX = 0;
    sim.players[i].farting = true;
  }

  let sawSuperFart = false;
  for (let step = 0; step < 60; step++) {
    const evs = stepSimulation(sim, 0.05, COURSE_CATALOG.tropical);
    if (evs.some((e) => e.type === 'super_fart')) {
      sawSuperFart = true;
      break;
    }
  }
  assert.equal(sawSuperFart, true, 'synchronized crew farts reach harmony threshold and trigger super_fart');
  assert.ok(sim.superFartTimer > 0);
});

test('GAME-05 & GAME-06: hull damage degrades speed below 40 HP, repair_kit heals, and 0 HP sinks raft', () => {
  const simHealthy = createInitialSimState('online', 'نور', undefined, 'tropical');
  simHealthy.players[0].connected = true;
  simHealthy.players[0].localX = 0;
  simHealthy.players[0].farting = true;
  for (let i = 0; i < 20; i++) stepSimulation(simHealthy, 0.05);

  const simDamaged = createInitialSimState('online', 'نور', undefined, 'tropical');
  simDamaged.raftHp = 25;
  simDamaged.players[0].connected = true;
  simDamaged.players[0].localX = 0;
  simDamaged.players[0].farting = true;
  for (let i = 0; i < 20; i++) stepSimulation(simDamaged, 0.05);

  assert.ok(-simDamaged.raft.vz < -simHealthy.raft.vz, 'damaged hull reduces forward speed');
  assert.equal(simDamaged.activeHazardTag, 'damaged');

  // Collect repair kit
  simDamaged.pickups = [
    { id: 'fix', kind: 'repair_kit', x: simDamaged.raft.x, z: simDamaged.raft.z, collected: false, respawnTimer: 0 },
  ];
  const healEvs = stepSimulation(simDamaged, 0.05);
  assert.ok(healEvs.some((e) => e.type === 'repair'));
  assert.equal(simDamaged.raftHp, 57);

  // Heavy collision at low HP sinks raft
  simDamaged.raftHp = 5;
  simDamaged.invulnTimer = 0;
  const obs = COURSE_CATALOG.tropical.staticObstacles[0];
  simDamaged.raft.x = obs.x;
  simDamaged.raft.z = obs.z + obs.radius + 1.2;
  simDamaged.raft.vz = -12;
  const sinkEvs = stepSimulation(simDamaged, 0.05);
  assert.equal(simDamaged.raftHp, 0);
  assert.equal(simDamaged.phase, 'falling');
  assert.ok(sinkEvs.some((e) => e.type === 'fall'));
});

test('COURSE-06: Storm course generates dynamic changing crosswinds and periodic lightning events', () => {
  const storm = COURSE_CATALOG.storm;
  const sim = createInitialSimState('online', 'نور', undefined, 'storm');
  stepSimulation(sim, 0.05, storm);
  const w1 = sim.windX;

  let sawLightning = false;
  for (let i = 0; i < 160; i++) {
    const evs = stepSimulation(sim, 0.05, storm);
    if (evs.some((e) => e.type === 'lightning')) sawLightning = true;
  }
  const w2 = sim.windX;
  assert.ok(Math.abs(w2 - w1) > 0.5, 'storm crosswind shifts over time');
  assert.equal(sawLightning, true, 'storm emits periodic deterministic lightning events');
});

test('normalizeRoomSettings sanitizes invalid inputs and clamps bounds safely', () => {
  const clean = normalizeRoomSettings({
    gameMode: 'chaos',
    difficulty: 'hard',
    enableItems: false,
    roundTimeLimitSec: 180,
    maxPlayers: 3,
  });
  assert.deepEqual(clean, {
    gameMode: 'chaos',
    difficulty: 'hard',
    enableItems: false,
    roundTimeLimitSec: 180,
    maxPlayers: 3,
    botDifficulty: 'normal',
    botPersonalities: {
      0: 'balancer',
      1: 'rusher',
      2: 'cautious',
      3: 'treasure_hunter',
    },
  });

  const fallback = normalizeRoomSettings({
    gameMode: 'invalid' as never,
    difficulty: 'impossible' as never,
    roundTimeLimitSec: 99999,
    maxPlayers: 99 as never,
  });
  assert.equal(fallback.gameMode, 'standard');
  assert.equal(fallback.difficulty, 'normal');
  assert.equal(fallback.roundTimeLimitSec, 600);
  assert.equal(fallback.maxPlayers, 4);
});

test('MODE-01 & RoomSettings: time_trial completes cleanly, enableItems=false hides pickups, and roundTimeLimitSec expires as defeat', () => {
  const sim = createInitialSimState('solo', 'متسابق', undefined, 'tropical', {
    gameMode: 'time_trial',
    enableItems: false,
    roundTimeLimitSec: 90,
  });
  assert.equal(sim.gameMode, 'time_trial');
  assert.equal(sim.pickups.length, 0);

  // Reach finish within limit -> victory
  sim.raft.x = COURSE_MAIN.finishX;
  sim.raft.z = COURSE_MAIN.finishZ - 1;
  const winEvs = stepSimulation(sim, 0.05, COURSE_MAIN);
  assert.equal(sim.phase, 'finished');
  assert.equal(sim.runOutcome, 'victory');
  assert.ok(winEvs.some((e) => e.type === 'finish'));

  // Round timer expiration -> defeat + time_expired event
  const simTimeout = createInitialSimState('solo', 'متأخر', undefined, 'tropical', {
    gameMode: 'time_trial',
    roundTimeLimitSec: 2,
  });
  simTimeout.elapsedTime = 1.98;
  const timeoutEvs = stepSimulation(simTimeout, 0.05, COURSE_MAIN);
  assert.equal(simTimeout.phase, 'finished');
  assert.equal(simTimeout.runOutcome, 'defeat');
  assert.ok(timeoutEvs.some((e) => e.type === 'time_expired'));
});

test('MODE-02: survival loops past finishZ infinitely with escalating speed and ends in defeat on fall', () => {
  const sim = createInitialSimState('solo', 'صامد', undefined, 'tropical', {
    gameMode: 'survival',
  });
  // Place raft past finishZ — should NOT finish in survival!
  sim.raft.x = COURSE_MAIN.finishX;
  sim.raft.z = COURSE_MAIN.finishZ - 15;
  sim.elapsedTime = 45;
  stepSimulation(sim, 0.05, COURSE_MAIN);
  assert.equal(sim.phase, 'playing');
  assert.ok(sim.checkpointIndex >= 1, 'crossing loop span increments lap checkpointIndex');
  assert.ok(sim.survivalDistance >= 330);
  assert.ok(sim.survivalSpeedScale > 1.3, 'survival ramps speed scale over time');

  // Falling in survival ends the run cleanly as defeat
  sim.phase = 'falling';
  sim.fallTimer = 0.02;
  stepSimulation(sim, 0.05, COURSE_MAIN);
  assert.equal(sim.phase, 'finished');
  assert.equal(sim.runOutcome, 'defeat');
});

test('MODE-03: treasure mode spawns 24 coins/chests, magnet pulls them, and collection scores points + emits coin events', () => {
  const treasures = createInitialTreasures(COURSE_MAIN, 'treasure');
  assert.equal(treasures.length, 24);
  assert.ok(treasures.some((t) => t.kind === 'coin' && t.value === 10));
  assert.ok(treasures.some((t) => t.kind === 'chest' && t.value === 50));

  const sim = createInitialSimState('solo', 'صياد', undefined, 'tropical', { gameMode: 'treasure' });
  assert.equal(sim.treasures.length, 24);

  // Pull far coin via magnet
  const coin = sim.treasures[0];
  coin.x = sim.raft.x + 7;
  coin.z = sim.raft.z - 7;
  sim.magnetTimer = 5;
  const distBefore = Math.hypot(coin.x - sim.raft.x, coin.z - sim.raft.z);
  stepSimulation(sim, 0.05, COURSE_MAIN);
  const distAfter = Math.hypot(coin.x - sim.raft.x, coin.z - sim.raft.z);
  assert.ok(distAfter < distBefore, 'magnet pulls treasures toward raft');

  // Direct collection of coin + chest
  const chest = sim.treasures.find((t) => t.kind === 'chest')!;
  coin.x = sim.raft.x;
  coin.z = sim.raft.z;
  chest.x = sim.raft.x;
  chest.z = sim.raft.z;
  const evs = stepSimulation(sim, 0.05, COURSE_MAIN);
  assert.equal(coin.collected, true);
  assert.equal(chest.collected, true);
  assert.equal(sim.coinsCollected, 2);
  assert.equal(sim.treasureScore, 60);
  assert.ok(evs.some((e) => e.type === 'coin'));
});

test('MODE-04: chaos mode cycles deterministic modifiers, reverses steering on reverse_controls, and phases static obstacles', () => {
  const sim = createInitialSimState('solo', 'فوضوي', undefined, 'tropical', { gameMode: 'chaos' });
  sim.chaosTimer = 0.02;
  const shiftEvs = stepSimulation(sim, 0.05, COURSE_MAIN);
  assert.ok(shiftEvs.some((e) => e.type === 'chaos_shift'));
  assert.notEqual(sim.chaosModifier, 'none');
  assert.ok(sim.chaosTimer > CHAOS_CYCLE_DURATION_SEC - 0.5);

  // Reverse controls flips lateral velocity direction
  sim.chaosModifier = 'reverse_controls';
  sim.players[0].moveDir = 1;
  sim.players[0].lateralVel = 0;
  const startX = sim.players[0].localX;
  stepSimulation(sim, 0.05, COURSE_MAIN);
  assert.ok(sim.players[0].localX < startX, 'reverse_controls steers opposite to moveDir');

  // Ghost obstacles bypasses static obstacle collision damage/bounce
  sim.chaosModifier = 'ghost_obstacles';
  const obs = COURSE_MAIN.staticObstacles[0];
  sim.raft.x = obs.x;
  sim.raft.z = obs.z + obs.radius + 0.5;
  sim.raft.vz = -10;
  const ghostEvs = stepSimulation(sim, 0.05, COURSE_MAIN);
  assert.equal(ghostEvs.some((e) => e.type === 'collision'), false);
});

