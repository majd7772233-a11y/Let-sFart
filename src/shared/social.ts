import { isValidCourseId } from './course.ts';
import type {
  CourseId,
  EmoteId,
  GameDifficulty,
  GameMode,
  PlaylistItem,
} from './types.ts';

export interface QuickChatPreset {
  id: string;
  text: string;
}

export const QUICK_CHAT_PRESETS: readonly QuickChatPreset[] = [
  { id: 'go_right', text: 'يمين!' },
  { id: 'go_left', text: 'يسار!' },
  { id: 'get_ready', text: 'استعد!' },
  { id: 'use_item', text: 'استخدم العنصر!' },
  { id: 'team_push', text: 'دفعة جماعية!' },
  { id: 'drop_anchor', text: 'أنزل المرساة!' },
  { id: 'watch_out', text: 'انتبه للعقبة!' },
  { id: 'well_done', text: 'أحسنت!' },
] as const;

export interface EmoteDefinition {
  id: EmoteId;
  labelAr: string;
  icon: string;
  durationMs: number;
}

export const EMOTE_DEFINITIONS: readonly EmoteDefinition[] = [
  { id: 'laugh', labelAr: 'ضحك', icon: '😂', durationMs: 2600 },
  { id: 'fear', labelAr: 'خوف', icon: '😱', durationMs: 2500 },
  { id: 'celebrate', labelAr: 'احتفال', icon: '🥳', durationMs: 2800 },
  { id: 'dance', labelAr: 'رقص', icon: '🕺', durationMs: 3200 },
  { id: 'point_left', labelAr: 'إشارة يسار', icon: '👈', durationMs: 2200 },
  { id: 'point_right', labelAr: 'إشارة يمين', icon: '👉', durationMs: 2200 },
] as const;

const EMOTE_MAP = new Map<EmoteId, EmoteDefinition>(
  EMOTE_DEFINITIONS.map((def) => [def.id, def]),
);

const PRESET_MAP = new Map<string, QuickChatPreset>(
  QUICK_CHAT_PRESETS.map((preset) => [preset.id, preset]),
);

export const MAX_CHAT_LENGTH = 160;
export const MAX_PLAYLIST_ITEMS = 8;

export function isValidEmoteId(val: unknown): val is EmoteId {
  return typeof val === 'string' && EMOTE_MAP.has(val as EmoteId);
}

export function getEmoteDefinition(id: EmoteId): EmoteDefinition {
  return EMOTE_MAP.get(id) ?? EMOTE_DEFINITIONS[0];
}

export function getQuickChatPreset(presetId: unknown): QuickChatPreset | null {
  if (typeof presetId !== 'string') return null;
  return PRESET_MAP.get(presetId) ?? null;
}

export function sanitizeChatText(raw: unknown, maxLength = MAX_CHAT_LENGTH): string {
  if (typeof raw !== 'string') return '';
  // Strip ASCII control chars & zero-width chars, collapse newlines/excess spaces
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  // Safely slice by Unicode code points so Arabic/emoji pairs are never split cleanly
  const cps = Array.from(cleaned);
  return cps.slice(0, maxLength).join('');
}

const VALID_MODES = new Set<GameMode>(['standard', 'time_trial', 'survival', 'treasure', 'chaos']);
const VALID_DIFFS = new Set<GameDifficulty>(['easy', 'normal', 'hard']);

export function sanitizePlaylist(raw: unknown): PlaylistItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaylistItem[] = [];
  for (let i = 0; i < raw.length && out.length < MAX_PLAYLIST_ITEMS; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<PlaylistItem>;
    const courseId: CourseId = isValidCourseId(obj.courseId) ? obj.courseId : 'tropical';
    const gameMode: GameMode =
      typeof obj.gameMode === 'string' && VALID_MODES.has(obj.gameMode as GameMode)
        ? (obj.gameMode as GameMode)
        : 'standard';
    const difficulty: GameDifficulty =
      typeof obj.difficulty === 'string' && VALID_DIFFS.has(obj.difficulty as GameDifficulty)
        ? (obj.difficulty as GameDifficulty)
        : 'normal';
    const id =
      typeof obj.id === 'string' && obj.id.trim().length > 0
        ? obj.id.trim().slice(0, 48)
        : `pl-${i + 1}-${courseId}`;
    out.push({ id, courseId, gameMode, difficulty });
  }
  return out;
}

export function popNextPlaylistItem(playlist: readonly PlaylistItem[]): {
  next: PlaylistItem | null;
  remaining: PlaylistItem[];
} {
  if (!playlist || playlist.length === 0) {
    return { next: null, remaining: [] };
  }
  const [next, ...remaining] = playlist;
  return { next, remaining };
}
