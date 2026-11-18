import { COURSE_FACTORY } from './courses/factory.ts';
import { COURSE_GLACIAL } from './courses/glacial.ts';
import { COURSE_STORM } from './courses/storm.ts';
import { COURSE_TROPICAL } from './courses/tropical.ts';
import { COURSE_VOLCANIC } from './courses/volcanic.ts';
import type {
  ChannelWaypoint,
  CourseDefinition,
  CourseId,
  FallingHazardDef,
  MovingGateDef,
  PlayerZoneBounds,
  WindZoneDef,
} from './types.ts';

export const RAFT_WIDTH = 5.2;
export const RAFT_LENGTH = 6.4;
export const RAFT_RADIUS = 2.65;

export const CHARACTER_PRESETS = [
  { name: 'فرفوش', baseColor: '#ff595e', accentColor: '#ffd166' },
  { name: 'زعبوط', baseColor: '#1982c4', accentColor: '#8ac926' },
  { name: 'بطبوط', baseColor: '#ffca3a', accentColor: '#ff595e' },
  { name: 'لوليتا', baseColor: '#9b5de5', accentColor: '#f15bb5' },
] as const;

export const PLAYER_ZONES: readonly [
  PlayerZoneBounds,
  PlayerZoneBounds,
  PlayerZoneBounds,
  PlayerZoneBounds,
] = [
  { slot: 0, minX: -2.15, maxX: -0.45, defaultX: -1.3, zoneZ: 1.55, label: 'الخلف يسار' },
  { slot: 1, minX: 0.45, maxX: 2.15, defaultX: 1.3, zoneZ: 1.55, label: 'الخلف يمين' },
  { slot: 2, minX: -2.15, maxX: -0.45, defaultX: -1.3, zoneZ: -1.15, label: 'الأمام يسار' },
  { slot: 3, minX: 0.45, maxX: 2.15, defaultX: 1.3, zoneZ: -1.15, label: 'الأمام يمين' },
];

export const VALID_COURSE_IDS: readonly CourseId[] = ['tropical', 'volcanic', 'glacial', 'factory', 'storm'];

export const COURSE_CATALOG: Record<CourseId, CourseDefinition> = {
  tropical: COURSE_TROPICAL,
  volcanic: COURSE_VOLCANIC,
  glacial: COURSE_GLACIAL,
  factory: COURSE_FACTORY,
  storm: COURSE_STORM,
};

export const COURSE_LIST: readonly CourseDefinition[] = VALID_COURSE_IDS.map(
  (id) => COURSE_CATALOG[id],
);

// Preserve COURSE_MAIN export alias for full backward compatibility
export const COURSE_MAIN: CourseDefinition = COURSE_TROPICAL;

export { COURSE_TROPICAL, COURSE_VOLCANIC, COURSE_GLACIAL, COURSE_FACTORY, COURSE_STORM };

export function isValidCourseId(value: unknown): value is CourseId {
  return (
    value === 'tropical' ||
    value === 'volcanic' ||
    value === 'glacial' ||
    value === 'factory' ||
    value === 'storm'
  );
}

export function getCourseById(id?: unknown): CourseDefinition {
  if (isValidCourseId(id)) {
    return COURSE_CATALOG[id];
  }
  return COURSE_TROPICAL;
}

export function getChannelBoundsAtZ(
  z: number,
  waypoints: readonly ChannelWaypoint[] = COURSE_MAIN.waypoints,
): { centerX: number; halfWidth: number } {
  if (z >= waypoints[0].z) {
    return { centerX: waypoints[0].centerX, halfWidth: waypoints[0].halfWidth };
  }
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (z <= a.z && z >= b.z) {
      const span = a.z - b.z;
      const t = span > 0.0001 ? (a.z - z) / span : 0;
      const smooth = t * t * (3 - 2 * t);
      return {
        centerX: a.centerX + (b.centerX - a.centerX) * smooth,
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * smooth,
      };
    }
  }
  const last = waypoints[waypoints.length - 1];
  return { centerX: last.centerX, halfWidth: last.halfWidth };
}

export function getMovingGateCenterX(gate: MovingGateDef, simTime: number): number {
  return gate.baseX + Math.sin(simTime * gate.speed + gate.phaseOffset) * gate.amplitudeX;
}

export interface MovingGateTransform {
  x: number;
  y: number;
  z: number;
  blocksChannel: boolean;
  warningPulse: number;
}

/**
 * Deterministic transform & collision activity for horizontal gates and rhythmic vertical hydraulic pistons.
 */
export function getMovingGateTransform(gate: MovingGateDef, simTime: number): MovingGateTransform {
  if (gate.motion === 'vertical_piston') {
    const period = Math.max(1.2, gate.slamPeriod ?? 3.6);
    const closedRatio = Math.max(0.15, Math.min(0.75, gate.closedRatio ?? 0.4));
    const phase = (((simTime + gate.phaseOffset) % period) + period) % period;
    const u = phase / period; // 0..1

    // 0 .. (1 - closedRatio - 0.15): raised open high above water (y = 5.4)
    // warning window before slam: slight hover & strobe
    // slam down cleanly to y = 0.05 during closed window, then retract smoothly
    const openEnd = 1 - closedRatio;
    const transition = 0.12;
    let y = 5.4;
    let warningPulse = 0;

    if (u < openEnd - transition) {
      y = 5.4;
      if (u > openEnd - transition - 0.18) {
        warningPulse = 0.6 + 0.4 * Math.sin(simTime * 24);
      }
    } else if (u < openEnd) {
      const k = (u - (openEnd - transition)) / transition;
      const eased = k * k;
      y = 5.4 * (1 - eased) + 0.05 * eased;
      warningPulse = 1;
    } else if (u < 1 - transition * 0.7) {
      y = 0.05;
      warningPulse = 0.35;
    } else {
      const k = (u - (1 - transition * 0.7)) / (transition * 0.7);
      y = 0.05 * (1 - k) + 5.4 * k;
    }

    return {
      x: gate.baseX,
      y,
      z: gate.z,
      blocksChannel: y <= 1.55,
      warningPulse,
    };
  }

  return {
    x: getMovingGateCenterX(gate, simTime),
    y: Math.sin(simTime * 2.5 + gate.phaseOffset) * 0.08,
    z: gate.z,
    blocksChannel: true,
    warningPulse: 0,
  };
}

export function isWindZoneActive(zone: WindZoneDef, simTime: number): boolean {
  if (!zone.cyclePeriod || zone.cyclePeriod <= 0) {
    return true;
  }
  const duty = zone.dutyCycle ?? 0.6;
  const offset = zone.phaseOffset ?? 0;
  const phase = (((simTime + offset) % zone.cyclePeriod) + zone.cyclePeriod) % zone.cyclePeriod;
  return phase / zone.cyclePeriod < duty;
}

/**
 * Returns deterministic falling-hazard cycle phase in [0, 1).
 * 0.0 -> impact moment; last `warningFraction` before 1.0 -> telegraph warning + descending rock!
 */
export function getFallingHazardCycle(
  hazard: FallingHazardDef,
  simTime: number,
): {
  cycleU: number;
  timeUntilImpact: number;
  inWarning: boolean;
  heightY: number;
} {
  const period = Math.max(1.5, hazard.period);
  const phase = (((simTime + hazard.phaseOffset) % period) + period) % period;
  const timeUntilImpact = period - phase;
  const inWarning = timeUntilImpact <= hazard.warningDuration;
  const warningFrac = inWarning ? 1 - timeUntilImpact / hazard.warningDuration : 0;
  // Drop from y = 26 -> y = 0.3 accelerating quadratically during warning window
  const heightY = inWarning ? 26 * Math.pow(1 - warningFrac, 1.85) + 0.35 : 34;

  return {
    cycleU: phase / period,
    timeUntilImpact,
    inWarning,
    heightY,
  };
}

export function getCourseProgress(z: number, course: CourseDefinition = COURSE_MAIN): number {
  const total = course.startZ - course.finishZ;
  if (total <= 0) return 0;
  const raw = (course.startZ - z) / total;
  return Math.max(0, Math.min(1, raw));
}
