import { GAME_VERSION, MIN_COMPATIBLE_PROTOCOL_VERSION, PROTOCOL_VERSION } from '../../../src/shared/protocol.ts';
import type {
  BalanceAnalyticsResponse,
  CourseBalanceStats,
  CourseId,
  GameMode,
  RoomOpsMetricsSummary,
  RoundReplayRecord,
  RoundReplaySummary,
  ServerHealthSnapshot,
  VerifiedMatchRecord,
} from '../../../src/shared/types.ts';

const MAX_LATENCY_SAMPLES = 256;
const MAX_FALLBACK_REPLAYS = 40;
const MAX_FALLBACK_VERIFIED = 200;

class OpsMetricsCollector {
  private readonly startedAtMs = Date.now();
  private activeRooms = new Map<string, RoomOpsMetricsSummary>();
  private latencySamples: number[] = [];
  private httpRequestsTotal = 0;
  private http2xxCount = 0;
  private http4xxCount = 0;
  private http5xxCount = 0;
  private disconnectCount = 0;
  private reconnectCount = 0;
  private tempSubstitutesActivated = 0;
  private verifiedMatchesCount = 0;
  private rejectedMatchesCount = 0;

  // In-memory fallbacks when D1 binding is absent (e.g., stripped unit test mocks)
  private fallbackVerifiedKeys = new Set<string>();
  private fallbackVerifiedRecords: VerifiedMatchRecord[] = [];
  private fallbackBalanceMap = new Map<string, CourseBalanceStats & { totalClearTimeSec: number; totalFalls: number; totalCollisions: number; totalItemsUsed: number }>();
  private fallbackReplays = new Map<string, RoundReplayRecord>();

  public updateRoomSummary(summary: RoomOpsMetricsSummary): void {
    if (summary.lifecycleState === 'CLOSED') {
      this.activeRooms.delete(summary.roomCode);
      return;
    }
    this.activeRooms.set(summary.roomCode, summary);
  }

  public removeRoom(roomCode: string): void {
    this.activeRooms.delete(roomCode);
  }

  public recordHttpRequest(durationMs: number, status: number): void {
    this.httpRequestsTotal += 1;
    if (status >= 500) this.http5xxCount += 1;
    else if (status >= 400) this.http4xxCount += 1;
    else if (status >= 200 && status < 300) this.http2xxCount += 1;

    const clamped = Math.max(0, Math.round(durationMs * 100) / 100);
    this.latencySamples.push(clamped);
    if (this.latencySamples.length > MAX_LATENCY_SAMPLES) {
      this.latencySamples.shift();
    }
  }

  public recordDisconnect(): void {
    this.disconnectCount += 1;
  }

  public recordReconnect(): void {
    this.reconnectCount += 1;
  }

  public recordTempSubstituteActivated(count = 1): void {
    this.tempSubstitutesActivated += Math.max(0, count);
  }

  public recordVerifiedMatch(record: VerifiedMatchRecord): boolean {
    if (this.fallbackVerifiedKeys.has(record.submissionKey)) {
      return false;
    }
    this.fallbackVerifiedKeys.add(record.submissionKey);
    this.verifiedMatchesCount += 1;
    this.fallbackVerifiedRecords.unshift(record);
    if (this.fallbackVerifiedRecords.length > MAX_FALLBACK_VERIFIED) {
      this.fallbackVerifiedRecords.pop();
    }

    const key = `${record.courseId}:${record.gameMode}`;
    const existing = this.fallbackBalanceMap.get(key);
    const isWin = record.outcome === 'victory' ? 1 : 0;
    if (!existing) {
      const totalRuns = 1;
      const wins = isWin;
      const totalClearTimeSec = isWin ? record.elapsedTimeSec : 0;
      const totalFalls = record.falls;
      const totalCollisions = record.collisionCount;
      const totalItemsUsed = record.itemsUsed;
      this.fallbackBalanceMap.set(key, {
        courseId: record.courseId,
        gameMode: record.gameMode,
        totalRuns,
        wins,
        winRatePct: Number(((wins / totalRuns) * 100).toFixed(1)),
        avgClearTimeSec: isWin ? Number(record.elapsedTimeSec.toFixed(1)) : 0,
        avgFalls: Number(totalFalls.toFixed(2)),
        avgCollisionCount: Number(totalCollisions.toFixed(2)),
        avgItemsUsed: Number(totalItemsUsed.toFixed(2)),
        lastUpdatedAt: record.verifiedAt,
        totalClearTimeSec,
        totalFalls,
        totalCollisions,
        totalItemsUsed,
      });
    } else {
      existing.totalRuns += 1;
      existing.wins += isWin;
      if (isWin) existing.totalClearTimeSec += record.elapsedTimeSec;
      existing.totalFalls += record.falls;
      existing.totalCollisions += record.collisionCount;
      existing.totalItemsUsed += record.itemsUsed;
      existing.winRatePct = Number(((existing.wins / existing.totalRuns) * 100).toFixed(1));
      existing.avgClearTimeSec =
        existing.wins > 0 ? Number((existing.totalClearTimeSec / existing.wins).toFixed(1)) : 0;
      existing.avgFalls = Number((existing.totalFalls / existing.totalRuns).toFixed(2));
      existing.avgCollisionCount = Number((existing.totalCollisions / existing.totalRuns).toFixed(2));
      existing.avgItemsUsed = Number((existing.totalItemsUsed / existing.totalRuns).toFixed(2));
      existing.lastUpdatedAt = record.verifiedAt;
    }

    return true;
  }

  public recordVerificationRejection(): void {
    this.rejectedMatchesCount += 1;
  }

  public saveFallbackReplay(replay: RoundReplayRecord): boolean {
    if (this.fallbackReplays.has(replay.matchId)) {
      return false;
    }
    this.fallbackReplays.set(replay.matchId, replay);
    if (this.fallbackReplays.size > MAX_FALLBACK_REPLAYS) {
      const oldestKey = this.fallbackReplays.keys().next().value;
      if (oldestKey) this.fallbackReplays.delete(oldestKey);
    }
    return true;
  }

  public getFallbackReplay(matchId: string): RoundReplayRecord | null {
    return this.fallbackReplays.get(matchId) ?? null;
  }

  public listFallbackReplays(filter?: { courseId?: CourseId; gameMode?: GameMode; limit?: number }): RoundReplaySummary[] {
    const limit = Math.max(1, Math.min(50, filter?.limit ?? 20));
    const list = Array.from(this.fallbackReplays.values())
      .filter((r) => (!filter?.courseId || r.courseId === filter.courseId) && (!filter?.gameMode || r.gameMode === filter.gameMode))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => ({
        matchId: r.matchId,
        roomCode: r.roomCode,
        mode: r.mode,
        courseId: r.courseId,
        gameMode: r.gameMode,
        difficulty: r.difficulty,
        outcome: r.outcome,
        durationSec: r.durationSec,
        falls: r.falls,
        treasureScore: r.treasureScore,
        survivalDistance: r.survivalDistance,
        frameCount: r.frames.length,
        eventCount: r.events.length,
        createdAt: r.createdAt,
      }));
    return list;
  }

  public getFallbackAnalytics(filter?: { courseId?: CourseId; gameMode?: GameMode }): BalanceAnalyticsResponse {
    const courses: CourseBalanceStats[] = Array.from(this.fallbackBalanceMap.values())
      .filter((c) => (!filter?.courseId || c.courseId === filter.courseId) && (!filter?.gameMode || c.gameMode === filter.gameMode))
      .map(({ totalClearTimeSec: _c, totalFalls: _f, totalCollisions: _col, totalItemsUsed: _it, ...rest }) => rest)
      .sort((a, b) => b.totalRuns - a.totalRuns);
    const totalVerifiedMatches = courses.reduce((s, c) => s + c.totalRuns, 0);
    return {
      totalVerifiedMatches,
      courses,
      generatedAt: Date.now(),
    };
  }

  public getHealthSnapshot(options: {
    runtime: string;
    d1Connected: boolean;
    d1VerifiedCount?: number;
    nowMs?: number;
  }): ServerHealthSnapshot {
    const nowMs = options.nowMs ?? Date.now();
    // Prune stale inactive room entries older than 10 minutes
    for (const [code, r] of this.activeRooms.entries()) {
      if (nowMs - r.updatedAt > 10 * 60 * 1000) {
        this.activeRooms.delete(code);
      }
    }

    const activeRooms = Array.from(this.activeRooms.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    let totalHumansOnline = 0;
    let totalBotsActive = 0;
    let totalTempSubstitutesActive = 0;
    let totalSpectatorsOnline = 0;
    for (const r of activeRooms) {
      totalHumansOnline += r.humanCount;
      totalBotsActive += r.botCount;
      totalTempSubstitutesActive += r.tempSubstituteCount;
      totalSpectatorsOnline += r.spectatorCount;
    }

    let avgLatencyMs = 0;
    let p95LatencyMs = 0;
    if (this.latencySamples.length > 0) {
      const sum = this.latencySamples.reduce((a, b) => a + b, 0);
      avgLatencyMs = Number((sum / this.latencySamples.length).toFixed(2));
      const sorted = [...this.latencySamples].sort((a, b) => a - b);
      const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      p95LatencyMs = Number(sorted[p95Idx].toFixed(2));
    }

    return {
      ok: true,
      service: 'letsfart-worker',
      runtime: options.runtime,
      gameVersion: GAME_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      minCompatibleProtocolVersion: MIN_COMPATIBLE_PROTOCOL_VERSION,
      uptimeSec: Math.max(0, Math.floor((nowMs - this.startedAtMs) / 1000)),
      timestamp: nowMs,
      d1Connected: options.d1Connected,
      activeRoomsCount: activeRooms.length,
      totalHumansOnline,
      totalBotsActive,
      totalTempSubstitutesActive,
      totalSpectatorsOnline,
      disconnectCount: this.disconnectCount,
      reconnectCount: this.reconnectCount,
      tempSubstitutesActivated: this.tempSubstitutesActivated,
      verifiedMatchesCount: Math.max(this.verifiedMatchesCount, options.d1VerifiedCount ?? 0),
      rejectedMatchesCount: this.rejectedMatchesCount,
      httpRequestsTotal: this.httpRequestsTotal,
      http2xxCount: this.http2xxCount,
      http4xxCount: this.http4xxCount,
      http5xxCount: this.http5xxCount,
      avgLatencyMs,
      p95LatencyMs,
      metricsScope: 'isolate_local',
      metricsNoteAr:
        'عدادات الأداء والغرف النشطة تقريبية ومحلية لنسخة الـ Worker الحالية، بينما إحصاءات المباريات والتحليلات تُحفظ مركزياً في D1.',
      activeRooms,
    };
  }
}

export const opsMetrics = new OpsMetricsCollector();
