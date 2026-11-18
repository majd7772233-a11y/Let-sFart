import type {
  CosmeticCategory,
  CosmeticItemDef,
  GlassesStyle,
  HatStyle,
  MotionTrailId,
  OutfitStyle,
  PlayerCosmetic,
  RaftSkinId,
} from './types.ts';

export interface CosmeticColorDef {
  index: number;
  titleAr: string;
  bodyHex: string;
  shortsHex: string;
  bodyNum: number;
  shortsNum: number;
  cheekNum: number;
}

export const COSMETIC_COLOR_DEFS: readonly CosmeticColorDef[] = [
  {
    index: 0,
    titleAr: 'مرجاني أحمر',
    bodyHex: '#ff595e',
    shortsHex: '#1d3557',
    bodyNum: 0xff595e,
    shortsNum: 0x1d3557,
    cheekNum: 0xff8fa3,
  },
  {
    index: 1,
    titleAr: 'أزرق محيطي',
    bodyHex: '#1982c4',
    shortsHex: '#ffca3a',
    bodyNum: 0x1982c4,
    shortsNum: 0xffca3a,
    cheekNum: 0x64dfdf,
  },
  {
    index: 2,
    titleAr: 'عنبر مشمس',
    bodyHex: '#ffca3a',
    shortsHex: '#6a4c93',
    bodyNum: 0xffca3a,
    shortsNum: 0x6a4c93,
    cheekNum: 0xff9f1c,
  },
  {
    index: 3,
    titleAr: 'توتي بنفسجي',
    bodyHex: '#9b5de5',
    shortsHex: '#00bbf9',
    bodyNum: 0x9b5de5,
    shortsNum: 0x00bbf9,
    cheekNum: 0xf15bb5,
  },
  {
    index: 4,
    titleAr: 'زمردي استوائي',
    bodyHex: '#06d6a0',
    shortsHex: '#073b4c',
    bodyNum: 0x06d6a0,
    shortsNum: 0x073b4c,
    cheekNum: 0x80ffdb,
  },
  {
    index: 5,
    titleAr: 'جمر بركاني',
    bodyHex: '#f97316',
    shortsHex: '#1f2937',
    bodyNum: 0xf97316,
    shortsNum: 0x1f2937,
    cheekNum: 0xfdba74,
  },
  {
    index: 6,
    titleAr: 'جليد سماوي',
    bodyHex: '#38bdf8',
    shortsHex: '#0f172a',
    bodyNum: 0x38bdf8,
    shortsNum: 0x0f172a,
    cheekNum: 0xbae6fd,
  },
  {
    index: 7,
    titleAr: 'ملكي مذهّب',
    bodyHex: '#e11d48',
    shortsHex: '#fbbf24',
    bodyNum: 0xe11d48,
    shortsNum: 0xfbbf24,
    cheekNum: 0xfda4af,
  },
];

export const VALID_HATS_LIST: readonly HatStyle[] = [
  'none',
  'captain',
  'crown',
  'propeller',
  'pirate',
  'viking',
  'snorkel',
  'storm_hood',
];

export const VALID_GLASSES_LIST: readonly GlassesStyle[] = [
  'none',
  'shades',
  'nerd',
  'monocle',
  'cyber_visor',
  'heart_shades',
];

export const VALID_OUTFITS_LIST: readonly OutfitStyle[] = [
  'classic',
  'captain_coat',
  'diver_suit',
  'volcanic_armor',
  'royal_robe',
];

export const VALID_RAFT_SKINS_LIST: readonly RaftSkinId[] = [
  'classic_oak',
  'bamboo_tropical',
  'obsidian_magma',
  'frost_crystal',
  'golden_galleon',
];

export const VALID_TRAILS_LIST: readonly MotionTrailId[] = [
  'classic_green',
  'rainbow_bubbles',
  'volcanic_sparks',
  'frost_mist',
  'golden_confetti',
];

export const COSMETIC_CATALOG: readonly CosmeticItemDef[] = [
  // Hats
  {
    id: 'hat:none',
    category: 'hat',
    value: 'none',
    titleAr: 'رأس مكشوف',
    descriptionAr: 'مظهر بسيط وخفيف بدون قبعة.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#94a3b8',
  },
  {
    id: 'hat:captain',
    category: 'hat',
    value: 'captain',
    titleAr: 'قبعة القبطان',
    descriptionAr: 'قبعة بحرية كلاسيكية بشريط ذهبي.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#1e3a5f',
  },
  {
    id: 'hat:propeller',
    category: 'hat',
    value: 'propeller',
    titleAr: 'قبعة المروحة',
    descriptionAr: 'مروحة دوارة تزداد سرعتها أثناء النفخ!',
    priceCoins: 90,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#38bdf8',
  },
  {
    id: 'hat:snorkel',
    category: 'hat',
    value: 'snorkel',
    titleAr: 'أنبوب الغطس الاستوائي',
    descriptionAr: 'جاهز للغطس وسط الشلالات والأمواج.',
    priceCoins: 120,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#06d6a0',
  },
  {
    id: 'hat:pirate',
    category: 'hat',
    value: 'pirate',
    titleAr: 'قبعة القرصان',
    descriptionAr: 'قبعة مثلثة كلاسيكية لصائدي الكنوز.',
    priceCoins: 180,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#f59e0b',
  },
  {
    id: 'hat:viking',
    category: 'hat',
    value: 'viking',
    titleAr: 'خوذة الفايكنغ',
    descriptionAr: 'خوذة حديدية بقرون لخوض المضيق الجليدي.',
    priceCoins: 240,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#cbd5e1',
  },
  {
    id: 'hat:crown',
    category: 'hat',
    value: 'crown',
    titleAr: 'التاج الذهبي',
    descriptionAr: 'تاج الملوك اللامع لأسياد الطوف.',
    priceCoins: 320,
    rarity: 'epic',
    unlockSource: 'shop',
    previewAccentHex: '#ffd13b',
  },
  {
    id: 'hat:storm_hood',
    category: 'hat',
    value: 'storm_hood',
    titleAr: 'غطاء العاصفة النادر',
    descriptionAr: 'مظهر موسمي نادر لفرسان العاصفة البحرية.',
    priceCoins: 280,
    rarity: 'seasonal',
    unlockSource: 'season',
    previewAccentHex: '#60a5fa',
  },

  // Glasses
  {
    id: 'glasses:none',
    category: 'glasses',
    value: 'none',
    titleAr: 'بدون نظارات',
    descriptionAr: 'رؤية طبيعية صافية.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#94a3b8',
  },
  {
    id: 'glasses:nerd',
    category: 'glasses',
    value: 'nerd',
    titleAr: 'نظارات دائرية',
    descriptionAr: 'نظارات ملاح عبقري يحسب كل موجة.',
    priceCoins: 75,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#cbd5e1',
  },
  {
    id: 'glasses:shades',
    category: 'glasses',
    value: 'shades',
    titleAr: 'نظارات شمسية',
    descriptionAr: 'إطلالة أنيقة تحت شمس الجزر.',
    priceCoins: 110,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#ffd13b',
  },
  {
    id: 'glasses:monocle',
    category: 'glasses',
    value: 'monocle',
    titleAr: 'عدسة الأرستقراطي',
    descriptionAr: 'عدسة أحادية بإطار ذهبي فاخر.',
    priceCoins: 160,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#f59e0b',
  },
  {
    id: 'glasses:heart_shades',
    category: 'glasses',
    value: 'heart_shades',
    titleAr: 'نظارات القلوب المرحة',
    descriptionAr: 'تصميم مرح يجلب البهجة للطاقم.',
    priceCoins: 190,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#fb7185',
  },
  {
    id: 'glasses:cyber_visor',
    category: 'glasses',
    value: 'cyber_visor',
    titleAr: 'قناع العاصفة السماوي',
    descriptionAr: 'عدسة بانورامية لمواجهة الرياح والأمطار.',
    priceCoins: 260,
    rarity: 'epic',
    unlockSource: 'shop',
    previewAccentHex: '#38bdf8',
  },

  // Colors
  {
    id: 'color:0',
    category: 'color',
    value: 0,
    titleAr: 'أحمر مرجاني',
    descriptionAr: 'لون الفريق الكلاسيكي الجريء.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#ff595e',
  },
  {
    id: 'color:1',
    category: 'color',
    value: 1,
    titleAr: 'أزرق محيطي',
    descriptionAr: 'مستوحى من أعماق المحيط.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#1982c4',
  },
  {
    id: 'color:2',
    category: 'color',
    value: 2,
    titleAr: 'عنبر مشمس',
    descriptionAr: 'إشراقة شمسية ساطعة على الطوف.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#ffca3a',
  },
  {
    id: 'color:3',
    category: 'color',
    value: 3,
    titleAr: 'توتي بنفسجي',
    descriptionAr: 'لون استوائي نابض بالحيوية.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#9b5de5',
  },
  {
    id: 'color:4',
    category: 'color',
    value: 4,
    titleAr: 'زمردي استوائي',
    descriptionAr: 'تدرج فيروزي متلألئ وسط الأمواج.',
    priceCoins: 85,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#06d6a0',
  },
  {
    id: 'color:5',
    category: 'color',
    value: 5,
    titleAr: 'جمر بركاني',
    descriptionAr: 'برتقالي ناري مستوحى من الحمم.',
    priceCoins: 130,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#f97316',
  },
  {
    id: 'color:6',
    category: 'color',
    value: 6,
    titleAr: 'جليد سماوي',
    descriptionAr: 'أزرق جليدي بارد وأنيق.',
    priceCoins: 140,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#38bdf8',
  },
  {
    id: 'color:7',
    category: 'color',
    value: 7,
    titleAr: 'ملكي مذهّب',
    descriptionAr: 'قرمزي ملكي مع تفاصيل ذهبية.',
    priceCoins: 210,
    rarity: 'epic',
    unlockSource: 'shop',
    previewAccentHex: '#e11d48',
  },

  // Outfits
  {
    id: 'outfit:classic',
    category: 'outfit',
    value: 'classic',
    titleAr: 'زي البحّار الكلاسيكي',
    descriptionAr: 'شورت بحري عملي مريح للتجديف.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#94a3b8',
  },
  {
    id: 'outfit:captain_coat',
    category: 'outfit',
    value: 'captain_coat',
    titleAr: 'معطف القبطان المذهّب',
    descriptionAr: 'كتافات ذهبية وحزام قيادة رسمي.',
    priceCoins: 175,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#ffd13b',
  },
  {
    id: 'outfit:diver_suit',
    category: 'outfit',
    value: 'diver_suit',
    titleAr: 'بدلة الغواص المجهزة',
    descriptionAr: 'حزام غوص وأسطوانة توازن أنيقة.',
    priceCoins: 150,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#06d6a0',
  },
  {
    id: 'outfit:volcanic_armor',
    category: 'outfit',
    value: 'volcanic_armor',
    titleAr: 'درع الحمم المزخرف',
    descriptionAr: 'كتافات بركانية داكنة مقاومة للحرارة شكلياً.',
    priceCoins: 260,
    rarity: 'epic',
    unlockSource: 'shop',
    previewAccentHex: '#f97316',
  },
  {
    id: 'outfit:royal_robe',
    category: 'outfit',
    value: 'royal_robe',
    titleAr: 'رداء الأسطورة الملكي',
    descriptionAr: 'عباءة ملكية فاخرة تفتح عبر التقدم الموسمي أو المتجر.',
    priceCoins: 360,
    rarity: 'seasonal',
    unlockSource: 'season',
    previewAccentHex: '#a855f7',
  },

  // Raft Skins
  {
    id: 'raft_skin:classic_oak',
    category: 'raft_skin',
    value: 'classic_oak',
    titleAr: 'خشب البلوط الأصلي',
    descriptionAr: 'الطوف الخشبي المتين بمصباحه الدافئ.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#d48c46',
  },
  {
    id: 'raft_skin:bamboo_tropical',
    category: 'raft_skin',
    value: 'bamboo_tropical',
    titleAr: 'طوف الخيزران الاستوائي',
    descriptionAr: 'ألواح خيزران خضراء فاتحة وراية زمردية.',
    priceCoins: 180,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#4ade80',
  },
  {
    id: 'raft_skin:obsidian_magma',
    category: 'raft_skin',
    value: 'obsidian_magma',
    titleAr: 'طوف السبج البركاني',
    descriptionAr: 'أخشاب داكنة متفحمة مع فانوس برتقالي متوهج.',
    priceCoins: 280,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#f97316',
  },
  {
    id: 'raft_skin:frost_crystal',
    category: 'raft_skin',
    value: 'frost_crystal',
    titleAr: 'طوف البلور الجليدي',
    descriptionAr: 'أخشاب ثلجية باردة وراية سماوية متلألئة.',
    priceCoins: 310,
    rarity: 'epic',
    unlockSource: 'shop',
    previewAccentHex: '#38bdf8',
  },
  {
    id: 'raft_skin:golden_galleon',
    category: 'raft_skin',
    value: 'golden_galleon',
    titleAr: 'السفينة الذهبية النادرة',
    descriptionAr: 'طوف مذهّب بالكامل مع راية ملكية للأحداث والمواسم.',
    priceCoins: 420,
    rarity: 'seasonal',
    unlockSource: 'rare_event',
    previewAccentHex: '#ffd13b',
  },

  // Motion Trails
  {
    id: 'trail:classic_green',
    category: 'trail',
    value: 'classic_green',
    titleAr: 'السحابة الخضراء الكلاسيكية',
    descriptionAr: 'دخان الدفع الأخضر المعهود للانطلاق.',
    priceCoins: 0,
    rarity: 'starter',
    unlockSource: 'starter',
    previewAccentHex: '#9ef01a',
  },
  {
    id: 'trail:rainbow_bubbles',
    category: 'trail',
    value: 'rainbow_bubbles',
    titleAr: 'فقاعات قوس قزح',
    descriptionAr: 'فقاعات ملونة متلألئة تتطاير خلف الطوف.',
    priceCoins: 145,
    rarity: 'common',
    unlockSource: 'shop',
    previewAccentHex: '#f472b6',
  },
  {
    id: 'trail:volcanic_sparks',
    category: 'trail',
    value: 'volcanic_sparks',
    titleAr: 'شرارات الحمم المتطايرة',
    descriptionAr: 'وهج برتقالي وذهبي عند كل دفعة.',
    priceCoins: 220,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#fb923c',
  },
  {
    id: 'trail:frost_mist',
    category: 'trail',
    value: 'frost_mist',
    titleAr: 'رذاذ الثلج البارد',
    descriptionAr: 'سحابة بلورية بيضاء وسماوية منعشة.',
    priceCoins: 240,
    rarity: 'rare',
    unlockSource: 'shop',
    previewAccentHex: '#7dd3fc',
  },
  {
    id: 'trail:golden_confetti',
    category: 'trail',
    value: 'golden_confetti',
    titleAr: 'غبار النجوم الذهبي',
    descriptionAr: 'بريق احتفالي ذهبي يفتح من الموسم أو الحدث النادر.',
    priceCoins: 340,
    rarity: 'seasonal',
    unlockSource: 'season',
    previewAccentHex: '#fde047',
  },
];

export const COSMETIC_ITEM_MAP: Record<string, CosmeticItemDef> = Object.fromEntries(
  COSMETIC_CATALOG.map((item) => [item.id, item]),
);

export const SHOP_CATEGORY_LABELS_AR: Record<CosmeticCategory, string> = {
  hat: 'القبعات',
  glasses: 'النظارات',
  color: 'الألوان',
  outfit: 'الملابس',
  raft_skin: 'مظاهر الطوف',
  trail: 'آثار الحركة',
};

export function getDefaultOwnedItemIds(): string[] {
  return COSMETIC_CATALOG.filter((i) => i.unlockSource === 'starter').map((i) => i.id);
}

export function normalizePlayerCosmetic(raw?: Partial<PlayerCosmetic> | null, fallbackSlot = 0): PlayerCosmetic {
  const defaultHats: readonly HatStyle[] = ['captain', 'propeller', 'none', 'crown'];
  const defaultGlasses: readonly GlassesStyle[] = ['none', 'nerd', 'shades', 'none'];
  const hat = raw?.hat && VALID_HATS_LIST.includes(raw.hat) ? raw.hat : defaultHats[fallbackSlot % 4];
  const glasses =
    raw?.glasses && VALID_GLASSES_LIST.includes(raw.glasses)
      ? raw.glasses
      : defaultGlasses[fallbackSlot % 4];
  const colorIndex =
    typeof raw?.colorIndex === 'number' && Number.isInteger(raw.colorIndex) && raw.colorIndex >= 0 && raw.colorIndex < COSMETIC_COLOR_DEFS.length
      ? raw.colorIndex
      : fallbackSlot % 4;
  const outfit: OutfitStyle =
    raw?.outfit && VALID_OUTFITS_LIST.includes(raw.outfit) ? raw.outfit : 'classic';
  const raftSkin: RaftSkinId =
    raw?.raftSkin && VALID_RAFT_SKINS_LIST.includes(raw.raftSkin) ? raw.raftSkin : 'classic_oak';
  const trail: MotionTrailId =
    raw?.trail && VALID_TRAILS_LIST.includes(raw.trail) ? raw.trail : 'classic_green';

  return {
    hat,
    glasses,
    colorIndex,
    outfit,
    raftSkin,
    trail,
  };
}

export function cosmeticToItemIds(cosmetic: PlayerCosmetic): string[] {
  const norm = normalizePlayerCosmetic(cosmetic, 0);
  return [
    `hat:${norm.hat}`,
    `glasses:${norm.glasses}`,
    `color:${norm.colorIndex}`,
    `outfit:${norm.outfit ?? 'classic'}`,
    `raft_skin:${norm.raftSkin ?? 'classic_oak'}`,
    `trail:${norm.trail ?? 'classic_green'}`,
  ];
}

export function applyShopItemToCosmetic(cosmetic: PlayerCosmetic, item: CosmeticItemDef): PlayerCosmetic {
  const next = normalizePlayerCosmetic(cosmetic, 0);
  switch (item.category) {
    case 'hat':
      return { ...next, hat: item.value as HatStyle };
    case 'glasses':
      return { ...next, glasses: item.value as GlassesStyle };
    case 'color':
      return { ...next, colorIndex: Number(item.value) };
    case 'outfit':
      return { ...next, outfit: item.value as OutfitStyle };
    case 'raft_skin':
      return { ...next, raftSkin: item.value as RaftSkinId };
    case 'trail':
      return { ...next, trail: item.value as MotionTrailId };
  }
}

export function isCosmeticFullyOwned(cosmetic: PlayerCosmetic, ownedItemIds: ReadonlySet<string>): boolean {
  return cosmeticToItemIds(cosmetic).every((id) => ownedItemIds.has(id));
}

export interface RaftSkinPalette {
  logHex: number;
  deckHex: number;
  dividerHex: number;
  flagHex: number;
  lanternHex: number;
  foamHex: number;
}

export const RAFT_SKIN_PALETTES: Record<RaftSkinId, RaftSkinPalette> = {
  classic_oak: {
    logHex: 0xffffff,
    deckHex: 0xf0c99d,
    dividerHex: 0x7f4f24,
    flagHex: 0xff595e,
    lanternHex: 0xffe066,
    foamHex: 0xe0fbfc,
  },
  bamboo_tropical: {
    logHex: 0xb7e4c7,
    deckHex: 0xd8f3dc,
    dividerHex: 0x2d6a4f,
    flagHex: 0x06d6a0,
    lanternHex: 0xa7f3d0,
    foamHex: 0xd1fae5,
  },
  obsidian_magma: {
    logHex: 0x334155,
    deckHex: 0x475569,
    dividerHex: 0x0f172a,
    flagHex: 0xf97316,
    lanternHex: 0xff6b00,
    foamHex: 0xfdba74,
  },
  frost_crystal: {
    logHex: 0xbae6fd,
    deckHex: 0xe0f2fe,
    dividerHex: 0x0284c7,
    flagHex: 0x38bdf8,
    lanternHex: 0x7dd3fc,
    foamHex: 0xf0f9ff,
  },
  golden_galleon: {
    logHex: 0xfbbf24,
    deckHex: 0xfde68a,
    dividerHex: 0x92400e,
    flagHex: 0xe11d48,
    lanternHex: 0xfef08a,
    foamHex: 0xfef9c3,
  },
};

export function sampleMotionTrailRgb(
  trail: MotionTrailId | undefined,
  power: number,
  superFart: boolean,
  seed = 0.5,
): [number, number, number] {
  if (superFart) {
    return [0.98, 0.86, 0.16];
  }
  switch (trail) {
    case 'rainbow_bubbles': {
      const palette: readonly [number, number, number][] = [
        [0.98, 0.35, 0.52],
        [0.99, 0.78, 0.22],
        [0.08, 0.84, 0.62],
        [0.22, 0.74, 0.97],
        [0.66, 0.33, 0.97],
      ];
      return palette[Math.floor(Math.abs(seed) * palette.length) % palette.length];
    }
    case 'volcanic_sparks':
      return seed > 0.45 ? [0.99, 0.45, 0.1] : [0.99, 0.76, 0.18];
    case 'frost_mist':
      return seed > 0.5 ? [0.72, 0.92, 1.0] : [0.92, 0.98, 1.0];
    case 'golden_confetti':
      return seed > 0.4 ? [0.99, 0.85, 0.22] : [1.0, 0.96, 0.7];
    case 'classic_green':
    default:
      return [0.48 + power * 0.45, 0.88 - power * 0.08, 0.24 - power * 0.14];
  }
}
