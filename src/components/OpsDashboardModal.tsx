import React, { useEffect, useState } from 'react';
import { getCourseById } from '../shared/course.ts';
import { fetchBalanceAnalytics, fetchOpsStatus } from '../net/progressionClient.ts';
import type {
  BalanceAnalyticsResponse,
  GameMode,
  ServerHealthSnapshot,
} from '../shared/types.ts';

interface OpsDashboardModalProps {
  onClose: () => void;
}

const MODE_LABELS: Record<GameMode, string> = {
  standard: 'القياسي',
  time_trial: 'سباق الزمن',
  survival: 'وضع البقاء',
  treasure: 'جمع الكنوز',
  chaos: 'وضع الفوضى',
};

function formatUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}س ${m}د`;
  if (m > 0) return `${m}د ${rem}ث`;
  return `${rem}ث`;
}

export const OpsDashboardModal: React.FC<OpsDashboardModalProps> = ({ onClose }) => {
  const [tab, setTab] = useState<'health' | 'analytics'>('health');
  const [adminKey, setAdminKey] = useState('');
  const [modeFilter, setModeFilter] = useState<GameMode | 'all'>('all');

  const [health, setHealth] = useState<ServerHealthSnapshot | null>(null);
  const [analytics, setAnalytics] = useState<BalanceAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);

  const loadData = async (keyOverride?: string, modeOverride?: GameMode | 'all') => {
    setLoading(true);
    setErrorMsg(null);
    const key = keyOverride !== undefined ? keyOverride : adminKey;
    const activeMode = modeOverride !== undefined ? modeOverride : modeFilter;
    try {
      const [h, a] = await Promise.all([
        fetchOpsStatus(key),
        fetchBalanceAnalytics({
          ...(activeMode !== 'all' ? { gameMode: activeMode } : {}),
          adminKey: key,
        }),
      ]);
      setHealth(h);
      setAnalytics(a);
      setNeedsKey(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        setNeedsKey(true);
      }
      setErrorMsg(err instanceof Error ? err.message : 'تعذر جلب بيانات المراقبة والتحليلات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModeFilter = (nextMode: GameMode | 'all') => {
    setModeFilter(nextMode);
    void loadData(adminKey, nextMode);
  };

  return (
    <div
      data-testid="ops-dashboard-modal"
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/82"
    >
      <div className="bg-[#0b1929] border-2 border-[#2a4c6e] w-full max-w-5xl rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#2a4c6e]">
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-[#ffd13b]">
              📊 مراقبة الخادم وتحليلات التوازن
            </h2>
            <p className="text-xs font-bold text-[#93c5fd]">
              مؤشرات التوافق والأداء اللحظية ونتائج توازن المسارات وأنماط اللعب
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="ops-refresh-btn"
              onClick={() => void loadData()}
              className="px-3 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#bae6fd] cursor-pointer whitespace-nowrap shrink-0"
            >
              تحديث البيانات
            </button>
            <button
              type="button"
              data-testid="ops-close-btn"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-xs font-black text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              إغلاق
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 bg-[#102438] p-1 rounded-xl border border-[#2a4c6e]">
            <button
              type="button"
              data-testid="ops-tab-health"
              onClick={() => setTab('health')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap shrink-0 ${
                tab === 'health' ? 'bg-[#ffd13b] text-[#14222f]' : 'text-[#dbeafe] hover:text-white'
              }`}
            >
              صحة الخادم والتوافق
            </button>
            <button
              type="button"
              data-testid="ops-tab-analytics"
              onClick={() => setTab('analytics')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-black cursor-pointer whitespace-nowrap shrink-0 ${
                tab === 'analytics' ? 'bg-[#38bdf8] text-[#082f49]' : 'text-[#dbeafe] hover:text-white'
              }`}
            >
              تحليلات توازن المسارات
            </button>
          </div>

          {needsKey && (
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="مفتاح المراقبة OPS_ADMIN_KEY"
                className="px-3 py-1.5 rounded-xl bg-[#102438] border border-[#39628a] text-xs font-bold text-white"
              />
              <button
                type="button"
                onClick={() => void loadData(adminKey)}
                className="px-3 py-1.5 rounded-xl bg-[#ffd13b] text-[#14222f] text-xs font-black cursor-pointer whitespace-nowrap shrink-0"
              >
                تحقق
              </button>
            </div>
          )}
        </div>

        {loading && !health ? (
          <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-8 text-center text-sm font-bold text-[#93c5fd]">
            جاري قراءة مؤشرات الخادم وقاعدة البيانات...
          </div>
        ) : errorMsg ? (
          <div className="bg-[#29151d] border border-[#ff595e]/60 rounded-2xl p-5 text-center space-y-2">
            <div className="text-sm font-black text-[#fecaca]">{errorMsg}</div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="px-3.5 py-1.5 rounded-xl bg-[#19334d] text-xs font-black text-white cursor-pointer"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : tab === 'health' && health ? (
          <div data-testid="ops-health-panel" className="space-y-4">
            {/* 4 Primary KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5 space-y-1">
                <div className="text-[11px] font-bold text-[#93c5fd]">حالة التشغيل و D1</div>
                <div className="text-lg font-black text-[#06d6a0]">
                  {health.ok ? 'سليم ومتاح' : 'تحذير'}
                </div>
                <div className="text-[11px] font-bold text-[#bae6fd] tabular-nums">
                  {health.d1Connected ? 'قاعدة D1 متصلة ✓' : 'وضع الذاكرة'} · تشغيل {formatUptime(health.uptimeSec)}
                </div>
              </div>

              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5 space-y-1">
                <div className="text-[11px] font-bold text-[#93c5fd]">الإصدار وبروتوكول التوافق</div>
                <div dir="ltr" className="text-lg font-black text-[#ffd13b] tabular-nums text-right">
                  v{health.gameVersion} · P{health.protocolVersion}
                </div>
                <div className="text-[11px] font-bold text-[#bae6fd] tabular-nums">
                  أدنى بروتوكول مقبول: v{health.minCompatibleProtocolVersion} · {health.runtime}
                </div>
              </div>

              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5 space-y-1">
                <div className="text-[11px] font-bold text-[#93c5fd]">النشاط المباشر والطاقم</div>
                <div className="text-lg font-black text-white tabular-nums">
                  {health.activeRoomsCount} غرفة · {health.totalHumansOnline} لاعب
                </div>
                <div className="text-[11px] font-bold text-[#bae6fd] tabular-nums">
                  روبوتات: {health.totalBotsActive} · بديل مؤقت: {health.totalTempSubstitutesActive} · مشاهدون: {health.totalSpectatorsOnline}
                </div>
              </div>

              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5 space-y-1">
                <div className="text-[11px] font-bold text-[#93c5fd]">الاستجابة وموثوقية التحقق</div>
                <div className="text-lg font-black text-[#38bdf8] tabular-nums">
                  {health.avgLatencyMs}ms <span className="text-xs text-[#93c5fd]">(p95: {health.p95LatencyMs}ms)</span>
                </div>
                <div className="text-[11px] font-bold tabular-nums text-[#bae6fd]">
                  مقبول <span className="text-[#06d6a0]">{health.verifiedMatchesCount}</span> · مرفوض{' '}
                  <span className={health.rejectedMatchesCount > 0 ? 'text-[#ff595e]' : 'text-[#93c5fd]'}>
                    {health.rejectedMatchesCount}
                  </span>
                </div>
              </div>
            </div>

            {/* HTTP & Connection Reliability Strip */}
            <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5 grid grid-cols-2 sm:grid-cols-6 gap-3 text-center">
              <div>
                <div className="text-[10px] font-bold text-[#93c5fd]">إجمالي HTTP</div>
                <div className="text-base font-black text-white tabular-nums">{health.httpRequestsTotal}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-[#93c5fd]">2xx ناجحة</div>
                <div className="text-base font-black text-[#06d6a0] tabular-nums">{health.http2xxCount}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-[#93c5fd]">4xx عميل</div>
                <div className="text-base font-black text-[#ffd13b] tabular-nums">{health.http4xxCount}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-[#93c5fd]">5xx خادم</div>
                <div className={`text-base font-black tabular-nums ${health.http5xxCount > 0 ? 'text-[#ff595e]' : 'text-[#06d6a0]'}`}>
                  {health.http5xxCount}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-[#93c5fd]">انقطاعات / عودة</div>
                <div className="text-base font-black text-[#bae6fd] tabular-nums">
                  {health.disconnectCount} / {health.reconnectCount}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-[#93c5fd]">تفعيل بديل آلي</div>
                <div className="text-base font-black text-[#ffd13b] tabular-nums">{health.tempSubstitutesActivated}</div>
              </div>
            </div>

            {/* Active Rooms Summary */}
            <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5 space-y-2">
              <div className="text-xs font-black text-[#ffd13b]">
                الغرف النشطة الآن ({health.activeRooms.length})
              </div>
              {health.activeRooms.length === 0 ? (
                <div className="text-xs font-bold text-[#93c5fd] py-3 text-center">
                  لا توجد غرف أونلاين مفتوحة في هذه اللحظة.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="text-[#93c5fd] border-b border-[#2a4c6e]">
                        <th className="py-2 px-2 font-black">الرمز</th>
                        <th className="py-2 px-2 font-black">المسار</th>
                        <th className="py-2 px-2 font-black">النمط</th>
                        <th className="py-2 px-2 font-black">الحالة</th>
                        <th className="py-2 px-2 font-black">بشر / آلي / بديل / مشاهد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.activeRooms.map((r) => (
                        <tr key={r.roomCode} className="border-b border-[#1b3550]">
                          <td dir="ltr" className="py-2 px-2 font-black text-[#ffd13b] tabular-nums text-right">
                            {r.roomCode}
                          </td>
                          <td className="py-2 px-2 font-bold text-white">
                            {getCourseById(r.courseId).meta.nameAr}
                          </td>
                          <td className="py-2 px-2 font-bold text-[#bae6fd]">
                            {MODE_LABELS[r.gameMode]}
                          </td>
                          <td className="py-2 px-2 font-bold text-[#06d6a0]">{r.lifecycleState}</td>
                          <td className="py-2 px-2 font-bold tabular-nums text-[#dbeafe]">
                            {r.humanCount} / {r.botCount} / {r.tempSubstituteCount} / {r.spectatorCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : tab === 'analytics' && analytics ? (
          <div data-testid="ops-analytics-panel" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3">
              <div className="text-xs font-black text-[#ffd13b] tabular-nums">
                إجمالي الجولات المحققة في D1: {analytics.totalVerifiedMatches}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'standard', 'time_trial', 'survival', 'treasure', 'chaos'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleModeFilter(m)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                      modeFilter === m
                        ? 'bg-[#38bdf8] text-[#082f49]'
                        : 'bg-[#0b1929] text-[#cbd5e1] border border-[#2a4c6e]'
                    }`}
                  >
                    {m === 'all' ? 'كل الأنماط' : MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            {analytics.courses.length === 0 ? (
              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-8 text-center space-y-1.5">
                <div className="text-sm font-black text-[#ffd13b]">لا توجد بيانات توازن مسجلة بعد</div>
                <p className="text-xs font-bold text-[#93c5fd]">
                  بعد إتمام جولات موثّقة ستظهر هنا نسب الفوز ومتوسط الزمن والسقوطات لكل مسار ونمط.
                </p>
              </div>
            ) : (
              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3 overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="text-[#93c5fd] border-b border-[#2a4c6e]">
                      <th className="py-2 px-2 font-black">المسار</th>
                      <th className="py-2 px-2 font-black">النمط</th>
                      <th className="py-2 px-2 font-black">الجولات</th>
                      <th className="py-2 px-2 font-black">نسبة الفوز</th>
                      <th className="py-2 px-2 font-black">متوسط الزمن</th>
                      <th className="py-2 px-2 font-black">متوسط السقوط</th>
                      <th className="py-2 px-2 font-black">الاصطدامات</th>
                      <th className="py-2 px-2 font-black">الأدوات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.courses.map((row) => {
                      const c = getCourseById(row.courseId);
                      return (
                        <tr key={`${row.courseId}:${row.gameMode}`} className="border-b border-[#1b3550]">
                          <td className="py-2.5 px-2 font-black text-white whitespace-nowrap">
                            <span
                              className="inline-block w-2 h-2 rounded-full ml-1.5"
                              style={{ backgroundColor: c.meta.accentHex }}
                            />
                            {c.meta.nameAr}
                          </td>
                          <td className="py-2.5 px-2 font-bold text-[#bae6fd] whitespace-nowrap">
                            {MODE_LABELS[row.gameMode]}
                          </td>
                          <td className="py-2.5 px-2 font-black tabular-nums text-[#ffd13b]">
                            {row.totalRuns}
                          </td>
                          <td className="py-2.5 px-2 tabular-nums">
                            <div className="flex items-center gap-2 min-w-[110px]">
                              <div className="flex-1 h-1.5 rounded-full bg-[#0b1929] overflow-hidden">
                                <div
                                  className="h-full bg-[#06d6a0]"
                                  style={{ width: `${Math.min(100, row.winRatePct)}%` }}
                                />
                              </div>
                              <span className="font-black text-[#06d6a0]">{row.winRatePct}%</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 font-bold tabular-nums text-white">
                            {row.avgClearTimeSec.toFixed(1)}ث
                          </td>
                          <td className="py-2.5 px-2 font-bold tabular-nums text-[#fecaca]">
                            {row.avgFalls.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-2 font-bold tabular-nums text-[#fde68a]">
                            {row.avgCollisionCount.toFixed(1)}
                          </td>
                          <td className="py-2.5 px-2 font-bold tabular-nums text-[#93c5fd]">
                            {row.avgItemsUsed.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
