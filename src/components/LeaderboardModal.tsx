import React, { useEffect, useState } from 'react';
import { COURSE_LIST } from '../shared/course.ts';
import type { LeaderboardHttpResponse } from '../shared/protocol.ts';
import type { CourseId, LeaderboardMetric, LeaderboardScope } from '../shared/types.ts';
import { fetchLeaderboard } from '../net/progressionClient.ts';
import { CosmeticAvatarSvg } from './ProfileModal.tsx';

interface LeaderboardModalProps {
  partyAccountIds?: string[];
  onClose: () => void;
}

const SCOPES: { id: LeaderboardScope; label: string }[] = [
  { id: 'global', label: 'العالمي' },
  { id: 'weekly', label: 'الأسبوعي' },
  { id: 'friends', label: 'الأصدقاء' },
];

const METRICS: { id: LeaderboardMetric; label: string }[] = [
  { id: 'best_time', label: 'أفضل زمن' },
  { id: 'wins', label: 'الانتصارات' },
  { id: 'challenge_points', label: 'نقاط التحدي' },
];

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  partyAccountIds = [],
  onClose,
}) => {
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [metric, setMetric] = useState<LeaderboardMetric>('best_time');
  const [courseId, setCourseId] = useState<CourseId | 'all'>('all');
  const [data, setData] = useState<LeaderboardHttpResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    fetchLeaderboard({
      metric,
      scope,
      courseId: metric === 'best_time' ? courseId : 'all',
      partyIds: partyAccountIds,
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg((err as Error).message || 'تعذر تحميل لوحة المتصدرين');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric, scope, courseId, partyAccountIds]);

  const formatMetricValue = (entry: LeaderboardHttpResponse['entries'][number]) => {
    if (metric === 'best_time') {
      return entry.bestTimeSec !== null ? `${entry.bestTimeSec.toFixed(2)}ث` : '—';
    }
    if (metric === 'wins') {
      return `${entry.wins} فوز`;
    }
    return `${entry.challengePoints} نقطة`;
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/75">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="لوحة المتصدرين"
        data-testid="leaderboard-modal"
        className="wood-panel w-full max-w-3xl rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
              لوحة المتصدرين
            </h2>
            <p className="text-xs font-bold text-[#b8d8f8] mt-0.5 tabular-nums">
              {data ? (
                <>
                  الأسبوع{' '}
                  <span dir="ltr" className="inline-block">
                    {data.weekKey}
                  </span>{' '}
                  · {data.total} متنافس
                </>
              ) : (
                'تصنيف أبطال الطوف المجنونة'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="leaderboard-close-btn"
            className="px-3.5 py-2 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#cbd5e1] cursor-pointer whitespace-nowrap shrink-0"
          >
            إغلاق
          </button>
        </div>

        {/* Scope & Metric Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
          <div className="flex items-center gap-1.5 bg-[#0c1d2e] p-1 rounded-xl border border-[#2a4c6e]">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid={`lb-scope-${s.id}`}
                onClick={() => setScope(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap ${
                  scope === s.id ? 'bg-[#ffd13b] text-[#14222f]' : 'text-[#cbd5e1] hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 bg-[#0c1d2e] p-1 rounded-xl border border-[#2a4c6e]">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                data-testid={`lb-metric-${m.id}`}
                onClick={() => setMetric(m.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap ${
                  metric === m.id ? 'bg-[#38bdf8] text-[#082f49]' : 'text-[#cbd5e1] hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {metric === 'best_time' && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            <button
              type="button"
              onClick={() => setCourseId('all')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer whitespace-nowrap ${
                courseId === 'all'
                  ? 'bg-[#06d6a0] text-[#082f49]'
                  : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
              }`}
            >
              جميع المسارات
            </button>
            {COURSE_LIST.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCourseId(c.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer whitespace-nowrap ${
                  courseId === c.id
                    ? 'bg-[#06d6a0] text-[#082f49]'
                    : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
                }`}
              >
                {c.meta.nameAr}
              </button>
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="mb-3 rounded-xl bg-[#ff595e]/20 border border-[#ff595e] px-3 py-2 text-xs font-bold text-[#ffb4b6]">
            {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm font-bold text-[#93c5fd]">
            جارٍ تحميل الترتيب...
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-6 text-center text-xs font-bold text-[#93c5fd]">
            لا توجد نتائج مسجلة في هذا التصنيف بعد. العب جولة جديدة لتصدر القائمة!
          </div>
        ) : (
          <div className="space-y-2">
            {data.entries.map((entry) => {
              const rankColor =
                entry.rank === 1
                  ? 'text-[#ffd13b]'
                  : entry.rank === 2
                    ? 'text-[#e2e8f0]'
                    : entry.rank === 3
                      ? 'text-[#f59e0b]'
                      : 'text-[#93c5fd]';
              return (
                <div
                  key={entry.accountId}
                  data-testid={`lb-row-${entry.rank}`}
                  className={`rounded-2xl px-3.5 py-2.5 border flex items-center justify-between gap-3 ${
                    entry.isSelf
                      ? 'bg-[#15354f] border-[#06d6a0]'
                      : 'bg-[#102438] border-[#2a4c6e]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-base sm:text-lg font-black w-7 text-center tabular-nums shrink-0 ${rankColor}`}>
                      #{entry.rank}
                    </span>
                    <CosmeticAvatarSvg cosmetic={entry.cosmetic} size={38} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-black text-sm text-white truncate">
                          {entry.displayName}
                        </span>
                        {entry.isSelf && (
                          <span className="text-[11px] font-black text-[#06d6a0]">(أنت)</span>
                        )}
                      </div>
                      <div className="text-[11px] font-bold text-[#93c5fd] tabular-nums">
                        {entry.username ? (
                          <>
                            <span dir="ltr" className="inline-block">
                              @{entry.username}
                            </span>{' '}
                            ·{' '}
                          </>
                        ) : (
                          'ضيف · '
                        )}
                        المستوى {entry.level} · {entry.roundsPlayed} جولة
                      </div>
                    </div>
                  </div>

                  <div className="text-left shrink-0">
                    <div className="text-sm sm:text-base font-black text-[#ffd13b] tabular-nums">
                      {formatMetricValue(entry)}
                    </div>
                    <div className="text-[10px] font-bold text-[#93c5fd] tabular-nums">
                      دفع {Math.round(entry.totalPushContribution)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pinned Self Summary Footer if outside visible rows */}
        {data?.selfEntry && !data.entries.some((e) => e.accountId === data.selfEntry?.accountId) && (
          <div className="mt-4 pt-3 border-t border-[#f7d060]/30">
            <div className="text-[11px] font-bold text-[#93c5fd] mb-1.5">ترتيبك الحالي</div>
            <div className="rounded-2xl px-3.5 py-2.5 border bg-[#15354f] border-[#06d6a0] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-base font-black text-[#06d6a0] tabular-nums">
                  #{data.selfEntry.rank}
                </span>
                <span className="font-black text-sm text-white">{data.selfEntry.displayName}</span>
              </div>
              <div className="text-sm font-black text-[#ffd13b] tabular-nums">
                {formatMetricValue(data.selfEntry)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
