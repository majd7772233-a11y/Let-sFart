import React, { useMemo, useState } from 'react';
import {
  COSMETIC_CATALOG,
  SHOP_CATEGORY_LABELS_AR,
  applyShopItemToCosmetic,
  normalizePlayerCosmetic,
} from '../shared/cosmetics.ts';
import type { ProfileSnapshotPayload } from '../shared/protocol.ts';
import type { CosmeticCategory, CosmeticItemDef, PlayerCosmetic } from '../shared/types.ts';
import { CosmeticPreviewStage } from './CosmeticPreviewStage.tsx';

interface ShopModalProps {
  snapshot: ProfileSnapshotPayload;
  isBusy: boolean;
  errorMsg: string | null;
  onBuyItem: (itemId: string) => Promise<void>;
  onEquipCosmetic: (next: PlayerCosmetic) => Promise<void>;
  onOpenQuestsSeason?: () => void;
  onClose: () => void;
}

const SHOP_CATEGORIES: readonly CosmeticCategory[] = [
  'hat',
  'glasses',
  'color',
  'outfit',
  'raft_skin',
  'trail',
];

const RARITY_LABELS_AR: Record<CosmeticItemDef['rarity'], string> = {
  starter: 'أساسي',
  common: 'شائع',
  rare: 'نادر',
  epic: 'ملحمي',
  seasonal: 'موسمي',
};

const SOURCE_LABELS_AR: Record<CosmeticItemDef['unlockSource'], string> = {
  starter: 'متاح للبداية',
  shop: 'متجر العملات',
  season: 'مسار الموسم أو المتجر',
  rare_event: 'حدث نادر أو المتجر',
};

function isItemEquipped(item: CosmeticItemDef, cosmetic: PlayerCosmetic): boolean {
  const norm = normalizePlayerCosmetic(cosmetic, 0);
  switch (item.category) {
    case 'hat':
      return norm.hat === item.value;
    case 'glasses':
      return norm.glasses === item.value;
    case 'color':
      return norm.colorIndex === Number(item.value);
    case 'outfit':
      return (norm.outfit ?? 'classic') === item.value;
    case 'raft_skin':
      return (norm.raftSkin ?? 'classic_oak') === item.value;
    case 'trail':
      return (norm.trail ?? 'classic_green') === item.value;
  }
}

export const ShopModal: React.FC<ShopModalProps> = ({
  snapshot,
  isBusy,
  errorMsg,
  onBuyItem,
  onEquipCosmetic,
  onOpenQuestsSeason,
  onClose,
}) => {
  const { profile, ownedItemIds } = snapshot;
  const ownedSet = useMemo(() => new Set(ownedItemIds), [ownedItemIds]);

  const [category, setCategory] = useState<CosmeticCategory>('hat');
  const [previewItem, setPreviewItem] = useState<CosmeticItemDef | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const itemsInCategory = useMemo(
    () => COSMETIC_CATALOG.filter((item) => item.category === category),
    [category],
  );

  const previewCosmetic = useMemo(() => {
    const base = normalizePlayerCosmetic(profile.cosmetic, 0);
    return previewItem ? applyShopItemToCosmetic(base, previewItem) : base;
  }, [profile.cosmetic, previewItem]);

  const handleBuy = async (item: CosmeticItemDef) => {
    setLocalError(null);
    setFeedback(null);
    try {
      await onBuyItem(item.id);
      setPreviewItem(null);
      setFeedback(`تم شراء وتجهيز «${item.titleAr}» بنجاح!`);
    } catch (err) {
      setLocalError((err as Error).message || 'تعذر إتمام عملية الشراء');
    }
  };

  const handleEquip = async (item: CosmeticItemDef) => {
    setLocalError(null);
    setFeedback(null);
    try {
      const next = applyShopItemToCosmetic(profile.cosmetic, item);
      await onEquipCosmetic(next);
      setPreviewItem(null);
      setFeedback(`تم تجهيز «${item.titleAr}» بنجاح!`);
    } catch (err) {
      setLocalError((err as Error).message || 'تعذر تجهيز العنصر');
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/75">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="متجر العناصر التجميلية"
        data-testid="shop-modal"
        className="wood-panel w-full max-w-4xl rounded-3xl p-4 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto"
      >
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
              متجر المظهر والعناصر التجميلية
            </h2>
            <p className="text-xs font-bold text-[#93c5fd] mt-0.5">
              تجميلي 100% — جميع المظاهر لا تؤثر على السرعة أو الفيزياء أو عدالة اللعب.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div
              data-testid="shop-coins-balance"
              className="px-3.5 py-1.5 rounded-xl bg-[#102438] border-2 border-[#ffd13b]/70 text-sm font-black text-[#ffd13b] tabular-nums"
            >
              🪙 {profile.coins} عملة
            </div>
            {onOpenQuestsSeason && (
              <button
                type="button"
                onClick={onOpenQuestsSeason}
                className="px-3 py-1.5 rounded-xl bg-[#19334d] hover:bg-[#23476b] border border-[#38bdf8]/60 text-xs font-black text-[#bae6fd] cursor-pointer whitespace-nowrap"
              >
                كسب عملات من المهام
              </button>
            )}
            <button
              type="button"
              data-testid="shop-close-btn"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#cbd5e1] cursor-pointer whitespace-nowrap"
            >
              إغلاق
            </button>
          </div>
        </div>

        {(errorMsg || localError) && (
          <div
            data-testid="shop-error-banner"
            className="mb-3 rounded-xl bg-[#ff595e]/20 border border-[#ff595e] px-3 py-2 text-xs font-bold text-[#ffb4b6]"
          >
            {localError || errorMsg}
          </div>
        )}

        {feedback && (
          <div
            data-testid="shop-feedback-banner"
            className="mb-3 rounded-xl bg-[#06d6a0]/20 border border-[#06d6a0] px-3 py-2 text-xs font-bold text-[#6ee7b7]"
          >
            {feedback}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left / Live Interactive 6-Category Preview Stage */}
          <div className="lg:col-span-5 space-y-2.5">
            <CosmeticPreviewStage
              cosmetic={previewCosmetic}
              highlightLabel={previewItem ? previewItem.titleAr : null}
            />
            {previewItem && (
              <div className="flex items-center justify-between gap-2 bg-[#102438] border border-[#38bdf8]/50 rounded-xl px-3 py-2 text-xs">
                <span className="font-bold text-[#bae6fd] truncate">
                  تعاين حالياً: <strong className="text-[#ffd13b]">{previewItem.titleAr}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="text-[11px] font-black text-[#cbd5e1] hover:text-white underline cursor-pointer whitespace-nowrap"
                >
                  استعادة المظهر الحالي
                </button>
              </div>
            )}
          </div>

          {/* Right / 6 Category Tabs + Item Grid */}
          <div className="lg:col-span-7 space-y-3">
            <div
              role="tablist"
              aria-label="فئات المتجر"
              className="flex flex-wrap gap-1 bg-[#0c1c2c] p-1.5 rounded-2xl border border-[#2a4c6e]"
            >
              {SHOP_CATEGORIES.map((cat) => {
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`shop-tab-${cat}`}
                    onClick={() => {
                      setCategory(cat);
                      setPreviewItem(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-black cursor-pointer transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#ffd13b] text-[#14222f]'
                        : 'text-[#dbeafe] hover:bg-[#152d45]'
                    }`}
                  >
                    {SHOP_CATEGORY_LABELS_AR[cat]}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {itemsInCategory.map((item) => {
                const owned = ownedSet.has(item.id);
                const equipped = isItemEquipped(item, profile.cosmetic);
                const isPreviewing = previewItem?.id === item.id;
                const canAfford = profile.coins >= item.priceCoins;

                return (
                  <div
                    key={item.id}
                    data-testid={`shop-item-${item.id}`}
                    className={`rounded-2xl p-3 border flex flex-col justify-between gap-2.5 transition-colors ${
                      equipped
                        ? 'bg-[#13314a] border-[#06d6a0]'
                        : isPreviewing
                          ? 'bg-[#14304a] border-[#ffd13b]'
                          : 'bg-[#102438] border-[#2a4c6e]'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/60 shrink-0"
                            style={{ backgroundColor: item.previewAccentHex }}
                            aria-hidden="true"
                          />
                          <span className="font-black text-sm text-[#ffd13b] leading-snug">
                            {item.titleAr}
                          </span>
                        </div>
                        <span className="text-[11px] font-black text-[#bae6fd] shrink-0 tabular-nums">
                          {owned ? 'مملوك' : item.priceCoins > 0 ? `🪙 ${item.priceCoins}` : 'مجاني'}
                        </span>
                      </div>

                      <div className="text-[11px] font-bold text-[#93c5fd]">
                        {RARITY_LABELS_AR[item.rarity]} · {SOURCE_LABELS_AR[item.unlockSource]}
                      </div>
                      <p className="text-xs font-semibold text-[#dbeafe] leading-snug">
                        {item.descriptionAr}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        data-testid={`shop-preview-${item.id}`}
                        onClick={() => setPreviewItem(item)}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-black border cursor-pointer whitespace-nowrap ${
                          isPreviewing
                            ? 'bg-[#38bdf8] text-[#082f49] border-[#bae6fd]'
                            : 'bg-[#19334d] hover:bg-[#23476b] text-[#dbeafe] border-[#39628a]'
                        }`}
                      >
                        معاينة
                      </button>

                      {equipped ? (
                        <span className="flex-1 text-center py-1.5 rounded-xl bg-[#06d6a0]/20 border border-[#06d6a0]/60 text-xs font-black text-[#6ee7b7]">
                          مجهّز حالياً ✓
                        </span>
                      ) : owned ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          data-testid={`shop-equip-${item.id}`}
                          onClick={() => void handleEquip(item)}
                          className="wood-btn-secondary flex-1 py-1.5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-55"
                        >
                          تجهيز المظهر
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy || !canAfford}
                          data-testid={`shop-buy-${item.id}`}
                          onClick={() => void handleBuy(item)}
                          className={`flex-1 py-1.5 rounded-xl text-xs font-black cursor-pointer whitespace-nowrap tabular-nums ${
                            canAfford
                              ? 'wood-btn-primary'
                              : 'bg-[#0d1c2b] border border-[#2b435c] text-[#94a3b8] cursor-not-allowed'
                          }`}
                        >
                          {canAfford ? `شراء (${item.priceCoins} 🪙)` : `تحتاج ${item.priceCoins - profile.coins} 🪙`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
