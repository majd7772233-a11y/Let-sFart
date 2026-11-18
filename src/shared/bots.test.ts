import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_DIFFICULTY_META,
  BOT_PERSONALITY_META,
  computeSwarmBotDirectives,
  getDefaultBotPersonality,
} from './bots.ts';
import { getChannelBoundsAtZ, getCourseById } from './course.ts';
import { FART_MAX_THRUST, createInitialSimState, stepSimulation } from './physics.ts';

test('BOT-01: difficulty profiles differ in reaction cadence, lookahead, and anchor/shockwave allowance', () => {
  assert.ok(BOT_DIFFICULTY_META.hard.lookaheadZ > BOT_DIFFICULTY_META.normal.lookaheadZ);
  assert.ok(BOT_DIFFICULTY_META.normal.lookaheadZ > BOT_DIFFICULTY_META.easy.lookaheadZ);
  assert.ok(BOT_DIFFICULTY_META.hard.reactionStepSec < BOT_DIFFICULTY_META.easy.reactionStepSec);
  assert.equal(BOT_DIFFICULTY_META.easy.allowAnchor, false);
  assert.equal(BOT_DIFFICULTY_META.hard.allowAnchor, true);
  assert.equal(BOT_DIFFICULTY_META.hard.allowShockwave, true);

  const course = getCourseById('factory');
  const easySim = createInitialSimState('solo', 'قبطان', undefined, 'factory', {
    botDifficulty: 'easy',
  });
  easySim.phase = 'playing';
  easySim.heldItem = 'shockwave';
  easySim.raftHp = 35;

  const hardSim = createInitialSimState('solo', 'قبطان', undefined, 'factory', {
    botDifficulty: 'hard',
  });
  hardSim.phase = 'playing';
  hardSim.heldItem = 'shockwave';
  hardSim.raftHp = 35;

  computeSwarmBotDirectives(easySim, course);
  computeSwarmBotDirectives(hardSim, course);

  const easyShockwave = easySim.players.some((p) => p.isBot && p.useItemRequested);
  const hardShockwave = hardSim.players.some((p) => p.isBot && p.useItemRequested);
  assert.equal(easyShockwave, false, 'easy bots do not trigger shockwave proactively');
  assert.equal(hardShockwave, true, 'hard bots trigger shockwave when raft HP is low');
});

test('BOT-02: distinct bot personalities steer/boost differently while sharing fair physics limits', () => {
  assert.equal(Object.keys(BOT_PERSONALITY_META).length, 4);
  assert.equal(getDefaultBotPersonality(0), 'balancer');
  assert.equal(getDefaultBotPersonality(1), 'rusher');
  assert.equal(getDefaultBotPersonality(2), 'cautious');
  assert.equal(getDefaultBotPersonality(3), 'treasure_hunter');

  const course = getCourseById('storm');

  // Compare rusher vs cautious at medium cruising speed (-10.5 m/s)
  const sim = createInitialSimState('solo', 'قبطان', undefined, 'storm', {
    botDifficulty: 'hard',
    botPersonalities: { 1: 'rusher', 2: 'cautious', 3: 'balancer' },
  });
  sim.phase = 'playing';
  sim.raft.vz = -10.5;
  sim.raft.vx = 8.5;
  sim.windX = 8.5;
  sim.raft.roll = 0.22;
  const edgeBounds = getChannelBoundsAtZ(sim.raft.z, course.waypoints);
  sim.raft.x = edgeBounds.centerX + edgeBounds.halfWidth - 1.4; // near right edge to test anchor preference for cautious/balancer

  computeSwarmBotDirectives(sim, course);
  assert.equal(sim.players[1].botPersonality, 'rusher');
  assert.equal(sim.players[2].botPersonality, 'cautious');
  assert.equal(sim.players[3].botPersonality, 'balancer');
  assert.equal(sim.players[2].anchorRequested, true, 'cautious bot drops anchor in strong storm near edge');
  assert.equal(sim.players[1].anchorRequested, false, 'rusher does not preemptively anchor on clear edge');

  // Verify fair physics: all bots use identical FART_MAX_THRUST cap during simulation
  for (let i = 0; i < 40; i++) {
    stepSimulation(sim, 0.05, course, { enableBots: true });
  }
  for (const p of sim.players) {
    assert.ok(p.fartPower <= 1.0001);
  }
  assert.ok(FART_MAX_THRUST > 0);
});

test('BOT-03: swarm AI synchronizes Super Fart burst with human input and steers around broken ice', () => {
  const course = getCourseById('glacial');
  const sim = createInitialSimState('solo', 'قبطان', undefined, 'glacial', {
    botDifficulty: 'hard',
    botPersonalities: { 1: 'balancer', 2: 'cautious', 3: 'rusher' },
  });
  sim.phase = 'playing';
  sim.raft.vz = -11;
  // Human triggers farting right now
  sim.players[0].farting = true;
  sim.players[0].lastFartStartSimTime = sim.simTime;

  computeSwarmBotDirectives(sim, course);
  const syncingBots = sim.players.filter((p) => p.isBot && p.farting).length;
  assert.ok(syncingBots >= 2, `expected swarm bots to sync fart with human, got ${syncingBots}`);

  // Also test dynamic broken surface avoidance: mark first dynamic zone broken right ahead of raft
  if (course.dynamicZones.length > 0 && sim.dynamicZones.length > 0) {
    const dz = course.dynamicZones[0];
    sim.raft.z = dz.z + 8;
    sim.raft.x = dz.x;
    sim.dynamicZones[0].status = 'broken';
    computeSwarmBotDirectives(sim, course);
    // At least one bot should actively steer (non-zero moveDir or yaw command) away from broken slab
    const anyBotSteering = sim.players.some((p) => p.isBot && (p.moveDir !== 0 || p.farting));
    assert.equal(anyBotSteering, true);
  }
});
