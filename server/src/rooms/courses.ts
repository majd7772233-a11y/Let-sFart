import { getCourseById, isValidCourseId, VALID_COURSE_IDS } from '../../../src/shared/course.ts';
import {
  createInitialDynamicZones,
  createInitialPickups,
  createInitialTreasures,
  normalizeRoomSettings,
} from '../../../src/shared/physics.ts';
import type { CourseId } from '../../../src/shared/types.ts';
import type { RoomRecord } from './types.ts';

/**
 * Removes votes belonging to sessions that no longer exist or were revoked.
 */
export function pruneCourseVotes(room: RoomRecord): boolean {
  let changed = false;
  for (const playerId of Object.keys(room.courseVotes)) {
    const session = room.sessions.get(playerId);
    const vote = room.courseVotes[playerId];
    if (!session || session.revoked || !isValidCourseId(vote)) {
      delete room.courseVotes[playerId];
      changed = true;
    }
  }
  return changed;
}

/**
 * Computes vote tally across currently active human sessions.
 */
export function tallyCourseVotes(room: RoomRecord): Record<CourseId, number> {
  const counts: Record<CourseId, number> = {
    tropical: 0,
    volcanic: 0,
    glacial: 0,
    factory: 0,
    storm: 0,
  };
  for (const [playerId, choice] of Object.entries(room.courseVotes)) {
    const session = room.sessions.get(playerId);
    if (!session || session.revoked || !isValidCourseId(choice)) continue;
    counts[choice] += 1;
  }
  return counts;
}

/**
 * Deterministically picks the effective course for a room:
 * - In 'host' mode: uses room.courseId directly.
 * - In 'vote' mode: chooses highest voted course among active players;
 *   ties break by host's vote (if tied for top), then current room.courseId,
 *   then VALID_COURSE_IDS order.
 */
export function resolveEffectiveCourse(room: RoomRecord): CourseId {
  const fallback: CourseId = isValidCourseId(room.courseId) ? room.courseId : 'tropical';
  if (room.courseSelectionMode !== 'vote') {
    return fallback;
  }

  const counts = tallyCourseVotes(room);
  let maxVotes = 0;
  for (const id of VALID_COURSE_IDS) {
    if (counts[id] > maxVotes) {
      maxVotes = counts[id];
    }
  }

  if (maxVotes <= 0) {
    return fallback;
  }

  const tied = VALID_COURSE_IDS.filter((id) => counts[id] === maxVotes);
  if (tied.length === 1) {
    return tied[0];
  }

  const hostVote = room.courseVotes[room.hostId];
  if (hostVote && tied.includes(hostVote)) {
    return hostVote;
  }

  if (tied.includes(fallback)) {
    return fallback;
  }

  return tied[0];
}

/**
 * Synchronizes room.courseId & WAITING preview simulation state to match the effective course.
 */
export function applyCoursePreviewToSim(room: RoomRecord): CourseId {
  pruneCourseVotes(room);
  const resolved = resolveEffectiveCourse(room);
  room.courseId = resolved;
  const course = getCourseById(resolved);
  const settings = normalizeRoomSettings(room.settings);
  room.settings = settings;

  room.sim.courseId = resolved;
  room.sim.gameMode = settings.gameMode;
  room.sim.difficulty = settings.difficulty;
  room.sim.enableItems = settings.enableItems;
  room.sim.roundTimeLimitSec = settings.roundTimeLimitSec;
  room.sim.dynamicZones = createInitialDynamicZones(course);
  room.sim.pickups = createInitialPickups(course, settings.enableItems);
  room.sim.treasures = createInitialTreasures(course, settings.gameMode);
  room.sim.treasureScore = 0;
  room.sim.coinsCollected = 0;
  room.sim.totalCoins = room.sim.treasures.length;
  room.sim.survivalDistance = 0;
  room.sim.survivalSpeedScale = 1;
  room.sim.chaosModifier = 'none';
  room.sim.chaosTimer = settings.gameMode === 'chaos' ? 3.5 : 0;
  room.sim.runOutcome = 'victory';
  room.sim.activeHazardTag = null;

  if (room.lifecycleState === 'WAITING' || room.lifecycleState === 'CREATING') {
    room.sim.raft.x = 0;
    room.sim.raft.y = 0;
    room.sim.raft.z = course.startZ;
    room.sim.progress = 0;
  }

  return resolved;
}
