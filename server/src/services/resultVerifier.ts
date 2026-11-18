import { getCourseById, isValidCourseId } from '../../../src/shared/course.ts';
import { isValidDifficulty, isValidGameMode } from '../../../src/shared/physics.ts';
import type { MatchSummaryInput, MatchVerificationResult } from '../../../src/shared/types.ts';

/**
 * Physical theoretical maximum effective forward speed (with lentil boost + Super Fart + pads).
 * Used to detect impossible clear times / client score tampering (TECH-03).
 */
const MAX_PLAUSIBLE_AVG_SPEED_MPS = 32;
const MAX_COINS_PER_ROUND = 200;
const MAX_TREASURE_SCORE_PER_ROUND = 4000;
const MAX_ITEMS_PER_SEC = 2.0;

export function verifyMatchResult(
  raw: Partial<MatchSummaryInput>,
  options?: { isAuthoritativeRoom?: boolean },
): MatchVerificationResult {
  const warnings: string[] = [];

  if (!isValidCourseId(raw.courseId)) {
    return {
      ok: false,
      reasonCode: 'INVALID_COURSE',
      reasonAr: 'معرف المسار في نتيجة الجولة غير صالح.',
    };
  }
  if (!isValidGameMode(raw.gameMode)) {
    return {
      ok: false,
      reasonCode: 'INVALID_GAME_MODE',
      reasonAr: 'نمط اللعب في نتيجة الجولة غير صالح.',
    };
  }
  if (!isValidDifficulty(raw.difficulty)) {
    return {
      ok: false,
      reasonCode: 'INVALID_DIFFICULTY',
      reasonAr: 'مستوى الصعوبة في نتيجة الجولة غير صالح.',
    };
  }
  if (raw.outcome !== 'victory' && raw.outcome !== 'defeat') {
    return {
      ok: false,
      reasonCode: 'INVALID_OUTCOME',
      reasonAr: 'حالة نتيجة الجولة غير صالحة.',
    };
  }

  const elapsed = raw.elapsedTimeSec;
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 36_000) {
    return {
      ok: false,
      reasonCode: 'INVALID_ELAPSED_TIME',
      reasonAr: 'زمن الجولة المسجل خارج النطاق المقبول.',
    };
  }

  const course = getCourseById(raw.courseId);
  const courseSpan = Math.max(120, Math.abs(course.finishZ - course.startZ));
  const minPlausibleWinSec = Math.max(4.5, Number((courseSpan / MAX_PLAUSIBLE_AVG_SPEED_MPS).toFixed(2)));

  // Non-survival victories cannot finish faster than physics allows traversing the full channel
  if (raw.outcome === 'victory' && raw.gameMode !== 'survival' && elapsed < minPlausibleWinSec) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_CLEAR_TIME',
      reasonAr: `زمن الفوز (${elapsed.toFixed(1)}ث) أسرع من الحد الفيزيائي الممكن (${minPlausibleWinSec}ث).`,
    };
  }

  const falls = raw.falls ?? 0;
  if (typeof falls !== 'number' || !Number.isFinite(falls) || falls < 0 || falls > 300) {
    return {
      ok: false,
      reasonCode: 'INVALID_FALLS_COUNT',
      reasonAr: 'عدد السقوطات المسجل غير منطقي.',
    };
  }

  const treasureScore = raw.treasureScore ?? 0;
  if (
    typeof treasureScore !== 'number' ||
    !Number.isFinite(treasureScore) ||
    treasureScore < 0 ||
    treasureScore > MAX_TREASURE_SCORE_PER_ROUND
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_TREASURE_SCORE',
      reasonAr: 'نقاط الكنوز المسجلة تتجاوز الحد الممكن في الجولة.',
    };
  }

  const itemsUsed = raw.itemsUsed ?? 0;
  if (
    typeof itemsUsed !== 'number' ||
    !Number.isFinite(itemsUsed) ||
    itemsUsed < 0 ||
    itemsUsed > Math.max(25, Math.ceil(elapsed * MAX_ITEMS_PER_SEC) + 15)
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_ITEMS_USED',
      reasonAr: 'عدد الأدوات المستخدمة غير متسق مع مدة الجولة.',
    };
  }

  const pushContribution = raw.pushContribution ?? 0;
  if (
    typeof pushContribution !== 'number' ||
    !Number.isFinite(pushContribution) ||
    pushContribution < 0 ||
    pushContribution > Math.max(1500, elapsed * 420)
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_PUSH_SCORE',
      reasonAr: 'مساهمة الدفع المسجلة تتجاوز السقف الفيزيائي الممكن.',
    };
  }

  const fartTimeSec = raw.fartTimeSec ?? 0;
  if (
    typeof fartTimeSec !== 'number' ||
    !Number.isFinite(fartTimeSec) ||
    fartTimeSec < 0 ||
    fartTimeSec > Math.max(8, elapsed * 1.15 + 2)
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_THRUST_DURATION',
      reasonAr: 'مدة الدفع المسجلة تتجاوز مدة الجولة الفعلية.',
    };
  }

  const survivalDistance = raw.survivalDistance ?? 0;
  if (
    typeof survivalDistance !== 'number' ||
    !Number.isFinite(survivalDistance) ||
    survivalDistance < 0 ||
    survivalDistance > Math.max(400, elapsed * (MAX_PLAUSIBLE_AVG_SPEED_MPS + 4))
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_SURVIVAL_DISTANCE',
      reasonAr: 'مسافة البقاء المسجلة تتجاوز أقصى سرعة ممكنة.',
    };
  }

  const minRaftHp = raw.minRaftHp ?? 100;
  if (typeof minRaftHp !== 'number' || !Number.isFinite(minRaftHp) || minRaftHp < 0 || minRaftHp > 100) {
    return {
      ok: false,
      reasonCode: 'INVALID_RAFT_HP',
      reasonAr: 'قيمة متانة الطوف الدنيا غير صالحة.',
    };
  }

  const collisionCount = raw.collisionCount ?? 0;
  if (typeof collisionCount !== 'number' || !Number.isFinite(collisionCount) || collisionCount < 0 || collisionCount > 500) {
    return {
      ok: false,
      reasonCode: 'INVALID_COLLISIONS',
      reasonAr: 'عدد التصادمات المسجل غير صالح.',
    };
  }

  const maxHardGates =
    raw.gameMode === 'survival'
      ? Math.max(course.movingGates.length * 2, Math.ceil(elapsed / 6) + 6)
      : Math.max(course.movingGates.length * 2, 12);
  const hardGatesPassed = raw.hardGatesPassed ?? 0;
  if (
    typeof hardGatesPassed !== 'number' ||
    !Number.isInteger(hardGatesPassed) ||
    hardGatesPassed < 0 ||
    hardGatesPassed > Math.min(80, maxHardGates)
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_HARD_GATES',
      reasonAr: 'عدد البوابات الصعبة المجتازة يتجاوز حدود المسار.',
    };
  }

  const maxCleanCheckpoints =
    raw.gameMode === 'survival'
      ? Math.max(course.checkpoints.length, Math.ceil(elapsed / 8) + 4)
      : Math.max(1, course.checkpoints.length);
  const cleanCheckpoints = raw.cleanCheckpoints ?? 0;
  if (
    typeof cleanCheckpoints !== 'number' ||
    !Number.isInteger(cleanCheckpoints) ||
    cleanCheckpoints < 0 ||
    cleanCheckpoints > maxCleanCheckpoints
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_CLEAN_CHECKPOINTS',
      reasonAr: 'عدد نقاط الحفظ النظيفة يتجاوز عدد نقاط المسار.',
    };
  }

  const harmonyCombos = raw.harmonyCombos ?? 0;
  const maxHarmonyCombos = Math.max(4, Math.ceil(elapsed / 2.2) + 2);
  if (
    typeof harmonyCombos !== 'number' ||
    !Number.isInteger(harmonyCombos) ||
    harmonyCombos < 0 ||
    harmonyCombos > Math.min(120, maxHarmonyCombos)
  ) {
    return {
      ok: false,
      reasonCode: 'IMPLAUSIBLE_HARMONY_COMBOS',
      reasonAr: 'عدد تناغمات النفخة الخارقة يتجاوز الممكن خلال مدة الجولة.',
    };
  }

  if (options?.isAuthoritativeRoom && raw.gameMode === 'treasure' && treasureScore > MAX_COINS_PER_ROUND * 20) {
    warnings.push('AUTHORITATIVE_HIGH_TREASURE_SCORE');
  } else if (raw.gameMode === 'treasure' && treasureScore > MAX_COINS_PER_ROUND * 20) {
    warnings.push('HIGH_TREASURE_SCORE');
  }

  return { ok: true, warnings };
}

const VALID_REPLAY_EVENT_TYPES = new Set([
  'collision',
  'hazard_hit',
  'checkpoint',
  'fall',
  'pickup',
  'super_fart',
  'shield_block',
  'shockwave',
  'lightning',
  'finish',
  'chaos_shift',
  'coin',
]);

export function validateReplayPayload(
  candidate: Record<string, unknown>,
): { ok: true } | { ok: false; reasonAr: string } {
  const frames = candidate.frames;
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > 480) {
    return { ok: false, reasonAr: 'إطارات الإعادة غير صالحة أو فارغة.' };
  }

  let prevT = -1;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as Record<string, unknown> | null;
    if (!f || typeof f !== 'object') {
      return { ok: false, reasonAr: 'تنسيق أحد إطارات الإعادة غير صالح.' };
    }
    const numFields = ['t', 'x', 'z', 'yaw', 'progress', 'raftHp', 'harmony', 'windX'] as const;
    for (const k of numFields) {
      const v = f[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, reasonAr: `قيمة رقمية غير صالحة (${k}) في إطار الإعادة.` };
      }
    }
    if ((f.t as number) < prevT || (f.t as number) < 0 || (f.t as number) > 36_000) {
      return { ok: false, reasonAr: 'تسلسل زمن إطارات الإعادة غير منطقي.' };
    }
    if ((f.raftHp as number) < 0 || (f.raftHp as number) > 100) {
      return { ok: false, reasonAr: 'قيمة متانة الطوف في الإعادة خارج النطاق.' };
    }
    if ((f.progress as number) < 0 || (f.progress as number) > 1.05) {
      return { ok: false, reasonAr: 'نسبة التقدم في الإعادة خارج النطاق.' };
    }
    prevT = f.t as number;
  }

  const players = candidate.players;
  if (players !== undefined) {
    if (!Array.isArray(players) || players.length > 4) {
      return { ok: false, reasonAr: 'قائمة لاعبي الإعادة غير صالحة.' };
    }
    for (const p of players) {
      if (!p || typeof p !== 'object') {
        return { ok: false, reasonAr: 'بيانات أحد اللاعبين في الإعادة غير صالحة.' };
      }
      const pr = p as Record<string, unknown>;
      if (
        typeof pr.slot !== 'number' ||
        !Number.isInteger(pr.slot) ||
        pr.slot < 0 ||
        pr.slot > 3 ||
        typeof pr.name !== 'string' ||
        pr.name.length === 0 ||
        pr.name.length > 40 ||
        typeof pr.isBot !== 'boolean'
      ) {
        return { ok: false, reasonAr: 'حقول اللاعب في الإعادة غير مكتملة أو غير صالحة.' };
      }
    }
  }

  const events = candidate.events;
  if (events !== undefined) {
    if (!Array.isArray(events) || events.length > 160) {
      return { ok: false, reasonAr: 'قائمة أحداث الإعادة غير صالحة.' };
    }
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') {
        return { ok: false, reasonAr: 'تنسيق أحد أحداث الإعادة غير صالح.' };
      }
      const er = ev as Record<string, unknown>;
      if (
        typeof er.t !== 'number' ||
        !Number.isFinite(er.t) ||
        er.t < 0 ||
        typeof er.x !== 'number' ||
        !Number.isFinite(er.x) ||
        typeof er.z !== 'number' ||
        !Number.isFinite(er.z) ||
        typeof er.type !== 'string' ||
        !VALID_REPLAY_EVENT_TYPES.has(er.type)
      ) {
        return { ok: false, reasonAr: 'حدث غير صالح داخل بيانات الإعادة.' };
      }
    }
  }

  return { ok: true };
}

