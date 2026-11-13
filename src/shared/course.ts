import type { ChannelWaypoint, CourseDefinition, MovingGateDef, PlayerZoneBounds } from './types.ts';

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

// Course travels from z = 0 toward negative Z (-330)
export const COURSE_MAIN: CourseDefinition = {
  startZ: 0,
  finishZ: -320,
  finishX: 0,
  finishHalfWidth: 11,
  waypoints: [
    // 1. Start Bay (wide & welcoming)
    { z: 12, centerX: 0, halfWidth: 15 },
    { z: 0, centerX: 0, halfWidth: 14 },
    { z: -24, centerX: 0, halfWidth: 13.5 },
    // 2. Wide Bend Right -> Left
    { z: -52, centerX: 11, halfWidth: 13 },
    { z: -80, centerX: 14, halfWidth: 12 },
    // 3. Narrow Gorge
    { z: -108, centerX: 2, halfWidth: 8.6 },
    { z: -136, centerX: -4, halfWidth: 8.4 },
    // 4. Moving Gates Arena
    { z: -165, centerX: -4, halfWidth: 12.5 },
    // 5. Checkpoint 1 Lagoon
    { z: -186, centerX: 0, halfWidth: 14 },
    // 6. Sharp Hairpin S-Bend
    { z: -214, centerX: -15, halfWidth: 10.5 },
    { z: -242, centerX: 12, halfWidth: 10.5 },
    // 7. Danger Zone & Checkpoint 2
    { z: -264, centerX: 6, halfWidth: 11.5 },
    // 8. Final Gauntlet -> Finish Harbor
    { z: -292, centerX: 0, halfWidth: 9.5 },
    { z: -320, centerX: 0, halfWidth: 13.5 },
    { z: -344, centerX: 0, halfWidth: 15 },
  ],
  checkpoints: [
    { index: 0, z: 0, x: 0, yaw: 0, radius: 6, label: 'نقطة الانطلاق' },
    { index: 1, z: -186, x: 0, yaw: 0, radius: 7.2, label: 'جزيرة الحفظ الأولى' },
    { index: 2, z: -264, x: 6, yaw: 0, radius: 6.8, label: 'بوابة الأمان الأخيرة' },
  ],
  staticObstacles: [
    // Gentle tutorial buoys in start bay
    { id: 'obs-1', kind: 'buoy', x: -6.5, z: -18, radius: 1.5, height: 2.2, restitution: 0.75 },
    { id: 'obs-2', kind: 'buoy', x: 6.5, z: -24, radius: 1.5, height: 2.2, restitution: 0.75 },
    // Wide bend rocks
    { id: 'obs-3', kind: 'rock', x: 3.5, z: -48, radius: 2.4, height: 3.2, restitution: 0.6 },
    { id: 'obs-4', kind: 'rock', x: 18.5, z: -64, radius: 2.7, height: 3.6, restitution: 0.6 },
    { id: 'obs-5', kind: 'bumper', x: 10.5, z: -76, radius: 1.9, height: 2.2, restitution: 1.25 },
    // Narrow gorge pillars
    { id: 'obs-6', kind: 'pillar', x: -3.2, z: -108, radius: 1.7, height: 4.5, restitution: 0.7 },
    { id: 'obs-7', kind: 'pillar', x: 5.5, z: -120, radius: 1.8, height: 4.5, restitution: 0.7 },
    { id: 'obs-8', kind: 'bumper', x: -5.8, z: -132, radius: 1.8, height: 2.2, restitution: 1.25 },
    // Sharp bend hazards
    { id: 'obs-9', kind: 'rock', x: -7.5, z: -206, radius: 2.3, height: 3.4, restitution: 0.65 },
    { id: 'obs-10', kind: 'bumper', x: -16.5, z: -222, radius: 2.0, height: 2.4, restitution: 1.3 },
    { id: 'obs-11', kind: 'rock', x: 3.0, z: -234, radius: 2.3, height: 3.3, restitution: 0.65 },
    { id: 'obs-12', kind: 'bumper', x: 14.5, z: -248, radius: 2.0, height: 2.4, restitution: 1.3 },
    // Final gauntlet buoys
    { id: 'obs-13', kind: 'pillar', x: -3.6, z: -286, radius: 1.65, height: 4.4, restitution: 0.75 },
    { id: 'obs-14', kind: 'pillar', x: 3.6, z: -298, radius: 1.65, height: 4.4, restitution: 0.75 },
  ],
  movingGates: [
    {
      id: 'gate-1',
      baseX: -4,
      z: -154,
      halfWidth: 3.4,
      depth: 1.6,
      amplitudeX: 5.4,
      speed: 1.35,
      phaseOffset: 0,
    },
    {
      id: 'gate-2',
      baseX: -4,
      z: -172,
      halfWidth: 3.6,
      depth: 1.6,
      amplitudeX: 5.6,
      speed: 1.55,
      phaseOffset: Math.PI,
    },
    {
      id: 'gate-3',
      baseX: 0,
      z: -306,
      halfWidth: 3.2,
      depth: 1.6,
      amplitudeX: 4.6,
      speed: 1.75,
      phaseOffset: Math.PI * 0.5,
    },
  ],
  boostPads: [
    { id: 'boost-1', x: 11, z: -58, radius: 3.2, dirX: 0.25, dirZ: -0.97, strength: 16 },
    { id: 'boost-2', x: -12, z: -216, radius: 3.2, dirX: 0.35, dirZ: -0.94, strength: 17 },
    { id: 'boost-3', x: 0, z: -276, radius: 3.4, dirX: 0, dirZ: -1, strength: 18 },
  ],
};

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

export function getCourseProgress(z: number, course: CourseDefinition = COURSE_MAIN): number {
  const total = course.startZ - course.finishZ;
  if (total <= 0) return 0;
  const raw = (course.startZ - z) / total;
  return Math.max(0, Math.min(1, raw));
}
