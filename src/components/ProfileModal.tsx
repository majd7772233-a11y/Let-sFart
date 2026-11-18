import React, { useMemo, useState } from 'react';
import { COURSE_LIST } from '../shared/course.ts';
import {
  COSMETIC_CATALOG,
  COSMETIC_COLOR_DEFS,
  getDefaultOwnedItemIds,
} from '../shared/cosmetics.ts';
import { ACHIEVEMENT_CATALOG } from '../shared/progression.ts';
import type { ProfileSnapshotPayload } from '../shared/protocol.ts';
import type {
  AchievementId,
  MotionTrailId,
  OutfitStyle,
  PlayerCosmetic,
  RaftSkinId,
} from '../shared/types.ts';
import type { AccountAuthMode } from './AccountAuthModal.tsx';
import { CharacterAvatarSvg } from './CosmeticPreviewStage.tsx';

interface ProfileModalProps {
  snapshot: ProfileSnapshotPayload;
  isBusy: boolean;
  errorMsg: string | null;
  onUpdateProfile: (displayName: string, cosmetic: PlayerCosmetic) => Promise<void>;
  onOpenAuth: (mode: AccountAuthMode) => void;
  onOpenShop?: () => void;
  onLogout: () => void;
  onAddFriend: (username: string) => Promise<void>;
  onRemoveFriend: (accountId: string) => Promise<void>;
  onClose: () => void;
}

export const CosmeticAvatarSvg: React.FC<{ cosmetic: PlayerCosmetic; size?: number }> = ({
  cosmetic,
  size = 64,
}) => <CharacterAvatarSvg cosmetic={cosmetic} size={size} />;

export const ProfileModal: React.FC<ProfileModalProps> = ({
  snapshot,
  isBusy,
  errorMsg,
  onUpdateProfile,
  onOpenAuth,
  onOpenShop,
  onLogout,
  onAddFriend,
  onRemoveFriend,
  onClose,
}) => {
  const { profile, stats, achievements, friends, ownedItemIds } = snapshot;
  const ownedSet = useMemo(
    () => new Set(ownedItemIds && ownedItemIds.length > 0 ? ownedItemIds : getDefaultOwnedItemIds()),
    [ownedItemIds],
  );
  const ownedHats = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'hat' && ownedSet.has(i.id)),
    [ownedSet],
  );
  const ownedGlasses = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'glasses' && ownedSet.has(i.id)),
    [ownedSet],
  );
  const ownedOutfits = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'outfit' && ownedSet.has(i.id)),
    [ownedSet],
  );
  const ownedRaftSkins = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'raft_skin' && ownedSet.has(i.id)),
    [ownedSet],
  );
  const ownedTrails = useMemo(
    () => COSMETIC_CATALOG.filter((i) => i.category === 'trail' && ownedSet.has(i.id)),
    [ownedSet],
  );

  const [tab, setTab] = useState<'overview' | 'achievements' | 'friends'>('overview');
  const [editName, setEditName] = useState(profile.displayName);
  const [editCosmetic, setEditCosmetic] = useState<PlayerCosmetic>(profile.cosmetic);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [friendUsername, setFriendUsername] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const unlockedSet = new Map<AchievementId, number>(achievements.map((a) => [a.id, a.unlockedAt]));
  const xpPct = Math.min(100, Math.round((profile.xpIntoLevel / Math.max(1, profile.xpForNextLevel)) * 100));
  const winRate = stats.roundsPlayed > 0 ? Math.round((stats.wins / stats.roundsPlayed) * 100) : 0;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSaveFeedback(null);
    try {
      await onUpdateProfile(editName, editCosmetic);
      setSaveFeedback('تم حفظ التعديلات بنجاح');
    } catch (err) {
      setLocalError((err as Error).message || 'تعذر حفظ التعديلات');
    }
  };

  const handleFriendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendUsername.trim()) return;
    setLocalError(null);
    try {
      await onAddFriend(friendUsername.trim());
      setFriendUsername('');
    } catch (err) {
      setLocalError((err as Error).message || 'تعذر إضافة الصديق');
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/75">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="الملف الشخصي"
        data-testid="profile-modal"
        className="wood-panel w-full max-w-3xl rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto"
      >
        {/* Header Identity Card */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-[#f7d060]/30 pb-4 mb-4">
          <div className="flex items-center gap-3.5">
            <CosmeticAvatarSvg cosmetic={editCosmetic} size={68} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
                  {profile.displayName}
                </h2>
                <span className="text-xs font-bold text-[#93c5fd]">
                  {profile.isGuest ? (
                    'حساب ضيف مؤقت'
                  ) : (
                    <span dir="ltr" className="inline-block">
                      @{profile.username}
                    </span>
                  )}
                </span>
              </div>
              <div className="text-xs font-bold text-[#cbd5e1] mt-1 tabular-nums">
                المستوى {profile.level} · {profile.rankTitleAr} · {profile.challengePoints} نقطة تحدٍ ·{' '}
                <span className="text-[#ffd13b]">🪙 {profile.coins} عملة</span>
              </div>
              {/* XP Bar */}
              <div className="mt-2 w-56 sm:w-64">
                <div className="h-2.5 rounded-full bg-[#0a1929] border border-[#2a4c6e] overflow-hidden">
                  <div
                    className="h-full bg-[#06d6a0] transition-all duration-300"
                    style={{ width: `${xpPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-bold text-[#93c5fd] mt-0.5 tabular-nums">
                  <span>{profile.xp} XP إجمالي</span>
                  <span>
                    {profile.xpIntoLevel}/{profile.xpForNextLevel}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {profile.isGuest ? (
              <button
                type="button"
                data-testid="profile-link-account-btn"
                onClick={() => onOpenAuth('link')}
                className="wood-btn-primary px-3.5 py-2 rounded-xl text-xs font-black cursor-pointer whitespace-nowrap shrink-0"
              >
                ربط بحساب دائم
              </button>
            ) : (
              <button
                type="button"
                data-testid="profile-logout-btn"
                onClick={onLogout}
                className="px-3.5 py-2 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#ff595e]/60 text-xs font-black text-[#ffb4b6] cursor-pointer whitespace-nowrap shrink-0"
              >
                تسجيل الخروج
              </button>
            )}
            <button
              type="button"
              data-testid="profile-switch-login-btn"
              onClick={() => onOpenAuth('login')}
              className="px-3.5 py-2 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#39628a] text-xs font-black text-[#dbeafe] cursor-pointer whitespace-nowrap shrink-0"
            >
              تبديل الحساب
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="profile-close-btn"
              className="px-3.5 py-2 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#cbd5e1] cursor-pointer whitespace-nowrap shrink-0"
            >
              إغلاق
            </button>
          </div>
        </div>

        {(errorMsg || localError) && (
          <div className="mb-3 rounded-xl bg-[#ff595e]/20 border border-[#ff595e] px-3 py-2 text-xs font-bold text-[#ffb4b6]">
            {localError || errorMsg}
          </div>
        )}

        {/* Section Tabs */}
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            data-testid="profile-tab-overview"
            onClick={() => setTab('overview')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer whitespace-nowrap ${
              tab === 'overview'
                ? 'bg-[#ffd13b] text-[#14222f]'
                : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
            }`}
          >
            الإحصائيات والمظهر
          </button>
          <button
            type="button"
            data-testid="profile-tab-achievements"
            onClick={() => setTab('achievements')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer whitespace-nowrap tabular-nums ${
              tab === 'achievements'
                ? 'bg-[#ffd13b] text-[#14222f]'
                : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
            }`}
          >
            الإنجازات ({achievements.length}/{ACHIEVEMENT_CATALOG.length})
          </button>
          <button
            type="button"
            data-testid="profile-tab-friends"
            onClick={() => setTab('friends')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer whitespace-nowrap tabular-nums ${
              tab === 'friends'
                ? 'bg-[#ffd13b] text-[#14222f]'
                : 'bg-[#102438] text-[#cbd5e1] border border-[#2a4c6e]'
            }`}
          >
            الأصدقاء ({friends.length})
          </button>
        </div>

        {/* Tab 1: Overview, Stats & Cosmetic Customization */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Detailed Career Stats (PROG-03) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3">
                <div className="text-[11px] font-bold text-[#93c5fd]">الجولات والانتصارات</div>
                <div className="text-lg font-black text-[#ffd13b] tabular-nums mt-0.5">
                  {stats.wins} فوز / {stats.losses} خسارة
                </div>
                <div className="text-[11px] font-bold text-[#06d6a0] tabular-nums">
                  {stats.roundsPlayed} جولة · نسبة الفوز {winRate}%
                </div>
              </div>

              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3">
                <div className="text-[11px] font-bold text-[#93c5fd]">أفضل زمن عام</div>
                <div className="text-xl font-black text-[#06d6a0] tabular-nums mt-0.5">
                  {stats.bestTimeSec !== null ? `${stats.bestTimeSec.toFixed(2)}ث` : '—'}
                </div>
                <div className="text-[11px] font-bold text-[#ff8589] tabular-nums">
                  إجمالي السقوطات: {stats.totalFalls}
                </div>
              </div>

              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3">
                <div className="text-[11px] font-bold text-[#93c5fd]">المساهمة في دفع الطوف</div>
                <div className="text-xl font-black text-[#38bdf8] tabular-nums mt-0.5">
                  {Math.round(stats.totalPushContribution)}
                </div>
                <div className="text-[11px] font-bold text-[#cbd5e1] tabular-nums">
                  مدة النفخ: {stats.totalFartTime.toFixed(1)}ث
                </div>
              </div>

              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3">
                <div className="text-[11px] font-bold text-[#93c5fd]">استخدام العناصر والأدوات</div>
                <div className="text-xl font-black text-[#ffd13b] tabular-nums mt-0.5">
                  {stats.itemsUsed}
                </div>
                <div className="text-[11px] font-bold text-[#cbd5e1] tabular-nums">
                  أفضل بقاء: {Math.round(stats.bestSurvivalDistance)}م
                </div>
              </div>
            </div>

            {/* Per-Course Best Times */}
            <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5">
              <div className="text-xs font-black text-[#9ef01a] mb-2.5">أفضل الأوقات حسب المسار</div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {COURSE_LIST.map((course) => {
                  const rec = stats.courseBests[course.id];
                  return (
                    <div
                      key={course.id}
                      className="bg-[#0c1d2e] border border-[#274868] rounded-xl p-2.5 flex flex-col justify-between gap-1"
                    >
                      <div className="text-xs font-black text-[#ffd13b] truncate">{course.meta.nameAr}</div>
                      <div className="text-sm font-black text-[#06d6a0] tabular-nums">
                        {rec?.bestTimeSec !== null && rec?.bestTimeSec !== undefined
                          ? `${rec.bestTimeSec.toFixed(2)}ث`
                          : '—'}
                      </div>
                      <div className="text-[10px] font-bold text-[#93c5fd] tabular-nums">
                        {rec?.wins ?? 0} فوز · {rec?.plays ?? 0} جولة
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Edit Display Name & Owned Cosmetic Appearance */}
            <form
              onSubmit={handleSaveProfile}
              className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3.5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-black text-[#ffd13b]">تخصيص المظهر المملوك</span>
                <div className="flex items-center gap-2">
                  {saveFeedback && (
                    <span className="text-xs font-black text-[#06d6a0]">{saveFeedback}</span>
                  )}
                  {onOpenShop && (
                    <button
                      type="button"
                      onClick={onOpenShop}
                      className="px-2.5 py-1 rounded-lg bg-[#19334d] hover:bg-[#23476b] border border-[#ffd13b]/60 text-[11px] font-black text-[#ffd13b] cursor-pointer"
                    >
                      فتح المتجر للشراء
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#93c5fd] mb-1">اسم اللاعب</label>
                  <input
                    type="text"
                    maxLength={18}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    data-testid="profile-displayname-input"
                    className="w-full rounded-xl bg-[#0c1d2e] border border-[#2b4d6e] focus:border-[#ffd13b] outline-none px-3 py-1.5 text-sm font-bold text-white"
                  />
                </div>

                <div>
                  <div className="text-[11px] font-bold text-[#93c5fd] mb-1">لون الطاقم</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {COSMETIC_COLOR_DEFS.filter((c) => ownedSet.has(`color:${c.index}`)).map((c) => (
                      <button
                        key={c.index}
                        type="button"
                        onClick={() => setEditCosmetic((prev) => ({ ...prev, colorIndex: c.index }))}
                        className={`w-8 h-8 rounded-full border-2 cursor-pointer ${
                          editCosmetic.colorIndex === c.index
                            ? 'border-white scale-110'
                            : 'border-[#14222f] opacity-75'
                        }`}
                        style={{ backgroundColor: c.bodyHex }}
                        aria-label={`لون ${c.titleAr}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-bold text-[#93c5fd] mb-1">القبعة</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ownedHats.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() =>
                          setEditCosmetic((c) => ({ ...c, hat: h.value as PlayerCosmetic['hat'] }))
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-black cursor-pointer ${
                          editCosmetic.hat === h.value
                            ? 'bg-[#ffd13b] text-[#14222f]'
                            : 'bg-[#0c1d2e] text-[#cbd5e1] border border-[#2a4c6e]'
                        }`}
                      >
                        {h.titleAr}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-bold text-[#93c5fd] mb-1">النظارات</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ownedGlasses.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          setEditCosmetic((c) => ({ ...c, glasses: g.value as PlayerCosmetic['glasses'] }))
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-black cursor-pointer ${
                          editCosmetic.glasses === g.value
                            ? 'bg-[#38bdf8] text-[#082f49]'
                            : 'bg-[#0c1d2e] text-[#cbd5e1] border border-[#2a4c6e]'
                        }`}
                      >
                        {g.titleAr}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {(ownedOutfits.length > 1 || ownedRaftSkins.length > 1 || ownedTrails.length > 1) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div>
                    <div className="text-[11px] font-bold text-[#93c5fd] mb-1">الملابس</div>
                    <div className="flex flex-wrap gap-1">
                      {ownedOutfits.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() =>
                            setEditCosmetic((c) => ({ ...c, outfit: o.value as OutfitStyle }))
                          }
                          className={`px-2 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                            (editCosmetic.outfit ?? 'classic') === o.value
                              ? 'bg-[#ffd13b] text-[#14222f]'
                              : 'bg-[#0c1d2e] text-[#cbd5e1] border border-[#2a4c6e]'
                          }`}
                        >
                          {o.titleAr}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-[#93c5fd] mb-1">مظهر الطوف</div>
                    <div className="flex flex-wrap gap-1">
                      {ownedRaftSkins.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() =>
                            setEditCosmetic((c) => ({ ...c, raftSkin: r.value as RaftSkinId }))
                          }
                          className={`px-2 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                            (editCosmetic.raftSkin ?? 'classic_oak') === r.value
                              ? 'bg-[#ffd13b] text-[#14222f]'
                              : 'bg-[#0c1d2e] text-[#cbd5e1] border border-[#2a4c6e]'
                          }`}
                        >
                          {r.titleAr}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-[#93c5fd] mb-1">أثر الحركة</div>
                    <div className="flex flex-wrap gap-1">
                      {ownedTrails.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setEditCosmetic((c) => ({ ...c, trail: t.value as MotionTrailId }))
                          }
                          className={`px-2 py-1 rounded-lg text-[11px] font-black cursor-pointer ${
                            (editCosmetic.trail ?? 'classic_green') === t.value
                              ? 'bg-[#ffd13b] text-[#14222f]'
                              : 'bg-[#0c1d2e] text-[#cbd5e1] border border-[#2a4c6e]'
                          }`}
                        >
                          {t.titleAr}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isBusy}
                data-testid="profile-save-btn"
                className="wood-btn-primary px-5 py-2 rounded-xl text-xs sm:text-sm font-black cursor-pointer whitespace-nowrap"
              >
                {isBusy ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
            </form>
          </div>
        )}

        {/* Tab 2: Achievements (PROG-05) */}
        {tab === 'achievements' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ACHIEVEMENT_CATALOG.map((ach) => {
              const unlockedAt = unlockedSet.get(ach.id);
              const unlocked = unlockedAt !== undefined;
              return (
                <div
                  key={ach.id}
                  data-testid={`achievement-card-${ach.id}`}
                  className={`rounded-2xl p-3 border flex items-start gap-3 ${
                    unlocked
                      ? 'bg-[#122b3f] border-[#ffd13b]/70'
                      : 'bg-[#0d1e30] border-[#26415e] opacity-70'
                  }`}
                >
                  <div className="text-2xl leading-none shrink-0" aria-hidden="true">
                    {ach.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-sm text-[#ffd13b] truncate">{ach.titleAr}</span>
                      <span className="text-[11px] font-black text-[#06d6a0] tabular-nums shrink-0">
                        +{ach.points} نقطة
                      </span>
                    </div>
                    <p className="text-xs font-bold text-[#cbd5e1] mt-0.5">{ach.descriptionAr}</p>
                    <div className="text-[10px] font-bold mt-1 text-[#93c5fd]">
                      {unlocked
                        ? `مفتوح · ${new Date(unlockedAt).toLocaleDateString('ar-SA')}`
                        : 'مغلق — واصل اللعب لفتحه'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab 3: Friends (for Friends Leaderboard & Social) */}
        {tab === 'friends' && (
          <div className="space-y-3">
            <form onSubmit={handleFriendSubmit} className="flex gap-2">
              <input
                type="text"
                dir="ltr"
                value={friendUsername}
                onChange={(e) => setFriendUsername(e.target.value)}
                placeholder="اسم المستخدم (مثل: reef_captain)"
                data-testid="add-friend-input"
                className="flex-1 rounded-xl bg-[#0c1d2e] border-2 border-[#2b4d6e] focus:border-[#ffd13b] outline-none px-3 py-2 text-sm font-bold text-white"
              />
              <button
                type="submit"
                disabled={isBusy}
                data-testid="add-friend-btn"
                className="wood-btn-primary px-4 py-2 rounded-xl text-xs font-black cursor-pointer whitespace-nowrap shrink-0"
              >
                إضافة صديق
              </button>
            </form>

            {friends.length === 0 ? (
              <div className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-4 text-center text-xs font-bold text-[#93c5fd]">
                لا يوجد أصدقاء مضافون بعد. أضف أصدقاءك عبر اسم المستخدم لمنافسة أوقاتهم في لوحة المتصدرين!
              </div>
            ) : (
              <div className="space-y-2">
                {friends.map((f) => (
                  <div
                    key={f.accountId}
                    className="bg-[#102438] border border-[#2a4c6e] rounded-2xl p-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CosmeticAvatarSvg cosmetic={f.cosmetic} size={40} />
                      <div className="min-w-0">
                        <div className="font-black text-sm text-[#ffd13b] truncate">{f.displayName}</div>
                        <div className="text-[11px] font-bold text-[#93c5fd] tabular-nums">
                          {f.username ? (
                            <>
                              <span dir="ltr" className="inline-block">
                                @{f.username}
                              </span>{' '}
                              ·{' '}
                            </>
                          ) : (
                            ''
                          )}
                          المستوى {f.level} · {f.wins} فوز ·{' '}
                          {f.bestTimeSec !== null ? `${f.bestTimeSec.toFixed(2)}ث` : '—'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onRemoveFriend(f.accountId)}
                      className="px-3 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#ff595e]/30 border border-[#ff595e]/50 text-[11px] font-black text-[#ffb4b6] cursor-pointer whitespace-nowrap shrink-0"
                    >
                      إزالة
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
